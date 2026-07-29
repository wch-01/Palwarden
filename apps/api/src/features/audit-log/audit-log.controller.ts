import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/guards/session.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { AuditLogService } from './audit-log.service';

@UseGuards(SessionGuard, RolesGuard)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Roles('ADMIN', 'OWNER')
  @Get()
  list(
    @Query('action') action?: string,
    @Query('targetId') targetId?: string,
    @Query('actorId') actorId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: {
      action?: string;
      targetId?: string;
      actorId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
      offset?: number;
    } = {};
    if (action) {
      filters.action = action;
    }
    if (targetId) {
      filters.targetId = targetId;
    }
    if (actorId) {
      filters.actorId = actorId;
    }
    if (dateFrom) {
      filters.dateFrom = dateFrom;
    }
    if (dateTo) {
      filters.dateTo = dateTo;
    }
    if (limit) {
      filters.limit = Number.parseInt(limit, 10);
    }
    if (offset) {
      filters.offset = Number.parseInt(offset, 10);
    }
    return this.audit.list(filters);
  }
}
