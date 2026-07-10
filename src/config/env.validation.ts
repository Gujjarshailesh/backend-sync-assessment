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
