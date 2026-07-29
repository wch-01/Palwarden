import type { OnDestroy } from '@angular/core';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import type { ServerLogEntry, ServerLogResult } from '@palwarden/shared';
import { ServerInstancesService } from './server-instances.service';

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="panel logs-panel">
      <div class="panel-header">
        <div>
          <h2>Server Logs</h2>
          <p class="muted">Search captured process output, filter by stream, and export the current view.</p>
        </div>
        <div class="control-row">
          <button type="button" class="secondary-button" (click)="loadLogs()">Refresh</button>
          <button type="button" (click)="downloadLogs()" [disabled]="!entries().length">Download</button>
        </div>
      </div>

      <div class="log-toolbar">
        <label>
          Search
          <input [ngModel]="query()" (ngModelChange)="query.set($event); applyFilters()" placeholder="Find text in logs" />
        </label>
        <label>
          Stream
          <select [ngModel]="stream()" (ngModelChange)="stream.set($event); applyFilters()">
            <option value="">All streams</option>
            <option value="system">System</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
          </select>
        </label>
        <label>
          Lines
          <select [ngModel]="limit()" (ngModelChange)="limit.set($event); loadLogs()">
            <option [ngValue]="100">Last 100</option>
            <option [ngValue]="500">Last 500</option>
            <option [ngValue]="1000">Last 1,000</option>
            <option [ngValue]="2000">Last 2,000</option>
          </select>
        </label>
        <label class="setting-toggle compact-toggle">
          <input type="checkbox" [ngModel]="liveFollow()" (ngModelChange)="liveFollow.set($event)" />
          <span>Live follow</span>
        </label>
      </div>

      <div class="log-summary">
        <span>{{ filteredCount() }} matching</span>
        <span>{{ totalCount() }} captured</span>
        <span>{{ connectionState() }}</span>
      </div>

      <div class="log-viewer" #logViewer>
        @for (entry of entries(); track entry.index) {
          <div class="log-line" [class.stderr]="entry.stream === 'stderr'" [class.system]="entry.stream === 'system'">
            <time>{{ formatTime(entry.timestamp) }}</time>
            <span class="log-stream">{{ entry.stream }}</span>
            <span class="log-message">{{ entry.message }}</span>
          </div>
        } @empty {
          <p class="muted log-empty">No log lines match the current filters.</p>
        }
      </div>
    </section>
  `,
})
export class ServerLogsPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ServerInstancesService);
  readonly query = signal('');
  readonly stream = signal('');
  readonly limit = signal(500);
  readonly liveFollow = signal(true);
  readonly result = signal<ServerLogResult>({ entries: [], total: 0, filtered: 0 });
  readonly connectionState = signal('connecting');
  readonly entries = computed(() => this.applyLocalFilters(this.result().entries));
  readonly totalCount = computed(() => this.result().total);
  readonly filteredCount = computed(() => this.entries().length);
  private readonly id = this.route.parent?.snapshot.paramMap.get('id') ?? '';
  private readonly events: EventSource;
  private filterTimer: number | null = null;

  constructor() {
    this.loadLogs();
    this.events = new EventSource(`/api/server-instances/${this.id}/events`);
    this.events.onopen = () => this.connectionState.set('live');
    this.events.onerror = () => this.connectionState.set('reconnecting');
    this.events.onmessage = (event: MessageEvent<string>) => {
      if (!this.liveFollow()) return;
      const data = JSON.parse(event.data) as { lines: string[] };
      this.result.set({
        entries: data.lines.map((line, index) => this.toLogEntry(line, index)),
        total: data.lines.length,
        filtered: data.lines.length,
      });
    };
  }

  ngOnDestroy(): void {
    this.events.close();
    if (this.filterTimer !== null) {
      window.clearTimeout(this.filterTimer);
    }
  }

  loadLogs(): void {
    this.service.logs(this.id, { q: this.query(), stream: this.stream(), limit: this.limit() }).subscribe((result) => {
      this.result.set(result);
      this.connectionState.set(this.liveFollow() ? this.connectionState() : 'manual');
    });
  }

  applyFilters(): void {
    if (this.filterTimer !== null) {
      window.clearTimeout(this.filterTimer);
    }
    this.filterTimer = window.setTimeout(() => this.loadLogs(), 200);
  }

  downloadLogs(): void {
    window.location.assign(this.service.logsDownloadUrl(this.id, { q: this.query(), stream: this.stream(), limit: this.limit() }));
  }

  formatTime(value: string | null): string {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString();
  }

  private applyLocalFilters(entries: ServerLogEntry[]): ServerLogEntry[] {
    const q = this.query().trim().toLowerCase();
    const stream = this.stream();
    return entries.filter((entry) => {
      if (stream && entry.stream !== stream) return false;
      if (q && !entry.raw.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  private toLogEntry(line: string, index: number): ServerLogEntry {
    const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const body = timestampMatch?.[2] ?? line;
    const streamMatch = body.match(/^\[(stdout|stderr)\]\s*(.*)$/i);
    return {
      index,
      timestamp: timestampMatch?.[1] ?? null,
      stream: streamMatch ? (streamMatch[1]!.toLowerCase() as 'stdout' | 'stderr') : 'system',
      message: streamMatch?.[2] ?? body,
      raw: line,
    };
  }
}
