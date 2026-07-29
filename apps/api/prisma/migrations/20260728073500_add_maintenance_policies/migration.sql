ALTER TABLE "ServerInstance" ADD COLUMN "backupBeforeUpdate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServerInstance" ADD COLUMN "backupBeforeConfigChange" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServerInstance" ADD COLUMN "forceStopAfterGracefulTimeout" BOOLEAN NOT NULL DEFAULT false;
