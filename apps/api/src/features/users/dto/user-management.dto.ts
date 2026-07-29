import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { UserRole } from '@palwarden/shared';

const ROLES: UserRole[] = ['OWNER', 'ADMIN', 'VIEWER'];

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsIn(ROLES)
  role!: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(12)
  password?: string;
}
