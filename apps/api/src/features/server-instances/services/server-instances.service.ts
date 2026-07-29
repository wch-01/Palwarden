import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ManagedMod, ModRequest, ServerInstance, Prisma } from '@prisma/client';
import type {
  NexusConnectionState,
  NexusInstallPreview,
  NexusInstallTargetKind,
  ServerModDependency,
  NexusModFile,
  NexusModSummary,
  ServerDashboardCard,
  ServerImportPreview,
  ServerInstanceView,
  ServerModInventory,
  ServerModInventoryItem,
  ServerModRequest,
  Ue4ssStatus,
} from '@palwarden/shared';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, constants, cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { basename, extname, parse as parsePath, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../../core/database/prisma.service';
import { CryptoService } from '../../../core/security/crypto.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PalworldApiClientFactory } from '../../palworld-api/clients/palworld-api.client';
import { ProcessManagerService } from '../../process-manager/services/process-manager.service';
import { DeployServerInstanceDto, UpsertServerInstanceDto } from '../dto/server-instance.dto';
import { SteamCmdService } from './steamcmd.service';
import { PalworldSettingsFileService } from './palworld-settings-file.service';

export interface DeployJobView {
  id: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  error: string | null;
  serverInstanceId: string | null;
}

export interface UpdateServerOptions {
  broadcastMessage?: string;
  shutdownWaitSeconds?: number;
}

export interface ServerUpdateAvailabilityView {
  installedBuildId: string | null;
  latestBuildId: string | null;
  updateAvailable: boolean;
}

export interface ServerConfigView {
  entries: Awaited<ReturnType<PalworldSettingsFileService['readConfigEntries']>>;
}

export interface ServerNetworkSettingsView {
  restApiHost: string;
  restApiPort: number;
  gamePort: number;
  queryPort: number;
}

export interface PlayerConnectionAddressView {
  label: string;
  host: string;
  port: number;
  address: string;
  kind: 'lan' | 'tailscale' | 'public';
  note: string;
}

export interface PlayerConnectionView {
  gamePort: number;
  queryPort: number;
  publicListing: boolean | null;
  addresses: PlayerConnectionAddressView[];
  notes: string[];
}

interface NexusArchiveInstallResult {
  kind: ServerModInventoryItem['kind'];
  folderName: string;
  relativePath: string;
}

interface NexusInstallOverride {
  targetKind?: NexusInstallTargetKind;
  folderName?: string;
}

interface NexusArchivePlan {
  targetKind: NexusInstallTargetKind;
  detectedTargetKind: NexusInstallTargetKind;
  folderName: string;
  relativePath: string;
  files: string[];
  pakFiles: string[];
  archiveFileCount: number;
  pakFileCount: number;
  sourceFolder: string;
  warnings: string[];
}

type DetectedModItem = Omit<
  ServerModInventoryItem,
  | 'id'
  | 'status'
  | 'loadPriority'
  | 'sourceModId'
  | 'version'
  | 'latestVersion'
  | 'latestFileId'
  | 'updateAvailable'
  | 'updateCheckedAt'
  | 'updateCheckError'
  | 'author'
  | 'description'
  | 'dependencies'
> & {
  sourceKey: string;
};

@Injectable()
export class ServerInstancesService {
  private readonly deployJobs = new Map<string, DeployJobView>();
  private readonly nexusSecretKey = 'nexus.apiKey';

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditLogService,
    private readonly palworld: PalworldApiClientFactory,
    private readonly processManager: ProcessManagerService,
    private readonly steamcmd: SteamCmdService,
    private readonly settingsFile: PalworldSettingsFileService,
  ) {}

  async list(): Promise<ServerInstanceView[]> {
    return (await this.prisma.serverInstance.findMany({ orderBy: { displayName: 'asc' } })).map((item) =>
      this.toView(item),
    );
  }

  async dashboard(): Promise<ServerDashboardCard[]> {
    const instances = await this.prisma.serverInstance.findMany({ orderBy: { displayName: 'asc' } });
    return Promise.all(
      instances.map(async (instance) => {
        const [runtime, disk, installedModCount] = await Promise.all([
          this.processManager.getRecoveredStatus(instance),
          this.diskTelemetry(instance),
          this.localInstalledModCount(instance),
        ]);
        try {
          const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
          const [info, metrics] = await Promise.all([client.info(), client.metrics()]);
          return {
            ...this.toView(instance),
            runtimeState: runtime.state,
            restConnectivity: 'online',
            currentPlayers: metrics.currentplayernum,
            maxPlayers: metrics.maxplayernum,
            serverFps: metrics.serverfps,
            uptimeSeconds: metrics.uptime,
            installedVersion: info.version,
            hostCpuPercent: runtime.hostCpuPercent ?? null,
            hostMemoryMb: runtime.hostMemoryMb ?? null,
            processCpuAveragePercent: runtime.processCpuAveragePercent ?? null,
            processCpuPeakPercent: runtime.processCpuPeakPercent ?? null,
            processPrivateMemoryMb: runtime.processPrivateMemoryMb ?? null,
            processPeakMemoryMb: runtime.processPeakMemoryMb ?? null,
            installedModCount,
            ...disk,
          };
        } catch {
          const configuredMaxPlayers = await this.readConfiguredMaxPlayers(instance);
          return {
            ...this.toView(instance),
            runtimeState: runtime.state,
            restConnectivity: runtime.state === 'starting' ? 'starting' : 'offline',
            currentPlayers: null,
            maxPlayers: configuredMaxPlayers,
            serverFps: null,
            uptimeSeconds: runtime.uptimeSeconds,
            installedVersion: null,
            hostCpuPercent: runtime.hostCpuPercent ?? null,
            hostMemoryMb: runtime.hostMemoryMb ?? null,
            processCpuAveragePercent: runtime.processCpuAveragePercent ?? null,
            processCpuPeakPercent: runtime.processCpuPeakPercent ?? null,
            processPrivateMemoryMb: runtime.processPrivateMemoryMb ?? null,
            processPeakMemoryMb: runtime.processPeakMemoryMb ?? null,
            installedModCount,
            ...disk,
          };
        }
      }),
    );
  }

  async get(id: string): Promise<ServerInstanceView> {
    return this.toView(await this.getRaw(id));
  }

  async nexusState(): Promise<NexusConnectionState> {
    const record = await this.prisma.appSecret.findUnique({ where: { key: this.nexusSecretKey } });
    if (!record) {
      return { connected: false, username: null, userId: null, isPremium: false, updatedAt: null };
    }
    const metadata = this.parseNexusMetadata(record.metadata);
    return {
      connected: true,
      username: metadata.username,
      userId: metadata.userId,
      isPremium: metadata.isPremium,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async saveNexusApiKey(apiKey: string, actorId: string): Promise<NexusConnectionState> {
    const key = apiKey.trim();
    if (!key) {
      throw new BadRequestException('Nexus Mods API key is required.');
    }
    const validation = await this.validateNexusApiKey(key);
    const encrypted = this.crypto.encrypt(key);
    await this.prisma.appSecret.upsert({
      where: { key: this.nexusSecretKey },
      create: {
        key: this.nexusSecretKey,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        metadata: JSON.stringify(validation),
      },
      update: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        metadata: JSON.stringify(validation),
      },
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', message: 'Nexus Mods API key updated.' });
    return this.nexusState();
  }

  async removeNexusApiKey(actorId: string): Promise<NexusConnectionState> {
    await this.prisma.appSecret.delete({ where: { key: this.nexusSecretKey } }).catch(() => null);
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', message: 'Nexus Mods API key removed.' });
    return this.nexusState();
  }

  async nexusMods(list: 'trending' | 'latest_added' | 'latest_updated', query = ''): Promise<NexusModSummary[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.fetchNexusMods(list);
    }
    try {
      return await this.fetchNexusMods(list, trimmed);
    } catch {
      const lists: Array<'trending' | 'latest_added' | 'latest_updated'> = ['trending', 'latest_added', 'latest_updated'];
      const results = await Promise.all(lists.map((entry) => this.fetchNexusMods(entry).catch(() => [])));
      return this.filterNexusSearchResults(results.flat(), trimmed);
    }
  }

  async searchNexusMods(query: string): Promise<NexusModSummary[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('Enter at least 2 characters to search Nexus Mods.');
    }
    const lists: Array<'trending' | 'latest_added' | 'latest_updated'> = ['trending', 'latest_added', 'latest_updated'];
    const [direct, ...broad] = await Promise.all([
      this.fetchNexusMods('trending', trimmed, 250).catch(() => []),
      ...lists.map((entry) => this.fetchNexusMods(entry, undefined, 250).catch(() => [])),
    ]);
    return this.rankNexusSearchResults([...direct, ...this.filterNexusSearchResults(broad.flat(), trimmed)], trimmed);
  }

  async nexusModFiles(nexusModId: number): Promise<NexusModFile[]> {
    const apiKey = await this.requireNexusApiKey();
    const payload = await this.nexusRest(`/games/palworld/mods/${nexusModId}/files.json`, apiKey);
    return this.installableNexusFiles(payload);
  }

  async modRequests(id: string): Promise<ServerModRequest[]> {
    await this.getRaw(id);
    const requests = await this.prisma.modRequest.findMany({
      where: { serverInstanceId: id },
      include: { requestedBy: { select: { username: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return requests.map((request) => this.toModRequestView(request));
  }

  async requestNexusMod(
    id: string,
    dto: { nexusModId: number; name: string; author: string; summary?: string; pictureUrl?: string | null },
    actorId: string,
  ): Promise<ServerModRequest[]> {
    await this.getRaw(id);
    const pending = await this.prisma.modRequest.findFirst({
      where: { serverInstanceId: id, nexusModId: dto.nexusModId, status: 'pending' },
    });
    const data = {
      name: dto.name,
      author: dto.author,
      summary: dto.summary ?? '',
      pictureUrl: this.normalizeExternalImageUrl(dto.pictureUrl ?? null),
      requestedByUserId: actorId,
    };
    if (pending) {
      await this.prisma.modRequest.update({
        where: { id: pending.id },
        data,
      });
    } else {
      await this.prisma.modRequest.create({
        data: {
          ...data,
          serverInstanceId: id,
          nexusModId: dto.nexusModId,
        },
      });
    }
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Nexus mod requested.', metadata: { nexusModId: dto.nexusModId } });
    return this.modRequests(id);
  }

  async denyModRequest(id: string, requestId: string, actorId: string): Promise<ServerModRequest[]> {
    await this.prisma.modRequest.updateMany({
      where: { id: requestId, serverInstanceId: id, status: 'pending' },
      data: { status: 'denied', decidedAt: new Date() },
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Nexus mod request denied.', metadata: { requestId } });
    return this.modRequests(id);
  }

  async approveModRequest(id: string, requestId: string, actorId: string): Promise<ServerModInventory> {
    const request = await this.prisma.modRequest.findFirst({ where: { id: requestId, serverInstanceId: id, status: 'pending' } });
    if (!request) {
      throw new NotFoundException('Mod request not found.');
    }
    const inventory = await this.installNexusMod(id, request.nexusModId, undefined, actorId);
    await this.prisma.modRequest.update({ where: { id: request.id }, data: { status: 'approved', decidedAt: new Date() } });
    return inventory;
  }

  async create(dto: UpsertServerInstanceDto, actorId: string): Promise<ServerInstanceView> {
    await this.validate(dto);
    const encrypted = dto.adminPassword ? this.crypto.encrypt(dto.adminPassword) : null;
    const instance = await this.prisma.serverInstance.create({ data: this.toCreateData(dto, encrypted) });
    await this.audit.record({ actorId, action: 'SERVER_CREATED', targetId: instance.id, message: 'Server profile created.' });
    if (encrypted) {
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: instance.id, message: 'Server credential saved.' });
    }
    return this.toView(instance);
  }

  defaultInstallDirectory(name: string): { path: string } {
    return { path: this.defaultInstallPath(name) };
  }

  async importPreview(installationDirectory: string, displayName: string): Promise<ServerImportPreview> {
    const installDirectory = this.resolveInstallPath(installationDirectory.trim());
    if (!installationDirectory.trim()) {
      throw new BadRequestException('Installation directory is required.');
    }
    const executablePath = join(installDirectory, 'PalServer.exe');
    const configurationFilePath = this.settingsFile.configPath(installDirectory);
    const saveDirectory = this.settingsFile.saveDirectory(installDirectory);
    const backupDirectory = join(this.dataDirectory(), 'backups', this.sanitizeServerFolderName(displayName || 'Imported Server'));
    const [executable, configuration, saves] = await Promise.all([
      this.fileExists(executablePath),
      this.fileExists(configurationFilePath),
      this.directoryExists(saveDirectory),
    ]);
    const entries = configuration ? await this.settingsFile.readConfigEntries(configurationFilePath).catch(() => []) : [];
    const value = (key: string) => entries.find((entry) => entry.key === key)?.value;
    const warnings: string[] = [];
    if (!(await this.directoryExists(installDirectory))) {
      warnings.push('The installation directory does not exist.');
    }
    if (!executable) {
      warnings.push('PalServer.exe was not found in the installation directory.');
    }
    if (!configuration) {
      warnings.push('PalWorldSettings.ini was not found in the normal WindowsServer config folder.');
    }
    if (!saves) {
      warnings.push('The normal Palworld save directory was not found yet. This can be normal before the server has started once.');
    }
    if (this.stringSetting(value('RESTAPIEnabled'))?.toLowerCase() !== 'true') {
      warnings.push('REST API is not enabled in the detected config. Palwarden needs RESTAPIEnabled=True for server controls.');
    }
    if (!this.stringSetting(value('AdminPassword'))) {
      warnings.push('No AdminPassword was found in the detected config. Enter one before importing.');
    }
    return {
      installationDirectory: installDirectory,
      executablePath,
      workingDirectory: installDirectory,
      configurationFilePath,
      saveDirectory,
      backupDirectory,
      detected: {
        executable,
        configuration,
        saveDirectory: saves,
      },
      settings: {
        serverName: this.stringSetting(value('ServerName')),
        restApiPort: this.numberSetting(value('RESTAPIPort')),
        gamePort: this.numberSetting(value('PublicPort')),
        queryPort: this.numberSetting(value('PublicQueryPort')),
        maxPlayers: this.numberSetting(value('ServerPlayerMaxNum')),
        adminPasswordConfigured: Boolean(this.stringSetting(value('AdminPassword'))),
      },
      warnings,
    };
  }

  getDeployJob(id: string): DeployJobView {
    const job = this.deployJobs.get(id);
    if (!job) {
      throw new NotFoundException('Deploy job not found.');
    }
    return job;
  }

  updateServer(id: string, options: UpdateServerOptions, actorId: string): DeployJobView {
    const job: DeployJobView = {
      id: `update-${nanoid(10)}`,
      status: 'running',
      log: ['Preparing Palworld Dedicated Server update...'],
      error: null,
      serverInstanceId: id,
    };
    this.deployJobs.set(job.id, job);
    setImmediate(() => {
      void this.runUpdate(job, id, options, actorId);
    });
    return job;
  }

  validateServer(id: string, actorId: string): DeployJobView {
    const job: DeployJobView = {
      id: `validate-${nanoid(10)}`,
      status: 'running',
      log: ['Preparing Palworld Dedicated Server validation...'],
      error: null,
      serverInstanceId: id,
    };
    this.deployJobs.set(job.id, job);
    setImmediate(() => {
      void this.runValidate(job, id, actorId);
    });
    return job;
  }

  deploy(dto: DeployServerInstanceDto, actorId: string, requestedJobId?: string): DeployJobView {
    const installDirectory = this.resolveInstallPath(dto.installationDirectory?.trim() || this.defaultInstallPath(dto.displayName));
    const job: DeployJobView = {
      id: requestedJobId?.startsWith('deploy-') ? requestedJobId : `deploy-${nanoid(10)}`,
      status: 'running',
      log: ['Preparing Palworld Dedicated Server deployment...'],
      error: null,
      serverInstanceId: null,
    };
    this.deployJobs.set(job.id, job);
    console.log(`[deploy-job] created ${job.id} for ${dto.displayName}`);
    setImmediate(() => {
      void this.runDeploy(job, dto, actorId, installDirectory);
    });
    return job;
  }

  async update(id: string, dto: UpsertServerInstanceDto, actorId: string): Promise<ServerInstanceView> {
    await this.getRaw(id);
    await this.validate(dto, id);
    const encrypted = dto.adminPassword ? this.crypto.encrypt(dto.adminPassword) : undefined;
    const instance = await this.prisma.serverInstance.update({
      where: { id },
      data: this.toUpdateData(dto, encrypted),
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server profile updated.' });
    if (encrypted) {
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: id, message: 'Server credential replaced.' });
    }
    return this.toView(instance);
  }

  async updateNetworkSettings(id: string, dto: ServerNetworkSettingsView, actorId: string): Promise<ServerInstanceView> {
    const existing = await this.getRaw(id);
    this.validateDistinctPorts(dto.restApiPort, dto.gamePort, dto.queryPort);
    await this.validateNoConflicts(
      {
        installationDirectory: existing.installationDirectory,
        restApiPort: dto.restApiPort,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
      },
      id,
    );
    await this.settingsFile.updateConfigEntries(existing.configurationFilePath, {
      PublicPort: dto.gamePort,
      QueryPort: dto.queryPort,
      RESTAPIEnabled: true,
      RESTAPIPort: dto.restApiPort,
    });
    const instance = await this.prisma.serverInstance.update({
      where: { id },
      data: {
        restApiHost: dto.restApiHost,
        restApiPort: dto.restApiPort,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
        updatedAt: new Date(),
      },
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server network ports updated.' });
    return this.toView(instance);
  }

  async playerConnection(id: string): Promise<PlayerConnectionView> {
    const instance = await this.getRaw(id);
    const publicListing = await this.readPublicListing(instance);
    const addresses = this.localPlayerAddresses(instance.gamePort);
    return {
      gamePort: instance.gamePort,
      queryPort: instance.queryPort,
      publicListing,
      addresses,
      notes: [
        'Public listing only advertises the server. It does not create a tunnel or automatically open router/firewall ports.',
        'For public internet play, allow the game and query ports through Windows Firewall and forward them on the router.',
        'For Tailscale play, players must be on the tailnet or have the machine shared with them, then connect to the Tailscale address.',
      ],
    };
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.getRaw(id);
    await this.processManager.assertStopped(id);
    await this.prisma.serverInstance.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'SERVER_DELETED', targetId: id, message: 'Server profile deleted.' });
  }

  async openInstallationDirectory(id: string): Promise<{ ok: true }> {
    const instance = await this.getRaw(id);
    await this.requireDirectory(instance.installationDirectory, 'Installation directory');
    if (process.platform !== 'win32') {
      throw new BadRequestException('Host file browsing is only implemented for Windows.');
    }
    const child = spawn('explorer.exe', [instance.installationDirectory], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  }

  async testConnection(id: string): Promise<{ ok: true; info: unknown; metrics: unknown }> {
    const instance = await this.getRaw(id);
    const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
    return { ok: true, info: await client.info(), metrics: await client.metrics() };
  }

  async updateAvailability(id: string): Promise<ServerUpdateAvailabilityView> {
    const instance = await this.getRaw(id);
    return this.steamcmd.updateAvailability(instance.installationDirectory);
  }

  async roster(id: string): Promise<{ players: unknown[]; guilds: unknown[] }> {
    const instance = await this.getRaw(id);
    const client = this.palworld.forInstance(instance, this.decryptPassword(instance));
    return { players: await client.players(), guilds: [] };
  }

  async mods(id: string): Promise<ServerModInventory> {
    const instance = await this.getRaw(id);
    const pakRoot = join(instance.installationDirectory, 'Pal', 'Content', 'Paks');
    const pakModsRoot = join(pakRoot, '~mods');
    const logicRoot = join(pakRoot, 'LogicMods');
    const ue4ssRoot = join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64', 'Mods');
    const roots = await Promise.all([
      this.modRoot('Pak Mods', pakModsRoot),
      this.modRoot('Logic Mods', logicRoot),
      this.modRoot('UE4SS Mods', ue4ssRoot),
    ]);
    const ue4ssInstall = await this.prisma.ue4ssInstall.findUnique({ where: { serverInstanceId: id } });
    const ignoredUe4ssFolders = this.ue4ssLoaderModFolders(ue4ssInstall?.managedPathsJson);
    const [pakItems, logicItems, ue4ssItems] = await Promise.all([
      this.scanPakMods(instance.installationDirectory, pakRoot, pakModsRoot),
      this.scanLogicMods(instance.installationDirectory, logicRoot),
      this.scanUe4ssMods(instance.installationDirectory, ue4ssRoot, ignoredUe4ssFolders),
    ]);
    const items = await this.enrichNexusModMetadata(await this.reconcileManagedMods(instance, [...pakItems, ...logicItems, ...ue4ssItems]));
    const warnings: string[] = [];
    if (!roots.some((root) => root.exists)) {
      warnings.push('No common Palworld mod folders were found for this server installation.');
    }
    return {
      serverInstanceId: id,
      scannedAt: new Date().toISOString(),
      roots,
      items,
      warnings,
    };
  }

  private async localInstalledModCount(instance: ServerInstance): Promise<number | null> {
    try {
      const pakRoot = join(instance.installationDirectory, 'Pal', 'Content', 'Paks');
      const pakModsRoot = join(pakRoot, '~mods');
      const logicRoot = join(pakRoot, 'LogicMods');
      const ue4ssRoot = join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64', 'Mods');
      const ue4ssInstall = await this.prisma.ue4ssInstall.findUnique({ where: { serverInstanceId: instance.id } });
      const ignoredUe4ssFolders = this.ue4ssLoaderModFolders(ue4ssInstall?.managedPathsJson);
      const [pakItems, logicItems, ue4ssItems, disabledItems] = await Promise.all([
        this.scanPakMods(instance.installationDirectory, pakRoot, pakModsRoot),
        this.scanLogicMods(instance.installationDirectory, logicRoot),
        this.scanUe4ssMods(instance.installationDirectory, ue4ssRoot, ignoredUe4ssFolders),
        this.prisma.managedMod.count({ where: { serverInstanceId: instance.id, status: 'disabled' } }),
      ]);
      const keys = new Set([...pakItems, ...logicItems, ...ue4ssItems].map((item) => item.sourceKey));
      return keys.size + disabledItems;
    } catch {
      return null;
    }
  }

  private async readPublicListing(instance: ServerInstance): Promise<boolean | null> {
    const entries = await this.settingsFile.readConfigEntries(instance.configurationFilePath).catch(() => []);
    const publicEntry = entries.find((entry) => entry.key === 'bIsPublic');
    return typeof publicEntry?.value === 'boolean' ? publicEntry.value : null;
  }

  private localPlayerAddresses(gamePort: number): PlayerConnectionAddressView[] {
    const addresses: PlayerConnectionAddressView[] = [];
    for (const [name, entries] of Object.entries(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal || !entry.address) continue;
        const kind = this.isTailscaleAddress(entry.address) ? 'tailscale' : 'lan';
        addresses.push({
          label: kind === 'tailscale' ? `Tailscale (${name})` : `LAN (${name})`,
          host: entry.address,
          port: gamePort,
          address: `${entry.address}:${gamePort}`,
          kind,
          note:
            kind === 'tailscale'
              ? 'Share this with players who can reach this machine through Tailscale.'
              : 'Share this with players on the same local network.',
        });
      }
    }
    addresses.push({
      label: 'Public Internet',
      host: '<public-ip-or-dns>',
      port: gamePort,
      address: `<public-ip-or-dns>:${gamePort}`,
      kind: 'public',
      note: 'Replace with your WAN IP or DNS name after firewall and router forwarding are configured.',
    });
    return addresses;
  }

  private isTailscaleAddress(address: string): boolean {
    const parts = address.split('.').map((part) => Number(part));
    const [first, second] = parts;
    return first === 100 && second !== undefined && second >= 64 && second <= 127;
  }

  async enableMod(id: string, modId: string, actorId: string): Promise<ServerModInventory> {
    const instance = await this.getRaw(id);
    const mod = await this.getManagedMod(id, modId);
    await this.moveMod(instance, mod, 'enable');
    await this.prisma.managedMod.update({ where: { id: mod.id }, data: { status: 'enabled' } });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Mod enabled.', metadata: { modId: mod.id, name: mod.name } });
    return this.mods(id);
  }

  async disableMod(id: string, modId: string, actorId: string): Promise<ServerModInventory> {
    const instance = await this.getRaw(id);
    const mod = await this.getManagedMod(id, modId);
    await this.moveMod(instance, mod, 'disable');
    await this.prisma.managedMod.update({ where: { id: mod.id }, data: { status: 'disabled' } });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Mod disabled.', metadata: { modId: mod.id, name: mod.name } });
    return this.mods(id);
  }

  async removeMod(id: string, modId: string, actorId: string): Promise<ServerModInventory> {
    const instance = await this.getRaw(id);
    const mod = await this.getManagedMod(id, modId);
    await this.moveMod(instance, mod, 'remove');
    await this.prisma.managedMod.delete({ where: { id: mod.id } });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Mod removed.', metadata: { modId: mod.id, name: mod.name } });
    return this.mods(id);
  }

  async reorderMods(id: string, orderedIds: string[], actorId: string): Promise<ServerModInventory> {
    await this.getRaw(id);
    await Promise.all(
      orderedIds.map((modId, index) =>
        this.prisma.managedMod.updateMany({
          where: { id: modId, serverInstanceId: id },
          data: { loadPriority: index + 1 },
        }),
      ),
    );
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Mod load order updated.' });
    return this.mods(id);
  }

  async previewNexusModInstall(id: string, nexusModId: number, fileId: number | undefined): Promise<NexusInstallPreview> {
    const instance = await this.getRaw(id);
    const apiKey = await this.requirePremiumNexusApiKey();
    const [details, filesPayload] = await Promise.all([
      this.nexusRest(`/games/palworld/mods/${nexusModId}.json`, apiKey),
      this.nexusRest(`/games/palworld/mods/${nexusModId}/files.json`, apiKey),
    ]);
    const file = this.selectNexusFile(filesPayload, fileId);
    const links = await this.nexusRest(`/games/palworld/mods/${nexusModId}/files/${file.fileId}/download_link.json`, apiKey, true);
    const downloadPath = await this.downloadNexusArchive(nexusModId, file.fileId, file.name, this.downloadLinkUrl(links));
    return this.previewNexusArchive(downloadPath, instance, this.stringField(details, 'name') || file.name || 'Nexus Mod', nexusModId, file);
  }

  async installNexusMod(
    id: string,
    nexusModId: number,
    fileId: number | undefined,
    actorId: string,
    override: NexusInstallOverride = {},
  ): Promise<ServerModInventory> {
    const instance = await this.getRaw(id);
    const apiKey = await this.requirePremiumNexusApiKey();
    const [details, filesPayload] = await Promise.all([
      this.nexusRest(`/games/palworld/mods/${nexusModId}.json`, apiKey),
      this.nexusRest(`/games/palworld/mods/${nexusModId}/files.json`, apiKey),
    ]);
    const file = this.selectNexusFile(filesPayload, fileId);
    const links = await this.nexusRest(`/games/palworld/mods/${nexusModId}/files/${file.fileId}/download_link.json`, apiKey, true);
    const downloadPath = await this.downloadNexusArchive(nexusModId, file.fileId, file.name, this.downloadLinkUrl(links));
    const installed = await this.extractNexusArchive(downloadPath, instance, this.stringField(details, 'name') || file.name || 'Nexus Mod', override);
    const sourceKey = `${installed.kind}:${installed.folderName.toLowerCase()}`;
    const existing = await this.prisma.managedMod.findFirst({
      where: {
        serverInstanceId: id,
        OR: [{ sourceModId: nexusModId }, { sourceKey }],
      },
    });
    const maxPriority = await this.prisma.managedMod.aggregate({ where: { serverInstanceId: id }, _max: { loadPriority: true } });
    const data = {
      serverInstanceId: id,
      sourceKey,
      name: this.stringField(details, 'name') || file.name || 'Nexus Mod',
      kind: installed.kind,
      folderName: installed.folderName,
      relativePath: installed.relativePath,
      status: 'enabled',
      loadPriority: existing?.loadPriority ?? (maxPriority._max.loadPriority ?? -1) + 1,
      version: file.version || this.stringField(details, 'version') || 'See Nexus',
      author: this.stringField(details, 'author') || 'Unknown',
      description: this.stringField(details, 'summary') || this.stringField(details, 'description') || '',
      sourceModId: nexusModId,
      downloadedFile: downloadPath,
    };
    if (existing) {
      await this.prisma.managedMod.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.managedMod.create({ data });
    }
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: id,
      message: 'Nexus mod installed.',
      metadata: { nexusModId, fileId: file.fileId, targetKind: installed.kind, folderName: installed.folderName },
    });
    return this.mods(id);
  }

  async updateNexusMod(id: string, modId: string, fileId: number | undefined, actorId: string): Promise<ServerModInventory> {
    const mod = await this.getManagedMod(id, modId);
    if (!mod.sourceModId) {
      throw new BadRequestException('This mod is not linked to a Nexus Mods source.');
    }
    return this.installNexusMod(id, mod.sourceModId, fileId, actorId);
  }

  async ue4ssStatus(id: string): Promise<Ue4ssStatus> {
    const instance = await this.getRaw(id);
    const [record, latest] = await Promise.all([
      this.prisma.ue4ssInstall.findUnique({ where: { serverInstanceId: id } }),
      this.latestUe4ssRelease().catch(() => null),
    ]);
    const installed = await this.isUe4ssInstalled(instance);
    return {
      installed,
      installedVersion: installed ? record?.version ?? null : null,
      installedAt: installed ? record?.installedAt?.toISOString() ?? null : null,
      latestVersion: latest?.version ?? null,
      latestAssetName: latest?.assetName ?? null,
    };
  }

  async installUe4ss(id: string, actorId: string): Promise<Ue4ssStatus> {
    const instance = await this.getRaw(id);
    const win64 = this.win64Directory(instance);
    if (!(await this.directoryExists(win64))) {
      throw new BadRequestException(`UE4SS install target was not found: ${win64}`);
    }
    const release = await this.latestUe4ssRelease();
    const archivePath = await this.downloadUe4ssRelease(release);
    const managedPaths = await this.extractAndMergeUe4ss(archivePath, win64);
    await this.prisma.ue4ssInstall.upsert({
      where: { serverInstanceId: id },
      create: {
        serverInstanceId: id,
        version: release.version,
        managedPathsJson: JSON.stringify(managedPaths),
        installedAt: new Date(),
      },
      update: {
        version: release.version,
        managedPathsJson: JSON.stringify(managedPaths),
        installedAt: new Date(),
      },
    });
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'UE4SS installed.', metadata: { version: release.version } });
    return this.ue4ssStatus(id);
  }

  async uninstallUe4ss(id: string, actorId: string): Promise<Ue4ssStatus> {
    const instance = await this.getRaw(id);
    const record = await this.prisma.ue4ssInstall.findUnique({ where: { serverInstanceId: id } });
    const managedPaths = this.parseManagedPaths(record?.managedPathsJson);
    const win64 = this.win64Directory(instance);
    await Promise.all(managedPaths.map((managedPath) => this.removeManagedUe4ssPath(win64, managedPath)));
    await this.prisma.ue4ssInstall.delete({ where: { serverInstanceId: id } }).catch(() => null);
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'UE4SS uninstalled.' });
    return this.ue4ssStatus(id);
  }

  async kickPlayer(id: string, userId: string, message: string | undefined, actorId: string): Promise<{ ok: true }> {
    const instance = await this.getRaw(id);
    const targetUserId = this.requirePlayerUserId(userId);
    await this.palworld.forInstance(instance, this.decryptPassword(instance)).kick(targetUserId, this.cleanOptionalMessage(message));
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: id,
      message: 'Player kick requested.',
      metadata: { userId: targetUserId },
    });
    return { ok: true };
  }

  async banPlayer(id: string, userId: string, message: string | undefined, actorId: string): Promise<{ ok: true }> {
    const instance = await this.getRaw(id);
    const targetUserId = this.requirePlayerUserId(userId);
    await this.palworld.forInstance(instance, this.decryptPassword(instance)).ban(targetUserId, this.cleanOptionalMessage(message));
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: id,
      message: 'Player ban requested.',
      metadata: { userId: targetUserId },
    });
    return { ok: true };
  }

  async unbanPlayer(id: string, userId: string, actorId: string): Promise<{ ok: true }> {
    const instance = await this.getRaw(id);
    const targetUserId = this.requirePlayerUserId(userId);
    await this.palworld.forInstance(instance, this.decryptPassword(instance)).unban(targetUserId);
    await this.audit.record({
      actorId,
      action: 'SERVER_UPDATED',
      targetId: id,
      message: 'Player unban requested.',
      metadata: { userId: targetUserId },
    });
    return { ok: true };
  }

  async configuration(id: string): Promise<ServerConfigView> {
    const instance = await this.getRaw(id);
    const entries = await this.settingsFile.readConfigEntries(instance.configurationFilePath);
    return {
      entries: entries.map((entry) => {
        if (!entry.sensitive) {
          return entry;
        }
        const configured =
          entry.key === 'AdminPassword' ? entry.configured && Boolean(instance.encryptedAdminPassword) : entry.configured;
        return { ...entry, value: '', configured };
      }),
    };
  }

  async updateConfiguration(id: string, values: Record<string, string | number | boolean>, actorId: string): Promise<ServerConfigView> {
    const instance = await this.getRaw(id);
    const nextValues = { ...values };
    const adminPassword = typeof nextValues.AdminPassword === 'string' ? nextValues.AdminPassword.trim() : '';
    delete nextValues.AdminPassword;
    if (adminPassword) {
      const encrypted = this.crypto.encrypt(adminPassword);
      await this.prisma.serverInstance.update({
        where: { id },
        data: {
          encryptedAdminPassword: encrypted.ciphertext,
          encryptedAdminPasswordIv: encrypted.iv,
          encryptedAdminPasswordTag: encrypted.tag,
        },
      });
      nextValues.AdminPassword = adminPassword;
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: id, message: 'Server credential replaced.' });
    }
    try {
      await this.settingsFile.updateConfigEntries(instance.configurationFilePath, nextValues);
    } catch (error) {
      if (this.isFileWritePermissionError(error)) {
        throw new BadRequestException(
          'Palwarden could not write the configuration file. Check that the server is stopped and Palwarden has permission to edit the file.',
        );
      }
      throw error;
    }
    await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server configuration updated.' });
    return this.configuration(id);
  }

  async rawWithPassword(id: string): Promise<{ instance: ServerInstance; adminPassword: string }> {
    const instance = await this.getRaw(id);
    return { instance, adminPassword: this.decryptPassword(instance) };
  }

  private async getRaw(id: string): Promise<ServerInstance> {
    const instance = await this.prisma.serverInstance.findUnique({ where: { id } });
    if (!instance) {
      throw new NotFoundException('Server instance not found.');
    }
    return instance;
  }

  private decryptPassword(instance: ServerInstance): string {
    if (!instance.encryptedAdminPassword || !instance.encryptedAdminPasswordIv || !instance.encryptedAdminPasswordTag) {
      throw new BadRequestException('Server AdminPassword is not configured.');
    }
    return this.crypto.decrypt({
      ciphertext: instance.encryptedAdminPassword,
      iv: instance.encryptedAdminPasswordIv,
      tag: instance.encryptedAdminPasswordTag,
    });
  }

  private requirePlayerUserId(value: string | undefined): string {
    const userId = value?.trim();
    if (!userId) {
      throw new BadRequestException('Player user ID is required.');
    }
    return userId;
  }

  private cleanOptionalMessage(value: string | undefined): string | undefined {
    const message = value?.trim();
    return message || undefined;
  }

  private isFileWritePermissionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ['EACCES', 'EPERM', 'EBUSY'].includes(String((error as { code?: unknown }).code))
    );
  }

  private async readConfiguredMaxPlayers(instance: ServerInstance): Promise<number | null> {
    const entries = await this.settingsFile.readConfigEntries(instance.configurationFilePath).catch(() => []);
    const rawValue = entries.find((entry) => entry.key === 'ServerPlayerMaxNum')?.value;
    const parsed = rawValue === undefined ? Number.NaN : Number.parseInt(String(rawValue), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async diskTelemetry(instance: ServerInstance): Promise<{
    installDirectorySizeMb: number | null;
    saveDirectorySizeMb: number | null;
    backupDirectorySizeMb: number | null;
    driveFreeSpaceMb: number | null;
  }> {
    const [installBytes, saveBytes, backupBytes, driveFreeBytes] = await Promise.all([
      this.directorySize(instance.installationDirectory),
      this.directorySize(instance.saveDirectory),
      this.directorySize(instance.backupDirectory),
      this.driveFreeBytes(instance.backupDirectory || instance.installationDirectory),
    ]);
    return {
      installDirectorySizeMb: this.bytesToMb(installBytes),
      saveDirectorySizeMb: this.bytesToMb(saveBytes),
      backupDirectorySizeMb: this.bytesToMb(backupBytes),
      driveFreeSpaceMb: this.bytesToMb(driveFreeBytes),
    };
  }

  private async directorySize(path: string): Promise<number | null> {
    const info = await stat(path).catch(() => null);
    if (!info) {
      return null;
    }
    if (info.isFile()) {
      return info.size;
    }
    if (!info.isDirectory()) {
      return 0;
    }
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    const sizes = await Promise.all(
      entries.map((entry) => this.directorySize(join(path, entry.name)).catch(() => 0)),
    );
    return sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0);
  }

  private async driveFreeBytes(path: string): Promise<number | null> {
    if (process.platform !== 'win32') {
      return null;
    }
    const root = parsePath(resolve(path)).root.replace(/\\$/, '');
    const output = await this.runPowerShell(`Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${root}'" | Select-Object FreeSpace | ConvertTo-Json -Compress`);
    if (!output.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(output) as { FreeSpace?: number };
      return typeof parsed.FreeSpace === 'number' ? parsed.FreeSpace : null;
    } catch {
      return null;
    }
  }

  private runPowerShell(script: string): Promise<string> {
    return new Promise((resolvePromise) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', () => resolvePromise(''));
      child.on('exit', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    });
  }

  private bytesToMb(value: number | null): number | null {
    return value === null ? null : Math.round((value / 1024 / 1024) * 10) / 10;
  }

  private async modRoot(label: string, path: string): Promise<{ label: string; path: string; exists: boolean }> {
    return { label, path, exists: await this.directoryExists(path) };
  }

  private async scanPakMods(installDirectory: string, pakRoot: string, pakModsRoot: string): Promise<DetectedModItem[]> {
    const roots = (await this.directoryExists(pakModsRoot)) ? [pakModsRoot] : [pakRoot];
    const found = await Promise.all(roots.map((root) => this.scanPakModRoot(installDirectory, root)));
    return found.flat().filter((item) => !this.isBasePalworldPakName(item.name));
  }

  private async scanPakModRoot(installDirectory: string, root: string): Promise<DetectedModItem[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const groups = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(root, entry.name);
      const extension = extname(entry.name).toLowerCase();
      if (!['.pak', '.utoc', '.ucas'].includes(extension)) continue;
      const stem = basename(entry.name, extension);
      groups.set(stem, [...(groups.get(stem) ?? []), path]);
    }
    return Promise.all(
      [...groups.entries()].map(([name, files]) => this.modFileGroup(installDirectory, root, name, files, 'pak')),
    );
  }

  private async scanLogicMods(installDirectory: string, logicRoot: string): Promise<DetectedModItem[]> {
    const entries = await readdir(logicRoot, { withFileTypes: true }).catch(() => []);
    const folderItems = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.modFolder(installDirectory, join(logicRoot, entry.name), entry.name, 'logic')),
    );
    const fileGroups = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!['.pak', '.utoc', '.ucas'].includes(extension)) continue;
      const stem = basename(entry.name, extension);
      fileGroups.set(stem, [...(fileGroups.get(stem) ?? []), join(logicRoot, entry.name)]);
    }
    const groupedFiles = await Promise.all(
      [...fileGroups.entries()].map(([name, files]) => this.modFileGroup(installDirectory, logicRoot, name, files, 'logic')),
    );
    return [...folderItems, ...groupedFiles];
  }

  private async scanUe4ssMods(installDirectory: string, ue4ssRoot: string, ignoredFolders = new Set<string>()): Promise<DetectedModItem[]> {
    const entries = await readdir(ue4ssRoot, { withFileTypes: true }).catch(() => []);
    return Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !['shared', 'mods'].includes(entry.name.toLowerCase()))
        .filter((entry) => !ignoredFolders.has(entry.name.toLowerCase()))
        .map((entry) => this.modFolder(installDirectory, join(ue4ssRoot, entry.name), entry.name, 'ue4ss')),
    );
  }

  private ue4ssLoaderModFolders(managedPathsJson: string | null | undefined): Set<string> {
    return new Set(
      this.parseManagedPaths(managedPathsJson)
        .map((managedPath) => managedPath.replace(/\\/g, '/'))
        .filter((managedPath) => managedPath.toLowerCase().startsWith('mods/'))
        .map((managedPath) => managedPath.split('/')[1]?.toLowerCase())
        .filter((folder): folder is string => Boolean(folder)),
    );
  }

  private isBasePalworldPakName(name: string): boolean {
    const normalized = name.toLowerCase();
    return (
      normalized === 'pal-windows' ||
      normalized === 'pal-windowsserver' ||
      normalized === 'pal-windows-server' ||
      normalized.startsWith('pal-windows_') ||
      normalized.startsWith('pal-windowsserver_') ||
      normalized.startsWith('pal-windows-server_')
    );
  }

  private async modFileGroup(
    installDirectory: string,
    root: string,
    name: string,
    files: string[],
    kind: ServerModInventoryItem['kind'],
  ): Promise<DetectedModItem> {
    const stats = await Promise.all(files.map((file) => stat(file).catch(() => null)));
    const extensions = new Set(files.map((file) => extname(file).toLowerCase()));
    const notes: string[] = [];
    if (!extensions.has('.pak')) {
      notes.push('Missing .pak file.');
    }
    if (extensions.has('.utoc') !== extensions.has('.ucas')) {
      notes.push('Only one of .utoc/.ucas was found.');
    }
    const newest = this.newestMtime(stats);
    return {
      sourceKey: `${kind}:${name.toLowerCase()}`,
      name,
      kind,
      path: root,
      relativePath: relative(installDirectory, root) || '.',
      files: files.map((file) => basename(file)).sort(),
      sizeBytes: stats.reduce((sum, info) => sum + (info?.size ?? 0), 0),
      updatedAt: newest?.toISOString() ?? null,
      folderName: name,
      notes,
    };
  }

  private async modFolder(
    installDirectory: string,
    path: string,
    name: string,
    kind: ServerModInventoryItem['kind'],
  ): Promise<DetectedModItem> {
    const files = await this.listFiles(path);
    const stats = await Promise.all(files.map((file) => stat(file).catch(() => null)));
    const newest = this.newestMtime(stats);
    return {
      sourceKey: `${kind}:${name.toLowerCase()}`,
      name,
      kind,
      path,
      relativePath: relative(installDirectory, path) || '.',
      files: files.map((file) => relative(path, file)).sort(),
      sizeBytes: stats.reduce((sum, info) => sum + (info?.size ?? 0), 0),
      updatedAt: newest?.toISOString() ?? null,
      folderName: name,
      notes: files.length ? [] : ['Folder is empty.'],
    };
  }

  private async listFiles(path: string): Promise<string[]> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const child = join(path, entry.name);
        if (entry.isFile()) {
          return [child];
        }
        if (entry.isDirectory()) {
          return this.listFiles(child);
        }
        return [];
      }),
    );
    return nested.flat();
  }

  private newestMtime(stats: Array<{ mtime: Date } | null>): Date | null {
    return stats.reduce<Date | null>((latest, info) => {
      if (!info) return latest;
      return !latest || info.mtime > latest ? info.mtime : latest;
    }, null);
  }

  private async reconcileManagedMods(instance: ServerInstance, detected: DetectedModItem[]): Promise<ServerModInventoryItem[]> {
    const existing = await this.prisma.managedMod.findMany({
      where: { serverInstanceId: instance.id },
      orderBy: [{ loadPriority: 'asc' }, { name: 'asc' }],
    });
    const bySource = new Map(existing.map((mod) => [mod.sourceKey, mod]));
    const maxPriority = existing.reduce((max, mod) => Math.max(max, mod.loadPriority), 0);
    let nextPriority = maxPriority + 1;
    const upserted: ServerModInventoryItem[] = [];

    for (const item of detected) {
      const current = bySource.get(item.sourceKey);
      const managed = await this.prisma.managedMod.upsert({
        where: { serverInstanceId_sourceKey: { serverInstanceId: instance.id, sourceKey: item.sourceKey } },
        create: {
          serverInstanceId: instance.id,
          sourceKey: item.sourceKey,
          name: item.name,
          kind: item.kind,
          folderName: item.folderName,
          relativePath: item.relativePath,
          status: item.notes.length ? 'partial' : 'enabled',
          loadPriority: nextPriority++,
        },
        update: {
          name: item.name,
          kind: item.kind,
          folderName: item.folderName,
          relativePath: item.relativePath,
          status: current?.status === 'disabled' ? 'disabled' : item.notes.length ? 'partial' : 'enabled',
        },
      });
      upserted.push(this.toModInventoryItem(item, managed));
      bySource.delete(item.sourceKey);
    }

    for (const mod of bySource.values()) {
      if (mod.status === 'disabled') {
        upserted.push(await this.disabledModInventoryItem(instance, mod));
      }
    }

    return upserted.sort((a, b) => a.loadPriority - b.loadPriority || a.name.localeCompare(b.name));
  }

  private async enrichNexusModMetadata(items: ServerModInventoryItem[]): Promise<ServerModInventoryItem[]> {
    const nexusItems = items.filter((item) => item.sourceModId);
    if (!nexusItems.length) return items;
    const apiKey = await this.nexusApiKeyOrNull();
    if (!apiKey) {
      return items.map((item) =>
        item.sourceModId
          ? {
              ...item,
              updateCheckError: 'Connect a Nexus Mods API key in Settings to check dependencies and updates.',
            }
          : item,
      );
    }
    const checkedAt = new Date().toISOString();
    const enriched = await Promise.all(
      nexusItems.map(async (item) => {
        try {
          const nexusModId = item.sourceModId!;
          const [details, filesPayload] = await Promise.all([
            this.nexusRest(`/games/palworld/mods/${nexusModId}.json`, apiKey),
            this.nexusRest(`/games/palworld/mods/${nexusModId}/files.json`, apiKey),
          ]);
          const files = this.installableNexusFiles(filesPayload);
          const latestFile = files[0] ?? null;
          const latestVersion = latestFile?.version || this.stringField(this.asRecord(details), 'version') || null;
          return {
            ...item,
            latestVersion,
            latestFileId: latestFile?.fileId ?? null,
            updateAvailable: this.isModUpdateAvailable(item.version, latestVersion),
            updateCheckedAt: checkedAt,
            updateCheckError: null,
            dependencies: this.extractNexusDependencies(this.asRecord(details), filesPayload),
          };
        } catch {
          return {
            ...item,
            updateCheckedAt: checkedAt,
            updateCheckError: 'Could not check Nexus dependency or update metadata.',
          };
        }
      }),
    );
    const byId = new Map(enriched.map((item) => [item.id, item]));
    return items.map((item) => byId.get(item.id) ?? item);
  }

  private isModUpdateAvailable(current: string | null, latest: string | null): boolean {
    if (!current || !latest || current === 'See Nexus') return false;
    const normalizedCurrent = current.trim().toLowerCase();
    const normalizedLatest = latest.trim().toLowerCase();
    if (!normalizedCurrent || !normalizedLatest || normalizedCurrent === normalizedLatest) return false;
    const currentParts = this.versionParts(normalizedCurrent);
    const latestParts = this.versionParts(normalizedLatest);
    if (currentParts.length && latestParts.length) {
      const length = Math.max(currentParts.length, latestParts.length);
      for (let index = 0; index < length; index++) {
        const latestPart = latestParts[index] ?? 0;
        const currentPart = currentParts[index] ?? 0;
        if (latestPart !== currentPart) return latestPart > currentPart;
      }
      return false;
    }
    return normalizedLatest !== normalizedCurrent;
  }

  private versionParts(value: string): number[] {
    const matches = value.match(/\d+/g);
    return matches ? matches.map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part)) : [];
  }

  private extractNexusDependencies(
    details: Record<string, unknown>,
    filesPayload: Record<string, unknown> | Record<string, unknown>[],
  ): ServerModDependency[] {
    const candidates: unknown[] = [
      details.dependencies,
      details.requirements,
      details.required_files,
      details.requiredFiles,
      details.file_requirements,
      details.fileRequirements,
      details.mod_requirements,
      details.modRequirements,
    ];
    const files = Array.isArray(filesPayload) ? filesPayload : this.asRecord(filesPayload).files;
    if (Array.isArray(files)) {
      for (const file of files) {
        const record = this.asRecord(file);
        candidates.push(record.dependencies, record.requirements, record.required_files, record.file_requirements);
      }
    }
    const dependencies = candidates.flatMap((candidate) => this.flattenNexusDependencies(candidate));
    const unique = new Map<string, ServerModDependency>();
    for (const dependency of dependencies) {
      const key = `${dependency.nexusModId ?? 'external'}:${dependency.name.toLowerCase()}:${dependency.notes ?? ''}`;
      if (!unique.has(key)) {
        unique.set(key, dependency);
      }
    }
    return [...unique.values()].sort((a, b) => Number(b.required ?? false) - Number(a.required ?? false) || a.name.localeCompare(b.name));
  }

  private flattenNexusDependencies(value: unknown): ServerModDependency[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.flattenNexusDependencies(entry));
    }
    if (typeof value === 'string') {
      return value.trim() ? [{ name: value.trim(), nexusModId: null, nexusUrl: null, required: null, notes: null }] : [];
    }
    const record = this.asRecord(value);
    if (this.looksLikeDependency(record)) {
      return [this.toNexusDependency(record)];
    }
    return Object.values(record).flatMap((entry) => this.flattenNexusDependencies(entry));
  }

  private looksLikeDependency(record: Record<string, unknown>): boolean {
    return Boolean(
      this.stringField(record, 'name') ||
        this.stringField(record, 'mod_name') ||
        this.stringField(record, 'modName') ||
        this.stringField(record, 'title') ||
        this.stringField(record, 'file_name') ||
        this.numberField(record, 'mod_id') ||
        this.numberField(record, 'modId') ||
        this.numberField(record, 'nexus_mod_id'),
    );
  }

  private toNexusDependency(record: Record<string, unknown>): ServerModDependency {
    const nexusModId = this.numberField(record, 'mod_id') ?? this.numberField(record, 'modId') ?? this.numberField(record, 'nexus_mod_id');
    const name =
      this.stringField(record, 'name') ||
      this.stringField(record, 'mod_name') ||
      this.stringField(record, 'modName') ||
      this.stringField(record, 'title') ||
      this.stringField(record, 'file_name') ||
      (nexusModId ? `Nexus mod ${nexusModId}` : 'External requirement');
    const url = this.stringField(record, 'url') || this.stringField(record, 'nexusUrl') || (nexusModId ? `https://www.nexusmods.com/palworld/mods/${nexusModId}` : null);
    const required =
      this.optionalBooleanField(record, 'required') ??
      this.optionalBooleanField(record, 'is_required') ??
      this.optionalBooleanField(record, 'isRequired') ??
      (this.stringField(record, 'type')?.toLowerCase().includes('required') ? true : null);
    const notes =
      this.stringField(record, 'notes') ||
      this.stringField(record, 'description') ||
      this.stringField(record, 'comment') ||
      this.stringField(record, 'type') ||
      null;
    return { name, nexusModId: nexusModId ?? null, nexusUrl: url, required, notes };
  }

  private toModInventoryItem(item: DetectedModItem, managed: ManagedMod): ServerModInventoryItem {
    return {
      id: managed.id,
      name: managed.name,
      kind: managed.kind as ServerModInventoryItem['kind'],
      path: item.path,
      relativePath: item.relativePath,
      files: item.files,
      sizeBytes: item.sizeBytes,
      updatedAt: item.updatedAt,
      status: managed.status === 'disabled' ? 'disabled' : item.notes.length ? 'partial' : 'enabled',
      loadPriority: managed.loadPriority,
      folderName: managed.folderName,
      sourceModId: managed.sourceModId,
      version: managed.version,
      latestVersion: null,
      latestFileId: null,
      updateAvailable: false,
      updateCheckedAt: null,
      updateCheckError: null,
      author: managed.author,
      description: managed.description,
      dependencies: [],
      notes: item.notes,
    };
  }

  private async disabledModInventoryItem(instance: ServerInstance, mod: ManagedMod): Promise<ServerModInventoryItem> {
    const disabledPath = this.disabledModPath(instance.id, mod);
    const files = await this.listFiles(disabledPath);
    const stats = await Promise.all(files.map((file) => stat(file).catch(() => null)));
    return {
      id: mod.id,
      name: mod.name,
      kind: mod.kind as ServerModInventoryItem['kind'],
      path: disabledPath,
      relativePath: `Disabled Mods\\${mod.kind}\\${mod.folderName ?? mod.name}`,
      files: files.map((file) => relative(disabledPath, file)).sort(),
      sizeBytes: stats.reduce((sum, info) => sum + (info?.size ?? 0), 0),
      updatedAt: this.newestMtime(stats)?.toISOString() ?? null,
      status: 'disabled',
      loadPriority: mod.loadPriority,
      folderName: mod.folderName,
      sourceModId: mod.sourceModId,
      version: mod.version,
      latestVersion: null,
      latestFileId: null,
      updateAvailable: false,
      updateCheckedAt: null,
      updateCheckError: null,
      author: mod.author,
      description: mod.description,
      dependencies: [],
      notes: files.length ? [] : ['Disabled files were not found in staging.'],
    };
  }

  private async getManagedMod(serverInstanceId: string, modId: string): Promise<ManagedMod> {
    const mod = await this.prisma.managedMod.findFirst({ where: { id: modId, serverInstanceId } });
    if (!mod) {
      throw new NotFoundException('Managed mod not found.');
    }
    return mod;
  }

  private async moveMod(instance: ServerInstance, mod: ManagedMod, action: 'enable' | 'disable' | 'remove'): Promise<void> {
    if (mod.kind === 'pak') {
      await this.movePakMod(instance, mod, action);
      return;
    }
    await this.moveFolderMod(instance, mod, action);
  }

  private async moveFolderMod(instance: ServerInstance, mod: ManagedMod, action: 'enable' | 'disable' | 'remove'): Promise<void> {
    const live = this.liveModFolderPath(instance, mod);
    const disabled = this.disabledModPath(instance.id, mod);
    if (action === 'remove') {
      await Promise.all([rm(live, { recursive: true, force: true }), rm(disabled, { recursive: true, force: true })]);
      return;
    }
    if (action === 'disable') {
      await mkdir(this.dirname(disabled), { recursive: true });
      if (await this.directoryExists(live)) {
        await rm(disabled, { recursive: true, force: true });
        await rename(live, disabled);
      }
      return;
    }
    await mkdir(this.dirname(live), { recursive: true });
    if (await this.directoryExists(disabled)) {
      await rm(live, { recursive: true, force: true });
      await rename(disabled, live);
    }
  }

  private async movePakMod(instance: ServerInstance, mod: ManagedMod, action: 'enable' | 'disable' | 'remove'): Promise<void> {
    const liveRoot = this.livePakRoot(instance);
    const disabledRoot = this.disabledModPath(instance.id, mod);
    const folderName = mod.folderName ?? mod.name;
    const extensions = ['.pak', '.utoc', '.ucas'];
    if (action === 'remove') {
      await Promise.all([
        ...extensions.map((extension) => rm(join(liveRoot, `${folderName}${extension}`), { force: true })),
        rm(disabledRoot, { recursive: true, force: true }),
      ]);
      return;
    }
    if (action === 'disable') {
      await mkdir(disabledRoot, { recursive: true });
      await Promise.all(
        extensions.map(async (extension) => {
          const source = join(liveRoot, `${folderName}${extension}`);
          if (await this.fileExists(source)) {
            const destination = join(disabledRoot, `${folderName}${extension}`);
            await rm(destination, { force: true });
            await rename(source, destination);
          }
        }),
      );
      return;
    }
    await mkdir(liveRoot, { recursive: true });
    await Promise.all(
      extensions.map(async (extension) => {
        const source = join(disabledRoot, `${folderName}${extension}`);
        if (await this.fileExists(source)) {
          const destination = join(liveRoot, `${folderName}${extension}`);
          await rm(destination, { force: true });
          await rename(source, destination);
        }
      }),
    );
  }

  private liveModFolderPath(instance: ServerInstance, mod: ManagedMod): string {
    const folderName = mod.folderName ?? mod.name;
    if (mod.kind === 'logic') {
      return join(instance.installationDirectory, 'Pal', 'Content', 'Paks', 'LogicMods', folderName);
    }
    return join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64', 'Mods', folderName);
  }

  private livePakRoot(instance: ServerInstance): string {
    return join(instance.installationDirectory, 'Pal', 'Content', 'Paks', '~mods');
  }

  private disabledModPath(serverInstanceId: string, mod: Pick<ManagedMod, 'kind' | 'folderName' | 'name'>): string {
    return join(this.dataDirectory(), 'disabled-mods', serverInstanceId, mod.kind, mod.folderName ?? mod.name);
  }

  private dirname(path: string): string {
    return parsePath(path).dir;
  }

  private async requireNexusApiKey(): Promise<string> {
    const record = await this.prisma.appSecret.findUnique({ where: { key: this.nexusSecretKey } });
    if (!record) {
      throw new BadRequestException('Connect a Nexus Mods API key in Settings first.');
    }
    return this.crypto.decrypt({ ciphertext: record.ciphertext, iv: record.iv, tag: record.tag });
  }

  private async requirePremiumNexusApiKey(): Promise<string> {
    const record = await this.prisma.appSecret.findUnique({ where: { key: this.nexusSecretKey } });
    if (!record) {
      throw new BadRequestException('Connect a Nexus Mods API key in Settings first.');
    }
    const metadata = this.parseNexusMetadata(record.metadata);
    if (!metadata.isPremium) {
      throw new BadRequestException('Nexus Mods Premium is required for direct automatic downloads. Request the mod or install it manually.');
    }
    return this.crypto.decrypt({ ciphertext: record.ciphertext, iv: record.iv, tag: record.tag });
  }

  private async nexusApiKeyOrNull(): Promise<string | null> {
    const record = await this.prisma.appSecret.findUnique({ where: { key: this.nexusSecretKey } });
    return record ? this.crypto.decrypt({ ciphertext: record.ciphertext, iv: record.iv, tag: record.tag }) : null;
  }

  private async nexusRest(path: string, apiKey: string, premiumHint = false): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    const response = await fetch(`https://api.nexusmods.com/v1${path}`, {
      headers: {
        Accept: 'application/json',
        'Application-Name': 'Palwarden',
        'Application-Version': '0.1.0',
        apikey: apiKey,
      },
    }).catch(() => null);
    if (!response) {
      throw new BadRequestException('Palwarden could not reach Nexus Mods.');
    }
    if (response.status === 401) {
      throw new BadRequestException('Nexus Mods rejected the saved API key.');
    }
    if (response.status === 403) {
      throw new BadRequestException(premiumHint ? 'Nexus Mods Premium is required for this action.' : 'Nexus Mods rejected this request.');
    }
    if (response.status === 429) {
      throw new BadRequestException('Nexus Mods API rate limit reached. Try again later.');
    }
    if (!response.ok) {
      throw new BadRequestException(`Nexus Mods request failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
  }

  private async nexusGraphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch('https://api.nexusmods.com/v2/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Application-Name': 'Palwarden',
        'Application-Version': '0.1.0',
      },
      body: JSON.stringify({ query, variables }),
    }).catch(() => null);
    if (!response) {
      throw new BadRequestException('Palwarden could not reach Nexus Mods.');
    }
    if (response.status === 429) {
      throw new BadRequestException('Nexus Mods API rate limit reached. Try again later.');
    }
    if (!response.ok) {
      throw new BadRequestException(`Nexus Mods request failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      throw new BadRequestException(payload.errors[0]?.message ?? 'Nexus Mods returned an error.');
    }
    return payload.data ?? {};
  }

  private nexusModsQuery(): string {
    return `
      query PalwardenMods($filter: ModsFilter, $sort: [ModsSort!], $count: Int) {
        mods(filter: $filter, sort: $sort, count: $count) {
          nodes {
            modId
            name
            author
            summary
            category
            downloads
            endorsements
            pictureUrl
            directDownloadEnabled
          }
        }
      }
    `;
  }

  private async fetchNexusMods(list: 'trending' | 'latest_added' | 'latest_updated', query?: string, count = 60): Promise<NexusModSummary[]> {
    const filter: Record<string, unknown> = { gameDomainName: [{ value: 'palworld', op: 'EQUALS' }] };
    if (query) {
      filter.name = [{ value: query, op: 'WILDCARD' }];
    }
    const raw = await this.nexusGraphql(this.nexusModsQuery(), {
      filter,
      sort: [this.nexusSort(list)],
      count,
    });
    const nodes = this.asRecord(raw.mods).nodes;
    const mods = Array.isArray(nodes) ? nodes.map((item) => this.toNexusModSummary(this.asRecord(item))) : [];
    return query ? this.filterNexusSearchResults(mods, query) : mods;
  }

  private filterNexusSearchResults(mods: NexusModSummary[], query: string): NexusModSummary[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return mods;
    const unique = new Map<number, NexusModSummary>();
    for (const mod of mods) {
      const searchable = [mod.name, mod.author, mod.summary, mod.categoryName, String(mod.modId)].join(' ').toLowerCase();
      if (searchable.includes(needle)) {
        unique.set(mod.modId, mod);
      }
    }
    return [...unique.values()].sort((a, b) => b.endorsements - a.endorsements || b.downloads - a.downloads || a.name.localeCompare(b.name));
  }

  private rankNexusSearchResults(mods: NexusModSummary[], query: string): NexusModSummary[] {
    const needle = query.trim().toLowerCase();
    const unique = new Map<number, NexusModSummary>();
    for (const mod of mods) {
      unique.set(mod.modId, mod);
    }
    return [...unique.values()]
      .filter((mod) => this.nexusSearchScore(mod, needle) > 0)
      .sort((a, b) => this.nexusSearchScore(b, needle) - this.nexusSearchScore(a, needle) || b.endorsements - a.endorsements || b.downloads - a.downloads || a.name.localeCompare(b.name));
  }

  private nexusSearchScore(mod: NexusModSummary, query: string): number {
    if (!query) return 1;
    const name = mod.name.toLowerCase();
    const author = mod.author.toLowerCase();
    const category = mod.categoryName.toLowerCase();
    const summary = mod.summary.toLowerCase();
    let score = 0;
    if (String(mod.modId) === query) score += 100;
    if (name === query) score += 80;
    if (name.startsWith(query)) score += 50;
    if (name.includes(query)) score += 35;
    if (author.includes(query)) score += 18;
    if (category.includes(query)) score += 12;
    if (summary.includes(query)) score += 8;
    return score;
  }

  private nexusSort(list: 'trending' | 'latest_added' | 'latest_updated'): Record<string, unknown> {
    if (list === 'latest_added') return { createdAt: { direction: 'DESC' } };
    if (list === 'latest_updated') return { updatedAt: { direction: 'DESC' } };
    return { downloads: { direction: 'DESC' } };
  }

  private toNexusModSummary(item: Record<string, unknown>): NexusModSummary {
    const modId = this.numberField(item, 'modId') ?? 0;
    return {
      id: String(modId),
      modId,
      name: this.stringField(item, 'name') || 'Untitled Mod',
      author: this.stringField(item, 'author') || 'Unknown',
      summary: this.stringField(item, 'summary') || '',
      categoryName: this.stringField(item, 'category') || 'Uncategorized',
      downloads: this.numberField(item, 'downloads') ?? 0,
      endorsements: this.numberField(item, 'endorsements') ?? 0,
      pictureUrl: this.normalizeExternalImageUrl(this.stringField(item, 'pictureUrl')),
      directDownloadEnabled: this.booleanField(item, 'directDownloadEnabled'),
      nexusUrl: `https://www.nexusmods.com/palworld/mods/${modId}`,
    };
  }

  private installableNexusFiles(payload: Record<string, unknown> | Record<string, unknown>[]): NexusModFile[] {
    const rawFiles = Array.isArray(payload) ? payload : this.asRecord(payload).files;
    const files = Array.isArray(rawFiles) ? rawFiles.map((item) => this.asRecord(item)) : [];
    const current = files.filter((file) => !this.booleanField(file, 'is_old_version'));
    const candidates = current.length ? current : files;
    return candidates
      .map((file) => this.toNexusModFile(file))
      .sort((a, b) => Number(!a.isMain) - Number(!b.isMain) || b.fileId - a.fileId);
  }

  private selectNexusFile(payload: Record<string, unknown> | Record<string, unknown>[], fileId: number | undefined): NexusModFile {
    const files = this.installableNexusFiles(payload);
    const selected = fileId ? files.find((file) => file.fileId === fileId) : files[0];
    if (!selected) {
      throw new NotFoundException('Nexus returned no installable files for that mod.');
    }
    return selected;
  }

  private toNexusModFile(file: Record<string, unknown>): NexusModFile {
    const category = this.stringField(file, 'category_name') || 'Other';
    const categoryId = this.numberField(file, 'category_id');
    const isMain = categoryId === 1 || category.toLowerCase().includes('main');
    return {
      fileId: this.numberField(file, 'file_id') ?? this.numberField(file, 'fileId') ?? 0,
      name: this.stringField(file, 'name') || this.stringField(file, 'file_name') || 'File',
      version: this.stringField(file, 'version') || '',
      category: isMain ? 'Main' : category,
      isMain,
      sizeKb: this.numberField(file, 'size_kb'),
      description:
        this.stringField(file, 'description') ||
        this.stringField(file, 'file_description') ||
        this.stringField(file, 'short_description') ||
        this.stringField(file, 'changelog') ||
        '',
    };
  }

  private downloadLinkUrl(payload: Record<string, unknown> | Record<string, unknown>[]): string {
    const links = Array.isArray(payload) ? payload : [];
    for (const link of links) {
      const value = this.stringField(link, 'URI') || this.stringField(link, 'uri');
      if (value) return value;
    }
    throw new BadRequestException('Nexus did not return a usable download link.');
  }

  private async downloadNexusArchive(nexusModId: number, fileId: number, fileName: string, url: string): Promise<string> {
    const safeName = this.safeDownloadName(fileName || `nexus-${nexusModId}-${fileId}.zip`);
    const archiveName = safeName.toLowerCase().endsWith('.zip') ? safeName : `${safeName}.zip`;
    const destination = join(this.dataDirectory(), 'nexus-downloads', `${nexusModId}-${fileId}-${archiveName}`);
    await mkdir(this.dirname(destination), { recursive: true });
    const response = await fetch(url).catch(() => null);
    if (!response || !response.ok || !response.body) {
      throw new BadRequestException('Nexus file download failed.');
    }
    await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destination));
    return destination;
  }

  private async previewNexusArchive(
    archivePath: string,
    instance: ServerInstance,
    fallbackName: string,
    nexusModId: number,
    file: NexusModFile,
  ): Promise<NexusInstallPreview> {
    const tempRoot = await mkdtemp(join(tmpdir(), 'palwarden-mod-preview-'));
    try {
      await this.expandArchive(archivePath, tempRoot);
      const plan = await this.planNexusArchive(tempRoot, instance, fallbackName);
      return {
        nexusModId,
        fileId: file.fileId,
        fileName: file.name,
        modName: fallbackName,
        detectedTargetKind: plan.detectedTargetKind,
        targetKind: plan.targetKind,
        folderName: plan.folderName,
        relativePath: plan.relativePath,
        archiveFileCount: plan.archiveFileCount,
        pakFileCount: plan.pakFileCount,
        warnings: plan.warnings,
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private async extractNexusArchive(
    archivePath: string,
    instance: ServerInstance,
    fallbackName: string,
    override: NexusInstallOverride = {},
  ): Promise<NexusArchiveInstallResult> {
    const tempRoot = await mkdtemp(join(tmpdir(), 'palwarden-mod-'));
    try {
      await this.expandArchive(archivePath, tempRoot);
      const plan = await this.planNexusArchive(tempRoot, instance, fallbackName, override);
      if (plan.targetKind === 'pak') {
        return await this.installPakArchive(instance, plan.folderName, plan.pakFiles, false);
      }
      if (plan.targetKind === 'logic') {
        return await this.installPakArchive(instance, plan.folderName, plan.pakFiles, true);
      }
      const modsPath = join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64', 'Mods');
      const destination = join(modsPath, plan.folderName);
      await mkdir(modsPath, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await cp(plan.sourceFolder, destination, { recursive: true });
      await writeFile(join(destination, 'enabled.txt'), '1', 'utf-8');
      return {
        kind: 'ue4ss',
        folderName: plan.folderName,
        relativePath: plan.relativePath,
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private async planNexusArchive(
    tempRoot: string,
    instance: ServerInstance,
    fallbackName: string,
    override: NexusInstallOverride = {},
  ): Promise<NexusArchivePlan> {
    const files = await this.listFiles(tempRoot);
    const pakFiles = files.filter((file) => this.isPakSidecarFile(file));
    const logicPakFiles = pakFiles.filter((file) => this.normalizedPath(file).includes('/logicmods/'));
    const detectedTargetKind: NexusInstallTargetKind = logicPakFiles.length ? 'logic' : pakFiles.length ? 'pak' : 'ue4ss';
    const targetKind = override.targetKind ?? detectedTargetKind;
    if (!['pak', 'logic', 'ue4ss'].includes(targetKind)) {
      throw new BadRequestException('Unsupported mod install target.');
    }

    const source = await this.effectiveArchiveRoot(tempRoot);
    const detectedFolderName = pakFiles.length ? this.pakFolderName(pakFiles, fallbackName) : await this.installFolderName(source, fallbackName);
    const folderName = this.safeFolderName(override.folderName || detectedFolderName || fallbackName);
    if (!folderName) {
      throw new BadRequestException('Mod folder name is required.');
    }

    const selectedPakFiles = targetKind === 'logic' && logicPakFiles.length ? logicPakFiles : pakFiles;
    if ((targetKind === 'pak' || targetKind === 'logic') && !selectedPakFiles.length) {
      throw new BadRequestException('The selected archive does not contain Pak files for that install target.');
    }

    const sourceFolder = targetKind === 'ue4ss' ? await this.installSourceFolder(source, detectedFolderName) : source;
    const relativePath =
      targetKind === 'pak'
        ? join('Pal', 'Content', 'Paks', '~mods')
        : targetKind === 'logic'
          ? join('Pal', 'Content', 'Paks', 'LogicMods', folderName)
          : join('Pal', 'Binaries', 'Win64', 'Mods', folderName);
    const warnings: string[] = [];
    if (targetKind !== detectedTargetKind) {
      warnings.push(`Palwarden detected ${this.modTargetLabel(detectedTargetKind)}, but will install as ${this.modTargetLabel(targetKind)}.`);
    }
    if (targetKind === 'pak' && logicPakFiles.length) {
      warnings.push('This archive includes LogicMods paths. Installing as Pak will place Pak files in ~mods instead.');
    }
    if (targetKind === 'ue4ss' && pakFiles.length) {
      warnings.push('This archive contains Pak files. Installing as UE4SS will copy the folder into Win64/Mods.');
    }
    return {
      targetKind,
      detectedTargetKind,
      folderName,
      relativePath,
      files,
      pakFiles: selectedPakFiles,
      archiveFileCount: files.length,
      pakFileCount: pakFiles.length,
      sourceFolder,
      warnings,
    };
  }

  private pakFolderName(files: string[], fallbackName: string): string {
    const stems = [...new Set(files.map((file) => this.safeFolderName(parsePath(file).name)).filter(Boolean))];
    return stems.length === 1 && stems[0] ? stems[0] : this.safeFolderName(fallbackName);
  }

  private modTargetLabel(kind: NexusInstallTargetKind): string {
    if (kind === 'pak') return 'Pak ~mods';
    if (kind === 'logic') return 'LogicMods';
    return 'UE4SS Mods';
  }

  private async installPakArchive(instance: ServerInstance, folderName: string, files: string[], logic: boolean): Promise<NexusArchiveInstallResult> {
    if (logic) {
      const logicRoot = join(instance.installationDirectory, 'Pal', 'Content', 'Paks', 'LogicMods');
      const destination = join(logicRoot, folderName);
      await rm(destination, { recursive: true, force: true });
      await mkdir(destination, { recursive: true });
      for (const file of files) {
        await cp(file, join(destination, basename(file)));
      }
      return {
        kind: 'logic',
        folderName,
        relativePath: join('Pal', 'Content', 'Paks', 'LogicMods', folderName),
      };
    }
    const modsRoot = join(instance.installationDirectory, 'Pal', 'Content', 'Paks', '~mods');
    await mkdir(modsRoot, { recursive: true });
    for (const file of files) {
      await cp(file, join(modsRoot, basename(file)));
    }
    return {
      kind: 'pak',
      folderName,
      relativePath: join('Pal', 'Content', 'Paks', '~mods'),
    };
  }

  private isPakSidecarFile(file: string): boolean {
    return ['.pak', '.utoc', '.ucas'].includes(extname(file).toLowerCase());
  }

  private normalizedPath(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
  }

  private async expandArchive(archivePath: string, destination: string): Promise<void> {
    if (!archivePath || !destination) {
      throw new BadRequestException('Could not extract the archive because the archive path or destination was empty.');
    }
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ArchivePath = [Environment]::GetEnvironmentVariable('PALWARDEN_ARCHIVE_PATH', 'Process'); $Destination = [Environment]::GetEnvironmentVariable('PALWARDEN_ARCHIVE_DESTINATION', 'Process'); Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Destination -Force",
        ],
        {
          env: {
            ...process.env,
            PALWARDEN_ARCHIVE_PATH: archivePath,
            PALWARDEN_ARCHIVE_DESTINATION: destination,
          },
          windowsHide: true,
        },
      );
      let error = '';
      child.stderr.on('data', (chunk: Buffer) => {
        error += chunk.toString();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new BadRequestException(error.trim() || 'Could not extract the Nexus archive.'));
        }
      });
    });
  }

  private async effectiveArchiveRoot(root: string): Promise<string> {
    const segments = ['Pal', 'Binaries', 'Win64'];
    let current = root;
    for (const segment of segments) {
      const child = join(current, segment);
      if (!(await this.directoryExists(child))) return root;
      current = child;
    }
    const ue4ss = join(current, 'ue4ss', 'Mods');
    if (await this.directoryExists(ue4ss)) return ue4ss;
    const mods = join(current, 'Mods');
    return (await this.directoryExists(mods)) ? mods : root;
  }

  private async installFolderName(source: string, fallbackName: string): Promise<string> {
    const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
    const directories = entries.filter((entry) => entry.isDirectory());
    const onlyDirectory = directories[0];
    if (entries.length === 1 && onlyDirectory) {
      return this.safeFolderName(onlyDirectory.name);
    }
    return this.safeFolderName(fallbackName);
  }

  private async installSourceFolder(source: string, folderName: string): Promise<string> {
    const candidate = join(source, folderName);
    return (await this.directoryExists(candidate)) ? candidate : source;
  }

  private win64Directory(instance: ServerInstance): string {
    return join(instance.installationDirectory, 'Pal', 'Binaries', 'Win64');
  }

  private async isUe4ssInstalled(instance: ServerInstance): Promise<boolean> {
    const win64 = this.win64Directory(instance);
    const [proxyDll, ue4ssDll] = await Promise.all([this.fileExists(join(win64, 'dwmapi.dll')), this.fileExists(join(win64, 'UE4SS.dll'))]);
    return proxyDll && ue4ssDll;
  }

  private async latestUe4ssRelease(): Promise<{ version: string; assetName: string; downloadUrl: string; size: number }> {
    const response = await fetch('https://api.github.com/repos/UE4SS-RE/RE-UE4SS/releases/latest', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Palwarden/0.1.0',
      },
    }).catch(() => null);
    if (!response) {
      throw new BadRequestException('Palwarden could not reach GitHub to check UE4SS releases.');
    }
    if (!response.ok) {
      throw new BadRequestException(`GitHub returned HTTP ${response.status} while checking UE4SS releases.`);
    }
    const data = (await response.json()) as { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string; size?: number }> };
    const asset = (data.assets ?? []).find((item) => /^UE4SS_v.*\.zip$/i.test(item.name ?? '') && item.browser_download_url);
    if (!asset?.name || !asset.browser_download_url) {
      throw new BadRequestException("Could not find a UE4SS release asset matching 'UE4SS_v*.zip'.");
    }
    return {
      version: data.tag_name ?? 'unknown',
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      size: typeof asset.size === 'number' ? asset.size : 0,
    };
  }

  private async downloadUe4ssRelease(release: { assetName: string; downloadUrl: string }): Promise<string> {
    const destination = join(this.dataDirectory(), 'ue4ss-downloads', this.safeDownloadName(release.assetName));
    if (await this.fileExists(destination)) {
      return destination;
    }
    await mkdir(this.dirname(destination), { recursive: true });
    const response = await fetch(release.downloadUrl).catch(() => null);
    if (!response || !response.ok || !response.body) {
      throw new BadRequestException('UE4SS download failed.');
    }
    await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(destination));
    return destination;
  }

  private async extractAndMergeUe4ss(archivePath: string, win64: string): Promise<string[]> {
    const tempRoot = await mkdtemp(join(tmpdir(), 'palwarden-ue4ss-'));
    try {
      await this.expandArchive(archivePath, tempRoot);
      const entries = await readdir(tempRoot, { withFileTypes: true });
      const managed = new Set<string>();
      for (const entry of entries) {
        const source = join(tempRoot, entry.name);
        if (entry.name === 'Mods' && entry.isDirectory()) {
          const modsDestination = join(win64, 'Mods');
          await mkdir(modsDestination, { recursive: true });
          const modEntries = await readdir(source, { withFileTypes: true });
          for (const modEntry of modEntries) {
            const modSource = join(source, modEntry.name);
            const modDestination = join(modsDestination, modEntry.name);
            await rm(modDestination, { recursive: true, force: true });
            if (modEntry.isDirectory()) {
              await cp(modSource, modDestination, { recursive: true });
            } else {
              await cp(modSource, modDestination);
            }
            managed.add(`Mods/${modEntry.name}`);
          }
          continue;
        }
        const destination = join(win64, entry.name);
        await rm(destination, { recursive: true, force: true });
        if (entry.isDirectory()) {
          await cp(source, destination, { recursive: true });
        } else {
          await cp(source, destination);
        }
        managed.add(entry.name);
      }
      return [...managed].sort();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private parseManagedPaths(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private async removeManagedUe4ssPath(win64: string, managedPath: string): Promise<void> {
    const normalized = managedPath.replace(/\//g, '\\');
    if (!normalized || normalized.includes('..') || isAbsolute(normalized)) {
      return;
    }
    const target = resolve(win64, normalized);
    const root = resolve(win64);
    if (target !== root && !target.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) {
      return;
    }
    await rm(target, { recursive: true, force: true });
  }

  private safeDownloadName(name: string): string {
    return name.replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'mod.zip';
  }

  private safeFolderName(name: string): string {
    return name.replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'Mod';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private stringField(value: unknown, key: string): string | null {
    const field = this.asRecord(value)[key];
    return typeof field === 'string' ? field : null;
  }

  private normalizeExternalImageUrl(value: string | null): string | null {
    if (!value?.trim()) return null;
    const trimmed = value.trim();
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
    if (trimmed.startsWith('https://')) return trimmed;
    return null;
  }

  private numberField(value: unknown, key: string): number | null {
    const field = this.asRecord(value)[key];
    return typeof field === 'number' ? field : null;
  }

  private booleanField(value: unknown, key: string): boolean {
    return this.asRecord(value)[key] === true;
  }

  private optionalBooleanField(value: unknown, key: string): boolean | null {
    const field = this.asRecord(value)[key];
    return typeof field === 'boolean' ? field : null;
  }

  private toModRequestView(request: ModRequest & { requestedBy?: { username: string } | null }): ServerModRequest {
    return {
      id: request.id,
      serverInstanceId: request.serverInstanceId,
      nexusModId: request.nexusModId,
      name: request.name,
      author: request.author,
      summary: request.summary,
      pictureUrl: this.normalizeExternalImageUrl(request.pictureUrl),
      nexusUrl: `https://www.nexusmods.com/palworld/mods/${request.nexusModId}`,
      requestedBy: request.requestedByUserId,
      requestedByUsername: request.requestedBy?.username ?? null,
      status: request.status as ServerModRequest['status'],
      createdAt: request.createdAt.toISOString(),
      decidedAt: request.decidedAt?.toISOString() ?? null,
    };
  }

  private async validateNexusApiKey(apiKey: string): Promise<{ username: string | null; userId: number | null; isPremium: boolean }> {
    const response = await fetch('https://api.nexusmods.com/v1/users/validate.json', {
      headers: {
        Accept: 'application/json',
        'Application-Name': 'Palwarden',
        'Application-Version': '0.1.0',
        apikey: apiKey,
      },
    }).catch(() => null);
    if (!response) {
      throw new BadRequestException('Palwarden could not reach Nexus Mods to validate the key.');
    }
    if (response.status === 401) {
      throw new BadRequestException('Nexus Mods rejected that API key.');
    }
    if (response.status === 429) {
      throw new BadRequestException('Nexus Mods rate limit reached. Try again later.');
    }
    if (!response.ok) {
      throw new BadRequestException(`Nexus Mods validation failed with HTTP ${response.status}.`);
    }
    const data = (await response.json()) as { name?: string; user_id?: number; is_premium?: boolean; is_supporter?: boolean };
    return {
      username: data.name ?? null,
      userId: typeof data.user_id === 'number' ? data.user_id : null,
      isPremium: Boolean(data.is_premium || data.is_supporter),
    };
  }

  private parseNexusMetadata(value: string | null): { username: string | null; userId: number | null; isPremium: boolean } {
    if (!value) {
      return { username: null, userId: null, isPremium: false };
    }
    try {
      const parsed = JSON.parse(value) as { username?: unknown; userId?: unknown; isPremium?: unknown };
      return {
        username: typeof parsed.username === 'string' ? parsed.username : null,
        userId: typeof parsed.userId === 'number' ? parsed.userId : null,
        isPremium: parsed.isPremium === true,
      };
    } catch {
      return { username: null, userId: null, isPremium: false };
    }
  }

  private toCreateData(
    dto: UpsertServerInstanceDto,
    encrypted: { ciphertext: string; iv: string; tag: string } | null,
  ): Prisma.ServerInstanceCreateInput {
    return {
      ...this.commonData(dto),
      encryptedAdminPassword: encrypted?.ciphertext ?? null,
      encryptedAdminPasswordIv: encrypted?.iv ?? null,
      encryptedAdminPasswordTag: encrypted?.tag ?? null,
    };
  }

  private toUpdateData(
    dto: UpsertServerInstanceDto,
    encrypted: { ciphertext: string; iv: string; tag: string } | undefined,
  ): Prisma.ServerInstanceUpdateInput {
    const data: Prisma.ServerInstanceUpdateInput = this.commonData(dto);
    if (encrypted) {
      data.encryptedAdminPassword = encrypted.ciphertext;
      data.encryptedAdminPasswordIv = encrypted.iv;
      data.encryptedAdminPasswordTag = encrypted.tag;
    }
    return data;
  }

  private commonData(dto: UpsertServerInstanceDto) {
    return {
      displayName: dto.displayName.trim(),
      description: dto.description?.trim() || null,
      installationDirectory: dto.installationDirectory,
      executablePath: dto.executablePath,
      workingDirectory: dto.workingDirectory,
      configurationFilePath: dto.configurationFilePath,
      saveDirectory: dto.saveDirectory,
      backupDirectory: dto.backupDirectory,
      restApiHost: dto.restApiHost,
      restApiPort: dto.restApiPort,
      gamePort: dto.gamePort,
      queryPort: dto.queryPort,
      launchArgumentsJson: JSON.stringify(dto.launchArguments),
      autoStart: dto.autoStart,
      autoRestart: dto.autoRestart,
      backupBeforeRestart: dto.backupBeforeRestart,
      backupBeforeUpdate: dto.backupBeforeUpdate,
      backupBeforeConfigChange: dto.backupBeforeConfigChange,
      forceStopAfterGracefulTimeout: dto.forceStopAfterGracefulTimeout,
    };
  }

  private toView(instance: ServerInstance): ServerInstanceView {
    return {
      id: instance.id,
      displayName: instance.displayName,
      description: instance.description,
      installationDirectory: instance.installationDirectory,
      executablePath: instance.executablePath,
      workingDirectory: instance.workingDirectory,
      configurationFilePath: instance.configurationFilePath,
      saveDirectory: instance.saveDirectory,
      backupDirectory: instance.backupDirectory,
      restApiHost: instance.restApiHost,
      restApiPort: instance.restApiPort,
      gamePort: instance.gamePort,
      queryPort: instance.queryPort,
      launchArguments: JSON.parse(instance.launchArgumentsJson) as string[],
      autoStart: instance.autoStart,
      autoRestart: instance.autoRestart,
      backupBeforeRestart: instance.backupBeforeRestart,
      backupBeforeUpdate: instance.backupBeforeUpdate,
      backupBeforeConfigChange: instance.backupBeforeConfigChange,
      forceStopAfterGracefulTimeout: instance.forceStopAfterGracefulTimeout,
      adminPasswordConfigured: Boolean(instance.encryptedAdminPassword),
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
  }

  private async validate(dto: UpsertServerInstanceDto, existingId?: string): Promise<void> {
    this.validateDistinctPorts(dto.restApiPort, dto.gamePort, dto.queryPort);
    await Promise.all([
      this.requireFile(dto.executablePath, 'Executable path'),
      this.requireDirectory(dto.installationDirectory, 'Installation directory'),
      this.requireDirectory(dto.workingDirectory, 'Working directory'),
      this.requireFile(dto.configurationFilePath, 'Configuration file'),
      this.requireDirectory(dto.saveDirectory, 'Save directory'),
      this.ensureWritableDirectory(dto.backupDirectory, 'Backup directory'),
    ]);
    await this.validateNoConflicts(dto, existingId);
  }

  private async runDeploy(job: DeployJobView, dto: DeployServerInstanceDto, actorId: string, installDirectory: string): Promise<void> {
    try {
      const adminPassword = dto.adminPassword?.trim() || nanoid(24);
      const append = (line: string) => this.appendDeployLog(job.id, line);
      append(`Install directory: ${installDirectory}`);
      append('Checking ports and install folder...');
      console.log(`[deploy-job] ${job.id} checking ${installDirectory}`);
      this.validateDistinctPorts(dto.restApiPort, dto.gamePort, dto.queryPort);
      await this.validateNoConflicts({
        installationDirectory: installDirectory,
        restApiPort: dto.restApiPort,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
      });
      await this.requireDeployTargetAvailable(installDirectory);
      append('Installing Palworld Dedicated Server with SteamCMD...');
      console.log(`[deploy-job] ${job.id} starting SteamCMD install`);
      await this.steamcmd.installPalworldServer(installDirectory, append);

      append('Writing Palworld configuration...');
      const configPath = await this.settingsFile.writeInitialSettings(installDirectory, {
        serverName: dto.displayName.trim(),
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
        restApiPort: dto.restApiPort,
        adminPassword,
        ...(dto.serverPassword !== undefined ? { serverPassword: dto.serverPassword } : {}),
        maxPlayers: dto.maxPlayers,
      });
      const saveDirectory = this.settingsFile.saveDirectory(installDirectory);
      const backupDirectory = join(this.dataDirectory(), 'backups', this.sanitizeServerFolderName(dto.displayName));
      await mkdir(backupDirectory, { recursive: true });

      append('Registering server profile...');
      const encrypted = this.crypto.encrypt(adminPassword);
      const profile: UpsertServerInstanceDto = {
        displayName: dto.displayName,
        installationDirectory: installDirectory,
        executablePath: join(installDirectory, 'PalServer.exe'),
        workingDirectory: installDirectory,
        configurationFilePath: configPath,
        saveDirectory,
        backupDirectory,
        restApiHost: dto.restApiHost,
        restApiPort: dto.restApiPort,
        adminPassword,
        gamePort: dto.gamePort,
        queryPort: dto.queryPort,
        launchArguments: dto.launchArguments,
        autoStart: dto.autoStart,
        autoRestart: dto.autoRestart,
        backupBeforeRestart: dto.backupBeforeRestart,
        backupBeforeUpdate: dto.backupBeforeUpdate,
        backupBeforeConfigChange: dto.backupBeforeConfigChange,
        forceStopAfterGracefulTimeout: dto.forceStopAfterGracefulTimeout,
      };
      if (dto.description !== undefined) {
        profile.description = dto.description;
      }
      const instance = await this.prisma.serverInstance.create({
        data: this.toCreateData(
          profile,
          encrypted,
        ),
      });
      await this.audit.record({ actorId, action: 'SERVER_CREATED', targetId: instance.id, message: 'Server deployed and registered.' });
      await this.audit.record({ actorId, action: 'CREDENTIAL_REPLACED', targetId: instance.id, message: 'Server credential saved.' });
      job.serverInstanceId = instance.id;

      if (dto.startAfterInstall) {
        append('Starting Palworld server...');
        await this.processManager.start(instance, actorId);
      }

      append('Done.');
      console.log(`[deploy-job] ${job.id} done`);
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Deployment failed.';
      console.log(`[deploy-job] ${job.id} error: ${job.error}`);
      this.appendDeployLog(job.id, job.error);
    }
  }

  private async runUpdate(job: DeployJobView, id: string, options: UpdateServerOptions, actorId: string): Promise<void> {
    const append = (line: string) => this.appendDeployLog(job.id, line);
    try {
      const { instance, adminPassword } = await this.rawWithPassword(id);
      const runtime = await this.processManager.getRecoveredStatus(instance);
      append(`Server state: ${runtime.state}.`);

      if (runtime.state === 'running' || runtime.state === 'starting') {
        const seconds = this.cleanShutdownWaitSeconds(options.shutdownWaitSeconds);
        const message =
          options.broadcastMessage?.trim() ||
          `Palwarden is updating this server. Shutdown begins in ${seconds} seconds.`;
        append(`Broadcasting update notice and scheduling shutdown in ${seconds} seconds...`);
        await this.processManager.shutdownCountdown(instance, adminPassword, seconds, message, actorId);
        append('Waiting for Palworld to stop...');
        await this.waitForStopped(instance, seconds + 90);
      } else if (runtime.state === 'stopping') {
        append('Server is already stopping; waiting before update...');
        await this.waitForStopped(instance, 120);
      }

      append('Starting SteamCMD update...');
      await this.steamcmd.updatePalworldServer(instance.installationDirectory, append);
      await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server updated with SteamCMD.' });
      append('Update complete.');
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Update failed.';
      append(job.error);
    }
  }

  private async runValidate(job: DeployJobView, id: string, actorId: string): Promise<void> {
    const append = (line: string) => this.appendDeployLog(job.id, line);
    try {
      const instance = await this.getRaw(id);
      const runtime = await this.processManager.getRecoveredStatus(instance);
      append(`Server state: ${runtime.state}.`);
      if (runtime.state === 'running' || runtime.state === 'starting' || runtime.state === 'stopping') {
        throw new BadRequestException('Stop the server before validating files with SteamCMD.');
      }
      append('Starting SteamCMD validate...');
      await this.steamcmd.updatePalworldServer(instance.installationDirectory, append, true);
      await this.audit.record({ actorId, action: 'SERVER_UPDATED', targetId: id, message: 'Server files validated with SteamCMD.' });
      append('Validation complete.');
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Validation failed.';
      append(job.error);
    }
  }

  private async waitForStopped(instance: ServerInstance, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const status = await this.processManager.getRecoveredStatus(instance);
      if (status.state === 'stopped' || status.state === 'failed' || status.state === 'unknown') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new BadRequestException('Server did not stop before the update timeout. Stop it manually, then run update again.');
  }

  private cleanShutdownWaitSeconds(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
      return 60;
    }
    return Math.min(Math.max(Math.round(value), 10), 3600);
  }

  private appendDeployLog(jobId: string, line: string): void {
    const job = this.deployJobs.get(jobId);
    if (!job) {
      return;
    }
    if (/type\s+'quit'\s+to\s+exit/i.test(line)) {
      return;
    }
    job.log.push(line);
    if (job.log.length > 300) {
      job.log = job.log.slice(-300);
    }
  }

  private validateDistinctPorts(restApiPort: number, gamePort: number, queryPort: number): void {
    const ports = [restApiPort, gamePort, queryPort];
    if (new Set(ports).size !== ports.length) {
      throw new BadRequestException('REST API, game, and query ports must be distinct.');
    }
  }

  private async validateNoConflicts(
    dto: Pick<UpsertServerInstanceDto, 'installationDirectory' | 'restApiPort' | 'gamePort' | 'queryPort'>,
    existingId?: string,
  ): Promise<void> {
    const where: Prisma.ServerInstanceWhereInput = {
      OR: [
        { installationDirectory: dto.installationDirectory },
        { restApiPort: dto.restApiPort },
        { gamePort: dto.gamePort },
        { queryPort: dto.queryPort },
      ],
    };
    if (existingId) {
      where.id = { not: existingId };
    }
    const conflicts = await this.prisma.serverInstance.findMany({ where });
    if (conflicts.length) {
      throw new BadRequestException('Another server profile already uses one of these paths or ports.');
    }
  }

  private async requireDeployTargetAvailable(path: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info) {
      return;
    }
    if (!info.isDirectory()) {
      throw new BadRequestException('Install directory must be a directory.');
    }
    const entries = await readdir(path);
    if (entries.length > 0 && !this.looksLikePalworldInstall(entries)) {
      throw new BadRequestException('Install directory must be empty for a new deployment.');
    }
  }

  private looksLikePalworldInstall(entries: string[]): boolean {
    const names = new Set(entries.map((entry) => entry.toLowerCase()));
    return names.has('palserver.exe') || names.has('steamapps') || names.has('pal') || names.has('defaultpalworldsettings.ini');
  }

  private defaultInstallPath(name: string): string {
    return join(this.dataDirectory(), 'servers', this.sanitizeServerFolderName(name));
  }

  private dataDirectory(): string {
    const configured = process.env.PALWARDEN_DATA_DIR?.trim();
    const fallback = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Local'), 'Palwarden', 'data');
    return this.resolveInstallPath(configured || fallback);
  }

  private resolveInstallPath(path: string): string {
    return isAbsolute(path) ? path : resolve(path);
  }

  private pathKey(path: string): string {
    return resolve(path).replace(/\//g, '\\').toLowerCase();
  }

  private sanitizeServerFolderName(name: string): string {
    return name.replace(/[^A-Za-z0-9_. -]/g, '').trim().replace(/^[. ]+|[. ]+$/g, '') || 'Server';
  }

  private async requireFile(path: string, label: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw new BadRequestException(`${label} must exist.`);
    }
  }

  private async requireDirectory(path: string, label: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info?.isDirectory()) {
      throw new BadRequestException(`${label} must exist.`);
    }
  }

  private async requireWritableDirectory(path: string, label: string): Promise<void> {
    await this.requireDirectory(path, label);
    await access(path, constants.W_OK).catch(() => {
      throw new BadRequestException(`${label} must be writable.`);
    });
  }

  private async ensureWritableDirectory(path: string, label: string): Promise<void> {
    await mkdir(path, { recursive: true }).catch(() => {
      throw new BadRequestException(`${label} could not be created.`);
    });
    await this.requireWritableDirectory(path, label);
  }

  private async fileExists(path: string): Promise<boolean> {
    return Boolean((await stat(path).catch(() => null))?.isFile());
  }

  private async directoryExists(path: string): Promise<boolean> {
    return Boolean((await stat(path).catch(() => null))?.isDirectory());
  }

  private numberSetting(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return null;
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private stringSetting(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }
}
