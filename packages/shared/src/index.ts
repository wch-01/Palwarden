export type UserRole = 'OWNER' | 'ADMIN' | 'VIEWER';

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt?: string;
}

export interface AuthState {
  setupRequired: boolean;
  user: PublicUser | null;
  csrfToken: string;
  trustedDesktopSession: boolean;
}

export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'unknown';

export interface ServerInstanceView {
  id: string;
  displayName: string;
  description: string | null;
  installationDirectory: string;
  executablePath: string;
  workingDirectory: string;
  configurationFilePath: string;
  saveDirectory: string;
  backupDirectory: string;
  restApiHost: string;
  restApiPort: number;
  gamePort: number;
  queryPort: number;
  launchArguments: string[];
  autoStart: boolean;
  autoRestart: boolean;
  backupBeforeRestart: boolean;
  backupBeforeUpdate: boolean;
  backupBeforeConfigChange: boolean;
  scheduledBackupsEnabled: boolean;
  scheduledBackupIntervalMinutes: number;
  scheduledBackupRetentionCount: number;
  scheduledBackupNextRunAt: string | null;
  lastScheduledBackupAt: string | null;
  forceStopAfterGracefulTimeout: boolean;
  adminPasswordConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerDashboardCard extends ServerInstanceView {
  runtimeState: RuntimeState;
  localProcessState: RuntimeState;
  localProcessPid: number | null;
  restConnectivity: 'unknown' | 'online' | 'offline' | 'auth_failed' | 'unsupported' | 'starting';
  currentPlayers: number | null;
  maxPlayers: number | null;
  serverFps: number | null;
  uptimeSeconds: number | null;
  installedVersion: string | null;
  hostCpuPercent: number | null;
  hostMemoryMb: number | null;
  processCpuAveragePercent: number | null;
  processCpuPeakPercent: number | null;
  processPrivateMemoryMb: number | null;
  processPeakMemoryMb: number | null;
  installDirectorySizeMb: number | null;
  saveDirectorySizeMb: number | null;
  backupDirectorySizeMb: number | null;
  driveFreeSpaceMb: number | null;
  installedModCount: number | null;
}

export interface ServerLogEntry {
  index: number;
  timestamp: string | null;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
  raw: string;
}

export interface ServerLogResult {
  entries: ServerLogEntry[];
  total: number;
  filtered: number;
}

export interface ServerImportPreview {
  installationDirectory: string;
  executablePath: string;
  workingDirectory: string;
  configurationFilePath: string;
  saveDirectory: string;
  backupDirectory: string;
  detected: {
    executable: boolean;
    configuration: boolean;
    saveDirectory: boolean;
  };
  settings: {
    serverName: string | null;
    restApiPort: number | null;
    gamePort: number | null;
    queryPort: number | null;
    maxPlayers: number | null;
    adminPasswordConfigured: boolean;
  };
  warnings: string[];
}

export type ServerModKind = 'pak' | 'logic' | 'ue4ss' | 'unknown';

export interface ServerModInventoryItem {
  id: string;
  name: string;
  kind: ServerModKind;
  path: string;
  relativePath: string;
  files: string[];
  sizeBytes: number;
  updatedAt: string | null;
  status: 'enabled' | 'disabled' | 'partial' | 'folder' | 'missing';
  loadPriority: number;
  folderName: string | null;
  sourceModId: number | null;
  version: string | null;
  latestVersion: string | null;
  latestFileId: number | null;
  updateAvailable: boolean;
  updateCheckedAt: string | null;
  updateCheckError: string | null;
  author: string | null;
  description: string | null;
  dependencies: ServerModDependency[];
  notes: string[];
}

export interface ServerModDependency {
  name: string;
  nexusModId: number | null;
  nexusUrl: string | null;
  required: boolean | null;
  notes: string | null;
}

export interface ServerModInventory {
  serverInstanceId: string;
  scannedAt: string;
  roots: Array<{
    label: string;
    path: string;
    exists: boolean;
  }>;
  items: ServerModInventoryItem[];
  warnings: string[];
}

export interface NexusModSummary {
  id: string;
  modId: number;
  name: string;
  author: string;
  summary: string;
  categoryName: string;
  downloads: number;
  endorsements: number;
  pictureUrl: string | null;
  directDownloadEnabled: boolean;
  nexusUrl: string;
}

export interface NexusModFile {
  fileId: number;
  name: string;
  version: string;
  category: string;
  isMain: boolean;
  sizeKb: number | null;
  description: string;
}

export type NexusInstallTargetKind = 'pak' | 'logic' | 'ue4ss';

export interface NexusInstallPreview {
  nexusModId: number;
  fileId: number;
  fileName: string;
  modName: string;
  detectedTargetKind: NexusInstallTargetKind;
  targetKind: NexusInstallTargetKind;
  folderName: string;
  relativePath: string;
  archiveFileCount: number;
  pakFileCount: number;
  warnings: string[];
}

export interface ServerModRequest {
  id: string;
  serverInstanceId: string;
  nexusModId: number;
  name: string;
  author: string;
  summary: string;
  pictureUrl: string | null;
  nexusUrl: string;
  requestedBy: string | null;
  requestedByUsername: string | null;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  decidedAt: string | null;
}

export interface Ue4ssStatus {
  installed: boolean;
  installedVersion: string | null;
  installedAt: string | null;
  latestVersion: string | null;
  latestAssetName: string | null;
}

export interface NexusConnectionState {
  connected: boolean;
  username: string | null;
  userId: number | null;
  isPremium: boolean;
  updatedAt: string | null;
}

export interface HostNetworkBinding {
  host: string;
  port: number;
  webAccessMode: 'localhost' | 'lan';
  localUrl: string;
  lanUrl: string | null;
}

export interface HostNetworkSettings {
  active: HostNetworkBinding;
  configured: HostNetworkBinding;
  restartRequired: boolean;
}

export interface HostStartupSettings {
  available: boolean;
  startWithWindows: boolean;
  registeredCommand: string | null;
  desiredCommand: string | null;
  message: string;
}

export interface HostServerStartupSettings {
  startServersOnLaunch: boolean;
  autoStartServerCount: number;
}

export interface PublicIpDetection {
  publicIp: string | null;
  address: string | null;
  message: string;
}

export interface SafePalworldError {
  code:
    | 'CONNECTION_REFUSED'
    | 'TIMEOUT'
    | 'DNS_ERROR'
    | 'INVALID_ADMIN_PASSWORD'
    | 'REST_API_DISABLED'
    | 'UNSUPPORTED_ENDPOINT'
    | 'INVALID_RESPONSE'
    | 'SERVER_STARTING'
    | 'SERVER_SHUTTING_DOWN'
    | 'UNKNOWN';
  message: string;
}
