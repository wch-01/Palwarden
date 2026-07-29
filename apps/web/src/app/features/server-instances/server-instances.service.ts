import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  NexusConnectionState,
  NexusInstallPreview,
  NexusInstallTargetKind,
  NexusModFile,
  NexusModSummary,
  ServerDashboardCard,
  HostNetworkSettings,
  ServerImportPreview,
  ServerInstanceView,
  ServerLogResult,
  ServerModInventory,
  ServerModRequest,
  Ue4ssStatus,
} from '@palwarden/shared';
import { AuthService } from '../../core/authentication/auth.service';

export interface ServerPayload {
  displayName: string;
  description?: string;
  installationDirectory: string;
  executablePath: string;
  workingDirectory: string;
  configurationFilePath: string;
  saveDirectory: string;
  backupDirectory: string;
  restApiHost: string;
  restApiPort: number;
  adminPassword?: string;
  gamePort: number;
  queryPort: number;
  launchArguments: string[];
  autoStart: boolean;
  autoRestart: boolean;
  backupBeforeRestart: boolean;
  backupBeforeUpdate: boolean;
  backupBeforeConfigChange: boolean;
  forceStopAfterGracefulTimeout: boolean;
}

export interface DeployServerPayload {
  displayName: string;
  description?: string;
  installationDirectory?: string;
  restApiHost: string;
  restApiPort: number;
  adminPassword?: string;
  serverPassword?: string;
  gamePort: number;
  queryPort: number;
  maxPlayers: number;
  launchArguments: string[];
  autoStart: boolean;
  autoRestart: boolean;
  backupBeforeRestart: boolean;
  backupBeforeUpdate: boolean;
  backupBeforeConfigChange: boolean;
  forceStopAfterGracefulTimeout: boolean;
  startAfterInstall: boolean;
}

export interface DeployJob {
  id: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  error: string | null;
  serverInstanceId: string | null;
}

export interface UpdateServerPayload {
  broadcastMessage?: string;
  shutdownWaitSeconds?: number;
}

export interface ServerUpdateAvailability {
  installedBuildId: string | null;
  latestBuildId: string | null;
  updateAvailable: boolean;
}

export interface ServerRoster {
  players: Array<{
    name?: string;
    accountName?: string;
    playerId?: string;
    playeruid?: string;
    steamid?: string;
    userId?: string;
    ip?: string;
    ping?: number;
    level?: number;
    location_x?: number;
    location_y?: number;
    building_count?: number;
  }>;
  guilds: Array<Record<string, unknown>>;
}

export interface ServerConfigEntry {
  key: string;
  value: string | number | boolean;
  type: 'bool' | 'int' | 'float' | 'string' | 'enum' | 'raw';
  label: string;
  description: string | null;
  help: string;
  group: string;
  options: Array<{ value: string; label: string; description: string }> | null;
  sensitive: boolean;
  configured: boolean;
  popular: boolean;
}

export interface BackupRecordView {
  id: string;
  serverInstanceId: string;
  triggerType: string;
  filePath: string;
  sizeBytes: number;
  success: boolean;
  failureMessage: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ServerInstancesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  dashboard() {
    return this.http.get<ServerDashboardCard[]>('/api/server-instances/dashboard');
  }

  list() {
    return this.http.get<ServerInstanceView[]>('/api/server-instances');
  }

  get(id: string) {
    return this.http.get<ServerInstanceView>(`/api/server-instances/${id}`);
  }

  create(payload: ServerPayload) {
    return this.http.post<ServerInstanceView>('/api/server-instances', payload);
  }

  defaultInstallDirectory(name: string) {
    return this.http.get<{ path: string }>('/api/server-instances/default-install-directory', {
      params: { name },
    });
  }

  importPreview(installationDirectory: string, displayName: string) {
    return this.http.get<ServerImportPreview>('/api/server-instances/import-preview', {
      params: { installationDirectory, displayName },
    });
  }

