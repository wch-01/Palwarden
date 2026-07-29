import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateHostNetworkSettingsDto {
  @IsIn(['localhost', 'lan'])
  webAccessMode!: 'localhost' | 'lan';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  acknowledgeExposure?: boolean;
}
