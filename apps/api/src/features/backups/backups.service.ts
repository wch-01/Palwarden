import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { BackupRecord, ServerInstance } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { PrismaService } from '../../core/database/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ProcessManagerService } from '../process-manager/services/process-manager.service';
import { ServerInstancesService } from '../server-instances/services/server-instances.service';

export interface BackupRecordView {
  id: string;
  serverInstanceId: string;
  triggerType: string;
  filePath: string;
  sizeBytes: number;
  success: boolean;
  failureMessage: string | null;
  createdAt: string;
}

export interface BackupJobView {
  id: string;
  type: 'restore';
  status: 'running' | 'done' | 'error';
  log: string[];
  error: string | null;
  backupId: string | null;
  emergencyBackup: BackupRecordView | null;
}

@Injectable()
export class BackupsService {
  private readonly jobs = new Map<string, BackupJobView>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: ServerInstancesService,
    private readonly processManager: ProcessManagerService,
    private readonly audit: AuditLogService,
  ) {}

  async list(serverInstanceId: string): Promise<BackupRecordView[]> {
    await this.instances.get(serverInstanceId);
    const records = await this.prisma.backupRecord.findMany({
      where: { serverInstanceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return records.map((record) => this.toView(record));
  }

  async createManual(serverInstanceId: string, actorId: string): Promise<BackupRecordView> {
    return this.createTriggered(serverInstanceId, actorId, 'MANUAL');
  }

  async createTriggered(serverInstanceId: string, actorId: string | undefined, triggerType: string): Promise<BackupRecordView> {
    const { instance, adminPassword } = await this.instances.rawWithPassword(serverInstanceId);
    const destination = this.backupFilePath(instance, triggerType.toLowerCase().replace(/_/g, '-'));
    try {
      await this.prepareForBackup(instance, adminPassword, actorId);
      await mkdir(instance.backupDirectory, { recursive: true });
      await this.createArchive(instance.saveDirectory, destination);
      const sizeBytes = (await stat(destination)).size;
      const record = await this.prisma.backupRecord.create({
        data: {
          serverInstanceId,
          triggerType,
          filePath: destination,
          sizeBytes,
          success: true,
        },
      });
      await this.audit.record({
        actorId,
        action: 'SERVER_UPDATED',
        targetId: serverInstanceId,
        message: `${this.humanTrigger(triggerType)} backup created.`,
        metadata: { backupRecordId: record.id, triggerType },
      });
      return this.toView(record);
    } catch (error) {
      const failureMessage = this.safeFailureMessage(error);
      const record = await this.prisma.backupRecord.create({
        data: {
          serverInstanceId,
          triggerType,
          filePath: destination,
          sizeBytes: 0,
          success: false,
          failureMessage,
        },
      });
      await this.audit.record({
        actorId,
        action: 'SERVER_UPDATED',
        targetId: serverInstanceId,
        message: `${this.humanTrigger(triggerType)} backup failed.`,
        metadata: { backupRecordId: record.id, triggerType },
      });
      throw new BadRequestException(failureMessage);
    }
  }

  async remove(serverInstanceId: string, backupId: string, actorId: string): Promise<{ ok: true }> {
    const instance = await this.instances.get(serverInstanceId);
    const record = await this.prisma.backupRecord.findFirst({ where: { id: backupId, serverInstanceId } });
    if (!record) {
      throw new NotFoundException('Backup record not found.');
    }
    if (record.success) {
      this.assertPathInsideDirectory(record.filePath, instance.backupDirectory);
      await rm(record.filePath, { force: true });
    }
    await this.prisma.backupRecord.delete({ where: { id: backupId } });
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: serverInstanceId,
      message: 'Backup deleted.',
      metadata: { backupRecordId: backupId },
    });
    return { ok: true };
  }

  async removeFailed(serverInstanceId: string, actorId: string): Promise<{ ok: true; deleted: number }> {
    await this.instances.get(serverInstanceId);
    const result = await this.prisma.backupRecord.deleteMany({
      where: {
        serverInstanceId,
        success: false,
      },
    });
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: serverInstanceId,
      message: 'Failed backup records deleted.',
      metadata: { deleted: result.count },
    });
    return { ok: true, deleted: result.count };
  }

  startRestore(serverInstanceId: string, backupId: string, actorId: string): BackupJobView {
    const job: BackupJobView = {
      id: `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'restore',
      status: 'running',
      log: ['Preparing backup restore...'],
      error: null,
      backupId,
      emergencyBackup: null,
    };
    this.jobs.set(job.id, job);
    setImmediate(() => {
      void this.runRestoreJob(job, serverInstanceId, backupId, actorId);
    });
    return job;
  }

  getJob(jobId: string): BackupJobView {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException('Backup job not found.');
    }
    return job;
  }

  private async runRestoreJob(job: BackupJobView, serverInstanceId: string, backupId: string, actorId: string): Promise<void> {
    try {
      job.emergencyBackup = await this.restore(serverInstanceId, backupId, actorId, (line) => job.log.push(line));
      job.log.push('Restore complete.');
      job.status = 'done';
    } catch (error) {
      job.error = this.safeFailureMessage(error);
      job.log.push(job.error);
      job.status = 'error';
    }
  }

  private async restore(
    serverInstanceId: string,
    backupId: string,
    actorId: string,
    onProgress: (line: string) => void,
  ): Promise<BackupRecordView | null> {
    onProgress('Checking server state...');
    const { instance } = await this.instances.rawWithPassword(serverInstanceId);
    const status = await this.processManager.getRecoveredStatus(instance);
    if (status.state === 'running' || status.state === 'starting' || status.state === 'stopping') {
      throw new BadRequestException('Stop the server before restoring a backup.');
    }
    onProgress('Validating selected backup...');
    const record = await this.prisma.backupRecord.findFirst({ where: { id: backupId, serverInstanceId } });
    if (!record) {
      throw new NotFoundException('Backup record not found.');
    }
    if (!record.success) {
      throw new BadRequestException('Only successful backups can be restored.');
    }
    this.assertPathInsideDirectory(record.filePath, instance.backupDirectory);
    await this.requireFile(record.filePath, 'Backup file');

    onProgress('Creating emergency backup of current save directory...');
    const emergencyBackup = await this.createEmergencyBackup(instance, actorId);
    onProgress('Clearing current save directory...');
    await rm(instance.saveDirectory, { recursive: true, force: true });
    await mkdir(instance.saveDirectory, { recursive: true });
    onProgress('Expanding selected backup archive...');
    await this.expandArchive(record.filePath, instance.saveDirectory);
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: serverInstanceId,
      message: 'Backup restored.',
      metadata: { backupRecordId: backupId, emergencyBackupRecordId: emergencyBackup?.id ?? null },
    });
    return emergencyBackup;
  }

  async pruneScheduledBackups(serverInstanceId: string, retentionCount: number): Promise<void> {
    const instance = await this.instances.get(serverInstanceId);
    const keep = Math.max(1, retentionCount);
    const oldRecords = await this.prisma.backupRecord.findMany({
      where: { serverInstanceId, triggerType: 'SCHEDULED', success: true },
      orderBy: { createdAt: 'desc' },
      skip: keep,
    });
    for (const record of oldRecords) {
      try {
        this.assertPathInsideDirectory(record.filePath, instance.backupDirectory);
        await rm(record.filePath, { force: true });
      } catch {
        // Retention cleanup should never break the scheduler loop.
      }
      await this.prisma.backupRecord.delete({ where: { id: record.id } }).catch(() => null);
    }
  }

  private async prepareForBackup(instance: ServerInstance, adminPassword: string, actorId: string | undefined): Promise<void> {
    const status = await this.processManager.getRecoveredStatus(instance);
    if (status.state === 'running') {
      await this.processManager.saveWorld(instance, adminPassword, actorId);
    }
  }

  private async createArchive(saveDirectory: string, destination: string): Promise<void> {
    await this.requireDirectory(saveDirectory, 'Save directory');
    const script = `
param(
  [Parameter(Mandatory=$true)][string]$SaveDirectory,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$source = Join-Path -Path $SaveDirectory -ChildPath '*'
Compress-Archive -Path $source -DestinationPath $Destination -Force
`;
    await this.runPowerShellFile(script, [saveDirectory, destination], 'Could not create backup archive.');
  }

  private async expandArchive(source: string, destination: string): Promise<void> {
    const script = `
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Expand-Archive -Path $Source -DestinationPath $Destination -Force
`;
    await this.runPowerShellFile(script, [source, destination], 'Could not restore backup archive.');
  }

  private async runPowerShellFile(script: string, args: string[], failureMessage: string): Promise<void> {
    const tempRoot = await mkdtemp(join(tmpdir(), 'palwarden-backup-'));
    const scriptPath = join(tempRoot, 'archive.ps1');
    await writeFile(scriptPath, script, 'utf-8');
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
          windowsHide: true,
        });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', () => rejectPromise(new BadRequestException('Could not start the Windows backup tool.')));
        child.on('exit', (code) => {
          if (code === 0) {
            resolvePromise();
            return;
          }
          rejectPromise(new BadRequestException(stderr.trim() || failureMessage));
        });
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private async createEmergencyBackup(instance: ServerInstance, actorId: string): Promise<BackupRecordView | null> {
    if (!(await this.directoryExists(instance.saveDirectory))) {
      return null;
    }
    const destination = this.backupFilePath(instance, 'before-restore');
    await mkdir(instance.backupDirectory, { recursive: true });
    await this.createArchive(instance.saveDirectory, destination);
    const sizeBytes = (await stat(destination)).size;
    const record = await this.prisma.backupRecord.create({
      data: {
        serverInstanceId: instance.id,
        triggerType: 'BEFORE_RESTORE',
        filePath: destination,
        sizeBytes,
        success: true,
      },
    });
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: instance.id,
      message: 'Emergency backup created before restore.',
      metadata: { backupRecordId: record.id },
    });
    return this.toView(record);
  }

  private backupFilePath(instance: ServerInstance, suffix?: string): string {
    const name = this.safeName(instance.displayName);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = resolve(instance.backupDirectory, `${name}-${suffix ? `${suffix}-` : ''}${stamp}.zip`);
    this.assertPathInsideDirectory(destination, instance.backupDirectory);
    return destination;
  }

  private assertPathInsideDirectory(filePath: string, directory: string): void {
    const resolvedDirectory = `${resolve(directory)}\\`.toLowerCase();
    const resolvedFile = resolve(filePath).toLowerCase();
    if (!resolvedFile.startsWith(resolvedDirectory)) {
      throw new BadRequestException('Backup path is outside the configured backup directory.');
    }
  }

  private safeName(value: string): string {
    return basename(value, extname(value)).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
  }

  private humanTrigger(value: string): string {
    return value.toLowerCase().replace(/_/g, ' ');
  }

  private async requireDirectory(path: string, label: string): Promise<void> {
    const result = await stat(path).catch(() => null);
    if (!result?.isDirectory()) {
      throw new BadRequestException(`${label} does not exist.`);
    }
  }

  private async requireFile(path: string, label: string): Promise<void> {
    const result = await stat(path).catch(() => null);
    if (!result?.isFile()) {
      throw new BadRequestException(`${label} does not exist.`);
    }
  }

  private async directoryExists(path: string): Promise<boolean> {
    const result = await stat(path).catch(() => null);
    return result?.isDirectory() ?? false;
  }

  private safeFailureMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response && 'message' in response) {
        const message = (response as { message?: string | string[] }).message;
        return Array.isArray(message) ? message.join(' ') : (message ?? 'Backup failed.');
      }
    }
    return error instanceof Error && error.message.trim() ? error.message : 'Backup failed.';
  }

  private toView(record: BackupRecord): BackupRecordView {
    return {
      id: record.id,
      serverInstanceId: record.serverInstanceId,
      triggerType: record.triggerType,
      filePath: record.filePath,
      sizeBytes: record.sizeBytes,
      success: record.success,
      failureMessage: record.failureMessage,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
