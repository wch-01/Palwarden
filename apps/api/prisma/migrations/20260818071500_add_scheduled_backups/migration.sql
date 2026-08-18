ALTER TABLE "ServerInstance" ADD COLUMN "scheduledBackupsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServerInstance" ADD COLUMN "scheduledBackupIntervalMinutes" INTEGER NOT NULL DEFAULT 360;
ALTER TABLE "ServerInstance" ADD COLUMN "scheduledBackupRetentionCount" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "ServerInstance" ADD COLUMN "scheduledBackupNextRunAt" DATETIME;
ALTER TABLE "ServerInstance" ADD COLUMN "lastScheduledBackupAt" DATETIME;
