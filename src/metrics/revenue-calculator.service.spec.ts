import { RevenueCalculatorService } from './revenue-calculator.service';
import { PrismaService } from '../database/prisma.service';

describe('RevenueCalculatorService (unit, mocked Prisma)', () => {
  let prisma: { $queryRaw: jest.Mock };
  let calculator: RevenueCalculatorService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    calculator = new RevenueCalculatorService(
      prisma as unknown as PrismaService,
    );
  });

  it('getSummary returns 0 when the query yields no rows', async () => {
    prisma.$queryRaw.mockResolvedValue([{ total: 0n }]);
    const result = await calculator.getSummary(
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    );
    expect(result.totalCollected).toBe(0);
    expect(result.currency).toBe('usd');
  });

  it('getSummary converts the bigint total to a number', async () => {
    prisma.$queryRaw.mockResolvedValue([{ total: 123456n }]);
    const result = await calculator.getSummary(
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    );
    expect(result.totalCollected).toBe(123456);
  });

  it('getBreakdown computes periodEnd correctly for day granularity', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { period_start: new Date('2026-06-01T00:00:00Z'), total: 500n },
    ]);
    const buckets = await calculator.getBreakdown(
      new Date('2026-06-01'),
      new Date('2026-06-02'),
      'day',
    );
    expect(buckets).toEqual([
      {
        periodStart: new Date('2026-06-01T00:00:00Z'),
        periodEnd: new Date('2026-06-02T00:00:00Z'),
        totalCollected: 500,
      },
    ]);
  });

  it('getBreakdown computes periodEnd correctly for week granularity', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { period_start: new Date('2026-06-01T00:00:00Z'), total: 500n },
    ]);
    const buckets = await calculator.getBreakdown(
      new Date('2026-06-01'),
      new Date('2026-06-08'),
      'week',
    );
    expect(buckets[0].periodEnd).toEqual(new Date('2026-06-08T00:00:00Z'));
  });

  it('getBreakdown returns an empty array when there are no buckets', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const buckets = await calculator.getBreakdown(
      new Date('2026-01-01'),
      new Date('2026-02-01'),
      'day',
    );
    expect(buckets).toEqual([]);
  });
});
