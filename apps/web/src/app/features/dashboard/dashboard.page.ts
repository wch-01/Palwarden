import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButton } from '@ionic/angular/standalone';
import type { ServerDashboardCard } from '@palwarden/shared';
import { ServerInstancesService } from '../server-instances/server-instances.service';
import { selectServerFromRoute } from '../server-instances/selected-server';

@Component({
  standalone: true,
  imports: [RouterLink, IonButton],
  template: `
    @if (server(); as item) {
      <section class="dashboard-hero">
        <div>
          <h2>{{ item.displayName }}</h2>
          <p>{{ item.description || 'No description configured.' }}</p>
        </div>
        <span class="state-badge" [class.online]="item.runtimeState === 'running'">{{ item.runtimeState }}</span>
      </section>

      <section class="stat-grid dashboard-stats">
        <div><span>REST API</span><strong>{{ item.restConnectivity }}</strong></div>
        <div><span>Players</span><strong>{{ item.currentPlayers ?? 0 }}/{{ item.maxPlayers ?? 0 }}</strong></div>
        <div><span>Server FPS</span><strong>{{ item.serverFps ?? 'n/a' }}</strong></div>
        <div><span>Version</span><strong>{{ item.installedVersion ?? 'unknown' }}</strong></div>
        <div><span>CPU Usage</span><strong>{{ formatPercent(item.hostCpuPercent) }}</strong></div>
        <div><span>RAM Usage</span><strong>{{ formatMemory(item.hostMemoryMb) }}</strong></div>
        <div><span>CPU Avg/Peak</span><strong>{{ formatPercent(item.processCpuAveragePercent) }} / {{ formatPercent(item.processCpuPeakPercent) }}</strong></div>
        <div><span>Private RAM</span><strong>{{ formatMemory(item.processPrivateMemoryMb) }}</strong></div>
        <div><span>Save Size</span><strong>{{ formatMemory(item.saveDirectorySizeMb) }}</strong></div>
        <div><span>Drive Free</span><strong>{{ formatMemory(item.driveFreeSpaceMb) }}</strong></div>
        <div><span>Installed Mods</span><strong>0</strong></div>
        <div><span>Uptime</span><strong>{{ formatUptime(item.uptimeSeconds) }}</strong></div>
      </section>

      <section class="panel-grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Player Roster</h2>
            <ion-button size="small" fill="outline" (click)="loadRoster()">Refresh</ion-button>
          </div>
          @if (players().length) {
            <table class="data-table">
              <thead><tr><th>Name</th><th>Level</th><th>Steam ID</th></tr></thead>
              <tbody>
                @for (player of players(); track player.name + '-' + player.steamid) {
                  <tr><td>{{ player.name || 'Unknown' }}</td><td>{{ player.level ?? 'n/a' }}</td><td>{{ player.steamid || 'n/a' }}</td></tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="muted">No online players reported by the REST API.</p>
          }
        </article>

        <article class="panel">
          <h2>Guild Roster</h2>
          <p class="muted">Guild data is not exposed by the current Palwarden client yet.</p>
        </article>

        <article class="panel">
          <h2>Useful Links</h2>
          <div class="control-row">
            <ion-button routerLink="/server-control" [queryParams]="{ server: item.id }">Open Controls</ion-button>
            <ion-button fill="outline" routerLink="/server-configuration" [queryParams]="{ server: item.id }">Edit Configuration</ion-button>
          </div>
        </article>
      </section>
    } @else {
      <section class="empty-state">
        <h2>No servers yet</h2>
        <p>Add a server to populate the dashboard.</p>
        <ion-button routerLink="/servers/new">Add server</ion-button>
      </section>
    }
  `,
})
export class DashboardPage {
  private readonly service = inject(ServerInstancesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly players = signal<Array<{ name?: string; level?: number; steamid?: string }>>([]);

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.service.dashboard().subscribe((items) => {
      const selected = selectServerFromRoute(items, this.route, this.router);
      this.server.set(selected);
      if (selected?.restConnectivity === 'online') {
        this.loadRoster();
      }
    });
  }

  loadRoster(): void {
    const selected = this.server();
    if (!selected) {
      return;
    }
    this.service.roster(selected.id).subscribe({
      next: (roster) => this.players.set(roster.players),
      error: () => this.players.set([]),
    });
  }

  formatUptime(value: number | null): string {
    if (!value) return 'n/a';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  formatPercent(value: number | null): string {
    return value === null ? 'n/a' : `${value.toFixed(1)}%`;
  }

  formatMemory(value: number | null): string {
    return value === null ? 'n/a' : `${value.toFixed(1)} MB`;
  }
}
