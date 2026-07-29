import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HostNetworkSettings } from '@palwarden/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

@Injectable()
export class HostSettingsService {
  constructor(private readonly config: ConfigService) {}

  getNetworkSettings(): HostNetworkSettings {
    const persisted = this.readEnvFile();
    const activeHost = this.config.get<string>('PALWARDEN_HOST') ?? '127.0.0.1';
    const activePort = Number(this.config.get('PALWARDEN_PORT') ?? 3333);
    const desiredHost = persisted.PALWARDEN_HOST ?? activeHost;
    const desiredPort = Number(persisted.PALWARDEN_PORT ?? activePort);
    const webAccessMode = desiredHost === '0.0.0.0' ? 'lan' : 'localhost';
    return {
      host: desiredHost,
      port: desiredPort,
      webAccessMode,
      localUrl: `http://127.0.0.1:${desiredPort}`,
      lanUrl: webAccessMode === 'lan' ? `http://<this-pc-lan-ip>:${desiredPort}` : null,
      restartRequired: desiredHost !== activeHost || desiredPort !== activePort,
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
}
