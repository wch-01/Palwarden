import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonButton, IonCard, IonCardContent } from '@ionic/angular/standalone';
import type { ServerInstanceView } from '@palwarden/shared';
import { ServerInstancesService } from './server-instances.service';

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonCard, IonCardContent],
  template: `
    <div class="page-actions">
      <ion-button routerLink="/servers/new">Add server</ion-button>
    </div>
    <section class="grid">
      @for (server of servers(); track server.id) {
        <ion-card>
          <ion-card-content>
            <h2>{{ server.displayName }}</h2>
            <p>{{ server.installationDirectory }}</p>
            <p>REST {{ server.restApiHost }}:{{ server.restApiPort }}</p>
            <ion-button size="small" [routerLink]="['/servers', server.id, 'overview']">Open</ion-button>
          </ion-card-content>
        </ion-card>
      }
    </section>
  `,
})
export class ServerListPage {
  private readonly service = inject(ServerInstancesService);
  readonly servers = signal<ServerInstanceView[]>([]);

  constructor() {
    this.service.list().subscribe((items) => this.servers.set(items));
  }
}
