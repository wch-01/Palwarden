import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuditLogClient } from './audit-log.service';
import type { AuditLogEntry, AuditLogFilters } from './audit-log.service';
import { ServerInstancesService } from '../server-instances/server-instances.service';
import { UsersClient } from '../settings/users.service';
import type { ManagedUser } from '../settings/users.service';
import type { ServerInstanceView } from '@palwarden/shared';

const ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DELETED',
  'SERVER_CREATED',
  'SERVER_UPDATED',
  'SERVER_DELETED',
  'SERVER_STARTED',
  'SERVER_STOPPED',
  'WORLD_SAVE',
  'CREDENTIAL_REPLACED',
];

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Audit Log</h2>
          <p class="muted">Review administrative actions recorded by Palwarden.</p>
        </div>
        <button class="secondary-button" type="button" (click)="load()">Refresh</button>
      </div>
      <div class="audit-sticky-header">
        <div class="audit-heading-row">
          <span>Time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Target</span>
          <span>Message</span>
        </div>
        <div class="audit-filter-row">
          <div class="audit-date-filter">
            <input [(ngModel)]="dateFrom" type="date" aria-label="From date" (change)="applyFilters()" />
            <input [(ngModel)]="dateTo" type="date" aria-label="To date" (change)="applyFilters()" />
          </div>
          <select [(ngModel)]="actorFilter" aria-label="Filter actor" (change)="applyFilters()">
            <option value="">All actors</option>
            @for (user of users(); track user.id) {
              <option [value]="user.id">{{ user.username }}</option>
            }
          </select>
          <select [(ngModel)]="actionFilter" aria-label="Filter action" (change)="applyFilters()">
            <option value="">All actions</option>
            @for (action of actions; track action) {
              <option [value]="action">{{ action }}</option>
            }
          </select>
          <select [(ngModel)]="targetFilter" aria-label="Filter target" (change)="applyFilters()">
            <option value="">All servers/targets</option>
            @for (server of servers(); track server.id) {
              <option [value]="server.id">{{ server.displayName }}</option>
            }
          </select>
          <span></span>
        </div>
      </div>
      <div class="table-wrap audit-table-wrap">
        <table class="data-table audit-table">
          <colgroup>
            <col class="audit-col-time" />
            <col class="audit-col-actor" />
            <col class="audit-col-action" />
            <col class="audit-col-target" />
            <col class="audit-col-message" />
          </colgroup>
          <tbody>
            @for (entry of entries(); track entry.id) {
              <tr>
                <td>{{ formatDate(entry.createdAt) }}</td>
                <td>{{ entry.actorUsername ?? entry.actorId ?? 'system' }}</td>
                <td><span class="state-badge">{{ entry.action }}</span></td>
                <td class="path-cell">{{ entry.targetId ?? 'n/a' }}</td>
                <td>
                  {{ entry.message }}
                  @if (entry.metadata) {
                    <code>{{ metadataText(entry.metadata) }}</code>
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">No audit entries match these filters.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="pager-row">
        <span class="muted">Showing {{ pageStart() }}-{{ pageEnd() }} of {{ total() }}</span>
        <div class="control-row">
          <button class="secondary-button compact" type="button" [disabled]="offset() === 0" (click)="previousPage()">Previous</button>
          <button class="secondary-button compact" type="button" [disabled]="pageEnd() >= total()" (click)="nextPage()">Next</button>
          <button class="secondary-button compact" type="button" (click)="exportCsv()">Export CSV</button>
        </div>
      </div>
    </section>
  `,
})
export class AuditLogPage {
  private readonly audit = inject(AuditLogClient);
  private readonly serversClient = inject(ServerInstancesService);
  private readonly usersClient = inject(UsersClient);
  readonly entries = signal<AuditLogEntry[]>([]);
  readonly servers = signal<ServerInstanceView[]>([]);
  readonly users = signal<ManagedUser[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly limit = 50;
  readonly actions = ACTIONS;
  actionFilter = '';
  actorFilter = '';
  targetFilter = '';
  dateFrom = '';
  dateTo = '';

  constructor() {
    this.serversClient.list().subscribe((servers) => this.servers.set(servers));
    this.usersClient.list().subscribe({ next: (users) => this.users.set(users), error: () => this.users.set([]) });
    this.load();
  }

  load(): void {
    const filters: AuditLogFilters = {
      action: this.actionFilter,
      actorId: this.actorFilter,
      targetId: this.targetFilter,
      limit: this.limit,
      offset: this.offset(),
    };
    if (this.dateFrom) {
      filters.dateFrom = `${this.dateFrom}T00:00:00`;
    }
    if (this.dateTo) {
      filters.dateTo = `${this.dateTo}T23:59:59`;
    }
    this.audit
      .list(filters)
      .subscribe((result) => {
        this.entries.set(result.items);
        this.total.set(result.total);
      });
  }

  applyFilters(): void {
    this.offset.set(0);
    this.load();
  }

  previousPage(): void {
    this.offset.set(Math.max(0, this.offset() - this.limit));
    this.load();
  }

  nextPage(): void {
    this.offset.set(this.offset() + this.limit);
    this.load();
  }

  pageStart(): number {
    return this.total() === 0 ? 0 : this.offset() + 1;
  }

  pageEnd(): number {
    return Math.min(this.total(), this.offset() + this.entries().length);
  }

  exportCsv(): void {
    const header = ['createdAt', 'actor', 'action', 'targetId', 'message', 'metadata'];
    const lines = [
      header.join(','),
      ...this.entries().map((entry) =>
        [
          entry.createdAt,
          entry.actorUsername ?? entry.actorId ?? 'system',
          entry.action,
          entry.targetId ?? '',
          entry.message,
          entry.metadata ? JSON.stringify(entry.metadata) : '',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `palwarden-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  metadataText(value: Record<string, unknown>): string {
    return JSON.stringify(value);
  }
}
