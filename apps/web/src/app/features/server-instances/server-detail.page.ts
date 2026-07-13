import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav>
      <a routerLink="overview" routerLinkActive="active">Overview</a>
      <a routerLink="players" routerLinkActive="active">Players</a>
      <a routerLink="logs" routerLinkActive="active">Logs</a>
      <a routerLink="settings" routerLinkActive="active">Settings</a>
    </nav>
    <router-outlet />
  `,
})
export class ServerDetailPage {}
