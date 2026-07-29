CREATE TABLE "ModRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverInstanceId" TEXT NOT NULL,
    "nexusModId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "pictureUrl" TEXT,
    "requestedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ModRequest_serverInstanceId_fkey" FOREIGN KEY ("serverInstanceId") REFERENCES "ServerInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModRequest_serverInstanceId_nexusModId_status_key" ON "ModRequest"("serverInstanceId", "nexusModId", "status");
CREATE INDEX "ModRequest_serverInstanceId_createdAt_idx" ON "ModRequest"("serverInstanceId", "createdAt");
