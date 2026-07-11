import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfigService } from '../../config/app-config.service';
import {
  SourceUnavailableError,
  StaleCursorError,
} from '../../common/errors/domain-errors';
import { withRetry } from '../../common/utils/retry.util';

export const STRIPE_SOURCE = 'stripe';

const PAYMENT_INTENT_EVENT_TYPES: Stripe.Event.Type[] = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.processing',
  'payment_intent.created',
];

@Injectable()
export class StripeClient {
  private client: Stripe | undefined;

  constructor(private readonly config: AppConfigService) {}

  private getClient(): Stripe {
    const secretKey = this.config.stripeSecretKey;
    if (!secretKey) {
      throw new SourceUnavailableError(
        STRIPE_SOURCE,
        'STRIPE_SECRET_KEY not configured',
      );
    }
    if (!this.client) {
      this.client = new Stripe(secretKey);
    }
    return this.client;
  }

  /** Full fetch: every PaymentIntent, paginated by object id. */
  async listAllPaymentIntents(
    startingAfter?: string,
  ): Promise<Stripe.ApiList<Stripe.PaymentIntent>> {
    const client = this.getClient();
    try {
      return await withRetry(
        () =>
          client.paymentIntents.list({
            limit: 100,
            starting_after: startingAfter,
          }),
        { isRetryable: isTransient },
      );
    } catch (error) {
      throw new SourceUnavailableError(STRIPE_SOURCE, error);
    }
  }

  /**
   * Incremental fetch: PaymentIntent-related events created after
   * `sinceUnixSeconds`. If the cursor is corrupted (NaN, negative, garbage)
   * Stripe rejects the filter with an invalid_request error, which we treat
   * as our stale-cursor signal and fall back to a full fetch.
   */
  async listPaymentIntentEventsSince(
    sinceUnixSeconds: number,
  ): Promise<Stripe.ApiList<Stripe.Event>> {
    const client = this.getClient();
    try {
      return await withRetry(
        () =>
          client.events.list({
            created: { gt: sinceUnixSeconds },
            types: PAYMENT_INTENT_EVENT_TYPES,
            limit: 100,
          }),
        { isRetryable: isTransient },
      );
    } catch (error) {
      if (isInvalidRequest(error)) {
        throw new StaleCursorError(STRIPE_SOURCE, error);
      }
      throw new SourceUnavailableError(STRIPE_SOURCE, error);
    }
  }

  /**
   * Verifies the webhook signature against the exact raw request bytes and
   * returns the parsed event, or throws if the signature doesn't match -
   * this is what stops anyone but Stripe from posting fake events to us.
   */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const client = this.getClient();
    const webhookSecret = this.config.stripeWebhookSecret;
    if (!webhookSecret) {
      throw new SourceUnavailableError(
        STRIPE_SOURCE,
        'STRIPE_WEBHOOK_SECRET not configured',
      );
    }
    return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}

function isInvalidRequest(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeInvalidRequestError;
}

function isTransient(error: unknown): boolean {
  if (error instanceof Stripe.errors.StripeAPIError) return true;
  if (error instanceof Stripe.errors.StripeConnectionError) return true;
  if (error instanceof Stripe.errors.StripeRateLimitError) return true;
  return false;
}
