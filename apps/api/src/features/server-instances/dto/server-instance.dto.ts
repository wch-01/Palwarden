import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertServerInstanceDto {
  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  installationDirectory!: string;

  @IsString()
  executablePath!: string;

  @IsString()
  workingDirectory!: string;

  @IsString()
  configurationFilePath!: string;

  @IsString()
  saveDirectory!: string;

  @IsString()
  backupDirectory!: string;

  @IsString()
  restApiHost = '127.0.0.1';

  @IsInt()
  @Min(1)
  @Max(65535)
  restApiPort!: number;

  @IsOptional()
  @IsString()
  adminPassword?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  gamePort!: number;

  @IsInt()
  @Min(1)
  @Max(65535)
  queryPort!: number;

  @IsArray()
  @IsString({ each: true })
  launchArguments: string[] = [];

  @IsBoolean()
  autoStart = false;

  @IsBoolean()
  autoRestart = false;

  @IsBoolean()
  backupBeforeRestart = false;

  @IsBoolean()
  backupBeforeUpdate = false;

  @IsBoolean()
  backupBeforeConfigChange = false;

  @IsBoolean()
  scheduledBackupsEnabled = false;

  @IsInt()
  @Min(1)
  @Max(10080)
  scheduledBackupIntervalMinutes = 360;

  @IsInt()
  @Min(1)
  @Max(200)
  scheduledBackupRetentionCount = 10;

  @IsBoolean()
  forceStopAfterGracefulTimeout = false;
}

export class DeployServerInstanceDto {
  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  installationDirectory?: string;

  @IsString()
  restApiHost = '127.0.0.1';

  @IsInt()
  @Min(1)
  @Max(65535)
  restApiPort!: number;

  @IsOptional()
  @IsString()
  adminPassword?: string;

  @IsOptional()
  @IsString()
  serverPassword?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  gamePort!: number;

  @IsInt()
  @Min(1)
  @Max(65535)
  queryPort!: number;

  @IsInt()
  @Min(1)
  @Max(256)
  maxPlayers = 32;

  @IsArray()
  @IsString({ each: true })
  launchArguments: string[] = [];

  @IsBoolean()
  autoStart = false;

  @IsBoolean()
  autoRestart = false;

  @IsBoolean()
  backupBeforeRestart = false;

  @IsBoolean()
  backupBeforeUpdate = false;

  @IsBoolean()
  backupBeforeConfigChange = false;

  @IsBoolean()
  scheduledBackupsEnabled = false;

  @IsInt()
  @Min(1)
  @Max(10080)
  scheduledBackupIntervalMinutes = 360;

  @IsInt()
  @Min(1)
  @Max(200)
  scheduledBackupRetentionCount = 10;

  @IsBoolean()
  forceStopAfterGracefulTimeout = false;

  @IsBoolean()
  startAfterInstall = true;
}
