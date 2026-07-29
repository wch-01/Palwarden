import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { UserRole } from '@palwarden/shared';

export interface ManagedUser {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class UsersClient {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<ManagedUser[]>('/api/users');
  }

  create(payload: { username: string; password: string; role: UserRole }) {
    return this.http.post<ManagedUser>('/api/users', payload);
  }

  update(id: string, payload: { role?: UserRole; disabled?: boolean; password?: string }) {
    return this.http.patch<ManagedUser>(`/api/users/${id}`, payload);
  }

  remove(id: string) {
    return this.http.delete<{ ok: true }>(`/api/users/${id}`);
  }
}
