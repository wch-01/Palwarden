CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "csrfToken" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TABLE "LoginAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoginAttempt_username_ipAddress_createdAt_idx" ON "LoginAttempt"("username", "ipAddress", "createdAt");

CREATE TABLE "ServerInstance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "installationDirectory" TEXT NOT NULL,
  "executablePath" TEXT NOT NULL,
  "workingDirectory" TEXT NOT NULL,
  "configurationFilePath" TEXT NOT NULL,
  "saveDirectory" TEXT NOT NULL,
  "backupDirectory" TEXT NOT NULL,
  "restApiHost" TEXT NOT NULL DEFAULT '127.0.0.1',
  "restApiPort" INTEGER NOT NULL,
  "encryptedAdminPassword" TEXT,
  "encryptedAdminPasswordIv" TEXT,
  "encryptedAdminPasswordTag" TEXT,
  "gamePort" INTEGER NOT NULL,
  "queryPort" INTEGER NOT NULL,
  "launchArgumentsJson" TEXT NOT NULL DEFAULT '[]',
  "autoStart" BOOLEAN NOT NULL DEFAULT false,
  "autoRestart" BOOLEAN NOT NULL DEFAULT false,
  "backupBeforeRestart" BOOLEAN NOT NULL DEFAULT false,
  "shutdownWaitSeconds" INTEGER NOT NULL DEFAULT 30,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ServerInstance_installationDirectory_key" ON "ServerInstance"("installationDirectory");

CREATE TABLE "BackupRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serverInstanceId" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "failureMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "message" TEXT NOT NULL,
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
