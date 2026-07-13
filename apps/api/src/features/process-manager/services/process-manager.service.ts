import { Injectable } from '@nestjs/common';
import type { ServerInstance } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PalworldApiClientFactory } from '../../palworld-api/clients/palworld-api.client';
import { WindowsServerProcessAdapter } from '../adapters/windows-server-process.adapter';
import type { ServerProcessResult, ServerProcessStatus } from '../models/server-process-adapter';

@Injectable()
export class ProcessManagerService {
  constructor(
    private readonly adapter: WindowsServerProcessAdapter,
    private readonly palworld: PalworldApiClientFactory,
    private readonly audit: AuditLogService,
  ) {}

  start(instance: ServerInstance, actorId: string): Promise<ServerProcessResult> {
    void this.audit.record({ actorId, action: 'SERVER_STARTED', targetId: instance.id, message: 'Server start requested.' });
    return this.adapter.start(instance);
  }

  async gracefulStop(instance: ServerInstance, adminPassword: string, actorId: string): Promise<void> {
    const client = this.palworld.forInstance(instance, adminPassword);
    await client.save();
    await client.shutdown(instance.shutdownWaitSeconds, 'Palwarden requested a graceful shutdown.');
    await this.adapter.requestGracefulStop(instance);
    await this.audit.record({ actorId, action: 'SERVER_STOPPED', targetId: instance.id, message: 'Graceful stop requested.' });
  }

  async saveWorld(instance: ServerInstance, adminPassword: string, actorId: string): Promise<void> {
    await this.palworld.forInstance(instance, adminPassword).save();
    await this.audit.record({ actorId, action: 'WORLD_SAVE', targetId: instance.id, message: 'World save requested.' });
  }

  async announce(instance: ServerInstance, adminPassword: string, message: string, actorId: string): Promise<void> {
    await this.palworld.forInstance(instance, adminPassword).announce(message);
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: instance.id, message: 'Announcement sent.' });
  }

  async shutdownCountdown(instance: ServerInstance, adminPassword: string, seconds: number, message: string, actorId: string): Promise<void> {
    await this.palworld.forInstance(instance, adminPassword).shutdown(seconds, message);
    await this.adapter.requestGracefulStop(instance);
    await this.audit.record({ actorId, action: 'SERVER_STOPPED', targetId: instance.id, message: 'Shutdown countdown requested.' });
  }

  getStatus(instanceId: string): ServerProcessStatus {
    return this.adapter.getStatus(instanceId);
  }

  getRecoveredStatus(instance: ServerInstance): Promise<ServerProcessStatus> {
    return this.adapter.recoverStatus(instance);
  }

  assertStopped(instanceId: string): Promise<void> {
    return this.adapter.assertStopped(instanceId);
  }

  logs(instanceId: string): string[] {
    return this.adapter.logs(instanceId);
  }
}
