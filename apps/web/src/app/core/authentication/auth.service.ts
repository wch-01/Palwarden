import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { AuthState, PublicUser } from '@palwarden/shared';
import { catchError, of, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<PublicUser | null>(null);
  readonly setupRequired = signal(false);
  readonly csrfToken = signal('');

  restore() {
    return this.http.get<AuthState>('/api/auth/state').pipe(
      catchError(() =>
        of({
          setupRequired: false,
          user: null,
          csrfToken: '',
        }),
      ),
      tap((state) => this.applyState(state)),
    );
  }

  setup(body: { username: string; password: string; setupToken?: string }) {
    return this.http.post<{ user: PublicUser }>('/api/auth/setup', body).pipe(
      tap(() => {
        this.setupRequired.set(false);
      }),
    );
  }

  login(body: { username: string; password: string }) {
    return this.http.post<{ user: PublicUser }>('/api/auth/login', body).pipe(
      tap((result) => {
        this.user.set(result.user);
        void this.restore().subscribe();
      }),
    );
  }

  logout() {
    return this.http.post('/api/auth/logout', {}).pipe(
      tap(() => {
        this.user.set(null);
        this.csrfToken.set('');
      }),
    );
  }

  private applyState(state: AuthState): void {
    this.user.set(state.user);
    this.setupRequired.set(state.setupRequired);
    this.csrfToken.set(state.csrfToken);
  }
}
