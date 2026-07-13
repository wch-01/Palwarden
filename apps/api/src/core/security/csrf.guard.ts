import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_COOKIE = 'palwarden.sid';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [context.getHandler(), context.getClass()]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const sessionId = (request.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
    const actual = request.header('x-csrf-token');
    if (!sessionId || !actual) {
      return false;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { csrfToken: true, expiresAt: true },
    });

    return Boolean(session && session.expiresAt >= new Date() && session.csrfToken === actual);
  }
}
