import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { corsOrigins } from './core/config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(helmet());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.url.includes('/server-instances/deploy')) {
      console.log(`[deploy-request] ${req.method} ${req.url}`);
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: corsOrigins({
      NODE_ENV: config.get('NODE_ENV') ?? 'development',
      DATABASE_URL: config.get('DATABASE_URL') ?? '',
      PALWARDEN_HOST: config.get('PALWARDEN_HOST') ?? '127.0.0.1',
      PALWARDEN_PORT: Number(config.get('PALWARDEN_PORT') ?? 3333),
      PALWARDEN_COOKIE_SECURE: config.get('PALWARDEN_COOKIE_SECURE') === 'true',
      PALWARDEN_CORS_ORIGINS: config.get('PALWARDEN_CORS_ORIGINS') ?? 'http://localhost:4200',
      PALWARDEN_MASTER_KEY: config.get('PALWARDEN_MASTER_KEY'),
      PALWARDEN_DATA_DIR: config.get('PALWARDEN_DATA_DIR'),
    }),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Palwarden API')
    .setDescription('Self-hosted Palworld Dedicated Server Controller API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  serveProductionWebApp(app);

  const host = config.get<string>('PALWARDEN_HOST') ?? '127.0.0.1';
  await app.listen(Number(config.get('PALWARDEN_PORT') ?? 3333), host);
}

function serveProductionWebApp(app: NestExpressApplication): void {
  if (process.env.NODE_ENV !== 'production') return;
  const webRoot = process.env.PALWARDEN_WEB_DIST || firstExistingPath([join(process.cwd(), 'web'), join(process.cwd(), 'apps', 'web', 'dist', 'browser')]);
  if (!webRoot || !existsSync(join(webRoot, 'index.html'))) return;

  app.useStaticAssets(webRoot);
  app.getHttpAdapter()
    .getInstance()
    .get(/^\/(?!api(?:\/|$)).*/, (_req: Request, res: Response) => {
      res.sendFile(join(webRoot, 'index.html'));
    });
}

function firstExistingPath(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

void bootstrap();
