import { Injectable } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

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
}
