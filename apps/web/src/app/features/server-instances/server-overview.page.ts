import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonButton } from '@ionic/angular/standalone';
import type { ServerInstanceView } from '@palwarden/shared';
import { ServerInstancesService } from './server-instances.service';

@Component({
  standalone: true,
  imports: [IonButton],
  template: `
    @if (server(); as item) {
      <h1>{{ item.displayName }}</h1>
      <p>{{ item.description }}</p>
      <p>{{ item.executablePath }}</p>
      <p>Admin credential configured: {{ item.adminPasswordConfigured ? 'yes' : 'no' }}</p>
      <ion-button (click)="test()">Test REST API</ion-button>
    }
  `,
})
export class ServerOverviewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ServerInstancesService);
  readonly server = signal<ServerInstanceView | null>(null);
  private readonly id = this.route.parent?.snapshot.paramMap.get('id') ?? '';

  constructor() {
    this.service.get(this.id).subscribe((item) => this.server.set(item));
  }

  test(): void {
    this.service.testConnection(this.id).subscribe(() => alert('REST API connection succeeded.'));
  }
}
