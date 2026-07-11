import { z } from 'zod';
import { Environment } from '../common/constants/environment.constant';
import { formatZodError } from '../common/utils/format-zod-error.util';

/**
 * The single source of truth for which environment variables this app
 * requires. Later phases append their own keys here (DATABASE_URL,
 * HUBSPOT_*, GOOGLE_*, STRIPE_* etc.) rather than reading process.env
 * ad hoc elsewhere in the codebase.
 */
export const envSchema = z.object({
  NODE_ENV: z.nativeEnum(Environment).default(Environment.Development),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Provider credentials are optional at the schema level - the app must be
  // able to boot with zero, one, two, or three providers configured so each
  // integration can be verified independently. Each adapter checks its own
  // credential at call time and throws a clear SourceUnavailableError if
  // missing, rather than the whole app refusing to start.
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type EnvSchema = z.infer<typeof envSchema>;

/**
 * Passed to @nestjs/config's ConfigModule.forRoot({ validate }) so the
 * app refuses to boot - with a readable error - if required env vars
 * are missing or malformed, instead of failing deep inside an adapter later.
 */
export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  return result.data;
}
