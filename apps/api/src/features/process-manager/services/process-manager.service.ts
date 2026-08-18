import { Injectable } from '@nestjs/common';
import type { ServerInstance } from '@prisma/client';
import type { ServerLogEntry, ServerLogResult } from '@palwarden/shared';
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

  start(instance: ServerInstance, actorId?: string): Promise<ServerProcessResult> {
    void this.audit.record({
      ...(actorId ? { actorId } : {}),
      action: 'SERVER_STARTED',
      targetId: instance.id,
      message: actorId ? 'Server start requested.' : 'Server start requested by Palwarden startup policy.',
    });
    return this.adapter.start(instance);
  }

  async gracefulStop(instance: ServerInstance, adminPassword: string, actorId: string): Promise<void> {
    const client = this.palworld.forInstance(instance, adminPassword);
    await client.save();
    await client.shutdown(instance.shutdownWaitSeconds, 'Palwarden requested a graceful shutdown.');
    await this.adapter.requestGracefulStop(instance);
    if (instance.forceStopAfterGracefulTimeout) {
      await this.waitForExitOrForce(instance);
    }
    await this.audit.record({ actorId, action: 'SERVER_STOPPED', targetId: instance.id, message: 'Graceful stop requested.' });
  }

  async waitForStopped(instance: ServerInstance, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const status = await this.adapter.recoverStatus(instance);
      if (status.state === 'stopped' || status.state === 'failed' || status.state === 'unknown') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Server did not stop before the timeout.');
  }

  async saveWorld(instance: ServerInstance, adminPassword: string, actorId?: string): Promise<void> {
    await this.palworld.forInstance(instance, adminPassword).save();
    await this.audit.record({
      ...(actorId ? { actorId } : {}),
      action: 'WORLD_SAVE',
      targetId: instance.id,
      message: actorId ? 'World save requested.' : 'World save requested by scheduled backup.',
    });
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

  logLines(instanceId: string): string[] {
    return this.adapter.logs(instanceId);
  }

  logs(instanceId: string, filters: { q?: string; stream?: string; limit?: number } = {}): ServerLogResult {
    const entries = this.adapter.logs(instanceId).map((line, index) => this.toLogEntry(line, index));
    const q = filters.q?.trim().toLowerCase();
    const stream = filters.stream === 'stdout' || filters.stream === 'stderr' || filters.stream === 'system' ? filters.stream : '';
    const filtered = entries.filter((entry) => {
      if (stream && entry.stream !== stream) {
        return false;
      }
      if (q && !entry.raw.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
    return {
      entries: filtered.slice(-limit),
      total: entries.length,
      filtered: filtered.length,
    };
  }

  private async waitForExitOrForce(instance: ServerInstance): Promise<void> {
    try {
      await this.waitForStopped(instance, instance.shutdownWaitSeconds + 15);
      return;
    } catch {
      // The instance policy explicitly permits escalation after the graceful timeout.
    }
    await this.adapter.forceStop(instance);
  }

  private toLogEntry(line: string, index: number): ServerLogEntry {
    const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const body = timestampMatch?.[2] ?? line;
    const streamMatch = body.match(/^\[(stdout|stderr)\]\s*(.*)$/i);
    return {
      index,
      timestamp: timestampMatch?.[1] ?? null,
      stream: streamMatch ? (streamMatch[1]!.toLowerCase() as 'stdout' | 'stderr') : 'system',
      message: streamMatch?.[2] ?? body,
      raw: line,
    };
  }
}
