import { Module } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, AuditLogService],
})
export class UsersModule {}
