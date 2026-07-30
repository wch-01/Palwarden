import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const PALWORLD_DEDICATED_SERVER_APP_ID = '2394010';

export interface SteamAppUpdateAvailability {
  installedBuildId: string | null;
  latestBuildId: string | null;
  updateAvailable: boolean;
}

@Injectable()
export class SteamCmdService {
  private latestPublicBuildCache: { buildId: string | null; expiresAt: number } | null = null;

  async installPalworldServer(installDirectory: string, onOutput: (line: string) => void): Promise<void> {
    await this.updatePalworldServer(installDirectory, onOutput, true);
  }

  async updatePalworldServer(installDirectory: string, onOutput: (line: string) => void, validate = false): Promise<void> {
    const steamcmd = await this.ensureSteamCmd(onOutput);
    const resolvedInstallDirectory = this.resolvePath(installDirectory);
    await mkdir(resolvedInstallDirectory, { recursive: true });
    const recentOutput: string[] = [];
    const captureOutput = (line: string) => {
      recentOutput.push(line);
      if (recentOutput.length > 20) {
        recentOutput.shift();
      }
      onOutput(line);
    };
    const args = this.appUpdateArgs(resolvedInstallDirectory, validate);
    onOutput(validate ? 'Validating Palworld Dedicated Server files with SteamCMD...' : 'Updating Palworld Dedicated Server with SteamCMD...');
    let code = await this.run(steamcmd, args, captureOutput);
    if (code !== 0) {
      onOutput('SteamCMD exited during update; retrying once in case it self-updated.');
      code = await this.run(steamcmd, args, captureOutput);
    }
    if (code !== 0 && this.looksLikeSteamManifestFailure(recentOutput)) {
      const repaired = await this.backupAppManifest(resolvedInstallDirectory, onOutput);
      if (repaired) {
        onOutput('SteamCMD app metadata looked stale. Palwarden backed up the Steam app manifest and is retrying with validation.');
        code = await this.run(steamcmd, this.appUpdateArgs(resolvedInstallDirectory, true), captureOutput);
      }
    }
    if (code !== 0) {
      throw new BadRequestException(this.formatSteamCmdFailure(code, recentOutput));
    }
    if (!(await this.exists(join(resolvedInstallDirectory, 'PalServer.exe')))) {
      throw new BadRequestException('SteamCMD finished, but PalServer.exe was not found in the install directory.');
    }
  }

  private appUpdateArgs(resolvedInstallDirectory: string, validate: boolean): string[] {
    return [
      '+force_install_dir',
      resolvedInstallDirectory,
      '+login',
      'anonymous',
      '+app_update',
      PALWORLD_DEDICATED_SERVER_APP_ID,
      ...(validate ? ['validate'] : []),
      '+quit',
    ];
  }

  async updateAvailability(installDirectory: string): Promise<SteamAppUpdateAvailability> {
    const [installedBuildId, latestBuildId] = await Promise.all([
      this.installedBuildId(installDirectory),
      this.latestPublicBuildId(),
    ]);
    return {
      installedBuildId,
      latestBuildId,
      updateAvailable: this.isNewerBuild(latestBuildId, installedBuildId),
    };
  }

  private async ensureSteamCmd(onOutput: (line: string) => void): Promise<string> {
    const directory = join(this.dataDirectory(), 'steamcmd');
    const exe = join(directory, 'steamcmd.exe');
    if (await this.exists(exe)) {
      return exe;
    }

    await mkdir(directory, { recursive: true });
    const zipPath = join(directory, 'steamcmd.zip');
    onOutput('Downloading SteamCMD...');
    const response = await fetch(STEAMCMD_URL);
    if (!response.ok || !response.body) {
      throw new BadRequestException(`Could not download SteamCMD: HTTP ${response.status}.`);
    }
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

    onOutput('Extracting SteamCMD...');
    const code = await this.run('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', zipPath, '-DestinationPath', directory, '-Force'], onOutput);
    if (code !== 0 || !(await this.exists(exe))) {
      throw new BadRequestException('SteamCMD extraction failed.');
    }

