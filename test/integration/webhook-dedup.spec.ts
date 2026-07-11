import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AppConfigService } from '../../src/config/app-config.service';

interface WebhookResponseBody {
  status: string;
}

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('Stripe webhook idempotency (POST /webhooks/stripe)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let webhookSecret: string;
  const externalId = `pi_webhook_dedup_test_${Date.now()}`;
  const eventId = `evt_webhook_dedup_test_${Date.now()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
    });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    const config = moduleRef.get(AppConfigService);
    webhookSecret = config.stripeWebhookSecret as string;
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({
      where: { source: 'stripe', externalId },
    });
    await prisma.auditLog.deleteMany({
      where: { source: 'stripe', externalId },
    });
    await prisma.webhookEvent.deleteMany({
      where: { source: 'stripe', eventId },
    });
    await app.close();
  });

  it('processes a new event once, then ignores an exact-duplicate delivery', async () => {
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: externalId,
          object: 'payment_intent',
          amount: 1234,
          currency: 'usd',
          status: 'succeeded',
          customer: null,
          created: Math.floor(Date.now() / 1000),
        },
      },
    });
    const signature = signStripePayload(payload, webhookSecret);

    const first = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
    expect(first.status).toBe(201);
    expect((first.body as WebhookResponseBody).status).toBe('processed');

    const second = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
    expect(second.status).toBe(201);
    expect((second.body as WebhookResponseBody).status).toBe(
      'ignored_duplicate',
    );

    const txCount = await prisma.transaction.count({
      where: { source: 'stripe', externalId },
    });
    expect(txCount).toBe(1); // never duplicated, despite two identical deliveries
  });

  it('rejects a payload with an invalid signature', async () => {
    const payload = JSON.stringify({
      id: 'evt_bad_sig',
      type: 'payment_intent.succeeded',
    });
    const response = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .send(payload);
    expect(response.status).toBe(400);
  });
});
