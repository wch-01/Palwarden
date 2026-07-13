import { Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { SetupTokenService } from './services/setup-token.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SetupTokenService, AuditLogService],
  exports: [AuthService, SetupTokenService],
})
export class AuthModule {}
