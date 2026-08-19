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
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { corsOrigins } from './core/config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  serveProductionWebApp(app);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", 'data:', 'blob:', 'https:'],
        },
      },
    }),
  );
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
      PALWARDEN_DEV_AUTO_LOGIN: config.get('PALWARDEN_DEV_AUTO_LOGIN') === 'true',
      PALWARDEN_START_SERVERS_ON_LAUNCH: config.get('PALWARDEN_START_SERVERS_ON_LAUNCH') === 'true',
      PALWARDEN_DESKTOP_EXE: config.get('PALWARDEN_DESKTOP_EXE'),
    }),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Palwarden API')
    .setDescription('Self-hosted Palworld Dedicated Server Controller API')
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const host = config.get<string>('PALWARDEN_HOST') ?? '127.0.0.1';
  await app.listen(Number(config.get('PALWARDEN_PORT') ?? 3333), host);
}

function serveProductionWebApp(app: NestExpressApplication): void {
  const webRoot = process.env.PALWARDEN_WEB_DIST || (process.env.NODE_ENV === 'production' ? firstExistingPath([join(process.cwd(), 'web'), join(process.cwd(), 'apps', 'web', 'dist', 'browser')]) : null);
  const indexPath = webRoot ? join(webRoot, 'index.html') : null;
  if (!webRoot || !indexPath || !existsSync(indexPath)) {
    if (process.env.PALWARDEN_DESKTOP === 'true' || process.env.NODE_ENV === 'production') {
      console.warn(`Palwarden web app was not found. PALWARDEN_WEB_DIST=${process.env.PALWARDEN_WEB_DIST ?? '(not set)'}`);
    }
    return;
  }

  const normalizedWebRoot = resolve(webRoot);
  app.getHttpAdapter()
    .getInstance()
    .use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }

      const requestPath = safeRequestPath(req.path);
      const staticPath = resolve(normalizedWebRoot, `.${requestPath}`);
      if (staticPath.startsWith(normalizedWebRoot) && requestPath !== '/' && existsSync(staticPath)) {
        res.sendFile(staticPath);
        return;
      }

      res.sendFile(indexPath);
    });
}

function safeRequestPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return '/';
  }
}

function firstExistingPath(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

void bootstrap();
