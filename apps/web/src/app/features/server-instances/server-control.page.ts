import { Component, inject, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonInput, IonItem, IonTextarea, IonToast } from '@ionic/angular/standalone';
import type { ServerDashboardCard } from '@palwarden/shared';
import { ServerInstancesService } from './server-instances.service';
import type { BackupRecordView, DeployJob, ServerUpdateAvailability } from './server-instances.service';
import { selectServerFromRoute } from './selected-server';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonInput, IonItem, IonTextarea, IonToast],
  template: `
    @if (server(); as item) {
      <section class="panel-grid server-control-grid">
        <article class="panel server-actions-panel">
          <div class="panel-header">
            <h2>{{ item.displayName }}</h2>
            <span class="state-badge" [class.online]="item.runtimeState === 'running'">{{ item.runtimeState }}</span>
          </div>
          <div class="stat-grid">
            <div><span>REST</span><strong>{{ item.restConnectivity }}</strong></div>
            <div><span>Players</span><strong>{{ item.currentPlayers ?? 0 }}/{{ item.maxPlayers ?? 0 }}</strong></div>
            <div><span>Server FPS</span><strong>{{ item.serverFps ?? 'n/a' }}</strong></div>
            <div><span>Uptime</span><strong>{{ formatUptime(item.uptimeSeconds) }}</strong></div>
            <div><span>CPU</span><strong>{{ formatPercent(item.hostCpuPercent) }}</strong></div>
            <div><span>RAM</span><strong>{{ formatMemory(item.hostMemoryMb) }}</strong></div>
            <div><span>CPU Avg</span><strong>{{ formatPercent(item.processCpuAveragePercent) }}</strong></div>
            <div><span>CPU Peak</span><strong>{{ formatPercent(item.processCpuPeakPercent) }}</strong></div>
            <div><span>Private RAM</span><strong>{{ formatMemory(item.processPrivateMemoryMb) }}</strong></div>
            <div><span>Peak RAM</span><strong>{{ formatMemory(item.processPeakMemoryMb) }}</strong></div>
            <div><span>Install Size</span><strong>{{ formatMemory(item.installDirectorySizeMb) }}</strong></div>
            <div><span>Save Size</span><strong>{{ formatMemory(item.saveDirectorySizeMb) }}</strong></div>
            <div><span>Backup Size</span><strong>{{ formatMemory(item.backupDirectorySizeMb) }}</strong></div>
            <div><span>Drive Free</span><strong>{{ formatMemory(item.driveFreeSpaceMb) }}</strong></div>
            <!-- Keep the REST-reported live version available for future diagnostics.
            <div><span>Live Server Version</span><strong>{{ liveServerVersionText(item) }}</strong></div>
            -->
          </div>
          <div class="control-row">
            <ion-button (click)="start()" [disabled]="item.runtimeState === 'running' || item.runtimeState === 'starting'">Start</ion-button>
            <ion-button color="warning" (click)="stop()" [disabled]="item.runtimeState === 'stopped' || item.runtimeState === 'stopping'">Stop</ion-button>
            <ion-button fill="outline" (click)="restart()">Restart</ion-button>
            <ion-button fill="outline" (click)="saveWorld()">Save World</ion-button>
          </div>
        </article>

        <article class="panel maintenance-panel">
          <div class="panel-header">
            <div>
              <h2>Server Update</h2>
              <p class="muted">
                Update this Palworld Dedicated Server with SteamCMD. Running servers can notify players, shut down, then update.
              </p>
            </div>
            <div class="control-row">
              <ion-button fill="outline" (click)="openUpdateFlow(item)" [disabled]="maintenanceBusy()">Update Server</ion-button>
              <ion-button
                fill="outline"
                (click)="validate()"
                [disabled]="maintenanceBusy() || item.runtimeState === 'running' || item.runtimeState === 'starting' || item.runtimeState === 'stopping'"
              >
                Validate Files
              </ion-button>
            </div>
          </div>
          <div class="stat-grid update-version-grid">
            <div><span>Installed Build</span><strong>{{ updateAvailability()?.installedBuildId ?? 'unknown' }}</strong></div>
            <div><span>Latest Steam Build</span><strong>{{ updateAvailability()?.latestBuildId ?? 'unknown' }}</strong></div>
            <div>
              <span>Update Status</span>
              <strong [class.update-available]="updateAvailability()?.updateAvailable">
                {{ updateStatusText() }}
              </strong>
            </div>
          </div>
          @if (maintenanceJob()?.status === 'error') {
            <p class="error-text">{{ maintenanceJob()?.error || 'Maintenance failed.' }}</p>
          }
        </article>

        <article class="panel broadcast-panel">
          <h2>Broadcast</h2>
          <form [formGroup]="broadcastForm" (ngSubmit)="broadcast()">
            <ion-item><ion-textarea label="Message" formControlName="message" /></ion-item>
            <ion-button type="submit" [disabled]="!broadcastForm.value.message">Broadcast Message</ion-button>
          </form>
        </article>

        <article class="panel shutdown-panel">
          <h2>Shutdown Countdown</h2>
          <form [formGroup]="shutdownForm" (ngSubmit)="shutdownCountdown()">
            <ion-item><ion-input label="Seconds" type="number" formControlName="seconds" /></ion-item>
            <ion-item><ion-input label="Message" formControlName="message" /></ion-item>
            <ion-button color="warning" type="submit">Start Countdown</ion-button>
          </form>
        </article>

        <article class="panel backup-panel">
          <div class="panel-header">
            <div>
              <h2>Backups</h2>
              <p class="muted">Save the world when running, then archive the configured save directory.</p>
            </div>
            <div class="control-row">
              <ion-button fill="outline" (click)="backup()" [disabled]="backupBusy()">Backup Save</ion-button>
              <button class="danger-button compact" type="button" [disabled]="backupBusy() || failedBackupCount() === 0" (click)="deleteFailedBackups()">
                Delete Failed
              </button>
            </div>
          </div>
          @if (backupMessage()) {
            <p class="inline-message">{{ backupMessage() }}</p>
          }
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Location</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (backup of backups(); track backup.id) {
                  <tr>
                    <td>{{ formatDate(backup.createdAt) }}</td>
                    <td>
                      <span class="state-badge" [class.online]="backup.success">{{ backup.success ? 'ready' : 'failed' }}</span>
                      @if (backup.failureMessage) {
                        <span class="table-details">{{ backup.failureMessage }}</span>
                      }
                    </td>
                    <td>{{ formatBytes(backup.sizeBytes) }}</td>
                    <td class="path-cell">{{ backup.filePath }}</td>
                    <td class="table-actions">
                      <button class="secondary-button compact" type="button" [disabled]="!backup.success || item.runtimeState === 'running'" (click)="restoreBackup(backup)">
                        Restore
                      </button>
                      <button class="danger-button compact" type="button" (click)="deleteBackup(backup)">Delete</button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="muted">No backups yet.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </article>
      </section>
    } @else {
      <section class="empty-state">Add a server before using server controls.</section>
    }
    @if (updateModalOpen()) {
      <div class="modal-backdrop">
        <form class="modal-panel" [formGroup]="updateForm" (ngSubmit)="beginUpdate()">
          <header>
            <div>
              <h2>Update Running Server</h2>
              <p class="muted">Palwarden will broadcast this message, request a shutdown countdown, then update after the server stops.</p>
            </div>
            <button class="secondary" type="button" (click)="closeUpdateFlow()">Close</button>
          </header>
          <div class="modal-grid">
            <label>Shutdown delay seconds<input type="number" formControlName="shutdownWaitSeconds" /></label>
            <label class="modal-wide">Broadcast message<input formControlName="broadcastMessage" /></label>
          </div>
          <footer>
            <span class="muted">Players should reconnect after the update finishes and the server is started again.</span>
            <button type="submit" [disabled]="maintenanceBusy()">Broadcast, Stop, and Update</button>
          </footer>
        </form>
      </div>
    }
    @if (restoreCandidate(); as backup) {
      <div class="modal-backdrop">
        <div class="modal-panel">
          <header>
            <div>
              <h2>Restore Backup</h2>
              <p class="muted">Review the backup before replacing the current save directory.</p>
            </div>
            <button class="secondary" type="button" (click)="closeRestoreModal()">Close</button>
          </header>
          <dl class="restore-preview">
            <div><dt>Created</dt><dd>{{ formatDate(backup.createdAt) }}</dd></div>
            <div><dt>Trigger</dt><dd>{{ backup.triggerType }}</dd></div>
            <div><dt>Size</dt><dd>{{ formatBytes(backup.sizeBytes) }}</dd></div>
            <div><dt>File</dt><dd class="path-cell">{{ backup.filePath }}</dd></div>
          </dl>
          <p class="error-text">The server must stay stopped. Palwarden will create an emergency backup of the current save folder before restoring this backup.</p>
          <footer>
            <span class="muted">Type RESTORE in the confirmation box after pressing restore.</span>
            <button class="danger-button" type="button" (click)="confirmRestoreBackup(backup)">Restore backup</button>
          </footer>
        </div>
      </div>
    }
    @if (actionBusy()) {
      <div class="modal-backdrop">
        <div class="modal-panel action-progress-modal">
          <header>
            <div>
              <h2>{{ actionTitle() }}</h2>
              <p class="muted">{{ actionMessage() }}</p>
            </div>
          </header>
          <div class="indeterminate-bar"><span></span></div>
          <div class="spinner-line">
            <span class="loading-spinner"></span>
            <span>{{ actionDetail() }}</span>
          </div>
        </div>
      </div>
    }
    <ion-toast
      [isOpen]="toastOpen()"
      [message]="toastMessage()"
      [color]="toastColor()"
      [duration]="2600"
      position="bottom"
      (didDismiss)="toastOpen.set(false)"
    />
  `,
})
export class ServerControlPage implements OnDestroy {
  private readonly service = inject(ServerInstancesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly backups = signal<BackupRecordView[]>([]);
  readonly toastOpen = signal(false);
  readonly toastMessage = signal('');
  readonly toastColor = signal<'success' | 'danger'>('success');
  readonly actionBusy = signal(false);
  readonly actionTitle = signal('Working');
  readonly actionMessage = signal('Palwarden is processing the request.');
  readonly actionDetail = signal('Waiting for completion...');
  readonly backupMessage = signal('');
  readonly backupBusy = signal(false);
  readonly maintenanceJob = signal<DeployJob | null>(null);
  readonly updateAvailability = signal<ServerUpdateAvailability | null>(null);
  readonly updateModalOpen = signal(false);
  readonly restoreCandidate = signal<BackupRecordView | null>(null);
  readonly broadcastForm = this.fb.nonNullable.group({ message: [''] });
  readonly shutdownForm = this.fb.nonNullable.group({ seconds: [30], message: ['Server shutting down.'] });
  readonly updateForm = this.fb.nonNullable.group({
    shutdownWaitSeconds: [60],
    broadcastMessage: ['Palwarden is updating this server. Please reconnect after maintenance is complete.'],
  });
  private readonly refreshTimer = window.setInterval(() => this.refresh(), 3000);
  private updatePollTimer: number | null = null;
  private actionPollTimer: number | null = null;
  private backupsLoadedFor: string | null = null;
  private updateAvailabilityLoadedFor: string | null = null;

  constructor() {
    this.refresh(true);
  }

  ngOnDestroy(): void {
    window.clearInterval(this.refreshTimer);
    this.stopUpdatePolling();
    this.stopActionPolling();
  }

  refresh(loadBackups = false): void {
    this.service.dashboard().subscribe((servers) => {
      const selected = selectServerFromRoute(servers, this.route, this.router);
      this.server.set(selected);
      if (selected && (loadBackups || selected.id !== this.backupsLoadedFor)) {
        this.loadBackups(selected.id);
      }
      if (selected && selected.id !== this.updateAvailabilityLoadedFor) {
        this.loadUpdateAvailability(selected.id);
      }
    });
  }

  start(): void {
    const server = this.server();
    if (server) {
      this.service.start(server.id).subscribe({
        next: () => {
          this.showToast('Start requested.');
          this.refresh();
        },
        error: (error: { error?: { message?: string } }) => this.showToast(error.error?.message ?? 'Could not start server.', 'danger'),
      });
    }
  }

  stop(): void {
    const server = this.server();
    if (server && confirm('Request save and graceful shutdown for this server?')) {
      this.beginAction('Stopping Server', 'Saving the world, sending the graceful shutdown request, then waiting for the server to stop.');
      this.service.gracefulStop(server.id).subscribe({
        next: () => {
          this.actionDetail.set('Waiting for the server process to stop...');
          this.refresh();
          this.waitForServerState(server.id, ['stopped', 'failed', 'unknown'], 'Server stopped.');
        },
        error: (error: { error?: { message?: string } }) => {
          this.endAction();
          this.showToast(error.error?.message ?? 'Could not stop server.', 'danger');
        },
      });
    }
  }

  restart(): void {
    const server = this.server();
    if (server && confirm('Restart this server?')) {
      this.beginAction('Restarting Server', 'Saving, shutting down, waiting for the process to exit, then starting again.');
      this.service.restart(server.id).subscribe({
        next: () => {
          this.endAction();
          this.showToast('Server restarted.');
          this.refresh();
          this.loadBackups(server.id);
        },
        error: (error: { error?: { message?: string } }) => {
          this.endAction();
          this.showToast(error.error?.message ?? 'Could not restart server.', 'danger');
        },
      });
    }
  }

  openUpdateFlow(server: ServerDashboardCard): void {
    if (server.runtimeState === 'stopped' || server.runtimeState === 'failed' || server.runtimeState === 'unknown') {
      this.startUpdate({});
      return;
    }
    this.updateForm.patchValue({
      shutdownWaitSeconds: 60,
      broadcastMessage: 'Palwarden is updating this server. Please reconnect after maintenance is complete.',
    });
    this.updateModalOpen.set(true);
  }

  closeUpdateFlow(): void {
    this.updateModalOpen.set(false);
  }

  beginUpdate(): void {
    this.updateModalOpen.set(false);
    this.startUpdate({
      shutdownWaitSeconds: this.updateForm.controls.shutdownWaitSeconds.value,
      broadcastMessage: this.updateForm.controls.broadcastMessage.value,
    });
  }

  maintenanceBusy(): boolean {
    return this.maintenanceJob()?.status === 'running';
  }

  private startUpdate(payload: { broadcastMessage?: string; shutdownWaitSeconds?: number }): void {
    const server = this.server();
    if (!server || this.maintenanceBusy()) return;
    this.beginAction('Updating Server', 'Creating a safety backup, stopping the server if needed, then running SteamCMD.');
    this.service.updateServer(server.id, payload).subscribe({
      next: (job) => {
        this.maintenanceJob.set(job);
        this.actionDetail.set('SteamCMD update is running...');
        this.pollMaintenance(job.id, 'update');
      },
      error: (error: { error?: { message?: string } }) => {
        this.endAction();
        this.showToast(error.error?.message ?? 'Could not start server update.', 'danger');
      },
    });
  }

  validate(): void {
    const server = this.server();
    if (!server || this.maintenanceBusy()) return;
    this.beginAction('Validating Files', 'SteamCMD is checking the installed Palworld server files.');
    this.service.validateServer(server.id).subscribe({
      next: (job) => {
        this.maintenanceJob.set(job);
        this.actionDetail.set('SteamCMD validation is running...');
        this.pollMaintenance(job.id, 'validation');
      },
      error: (error: { error?: { message?: string } }) => {
        this.endAction();
        this.showToast(error.error?.message ?? 'Could not start validation.', 'danger');
      },
    });
  }

  saveWorld(): void {
    const server = this.server();
    if (server) {
      this.beginAction('Saving World', 'Palwarden is asking the Palworld REST API to save the current world.');
      this.service.saveWorld(server.id).subscribe({
        next: () => {
          this.endAction();
          this.showToast('World save command completed successfully.');
        },
        error: (error: { error?: { message?: string } }) => {
          this.endAction();
          this.showToast(error.error?.message ?? 'Could not save world.', 'danger');
        },
      });
    }
  }

  broadcast(): void {
    const server = this.server();
    const text = this.broadcastForm.controls.message.value.trim();
    if (server && text) {
      this.beginAction('Sending Broadcast', 'Palwarden is sending the message through the Palworld REST API.');
      this.service.announce(server.id, text).subscribe({
        next: () => {
          this.endAction();
          this.broadcastForm.reset();
          this.showToast('Broadcast sent.');
        },
        error: (error: { error?: { message?: string } }) => {
          this.endAction();
          this.showToast(error.error?.message ?? 'Could not send broadcast.', 'danger');
        },
      });
    }
  }

  shutdownCountdown(): void {
    const server = this.server();
    if (server) {
      this.beginAction('Starting Countdown', 'Palwarden is sending the shutdown countdown to the server.');
      this.service
        .shutdownCountdown(server.id, this.shutdownForm.controls.seconds.value, this.shutdownForm.controls.message.value)
        .subscribe({
          next: () => {
            this.endAction();
            this.showToast('Shutdown countdown started.');
            this.refresh();
          },
          error: (error: { error?: { message?: string } }) => {
            this.endAction();
            this.showToast(error.error?.message ?? 'Could not start countdown.', 'danger');
          },
        });
    }
  }

  backup(): void {
    const server = this.server();
    if (!server || this.backupBusy()) return;
    this.backupBusy.set(true);
    this.backupMessage.set('Creating backup...');
    this.beginAction('Creating Backup', 'Saving the world if needed, then compressing the save directory.');
    this.service.backup(server.id).subscribe({
      next: () => {
        this.endAction();
        this.backupMessage.set('');
        this.showToast('Backup created.');
        this.backupBusy.set(false);
        this.loadBackups(server.id);
      },
      error: (error: { error?: { message?: string } }) => {
        this.endAction();
        this.backupMessage.set(error.error?.message ?? 'Could not create backup.');
        this.backupBusy.set(false);
        this.loadBackups(server.id);
      },
    });
  }

  deleteBackup(backup: BackupRecordView): void {
    const server = this.server();
    if (!server || !confirm(`Delete backup from ${this.formatDate(backup.createdAt)}?`)) return;
    this.service.deleteBackup(server.id, backup.id).subscribe(() => {
      this.backupMessage.set('');
      this.showToast('Backup deleted.');
      this.loadBackups(server.id);
    });
  }

  deleteFailedBackups(): void {
    const server = this.server();
    const count = this.failedBackupCount();
    if (!server || count === 0 || !confirm(`Delete ${count} failed backup record${count === 1 ? '' : 's'}?`)) return;
    this.service.deleteFailedBackups(server.id).subscribe((result) => {
      this.backupMessage.set('');
      this.showToast(`Deleted ${result.deleted} failed backup record${result.deleted === 1 ? '' : 's'}.`);
      this.loadBackups(server.id);
    });
  }

  restoreBackup(backup: BackupRecordView): void {
    const server = this.server();
    if (!server || !backup.success) return;
    if (server.runtimeState === 'running' || server.runtimeState === 'starting' || server.runtimeState === 'stopping') {
      this.showToast('Stop the server before restoring a backup.', 'danger');
      return;
    }
    this.restoreCandidate.set(backup);
  }

  closeRestoreModal(): void {
    this.restoreCandidate.set(null);
  }

  confirmRestoreBackup(backup: BackupRecordView): void {
    const server = this.server();
    if (!server) return;
    const confirmation = prompt(`Restore backup from ${this.formatDate(backup.createdAt)}? Type RESTORE to replace the current save data.`);
    if (confirmation !== 'RESTORE') return;
    this.restoreCandidate.set(null);
    this.backupBusy.set(true);
    this.beginAction('Restoring Backup', 'Creating an emergency backup, clearing the save directory, then expanding the selected backup.');
    this.service.restoreBackup(server.id, backup.id).subscribe({
      next: (result) => {
        this.endAction();
        this.backupMessage.set('');
        this.showToast(result.emergencyBackup ? 'Backup restored. Emergency backup was created first.' : 'Backup restored.');
        this.backupBusy.set(false);
        this.loadBackups(server.id);
      },
      error: (error: { error?: { message?: string } }) => {
        this.endAction();
        this.showToast(error.error?.message ?? 'Could not restore backup.', 'danger');
        this.backupBusy.set(false);
        this.loadBackups(server.id);
      },
    });
  }

  showToast(message: string, color: 'success' | 'danger' = 'success'): void {
    this.toastMessage.set(message);
    this.toastColor.set(color);
    this.toastOpen.set(true);
  }

  private pollMaintenance(jobId: string, label: 'update' | 'validation'): void {
    this.stopUpdatePolling();
    this.updatePollTimer = window.setInterval(() => {
      this.service.maintenanceStatus(jobId).subscribe((job) => {
        this.maintenanceJob.set(job);
        if (job.status !== 'running') {
          this.stopUpdatePolling();
          this.endAction();
          this.refresh();
          const server = this.server();
          if (server) {
            this.loadUpdateAvailability(server.id);
            this.loadBackups(server.id);
          }
          this.showToast(
            job.status === 'done' ? `Server ${label} complete.` : job.error || `Server ${label} failed.`,
            job.status === 'done' ? 'success' : 'danger',
          );
        }
      });
    }, 2000);
  }

  private stopUpdatePolling(): void {
    if (this.updatePollTimer !== null) {
      window.clearInterval(this.updatePollTimer);
      this.updatePollTimer = null;
    }
  }

  private waitForServerState(serverId: string, states: ServerDashboardCard['runtimeState'][], successMessage: string): void {
    this.stopActionPolling();
    this.actionPollTimer = window.setInterval(() => {
      this.service.dashboard().subscribe((servers) => {
        const current = servers.find((server) => server.id === serverId);
        if (current) {
          this.server.set(current);
        }
        if (!current || states.includes(current.runtimeState)) {
          this.stopActionPolling();
          this.endAction();
          this.showToast(successMessage);
        }
      });
    }, 1500);
  }

  private stopActionPolling(): void {
    if (this.actionPollTimer !== null) {
      window.clearInterval(this.actionPollTimer);
      this.actionPollTimer = null;
    }
  }

  private beginAction(title: string, message: string): void {
    this.stopActionPolling();
    this.actionTitle.set(title);
    this.actionMessage.set(message);
    this.actionDetail.set('Waiting for completion...');
    this.actionBusy.set(true);
  }

  private endAction(): void {
    this.actionBusy.set(false);
  }

  loadBackups(id: string): void {
    this.service.backups(id).subscribe((records) => {
      this.backupsLoadedFor = id;
      this.backups.set(records);
    });
  }

  loadUpdateAvailability(id: string): void {
    this.updateAvailabilityLoadedFor = id;
    this.service.updateAvailability(id).subscribe({
      next: (availability) => this.updateAvailability.set(availability),
      error: () => this.updateAvailability.set(null),
    });
  }

  updateStatusText(): string {
    const availability = this.updateAvailability();
    if (!availability) return 'checking';
    if (!availability.installedBuildId || !availability.latestBuildId) return 'unknown';
    return availability.updateAvailable ? 'update available' : 'up to date';
  }

  liveServerVersionText(server: ServerDashboardCard): string {
    if (server.installedVersion) return server.installedVersion;
    if (server.runtimeState === 'stopped') return 'server stopped';
    if (server.restConnectivity === 'offline') return 'REST offline';
    if (server.restConnectivity === 'auth_failed') return 'auth failed';
    return 'unknown';
  }

  failedBackupCount(): number {
    return this.backups().filter((backup) => !backup.success).length;
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  formatBytes(value: number): string {
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  formatUptime(value: number | null): string {
    if (!value) return 'n/a';
    const minutes = Math.floor(value / 60);
    return `${minutes}m`;
  }

  formatPercent(value: number | null): string {
    return value === null ? 'n/a' : `${value.toFixed(1)}%`;
  }

  formatMemory(value: number | null): string {
    return value === null ? 'n/a' : `${value.toFixed(1)} MB`;
  }
}