  nexusState() {
    return this.http.get<NexusConnectionState>('/api/server-instances/nexus');
  }

  saveNexusApiKey(apiKey: string) {
    return this.http.put<NexusConnectionState>('/api/server-instances/nexus', { apiKey });
  }

  removeNexusApiKey() {
    return this.http.delete<NexusConnectionState>('/api/server-instances/nexus');
  }

  hostNetworkSettings() {
    return this.http.get<HostNetworkSettings>('/api/settings/host/network');
  }

  saveHostNetworkSettings(payload: { webAccessMode: 'localhost' | 'lan'; port?: number; acknowledgeExposure?: boolean }) {
    return this.http.put<HostNetworkSettings>('/api/settings/host/network', payload);
  }

  nexusMods(list: 'trending' | 'latest_added' | 'latest_updated', query = '') {
    return this.http.get<NexusModSummary[]>('/api/server-instances/nexus/mods', { params: query.trim() ? { list, q: query.trim() } : { list } });
  }

  searchNexusMods(query: string) {
    return this.http.get<NexusModSummary[]>('/api/server-instances/nexus/search', { params: { q: query.trim() } });
  }

  deploy(payload: DeployServerPayload) {
    return this.deployWithImageFallback(payload);
  }

  deployStatus(id: string) {
    return this.http.get<DeployJob>(`/api/server-instances/deploy/${id}`);
  }

  maintenanceStatus(id: string) {
    return this.http.get<DeployJob>(`/api/server-instances/maintenance/${id}`);
  }

  update(id: string, payload: ServerPayload) {
    return this.http.put<ServerInstanceView>(`/api/server-instances/${id}`, payload);
  }

  remove(id: string) {
    return this.http.delete<void>(`/api/server-instances/${id}`);
  }

  openFolder(id: string) {
    return this.http.post<{ ok: boolean }>(`/api/server-instances/${id}/open-folder`, {});
  }

  start(id: string) {
    return this.http.post(`/api/server-instances/${id}/start`, {});
  }

  gracefulStop(id: string) {
    return this.http.post(`/api/server-instances/${id}/graceful-stop`, {});
  }

  restart(id: string) {
    return this.http.post(`/api/server-instances/${id}/restart`, {});
  }

  updateServer(id: string, payload: UpdateServerPayload = {}) {
    return this.http.post<DeployJob>(`/api/server-instances/${id}/update`, payload);
  }

  validateServer(id: string) {
    return this.http.post<DeployJob>(`/api/server-instances/${id}/validate`, {});
  }

  saveWorld(id: string) {
    return this.http.post(`/api/server-instances/${id}/save`, {});
  }

  announce(id: string, message: string) {
    return this.http.post(`/api/server-instances/${id}/announce`, { message });
  }

  shutdownCountdown(id: string, seconds: number, message: string) {
    return this.http.post(`/api/server-instances/${id}/shutdown-countdown`, { seconds, message });
  }

  backup(id: string) {
    return this.http.post<BackupRecordView>(`/api/server-instances/${id}/backups`, {});
  }

  backups(id: string) {
    return this.http.get<BackupRecordView[]>(`/api/server-instances/${id}/backups`);
  }

  deleteBackup(id: string, backupId: string) {
    return this.http.delete<{ ok: true }>(`/api/server-instances/${id}/backups/${backupId}`);
  }

  deleteFailedBackups(id: string) {
    return this.http.delete<{ ok: true; deleted: number }>(`/api/server-instances/${id}/backups/failed`);
  }

  restoreBackup(id: string, backupId: string) {
    return this.http.post<{ ok: true; emergencyBackup: BackupRecordView | null }>(`/api/server-instances/${id}/backups/${backupId}/restore`, {});
  }

  testConnection(id: string) {
    return this.http.post(`/api/server-instances/${id}/test-connection`, {});
  }

  updateAvailability(id: string) {
    return this.http.get<ServerUpdateAvailability>(`/api/server-instances/${id}/update-availability`);
  }

