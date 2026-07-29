import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonInput, IonItem, IonList } from '@ionic/angular/standalone';
import { AuthService } from '../../core/authentication/auth.service';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonInput, IonItem, IonList],
  template: `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="auth-copy">
          <img class="auth-logo" src="assets/brand/palwarden-logo.png" alt="Palwarden" />
          <p class="eyebrow">Palwarden</p>
          <h1>Set up your owner account</h1>
          <p class="lede">Create the first Palwarden account for this machine.</p>
        </div>
        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <ion-list>
            <ion-item><ion-input label="Owner username" formControlName="username" /></ion-item>
            <ion-item><ion-input label="Password" type="password" formControlName="password" /></ion-item>
            <details class="setup-token-panel">
              <summary>Remote setup token</summary>
              <p>Only needed when creating the first owner from another device.</p>
              <ion-item><ion-input label="Setup token" formControlName="setupToken" /></ion-item>
            </details>
          </ion-list>
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <ion-button type="submit" expand="block" [disabled]="form.invalid || submitting()">
            {{ submitting() ? 'Creating owner...' : 'Create owner' }}
          </ion-button>
        </form>
      </section>
    </main>
  `,
})
export class SetupPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(12)]],
    setupToken: [''],
  });
  readonly error = signal('');
  readonly submitting = signal(false);

  ngOnInit(): void {
    this.auth.restore().subscribe(() => {
      if (!this.auth.setupRequired()) {
        void this.router.navigateByUrl('/login', { replaceUrl: true });
      }
    });
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      return;
    }
    this.error.set('');
    this.submitting.set(true);
    this.auth.setup(this.form.getRawValue()).subscribe({
      next: () => void this.router.navigateByUrl('/login', { replaceUrl: true }),
      error: () => {
        this.submitting.set(false);
        this.error.set('Owner setup could not be completed.');
      },
    });
  }
}
