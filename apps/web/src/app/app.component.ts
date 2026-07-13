import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/standalone';
import { AuthService } from './core/authentication/auth.service';
import { ShellComponent } from './core/layout/shell.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, RouterOutlet, ShellComponent],
  template: `
    <ion-app>
      @if (showShell()) {
        <app-shell />
      } @else {
        <router-outlet />
      }
    </ion-app>
  `,
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  readonly showShell = computed(() => Boolean(this.auth.user()));
}
