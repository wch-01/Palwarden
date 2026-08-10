import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { ServerDashboardCard } from '@palwarden/shared';
import type { Observable } from 'rxjs';
import type { ServerRoster } from './server-instances.service';
import { ServerInstancesService } from './server-instances.service';
import { selectServerFromRoute } from './selected-server';
import { AuthService } from '../../core/authentication/auth.service';

type Player = ServerRoster['players'][number];
interface PendingPlayerAction {
  kind: 'kick' | 'ban' | 'unban' | 'announce';
  serverId: string;
  target: string;
  label: string;
  detail: string;
  danger: boolean;
}

@Component({
  standalone: true,
  template: `
    @if (server(); as item) {
      <section class="player-ops-page">
        <article class="world-settings-panel">
          <div class="panel-header">
            <div>
              <h2>Player Operations</h2>
              <p class="muted">Review online players and send moderation requests through Palwarden.</p>
            </div>
            <button type="button" class="secondary-button" (click)="refresh()">Refresh roster</button>
          </div>

          <div class="stat-grid">
            <div><span>Server</span><strong>{{ item.displayName }}</strong></div>
            <div><span>REST</span><strong>{{ item.restConnectivity }}</strong></div>
            <div><span>Players</span><strong>{{ roster().players.length }}/{{ item.maxPlayers ?? 0 }}</strong></div>
            <div><span>State</span><strong>{{ item.runtimeState }}</strong></div>
          </div>
        </article>

        <section class="panel-grid">
          <article class="panel">
            <h2>Announcement</h2>
            <label class="config-field">
              <span>Message</span>
              <input [value]="announcement()" (input)="announcement.set(inputValue($event))" />
              <small>Broadcast a short message to connected players.</small>
            </label>
            <div class="control-row">
              <button type="button" class="primary-button" [disabled]="!canManage() || !announcement().trim() || busy()" (click)="sendAnnouncement(item.id)">
                Send announcement
              </button>
            </div>
          </article>

          <article class="panel">
            <h2>Manual Unban</h2>
            <label class="config-field">
              <span>User ID</span>
              <input [value]="manualUserId()" (input)="manualUserId.set(inputValue($event))" />
              <small>Use a Palworld REST user ID, such as the value shown in the roster.</small>
            </label>
            <div class="control-row">
              <button type="button" class="secondary-button" [disabled]="!canManage() || !manualUserId().trim() || busy()" (click)="unban(item.id, manualUserId())">
                Unban player
              </button>
            </div>
          </article>

          <article class="panel">
            <h2>Action History</h2>
            @if (history().length) {
              @for (item of history(); track item) {
                <p class="table-details">{{ item }}</p>
              }
            } @else {
              <p class="muted">No player actions have been requested this session.</p>
            }
          </article>
        </section>

        <article class="world-settings-panel">
          <div class="panel-header">
            <div>
              <h2>Player Roster</h2>
              <p class="muted">{{ roster().players.length ? 'Online players reported by the Palworld REST API.' : 'No online players were returned by the server.' }}</p>
            </div>
            @if (!canManage()) {
              <span class="state-badge">Viewer access</span>
            }
          </div>

          @if (message()) {
            <p class="inline-message" [class.error-text]="messageIsError()">{{ message() }}</p>
          }

          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User ID</th>
                  <th>Player ID</th>
                  <th>Level</th>
                  <th>Ping</th>
                  <th>Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (player of roster().players; track playerKey(player, $index)) {
                  <tr>
                    <td>
                      <strong>{{ player.name || 'Unknown' }}</strong>
                      <small>{{ player.accountName || player.steamid || 'No account name' }}</small>
                    </td>
                    <td><code>{{ player.userId || 'n/a' }}</code></td>
                    <td><code>{{ player.playerId || player.playeruid || 'n/a' }}</code></td>
                    <td>{{ player.level ?? 'n/a' }}</td>
                    <td>{{ player.ping ?? 'n/a' }}</td>
                    <td>{{ formatLocation(player) }}</td>
                    <td>
                      <div class="table-actions">
                        <button type="button" class="secondary-button compact" [disabled]="!canManage() || !resolvedUserId(player) || busy()" (click)="kick(item.id, player)">
                          Kick
                        </button>
                        <button type="button" class="danger-button compact" [disabled]="!canManage() || !resolvedUserId(player) || busy()" (click)="ban(item.id, player)">
                          Ban
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7">No players online.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </article>
      </section>
    } @else {
      <section class="empty-state">Add a server before using player operations.</section>
    }
    @if (pendingAction(); as action) {
      <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm player action">
        <div class="modal-panel">
          <header>
            <div>
              <h2>{{ action.label }}</h2>
              <p class="muted">{{ action.detail }}</p>
            </div>
            <button type="button" class="secondary" (click)="pendingAction.set(null)">Close</button>
          </header>
          <footer>
            <span class="muted">This request is sent through the Palworld REST API and recorded in the audit log.</span>
            <button type="button" [class.danger-button]="action.danger" [class.primary-button]="!action.danger" (click)="confirmPendingAction(action)">
              Confirm
            </button>
          </footer>
        </div>
      </section>
    }
  `,
})
export class PlayersPage {
  private readonly service = inject(ServerInstancesService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly server = signal<ServerDashboardCard | null>(null);
  readonly roster = signal<ServerRoster>({ players: [], guilds: [] });
  readonly announcement = signal('');
  readonly manualUserId = signal('');
  readonly message = signal('');
  readonly messageIsError = signal(false);
  readonly busy = signal(false);
  readonly pendingAction = signal<PendingPlayerAction | null>(null);
  readonly history = signal<string[]>([]);
  readonly canManage = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.service.dashboard().subscribe((servers) => {
      const selected = selectServerFromRoute(servers, this.route, this.router);
      this.server.set(selected);
      if (selected) {
        this.loadRoster(selected.id);
      }
    });
  }

