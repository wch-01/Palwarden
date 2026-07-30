import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('file:./palwarden.db'),
  PALWARDEN_HOST: z.string().default('127.0.0.1'),
  PALWARDEN_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  PALWARDEN_COOKIE_SECURE: z.coerce.boolean().default(false),
  PALWARDEN_CORS_ORIGINS: z.string().default('http://localhost:4200'),
  PALWARDEN_MASTER_KEY: z.string().optional(),
  PALWARDEN_DATA_DIR: z.string().optional(),
  PALWARDEN_DEV_AUTO_LOGIN: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadAppConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);
  if (parsed.NODE_ENV !== 'test' && !parsed.PALWARDEN_MASTER_KEY) {
    console.warn('PALWARDEN_MASTER_KEY is not set. Server credentials cannot be saved.');
  }
  return parsed;
}

export function corsOrigins(config: AppConfig): string[] {
  return config.PALWARDEN_CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
