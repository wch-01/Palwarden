import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
    const args = [
      '+force_install_dir',
      resolvedInstallDirectory,
      '+login',
      'anonymous',
      '+app_update',
      PALWORLD_DEDICATED_SERVER_APP_ID,
      ...(validate ? ['validate'] : []),
      '+quit',
    ];
    onOutput(validate ? 'Validating Palworld Dedicated Server files with SteamCMD...' : 'Updating Palworld Dedicated Server with SteamCMD...');
    let code = await this.run(steamcmd, args, captureOutput);
    if (code !== 0) {
      onOutput('SteamCMD exited during update; retrying once in case it self-updated.');
      code = await this.run(steamcmd, args, captureOutput);
    }
    if (code !== 0) {
      const detail = recentOutput.slice(-8).join(' ');
      throw new BadRequestException(`SteamCMD exited with code ${code}.${detail ? ` Last output: ${detail}` : ''}`);
    }
    if (!(await this.exists(join(resolvedInstallDirectory, 'PalServer.exe')))) {
      throw new BadRequestException('SteamCMD finished, but PalServer.exe was not found in the install directory.');
    }
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
