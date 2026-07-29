CREATE TABLE "AppSecret" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ManagedMod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverInstanceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "folderName" TEXT,
    "relativePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "loadPriority" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT,
    "author" TEXT,
    "description" TEXT,
    "sourceModId" INTEGER,
    "downloadedFile" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManagedMod_serverInstanceId_fkey" FOREIGN KEY ("serverInstanceId") REFERENCES "ServerInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ManagedMod_serverInstanceId_sourceKey_key" ON "ManagedMod"("serverInstanceId", "sourceKey");
CREATE INDEX "ManagedMod_serverInstanceId_loadPriority_idx" ON "ManagedMod"("serverInstanceId", "loadPriority");
