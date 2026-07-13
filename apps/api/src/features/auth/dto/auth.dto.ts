import { IsString, MinLength } from 'class-validator';

export class SetupOwnerDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  setupToken?: string;
}

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}
