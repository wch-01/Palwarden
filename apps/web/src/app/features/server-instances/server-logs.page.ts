import type { OnDestroy} from '@angular/core';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  standalone: true,
  template: `
    <h1>Logs</h1>
    <pre>{{ lines().join('\n') }}</pre>
  `,
})
export class ServerLogsPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly lines = signal<string[]>([]);
  private readonly events: EventSource;

  constructor() {
    const id = this.route.parent?.snapshot.paramMap.get('id') ?? '';
    this.events = new EventSource(`/api/server-instances/${id}/events`);
    this.events.onmessage = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as { lines: string[] };
      this.lines.set(data.lines);
    };
  }

  ngOnDestroy(): void {
    this.events.close();
  }
}
