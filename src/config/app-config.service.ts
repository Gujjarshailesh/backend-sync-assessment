import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../common/constants/environment.constant';
import { EnvSchema } from './env.validation';

/**
 * Thin, typed wrapper around Nest's ConfigService. The rest of the app
 * depends on this instead of the raw ConfigService so that:
 *  - every config key is typed (no `configService.get('TYPO_KEY')` at runtime),
 *  - derived flags like `isProduction` live in one place, and
 *  - other services can mock a single small interface in tests instead of
 *    the generic ConfigService.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvSchema, true>) {}

  get nodeEnv(): Environment {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === Environment.Production;
  }

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get hubspotAccessToken(): string | undefined {
    return this.configService.get('HUBSPOT_ACCESS_TOKEN', { infer: true });
  }

  get googleCalendarId(): string | undefined {
    return this.configService.get('GOOGLE_CALENDAR_ID', { infer: true });
  }

  get googleServiceAccountEmail(): string | undefined {
    return this.configService.get('GOOGLE_SERVICE_ACCOUNT_EMAIL', {
      infer: true,
    });
  }

  get googleServiceAccountPrivateKey(): string | undefined {
    const raw = this.configService.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', {
      infer: true,
    });
    // Private keys pasted into a single-line env var need their literal
    // "\n" escapes turned back into real newlines.
    return raw?.replace(/\\n/g, '\n');
  }

  get stripeSecretKey(): string | undefined {
    return this.configService.get('STRIPE_SECRET_KEY', { infer: true });
  }

  get stripeWebhookSecret(): string | undefined {
    return this.configService.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }
}
