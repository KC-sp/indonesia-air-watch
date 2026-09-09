import { z } from 'zod';
import { existsSync } from 'node:fs';

// Railway supplies real environment variables; local development reads the untracked .env file.
if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  OWNER_TELEGRAM_USER_ID: z.coerce.string().regex(/^\d+$/).optional(),
  IQAIR_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  NATIONAL_SAMPLE_CITY_LIMIT: z.coerce.number().int().min(1).max(12).default(12),
  TRACKED_IQAIR_CITY_LIMIT: z.coerce.number().int().min(1).max(3).default(3),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env = process.env): Config => schema.parse(env);

export function requireRuntimeConfig(config: Config): asserts config is Config & {
  TELEGRAM_BOT_TOKEN: string; OWNER_TELEGRAM_USER_ID: string; DATABASE_URL: string;
} {
  for (const key of ['TELEGRAM_BOT_TOKEN', 'OWNER_TELEGRAM_USER_ID', 'DATABASE_URL'] as const) {
    if (!config[key]) throw new Error(`${key} is required to start the service`);
  }
}
