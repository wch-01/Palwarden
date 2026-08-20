import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HostNetworkSettings, HostServerStartupSettings, HostStartupSettings, PublicIpDetection } from '@palwarden/shared';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class HostSettingsService {
  private readonly runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  private readonly runValueName = 'Palwarden';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  getNetworkSettings(): HostNetworkSettings {
    const persisted = this.readEnvFile();
    const activeHost = this.config.get<string>('PALWARDEN_HOST') ?? '127.0.0.1';
    const activePort = Number(this.config.get('PALWARDEN_PORT') ?? 3333);
    const configuredHost = persisted.PALWARDEN_HOST ?? activeHost;
    const configuredPort = Number(persisted.PALWARDEN_PORT ?? activePort);
    return {
      active: this.networkBinding(activeHost, activePort),
      configured: this.networkBinding(configuredHost, configuredPort),
      restartRequired: configuredHost !== activeHost || configuredPort !== activePort,
    };
  }

  updateNetworkSettings(input: { webAccessMode: 'localhost' | 'lan'; port?: number; acknowledgeExposure?: boolean }): HostNetworkSettings {
    if (input.webAccessMode === 'lan' && !input.acknowledgeExposure) {
      throw new BadRequestException('Confirm that LAN access should be enabled for this Palwarden host.');
    }
    const current = this.readEnvFile();
    const port = input.port ?? Number(current.PALWARDEN_PORT ?? this.config.get('PALWARDEN_PORT') ?? 3333);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('Port must be between 1 and 65535.');
    }
    const host = input.webAccessMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
    const next = {
      ...current,
      PALWARDEN_HOST: host,
      PALWARDEN_PORT: String(port),
      PALWARDEN_CORS_ORIGINS: `http://127.0.0.1:${port}`,
    };
    this.writeEnvFile(next);
    return this.getNetworkSettings();
  }

  async detectPublicIp(): Promise<PublicIpDetection> {
    const settings = this.getNetworkSettings();
    try {
      const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(6000) });
      if (!response.ok) {
        throw new Error(`Public IP service returned ${response.status}.`);
      }
      const data = (await response.json()) as { ip?: unknown };
      const publicIp = typeof data.ip === 'string' ? data.ip.trim() : '';
      if (!publicIp) {
        throw new Error('Public IP service did not return an address.');
      }
      return {
        publicIp,
        address: `${publicIp}:${settings.active.port}`,
        message: 'Public IP detected. Router and Windows Firewall port forwarding are still required for public play.',
      };
    } catch {
      return {
        publicIp: null,
        address: null,
        message: 'Could not detect the public IP from this host. Enter a WAN IP or DNS name manually after configuring firewall and router forwarding.',
      };
    }
  }

  getStartupSettings(): HostStartupSettings {
    const desiredCommand = this.startupCommand();
    const registeredCommand = this.readStartupCommand();
    const startWithWindows = Boolean(
      registeredCommand && desiredCommand && this.normalizeCommand(registeredCommand) === this.normalizeCommand(desiredCommand),
    );
    const available = process.platform === 'win32' && Boolean(desiredCommand);
    return {
      available,
      startWithWindows,
      registeredCommand,
      desiredCommand,
      message: available
        ? 'Palwarden can register itself for the current Windows user at login.'
        : 'Windows startup is available in the packaged desktop app. Dev mode does not register a startup command.',
    };
  }

  updateStartupSettings(input: { startWithWindows: boolean }): HostStartupSettings {
    if (process.platform !== 'win32') {
      throw new BadRequestException('Windows startup registration is only available on Windows.');
    }
    const desiredCommand = this.startupCommand();
    if (input.startWithWindows && !desiredCommand) {
      throw new BadRequestException('Palwarden does not know the packaged desktop app path. Start Palwarden from the installed desktop app and try again.');
    }
    if (input.startWithWindows) {
      if (!desiredCommand) {
        throw new BadRequestException('Palwarden does not know the packaged desktop app path. Start Palwarden from the installed desktop app and try again.');
      }
      this.writeStartupCommand(desiredCommand);
    } else {
      this.deleteStartupCommand();
    }
    const current = this.readEnvFile();
    this.writeEnvFile({ ...current, PALWARDEN_START_WITH_WINDOWS: String(input.startWithWindows) });
    return this.getStartupSettings();
  }

  async getServerStartupSettings(): Promise<HostServerStartupSettings> {
    const persisted = this.readEnvFile();
    const startServersOnLaunch = this.booleanSetting(
      persisted.PALWARDEN_START_SERVERS_ON_LAUNCH ?? this.config.get('PALWARDEN_START_SERVERS_ON_LAUNCH'),
    );
    const autoStartServerCount = await this.prisma.serverInstance.count({ where: { autoStart: true } });
    return { startServersOnLaunch, autoStartServerCount };
  }

  async updateServerStartupSettings(input: { startServersOnLaunch: boolean }): Promise<HostServerStartupSettings> {
    const current = this.readEnvFile();
    this.writeEnvFile({ ...current, PALWARDEN_START_SERVERS_ON_LAUNCH: String(input.startServersOnLaunch) });
    process.env.PALWARDEN_START_SERVERS_ON_LAUNCH = String(input.startServersOnLaunch);
    return this.getServerStartupSettings();
  }

  private envPath(): string {
    const dataRoot = this.config.get<string>('PALWARDEN_DATA_DIR') ?? process.env.PALWARDEN_DATA_DIR;
    if (dataRoot) {
      return join(dataRoot, 'palwarden.env');
    }
    return join(process.cwd(), '.env');
  }

  private readEnvFile(): Record<string, string> {
    const path = this.envPath();
    if (!existsSync(path)) return {};
    return Object.fromEntries(
      readFileSync(path, 'utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          return [key, value];
        }),
    );
  }

  private writeEnvFile(values: Record<string, string>): void {
    const path = this.envPath();
    mkdirSync(dirname(path), { recursive: true });
    const body = Object.entries(values)
      .map(([key, value]) => `${key}=${this.quoteEnv(value)}`)
      .join('\r\n');
    writeFileSync(path, `${body}\r\n`, 'utf-8');
  }

  private quoteEnv(value: string): string {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  private startupCommand(): string | null {
    const exe = this.config.get<string>('PALWARDEN_DESKTOP_EXE') || process.env.PALWARDEN_DESKTOP_EXE;
    return exe?.trim() ? `"${exe.trim()}"` : null;
  }

  private readStartupCommand(): string | null {
    if (process.platform !== 'win32') return null;
    const result = spawnSync('reg.exe', ['query', this.runKey, '/v', this.runValueName], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status !== 0 || !output.trim()) return null;
    const line = output
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(this.runValueName));
    const match = line?.match(/^Palwarden\s+REG_\w+\s+(.+)$/i);
    return match?.[1]?.trim() || null;
  }

  private writeStartupCommand(command: string): void {
    const result = spawnSync('reg.exe', ['add', this.runKey, '/v', this.runValueName, '/t', 'REG_SZ', '/d', command, '/f'], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new BadRequestException('Windows rejected the startup registration request.');
    }
  }

  private deleteStartupCommand(): void {
    spawnSync('reg.exe', ['delete', this.runKey, '/v', this.runValueName, '/f'], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
    });
  }

  private normalizeCommand(command: string): string {
    return command.trim().replace(/^"|"$/g, '').toLowerCase();
  }

  private booleanSetting(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).toLowerCase() === 'true';
    }
    return false;
  }

  private networkBinding(host: string, port: number): HostNetworkSettings['active'] {
    const webAccessMode = host === '0.0.0.0' ? 'lan' : 'localhost';
    return {
      host,
      port,
      webAccessMode,
      localUrl: `http://127.0.0.1:${port}`,
      lanUrl: webAccessMode === 'lan' ? `http://<this-pc-lan-ip>:${port}` : null,
    };
  }
}
