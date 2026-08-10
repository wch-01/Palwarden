import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import type { RequestUser } from '../../auth/services/auth.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UpdateHostNetworkSettingsDto } from '../dto/host-network-settings.dto';
import { HostSettingsService } from '../services/host-settings.service';

@UseGuards(SessionGuard, RolesGuard)
@Controller('settings/host')
export class HostSettingsController {
  constructor(
    private readonly hostSettings: HostSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('network')
  networkSettings() {
    return this.hostSettings.getNetworkSettings();
  }

  @Get('public-ip')
  publicIp() {
    return this.hostSettings.detectPublicIp();
  }

  @Roles('OWNER')
  @Put('network')
  async updateNetworkSettings(@Body() body: UpdateHostNetworkSettingsDto, @Req() req: { user: RequestUser }) {
    const result = this.hostSettings.updateNetworkSettings(body);
    await this.audit.record({
      actorId: req.user.id,
      action: 'SERVER_UPDATED',
      message: 'Host network access settings updated.',
      metadata: { webAccessMode: result.webAccessMode, port: result.port, restartRequired: result.restartRequired },
    });
    return result;
  }
}
