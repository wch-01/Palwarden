import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Post, Put, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { interval, map, Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { SessionGuard } from '../../auth/guards/session.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import type { RequestUser } from '../../auth/services/auth.service';
import { ServerInstancesService } from '../services/server-instances.service';
import { DeployServerInstanceDto, UpsertServerInstanceDto } from '../dto/server-instance.dto';
import { ProcessManagerService } from '../../process-manager/services/process-manager.service';
import { BackupsService } from '../../backups/backups.service';

@UseGuards(SessionGuard, RolesGuard)
@Controller('server-instances')
export class ServerInstancesController {
  constructor(
    private readonly instances: ServerInstancesService,
    private readonly processManager: ProcessManagerService,
    private readonly backups: BackupsService,
  ) {}

  @Get()
  list() {
    return this.instances.list();
  }

  @Get('dashboard')
  dashboard() {
    return this.instances.dashboard();
  }

  @Get('default-install-directory')
  defaultInstallDirectory(@Query('name') name = 'Server') {
    return this.instances.defaultInstallDirectory(name);
  }

  @Get('import-preview')
  importPreview(@Query('installationDirectory') installationDirectory = '', @Query('displayName') displayName = 'Imported Server') {
    return this.instances.importPreview(installationDirectory, displayName);
  }

  @Get('nexus')
  nexusState() {
    return this.instances.nexusState();
  }

  @Get('nexus/mods')
  nexusMods(@Query('list') list: 'trending' | 'latest_added' | 'latest_updated' = 'trending', @Query('q') query = '') {
    return this.instances.nexusMods(['trending', 'latest_added', 'latest_updated'].includes(list) ? list : 'trending', query);
  }

  @Get('nexus/search')
  nexusSearch(@Query('q') query = '') {
    return this.instances.searchNexusMods(query);
  }

  @Roles('OWNER')
  @Put('nexus')
  saveNexusApiKey(@Body() body: { apiKey?: string }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.saveNexusApiKey(body.apiKey ?? '', req.user.id);
  }

  @Roles('OWNER')
  @Delete('nexus')
  removeNexusApiKey(@Req() req: Request & { user: RequestUser }) {
    return this.instances.removeNexusApiKey(req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Get('deploy/start')
  deployStart(@Query() query: Record<string, string | undefined>, @Req() req: Request & { user: RequestUser; session?: { csrfToken: string } }) {
    if (!query.csrfToken || query.csrfToken !== req.session?.csrfToken) {
      throw new ForbiddenException('Invalid CSRF token.');
    }
    return this.instances.deploy(this.deployDtoFromRequest(undefined, query), req.user.id, query.jobId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('deploy')
  deploy(
    @Body() body: Partial<DeployServerInstanceDto> | undefined,
    @Query() query: Record<string, string | undefined>,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.instances.deploy(this.deployDtoFromRequest(body, query), req.user.id);
  }

  @Get('deploy/:jobId')
  deployStatus(@Param('jobId') jobId: string) {
    return this.instances.getDeployJob(jobId);
  }

  @Get('maintenance/:jobId')
  maintenanceStatus(@Param('jobId') jobId: string) {
    return this.instances.getDeployJob(jobId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post()
  create(@Body() body: UpsertServerInstanceDto, @Req() req: Request & { user: RequestUser }) {
    return this.instances.create(body, req.user.id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.instances.get(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: UpsertServerInstanceDto, @Req() req: Request & { user: RequestUser }) {
    return this.instances.update(id, body, req.user.id);
  }

  @Roles('OWNER')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.remove(id, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/open-folder')
  openFolder(@Param('id') id: string) {
    return this.instances.openInstallationDirectory(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.instances.testConnection(id);
  }

  @Get(':id/update-availability')
  updateAvailability(@Param('id') id: string) {
    return this.instances.updateAvailability(id);
  }

  @Get(':id/roster')
  roster(@Param('id') id: string) {
    return this.instances.roster(id);
  }

  @Get(':id/mods')
  mods(@Param('id') id: string) {
    return this.instances.mods(id);
  }

  @Get(':id/ue4ss')
  ue4ssStatus(@Param('id') id: string) {
    return this.instances.ue4ssStatus(id);
  }

  @Roles('OWNER')
  @Post(':id/ue4ss/install')
  installUe4ss(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.installUe4ss(id, req.user.id);
  }

  @Roles('OWNER')
  @Post(':id/ue4ss/uninstall')
  uninstallUe4ss(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.uninstallUe4ss(id, req.user.id);
  }

  @Get(':id/mods/requests')
  modRequests(@Param('id') id: string) {
    return this.instances.modRequests(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/mods/requests')
  requestNexusMod(
    @Param('id') id: string,
    @Body() body: { nexusModId?: number; name?: string; author?: string; summary?: string; pictureUrl?: string | null },
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.instances.requestNexusMod(
      id,
      {
        nexusModId: Number(body.nexusModId),
        name: body.name ?? 'Nexus Mod',
        author: body.author ?? 'Unknown',
        summary: body.summary ?? '',
        pictureUrl: body.pictureUrl ?? null,
      },
      req.user.id,
    );
  }

  @Roles('OWNER')
  @Post(':id/mods/requests/:requestId/approve')
  approveModRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.approveModRequest(id, requestId, req.user.id);
  }

  @Roles('OWNER')
  @Post(':id/mods/requests/:requestId/deny')
  denyModRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.denyModRequest(id, requestId, req.user.id);
  }

  @Roles('OWNER')
  @Get(':id/mods/nexus/:nexusModId/files')
  nexusModFiles(@Param('nexusModId') nexusModId: string) {
    return this.instances.nexusModFiles(Number(nexusModId));
  }

  @Roles('OWNER')
  @Post(':id/mods/nexus/:nexusModId/preview')
  previewNexusModInstall(@Param('id') id: string, @Param('nexusModId') nexusModId: string, @Body() body: { fileId?: number }) {
    return this.instances.previewNexusModInstall(id, Number(nexusModId), body.fileId ? Number(body.fileId) : undefined);
  }

  @Roles('OWNER')
  @Post(':id/mods/nexus/:nexusModId/install')
  installNexusMod(
    @Param('id') id: string,
    @Param('nexusModId') nexusModId: string,
    @Body() body: { fileId?: number; targetKind?: 'pak' | 'logic' | 'ue4ss'; folderName?: string },
    @Req() req: Request & { user: RequestUser },
  ) {
    const override: { targetKind?: 'pak' | 'logic' | 'ue4ss'; folderName?: string } = {};
    if (body.targetKind) override.targetKind = body.targetKind;
    if (body.folderName) override.folderName = body.folderName;
    return this.instances.installNexusMod(id, Number(nexusModId), body.fileId ? Number(body.fileId) : undefined, req.user.id, override);
  }

  @Roles('OWNER')
  @Post(':id/mods/:modId/update')
  updateNexusMod(@Param('id') id: string, @Param('modId') modId: string, @Body() body: { fileId?: number }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.updateNexusMod(id, modId, body.fileId ? Number(body.fileId) : undefined, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/mods/:modId/enable')
  enableMod(@Param('id') id: string, @Param('modId') modId: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.enableMod(id, modId, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/mods/:modId/disable')
  disableMod(@Param('id') id: string, @Param('modId') modId: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.disableMod(id, modId, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Delete(':id/mods/:modId')
  removeMod(@Param('id') id: string, @Param('modId') modId: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.removeMod(id, modId, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/mods/reorder')
  reorderMods(@Param('id') id: string, @Body() body: { orderedIds?: string[] }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.reorderMods(id, body.orderedIds ?? [], req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/players/kick')
  kickPlayer(@Param('id') id: string, @Body() body: { userId?: string; message?: string }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.kickPlayer(id, body.userId ?? '', body.message, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/players/ban')
  banPlayer(@Param('id') id: string, @Body() body: { userId?: string; message?: string }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.banPlayer(id, body.userId ?? '', body.message, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/players/unban')
  unbanPlayer(@Param('id') id: string, @Body() body: { userId?: string }, @Req() req: Request & { user: RequestUser }) {
    return this.instances.unbanPlayer(id, body.userId ?? '', req.user.id);
  }

  @Get(':id/configuration')
  @Header('Cache-Control', 'no-store')
  configuration(@Param('id') id: string) {
    return this.instances.configuration(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Put(':id/configuration')
  updateConfiguration(
    @Param('id') id: string,
    @Body() body: { values?: Record<string, string | number | boolean> },
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.updateConfigurationWithPolicy(id, body, req.user.id);
  }

  private async updateConfigurationWithPolicy(
    id: string,
    body: { values?: Record<string, string | number | boolean> },
    actorId: string,
  ) {
    const { instance } = await this.instances.rawWithPassword(id);
    if (instance.backupBeforeConfigChange) {
      await this.backups.createTriggered(id, actorId, 'BEFORE_CONFIGURATION_CHANGE');
    }
    return this.instances.updateConfiguration(id, body.values ?? {}, actorId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/start')
  async start(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    const { instance } = await this.instances.rawWithPassword(id);
    return this.processManager.start(instance, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/restart')
  async restart(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    const { instance, adminPassword } = await this.instances.rawWithPassword(id);
    await this.backups.createTriggered(id, req.user.id, 'BEFORE_RESTART');
    await this.processManager.gracefulStop(instance, adminPassword, req.user.id);
    await this.processManager.waitForStopped(instance, instance.shutdownWaitSeconds + 90);
    return this.processManager.start(instance, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/update')
  updateServer(
    @Param('id') id: string,
    @Body() body: { broadcastMessage?: string; shutdownWaitSeconds?: number },
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.updateServerWithPolicy(id, body ?? {}, req.user.id);
  }

  private async updateServerWithPolicy(
    id: string,
    body: { broadcastMessage?: string; shutdownWaitSeconds?: number },
    actorId: string,
  ) {
    await this.backups.createTriggered(id, actorId, 'BEFORE_UPDATE');
    return this.instances.updateServer(id, body, actorId);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/validate')
  validateServer(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.instances.validateServer(id, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/save')
  async save(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    const { instance, adminPassword } = await this.instances.rawWithPassword(id);
    await this.processManager.saveWorld(instance, adminPassword, req.user.id);
    return { ok: true };
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/announce')
  async announce(@Param('id') id: string, @Body() body: { message?: string }, @Req() req: Request & { user: RequestUser }) {
    const { instance, adminPassword } = await this.instances.rawWithPassword(id);
    await this.processManager.announce(instance, adminPassword, body.message ?? '', req.user.id);
    return { ok: true };
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/shutdown-countdown')
  async shutdownCountdown(@Param('id') id: string, @Body() body: { seconds?: number; message?: string }, @Req() req: Request & { user: RequestUser }) {
    const { instance, adminPassword } = await this.instances.rawWithPassword(id);
    await this.processManager.shutdownCountdown(instance, adminPassword, body.seconds ?? 30, body.message ?? 'Server shutting down.', req.user.id);
    return this.processManager.getStatus(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/backup')
  backup(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.backups.createManual(id, req.user.id);
  }

  @Get(':id/backups')
  listBackups(@Param('id') id: string) {
    return this.backups.list(id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/backups')
  createBackup(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.backups.createManual(id, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/backups/:backupId/restore')
  restoreBackup(@Param('id') id: string, @Param('backupId') backupId: string, @Req() req: Request & { user: RequestUser }) {
    return this.backups.restore(id, backupId, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Delete(':id/backups/failed')
  deleteFailedBackups(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    return this.backups.removeFailed(id, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Delete(':id/backups/:backupId')
  deleteBackup(@Param('id') id: string, @Param('backupId') backupId: string, @Req() req: Request & { user: RequestUser }) {
    return this.backups.remove(id, backupId, req.user.id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post(':id/graceful-stop')
  async gracefulStop(@Param('id') id: string, @Req() req: Request & { user: RequestUser }) {
    const { instance, adminPassword } = await this.instances.rawWithPassword(id);
    await this.processManager.gracefulStop(instance, adminPassword, req.user.id);
    return this.processManager.getStatus(id);
  }

  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.processManager.getStatus(id);
  }

  @Get(':id/logs')
  logs(@Param('id') id: string, @Query('q') q = '', @Query('stream') stream = '', @Query('limit') limit = '500') {
    return this.processManager.logs(id, {
      q,
      stream,
      limit: Number(limit),
    });
  }

  @Get(':id/logs/download')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  downloadLogs(
    @Param('id') id: string,
    @Query('q') q = '',
    @Query('stream') stream = '',
    @Query('limit') limit = '2000',
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = this.processManager.logs(id, { q, stream, limit: Number(limit) });
    response.setHeader('Content-Disposition', `attachment; filename="palwarden-server-${id}-logs.txt"`);
    return result.entries.map((entry) => entry.raw).join('\n');
  }

  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      map(
        () =>
          ({
            data: {
              status: this.processManager.getStatus(id),
              lines: this.processManager.logLines(id),
            },
          }) as MessageEvent,
      ),
    );
  }

  private deployDtoFromRequest(body: Partial<DeployServerInstanceDto> | undefined, query: Record<string, string | undefined>): DeployServerInstanceDto {
    if (body && Object.keys(body).length) {
      return body as DeployServerInstanceDto;
    }
    const dto: DeployServerInstanceDto = {
      displayName: query.displayName ?? '',
      restApiHost: query.restApiHost ?? '127.0.0.1',
      restApiPort: Number(query.restApiPort),
      gamePort: Number(query.gamePort),
      queryPort: Number(query.queryPort),
      maxPlayers: Number(query.maxPlayers ?? 32),
      launchArguments: query.launchArguments ? query.launchArguments.split('\n').filter(Boolean) : [],
      autoStart: query.autoStart === 'true',
      autoRestart: query.autoRestart === 'true',
      backupBeforeRestart: query.backupBeforeRestart === 'true',
      backupBeforeUpdate: query.backupBeforeUpdate === 'true',
      backupBeforeConfigChange: query.backupBeforeConfigChange === 'true',
      forceStopAfterGracefulTimeout: query.forceStopAfterGracefulTimeout === 'true',
      startAfterInstall: query.startAfterInstall !== 'false',
    };
    if (query.description) {
      dto.description = query.description;
    }
    if (query.installationDirectory) {
      dto.installationDirectory = query.installationDirectory;
    }
    if (query.adminPassword) {
      dto.adminPassword = query.adminPassword;
    }
    if (query.serverPassword) {
      dto.serverPassword = query.serverPassword;
    }
    return dto;
  }
}
