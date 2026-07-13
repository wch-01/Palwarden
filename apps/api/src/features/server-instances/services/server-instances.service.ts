import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ServerInstance, Prisma } from '@prisma/client';
import type { ServerDashboardCard, ServerInstanceView } from '@palwarden/shared';
import { spawn } from 'node:child_process';
import { access, constants, mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../../core/database/prisma.service';
import { CryptoService } from '../../../core/security/crypto.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PalworldApiClientFactory } from '../../palworld-api/clients/palworld-api.client';
import { ProcessManagerService } from '../../process-manager/services/process-manager.service';
import { DeployServerInstanceDto, UpsertServerInstanceDto } from '../dto/server-instance.dto';
import { SteamCmdService } from './steamcmd.service';
import { PalworldSettingsFileService } from './palworld-settings-file.service';

export interface DeployJobView {
  id: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  error: string | null;
  serverInstanceId: string | null;
}

export interface ServerConfigView {
  entries: Awaited<ReturnType<PalworldSettingsFileService['readConfigEntries']>>;
}

@Injectable()
export class ServerInstancesService {
  private readonly deployJobs = new Map<string, DeployJobView>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditLogService,
    private readonly palworld: PalworldApiClientFactory,
    private readonly processManager: ProcessManagerService,
    private readonly steamcmd: SteamCmdService,
    private readonly settingsFile: PalworldSettingsFileService,
  ) {}

  async list(): Promise<ServerInstanceView[]> {
    return (await this.prisma.serverInstance.findMany({ orderBy: { displayName: 'asc' } })).map((item) =>
      this.toView(item),
    );
  }

  async dashboard(): Promise<ServerDashboardCard[]> {
    const instances = await this.prisma.serverInstance.findMany({ orderBy: { displayName: 'asc' } });
    return Promise.all(
      instances.map(async (instance) => {
        const runtime = await this.processManager.getRecoveredStatus(instance);
        try {
          const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
          const [info, metrics] = await Promise.all([client.info(), client.metrics()]);
          return {
            ...this.toView(instance),
            runtimeState: runtime.state,
            restConnectivity: 'online',
            currentPlayers: metrics.currentplayernum,
            maxPlayers: metrics.maxplayernum,
            serverFps: metrics.serverfps,
            uptimeSeconds: metrics.uptime,
            installedVersion: info.version,
          };
        } catch {
          const configuredMaxPlayers = await this.readConfiguredMaxPlayers(instance);
          return {
            ...this.toView(instance),
            runtimeState: runtime.state,
            restConnectivity: runtime.state === 'starting' ? 'starting' : 'offline',
            currentPlayers: null,
            maxPlayers: configuredMaxPlayers,
            serverFps: null,
            uptimeSeconds: runtime.uptimeSeconds,
            installedVersion: null,
          };
        }
      }),
    );
  }

  async get(id: string): Promise<ServerInstanceView> {
    return this.toView(await this.getRaw(id));
  }

  async create(dto: UpsertServerInstanceDto, actorId: string): Promise<ServerInstanceView> {
    await this.validate(dto);
    const encrypted = dto.adminPassword ? this.crypto.encrypt(dto.adminPassword) : null;
    const instance = await this.prisma.serverInstance.create({ data: this.toCreateData(dto, encrypted) });
    await this.audit.record({ actorId, action: 'SERVER_CREATED', targetId: instance.id, message: 'Server profile created.' });
    if (encrypted) {
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: instance.id, message: 'Server credential saved.' });
    }
    return this.toView(instance);
  }

  defaultInstallDirectory(name: string): { path: string } {
    return { path: this.defaultInstallPath(name) };
  }

  getDeployJob(id: string): DeployJobView {
    const job = this.deployJobs.get(id);
    if (!job) {
      throw new NotFoundException('Deploy job not found.');
    }
    return job;
  }

  deploy(dto: DeployServerInstanceDto, actorId: string, requestedJobId?: string): DeployJobView {
    const installDirectory = this.resolveInstallPath(dto.installationDirectory?.trim() || this.defaultInstallPath(dto.displayName));
    const job: DeployJobView = {
      id: requestedJobId?.startsWith('deploy-') ? requestedJobId : `deploy-${nanoid(10)}`,
      status: 'running',
      log: ['Preparing Palworld Dedicated Server deployment...'],
      error: null,
      serverInstanceId: null,
    };
    this.deployJobs.set(job.id, job);
    console.log(`[deploy-job] created ${job.id} for ${dto.displayName}`);
    setImmediate(() => {
      void this.runDeploy(job, dto, actorId, installDirectory);
    });
    return job;
  }

  async update(id: string, dto: UpsertServerInstanceDto, actorId: string): Promise<ServerInstanceView> {
    await this.getRaw(id);
    await this.validate(dto, id);
    const encrypted = dto.adminPassword ? this.crypto.encrypt(dto.adminPassword) : undefined;
    const instance = await this.prisma.serverInstance.update({
      where: { id },
      data: this.toUpdateData(dto, encrypted),
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server profile updated.' });
    if (encrypted) {
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: id, message: 'Server credential replaced.' });
    }
    return this.toView(instance);
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.getRaw(id);
    await this.processManager.assertStopped(id);
    await this.prisma.serverInstance.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'SERVER_DELETED', targetId: id, message: 'Server profile deleted.' });
  }

  async openInstallationDirectory(id: string): Promise<{ ok: true }> {
    const instance = await this.getRaw(id);
    await this.requireDirectory(instance.installationDirectory, 'Installation directory');
    if (process.platform !== 'win32') {
      throw new BadRequestException('Host file browsing is only implemented for Windows.');
    }
    const child = spawn('explorer.exe', [instance.installationDirectory], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  }

  async testConnection(id: string): Promise<{ ok: true; info: unknown; metrics: unknown }> {
    const instance = await this.getRaw(id);
    const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
    return { ok: true, info: await client.info(), metrics: await client.metrics() };
  }

  async roster(id: string): Promise<{ players: unknown[]; guilds: unknown[] }> {
    const instance = await this.getRaw(id);
    const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
    return { players: await client.players(), guilds: [] };
  }

  async configuration(id: string): Promise<ServerConfigView> {
    const instance = await this.getRaw(id);
    const entries = await this.settingsFile.readConfigEntries(instance.configurationFilePath);
    return {
      entries: entries.map((entry) => {
        if (!entry.sensitive) {
          return entry;
        }
        const configured =
          entry.key === 'AdminPassword' ? entry.configured && Boolean(instance.encryptedAdminPassword) : entry.configured;
        return { ...entry, value: '', configured };
      }),
    };
  }

  async updateConfiguration(id: string, values: Record<string, string | number | boolean>, actorId: string): Promise<ServerConfigView> {
    const instance = await this.getRaw(id);
    const nextValues = { ...values };
    const adminPassword = typeof nextValues.AdminPassword === 'string' ? nextValues.AdminPassword.trim() : '';
    delete nextValues.AdminPassword;
    if (adminPassword) {
      const encrypted = this.crypto.encrypt(adminPassword);
      await this.prisma.serverInstance.update({
        where: { id },
        data: {
          encryptedAdminPassword: encrypted.ciphertext,
          encryptedAdminPasswordIv: encrypted.iv,
          encryptedAdminPasswordTag: encrypted.tag,
        },
      });
      nextValues.AdminPassword = adminPassword;
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: id, message: 'Server credential replaced.' });
    }
    try {
      await this.settingsFile.updateConfigEntries(instance.configurationFilePath, nextValues);
    } catch (error) {
      if (this.isFileWritePermissionError(error)) {
        throw new BadRequestException(
          'Palwarden could not write the configuration file. Check that the server is stopped and Palwarden has permission to edit the file.',
        );
      }
      throw error;
    }
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server configuration updated.' });
    return this.configuration(id);
  }

  async rawWithPassword(id: string): Promise<{ instance: ServerInstance; adminPassword: string }> {
    const instance = await this.getRaw(id);
    return { instance, adminPassword: this.decryptPassword(instance) };
  }

  private async getRaw(id: string): Promise<ServerInstance> {
    const instance = await this.prisma.serverInstance.findUnique({ where: { id } });
    if (!instance) {
      throw new NotFoundException('Server instance not found.');
    }
    return instance;
  }

  private decryptPassword(instance: ServerInstance): string {
    if (!instance.encryptedAdminPassword || !instance.encryptedAdminPasswordIv || !instance.encryptedAdminPasswordTag) {
      throw new BadRequestException('Server AdminPassword is not configured.');
    }
    return this.crypto.decrypt({
      ciphertext: instance.encryptedAdminPassword,
      iv: instance.encryptedAdminPasswordIv,
      tag: instance.encryptedAdminPasswordTag,
    });
  }

  private isFileWritePermissionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EACCES', 'EPERM', 'EBUSY'].includes(String((error as { code?: unknown }).code))
    );
  }

  private async readConfiguredMaxPlayers(instance: ServerInstance): Promise<number | null> {
    const entries = await this.settingsFile.readConfigEntries(instance.configurationFilePath).catch(() => []);
    const rawValue = entries.find((entry) => entry.key === 'ServerPlayerMaxNum')?.value;
    const parsed = rawValue === undefined ? Number.NaN : Number.parseInt(String(rawValue), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toCreateData(
    dto: UpsertServerInstanceDto,
    encrypted: { ciphertext: string; iv: string; tag: string } | null,
  ): Prisma.ServerInstanceCreateInput {
    return {
      ...this.commonData(dto),
      encryptedAdminPassword: encrypted?.ciphertext ?? null,
      encryptedAdminPasswordIv: encrypted?.iv ?? null,
      encryptedAdminPasswordTag: encrypted?.tag ?? null,
    };
  }

  private toUpdateData(
    dto: UpsertServerInstanceDto,
    encrypted: { ciphertext: string; iv: string; tag: string } | undefined,
  ): Prisma.ServerInstanceUpdateInput {
    const data: Prisma.ServerInstanceUpdateInput = this.commonData(dto);
    if (encrypted) {
      data.encryptedAdminPassword = encrypted.ciphertext;
      data.encryptedAdminPasswordIv = encrypted.iv;
      data.encryptedAdminPasswordTag = encrypted.tag;
    }
    return data;
  }

  private commonData(dto: UpsertServerInstanceDto) {
    return {
      displayName: dto.displayName.trim(),
      description: dto.description?.trim() || null,
      installationDirectory: dto.installationDirectory,
      executablePath: dto.executablePath,
      workingDirectory: dto.workingDirectory,
      configurationFilePath: dto.configurationFilePath,
      saveDirectory: dto.saveDirectory,
      backupDirectory: dto.backupDirectory,
      restApiHost: dto.restApiHost,
      restApiPort: dto.restApiPort,
      gamePort: dto.gamePort,
      queryPort: dto.queryPort,
      launchArgumentsJson: JSON.stringify(dto.launchArguments),
      autoStart: dto.autoStart,
      autoRestart: dto.autoRestart,
      backupBeforeRestart: dto.backupBeforeRestart,
    };
  }

  private toView(instance: ServerInstance): ServerInstanceView {
    return {
      id: instance.id,
      displayName: instance.displayName,
      description: instance.description,
      installationDirectory: instance.installationDirectory,
      executablePath: instance.executablePath,
      workingDirectory: instance.workingDirectory,
      configurationFilePath: instance.configurationFilePath,
      saveDirectory: instance.saveDirectory,
      backupDirectory: instance.backupDirectory,
      restApiHost: instance.restApiHost,
      restApiPort: instance.restApiPort,
      gamePort: instance.gamePort,
      queryPort: instance.queryPort,
      launchArguments: JSON.parse(instance.launchArgumentsJson) as string[],
      autoStart: instance.autoStart,
      autoRestart: instance.autoRestart,
      backupBeforeRestart: instance.backupBeforeRestart,
      adminPasswordConfigured: Boolean(instance.encryptedAdminPassword),
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
  }

  private async validate(dto: UpsertServerInstanceDto, existingId?: string): Promise<void> {
    this.validateDistinctPorts(dto.restApiPort, dto.gamePort, dto.queryPort);
    await Promise.all([
      this.requireFile(dto.executablePath, 'Executable path'),
      this.requireDirectory(dto.installationDirectory, 'Installation directory'),
      this.requireDirectory(dto.workingDirectory, 'Working directory'),
      this.requireFile(dto.configurationFilePath, 'Configuration file'),
      this.requireDirectory(dto.saveDirectory, 'Save directory'),
      this.requireWritableDirectory(dto.backupDirectory, 'Backup directory'),
    ]);
    await this.validateNoConflicts(dto, existingId);
  }

  private async runDeploy(job: DeployJobView, dto: DeployServerInstanceDto, actorId: string, installDirectory: string): Promise<void> {
    try {
      const adminPassword = dto.adminPassword?.trim() || nanoid(24);
      const append = (line: string) => this.appendDeployLog(job.id, line);
      append(`Install directory: ${installDirectory}`);
      append('Checking ports and install folder...');
      console.log(`[deploy-job] ${job.id} checking ${installDirectory}`);
      this.validateDistinctPorts(dto.restApiPort, dto.gamePort, dto.queryPort);
      await this.validateNoConflicts({
        installationDirectory: installDirectory,
        restApiPort: dto.restApiPort,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
      });
      await this.requireDeployTargetAvailable(installDirectory);
      append('Installing Palworld Dedicated Server with SteamCMD...');
      console.log(`[deploy-job] ${job.id} starting SteamCMD install`);
      await this.steamcmd.installPalworldServer(installDirectory, append);

      append('Writing Palworld configuration...');
      const configPath = await this.settingsFile.writeInitialSettings(installDirectory, {
        serverName: dto.displayName.trim(),
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
        restApiPort: dto.restApiPort,
        adminPassword,
        ...(dto.serverPassword !== undefined ? { serverPassword: dto.serverPassword } : {}),
        maxPlayers: dto.maxPlayers,
      });
      const saveDirectory = this.settingsFile.saveDirectory(installDirectory);
      const backupDirectory = join(this.dataDirectory(), 'backups', this.sanitizeServerFolderName(dto.displayName));
      await mkdir(backupDirectory, { recursive: true });

      append('Registering server profile...');
      const encrypted = this.crypto.encrypt(adminPassword);
      const profile: UpsertServerInstanceDto = {
        displayName: dto.displayName,
        installationDirectory: installDirectory,
        executablePath: join(installDirectory, 'PalServer.exe'),
        workingDirectory: installDirectory,
        configurationFilePath: configPath,
        saveDirectory,
        backupDirectory,
        restApiHost: dto.restApiHost,
        restApiPort: dto.restApiPort,
        adminPassword,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
        launchArguments: dto.launchArguments,
        autoStart: dto.autoStart,
        autoRestart: dto.autoRestart,
        backupBeforeRestart: dto.backupBeforeRestart,
      };
      if (dto.description !== undefined) {
        profile.description = dto.description;
      }
      const instance = await this.prisma.serverInstance.create({
        data: this.toCreateData(
          profile,
          encrypted,
        ),
      });
      await this.audit.record({ actorId, action: 'SERVER_CREATED', targetId: instance.id, message: 'Server deployed and registered.' });
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: instance.id, message: 'Server credential saved.' });
      job.serverInstanceId = instance.id;

      if (dto.startAfterInstall) {
        append('Starting Palworld server...');
        await this.processManager.start(instance, actorId);
      }

      append('Done.');
      console.log(`[deploy-job] ${job.id} done`);
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Deployment failed.';
      console.log(`[deploy-job] ${job.id} error: ${job.error}`);
      this.appendDeployLog(job.id, job.error);
    }
  }

  private appendDeployLog(jobId: string, line: string): void {
    const job = this.deployJobs.get(jobId);
    if (!job) {
      return;
    }
    job.log.push(line);
    if (job.log.length > 300) {
      job.log = job.log.slice(-300);
    }
  }

  private validateDistinctPorts(restApiPort: number, gamePort: number, queryPort: number): void {
    const ports = [restApiPort, gamePort, queryPort];
    if (new Set(ports).size !== ports.length) {
      throw new BadRequestException('REST API, game, and query ports must be distinct.');
    }
  }

  private async validateNoConflicts(
    dto: Pick<UpsertServerInstanceDto, 'installationDirectory' | 'restApiPort' | 'gamePort' | 'queryPort'>,
    existingId?: string,
  ): Promise<void> {
    const where: Prisma.ServerInstanceWhereInput = {
      OR: [
        { installationDirectory: dto.installationDirectory },
        { restApiPort: dto.restApiPort },
        { gamePort: dto.gamePort },
        { queryPort: dto.queryPort },
      ],
    };
    if (existingId) {
      where.id = { not: existingId };
    }
    const conflicts = await this.prisma.serverInstance.findMany({ where });
    if (conflicts.length) {
      throw new BadRequestException('Another server profile already uses one of these paths or ports.');
    }
  }

  private async requireDeployTargetAvailable(path: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info) {
      return;
    }
    if (!info.isDirectory()) {
      throw new BadRequestException('Install directory must be a directory.');
    }
    const entries = await readdir(path);
    if (entries.length > 0 && !this.looksLikePalworldInstall(entries)) {
      throw new BadRequestException('Install directory must be empty for a new deployment.');
    }
  }

  private looksLikePalworldInstall(entries: string[]): boolean {
    const names = new Set(entries.map((entry) => entry.toLowerCase()));
    return names.has('palserver.exe') || names.has('steamapps') || names.has('pal') || names.has('defaultpalworldsettings.ini');
  }

  private defaultInstallPath(name: string): string {
    return join(this.dataDirectory(), 'servers', this.sanitizeServerFolderName(name));
  }

  private dataDirectory(): string {
    const configured = process.env.PALWARDEN_DATA_DIR?.trim();
    const fallback = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'), 'Palwarden', 'data');
    return this.resolveInstallPath(configured || fallback);
  }

  private resolveInstallPath(path: string): string {
    return isAbsolute(path) ? path : resolve(path);
  }

  private sanitizeServerFolderName(name: string): string {
    return name.replace(/[^A-Za-z0-9_. -]/g, '').trim().replace(/^[. ]+|[. ]+$/g, '') || 'Server';
  }

  private async requireFile(path: string, label: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw new BadRequestException(`${label} must exist.`);
    }
  }

  private async requireDirectory(path: string, label: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) {
      throw new BadRequestException(`${label} must exist.`);
    }
  }

  private async requireWritableDirectory(path: string, label: string): Promise<void> {
    await this.requireDirectory(path, label);
    await access(path, constants.W_OK).catch(() => {
      throw new BadRequestException(`${label} must be writable.`);
    });
  }
}
