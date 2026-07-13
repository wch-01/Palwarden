import { Body, Controller, Delete, ForbiddenException, Get, Header, Param, Post, Put, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { interval, map, Observable } from 'rxjs';
import type { Request } from 'express';
import { SessionGuard } from '../../auth/guards/session.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import type { RequestUser } from '../../auth/services/auth.service';
import { ServerInstancesService } from '../services/server-instances.service';
import { DeployServerInstanceDto, UpsertServerInstanceDto } from '../dto/server-instance.dto';
import { ProcessManagerService } from '../../process-manager/services/process-manager.service';

@UseGuards(SessionGuard, RolesGuard)
@Controller('server-instances')
export class ServerInstancesController {
  constructor(
    private readonly instances: ServerInstancesService,
    private readonly processManager: ProcessManagerService,
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

  @Get(':id/roster')
  roster(@Param('id') id: string) {
    return this.instances.roster(id);
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
    return this.instances.updateConfiguration(id, body.values ?? {}, req.user.id);
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
    await this.processManager.gracefulStop(instance, adminPassword, req.user.id);
    return this.processManager.start(instance, req.user.id);
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
  backup(@Param('id') id: string) {
    return { ok: false, serverInstanceId: id, message: 'Backup save is planned for the next implementation pass.' };
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
  logs(@Param('id') id: string) {
    return { lines: this.processManager.logs(id) };
  }

  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      map(
        () =>
          ({
            data: {
              status: this.processManager.getStatus(id),
              lines: this.processManager.logs(id),
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
