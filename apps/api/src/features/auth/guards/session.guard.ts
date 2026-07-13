import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../services/auth.service';
import type { RequestUser } from '../services/auth.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: RequestUser; session?: { csrfToken: string } }>();
    await this.auth.attachSession(req);
    if (!req.user) {
      throw new UnauthorizedException('Authentication required.');
    }
    return true;
  }
}
