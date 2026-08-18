import { BadRequestException, Injectable } from '@nestjs/common';
import type { ServerInstance } from '@prisma/client';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import type { RuntimeState } from '@palwarden/shared';
import type { ServerProcessAdapter, ServerProcessResult, ServerProcessStatus } from '../models/server-process-adapter';

interface TrackedProcess {
  kind: 'spawned';
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  state: RuntimeState;
}

interface RecoveredProcess {
  kind: 'recovered';
  pid: number;
  startedAt: number;
  state: RuntimeState;
}

type ManagedProcess = TrackedProcess | RecoveredProcess;

interface WindowsProcessRecord {
  pid: number;
  executablePath: string;
  commandLine: string;
  creationDate: string;
}

interface CpuSample {
  cpuSeconds: number;
  sampledAt: number;
}

interface CpuWindow {
  values: number[];
  peak: number;
}

const PALWORLD_PROCESS_NAMES = new Set(['palserver.exe', 'palserver-win64-shipping-cmd.exe']);
const DEFAULT_PERFORMANCE_ARGS = ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS'];

export function buildPalServerLaunchArguments(instance: ServerInstance): string[] {
  const configured = JSON.parse(instance.launchArgumentsJson) as string[];
  const args = [...configured];
  const hasArg = (name: string) => args.some((arg) => arg.toLowerCase().startsWith(name.toLowerCase()));

  if (!hasArg('-port=')) {
    args.unshift(`-port=${instance.gamePort}`);
  }
  if (!hasArg('-queryport=')) {
    args.push(`-queryport=${instance.queryPort}`);
  }
  for (const arg of DEFAULT_PERFORMANCE_ARGS) {
    if (!args.some((existing) => existing.toLowerCase() === arg.toLowerCase())) {
      args.push(arg);
    }
  }
  return args;
}

@Injectable()
export class WindowsServerProcessAdapter implements ServerProcessAdapter {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly buffers = new Map<string, string[]>();
  private readonly cpuSamples = new Map<number, CpuSample>();
  private readonly cpuWindows = new Map<number, CpuWindow>();

