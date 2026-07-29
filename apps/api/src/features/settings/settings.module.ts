import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { HostSettingsController } from './controllers/host-settings.controller';
import { HostSettingsService } from './services/host-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [HostSettingsController],
  providers: [HostSettingsService, AuditLogService],
})
export class SettingsModule {}
