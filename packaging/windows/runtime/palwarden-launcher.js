const { randomBytes } = require('node:crypto');
const { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const installRoot = resolve(__dirname, '..');
const apiRoot = join(installRoot, 'api');
const webRoot = join(installRoot, 'web');
const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), 'AppData', 'Local');
const dataRoot = process.env.PALWARDEN_DATA_DIR || join(localAppData, 'Palwarden', 'data');
const logRoot = join(dataRoot, 'logs');
const startupLogPath = join(logRoot, 'palwarden-startup.log');
const configPath = join(dataRoot, 'palwarden.env');
const databasePath = join(dataRoot, 'palwarden.db');
const port = process.env.PALWARDEN_PORT || '3333';
const host = process.env.PALWARDEN_HOST || '127.0.0.1';

mkdirSync(dataRoot, { recursive: true });
mkdirSync(logRoot, { recursive: true });

process.on('uncaughtException', (error) => {
  writeLog(`Uncaught exception: ${error.stack || error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  writeLog(`Unhandled rejection: ${error?.stack || error}`);
  process.exit(1);
});

const existing = readEnvFile(configPath);
const config = {
  NODE_ENV: 'production',
  DATABASE_URL: existing.DATABASE_URL || `file:${databasePath.replace(/\\/g, '/')}`,
  PALWARDEN_HOST: existing.PALWARDEN_HOST || host,
  PALWARDEN_PORT: existing.PALWARDEN_PORT || port,
  PALWARDEN_COOKIE_SECURE: existing.PALWARDEN_COOKIE_SECURE || 'false',
  PALWARDEN_CORS_ORIGINS: existing.PALWARDEN_CORS_ORIGINS || `http://${host}:${port}`,
  PALWARDEN_MASTER_KEY: existing.PALWARDEN_MASTER_KEY || randomBytes(32).toString('base64'),
  PALWARDEN_DATA_DIR: dataRoot,
  PALWARDEN_WEB_DIST: webRoot,
};

writeEnvFile(configPath, config);
Object.assign(process.env, config);

writeLog(`Starting Palwarden from ${installRoot}`);
writeLog(`Using data directory ${dataRoot}`);
writeLog(`Serving web app from ${webRoot}`);
runPrismaMigrations();
startPalwarden();

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^"|"$/g, '');
        return [key, value];
      }),
  );
}

function writeEnvFile(path, values) {
  mkdirSync(dirname(path), { recursive: true });
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${quoteEnv(value)}`)
    .join('\r\n');
  writeFileSync(path, `${body}\r\n`, 'utf-8');
}

function quoteEnv(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function runPrismaMigrations() {
  writeLog('Running database migrations.');
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const schema = join(apiRoot, 'prisma', 'schema.prisma');
  if (!existsSync(prismaCli)) {
    throw new Error(`Prisma CLI was not packaged at ${prismaCli}. Rebuild the Windows package.`);
  }
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    cwd: apiRoot,
    env: { ...process.env, RUST_LOG: 'info' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Database migration failed with exit code ${result.status}.`);
  }
  writeLog('Database migrations are complete.');
}

function startPalwarden() {
  writeLog('Starting Palwarden API process.');
  const main = join(apiRoot, 'dist', 'main.js');
  if (!existsSync(main)) {
    throw new Error(`Palwarden API build was not packaged at ${main}. Rebuild the Windows package.`);
  }
  const child = spawn(process.execPath, [main], {
    cwd: apiRoot,
    env: process.env,
    stdio: [
      'ignore',
      openSync(join(logRoot, 'palwarden-api.out.log'), 'a'),
      openSync(join(logRoot, 'palwarden-api.err.log'), 'a'),
    ],
  });
  child.on('exit', (code) => {
    writeLog(`Palwarden API process exited with code ${code || 0}.`);
    process.exit(code || 0);
  });
}

function writeLog(message) {
  appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\r\n`, 'utf-8');
}
