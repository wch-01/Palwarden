CREATE TABLE "Ue4ssInstall" (
    "serverInstanceId" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT,
    "managedPathsJson" TEXT NOT NULL DEFAULT '[]',
    "installedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ue4ssInstall_serverInstanceId_fkey" FOREIGN KEY ("serverInstanceId") REFERENCES "ServerInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
