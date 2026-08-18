import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ProcessManagerService } from '../../process-manager/services/process-manager.service';
import { ServerInstancesService } from './server-instances.service';

@Injectable()
export class ServerStartupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ServerStartupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly instances: ServerInstancesService,
    private readonly processManager: ProcessManagerService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('PALWARDEN_START_SERVERS_ON_LAUNCH') !== true) {
      return;
    }
    setTimeout(() => {
      void this.startConfiguredServers();
    }, 5000);
  }

  private async startConfiguredServers(): Promise<void> {
    const servers = await this.prisma.serverInstance.findMany({
      where: { autoStart: true },
      orderBy: { displayName: 'asc' },
    });
    if (!servers.length) {
      this.logger.log('Server startup policy enabled, but no profiles are marked for auto-start.');
      return;
    }
    await this.audit.record({
      action: 'SERVER_UPDATED',
      message: 'Palwarden startup policy is starting configured server profiles.',
      metadata: { count: servers.length },
    });
    for (const server of servers) {
      try {
        const status = await this.processManager.getRecoveredStatus(server);
        if (status.state === 'running' || status.state === 'starting' || status.state === 'stopping') {
          this.logger.log(`Skipping ${server.displayName}; current state is ${status.state}.`);
          continue;
        }
        await this.instances.assertNoActivePortConflicts(server);
        await this.instances.ensureRestApiConfigForLaunch(server);
        await this.processManager.start(server);
        this.logger.log(`Started ${server.displayName} from Palwarden startup policy.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown startup error.';
        this.logger.warn(`Could not auto-start ${server.displayName}: ${message}`);
        await this.audit.record({
          action: 'SERVER_UPDATED',
          targetId: server.id,
          message: 'Palwarden startup policy could not start this server.',
          metadata: { reason: message },
        });
      }
    }
  }
}