  roster(id: string) {
    return this.http.get<ServerRoster>(`/api/server-instances/${id}/roster`);
  }

  mods(id: string) {
    return this.http.get<ServerModInventory>(`/api/server-instances/${id}/mods`);
  }

  ue4ssStatus(id: string) {
    return this.http.get<Ue4ssStatus>(`/api/server-instances/${id}/ue4ss`);
  }

  installUe4ss(id: string) {
    return this.http.post<Ue4ssStatus>(`/api/server-instances/${id}/ue4ss/install`, {});
  }

  uninstallUe4ss(id: string) {
    return this.http.post<Ue4ssStatus>(`/api/server-instances/${id}/ue4ss/uninstall`, {});
  }

  modRequests(id: string) {
    return this.http.get<ServerModRequest[]>(`/api/server-instances/${id}/mods/requests`);
  }

  requestNexusMod(id: string, mod: Pick<NexusModSummary, 'modId' | 'name' | 'author' | 'summary' | 'pictureUrl'>) {
    return this.http.post<ServerModRequest[]>(`/api/server-instances/${id}/mods/requests`, { ...mod, nexusModId: mod.modId });
  }

  approveModRequest(id: string, requestId: string) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/requests/${requestId}/approve`, {});
  }

  denyModRequest(id: string, requestId: string) {
    return this.http.post<ServerModRequest[]>(`/api/server-instances/${id}/mods/requests/${requestId}/deny`, {});
  }

  nexusModFiles(id: string, nexusModId: number) {
    return this.http.get<NexusModFile[]>(`/api/server-instances/${id}/mods/nexus/${nexusModId}/files`);
  }

  previewNexusModInstall(id: string, nexusModId: number, fileId?: number) {
    return this.http.post<NexusInstallPreview>(`/api/server-instances/${id}/mods/nexus/${nexusModId}/preview`, fileId ? { fileId } : {});
  }

  installNexusMod(id: string, nexusModId: number, fileId?: number, targetKind?: NexusInstallTargetKind, folderName?: string) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/nexus/${nexusModId}/install`, {
      ...(fileId ? { fileId } : {}),
      ...(targetKind ? { targetKind } : {}),
      ...(folderName ? { folderName } : {}),
    });
  }

  updateNexusMod(id: string, modId: string, fileId?: number) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/${encodeURIComponent(modId)}/update`, fileId ? { fileId } : {});
  }

  enableMod(id: string, modId: string) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/${encodeURIComponent(modId)}/enable`, {});
  }

  disableMod(id: string, modId: string) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/${encodeURIComponent(modId)}/disable`, {});
  }

  removeMod(id: string, modId: string) {
    return this.http.delete<ServerModInventory>(`/api/server-instances/${id}/mods/${encodeURIComponent(modId)}`);
  }

  reorderMods(id: string, orderedIds: string[]) {
    return this.http.post<ServerModInventory>(`/api/server-instances/${id}/mods/reorder`, { orderedIds });
  }

  kickPlayer(id: string, userId: string, message?: string) {
    return this.http.post<{ ok: true }>(`/api/server-instances/${id}/players/kick`, { userId, message });
  }

  banPlayer(id: string, userId: string, message?: string) {
    return this.http.post<{ ok: true }>(`/api/server-instances/${id}/players/ban`, { userId, message });
  }

  unbanPlayer(id: string, userId: string) {
    return this.http.post<{ ok: true }>(`/api/server-instances/${id}/players/unban`, { userId });
  }

  configuration(id: string) {
    return this.http.get<{ entries: ServerConfigEntry[] }>(`/api/server-instances/${id}/configuration`, {
      params: { refresh: String(Date.now()) },
    });
  }

  updateConfiguration(id: string, values: Record<string, string | number | boolean>) {
    return this.http.put<{ entries: ServerConfigEntry[] }>(`/api/server-instances/${id}/configuration`, { values });
  }

  logs(id: string, filters: { q?: string; stream?: string; limit?: number } = {}) {
    return this.http.get<ServerLogResult>(`/api/server-instances/${id}/logs`, {
      params: {
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.stream ? { stream: filters.stream } : {}),
        ...(filters.limit ? { limit: String(filters.limit) } : {}),
      },
    });
  }

  logsDownloadUrl(id: string, filters: { q?: string; stream?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.stream) params.set('stream', filters.stream);
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return `/api/server-instances/${id}/logs/download${query ? `?${query}` : ''}`;
  }

  private async deployWithNativeFetch(payload: DeployServerPayload): Promise<DeployJob> {
    return new Promise<DeployJob>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const timer = window.setTimeout(() => {
        request.abort();
        reject(new Error('Palwarden did not answer the deployment request within 15 seconds.'));
      }, 15000);

      request.open('POST', `/api/server-instances/deploy?${this.deployQuery(payload)}`, true);
      request.withCredentials = true;
      const csrfToken = this.auth.csrfToken();
      if (csrfToken) {
        request.setRequestHeader('x-csrf-token', csrfToken);
      }

      request.onload = () => {
        window.clearTimeout(timer);
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(this.readErrorMessage(request.responseText) || `Deployment request failed with HTTP ${request.status}.`));
          return;
        }
        resolve(JSON.parse(request.responseText) as DeployJob);
      };
      request.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('The browser could not send the deployment request to Palwarden.'));
      };
      request.onabort = () => {
        window.clearTimeout(timer);
      };
      request.send();
    });
  }

  private deployWithImageFallback(payload: DeployServerPayload): Promise<DeployJob> {
    const id = `deploy-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const image = new Image();
    image.style.display = 'none';
    image.alt = '';
    image.src = `/api/server-instances/deploy/start?${this.deployQuery(payload, id)}`;
    document.body.append(image);
    window.setTimeout(() => image.remove(), 30000);
    return Promise.resolve({
      id,
      status: 'running',
      log: ['Deployment start signal sent to Palwarden.'],
      error: null,
      serverInstanceId: null,
    });
  }

  private deployQuery(payload: DeployServerPayload, jobId?: string): string {
    const params = new URLSearchParams();
    if (jobId) {
      params.set('jobId', jobId);
    }
    const csrfToken = this.auth.csrfToken();
    if (csrfToken) {
      params.set('csrfToken', csrfToken);
    }
    params.set('displayName', payload.displayName);
    if (payload.description) {
      params.set('description', payload.description);
    }
    if (payload.installationDirectory) {
      params.set('installationDirectory', payload.installationDirectory);
    }
    params.set('restApiHost', payload.restApiHost);
    params.set('restApiPort', String(payload.restApiPort));
    if (payload.adminPassword) {
      params.set('adminPassword', payload.adminPassword);
    }
    if (payload.serverPassword) {
      params.set('serverPassword', payload.serverPassword);
    }
    params.set('gamePort', String(payload.gamePort));
    params.set('queryPort', String(payload.queryPort));
    params.set('maxPlayers', String(payload.maxPlayers));
    params.set('launchArguments', payload.launchArguments.join('\n'));
    params.set('autoStart', String(payload.autoStart));
    params.set('autoRestart', String(payload.autoRestart));
    params.set('backupBeforeRestart', String(payload.backupBeforeRestart));
    params.set('backupBeforeUpdate', String(payload.backupBeforeUpdate));
    params.set('backupBeforeConfigChange', String(payload.backupBeforeConfigChange));
    params.set('forceStopAfterGracefulTimeout', String(payload.forceStopAfterGracefulTimeout));
    params.set('startAfterInstall', String(payload.startAfterInstall));
    return params.toString();
  }

  private readErrorMessage(text: string): string {
    try {
      const parsed = JSON.parse(text) as { message?: string | string[]; error?: string };
      if (Array.isArray(parsed.message)) {
        return parsed.message.join(' ');
      }
      return parsed.message ?? parsed.error ?? '';
    } catch {
      return text;
    }
  }
}
