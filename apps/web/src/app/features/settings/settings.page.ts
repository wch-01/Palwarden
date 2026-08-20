import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/authentication/auth.service';
import { deployProgressView } from '../server-instances/deploy-progress';
import type { DeployJob, ServerPayload } from '../server-instances/server-instances.service';
import { ServerInstancesService } from '../server-instances/server-instances.service';
import { storeSelectedServerId } from '../server-instances/selected-server';
import type {
  HostNetworkSettings,
  HostServerStartupSettings,
  HostStartupSettings,
  NexusConnectionState,
  ServerDashboardCard,
  ServerImportPreview,
  UserRole,
} from '@palwarden/shared';
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
          <span class="state-badge" [class.online]="hostStartup()?.startWithWindows">
            {{ hostStartup()?.startWithWindows ? 'enabled' : 'disabled' }}
          </span>
        </summary>
        <div class="settings-section-body">
          <label class="setting-toggle">
            <input
              type="checkbox"
              [checked]="hostStartup()?.startWithWindows"
              [disabled]="currentRole() !== 'OWNER' || startupSaving() || !hostStartup()?.available"
              (change)="saveStartupSettings(checked($event))"
            />
            <span>
              <strong>Start Palwarden when this Windows user logs in</strong>
              <small>{{ hostStartup()?.message || 'Loading startup status...' }}</small>
            </span>
          </label>
          @if (hostStartup()?.registeredCommand) {
            <div class="settings-card compact-card">
              <h3>Registered command</h3>
              <code>{{ hostStartup()?.registeredCommand }}</code>
            </div>
          }
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>Start Servers</strong>
            <small>Control which managed servers should start automatically with Palwarden.</small>
          </span>
          <span class="state-badge" [class.online]="serverStartup()?.startServersOnLaunch">
            {{ serverStartup()?.autoStartServerCount || 0 }} selected
          </span>
        </summary>
        <div class="settings-section-body">
          <label class="setting-toggle">
            <input
              type="checkbox"
              [checked]="serverStartup()?.startServersOnLaunch"
              [disabled]="currentRole() !== 'OWNER' || serverStartupSaving()"
              (change)="saveServerStartupSettings(checked($event))"
            />
            <span>
              <strong>Start selected servers after Palwarden opens</strong>
              <small>Palwarden waits for the backend to finish booting, then starts profiles marked for auto-start.</small>
            </span>
          </label>
          @if (servers().length) {
            <div class="startup-server-list">
              @for (server of servers(); track server.id) {
                <label class="startup-server-row">
                  <input
                    type="checkbox"
                    [checked]="server.autoStart"
                    [disabled]="currentRole() !== 'OWNER' || startupServerSavingId() === server.id"
                    (change)="toggleServerAutoStart(server, checked($event))"
                  />
                  <span>
                    <strong>{{ server.displayName }}</strong>
                    <small>{{ server.installationDirectory }}</small>
                  </span>
                  <span class="state-badge" [class.online]="server.autoStart">{{ server.autoStart ? 'selected' : 'manual' }}</span>
                </label>
              }
            </div>
          } @else {
            <p class="muted">Add or import a server profile before choosing launch-time servers.</p>
          }
        </div>
      </details>

      <details class="settings-section">
        <summary>
          <span>
            <strong>User Access</strong>
            <small>Manage Palwarden users, roles, and access.</small>
          </span>
          <span class="state-badge">{{ users().length || currentRole() }}</span>
        </summary>
        <div class="settings-section-body">
          <div class="section-toolbar">
            <span class="muted">Signed in as {{ currentUsername() }}.</span>
            <button type="button" [disabled]="currentRole() !== 'OWNER'" (click)="openUserModal()">Add user</button>
          </div>
          @if (currentRole() === 'OWNER') {
            <div class="table-wrap user-access-table">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Updated</th>
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
                      <td>{{ formatDate(user.updatedAt) }}</td>
                      <td class="table-actions">
                        <button type="button" class="secondary-button compact" (click)="openUserAction(user, user.disabled ? 'enable' : 'disable')">
                          {{ user.disabled ? 'Enable' : 'Disable' }}
                        </button>
                        <button type="button" class="secondary-button compact" (click)="openUserAction(user, 'password')">Password</button>
                        <button type="button" class="danger-button compact" (click)="openUserAction(user, 'delete')">Delete</button>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted">No users found.</td></tr>
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

      @if (userActionCandidate(); as user) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="User action">
          <form class="modal-panel" [formGroup]="userPasswordForm" (ngSubmit)="confirmUserAction()">
            <header>
              <div>
                <h2>{{ userActionTitle() }}</h2>
                <p class="muted">{{ userActionDescription(user) }}</p>
              </div>
              <button type="button" class="icon-button" (click)="closeUserAction()">x</button>
            </header>
            @if (userAction() === 'password') {
              <div class="modal-grid">
                <label>New password<input type="password" formControlName="password" autocomplete="new-password" /></label>
              </div>
            }
            <footer>
              <button type="button" class="secondary" (click)="closeUserAction()">Cancel</button>
              <button
                type="submit"
                [class.danger]="userAction() === 'delete' || userAction() === 'disable'"
                [disabled]="userActionSaving() || (userAction() === 'password' && userPasswordForm.invalid)"
              >
                {{ userActionSaving() ? 'Working...' : userActionConfirmLabel() }}
              </button>
            </footer>
          </form>
        </section>
      }

      @if (deleteServerCandidate(); as server) {
        <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete server profile">
          <div class="modal-panel">
            <header>
              <div>
                <h2>Delete Server Profile?</h2>
                <p class="muted">Choose whether Palwarden should only forget {{ server.displayName }} or also remove its files from disk.</p>
              </div>
              <button type="button" class="icon-button" (click)="cancelDeleteServer()" [disabled]="deletingServer()">x</button>
            </header>
            <div class="warning-panel">
              <strong>Review before deleting</strong>
              <p>The server must be stopped. Palwarden will forget this profile, its managed mod records, and its backup history.</p>
              <p class="path-cell">Install folder: {{ server.installationDirectory }}</p>
              <p class="path-cell">Backup folder: {{ server.backupDirectory }}</p>
            </div>
            <label class="setting-toggle delete-files-toggle">
              <input type="checkbox" [checked]="deleteServerFiles()" (change)="deleteServerFiles.set(checked($event))" [disabled]="deletingServer()" />
              <span>
                <strong>Also delete server files</strong>
                <small>Deletes the install folder, saved world files, mods, config, and this server's backup folder when the paths are safe.</small>
              </span>
            </label>
            <footer>
              <button type="button" class="secondary" (click)="cancelDeleteServer()" [disabled]="deletingServer()">Cancel</button>
              <button type="button" class="danger" (click)="confirmDeleteServer()" [disabled]="deletingServer()">
                {{ deletingServer() ? 'Deleting...' : deleteServerFiles() ? 'Delete Profile and Files' : 'Delete Profile' }}
              </button>
            </footer>
          </div>
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
                      <div class="path-cell">
                        <dt>Executable</dt>
                        <dd>{{ server.executablePath }}</dd>
                      </div>
                      <div class="path-cell">
                        <dt>Config file</dt>
                        <dd>{{ server.configurationFilePath }}</dd>
                      </div>
                      <div class="path-cell">
                        <dt>Save folder</dt>
                        <dd>{{ server.saveDirectory }}</dd>
                      </div>
                      <div class="path-cell">
                        <dt>Backup folder</dt>
                        <dd>{{ server.backupDirectory }}</dd>
                      </div>
                    </dl>
                  </div>
                  <div class="server-instance-actions">
                    <button type="button" class="secondary" (click)="browseFiles(server)">Open install folder</button>
                    <button type="button" class="secondary" (click)="openServerConfiguration(server)">Configure</button>
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
            <small>Configure safety backup policies for maintenance actions.</small>
          </span>
          <span class="state-badge">{{ backupPolicyCount() }} policies</span>
        </summary>
        <div class="settings-section-body">
          <div class="warning-panel network-warning-panel">
            <strong>Scheduled backups run while Palwarden is open.</strong>
            <p>Each enabled server gets its own interval. Retention only removes older scheduled backup archives; manual and safety backups stay untouched.</p>
          </div>
          @if (servers().length) {
            <div class="automation-server-list">
              @for (server of servers(); track server.id) {
                <article class="automation-server-card">
                  <header>
                    <div>
                      <h3>{{ server.displayName }}</h3>
                      <p class="muted">{{ server.backupDirectory }}</p>
                    </div>
                    <span class="state-badge">{{ enabledBackupPolicyCount(server) }}/3 enabled</span>
                  </header>
                  <div class="automation-toggle-grid">
                    <label class="setting-toggle">
                      <input type="checkbox" [checked]="server.scheduledBackupsEnabled" (change)="toggleScheduledBackups(server, checked($event))" />
                      <span>
                        <strong>Scheduled backups</strong>
                        <small>{{ scheduledBackupSummary(server) }}</small>
                      </span>
                    </label>
                    <label class="automation-number-field">
                      Interval minutes
                      <small>1 minute to 7 days</small>
                      <input
                        type="number"
                        min="1"
                        max="10080"
                        [value]="server.scheduledBackupIntervalMinutes"
                        (change)="updateScheduledNumber(server, 'scheduledBackupIntervalMinutes', numberValue($event))"
                      />
                    </label>
                    <label class="automation-number-field">
                      Keep latest
                      <small>Scheduled backups only</small>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        [value]="server.scheduledBackupRetentionCount"
                        (change)="updateScheduledNumber(server, 'scheduledBackupRetentionCount', numberValue($event))"
                      />
                    </label>
                    <label class="setting-toggle">
                      <input type="checkbox" [checked]="server.backupBeforeRestart" (change)="toggleBackupPolicy(server, 'backupBeforeRestart', checked($event))" />
                      <span>Before restart</span>
                    </label>
                    <label class="setting-toggle">
                      <input type="checkbox" [checked]="server.backupBeforeUpdate" (change)="toggleBackupPolicy(server, 'backupBeforeUpdate', checked($event))" />
                      <span>Before update</span>
                    </label>
                    <label class="setting-toggle">
                      <input type="checkbox" [checked]="server.backupBeforeConfigChange" (change)="toggleBackupPolicy(server, 'backupBeforeConfigChange', checked($event))" />
                      <span>Before config change</span>
                    </label>
                  </div>
                </article>
              }
            </div>
          } @else {
            <p class="muted">Add or import a server before configuring backup policies.</p>
          }
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
                  <button type="submit" class="primary-button compact" [disabled]="nexusForm.invalid || nexusSaving()">
                    {{ nexusSaving() ? 'Checking...' : 'Save and validate' }}
                  </button>
                  <a class="secondary-button compact button-link" href="https://next.nexusmods.com/settings/api-keys" target="_blank" rel="noreferrer">Open API Keys</a>
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
            <small>Choose whether Palwarden is local-only or reachable from other trusted machines.</small>
          </span>
          <span class="state-badge" [class.online]="hostNetwork()?.active?.webAccessMode === 'lan'">
            {{ hostNetwork()?.active?.webAccessMode === 'lan' ? 'LAN active' : 'local only' }}
          </span>
        </summary>
        <div class="settings-section-body">
          <form class="network-access-form" [formGroup]="networkForm" (ngSubmit)="saveNetworkSettings()">
            <div class="network-mode-grid">
              <label class="network-mode-card" [class.selected]="networkForm.controls.webAccessMode.value === 'localhost'">
                <input type="radio" formControlName="webAccessMode" value="localhost" />
                <span>
                  <strong>Local desktop only</strong>
                  <small>Bind Palwarden to this PC. Electron and the local browser use localhost.</small>
                  <code>http://127.0.0.1:{{ networkForm.controls.port.value || 3333 }}</code>
                </span>
              </label>
              <label class="network-mode-card" [class.selected]="networkForm.controls.webAccessMode.value === 'lan'">
                <input type="radio" formControlName="webAccessMode" value="lan" />
                <span>
                  <strong>Expose web UI on this network</strong>
                  <small>Bind Palwarden for access from another trusted browser, LAN IP, VPN, or Tailscale address.</small>
                  <code>http://&lt;this-pc-ip&gt;:{{ networkForm.controls.port.value || 3333 }}</code>
                </span>
              </label>
            </div>

            <div class="network-settings-row">
              <label>
                Web UI port
                <input type="number" formControlName="port" min="1" max="65535" />
              </label>
              <div class="settings-card compact-card">
                <h3>Currently listening</h3>
                <code>{{ hostNetwork()?.active?.localUrl || 'http://127.0.0.1:3333' }}</code>
                @if (hostNetwork()?.active?.lanUrl) {
                  <code>{{ hostNetwork()?.active?.lanUrl }}</code>
                }
              </div>
            </div>

            @if (networkForm.controls.webAccessMode.value === 'lan') {
              <label class="setting-toggle warning-toggle">
                <input type="checkbox" formControlName="acknowledgeExposure" />
                <span>I understand Palwarden will listen beyond localhost. I will use Windows Firewall, a private LAN, VPN/Tailscale, or HTTPS reverse proxy as appropriate.</span>
              </label>
            }

            <div class="warning-panel network-warning-panel">
              <strong>Public exposure is the host admin's choice.</strong>
              <p>Palwarden only controls the bind address and port. For internet access, use HTTPS and a secure network path. Do not expose Palworld REST API ports directly.</p>
            </div>

            @if (hostNetwork()?.restartRequired) {
              <div class="warning-panel restart-required-panel">
                <strong>Restart Palwarden to apply this network change.</strong>
                <p>The saved bind address or port will be used the next time Palwarden starts. Until then, use the currently listening address shown above.</p>
                <code>{{ hostNetwork()?.configured?.localUrl }}</code>
                @if (hostNetwork()?.configured?.lanUrl) {
                  <code>{{ hostNetwork()?.configured?.lanUrl }}</code>
                }
              </div>
            }

            <footer class="settings-actions">
              <button class="primary-button" type="submit" [disabled]="currentRole() !== 'OWNER' || networkForm.invalid || networkSaving()">
                {{ networkSaving() ? 'Saving...' : 'Save network access' }}
              </button>
              @if (hostNetwork()?.restartRequired) {
                <button class="secondary-button" type="button" (click)="explainNetworkRestart()">Show restart instructions</button>
              }
            </footer>
          </form>
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
        </form>
      </section>
    }

    @if (deploying() || deployLog().length) {
      <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Server install progress">
        <div class="modal-panel deploy-progress-modal">
          <header>
            <h2>{{ deployProgress().title }}</h2>
            @if (!deploying()) {
              <button type="button" class="icon-button" aria-label="Close install progress" (click)="dismissDeployProgress()">x</button>
            }
          </header>
          <div class="loading-summary">
            <span class="loading-spinner" aria-hidden="true"></span>
            <div>
              <strong>{{ deployProgress().step }}</strong>
              <p class="muted">{{ deployProgress().detail }}</p>
            </div>
          </div>
          <div class="progress-track" [class.indeterminate]="deployProgress().percent === null">
            @if (deployProgress().percent !== null) {
              <span [style.width.%]="deployProgress().percent"></span>
            } @else {
              <span></span>
            }
          </div>
          @if (deployProgress().percent !== null) {
            <p class="muted progress-percent">{{ deployProgress().percent }}%</p>
          }
          @if (deployProgress().failed) {
            <p class="error-text">{{ deployError() }}</p>
          }
          <details class="deploy-details">
            <summary>View details</summary>
            <pre>{{ deployProgress().log.join('\\n') }}</pre>
          </details>
        </div>
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
            <label>Server name<input formControlName="displayName" /></label>
            <div class="modal-span-2 import-folder-row">
              <label>
                Server folder
                <input formControlName="installationDirectory" placeholder="C:\\Path\\To\\PalworldServer or a folder containing it" />
              </label>
              <button type="button" class="secondary" [disabled]="importDetecting() || !importForm.controls.installationDirectory.value" (click)="detectImportPaths()">
                {{ importDetecting() ? 'Detecting...' : 'Detect server from folder' }}
              </button>
            </div>
            <label>
              Palworld AdminPassword
              <input type="password" formControlName="adminPassword" placeholder="Blank uses the detected config password" />
              <small>If you enter a value, Palwarden writes it to PalWorldSettings.ini and stores the same value encrypted for REST API calls.</small>
            </label>
            <label>REST host<input formControlName="restApiHost" /></label>
            <label>REST port<input type="number" formControlName="restApiPort" /></label>
            <label>Game port<input type="number" formControlName="gamePort" /></label>
            <label>Query port<input type="number" formControlName="queryPort" /></label>
          </div>
          <div class="import-preview-actions">
            @if (importPreview(); as preview) {
              <span class="muted">
                Detected {{ preview.detected.executable ? 'executable' : 'no executable' }},
                {{ preview.detected.configuration ? 'config' : 'no config' }},
                {{ preview.detected.saveDirectory ? 'saves' : 'no saves yet' }}.
              </span>
            }
          </div>
          @if (importPreview(); as preview) {
            <div class="detected-paths">
              <div>
                <span>Install folder</span>
                <strong>{{ preview.installationDirectory }}</strong>
              </div>
              <div>
                <span>Executable</span>
                <strong>{{ preview.executablePath }}</strong>
              </div>
              <div>
                <span>Config file</span>
                <strong>{{ preview.configurationFilePath }}</strong>
              </div>
              <div>
                <span>Save folder</span>
                <strong>{{ preview.saveDirectory }}</strong>
              </div>
              <div>
                <span>Backup folder</span>
                <strong>{{ preview.backupDirectory }}</strong>
              </div>
              <div>
                <span>Admin credential</span>
                <strong>{{ importCredentialStatus(preview) }}</strong>
              </div>
            </div>
            <div class="warning-panel import-password-note">
              <strong>Palworld AdminPassword</strong>
              @if (preview.settings.adminPasswordConfigured && !importForm.controls.adminPassword.value) {
                <p>Palwarden will use the AdminPassword already present in the detected config file.</p>
              } @else if (importForm.controls.adminPassword.value) {
                <p>Palwarden will write the entered value to PalWorldSettings.ini and store the same value encrypted for API access.</p>
              } @else {
                <p>Enter the Palworld AdminPassword before importing so server controls can authenticate with the REST API.</p>
              }
            </div>
          }
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
            <button type="submit" [disabled]="importForm.invalid || !importPreview()">Import server</button>
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
  private readonly router = inject(Router);
  readonly servers = signal<ServerDashboardCard[]>([]);
  readonly users = signal<ManagedUser[]>([]);
  readonly modal = signal<'deploy' | 'import' | 'user' | null>(null);
  readonly userAction = signal<'enable' | 'disable' | 'delete' | 'password' | null>(null);
  readonly userActionCandidate = signal<ManagedUser | null>(null);
  readonly userActionSaving = signal(false);
  readonly message = signal('');
  readonly deploying = signal(false);
  readonly deployLog = signal<string[]>([]);
  readonly deployError = signal('');
  readonly importDetecting = signal(false);
  readonly importPreview = signal<ServerImportPreview | null>(null);
  readonly nexusState = signal<NexusConnectionState | null>(null);
  readonly nexusSaving = signal(false);
  readonly hostNetwork = signal<HostNetworkSettings | null>(null);
  readonly hostStartup = signal<HostStartupSettings | null>(null);
  readonly serverStartup = signal<HostServerStartupSettings | null>(null);
  readonly networkSaving = signal(false);
  readonly startupSaving = signal(false);
  readonly serverStartupSaving = signal(false);
  readonly startupServerSavingId = signal<string | null>(null);
  readonly deleteServerCandidate = signal<ServerDashboardCard | null>(null);
  readonly deleteServerFiles = signal(false);
  readonly deletingServer = signal(false);
  private deployTimer?: number;
  private messageTimer?: number;
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
    adminPassword: [''],
    gamePort: [8211, Validators.required],
    queryPort: [27015, Validators.required],
  });

  readonly userForm = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    role: ['ADMIN' as UserRole, Validators.required],
  });

  readonly userPasswordForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12)]],
  });

  readonly nexusForm = this.fb.nonNullable.group({
    apiKey: ['', Validators.required],
  });

  readonly networkForm = this.fb.nonNullable.group({
    webAccessMode: ['localhost' as 'localhost' | 'lan', Validators.required],
    port: [3333, [Validators.required, Validators.min(1), Validators.max(65535)]],
    acknowledgeExposure: [false],
  });

  constructor() {
    this.refreshServers();
    this.refreshUsers();
    this.refreshNexusState();
    this.refreshHostNetworkSettings();
    this.refreshHostStartupSettings();
    this.refreshHostServerStartupSettings();
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
    if (this.deploying()) return;
    this.modal.set(null);
    if (this.deployTimer) {
      window.clearInterval(this.deployTimer);
    }
  }

  openUserAction(user: ManagedUser, action: 'enable' | 'disable' | 'delete' | 'password'): void {
    this.userAction.set(action);
    this.userActionCandidate.set(user);
    this.userPasswordForm.reset({ password: '' });
  }

  closeUserAction(): void {
    if (this.userActionSaving()) return;
    this.userAction.set(null);
    this.userActionCandidate.set(null);
    this.userPasswordForm.reset({ password: '' });
  }

  private showMessage(message: string, durationMs = 3600): void {
    if (this.messageTimer) {
      window.clearTimeout(this.messageTimer);
    }
    this.message.set(message);
    const isError = /failed|could not|must|stop the server|not return/i.test(message);
    this.messageTimer = window.setTimeout(() => {
      if (this.message() === message) {
        this.message.set('');
      }
    }, isError ? Math.max(durationMs, 6500) : durationMs);
  }

  useDefaultDeployPath(): void {
    this.serversService.defaultInstallDirectory(this.deployForm.controls.displayName.value).subscribe(({ path }) => {
      this.deployForm.controls.installationDirectory.setValue(path);
    });
  }

  deployServer(): void {
    const raw = this.deployForm.getRawValue();
    this.deploying.set(true);
    this.deployError.set('');
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
        scheduledBackupsEnabled: false,
        scheduledBackupIntervalMinutes: 360,
        scheduledBackupRetentionCount: 10,
        forceStopAfterGracefulTimeout: false,
        startAfterInstall: raw.startAfterInstall,
        ...(raw.adminPassword ? { adminPassword: raw.adminPassword } : {}),
      })
      .then((job) => this.watchDeployJob(job))
      .catch((error: unknown) => {
        this.deploying.set(false);
        const message = error instanceof Error ? error.message : 'Could not start deployment.';
        this.deployError.set(message);
        this.deployLog.set([...this.deployLog(), message]);
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
      scheduledBackupsEnabled: false,
      scheduledBackupIntervalMinutes: 360,
      scheduledBackupRetentionCount: 10,
      forceStopAfterGracefulTimeout: false,
    };
    this.serversService.create(payload).subscribe({
      next: () => {
        this.showMessage('Server imported.');
        this.closeModal();
        this.refreshServers();
      },
      error: (error: unknown) => this.showMessage(`Import failed: ${this.formatHttpError(error)}`),
    });
  }

  importCredentialStatus(preview: ServerImportPreview): string {
    if (this.importForm.controls.adminPassword.value) {
      return 'Will write entered password';
    }
    return preview.settings.adminPasswordConfigured ? 'Will use config password' : 'Needs password';
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
        this.showMessage(preview.warnings.length ? 'Import detection completed with warnings.' : 'Import detection completed.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.importDetecting.set(false);
        this.importPreview.set(null);
        this.showMessage(`Detection failed: ${this.formatHttpError(error)}`);
      },
    });
  }

  private formatHttpError(error: unknown): string {
    const body = (error as { error?: { message?: unknown; error?: unknown } })?.error;
    const message = body?.message;
    if (Array.isArray(message)) {
      return message.join(' ');
    }
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    if (typeof body?.error === 'string' && body.error.trim()) {
      return body.error;
    }
    return 'Palwarden did not return a detailed reason. Check the backend log for the import request.';
  }

  createUser(): void {
    const raw = this.userForm.getRawValue();
    this.usersClient.create(raw).subscribe({
      next: () => {
        this.showMessage('User created.');
        this.closeModal();
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => this.showMessage(error.error?.message ?? 'Could not create user.'),
    });
  }

  changeUserRole(user: ManagedUser, role: string): void {
    if (role === user.role) return;
    this.usersClient.update(user.id, { role: role as UserRole }).subscribe({
      next: () => {
        this.showMessage('User role updated.');
        this.refreshUsers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.showMessage(error.error?.message ?? 'Could not update role.');
        this.refreshUsers();
      },
    });
  }

  confirmUserAction(): void {
    const user = this.userActionCandidate();
    const action = this.userAction();
    if (!user || !action || this.userActionSaving()) return;
    if (action === 'password' && this.userPasswordForm.invalid) return;
    this.userActionSaving.set(true);
    if (action === 'delete') {
      this.usersClient.remove(user.id).subscribe({
        next: () => this.finishUserAction('User deleted.'),
        error: (error: { error?: { message?: string } }) => this.failUserAction(error.error?.message ?? 'Could not delete user.'),
      });
      return;
    }
    const payload =
      action === 'password'
        ? { password: this.userPasswordForm.controls.password.value }
        : { disabled: action === 'disable' };
    this.usersClient.update(user.id, payload).subscribe({
      next: () => this.finishUserAction(action === 'password' ? 'Password updated.' : `User ${action === 'disable' ? 'disabled' : 'enabled'}.`),
      error: (error: { error?: { message?: string } }) => this.failUserAction(error.error?.message ?? 'Could not update user.'),
    });
  }

  userActionTitle(): string {
    const action = this.userAction();
    if (action === 'password') return 'Reset Password';
    if (action === 'delete') return 'Delete User';
    if (action === 'disable') return 'Disable User';
    return 'Enable User';
  }

  userActionConfirmLabel(): string {
    const action = this.userAction();
    if (action === 'password') return 'Update Password';
    if (action === 'delete') return 'Delete User';
    if (action === 'disable') return 'Disable User';
    return 'Enable User';
  }

  userActionDescription(user: ManagedUser): string {
    const action = this.userAction();
    if (action === 'password') return `Set a new Palwarden login password for ${user.username}.`;
    if (action === 'delete') return `Remove ${user.username} from Palwarden. This cannot be undone.`;
    if (action === 'disable') return `Prevent ${user.username} from logging in and clear active sessions.`;
    return `Allow ${user.username} to log in again.`;
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
        this.showMessage('Nexus Mods API key saved.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.nexusSaving.set(false);
        this.showMessage(error.error?.message ?? 'Could not validate Nexus Mods API key.');
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
        this.showMessage('Nexus Mods API key removed.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.nexusSaving.set(false);
        this.showMessage(error.error?.message ?? 'Could not remove Nexus Mods API key.');
      },
    });
  }

  saveNetworkSettings(): void {
    if (this.networkForm.invalid || this.networkSaving()) return;
    const raw = this.networkForm.getRawValue();
    this.networkSaving.set(true);
    this.serversService
      .saveHostNetworkSettings({
        webAccessMode: raw.webAccessMode,
        port: raw.port,
        acknowledgeExposure: raw.webAccessMode === 'lan' ? raw.acknowledgeExposure : true,
      })
      .subscribe({
        next: (settings) => {
          this.networkSaving.set(false);
          this.hostNetwork.set(settings);
          this.patchNetworkForm(settings);
          this.showMessage(settings.restartRequired ? 'Network access saved. A Palwarden restart is required before it takes effect.' : 'Network access saved.');
        },
        error: (error: { error?: { message?: string } }) => {
          this.networkSaving.set(false);
          this.showMessage(error.error?.message ?? 'Could not save network access settings.');
        },
      });
  }

  saveStartupSettings(startWithWindows: boolean): void {
    if (this.startupSaving()) return;
    this.startupSaving.set(true);
    this.serversService.saveHostStartupSettings({ startWithWindows }).subscribe({
      next: (settings) => {
        this.startupSaving.set(false);
        this.hostStartup.set(settings);
        this.showMessage(startWithWindows ? 'Palwarden will start when this Windows user logs in.' : 'Windows startup disabled.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.startupSaving.set(false);
        this.showMessage(error.error?.message ?? 'Could not update Windows startup.');
        this.refreshHostStartupSettings();
      },
    });
  }

  saveServerStartupSettings(startServersOnLaunch: boolean): void {
    if (this.serverStartupSaving()) return;
    this.serverStartupSaving.set(true);
    this.serversService.saveHostServerStartupSettings({ startServersOnLaunch }).subscribe({
      next: (settings) => {
        this.serverStartupSaving.set(false);
        this.serverStartup.set(settings);
        this.showMessage(startServersOnLaunch ? 'Selected servers will start with Palwarden.' : 'Server autostart policy disabled.');
      },
      error: (error: { error?: { message?: string } }) => {
        this.serverStartupSaving.set(false);
        this.showMessage(error.error?.message ?? 'Could not update server startup policy.');
        this.refreshHostServerStartupSettings();
      },
    });
  }

  toggleServerAutoStart(server: ServerDashboardCard, autoStart: boolean): void {
    if (this.startupServerSavingId()) return;
    this.startupServerSavingId.set(server.id);
    this.serversService.update(server.id, this.serverPayloadFromCard(server, autoStart)).subscribe({
      next: () => {
        this.startupServerSavingId.set(null);
        this.showMessage(autoStart ? `${server.displayName} selected for launch-time start.` : `${server.displayName} set to manual start.`);
        this.refreshServers();
        this.refreshHostServerStartupSettings();
      },
      error: (error: { error?: { message?: string } }) => {
        this.startupServerSavingId.set(null);
        this.showMessage(error.error?.message ?? 'Could not update server startup selection.');
        this.refreshServers();
      },
    });
  }

  browseFiles(server: ServerDashboardCard): void {
    this.serversService.openFolder(server.id).subscribe({
      next: () => this.showMessage(`Opened files for ${server.displayName}.`),
      error: () => this.showMessage('Could not open that server folder.'),
    });
  }

  openServerConfiguration(server: ServerDashboardCard): void {
    storeSelectedServerId(server.id);
    void this.router.navigate(['/server-configuration'], { queryParams: { server: server.id } });
  }

  toggleBackupPolicy(
    server: ServerDashboardCard,
    key: 'backupBeforeRestart' | 'backupBeforeUpdate' | 'backupBeforeConfigChange',
    value: boolean,
  ): void {
    this.serversService.update(server.id, this.serverPayloadFromCard(server, server.autoStart, { [key]: value })).subscribe({
      next: () => {
        this.showMessage('Backup policy updated.');
        this.refreshServers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.showMessage(error.error?.message ?? 'Could not update backup policy.');
        this.refreshServers();
      },
    });
  }

  toggleScheduledBackups(server: ServerDashboardCard, enabled: boolean): void {
    this.serversService.update(server.id, this.serverPayloadFromCard(server, server.autoStart, { scheduledBackupsEnabled: enabled })).subscribe({
      next: () => {
        this.showMessage(enabled ? 'Scheduled backups enabled.' : 'Scheduled backups disabled.');
        this.refreshServers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.showMessage(error.error?.message ?? 'Could not update scheduled backups.');
        this.refreshServers();
      },
    });
  }

  updateScheduledNumber(
    server: ServerDashboardCard,
    key: 'scheduledBackupIntervalMinutes' | 'scheduledBackupRetentionCount',
    value: number,
  ): void {
    if (!Number.isInteger(value)) return;
    const min = key === 'scheduledBackupIntervalMinutes' ? 1 : 1;
    const max = key === 'scheduledBackupIntervalMinutes' ? 10080 : 200;
    const cleaned = Math.min(Math.max(value, min), max);
    this.serversService.update(server.id, this.serverPayloadFromCard(server, server.autoStart, { [key]: cleaned })).subscribe({
      next: () => {
        this.showMessage('Scheduled backup setting updated.');
        this.refreshServers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.showMessage(error.error?.message ?? 'Could not update scheduled backup setting.');
        this.refreshServers();
      },
    });
  }

  deleteServer(server: ServerDashboardCard): void {
    if (server.runtimeState === 'running' || server.runtimeState === 'starting' || server.runtimeState === 'stopping') {
      this.showMessage('Stop the server before deleting its profile.');
      return;
    }
    this.deleteServerFiles.set(false);
    this.deleteServerCandidate.set(server);
  }

  cancelDeleteServer(): void {
    if (this.deletingServer()) return;
    this.deleteServerCandidate.set(null);
    this.deleteServerFiles.set(false);
  }

  confirmDeleteServer(): void {
    const server = this.deleteServerCandidate();
    if (!server || this.deletingServer()) return;
    this.deletingServer.set(true);
    const deleteFiles = this.deleteServerFiles();
    this.serversService.remove(server.id, { deleteFiles }).subscribe({
      next: () => {
        this.deletingServer.set(false);
        this.deleteServerCandidate.set(null);
        this.deleteServerFiles.set(false);
        this.showMessage(deleteFiles ? 'Server profile and files deleted.' : 'Server profile deleted.');
        this.refreshServers();
      },
      error: (error: { error?: { message?: string } }) => {
        this.deletingServer.set(false);
        this.showMessage(error.error?.message ?? 'Delete failed. Owner access is required, and the server must be stopped.');
      },
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

  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  numberValue(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  backupPolicyCount(): number {
    return this.servers().reduce((total, server) => total + this.enabledBackupPolicyCount(server), 0);
  }

  enabledBackupPolicyCount(server: ServerDashboardCard): number {
    return [server.backupBeforeRestart, server.backupBeforeUpdate, server.backupBeforeConfigChange].filter(Boolean).length;
  }

  scheduledBackupSummary(server: ServerDashboardCard): string {
    if (!server.scheduledBackupsEnabled) return 'Disabled';
    const next = server.scheduledBackupNextRunAt ? new Date(server.scheduledBackupNextRunAt).toLocaleString() : 'soon';
    return `Every ${server.scheduledBackupIntervalMinutes} min; next ${next}`;
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

  private refreshHostNetworkSettings(): void {
    this.serversService.hostNetworkSettings().subscribe({
      next: (settings) => {
        this.hostNetwork.set(settings);
        this.patchNetworkForm(settings);
      },
      error: () => this.hostNetwork.set(null),
    });
  }

  private refreshHostStartupSettings(): void {
    this.serversService.hostStartupSettings().subscribe({
      next: (settings) => this.hostStartup.set(settings),
      error: () => this.hostStartup.set(null),
    });
  }

  private refreshHostServerStartupSettings(): void {
    this.serversService.hostServerStartupSettings().subscribe({
      next: (settings) => this.serverStartup.set(settings),
      error: () => this.serverStartup.set(null),
    });
  }

  explainNetworkRestart(): void {
    this.showMessage('Close Palwarden fully, then open it again from the desktop shortcut or Start Menu to apply the saved network binding.');
  }

  private patchNetworkForm(settings: HostNetworkSettings): void {
    this.networkForm.patchValue({
      webAccessMode: settings.configured.webAccessMode,
      port: settings.configured.port,
      acknowledgeExposure: settings.configured.webAccessMode === 'lan',
    });
  }

  private finishUserAction(message: string): void {
    this.userActionSaving.set(false);
    this.closeUserAction();
    this.showMessage(message);
    this.refreshUsers();
  }

  private failUserAction(message: string): void {
    this.userActionSaving.set(false);
    this.showMessage(message);
  }

  private serverPayloadFromCard(
    server: ServerDashboardCard,
    autoStart: boolean,
    overrides: Partial<
      Pick<
        ServerPayload,
        | 'backupBeforeRestart'
        | 'backupBeforeUpdate'
        | 'backupBeforeConfigChange'
        | 'scheduledBackupsEnabled'
        | 'scheduledBackupIntervalMinutes'
        | 'scheduledBackupRetentionCount'
      >
    > = {},
  ): ServerPayload {
    return {
      displayName: server.displayName,
      ...(server.description ? { description: server.description } : {}),
      installationDirectory: server.installationDirectory,
      executablePath: server.executablePath,
      workingDirectory: server.workingDirectory,
      configurationFilePath: server.configurationFilePath,
      saveDirectory: server.saveDirectory,
      backupDirectory: server.backupDirectory,
      restApiHost: server.restApiHost,
      restApiPort: server.restApiPort,
      gamePort: server.gamePort,
      queryPort: server.queryPort,
      launchArguments: server.launchArguments,
      autoStart,
      autoRestart: server.autoRestart,
      backupBeforeRestart: overrides.backupBeforeRestart ?? server.backupBeforeRestart,
      backupBeforeUpdate: overrides.backupBeforeUpdate ?? server.backupBeforeUpdate,
      backupBeforeConfigChange: overrides.backupBeforeConfigChange ?? server.backupBeforeConfigChange,
      scheduledBackupsEnabled: overrides.scheduledBackupsEnabled ?? server.scheduledBackupsEnabled,
      scheduledBackupIntervalMinutes: overrides.scheduledBackupIntervalMinutes ?? server.scheduledBackupIntervalMinutes,
      scheduledBackupRetentionCount: overrides.scheduledBackupRetentionCount ?? server.scheduledBackupRetentionCount,
      forceStopAfterGracefulTimeout: server.forceStopAfterGracefulTimeout,
    };
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
          this.showMessage('Server deployed.');
          this.deployError.set('');
          this.deployLog.set(status.log);
          this.closeModal();
          this.refreshServers();
          this.navigateToDashboard(status.serverInstanceId);
        }
        if (status.status === 'error') {
          this.deploying.set(false);
          this.deployError.set(status.error ?? 'Deployment failed.');
          this.deployLog.set([...status.log, status.error ?? 'Deployment failed.']);
          if (this.deployTimer) {
            window.clearInterval(this.deployTimer);
          }
        }
      });
    }, 1500);
  }

  deployProgress() {
    return deployProgressView(this.deployLog(), this.deployError() ? 'error' : this.deploying() ? 'running' : 'done', this.deployError() || null);
  }

  private navigateToDashboard(serverInstanceId: string | null): void {
    if (!serverInstanceId) {
      void this.router.navigateByUrl('/dashboard');
      return;
    }
    storeSelectedServerId(serverInstanceId);
    void this.router.navigate(['/dashboard'], { queryParams: { server: serverInstanceId } });
  }

  dismissDeployProgress(): void {
    if (this.deploying()) return;
    this.deployLog.set([]);
    this.deployError.set('');
  }
}
