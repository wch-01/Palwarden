import type { ServerInstance } from '@prisma/client';
import type { RuntimeState } from '@palwarden/shared';

export interface ServerProcessResult {
  pid: number;
  state: RuntimeState;
}

export interface ServerProcessStatus {
  state: RuntimeState;
  pid?: number;
  uptimeSeconds: number;
}

export interface ServerProcessAdapter {
  start(instance: ServerInstance): Promise<ServerProcessResult>;
  requestGracefulStop(instance: ServerInstance): Promise<void>;
  forceStop(instance: ServerInstance): Promise<void>;
  getStatus(instanceId: string): ServerProcessStatus;
  assertStopped(instanceId: string): Promise<void>;
  logs(instanceId: string): string[];
}
