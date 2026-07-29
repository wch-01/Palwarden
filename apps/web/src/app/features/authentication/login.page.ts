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
          <div class="auth-brand">
            <img class="auth-logo" src="assets/brand/palwarden-logo.png" alt="" />
            <div>
              <p class="eyebrow">Palwarden</p>
              <h1>Welcome back</h1>
            </div>
          </div>
          <p class="lede">Sign in to manage your Palworld server fleet.</p>
        </div>
        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <ion-list>
            <ion-item><ion-input label="Username" formControlName="username" /></ion-item>
            <ion-item><ion-input label="Password" type="password" formControlName="password" /></ion-item>
          </ion-list>
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
          <ion-button type="submit" expand="block" [disabled]="form.invalid">Log in</ion-button>
        </form>
      </section>
    </main>
  `,
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  ngOnInit(): void {
    this.auth.restore().subscribe(() => {
      if (this.auth.setupRequired()) {
        void this.router.navigateByUrl('/setup');
      }
    });
  }

  submit(): void {
    this.error.set('');
    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: () => this.error.set('Username or password did not match.'),
    });
  }
}
