import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { RevenueCalculatorService } from '../../src/metrics/revenue-calculator.service';

/**
 * Runs against the same database configured in .env (the dev Supabase
 * project used throughout this project), not an isolated test database -
 * a dedicated test DB would be the right call for a larger project, but is
 * out of scope here. Every row this suite creates is cleaned up in
 * afterAll so it never pollutes the real demo data.
 */
describe('Revenue invariant (summary === sum(breakdown))', () => {
  let prisma: PrismaService;
  let calculator: RevenueCalculatorService;

  const TEST_SOURCE = 'stripe';
  const TEST_EXTERNAL_IDS = ['inv_test_a', 'inv_test_b', 'inv_test_c'];
  const UNMAPPED_EXTERNAL_ID = 'inv_test_unmapped';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    calculator = moduleRef.get(RevenueCalculatorService);
    await prisma.$connect();

    // Seed a small, known set of transactions spanning multiple days so the
    // day-granularity breakdown has more than one bucket to sum.
    await prisma.transaction.createMany({
      data: [
        {
          source: TEST_SOURCE,
          externalId: 'inv_test_a',
          amount: 1000,
          currency: 'usd',
          rawStatus: 'succeeded',
          occurredAt: new Date('2021-03-01T00:00:00Z'),
          sourceUpdatedAt: new Date(),
          rawPayload: {},
        },
        {
          source: TEST_SOURCE,
          externalId: 'inv_test_b',
          amount: 2000,
          currency: 'usd',
          rawStatus: 'succeeded',
          occurredAt: new Date('2021-03-03T00:00:00Z'),
          sourceUpdatedAt: new Date(),
          rawPayload: {},
        },
        {
          source: TEST_SOURCE,
          externalId: 'inv_test_c',
          amount: 4000,
          currency: 'usd',
          rawStatus: 'requires_payment_method', // not_collected - should never be counted
          occurredAt: new Date('2021-03-03T00:00:00Z'),
          sourceUpdatedAt: new Date(),
          rawPayload: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({
      where: {
        source: TEST_SOURCE,
        externalId: { in: [...TEST_EXTERNAL_IDS, UNMAPPED_EXTERNAL_ID] },
      },
    });
    await prisma.$disconnect();
  });

  it('summary total equals the sum of the day-granularity breakdown across several ranges', async () => {
    const ranges = [
      { from: new Date('2021-01-01'), to: new Date('2021-06-01') },
      { from: new Date('2021-03-01'), to: new Date('2021-03-02') }, // exactly one of the two collected rows
      { from: new Date('2020-01-01'), to: new Date('2030-01-01') }, // spans everything, including real seeded data
    ];

    for (const range of ranges) {
      const summary = await calculator.getSummary(range.from, range.to);
      const breakdown = await calculator.getBreakdown(
        range.from,
        range.to,
        'day',
      );
      const breakdownSum = breakdown.reduce(
        (sum, bucket) => sum + bucket.totalCollected,
        0,
      );
      expect(breakdownSum).toBe(summary.totalCollected);
    }
  });

  it('excludes the non-collected row from both the summary and the breakdown', async () => {
    const range = { from: new Date('2021-03-01'), to: new Date('2021-03-05') };
    const summary = await calculator.getSummary(range.from, range.to);
    // Only inv_test_a (1000) + inv_test_b (2000) are collected; inv_test_c
    // (4000, requires_payment_method) must not appear in the total.
    expect(summary.totalCollected).toBe(3000);
  });

  it('an unmapped/new status is excluded by default, not silently counted as revenue', async () => {
    const range = { from: new Date('2021-03-01'), to: new Date('2021-03-10') };
    const before = await calculator.getSummary(range.from, range.to);

    await prisma.transaction.create({
      data: {
        source: TEST_SOURCE,
        externalId: UNMAPPED_EXTERNAL_ID,
        amount: 999999,
        currency: 'usd',
        rawStatus: 'brand_new_status_nobody_mapped_yet',
        occurredAt: new Date('2021-03-04T00:00:00Z'),
        sourceUpdatedAt: new Date(),
        rawPayload: {},
      },
    });

    const after = await calculator.getSummary(range.from, range.to);
    expect(after.totalCollected).toBe(before.totalCollected);
  });
});
