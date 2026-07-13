import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonButton, IonInput, IonItem, IonTextarea } from '@ionic/angular/standalone';
import type { ServerDashboardCard } from '@palwarden/shared';
import { ServerInstancesService } from './server-instances.service';
import { selectServerFromRoute } from './selected-server';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonInput, IonItem, IonTextarea],
  template: `
    @if (server(); as item) {
      <section class="panel-grid">
        <article class="panel">
          <div class="panel-header">
            <h2>{{ item.displayName }}</h2>
            <span class="state-badge" [class.online]="item.runtimeState === 'running'">{{ item.runtimeState }}</span>
          </div>
          <div class="stat-grid">
            <div><span>REST</span><strong>{{ item.restConnectivity }}</strong></div>
            <div><span>Players</span><strong>{{ item.currentPlayers ?? 0 }}/{{ item.maxPlayers ?? 0 }}</strong></div>
            <div><span>FPS</span><strong>{{ item.serverFps ?? 'n/a' }}</strong></div>
            <div><span>Uptime</span><strong>{{ formatUptime(item.uptimeSeconds) }}</strong></div>
          </div>
          <div class="control-row">
            <ion-button (click)="start()" [disabled]="item.runtimeState === 'running' || item.runtimeState === 'starting'">Start</ion-button>
            <ion-button color="warning" (click)="stop()" [disabled]="item.runtimeState === 'stopped' || item.runtimeState === 'stopping'">Stop</ion-button>
            <ion-button fill="outline" (click)="restart()">Restart</ion-button>
            <ion-button fill="outline" (click)="saveWorld()">Save World</ion-button>
          </div>
        </article>

        <article class="panel">
          <h2>Broadcast</h2>
          <form [formGroup]="broadcastForm" (ngSubmit)="broadcast()">
            <ion-item><ion-textarea label="Message" formControlName="message" /></ion-item>
            <ion-button type="submit" [disabled]="!broadcastForm.value.message">Broadcast Message</ion-button>
          </form>
        </article>

        <article class="panel">
          <h2>Shutdown Countdown</h2>
          <form [formGroup]="shutdownForm" (ngSubmit)="shutdownCountdown()">
            <ion-item><ion-input label="Seconds" type="number" formControlName="seconds" /></ion-item>
            <ion-item><ion-input label="Message" formControlName="message" /></ion-item>
            <ion-button color="warning" type="submit">Start Countdown</ion-button>
          </form>
        </article>

        <article class="panel">
          <h2>Backups</h2>
          <p class="muted">Manual backup wiring is next. The control is present so the workflow has a home.</p>
          <ion-button fill="outline" (click)="backup()">Backup Save</ion-button>
          @if (message()) {
            <p class="muted">{{ message() }}</p>
          }
        </article>
      </section>
    } @else {
      <section class="empty-state">Add a server before using server controls.</section>
    }
  `,
})
export class ServerControlPage {
  private readonly service = inject(ServerInstancesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly message = signal('');
  readonly broadcastForm = this.fb.nonNullable.group({ message: [''] });
  readonly shutdownForm = this.fb.nonNullable.group({ seconds: [30], message: ['Server shutting down.'] });

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.service.dashboard().subscribe((servers) => this.server.set(selectServerFromRoute(servers, this.route, this.router)));
  }

  start(): void {
    const server = this.server();
    if (server) this.service.start(server.id).subscribe(() => this.refresh());
  }

  stop(): void {
    const server = this.server();
    if (server && confirm('Request save and graceful shutdown for this server?')) {
      this.service.gracefulStop(server.id).subscribe(() => this.refresh());
    }
  }

  restart(): void {
    const server = this.server();
    if (server && confirm('Restart this server?')) {
      this.service.restart(server.id).subscribe(() => this.refresh());
    }
  }

  saveWorld(): void {
    const server = this.server();
    if (server) this.service.saveWorld(server.id).subscribe(() => this.message.set('World save requested.'));
  }

  broadcast(): void {
    const server = this.server();
    const text = this.broadcastForm.controls.message.value.trim();
    if (server && text) this.service.announce(server.id, text).subscribe(() => this.message.set('Broadcast sent.'));
  }

  shutdownCountdown(): void {
    const server = this.server();
    if (server) {
      this.service
        .shutdownCountdown(server.id, this.shutdownForm.controls.seconds.value, this.shutdownForm.controls.message.value)
        .subscribe(() => this.refresh());
    }
  }

  backup(): void {
    const server = this.server();
    if (server) this.service.backup(server.id).subscribe((result) => this.message.set(result.message));
  }

  formatUptime(value: number | null): string {
    if (!value) return 'n/a';
    const minutes = Math.floor(value / 60);
    return `${minutes}m`;
  }
}
