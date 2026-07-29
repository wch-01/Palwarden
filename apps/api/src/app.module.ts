import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'node:path';
import { loadAppConfig } from './core/config/app-config';
import { DatabaseModule } from './core/database/database.module';
import { CsrfGuard } from './core/security/csrf.guard';
import { AuthModule } from './features/auth/auth.module';
import { ServerInstancesModule } from './features/server-instances/server-instances.module';
import { SettingsModule } from './features/settings/settings.module';
import { UsersModule } from './features/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '../../.env'), join(process.cwd(), '.env')],
      load: [() => loadAppConfig()],
    }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    ServerInstancesModule,
    SettingsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
