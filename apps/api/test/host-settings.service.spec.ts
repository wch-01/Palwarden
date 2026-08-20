import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/core/database/prisma.service';
import { HostSettingsService } from '../src/features/settings/services/host-settings.service';

describe('HostSettingsService network settings', () => {
  let dataRoot: string | undefined;

  afterEach(() => {
    if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
    dataRoot = undefined;
  });

  it('reports the active listener separately from a pending configured port', () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'palwarden-host-settings-'));
    writeFileSync(
      join(dataRoot, 'palwarden.env'),
      'PALWARDEN_HOST="0.0.0.0"\r\nPALWARDEN_PORT="59544"\r\n',
      'utf8',
    );
    const service = new HostSettingsService(
      new ConfigService({
        PALWARDEN_HOST: '0.0.0.0',
        PALWARDEN_PORT: 62181,
        PALWARDEN_DATA_DIR: dataRoot,
      }),
      {} as PrismaService,
    );

    expect(service.getNetworkSettings()).toEqual({
      active: {
        host: '0.0.0.0',
        port: 62181,
        webAccessMode: 'lan',
        localUrl: 'http://127.0.0.1:62181',
        lanUrl: 'http://<this-pc-lan-ip>:62181',
      },
      configured: {
        host: '0.0.0.0',
        port: 59544,
        webAccessMode: 'lan',
        localUrl: 'http://127.0.0.1:59544',
        lanUrl: 'http://<this-pc-lan-ip>:59544',
      },
      restartRequired: true,
    });
  });
});
