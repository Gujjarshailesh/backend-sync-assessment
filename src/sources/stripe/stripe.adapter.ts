import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CanonicalEnvelope,
  CanonicalTransaction,
} from '../../common/interfaces/canonical-entities.interface';
import {
  CursorKind,
  EntityType,
  FetchResult,
  PersistOutcome,
  SourceAdapter,
} from '../../common/interfaces/source-adapter.interface';
import { StripeClient, STRIPE_SOURCE } from './stripe.client';
import { mapStripePaymentIntent } from './stripe.mapper';

@Injectable()
export class StripeAdapter implements SourceAdapter<CanonicalTransaction> {
  readonly sourceName = STRIPE_SOURCE;
  readonly entityType: EntityType = 'transaction';
  readonly cursorKind: CursorKind = 'timestamp';

  constructor(
    private readonly client: StripeClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetchFull(): Promise<FetchResult<CanonicalTransaction>> {
    const envelopes: CanonicalEnvelope<CanonicalTransaction>[] = [];
    let startingAfter: string | undefined;
    let maxCreated = 0;

    for (;;) {
      const page = await this.client.listAllPaymentIntents(startingAfter);
      for (const pi of page.data) {
        envelopes.push(mapStripePaymentIntent(pi));
        maxCreated = Math.max(maxCreated, pi.created);
      }
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1]?.id;
    }

    const nextCursor = String(maxCreated || Math.floor(Date.now() / 1000));
    return { envelopes, nextCursor };
  }

  async fetchIncremental(
    cursor: string,
  ): Promise<FetchResult<CanonicalTransaction>> {
    const sinceUnixSeconds = Number(cursor);
    const page =
      await this.client.listPaymentIntentEventsSince(sinceUnixSeconds);

    // Multiple events can reference the same PaymentIntent within one
    // window (e.g. created -> processing -> succeeded); keep only the
    // most recent event per object so we don't write stale data last.
    const latestByObjectId = new Map<string, Stripe.Event>();
    for (const event of page.data) {
      const object = event.data.object as Stripe.PaymentIntent;
      const existing = latestByObjectId.get(object.id);
      if (!existing || event.created > existing.created) {
        latestByObjectId.set(object.id, event);
      }
    }

    const envelopes: CanonicalEnvelope<CanonicalTransaction>[] = [];
    let maxCreated = sinceUnixSeconds;
    for (const event of latestByObjectId.values()) {
      const object = event.data.object as Stripe.PaymentIntent;
      envelopes.push(mapStripePaymentIntent(object, event.created));
      maxCreated = Math.max(maxCreated, event.created);
    }

    return { envelopes, nextCursor: String(maxCreated) };
  }

  async persist(
    envelope: CanonicalEnvelope<CanonicalTransaction>,
  ): Promise<PersistOutcome> {
    const where = {
      source_externalId: {
        source: envelope.source,
        externalId: envelope.externalId,
      },
    };
    const existing = await this.prisma.transaction.findUnique({
      where,
      select: { id: true },
    });

    const fields = {
      customerRef: envelope.data.customerRef,
      amount: envelope.data.amount,
      currency: envelope.data.currency,
      rawStatus: envelope.data.rawStatus,
      occurredAt: envelope.data.occurredAt,
      sourceUpdatedAt: envelope.sourceUpdatedAt,
      rawPayload: envelope.raw as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

    await this.prisma.transaction.upsert({
      where,
      create: {
        source: envelope.source,
        externalId: envelope.externalId,
        ...fields,
      },
      update: fields,
    });

    return {
      action: existing ? 'updated' : 'created',
      externalId: envelope.externalId,
    };
  }
}