    onOutput('Priming SteamCMD...');
    await this.run(exe, ['+quit'], onOutput);
    return exe;
  }

  private dataDirectory(): string {
    const configured = process.env.PALWARDEN_DATA_DIR?.trim();
    const fallback = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'), 'Palwarden', 'data');
    return this.resolvePath(configured || fallback);
  }

  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : resolve(path);
  }

  private async exists(path: string): Promise<boolean> {
    return Boolean(await stat(path).catch(() => null));
  }

  private async installedBuildId(installDirectory: string): Promise<string | null> {
    const manifest = join(this.resolvePath(installDirectory), 'steamapps', `appmanifest_${PALWORLD_DEDICATED_SERVER_APP_ID}.acf`);
    const text = await readFile(manifest, 'utf8').catch(() => '');
    return this.matchBuildId(text);
  }

  private async latestPublicBuildId(): Promise<string | null> {
    if (this.latestPublicBuildCache && this.latestPublicBuildCache.expiresAt > Date.now()) {
      return this.latestPublicBuildCache.buildId;
    }
    const steamcmd = await this.ensureSteamCmd(() => undefined);
    const output: string[] = [];
    const code = await this.run(
      steamcmd,
      ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', PALWORLD_DEDICATED_SERVER_APP_ID, '+quit'],
      (line) => output.push(line),
    );
    if (code !== 0) {
      return null;
    }
    const text = output.join('\n');
    const buildId = /"branches"\s*\{[\s\S]*?"public"\s*\{[\s\S]*?"buildid"\s*"(\d+)"/i.exec(text)?.[1] ?? null;
    this.latestPublicBuildCache = { buildId, expiresAt: Date.now() + 5 * 60 * 1000 };
    return buildId;
  }

  private matchBuildId(text: string): string | null {
    return /"buildid"\s*"(\d+)"/i.exec(text)?.[1] ?? null;
  }

  private isNewerBuild(latestBuildId: string | null, installedBuildId: string | null): boolean {
    if (!latestBuildId || !installedBuildId) {
      return false;
    }
    return Number.parseInt(latestBuildId, 10) > Number.parseInt(installedBuildId, 10);
  }

  private looksLikeSteamManifestFailure(recentOutput: string[]): boolean {
    const text = recentOutput.join('\n');
    return /state is 0x6/i.test(text) || /Missing configuration/i.test(text) || /Failed downloading \d+ manifests/i.test(text);
  }

  private async backupAppManifest(resolvedInstallDirectory: string, onOutput: (line: string) => void): Promise<boolean> {
    const manifest = join(resolvedInstallDirectory, 'steamapps', `appmanifest_${PALWORLD_DEDICATED_SERVER_APP_ID}.acf`);
    if (!(await this.exists(manifest))) {
      return false;
    }
    const backup = `${manifest}.palwarden-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await rename(manifest, backup);
    onOutput(`Backed up stale Steam app manifest to ${backup}.`);
    return true;
  }

  private formatSteamCmdFailure(code: number | null, recentOutput: string[]): string {
    const detail = recentOutput
      .filter((line) => !/type ['"]?quit['"]? to exit/i.test(line))
      .slice(-12)
      .join('\n');
    const text = recentOutput.join('\n');
    if (/Access Denied/i.test(text) || /Failed downloading \d+ manifests/i.test(text) || /state is 0x6/i.test(text)) {
      return [
        `SteamCMD could not download the Palworld Dedicated Server update manifest for app ${PALWORLD_DEDICATED_SERVER_APP_ID}.`,
        'Steam reported an access or content-server failure, so the update did not complete.',
        'This is usually a SteamCMD or Steam content delivery issue rather than a Palwarden backup problem. Try the update again, or run Validate Files after SteamCMD can reach the depot.',
        detail ? `Recent SteamCMD output:\n${detail}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    return `SteamCMD exited with code ${code}.${detail ? `\n\nRecent SteamCMD output:\n${detail}` : ''}`;
  }

  private run(command: string, args: string[], onOutput: (line: string) => void): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: dirname(command),
        shell: false,
        windowsHide: true,
      });
      const emit = (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.trim()) {
            onOutput(line.trim());
          }
        }
      };
      child.stdout.on('data', emit);
      child.stderr.on('data', emit);
      child.on('error', (error) => {
        onOutput(error.message);
        resolve(1);
      });
      child.on('exit', (code) => resolve(code));
    });
  }
}
