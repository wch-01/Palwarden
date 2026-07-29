import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/authentication/auth.service';
import type { DeployJob, ServerPayload } from '../server-instances/server-instances.service';
import { ServerInstancesService } from '../server-instances/server-instances.service';
import type { NexusConnectionState, ServerDashboardCard, ServerImportPreview, UserRole } from '@palwarden/shared';
import { UsersClient } from './users.service';
import type { ManagedUser } from './users.service';

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
          <div class="section-toolbar">
            <span class="muted">Signed in as {{ currentUsername() }}.</span>
            <button type="button" [disabled]="currentRole() !== 'OWNER'" (click)="openUserModal()">Add user</button>
          </div>
          @if (currentRole() === 'OWNER') {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (user of users(); track user.id) {
                    <tr>
                      <td>{{ user.username }}</td>
                      <td>
                        <select [value]="user.role" (change)="changeUserRole(user, selectValue($event))">
                          <option value="OWNER">OWNER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="VIEWER">VIEWER</option>
                        </select>
                      </td>
                      <td><span class="state-badge" [class.online]="!user.disabled">{{ user.disabled ? 'disabled' : 'active' }}</span></td>
                      <td>{{ formatDate(user.createdAt) }}</td>
                      <td class="table-actions">
                        <button type="button" class="secondary-button compact" (click)="toggleUserDisabled(user)">
                          {{ user.disabled ? 'Enable' : 'Disable' }}
                        </button>
                        <button type="button" class="secondary-button compact" (click)="resetUserPassword(user)">Password</button>
                        <button type="button" class="danger-button compact" (click)="deleteUser(user)">Delete</button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="muted">No users found.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">Owner access is required to manage Palwarden users.</p>
          }
        </div>
      </details>

      @if (modal() === 'user') {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add user">
          <form class="modal-panel" [formGroup]="userForm" (ngSubmit)="createUser()">
            <header>
              <h2>Add user</h2>
              <button type="button" class="icon-button" (click)="closeModal()">x</button>
            </header>
            <div class="modal-grid">
              <label>Username<input formControlName="username" /></label>
              <label>Password<input type="password" formControlName="password" /></label>
              <label>
                Role
                <select formControlName="role">
                  <option value="ADMIN">ADMIN</option>
                  <option value="VIEWER">VIEWER</option>
                  <option value="OWNER">OWNER</option>
                </select>
              </label>
            </div>
            <footer>
              <button type="button" class="secondary" (click)="closeModal()">Cancel</button>
              <button type="submit" [disabled]="userForm.invalid">Create user</button>
            </footer>
          </form>
        </section>
      }

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
          <p class="muted">Manual backup and restore live in Server Control. Scheduling controls will land with the automation pass.</p>
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>Nexus Mods</strong>
            <small>Connect the host-level Nexus Mods API key used for approved mod downloads.</small>
          </span>
          <span class="state-badge" [class.online]="nexusState()?.connected">{{ nexusState()?.connected ? 'connected' : 'not connected' }}</span>
        </summary>
        <div class="settings-section-body">
          <div class="nexus-control-card">
            <div class="nexus-account-strip">
              <div class="nexus-status-orb" [class.online]="nexusState()?.connected"></div>
              <div>
                <span class="eyebrow">Nexus account</span>
                <h3>{{ nexusState()?.connected ? nexusState()?.username || 'Connected user' : 'No API key saved' }}</h3>
                <p class="muted">
                  @if (nexusState()?.connected) {
                    {{ nexusState()?.isPremium ? 'Premium direct downloads are available.' : 'Browsing works, but automatic downloads require Nexus Premium.' }}
                  } @else {
                    Save a host-level key to unlock approved direct downloads.
                  }
                </p>
              </div>
            </div>

            <div class="nexus-meta-grid">
              <div>
                <span>Stored key</span>
                <strong>{{ nexusState()?.connected ? 'Encrypted' : 'Not configured' }}</strong>
              </div>
              <div>
                <span>Download access</span>
                <strong>{{ nexusState()?.isPremium ? 'Premium' : 'Manual or request flow' }}</strong>
              </div>
              <div>
                <span>Last updated</span>
                <strong>{{ nexusState()?.updatedAt ? formatDateTime(nexusState()!.updatedAt!) : 'Never' }}</strong>
              </div>
            </div>

            <div class="nexus-note">
              Palwarden keeps this key at the application level. Admins can request mods per server; owners approve installs that use the saved key.
              The raw key is encrypted at rest and never returned to the browser after saving.
            </div>

            @if (currentRole() === 'OWNER') {
              <form class="nexus-key-form" [formGroup]="nexusForm" (ngSubmit)="saveNexusKey()">
                <label>
                  API key
                  <input type="password" formControlName="apiKey" placeholder="Paste Nexus Mods API key" autocomplete="off" />
                </label>
                <div class="nexus-actions">
                  <button type="submit" [disabled]="nexusForm.invalid || nexusSaving()">{{ nexusSaving() ? 'Checking...' : 'Save and validate' }}</button>
                  <button type="button" class="danger-button compact" [disabled]="!nexusState()?.connected || nexusSaving()" (click)="removeNexusKey()">Remove key</button>
                </div>
              </form>
            } @else {
              <p class="muted">Owner access is required to change the Nexus Mods API key.</p>
            }
          </div>
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>Network Access</strong>
            <small>Review LAN binding, HTTPS, reverse proxy, and CORS guidance.</small>
          </span>
          <span class="state-badge">local first</span>
        </summary>
        <div class="settings-section-body">
          <div class="settings-grid">
            <article class="settings-card">
              <h3>Default binding</h3>
              <p class="muted">Palwarden should bind to localhost by default. Use LAN binding only on a trusted private network.</p>
              <code>PALWARDEN_HOST=127.0.0.1</code>
            </article>
            <article class="settings-card">
              <h3>LAN access</h3>
              <p class="muted">For another trusted machine on your LAN, bind to a private interface and list explicit browser origins.</p>
              <code>PALWARDEN_HOST=0.0.0.0</code>
              <code>PALWARDEN_CORS_ORIGINS=http://trusted-host:4200</code>
            </article>
            <article class="settings-card">
              <h3>Internet access</h3>
              <p class="muted">Put Palwarden behind HTTPS with a reverse proxy or a secure private network. Do not expose Palworld REST API ports directly.</p>
              <code>PALWARDEN_COOKIE_SECURE=true</code>
            </article>
            <article class="settings-card">
              <h3>CORS rule</h3>
              <p class="muted">Never use wildcard CORS with credentials. Same-origin frontend and backend communication is the production target.</p>
            </article>
          </div>
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
          <div class="import-preview-actions">
            <button type="button" class="secondary" [disabled]="importDetecting() || !importForm.controls.installationDirectory.value" (click)="detectImportPaths()">
              {{ importDetecting() ? 'Detecting...' : 'Detect paths and settings' }}
            </button>
            @if (importPreview(); as preview) {
              <span class="muted">
                Detected {{ preview.detected.executable ? 'executable' : 'no executable' }},
                {{ preview.detected.configuration ? 'config' : 'no config' }},
                {{ preview.detected.saveDirectory ? 'saves' : 'no saves yet' }}.
              </span>
            }
          </div>
          @if (importPreview()?.warnings?.length) {
            <div class="warning-panel import-warning-panel">
              <strong>Review before importing</strong>
              @for (warning of importPreview()?.warnings; track warning) {
                <p>{{ warning }}</p>
              }
            </div>
          }
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
  private readonly usersClient = inject(UsersClient);
  private readonly fb = inject(FormBuilder);
  readonly servers = signal<ServerDashboardCard[]>([]);
  readonly users = signal<ManagedUser[]>([]);
  readonly modal = signal<'deploy' | 'import' | 'user' | null>(null);
  readonly message = signal('');
  readonly deploying = signal(false);
  readonly deployLog = signal<string[]>([]);
  readonly importDetecting = signal(false);
  readonly importPreview = signal<ServerImportPreview | null>(null);
  readonly nexusState = signal<NexusConnectionState | null>(null);
  readonly nexusSaving = signal(false);
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

  readonly userForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    role: ['ADMIN' as UserRole, Validators.required],
  });

  readonly nexusForm = this.fb.nonNullable.group({
    apiKey: ['', Validators.required],
  });

  constructor() {
    this.refreshServers();
    this.refreshUsers();
    this.refreshNexusState();
  }

  openDeployModal(): void {
    this.modal.set('deploy');
    this.deployLog.set([]);
    this.useDefaultDeployPath();
  }

  openImportModal(): void {
    this.importPreview.set(null);
    this.importForm.reset({
      displayName: 'Imported Palworld Server',
      installationDirectory: '',
      executablePath: '',
      workingDirectory: '',
      configurationFilePath: '',
      saveDirectory: '',
      backupDirectory: '',
      restApiHost: '127.0.0.1',
      restApiPort: 8212,
      adminPassword: '',
      gamePort: 8211,
      queryPort: 27015,
    });
    this.modal.set('import');
  }

  openUserModal(): void {
    this.userForm.reset({ username: '', password: '', role: 'ADMIN' });
    this.modal.set('user');
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
        backupBeforeUpdate: false,
        backupBeforeConfigChange: false,
        forceStopAfterGracefulTimeout: false,
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
      backupBeforeUpdate: false,
      backupBeforeConfigChange: false,
      forceStopAfterGracefulTimeout: false,
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

  detectImportPaths(): void {
    const raw = this.importForm.getRawValue();
    this.importDetecting.set(true);
    this.serversService.importPreview(raw.installationDirectory, raw.displayName || 'Imported Palworld Server').subscribe({
      next: (preview) => {
        this.importDetecting.set(false);
        this.importPreview.set(preview);
        this.importForm.patchValue({
          displayName: raw.displayName || preview.settings.serverName || 'Imported Palworld Server',
          installationDirectory: preview.installationDirectory,
          executablePath: preview.executablePath,
          workingDirectory: preview.workingDirectory,
          configurationFilePath: preview.configurationFilePath,
          saveDirectory: preview.saveDirectory,
          backupDirectory: preview.backupDirectory,
          restApiPort: preview.settings.restApiPort ?? raw.restApiPort,
          gamePort: preview.settings.gamePort ?? raw.gamePort,
          queryPort: preview.settings.queryPort ?? raw.queryPort,
        });
        this.message.set(preview.warnings.length ? 'Import detection completed with warnings.' : 'Import detection completed.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.importDetecting.set(false);
        this.importPreview.set(null);
        this.message.set(error.error?.message ?? 'Could not detect that server install.');
      },
    });
  }

  createUser(): void {
    const raw = this.userForm.getRawValue();
    this.usersClient.create(raw).subscribe({
      next: () => {
        this.message.set('User created.');
        this.closeModal();
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => this.message.set(error.error?.message ?? 'Could not create user.'),
    });
  }

  changeUserRole(user: ManagedUser, role: string): void {
    if (role === user.role) return;
    this.usersClient.update(user.id, { role: role as UserRole }).subscribe({
      next: () => {
        this.message.set('User role updated.');
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.message.set(error.error?.message ?? 'Could not update role.');
        this.refreshUsers();
      },
    });
  }

  toggleUserDisabled(user: ManagedUser): void {
    const action = user.disabled ? 'enable' : 'disable';
    if (!confirm(`Are you sure you want to ${action} ${user.username}?`)) return;
    this.usersClient.update(user.id, { disabled: !user.disabled }).subscribe({
      next: () => {
        this.message.set(`User ${user.disabled ? 'enabled' : 'disabled'}.`);
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => this.message.set(error.error?.message ?? `Could not ${action} user.`),
    });
  }

  resetUserPassword(user: ManagedUser): void {
    const password = prompt(`Enter a new password for ${user.username}. Minimum 12 characters.`);
    if (!password) return;
    if (password.length < 12) {
      this.message.set('Password must be at least 12 characters.');
      return;
    }
    this.usersClient.update(user.id, { password }).subscribe({
      next: () => this.message.set('Password updated.'),
      error: (error: { error?: { message?: string } }) => this.message.set(error.error?.message ?? 'Could not update password.'),
    });
  }

  deleteUser(user: ManagedUser): void {
    const expected = `DELETE ${user.username}`;
    if (prompt(`Type "${expected}" to delete this Palwarden user.`) !== expected) return;
    this.usersClient.remove(user.id).subscribe({
      next: () => {
        this.message.set('User deleted.');
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => this.message.set(error.error?.message ?? 'Could not delete user.'),
    });
  }

  saveNexusKey(): void {
    const apiKey = this.nexusForm.controls.apiKey.value.trim();
    if (!apiKey) return;
    this.nexusSaving.set(true);
    this.serversService.saveNexusApiKey(apiKey).subscribe({
      next: (state) => {
        this.nexusSaving.set(false);
        this.nexusState.set(state);
        this.nexusForm.reset({ apiKey: '' });
        this.message.set('Nexus Mods API key saved.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.nexusSaving.set(false);
        this.message.set(error.error?.message ?? 'Could not validate Nexus Mods API key.');
      },
    });
  }

  removeNexusKey(): void {
    if (!confirm('Remove the saved Nexus Mods API key from Palwarden?')) return;
    this.nexusSaving.set(true);
    this.serversService.removeNexusApiKey().subscribe({
      next: (state) => {
        this.nexusSaving.set(false);
        this.nexusState.set(state);
        this.message.set('Nexus Mods API key removed.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.nexusSaving.set(false);
        this.message.set(error.error?.message ?? 'Could not remove Nexus Mods API key.');
      },
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

  formatDate(value: string): string {
    return new Date(value).toLocaleDateString();
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString();
  }

  selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  private refreshServers(): void {
    this.serversService.dashboard().subscribe((servers) => this.servers.set(servers));
  }

  private refreshUsers(): void {
    if (this.currentRole() !== 'OWNER') {
      this.users.set([]);
      return;
    }
    this.usersClient.list().subscribe({
      next: (users) => this.users.set(users),
      error: () => this.users.set([]),
    });
  }

  private refreshNexusState(): void {
    this.serversService.nexusState().subscribe({
      next: (state) => this.nexusState.set(state),
      error: () => this.nexusState.set({ connected: false, username: null, userId: null, isPremium: false, updatedAt: null }),
    });
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
