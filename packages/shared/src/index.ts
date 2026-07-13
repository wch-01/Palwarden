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
  adminPasswordConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerDashboardCard extends ServerInstanceView {
  runtimeState: RuntimeState;
  restConnectivity: 'unknown' | 'online' | 'offline' | 'auth_failed' | 'unsupported' | 'starting';
  currentPlayers: number | null;
  maxPlayers: number | null;
  serverFps: number | null;
  uptimeSeconds: number | null;
  installedVersion: string | null;
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
