import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthState } from '@palwarden/shared';
import { AuthService } from '../services/auth.service';
import { LoginDto, SetupOwnerDto } from '../dto/auth.dto';
import { SessionGuard } from '../guards/session.guard';
import { SkipCsrf } from '../../../core/security/skip-csrf.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('state')
  async state(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthState> {
    const restored = await this.auth.restoreOrCreateDevSession(req, res);
    return {
      setupRequired: await this.auth.setupRequired(),
      user: restored.user,
      csrfToken: restored.csrfToken,
    };
  }

  @SkipCsrf()
  @Post('setup')
  async setup(@Body() body: SetupOwnerDto, @Req() req: Request): Promise<{ user: unknown }> {
    return { user: await this.auth.createOwner(body.username, body.password, req, body.setupToken) };
  }

  @SkipCsrf()
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ user: unknown }> {
    return { user: await this.auth.login(body.username, body.password, req, res) };
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.auth.logout(req, res);
    return { ok: true };
  }
}
