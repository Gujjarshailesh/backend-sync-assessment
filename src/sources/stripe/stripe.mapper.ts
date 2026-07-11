import Stripe from 'stripe';
import {
  CanonicalEnvelope,
  CanonicalTransaction,
} from '../../common/interfaces/canonical-entities.interface';
import { MappingError } from '../../common/errors/domain-errors';
import { STRIPE_SOURCE } from './stripe.client';

/**
 * PaymentIntent has no generic "last modified" timestamp the way HubSpot/
 * Calendar records do - `created` is the closest stable signal. When mapping
 * from an Event (incremental path), the event's own `created` is a more
 * accurate "this changed at" timestamp than the underlying object's.
 */
export function mapStripePaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  observedAtUnixSeconds?: number,
): CanonicalEnvelope<CanonicalTransaction> {
  if (!paymentIntent.id) {
    throw new MappingError(STRIPE_SOURCE, 'PaymentIntent is missing an id');
  }

  const updatedAtSeconds = observedAtUnixSeconds ?? paymentIntent.created;

  return {
    source: STRIPE_SOURCE,
    externalId: paymentIntent.id,
    sourceUpdatedAt: new Date(updatedAtSeconds * 1000),
    raw: paymentIntent,
    data: {
      customerRef:
        typeof paymentIntent.customer === 'string'
          ? paymentIntent.customer
          : null,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      rawStatus: paymentIntent.status,
      occurredAt: new Date(paymentIntent.created * 1000),
    },
  };
}
