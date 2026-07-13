import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const PALWORLD_DEDICATED_SERVER_APP_ID = '2394010';

@Injectable()
export class SteamCmdService {
  async installPalworldServer(installDirectory: string, onOutput: (line: string) => void): Promise<void> {
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
      'validate',
      '+quit',
    ];
    let code = await this.run(steamcmd, args, captureOutput);
    if (code !== 0) {
      onOutput('SteamCMD exited during install; retrying once in case it self-updated.');
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
