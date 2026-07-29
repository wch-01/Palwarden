import { Module } from '@nestjs/common';
import { ServerInstancesController } from './controllers/server-instances.controller';
import { ServerInstancesService } from './services/server-instances.service';
import { CryptoService } from '../../core/security/crypto.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { PalworldApiClientFactory } from '../palworld-api/clients/palworld-api.client';
import { ProcessManagerService } from '../process-manager/services/process-manager.service';
import { WindowsServerProcessAdapter } from '../process-manager/adapters/windows-server-process.adapter';
import { SteamCmdService } from './services/steamcmd.service';
import { PalworldSettingsFileService } from './services/palworld-settings-file.service';
import { BackupsService } from '../backups/backups.service';
import { AuditLogController } from '../audit-log/audit-log.controller';

@Module({
  imports: [AuthModule],
  controllers: [ServerInstancesController, AuditLogController],
  providers: [
    ServerInstancesService,
    CryptoService,
    AuditLogService,
    PalworldApiClientFactory,
    ProcessManagerService,
    WindowsServerProcessAdapter,
    SteamCmdService,
    PalworldSettingsFileService,
    BackupsService,
  ],
})
export class ServerInstancesModule {}
