import Stripe from 'stripe';
import { MappingError } from '../../common/errors/domain-errors';
import { mapStripePaymentIntent } from './stripe.mapper';

function basePaymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: 'pi_1',
    amount: 4200,
    currency: 'usd',
    status: 'succeeded',
    customer: 'cus_1',
    created: 1_700_000_000,
    ...overrides,
  } as Stripe.PaymentIntent;
}

describe('mapStripePaymentIntent', () => {
  it('maps a PaymentIntent into the canonical shape, preserving rawStatus verbatim', () => {
    const envelope = mapStripePaymentIntent(basePaymentIntent());

    expect(envelope.source).toBe('stripe');
    expect(envelope.externalId).toBe('pi_1');
    expect(envelope.data).toEqual({
      customerRef: 'cus_1',
      amount: 4200,
      currency: 'usd',
      rawStatus: 'succeeded',
      occurredAt: new Date(1_700_000_000 * 1000),
    });
  });

  it('throws MappingError when the PaymentIntent has no id', () => {
    expect(() => mapStripePaymentIntent(basePaymentIntent({ id: '' }))).toThrow(
      MappingError,
    );
  });

  it('uses the observed event timestamp for sourceUpdatedAt when provided (incremental/webhook path)', () => {
    const eventCreatedAt = 1_700_000_500;
    const envelope = mapStripePaymentIntent(
      basePaymentIntent(),
      eventCreatedAt,
    );
    expect(envelope.sourceUpdatedAt).toEqual(new Date(eventCreatedAt * 1000));
    // occurredAt still reflects the PaymentIntent's own creation time, not the event's.
    expect(envelope.data.occurredAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('resolves customerRef to null when customer is an expanded object, not a string', () => {
    const envelope = mapStripePaymentIntent(
      basePaymentIntent({ customer: { id: 'cus_1' } as unknown as string }),
    );
    expect(envelope.data.customerRef).toBeNull();
  });
});
