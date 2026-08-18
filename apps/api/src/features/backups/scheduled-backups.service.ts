import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { BackupsService } from './backups.service';

@Injectable()
export class ScheduledBackupsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduledBackupsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.runDueBackups();
    }, 60_000);
    setTimeout(() => {
      void this.runDueBackups();
    }, 10_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runDueBackups(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const dueServers = await this.prisma.serverInstance.findMany({
        where: {
          scheduledBackupsEnabled: true,
          OR: [{ scheduledBackupNextRunAt: null }, { scheduledBackupNextRunAt: { lte: now } }],
        },
        orderBy: { displayName: 'asc' },
      });
      for (const server of dueServers) {
        try {
          await this.backups.createTriggered(server.id, undefined, 'SCHEDULED');
          await this.backups.pruneScheduledBackups(server.id, server.scheduledBackupRetentionCount);
          await this.advanceSchedule(server.id, server.scheduledBackupIntervalMinutes, true);
          this.logger.log(`Scheduled backup created for ${server.displayName}.`);
        } catch (error) {
          await this.advanceSchedule(server.id, server.scheduledBackupIntervalMinutes, false);
          const message = error instanceof Error ? error.message : 'Scheduled backup failed.';
          this.logger.warn(`Scheduled backup failed for ${server.displayName}: ${message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async advanceSchedule(serverInstanceId: string, intervalMinutes: number, success: boolean): Promise<void> {
    await this.prisma.serverInstance.update({
      where: { id: serverInstanceId },
      data: {
        scheduledBackupNextRunAt: new Date(Date.now() + Math.max(1, intervalMinutes) * 60_000),
        ...(success ? { lastScheduledBackupAt: new Date() } : {}),
      },
    });
  }
}
