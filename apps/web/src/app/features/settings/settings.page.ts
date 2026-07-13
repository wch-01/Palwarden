import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/authentication/auth.service';
import type { DeployJob, ServerPayload } from '../server-instances/server-instances.service';
import { ServerInstancesService } from '../server-instances/server-instances.service';
import type { ServerDashboardCard } from '@palwarden/shared';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="settings-stack">
      <details class="settings-section" open>
        <summary>
          <span>
            <strong>Windows Startup</strong>
            <small>Choose whether Palwarden opens when Windows starts.</small>
          </span>
          <span class="state-badge">planned</span>
        </summary>
        <div class="settings-section-body">
          <label class="setting-toggle">
            <input type="checkbox" disabled />
            <span>Start Palwarden when Windows starts</span>
          </label>
          <p class="muted">This will be wired to Windows startup registration in the host-controls pass.</p>
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>Start Servers</strong>
            <small>Control which managed servers should start automatically with Palwarden.</small>
          </span>
          <span class="state-badge">planned</span>
        </summary>
        <div class="settings-section-body">
          <label class="setting-toggle">
            <input type="checkbox" disabled />
            <span>Start enabled servers after Palwarden opens</span>
          </label>
          <p class="muted">Per-server auto-start flags already exist. This section will become the global startup policy.</p>
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>User Access</strong>
            <small>Manage Palwarden users, roles, and access.</small>
          </span>
          <span class="state-badge">{{ currentRole() }}</span>
        </summary>
        <div class="settings-section-body">
          <div class="settings-inline">
            <div>
              <h3>{{ currentUsername() }}</h3>
              <p class="muted">User management beyond the first owner account is planned for this integrated Settings page.</p>
            </div>
            <button type="button" disabled>Add user</button>
          </div>
        </div>
      </details>

      <details class="settings-section" open>
        <summary>
          <span>
            <strong>Server Instances</strong>
            <small>Review deployment state, runtime state, install paths, and profile actions.</small>
          </span>
          <span class="state-badge">{{ servers().length }} configured</span>
        </summary>
        <div class="settings-section-body">
          <div class="section-toolbar">
            <button type="button" (click)="openDeployModal()">Deploy new server</button>
            <button type="button" class="secondary" (click)="openImportModal()">Import existing server</button>
          </div>

          @if (servers().length) {
            <div class="server-instance-list">
              @for (server of servers(); track server.id) {
                <article class="server-instance-row">
                  <div class="server-instance-main">
                    <h3>{{ server.displayName }}</h3>
                    <dl>
                      <div>
                        <dt>Deployment status</dt>
                        <dd>{{ deploymentStatus(server) }}</dd>
                      </div>
                      <div>
                        <dt>Active status</dt>
                        <dd>{{ server.runtimeState }}</dd>
                      </div>
                      <div class="path-cell">
                        <dt>Deployment path</dt>
                        <dd>{{ server.installationDirectory }}</dd>
                      </div>
                    </dl>
                  </div>
                  <div class="server-instance-actions">
                    <button type="button" class="secondary" (click)="browseFiles(server)">Browse files</button>
                    <button type="button" class="danger" (click)="deleteServer(server)">Delete</button>
                  </div>
                </article>
              }
            </div>
          } @else {
            <p class="muted">No server profiles have been registered yet.</p>
          }
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>Automation and Backups</strong>
            <small>Configure scheduled backups and maintenance automation.</small>
          </span>
          <span class="state-badge">planned</span>
        </summary>
        <div class="settings-section-body">
          <label class="setting-toggle">
            <input type="checkbox" disabled />
            <span>Scheduled backups</span>
          </label>
          <p class="muted">Backup records exist in the backend model. Scheduling controls will land after manual backups are wired.</p>
        </div>
      </details>
    </section>

    @if (modal() === 'deploy') {
      <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Deploy new server">
        <form class="modal-panel" [formGroup]="deployForm" (ngSubmit)="deployServer()">
          <header>
            <h2>Deploy new server</h2>
            <button type="button" class="icon-button" (click)="closeModal()">x</button>
          </header>
          <div class="modal-grid">
            <label>Name<input formControlName="displayName" /></label>
            <label>Install directory<input formControlName="installationDirectory" /></label>
            <label>REST host<input formControlName="restApiHost" /></label>
            <label>REST port<input type="number" formControlName="restApiPort" /></label>
            <label>Game port<input type="number" formControlName="gamePort" /></label>
            <label>Query port<input type="number" formControlName="queryPort" /></label>
            <label>Max players<input type="number" formControlName="maxPlayers" /></label>
            <label>Admin password<input type="password" formControlName="adminPassword" placeholder="Blank generates one" /></label>
          </div>
          <label class="setting-toggle">
            <input type="checkbox" formControlName="startAfterInstall" />
            <span>Start after install</span>
          </label>
          <footer>
            <button type="button" class="secondary" (click)="useDefaultDeployPath()">Use default path</button>
            <button type="submit" [disabled]="deployForm.invalid || deploying()">Deploy server</button>
          </footer>
          @if (deployLog().length) {
            <pre class="settings-log">{{ deployLog().join('\\n') }}</pre>
          }
        </form>
      </section>
    }

    @if (modal() === 'import') {
      <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import existing server">
        <form class="modal-panel" [formGroup]="importForm" (ngSubmit)="importServer()">
          <header>
            <h2>Import existing server</h2>
            <button type="button" class="icon-button" (click)="closeModal()">x</button>
          </header>
          <div class="modal-grid">
            <label>Name<input formControlName="displayName" /></label>
            <label>Install directory<input formControlName="installationDirectory" /></label>
            <label>Executable path<input formControlName="executablePath" /></label>
            <label>Working directory<input formControlName="workingDirectory" /></label>
            <label>Config file<input formControlName="configurationFilePath" /></label>
            <label>Save directory<input formControlName="saveDirectory" /></label>
            <label>Backup directory<input formControlName="backupDirectory" /></label>
            <label>REST host<input formControlName="restApiHost" /></label>
            <label>REST port<input type="number" formControlName="restApiPort" /></label>
            <label>Game port<input type="number" formControlName="gamePort" /></label>
            <label>Query port<input type="number" formControlName="queryPort" /></label>
            <label>Admin password<input type="password" formControlName="adminPassword" /></label>
          </div>
          <footer>
            <button type="button" class="secondary" (click)="closeModal()">Cancel</button>
            <button type="submit" [disabled]="importForm.invalid">Import server</button>
          </footer>
        </form>
      </section>
    }

    @if (message()) {
      <p class="settings-toast">{{ message() }}</p>
    }
  `,
})
export class SettingsPage {
  private readonly auth = inject(AuthService);
  private readonly serversService = inject(ServerInstancesService);
  private readonly fb = inject(FormBuilder);
  readonly servers = signal<ServerDashboardCard[]>([]);
  readonly modal = signal<'deploy' | 'import' | null>(null);
  readonly message = signal('');
  readonly deploying = signal(false);
  readonly deployLog = signal<string[]>([]);
  private deployTimer?: number;
  readonly currentUsername = computed(() => this.auth.user()?.username ?? 'Unknown');
  readonly currentRole = computed(() => this.auth.user()?.role ?? 'VIEWER');

  readonly deployForm = this.fb.nonNullable.group({
    displayName: ['New Palworld Server', Validators.required],
    installationDirectory: ['', Validators.required],
    restApiHost: ['127.0.0.1', Validators.required],
    restApiPort: [8212, Validators.required],
    gamePort: [8211, Validators.required],
    queryPort: [27015, Validators.required],
    maxPlayers: [32, Validators.required],
    adminPassword: [''],
    startAfterInstall: [true],
  });

  readonly importForm = this.fb.nonNullable.group({
    displayName: ['', Validators.required],
    installationDirectory: ['', Validators.required],
    executablePath: ['', Validators.required],
    workingDirectory: ['', Validators.required],
    configurationFilePath: ['', Validators.required],
    saveDirectory: ['', Validators.required],
    backupDirectory: ['', Validators.required],
    restApiHost: ['127.0.0.1', Validators.required],
    restApiPort: [8212, Validators.required],
    adminPassword: ['', Validators.required],
    gamePort: [8211, Validators.required],
    queryPort: [27015, Validators.required],
  });

  constructor() {
    this.refreshServers();
  }

  openDeployModal(): void {
    this.modal.set('deploy');
    this.deployLog.set([]);
    this.useDefaultDeployPath();
  }

  openImportModal(): void {
    this.modal.set('import');
  }

  closeModal(): void {
    this.modal.set(null);
    if (this.deployTimer) {
      window.clearInterval(this.deployTimer);
    }
  }

  useDefaultDeployPath(): void {
    this.serversService.defaultInstallDirectory(this.deployForm.controls.displayName.value).subscribe(({ path }) => {
      this.deployForm.controls.installationDirectory.setValue(path);
    });
  }

  deployServer(): void {
    const raw = this.deployForm.getRawValue();
    this.deploying.set(true);
    this.deployLog.set(['Sending deployment request to Palwarden...']);
    void this.serversService
      .deploy({
        displayName: raw.displayName,
        installationDirectory: raw.installationDirectory,
        restApiHost: raw.restApiHost,
        restApiPort: raw.restApiPort,
        gamePort: raw.gamePort,
        queryPort: raw.queryPort,
        maxPlayers: raw.maxPlayers,
        launchArguments: [],
        autoStart: false,
        autoRestart: false,
        backupBeforeRestart: false,
        startAfterInstall: raw.startAfterInstall,
        ...(raw.adminPassword ? { adminPassword: raw.adminPassword } : {}),
      })
      .then((job) => this.watchDeployJob(job))
      .catch((error: unknown) => {
        this.deploying.set(false);
        this.deployLog.set([error instanceof Error ? error.message : 'Could not start deployment.']);
      });
  }

  importServer(): void {
    const raw = this.importForm.getRawValue();
    const payload: ServerPayload = {
      displayName: raw.displayName,
      installationDirectory: raw.installationDirectory,
      executablePath: raw.executablePath,
      workingDirectory: raw.workingDirectory,
      configurationFilePath: raw.configurationFilePath,
      saveDirectory: raw.saveDirectory,
      backupDirectory: raw.backupDirectory,
      restApiHost: raw.restApiHost,
      restApiPort: raw.restApiPort,
      adminPassword: raw.adminPassword,
      gamePort: raw.gamePort,
      queryPort: raw.queryPort,
      launchArguments: [],
      autoStart: false,
      autoRestart: false,
      backupBeforeRestart: false,
    };
    this.serversService.create(payload).subscribe({
      next: () => {
        this.message.set('Server imported.');
        this.closeModal();
        this.refreshServers();
      },
      error: () => this.message.set('Import failed. Check the paths, ports, and admin password.'),
    });
  }

  browseFiles(server: ServerDashboardCard): void {
    this.serversService.openFolder(server.id).subscribe({
      next: () => this.message.set(`Opened files for ${server.displayName}.`),
      error: () => this.message.set('Could not open that server folder.'),
    });
  }

  deleteServer(server: ServerDashboardCard): void {
    if (server.runtimeState !== 'stopped') {
      this.message.set('Stop the server before deleting its profile.');
      return;
    }
    const expected = `DELETE ${server.displayName}`;
    const entered = prompt(`Type "${expected}" to delete this server profile. Server files are not deleted.`);
    if (entered !== expected) {
      return;
    }
    this.serversService.remove(server.id).subscribe({
      next: () => {
        this.message.set('Server profile deleted.');
        this.refreshServers();
      },
      error: () => this.message.set('Delete failed. Owner access is required, and the server must be stopped.'),
    });
  }

  deploymentStatus(server: ServerDashboardCard): string {
    if (server.executablePath && server.configurationFilePath) {
      return 'registered';
    }
    return 'incomplete';
  }

  private refreshServers(): void {
    this.serversService.dashboard().subscribe((servers) => this.servers.set(servers));
  }

  private watchDeployJob(job: DeployJob): void {
    this.deployLog.set(job.log);
    if (this.deployTimer) {
      window.clearInterval(this.deployTimer);
    }
    this.deployTimer = window.setInterval(() => {
      this.serversService.deployStatus(job.id).subscribe((status) => {
        this.deployLog.set(status.log);
        if (status.status === 'done') {
          this.deploying.set(false);
          this.message.set('Server deployed.');
          this.closeModal();
          this.refreshServers();
        }
        if (status.status === 'error') {
          this.deploying.set(false);
          this.deployLog.set([...status.log, status.error ?? 'Deployment failed.']);
          if (this.deployTimer) {
            window.clearInterval(this.deployTimer);
          }
        }
      });
    }, 1500);
  }
}
