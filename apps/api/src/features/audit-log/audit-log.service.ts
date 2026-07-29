import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: AuditAction;
  targetId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorId?: string;
    action: AuditAction;
    targetId?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetId: input.targetId ?? null,
        message: input.message,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  }

  async list(filters: {
    action?: string;
    targetId?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: AuditLogView[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: filters.action as AuditAction } : {}),
      ...(filters.targetId ? { targetId: filters.targetId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...this.dateWhere(filters.dateFrom, filters.dateTo),
    };
    const limit = Math.min(Math.max(filters.limit ?? 50, 10), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const [records, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(records.map((record) => record.actorId).filter((id): id is string => Boolean(id)))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true },
    });
    const usernames = new Map(users.map((user) => [user.id, user.username]));
    return {
      items: records.map((record) => ({
        id: record.id,
        actorId: record.actorId,
        actorUsername: record.actorId ? usernames.get(record.actorId) ?? null : null,
        action: record.action,
        targetId: record.targetId,
        message: record.message,
        metadata: this.safeMetadata(record.metadata),
        createdAt: record.createdAt.toISOString(),
      })),
      total,
    };
  }

  private dateWhere(dateFrom?: string, dateTo?: string): Prisma.AuditLogWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (dateFrom) {
      const parsed = new Date(dateFrom);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt.gte = parsed;
      }
    }
    if (dateTo) {
      const parsed = new Date(dateTo);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt.lte = parsed;
      }
    }
    return Object.keys(createdAt).length ? { createdAt } : {};
  }

  private safeMetadata(value: string | null): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) {
        if (/password|token|session|secret|key|authorization/i.test(key)) {
          parsed[key] = '[redacted]';
        }
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
