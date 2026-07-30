import { Component, computed, inject, signal } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import type { ServerDashboardCard } from '@palwarden/shared';
import { filter, Subscription } from 'rxjs';
import { AuthService } from '../authentication/auth.service';
import { ServerInstancesService } from '../../features/server-instances/server-instances.service';
import { storedSelectedServerId, storeSelectedServerId } from '../../features/server-instances/selected-server';

const PAGE_COPY: Array<{ pattern: RegExp; title: string; description: string }> = [
  { pattern: /^\/dashboard/, title: 'Dashboard', description: 'Monitor selected server health, players, and operational signals.' },
  { pattern: /^\/server-control/, title: 'Server Control', description: 'Run live actions against the selected Palworld server.' },
  { pattern: /^\/server-configuration/, title: 'Server Configuration', description: 'Edit the selected server configuration without opening files by hand.' },
  { pattern: /^\/players/, title: 'Players', description: 'Review online players and manage player moderation.' },
  { pattern: /^\/mods/, title: 'Mods', description: 'Review installed mods and prepare mod management workflows.' },
  { pattern: /^\/logs/, title: 'Logs', description: 'Review Palwarden and selected-server logs.' },
  { pattern: /^\/audit-log/, title: 'Audit Log', description: 'Review administrative actions and security-relevant events.' },
  { pattern: /^\/host\/launcher-options/, title: 'Launcher Options', description: 'Configure Palworld launch flags and host runtime behavior.' },
  { pattern: /^\/servers\/new/, title: 'New server', description: 'Install and register a Palworld dedicated server profile.' },
  { pattern: /^\/servers\/[^/]+\/players/, title: 'Players', description: 'Review player activity and moderation tools for the selected server.' },
  { pattern: /^\/servers\/[^/]+\/logs/, title: 'Logs', description: 'Watch captured process output and server events.' },
  { pattern: /^\/servers\/[^/]+\/settings/, title: 'Server settings', description: 'Manage paths, ports, credentials, and restart behavior.' },
  { pattern: /^\/servers\/[^/]+/, title: 'Server overview', description: 'Inspect connectivity, configuration, and maintenance actions.' },
  { pattern: /^\/servers/, title: 'Servers', description: 'Browse and manage Palwarden server profiles.' },
  { pattern: /^\/settings\/users/, title: 'User Access', description: 'Manage Palwarden accounts and global access roles.' },
  { pattern: /^\/settings/, title: 'Settings', description: 'Configure host behavior, access, paths, and automation.' },
];

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonContent],
  template: `
    <div class="shell">
      <nav class="sidebar">
        <div class="brand-lockup">
          <img src="assets/brand/palwarden-logo.png" alt="" />
          <div>
            <h1>Palwarden</h1>
            <span>Server Controller</span>
          </div>
        </div>
        <a routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
        <a routerLink="/server-control" routerLinkActive="active">Server Control</a>
        <a routerLink="/server-configuration" routerLinkActive="active">Server Configuration</a>
        <a routerLink="/players" routerLinkActive="active">Players</a>
        <a routerLink="/mods" routerLinkActive="active">Mods</a>
        <a routerLink="/logs" routerLinkActive="active">Logs</a>
        <div class="nav-section">Host Controls</div>
        <a routerLink="/host/launcher-options" routerLinkActive="active">Launcher Options</a>
        <a routerLink="/audit-log" routerLinkActive="active">Audit Log</a>
        <a routerLink="/settings" routerLinkActive="active">Settings</a>
      </nav>
      <main class="app-main">
        <header class="topbar">
          <section class="page-heading">
            <img src="assets/brand/palwarden-logo.png" alt="" />
            <div>
              <h1>{{ pageTitle() }}</h1>
              <p>{{ pageDescription() }}</p>
            </div>
          </section>
          <section class="topbar-status" aria-label="Server summary">
            <label class="server-picker">
              <span>Server</span>
              <select [value]="selectedServerId()" (change)="changeServer($event)">
                @for (server of servers(); track server.id) {
                  <option [value]="server.id">{{ server.displayName }}</option>
                }
                <option value="__new">Add new server</option>
              </select>
            </label>
            <div class="metric-pill">
              <span>Players</span>
              <strong>{{ playerCount() }}</strong>
            </div>
            <div class="status-pill" [class.online]="selectedServer()?.restConnectivity === 'online'">
              <span class="status-light"></span>
              <strong>{{ selectedServer()?.restConnectivity === 'online' ? 'online' : 'offline' }}</strong>
            </div>
            <details class="user-menu">
              <summary>
                <span>User</span>
                <strong>{{ username() }}</strong>
              </summary>
              <button type="button" (click)="logout()">Log out</button>
            </details>
          </section>
        </header>
        <ion-content class="page-content">
          <div class="content">
            <router-outlet />
          </div>
        </ion-content>
      </main>
    </div>
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly serversService = inject(ServerInstancesService);
  private readonly subscriptions = new Subscription();
  private refreshTimer?: number;
  readonly currentUrl = signal('');
  readonly servers = signal<ServerDashboardCard[]>([]);
  readonly selectedServerId = signal('');
  readonly selectedServer = computed(() => this.servers().find((server) => server.id === this.selectedServerId()) ?? null);
  readonly username = computed(() => this.auth.user()?.username ?? 'Unknown');
  readonly playerCount = computed(() => {
    const server = this.selectedServer();
    if (!server) {
      return '0/0';
    }
    return `${server.currentPlayers ?? 0}/${server.maxPlayers ?? 0}`;
  });
  readonly pageTitle = computed(() => this.pageCopy().title);
  readonly pageDescription = computed(() => this.pageCopy().description);

  ngOnInit(): void {
    this.currentUrl.set(this.router.url);
    this.subscriptions.add(
      this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.syncSelectedServerFromUrl(event.urlAfterRedirects);
      }),
    );
    this.refreshServers();
    this.refreshTimer = window.setInterval(() => this.refreshServers(), 5000);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
    }
  }

  changeServer(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '__new') {
      void this.router.navigateByUrl('/servers/new');
      return;
    }
    this.selectedServerId.set(value);
    storeSelectedServerId(value);
    void this.router.navigate(['/dashboard'], { queryParams: { server: value } });
  }

  logout(): void {
    this.auth.logout().subscribe(() => location.assign('/login'));
  }

  private refreshServers(): void {
    this.serversService.dashboard().subscribe((servers) => {
      this.servers.set(servers);
      this.syncSelectedServerFromUrl(this.currentUrl());
      const firstServer = servers[0];
      const storedServer = servers.find((server) => server.id === storedSelectedServerId());
      if (!this.selectedServerId() && (storedServer || firstServer)) {
        this.selectedServerId.set((storedServer ?? firstServer)!.id);
      }
    });
  }

  private syncSelectedServerFromUrl(url: string): void {
    const queryServer = new URLSearchParams(url.split('?')[1] ?? '').get('server');
    if (queryServer) {
      this.selectedServerId.set(queryServer);
      storeSelectedServerId(queryServer);
      return;
    }
    const match = /^\/servers\/([^/]+)/.exec(url);
    const id = match?.[1];
    if (id && id !== 'new') {
      this.selectedServerId.set(id);
      storeSelectedServerId(id);
    }
  }

  private pageCopy(): { title: string; description: string } {
    const url = this.currentUrl();
    return PAGE_COPY.find((item) => item.pattern.test(url)) ?? { title: 'Palwarden', description: 'Manage Palworld dedicated servers.' };
  }
}
