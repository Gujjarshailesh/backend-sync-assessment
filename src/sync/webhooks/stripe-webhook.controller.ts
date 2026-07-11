import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  StripeClient,
  STRIPE_SOURCE,
} from '../../sources/stripe/stripe.client';
import { StripeAdapter } from '../../sources/stripe/stripe.adapter';
import { mapStripePaymentIntent } from '../../sources/stripe/stripe.mapper';
import { toAuditAction } from '../../common/utils/audit-action.util';

/**
 * Handles push-based Stripe updates idempotently. The exact scenario the
 * assignment calls out ("the same webhook firing twice never produces
 * duplicate rows") is handled by TWO independent guards here:
 *  - webhook_event (source, eventId) unique constraint: a replayed delivery
 *    of the identical event is a no-op before any domain logic runs.
 *  - the underlying (source, externalId) upsert on `transactions`: even a
 *    *different* event about the same PaymentIntent can never duplicate the
 *    row, only update it.
 */
@Controller('webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeClient: StripeClient,
    private readonly stripeAdapter: StripeAdapter,
    private readonly prisma: PrismaService,
  ) {}

  @Post('stripe')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ status: string }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException(
        'Missing raw body or Stripe-Signature header',
      );
    }

    let event: Stripe.Event;
    try {
      // Nobody but Stripe can post events here: this throws if the
      // signature doesn't match the raw body + our signing secret.
      event = this.stripeClient.constructWebhookEvent(req.rawBody, signature);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Invalid signature';
      throw new BadRequestException(
        `Webhook signature verification failed: ${message}`,
      );
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { source_eventId: { source: STRIPE_SOURCE, eventId: event.id } },
    });
    if (existing) {
      this.logger.log(
        `Duplicate delivery of Stripe event ${event.id}, ignoring`,
      );
      return { status: 'ignored_duplicate' };
    }

    await this.prisma.webhookEvent.create({
      data: {
        source: STRIPE_SOURCE,
        eventId: event.id,
        status: WebhookEventStatus.received,
      },
    });

    if (!event.type.startsWith('payment_intent.')) {
      await this.markProcessed(event.id);
      return { status: 'ignored_event_type' };
    }

    try {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const envelope = mapStripePaymentIntent(paymentIntent, event.created);
      const outcome = await this.stripeAdapter.persist(envelope);

      await this.prisma.auditLog.create({
        data: {
          entityType: 'transaction',
          source: STRIPE_SOURCE,
          externalId: outcome.externalId,
          action: toAuditAction(outcome.action),
        },
      });

      await this.markProcessed(event.id);
      return { status: 'processed' };
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { source_eventId: { source: STRIPE_SOURCE, eventId: event.id } },
        data: { status: WebhookEventStatus.failed },
      });
      throw error;
    }
  }

  private async markProcessed(eventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { source_eventId: { source: STRIPE_SOURCE, eventId } },
      data: { status: WebhookEventStatus.processed, processedAt: new Date() },
    });
  }
}
