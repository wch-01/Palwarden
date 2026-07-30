import { app, BrowserWindow, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

let backend: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;
let port = process.env.PALWARDEN_PORT || '';
let localUrl = '';
let desktopUrl = '';

app.setName('Palwarden');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
}

void app.whenReady().then(async () => {
  try {
    port = port || String(await findOpenPort());
    localUrl = `http://127.0.0.1:${port}`;
    desktopUrl = `${localUrl}/dashboard`;
    startBackend();
    await waitForPalwarden();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Palwarden failed to start', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  if (backend && !backend.killed) {
    backend.kill();
  }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: 'Palwarden',
    icon: appIconPath(),
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void mainWindow.loadURL(desktopUrl);
}

function startBackend(): void {
  const runtimeRoot = runtimePath();
  const nodePath = join(runtimeRoot, 'node', 'node.exe');
  const launcherPath = join(runtimeRoot, 'launcher', 'palwarden-launcher.js');
  if (!existsSync(nodePath) || !existsSync(launcherPath)) {
    throw new Error(`Palwarden runtime was not packaged correctly at ${runtimeRoot}.`);
  }

  const dataRoot = process.env.PALWARDEN_DATA_DIR || join(app.getPath('userData'), 'data');
  mkdirSync(dataRoot, { recursive: true });
  backend = spawn(nodePath, [launcherPath], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      PALWARDEN_DATA_DIR: dataRoot,
      PALWARDEN_PORT: port,
      PALWARDEN_DESKTOP: 'true',
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  backend.on('exit', (code) => {
    if (!quitting) {
      dialog.showErrorBox('Palwarden stopped', `The Palwarden backend exited with code ${code ?? 0}.`);
      app.quit();
    }
  });
}

async function waitForPalwarden(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${localUrl}/api/auth/state`);
      if (response.ok) return;
    } catch {
      await sleep(800);
    }
  }
  throw new Error(`Palwarden did not respond at ${localUrl} within 90 seconds.`);
}

function runtimePath(): string {
  if (!app.isPackaged) {
    return join(app.getAppPath(), '..', '..', 'dist', 'windows', 'Palwarden');
  }
  return join(process.resourcesPath, 'palwarden-runtime');
}

function appIconPath(): string {
  return join(app.getAppPath(), 'assets', 'icon.ico');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findOpenPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolvePort(address.port);
          return;
        }
        reject(new Error('Could not allocate a local Palwarden port.'));
      });
    });
  });
}
