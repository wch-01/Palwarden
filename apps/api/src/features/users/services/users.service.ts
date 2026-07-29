import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from '@palwarden/shared';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../core/database/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user-management.dto';

export interface ManagedUserView {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(): Promise<ManagedUserView[]> {
    const users = await this.prisma.user.findMany({ orderBy: { username: 'asc' } });
    return users.map((user) => this.toView(user));
  }

  async create(dto: CreateUserDto, actorId: string): Promise<ManagedUserView> {
    const username = dto.username.trim();
    if (!username) {
      throw new BadRequestException('Username is required.');
    }
    const user = await this.prisma.user.create({
      data: {
        username,
        role: dto.role,
        passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
      },
    });
    await this.audit.record({
      actorId,
      action: 'USER_CREATED',
      targetId: user.id,
      message: 'User account created.',
      metadata: { username: user.username, role: user.role },
    });
    return this.toView(user);
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<ManagedUserView> {
    const existing = await this.getRaw(id);
    if (dto.role && dto.role !== existing.role) {
      await this.assertOwnerCanChange(existing.id, existing.role, dto.role);
    }
    if (dto.disabled !== undefined && dto.disabled !== existing.disabled) {
      await this.assertOwnerCanDisable(existing.id, existing.role, dto.disabled);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.disabled !== undefined ? { disabled: dto.disabled } : {}),
        ...(dto.password ? { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) } : {}),
      },
    });
    if (dto.disabled) {
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    await this.audit.record({
      actorId,
      action: 'USER_UPDATED',
      targetId: id,
      message: 'User account updated.',
      metadata: {
        username: user.username,
        roleChanged: dto.role !== undefined,
        disabledChanged: dto.disabled !== undefined,
        passwordChanged: Boolean(dto.password),
      },
    });
    return this.toView(user);
  }

  async remove(id: string, actorId: string): Promise<{ ok: true }> {
    const existing = await this.getRaw(id);
    await this.assertOwnerCanDisable(existing.id, existing.role, true);
    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'USER_DELETED',
      targetId: id,
      message: 'User account deleted.',
      metadata: { username: existing.username, role: existing.role },
    });
    return { ok: true };
  }

  private async getRaw(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User account not found.');
    }
    return user;
  }

  private async assertOwnerCanChange(userId: string, currentRole: UserRole, nextRole: UserRole): Promise<void> {
    if (currentRole !== 'OWNER' || nextRole === 'OWNER') {
      return;
    }
    const enabledOwners = await this.enabledOwnerCount();
    if (enabledOwners <= 1) {
      throw new ForbiddenException('At least one active owner account is required.');
    }
  }

  private async assertOwnerCanDisable(userId: string, role: UserRole, disabled: boolean): Promise<void> {
    if (!disabled || role !== 'OWNER') {
      return;
    }
    const enabledOwners = await this.enabledOwnerCount();
    const user = await this.getRaw(userId);
    if (!user.disabled && enabledOwners <= 1) {
      throw new ForbiddenException('At least one active owner account is required.');
    }
  }

  private enabledOwnerCount(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'OWNER', disabled: false } });
  }

  private toView(user: { id: string; username: string; role: UserRole; disabled: boolean; createdAt: Date; updatedAt: Date }): ManagedUserView {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      disabled: user.disabled,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
