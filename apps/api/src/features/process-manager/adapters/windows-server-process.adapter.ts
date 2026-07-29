import { BadRequestException, Injectable } from '@nestjs/common';
import type { ServerInstance } from '@prisma/client';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import type { RuntimeState } from '@palwarden/shared';
import type { ServerProcessAdapter, ServerProcessResult, ServerProcessStatus } from '../models/server-process-adapter';

interface TrackedProcess {
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  state: RuntimeState;
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
  private readonly processes = new Map<string, TrackedProcess>();
  private readonly buffers = new Map<string, string[]>();
  private readonly cpuSamples = new Map<number, CpuSample>();
  private readonly cpuWindows = new Map<number, CpuWindow>();

  async start(instance: ServerInstance): Promise<ServerProcessResult> {
    const existing = this.processes.get(instance.id);
    if ((existing && existing.child.exitCode === null) || (await this.findInstanceProcesses(instance)).length) {
      throw new BadRequestException('This server instance is already running.');
    }
    const args = buildPalServerLaunchArguments(instance);
    const executablePath = this.resolveLaunchExecutable(instance);
    const child = spawn(executablePath, args, {
      cwd: instance.workingDirectory,
      shell: false,
      windowsHide: true,
    });
    const tracked: TrackedProcess = { child, startedAt: Date.now(), state: 'starting' };
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
    if (!tracked || tracked.child.exitCode !== null) {
      return Promise.resolve();
    }
    tracked.state = 'stopping';
    this.pushLog(instance.id, 'Graceful shutdown requested through Palworld REST API.');
    return Promise.resolve();
  }

  forceStop(instance: ServerInstance): Promise<void> {
    const tracked = this.processes.get(instance.id);
    if (!tracked || tracked.child.exitCode !== null) {
      return Promise.resolve();
    }
    tracked.state = 'stopping';
    tracked.child.kill('SIGTERM');
    this.pushLog(instance.id, 'Force stop requested.');
    return Promise.resolve();
  }

  getStatus(instanceId: string): ServerProcessStatus {
    const tracked = this.processes.get(instanceId);
    if (!tracked) {
      return { state: 'stopped', uptimeSeconds: 0 };
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
      return tracked;
    }
    const processes = await this.findInstanceProcesses(instance);
    if (!processes.length) {
      return tracked;
    }
    return {
      state: 'running',
      ...(processes[0] ? { pid: processes[0].pid } : {}),
      uptimeSeconds: 0,
      ...(processes[0] ? this.hostMetrics(processes[0].pid) : {}),
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

  private async findInstanceProcesses(instance: ServerInstance): Promise<Array<{ pid: number }>> {
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      'Get-CimInstance Win32_Process',
      '| Where-Object { @("PalServer.exe","PalServer-Win64-Shipping-Cmd.exe") -contains $_.Name }',
      '| Select-Object ProcessId,ExecutablePath,CommandLine',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const output = await this.runPowerShell(script);
    if (!output.trim()) {
      return [];
    }
    let records: Array<{ ProcessId?: number; ExecutablePath?: string; CommandLine?: string }> = [];
    try {
      const parsed = JSON.parse(output) as unknown;
      records = Array.isArray(parsed) ? records.concat(parsed as typeof records) : [parsed as (typeof records)[number]];
    } catch {
      return [];
    }
    const root = this.pathKey(instance.installationDirectory);
    return records
      .filter((record) => {
        const name = record.ExecutablePath?.split(/[\\/]/).pop()?.toLowerCase() ?? '';
        if (name && !PALWORLD_PROCESS_NAMES.has(name)) {
          return false;
        }
        return (
          (record.ExecutablePath ? this.pathIsInside(record.ExecutablePath, root) : false) ||
          (record.CommandLine ? this.commandLineIncludesRoot(record.CommandLine, root) : false)
        );
      })
      .map((record) => ({ pid: record.ProcessId ?? 0 }))
      .filter((record) => record.pid > 0);
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
    return this.pathKey(value).startsWith(`${root}\\`) || this.pathKey(value) === root;
  }

  private commandLineIncludesRoot(value: string, root: string): boolean {
    return value.replace(/\//g, '\\').toLowerCase().includes(root);
  }

  private pathKey(path: string): string {
    return normalize(resolve(path)).toLowerCase();
  }
}