  sendAnnouncement(serverId: string): void {
    const message = this.announcement().trim();
    if (!message) return;
    this.pendingAction.set({
      kind: 'announce',
      serverId,
      target: message,
      label: 'Send announcement?',
      detail: message,
      danger: false,
    });
  }

  kick(serverId: string, player: Player): void {
    const userId = this.resolvedUserId(player);
    if (!userId) return;
    this.pendingAction.set({
      kind: 'kick',
      serverId,
      target: userId,
      label: `Kick ${this.playerLabel(player)}?`,
      detail: `User ID: ${userId}`,
      danger: false,
    });
  }

  ban(serverId: string, player: Player): void {
    const userId = this.resolvedUserId(player);
    if (!userId) return;
    this.pendingAction.set({
      kind: 'ban',
      serverId,
      target: userId,
      label: `Ban ${this.playerLabel(player)}?`,
      detail: `This may prevent the player from reconnecting. User ID: ${userId}`,
      danger: true,
    });
  }

  unban(serverId: string, userId: string): void {
    const target = userId.trim();
    if (!target) return;
    this.pendingAction.set({
      kind: 'unban',
      serverId,
      target,
      label: `Unban ${target}?`,
      detail: 'The player may be able to reconnect after the server accepts this request.',
      danger: false,
    });
  }

  confirmPendingAction(action: PendingPlayerAction): void {
    this.pendingAction.set(null);
    if (action.kind === 'announce') {
      this.runAction(this.service.announce(action.serverId, action.target), 'Announcement sent.', () => this.announcement.set(''), action.label);
    }
    if (action.kind === 'kick') {
      this.runAction(this.service.kickPlayer(action.serverId, action.target, 'Removed by Palwarden.'), 'Kick requested.', () => this.loadRoster(action.serverId), action.label);
    }
    if (action.kind === 'ban') {
      this.runAction(this.service.banPlayer(action.serverId, action.target, 'Banned by Palwarden.'), 'Ban requested.', () => this.loadRoster(action.serverId), action.label);
    }
    if (action.kind === 'unban') {
      this.runAction(this.service.unbanPlayer(action.serverId, action.target), 'Unban requested.', () => this.manualUserId.set(''), action.label);
    }
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  resolvedUserId(player: Player): string {
    return player.userId || player.playerId || player.playeruid || player.steamid || '';
  }

  playerKey(player: Player, index: number): string {
    return this.resolvedUserId(player) || `${player.name || 'player'}-${index}`;
  }

  formatLocation(player: Player): string {
    if (player.location_x === undefined || player.location_y === undefined) return 'n/a';
    return `${Math.round(player.location_x)}, ${Math.round(player.location_y)}`;
  }

  playerLabel(player: Player): string {
    return player.name || player.accountName || this.resolvedUserId(player) || 'player';
  }

  private loadRoster(serverId: string): void {
    this.service.roster(serverId).subscribe({
      next: (roster) => {
        this.roster.set(roster);
        this.message.set('');
        this.messageIsError.set(false);
      },
      error: () => {
        this.roster.set({ players: [], guilds: [] });
        this.message.set('Could not load player roster. Check that the server is running and REST API access is configured.');
        this.messageIsError.set(true);
      },
    });
  }

  private runAction(request: Observable<unknown>, success: string, done: () => void, historyLabel: string): void {
    this.busy.set(true);
    request.subscribe({
      next: () => {
        done();
        this.busy.set(false);
        this.message.set(success);
        this.messageIsError.set(false);
        this.history.update((items) => [`${new Date().toLocaleTimeString()} - ${historyLabel}`, ...items].slice(0, 8));
      },
      error: () => {
        this.busy.set(false);
        this.message.set('The player operation failed. Check that the server is online and the Admin Password is correct.');
        this.messageIsError.set(true);
      },
    });
  }
}
