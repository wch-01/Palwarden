import type { DeployJob } from './server-instances.service';

export interface DeployProgressView {
  title: string;
  step: string;
  detail: string;
  percent: number | null;
  log: string[];
  done: boolean;
  failed: boolean;
}

export interface MaintenanceProgressView {
  title: string;
  step: string;
  detail: string;
  percent: number | null;
}

const NOISY_DEPLOY_LINES = [
  /type\s+'quit'\s+to\s+exit/i,
  /steam console client/i,
  /loading steam api/i,
  /redirecting stderr/i,
  /logging directory/i,
  /waiting for client config/i,
  /waiting for user info/i,
  /connecting anonymously to steam public/i,
];

export function deployProgressView(log: string[], status: DeployJob['status'] | 'starting', error: string | null = null): DeployProgressView {
  const visibleLog = cleanDeployLog(log);
  const stepLine = latestMeaningfulLine(visibleLog) ?? 'Preparing deployment...';
  const steamPercent = latestSteamPercent(log);
  const failed = status === 'error' || Boolean(error);
  const done = status === 'done';
  const percent = failed ? null : done ? 100 : progressPercent(visibleLog, steamPercent);
  return {
    title: failed ? 'Install failed' : done ? 'Install complete' : 'Installing server',
    step: failed ? (error ?? stepLine) : stepLabel(stepLine),
    detail: failed ? 'Review the details below before trying again.' : stepDetail(stepLine, steamPercent),
    percent,
    log: visibleLog.slice(-80),
    done,
    failed,
  };
}

export function cleanDeployLog(log: string[]): string[] {
  return log.map((line) => line.trim()).filter((line) => line && !NOISY_DEPLOY_LINES.some((pattern) => pattern.test(line)));
}

export function maintenanceProgressView(
  log: string[],
  status: DeployJob['status'],
  error: string | null,
  label: 'update' | 'validation',
): MaintenanceProgressView {
  const visibleLog = cleanDeployLog(log);
  const stepLine = latestMeaningfulLine(visibleLog) ?? (label === 'update' ? 'Preparing update...' : 'Preparing validation...');
  const steamPercent = latestSteamPercent(log);
  const failed = status === 'error' || Boolean(error);
  const done = status === 'done';
  const action = label === 'update' ? 'Update' : 'Validation';
  return {
    title: failed ? `${action} failed` : done ? `${action} complete` : label === 'update' ? 'Updating Server' : 'Validating Files',
    step: failed ? (error ?? stepLine) : maintenanceStepLabel(stepLine, label),
    detail: failed ? 'Review the error details on the update card.' : maintenanceStepDetail(stepLine, steamPercent),
    percent: failed ? null : done ? 100 : maintenancePercent(visibleLog, steamPercent, label),
  };
}

function latestMeaningfulLine(log: string[]): string | null {
  return [...log].reverse().find((line) => !/^\[[-\s\d%]+\]\s*$/i.test(line)) ?? null;
}

function latestSteamPercent(log: string[]): number | null {
  for (const line of [...log].reverse()) {
    const match = line.match(/\[\s*(\d{1,3})%\s*\]/);
    if (match?.[1]) {
      return Math.min(Math.max(Number(match[1]), 0), 100);
    }
  }
  return null;
}

function progressPercent(log: string[], steamPercent: number | null): number | null {
  if (hasLine(log, /Done\.|complete\./i)) return 100;
  if (hasLine(log, /Starting Palworld server/i)) return 96;
  if (hasLine(log, /Registering server profile/i)) return 92;
  if (hasLine(log, /Writing Palworld configuration/i)) return 86;
  if (hasLine(log, /Installing Palworld Dedicated Server|download|extracting package|installing update|verifying installation/i)) {
    return steamPercent === null ? null : Math.min(82, 18 + Math.round(steamPercent * 0.62));
  }
  if (hasLine(log, /Checking ports|install folder/i)) return 12;
  if (hasLine(log, /Install directory|Preparing|Sending deployment request|Deployment start signal/i)) return 5;
  return null;
}