  async start(instance: ServerInstance): Promise<ServerProcessResult> {
    const existing = this.processes.get(instance.id);
    if (existing?.kind === 'spawned' && this.isManagedProcessActive(existing)) {
      throw new BadRequestException('This server instance is already running.');
    }
    if (existing?.kind === 'recovered') {
      if (await this.processStillMatchesInstance(instance, existing.pid)) {
        throw new BadRequestException('This server instance is already running.');
      }
      this.processes.delete(instance.id);
      this.pushLog(instance.id, `Discarded stale recovered process ${existing.pid} before start.`);
    }
    if ((await this.findInstanceProcesses(instance)).length) {
      throw new BadRequestException('This server instance is already running.');
    }
    const args = buildPalServerLaunchArguments(instance);
    const executablePath = this.resolveLaunchExecutable(instance);
    const child = spawn(executablePath, args, {
      cwd: instance.workingDirectory,
      detached: true,
      shell: false,
      windowsHide: true,
    });
    child.unref();
    const tracked: TrackedProcess = { kind: 'spawned', child, startedAt: Date.now(), state: 'starting' };
    this.processes.set(instance.id, tracked);
    this.pushLog(instance.id, `Started process ${child.pid ?? 'unknown'} with ${executablePath} ${args.join(' ')}.`);
    child.stdout.on('data', (chunk: Buffer) => void this.writeOutput(instance.id, 'stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => void this.writeOutput(instance.id, 'stderr', chunk));
    child.on('exit', (code) => {
      tracked.state = code === 0 ? 'stopped' : 'failed';
      this.pushLog(instance.id, `Process exited with code ${code ?? 'unknown'}.`);
    });
    return { pid: child.pid ?? 0, state: tracked.state };
  }

  requestGracefulStop(instance: ServerInstance): Promise<void> {
    const tracked = this.processes.get(instance.id);
    if (!tracked || !this.isManagedProcessActive(tracked)) {
      return Promise.resolve();
    }
    tracked.state = 'stopping';
    this.pushLog(instance.id, 'Graceful shutdown requested through Palworld REST API.');
    return Promise.resolve();
  }

  forceStop(instance: ServerInstance): Promise<void> {
    const tracked = this.processes.get(instance.id);
    if (!tracked || !this.isManagedProcessActive(tracked)) {
      return Promise.resolve();
    }
    tracked.state = 'stopping';
    if (tracked.kind === 'spawned') {
      tracked.child.kill('SIGTERM');
      this.pushLog(instance.id, 'Force stop requested.');
      return Promise.resolve();
    }
    return this.forceStopRecovered(instance, tracked.pid);
  }

  getStatus(instanceId: string): ServerProcessStatus {
    const tracked = this.processes.get(instanceId);
    if (!tracked) {
      return { state: 'stopped', uptimeSeconds: 0 };
    }
    if (tracked.kind === 'recovered') {
      return {
        state: tracked.state,
        pid: tracked.pid,
        uptimeSeconds: Math.floor((Date.now() - tracked.startedAt) / 1000),
        ...this.hostMetrics(tracked.pid),
      };
    }
    if (tracked.child.exitCode !== null) {
      return { state: tracked.state, ...(tracked.child.pid ? { pid: tracked.child.pid } : {}), uptimeSeconds: 0 };
    }
    const state = tracked.state === 'starting' && Date.now() - tracked.startedAt > 15000 ? 'running' : tracked.state;
    return {
      state,
      ...(tracked.child.pid ? { pid: tracked.child.pid } : {}),
      uptimeSeconds: Math.floor((Date.now() - tracked.startedAt) / 1000),
      ...this.hostMetrics(tracked.child.pid),
    };
  }

  assertStopped(instanceId: string): Promise<void> {
    const status = this.getStatus(instanceId);
    if (status.state === 'running' || status.state === 'starting' || status.state === 'stopping') {
      return Promise.reject(new BadRequestException('Stop the server before changing or deleting this profile.'));
    }
    return Promise.resolve();
  }

  logs(instanceId: string): string[] {
    return this.buffers.get(instanceId) ?? [];
  }

  async recoverStatus(instance: ServerInstance): Promise<ServerProcessStatus> {
    const tracked = this.getStatus(instance.id);
    if (tracked.state === 'running' || tracked.state === 'starting' || tracked.state === 'stopping') {
      if (tracked.pid && !(await this.processStillMatchesInstance(instance, tracked.pid))) {
        this.processes.delete(instance.id);
        this.pushLog(instance.id, `Discarded stale recovered process ${tracked.pid}; it no longer matches this server profile.`);
      } else {
        return tracked;
      }
    }
    const current = this.processes.get(instance.id);
    if (current?.kind === 'spawned' && current.child.exitCode !== null) {
      return tracked;
    }
    const processes = await this.findInstanceProcesses(instance);
    if (!processes.length) {
      const stale = this.processes.get(instance.id);
      if (stale?.kind === 'recovered') {
        this.processes.delete(instance.id);
        this.pushLog(instance.id, `Recovered process ${stale.pid} is no longer running.`);
      }
      return { state: stale?.state === 'stopping' ? 'stopped' : 'stopped', uptimeSeconds: 0 };
    }
    const recovered = this.trackRecoveredProcess(instance, processes[0]!);
    return {
      state: recovered.state,
      pid: recovered.pid,
      uptimeSeconds: Math.floor((Date.now() - recovered.startedAt) / 1000),
      ...this.hostMetrics(recovered.pid),
    };
  }

  private async writeOutput(instanceId: string, stream: 'stdout' | 'stderr', chunk: Buffer): Promise<void> {
    const text = chunk.toString('utf8');
    this.pushLog(instanceId, `[${stream}] ${text.trimEnd()}`);
    const path = join(process.cwd(), 'logs', `${instanceId}.log`);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `[${new Date().toISOString()}] [${stream}] ${text}`);
  }

  private pushLog(instanceId: string, line: string): void {
    const lines = this.buffers.get(instanceId) ?? [];
    lines.push(`[${new Date().toISOString()}] ${line}`);
    this.buffers.set(instanceId, lines.slice(-500));
  }

  private async findInstanceProcesses(instance: ServerInstance): Promise<WindowsProcessRecord[]> {
    const getProcessRecords = await this.findInstanceProcessesWithGetProcess();
    const portRecords = await this.findInstanceProcessesByPorts(instance);
    const cimRecords = getProcessRecords.length || portRecords.length ? [] : await this.findInstanceProcessesWithCim();
    const fallbackRecords = this.dedupeProcessRecords([...getProcessRecords, ...portRecords, ...cimRecords]);
    const root = this.pathKey(instance.installationDirectory);
    return fallbackRecords
      .filter((record) => {
        const name = record.executablePath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
        if (name && !PALWORLD_PROCESS_NAMES.has(name)) {
          return false;
        }
        return (
          (record.executablePath ? this.pathIsInside(record.executablePath, root) : false) ||
          (record.commandLine ? this.commandLineIncludesRoot(record.commandLine, root) : false)
        );
      })
      .filter((record) => record.pid > 0);
  }

  private async findInstanceProcessesByPorts(instance: ServerInstance): Promise<WindowsProcessRecord[]> {
    const ports = [instance.restApiPort, instance.gamePort, instance.queryPort]
      .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
      .join(',');
    if (!ports) {
      return [];
    }
    const script = `$ports = @(${ports}); $ids = Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -ExpandProperty OwningProcess -Unique; if ($ids) { Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime,ProcessName | ConvertTo-Json -Compress }`;
    const output = await this.runPowerShell(script);
    if (!output.trim()) {
      return [];
    }
    let records: Array<{ Id?: number; Path?: string; StartTime?: string; ProcessName?: string }> = [];
    try {
      const parsed = JSON.parse(output) as unknown;
      records = Array.isArray(parsed) ? records.concat(parsed as typeof records) : [parsed as (typeof records)[number]];
    } catch {
      return [];
    }
    return records
      .map((record) => ({
        pid: record.Id ?? 0,
        executablePath: record.Path ?? '',
        commandLine: record.Path ? `"${record.Path}"` : record.ProcessName ?? '',
        creationDate: record.StartTime ?? '',
      }))
      .filter((record) => record.pid > 0);
  }

  private dedupeProcessRecords(records: WindowsProcessRecord[]): WindowsProcessRecord[] {
    const byPid = new Map<number, WindowsProcessRecord>();
    for (const record of records) {
      if (!record.pid) {
        continue;
      }
      const existing = byPid.get(record.pid);
      if (!existing || (!existing.executablePath && record.executablePath)) {
        byPid.set(record.pid, record);
      }
    }
    return [...byPid.values()];
  }

  private async findInstanceProcessesWithCim(): Promise<WindowsProcessRecord[]> {
    const script = [
      '$ErrorActionPreference = "SilentlyContinue";',
      'Get-CimInstance Win32_Process',
      '| Where-Object { @("PalServer.exe","PalServer-Win64-Shipping-Cmd.exe") -contains $_.Name }',
      '| Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const output = await this.runPowerShell(script);
    if (!output.trim()) {
      return [];
    }
    let records: Array<{ ProcessId?: number; ExecutablePath?: string; CommandLine?: string; CreationDate?: string }> = [];
    try {
      const parsed = JSON.parse(output) as unknown;
      records = Array.isArray(parsed) ? records.concat(parsed as typeof records) : [parsed as (typeof records)[number]];
    } catch {
      return [];
    }
    return records
      .map((record) => ({
        pid: record.ProcessId ?? 0,
        executablePath: record.ExecutablePath ?? '',
        commandLine: record.CommandLine ?? '',
        creationDate: record.CreationDate ?? '',
      }))
      .filter((record) => record.pid > 0);
  }

  private async findInstanceProcessesWithGetProcess(): Promise<WindowsProcessRecord[]> {
    const script = [
      '$ErrorActionPreference = "SilentlyContinue";',
      'Get-Process -Name PalServer,PalServer-Win64-Shipping-Cmd',
      '| Select-Object Id,Path,StartTime,ProcessName',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const output = await this.runPowerShell(script);
    if (!output.trim()) {
      return [];
    }
    let records: Array<{ Id?: number; Path?: string; StartTime?: string; ProcessName?: string }> = [];
    try {
      const parsed = JSON.parse(output) as unknown;
      records = Array.isArray(parsed) ? records.concat(parsed as typeof records) : [parsed as (typeof records)[number]];
    } catch {
      return [];
    }
    return records
      .map((record) => ({
        pid: record.Id ?? 0,
        executablePath: record.Path ?? '',
        commandLine: record.Path ? `"${record.Path}"` : record.ProcessName ?? '',
        creationDate: record.StartTime ?? '',
      }))
      .filter((record) => record.pid > 0);
  }

  private isManagedProcessActive(process: ManagedProcess): boolean {
    return process.kind === 'recovered' || process.child.exitCode === null;
  }

  private trackRecoveredProcess(instance: ServerInstance, record: WindowsProcessRecord): RecoveredProcess {
    const existing = this.processes.get(instance.id);
    const startedAt = this.parseWindowsCimDate(record.creationDate) ?? (existing?.kind === 'recovered' ? existing.startedAt : Date.now());
    const state = existing?.state === 'stopping' ? 'stopping' : 'running';
    const recovered: RecoveredProcess = { kind: 'recovered', pid: record.pid, startedAt, state };
    this.processes.set(instance.id, recovered);
    if (existing?.kind !== 'recovered' || existing.pid !== record.pid) {
      this.pushLog(instance.id, `Recovered running Palworld process ${record.pid} from ${record.executablePath || 'Windows process list'}.`);
      this.pushLog(instance.id, 'Live stdout/stderr capture is only available for processes launched by Palwarden.');
    }
    return recovered;
  }

  private async processStillMatchesInstance(instance: ServerInstance, pid: number): Promise<boolean> {
    return (await this.findInstanceProcesses(instance)).some((record) => record.pid === pid);
  }

  private async forceStopRecovered(instance: ServerInstance, pid: number): Promise<void> {
    if (!(await this.processStillMatchesInstance(instance, pid))) {
      this.processes.delete(instance.id);
      this.pushLog(instance.id, `Force stop skipped because recovered process ${pid} no longer matches this server profile.`);
      return;
    }
    const script = `Stop-Process -Id ${pid} -Force -ErrorAction Stop`;
    await this.runPowerShell(script);
    this.pushLog(instance.id, `Force stop requested for recovered process ${pid}.`);
  }

  private parseWindowsCimDate(value: string): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    const timestamp = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private hostMetrics(
    pid: number | undefined,
  ): Pick<
    ServerProcessStatus,
    'hostCpuPercent' | 'hostMemoryMb' | 'processCpuAveragePercent' | 'processCpuPeakPercent' | 'processPrivateMemoryMb' | 'processPeakMemoryMb'
  > {
    if (!pid) {
      return {
        hostCpuPercent: null,
        hostMemoryMb: null,
        processCpuAveragePercent: null,
        processCpuPeakPercent: null,
        processPrivateMemoryMb: null,
        processPeakMemoryMb: null,
      };
    }
    return this.windowsProcessMetrics(pid);
  }

  private windowsProcessMetrics(
    pid: number,
  ): Pick<
    ServerProcessStatus,
    'hostCpuPercent' | 'hostMemoryMb' | 'processCpuAveragePercent' | 'processCpuPeakPercent' | 'processPrivateMemoryMb' | 'processPeakMemoryMb'
  > {
    const empty = {
      hostCpuPercent: null,
      hostMemoryMb: null,
      processCpuAveragePercent: null,
      processCpuPeakPercent: null,
      processPrivateMemoryMb: null,
      processPeakMemoryMb: null,
    };
    const script = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object CPU,WorkingSet64,PrivateMemorySize64,PeakWorkingSet64 | ConvertTo-Json -Compress`;
    const output = this.runPowerShellSync(script);
    if (!output.trim()) {
      return empty;
    }
    try {
      const record = JSON.parse(output) as { CPU?: number; WorkingSet64?: number; PrivateMemorySize64?: number; PeakWorkingSet64?: number };
      const now = Date.now();
      const previous = this.cpuSamples.get(pid);
      const cpuSeconds = Number(record.CPU ?? 0);
      this.cpuSamples.set(pid, { cpuSeconds, sampledAt: now });
      const elapsedSeconds = previous ? (now - previous.sampledAt) / 1000 : 0;
      const processCpuPercent = previous && elapsedSeconds > 0 ? ((cpuSeconds - previous.cpuSeconds) / elapsedSeconds) * 100 : null;
      const hostCpuPercent = processCpuPercent === null ? null : Math.max(0, Math.min(100, processCpuPercent));
      const cpuWindow = this.recordCpuValue(pid, hostCpuPercent);
      return {
        hostCpuPercent: hostCpuPercent === null ? null : Math.round(hostCpuPercent * 10) / 10,
        hostMemoryMb: record.WorkingSet64 ? Math.round((record.WorkingSet64 / 1024 / 1024) * 10) / 10 : null,
        processCpuAveragePercent: cpuWindow.average,
        processCpuPeakPercent: cpuWindow.peak,
        processPrivateMemoryMb: record.PrivateMemorySize64 ? Math.round((record.PrivateMemorySize64 / 1024 / 1024) * 10) / 10 : null,
        processPeakMemoryMb: record.PeakWorkingSet64 ? Math.round((record.PeakWorkingSet64 / 1024 / 1024) * 10) / 10 : null,
      };
    } catch {
      return empty;
    }
  }

  private recordCpuValue(pid: number, value: number | null): { average: number | null; peak: number | null } {
    const window = this.cpuWindows.get(pid) ?? { values: [], peak: 0 };
    if (value !== null && Number.isFinite(value)) {
      window.values = [...window.values, value].slice(-20);
      window.peak = Math.max(window.peak, value);
      this.cpuWindows.set(pid, window);
    }
    if (!window.values.length) {
      return { average: null, peak: null };
    }
    return {
      average: Math.round((window.values.reduce((sum, item) => sum + item, 0) / window.values.length) * 10) / 10,
      peak: Math.round(window.peak * 10) / 10,
    };
  }

  private runPowerShellSync(script: string): string {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    return result.stdout ?? '';
  }

  private runPowerShell(script: string): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
        shell: false,
        windowsHide: true,
      });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', () => resolve(''));
      child.on('exit', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }

  private resolveLaunchExecutable(instance: ServerInstance): string {
    if (basename(instance.executablePath).toLowerCase() !== 'palserver.exe') {
      return instance.executablePath;
    }
    const directServerExecutable = join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64', 'PalServer-Win64-Shipping-Cmd.exe');
    return existsSync(directServerExecutable) ? directServerExecutable : instance.executablePath;
  }

  private pathIsInside(value: string, root: string): boolean {
    const key = this.pathKey(value);
    const normalizedRoot = root.endsWith('\\') ? root : `${root}\\`;
    return key === root || key.startsWith(normalizedRoot);
  }

  private commandLineIncludesRoot(value: string, root: string): boolean {
    return value.replace(/\//g, '\\').toLowerCase().includes(root);
  }

  private pathKey(path: string): string {
    return normalize(resolve(path)).toLowerCase();
  }
}
