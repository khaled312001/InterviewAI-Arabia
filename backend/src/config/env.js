import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  CLAUDE_ENABLED: z.coerce.boolean().default(false),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FREE_DAILY_QUESTION_LIMIT: z.coerce.number().int().positive().default(5),
  ADMIN_EMAIL: z.string().email().default('admin@barmagly.tech'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMeImmediately!'),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().default('tech.barmagly.interviewai'),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  GOOGLE_PLAY_ENABLED: z.coerce.boolean().default(false),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};