function maintenancePercent(log: string[], steamPercent: number | null, label: 'update' | 'validation'): number | null {
  if (hasLine(log, /complete\.|Server files validated|Server updated/i)) return 100;
  if (hasLine(log, /Validating installation|Verifying installation/i)) {
    return steamPercent === null ? null : Math.min(95, Math.max(15, steamPercent));
  }
  if (hasLine(log, /Download Complete/i)) return 75;
  if (hasLine(log, /download|Update state/i)) {
    return steamPercent === null ? null : Math.min(75, Math.max(8, steamPercent));
  }
  if (hasLine(log, /preallocat|staging|Installing update|Extracting package/i)) return null;
  if (hasLine(log, /manifest|retrying|backed up/i)) return null;
  if (hasLine(log, /Starting SteamCMD|Preparing|backup/i)) return label === 'update' ? 8 : 10;
  return null;
}

function stepLabel(line: string): string {
  if (/Sending deployment request|Deployment start signal|Preparing/i.test(line)) return 'Starting deployment';
  if (/Checking ports|install folder/i.test(line)) return 'Checking paths and ports';
  if (/Download Complete/i.test(line)) return 'Download complete';
  if (/Downloading|download/i.test(line)) return 'Downloading server files';
  if (/Extracting package/i.test(line)) return 'Extracting server files';
  if (/Installing update/i.test(line)) return 'Installing server files';
  if (/Verifying installation/i.test(line)) return 'Verifying server files';
  if (/Writing Palworld configuration/i.test(line)) return 'Writing server configuration';
  if (/Registering server profile/i.test(line)) return 'Registering server profile';
  if (/Starting Palworld server/i.test(line)) return 'Starting server';
  if (/Done\.|complete\./i.test(line)) return 'Complete';
  return line;
}

function maintenanceStepLabel(line: string, label: 'update' | 'validation'): string {
  if (/backup/i.test(line)) return 'Creating safety backup';
  if (/Broadcasting|shutdown|waiting before update|stopping/i.test(line)) return 'Stopping server for maintenance';
  if (/manifest|app metadata looked stale|backed up/i.test(line)) return 'Repairing Steam metadata';
  if (/retrying/i.test(line)) return 'Retrying SteamCMD';
  if (/Download Complete/i.test(line)) return 'Download complete';
  if (/Downloading|Update state|download/i.test(line)) return 'Downloading server files';
  if (/preallocat|staging/i.test(line)) return 'Preparing downloaded files';
  if (/Extracting package/i.test(line)) return 'Extracting server files';
  if (/Installing update/i.test(line)) return 'Installing server files';
  if (/Validating installation|Verifying installation/i.test(line)) return 'Verifying server files';
  if (/Starting SteamCMD/i.test(line)) return label === 'update' ? 'Starting update' : 'Starting validation';
  if (/complete\./i.test(line)) return 'Complete';
  return line;
}

function stepDetail(line: string, steamPercent: number | null): string {
  if (steamPercent !== null && /download/i.test(line)) return `${steamPercent}% downloaded by SteamCMD.`;
  if (/Extracting package|Installing update|Verifying installation/i.test(line)) return 'SteamCMD is working. This phase may not report a percentage.';
  if (/Writing Palworld configuration/i.test(line)) return 'Palwarden is creating the initial Palworld settings file.';
  if (/Registering server profile/i.test(line)) return 'Palwarden is saving the server profile and encrypted credential.';
  if (/Starting Palworld server/i.test(line)) return 'Palwarden is launching the new server because start after install is enabled.';
  return 'This can take several minutes depending on SteamCMD and network speed.';
}

function maintenanceStepDetail(line: string, steamPercent: number | null): string {
  if (steamPercent !== null && /download|Update state|Validating installation|Verifying installation/i.test(line)) {
    return `${steamPercent}% reported by SteamCMD.`;
  }
  if (/preallocat|staging/i.test(line)) return 'SteamCMD is allocating and staging files. This can look quiet for a while.';
  if (/Extracting package|Installing update/i.test(line)) return 'SteamCMD is applying files. This phase may not report a percentage.';
  if (/manifest|app metadata looked stale|backed up/i.test(line)) return 'Palwarden is recovering stale Steam metadata before retrying the update.';
  if (/retrying/i.test(line)) return 'SteamCMD can restart itself during updates, so Palwarden is trying the command again.';
  if (/backup/i.test(line)) return 'Palwarden is archiving the configured save directory before maintenance continues.';
  return 'SteamCMD is still running. Large updates may take several minutes while downloading, staging, and verifying files.';
}

function hasLine(log: string[], pattern: RegExp): boolean {
  return log.some((line) => pattern.test(line));
}
