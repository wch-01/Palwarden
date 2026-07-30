import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '@palwarden/shared';
import { nanoid } from 'nanoid';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { SetupTokenService } from './setup-token.service';

const SESSION_COOKIE = 'palwarden.sid';
const CSRF_COOKIE = 'palwarden.csrf';
const SESSION_DAYS = 7;
const LOCKOUT_MINUTES = 10;
const MAX_FAILURES = 5;
const DEV_USERNAME = 'Dev';
const DEV_PASSWORD = 'wardenDev';

export interface RequestUser {
  id: string;
  username: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  private devAutoLoginLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly setupToken: SetupTokenService,
  ) {}

  async setupRequired(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  async createOwner(username: string, password: string, req: Request, setupToken?: string): Promise<RequestUser> {
    if (!(await this.setupRequired())) {
      throw new ForbiddenException('Setup has already been completed.');
    }
    if (!this.isLocalhost(req) && !this.setupToken.verify(setupToken)) {
      throw new ForbiddenException('Setup requires localhost or the one-time setup token.');
    }
    const user = await this.prisma.user.create({
      data: {
        username: username.trim(),
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: 'OWNER',
      },
    });
    await this.audit.record({ actorId: user.id, action: 'USER_CREATED', targetId: user.id, message: 'Initial owner created.' });
    return { id: user.id, username: user.username, role: user.role };
  }

  async login(username: string, password: string, req: Request, res: Response): Promise<RequestUser> {
    const normalized = username.trim();
    const ipAddress = req.ip ?? 'unknown';
    await this.assertNotLocked(normalized, ipAddress);
    const user = await this.prisma.user.findUnique({ where: { username: normalized } });
    const valid = user ? await argon2.verify(user.passwordHash, password) : false;
    await this.prisma.loginAttempt.create({ data: { username: normalized, ipAddress, success: valid } });
    if (!user || !valid || user.disabled) {
      await this.audit.record({ action: 'LOGIN_FAILURE', message: 'Login failed.', metadata: { username: normalized } });
      throw new UnauthorizedException('Wrong username or password.');
    }
    const sessionId = nanoid(48);
    const csrfToken = nanoid(32);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        csrfToken,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    this.setCookies(res, sessionId, csrfToken);
    await this.audit.record({ actorId: user.id, action: 'LOGIN_SUCCESS', message: 'Login succeeded.' });
    return { id: user.id, username: user.username, role: user.role };
  }

  async restore(req: Request): Promise<{ user: RequestUser | null; csrfToken: string }> {
    const sessionId = this.readSessionId(req);
    if (!sessionId) {
      return { user: null, csrfToken: '' };
    }
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.user.disabled) {
      return { user: null, csrfToken: '' };
    }
    return {
      user: { id: session.user.id, username: session.user.username, role: session.user.role },
      csrfToken: session.csrfToken,
    };
  }

  async restoreOrCreateDevSession(req: Request, res: Response): Promise<{ user: RequestUser | null; csrfToken: string }> {
    const restored = await this.restore(req);
    if (restored.user || !this.devAutoLoginEnabled(req)) {
      return restored;
    }
    const user = await this.ensureDevOwner();
    const sessionId = nanoid(48);
    const csrfToken = nanoid(32);
    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        csrfToken,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    this.setCookies(res, sessionId, csrfToken);
    return { user, csrfToken };
  }

  async logout(req: Request, res: Response): Promise<void> {
    const sessionId = this.readSessionId(req);
    if (sessionId) {
      const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
      await this.prisma.session.deleteMany({ where: { id: sessionId } });
      await this.audit.record({
        ...(session?.userId ? { actorId: session.userId } : {}),
        action: 'LOGOUT',
        message: 'User logged out.',
      });
    }
    res.clearCookie(SESSION_COOKIE);
    res.clearCookie(CSRF_COOKIE);
  }

  async attachSession(req: Request & { user?: RequestUser; session?: { csrfToken: string } }): Promise<void> {
    const restored = await this.restore(req);
    if (restored.user) {
      req.user = restored.user;
      req.session = { csrfToken: restored.csrfToken };
    }
  }

  private async assertNotLocked(username: string, ipAddress: string): Promise<void> {
    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const failures = await this.prisma.loginAttempt.count({
      where: { username, ipAddress, success: false, createdAt: { gte: since } },
    });
    if (failures >= MAX_FAILURES) {
      throw new ForbiddenException('Too many failed login attempts. Try again later.');
    }
  }

  private readSessionId(req: Request): string | undefined {
    return (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
  }

  private setCookies(res: Response, sessionId: string, csrfToken: string): void {
    const secure = process.env.PALWARDEN_COOKIE_SECURE === 'true';
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  private isLocalhost(req: Request): boolean {
    const ip = req.ip ?? '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  private devAutoLoginEnabled(req: Request): boolean {
    const enabled = process.env.NODE_ENV === 'development' && process.env.PALWARDEN_DEV_AUTO_LOGIN === 'true' && this.isLocalhost(req);
    if (enabled && !this.devAutoLoginLogged) {
      this.devAutoLoginLogged = true;
      console.warn('Palwarden dev auto-login is enabled for localhost development only. User: Dev');
    }
    return enabled;
  }

  private async ensureDevOwner(): Promise<RequestUser> {
    const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
    const user = await this.prisma.user.upsert({
      where: { username: DEV_USERNAME },
      create: {
        username: DEV_USERNAME,
        passwordHash,
        role: 'OWNER',
        disabled: false,
      },
      update: {
        passwordHash,
        role: 'OWNER',
        disabled: false,
      },
    });
    return { id: user.id, username: user.username, role: user.role };
  }
}
