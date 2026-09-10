import { z } from 'zod';
import { existsSync } from 'node:fs';

// Railway supplies real environment variables; local development reads the untracked .env file.
if (existsSync('.env')) process.loadEnvFile('.env');

const blankToUndefined = (value: unknown) => typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());

const schema = z.object({
  TELEGRAM_BOT_TOKEN: optionalString,
  OWNER_TELEGRAM_USER_ID: z.preprocess(blankToUndefined, z.coerce.string().regex(/^\d+$/).optional()),
  IQAIR_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  OFFICIAL_ISPU_API_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  OFFICIAL_ISPU_AGENCY: optionalString,
  DATABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(3000)),
  NATIONAL_SAMPLE_CITY_LIMIT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(12).default(12)),
  TRACKED_IQAIR_CITY_LIMIT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(10).default(5)),
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
