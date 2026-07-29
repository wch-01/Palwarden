import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogPageResult {
  items: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilters {
  action?: string;
  targetId?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogClient {
  private readonly http = inject(HttpClient);

  list(filters: AuditLogFilters = {}) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') {
        params[key] = String(value);
      }
    }
    return this.http.get<AuditLogPageResult>('/api/audit-log', { params });
  }
}
