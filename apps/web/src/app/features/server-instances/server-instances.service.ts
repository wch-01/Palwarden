import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ServerDashboardCard, ServerInstanceView } from '@palwarden/shared';
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
  startAfterInstall: boolean;
}

export interface DeployJob {
  id: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  error: string | null;
  serverInstanceId: string | null;
}

export interface ServerRoster {
  players: Array<{ name?: string; level?: number; steamid?: string }>;
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

  deploy(payload: DeployServerPayload) {
    return this.deployWithImageFallback(payload);
  }

  deployStatus(id: string) {
    return this.http.get<DeployJob>(`/api/server-instances/deploy/${id}`);
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
    return this.http.post<{ ok: boolean; message: string }>(`/api/server-instances/${id}/backup`, {});
  }

  testConnection(id: string) {
    return this.http.post(`/api/server-instances/${id}/test-connection`, {});
  }

  roster(id: string) {
    return this.http.get<ServerRoster>(`/api/server-instances/${id}/roster`);
  }

  configuration(id: string) {
    return this.http.get<{ entries: ServerConfigEntry[] }>(`/api/server-instances/${id}/configuration`, {
      params: { refresh: String(Date.now()) },
    });
  }

  updateConfiguration(id: string, values: Record<string, string | number | boolean>) {
    return this.http.put<{ entries: ServerConfigEntry[] }>(`/api/server-instances/${id}/configuration`, { values });
  }

  logs(id: string) {
    return this.http.get<{ lines: string[] }>(`/api/server-instances/${id}/logs`);
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
