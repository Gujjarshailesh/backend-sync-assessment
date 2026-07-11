import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AdapterRunnerService } from '../../src/sync/adapter-runner.service';
import { SeedFinanceAdapter } from '../../src/sources/seed-finance/seed-finance.adapter';

/**
 * Automates what was manually verified via the CLI runner during
 * development: full-sync idempotency and the stale-cursor -> full-fetch
 * fallback. Uses seed-finance specifically because it needs no external
 * credentials, so this suite runs the same in CI as it does locally.
 */
describe('Sync idempotency and stale-cursor fallback (seed-finance)', () => {
  let prisma: PrismaService;
  let runner: AdapterRunnerService;
  let adapter: SeedFinanceAdapter;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    runner = moduleRef.get(AdapterRunnerService);
    adapter = moduleRef.get(SeedFinanceAdapter);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('running a full sync twice in a row produces zero new rows the second time', async () => {
    const first = await runner.runStandalone(adapter, 'full');
    expect(first.status).toBe('success');

    const countAfterFirst = await prisma.transaction.count({
      where: { source: 'seed_finance' },
    });

    const second = await runner.runStandalone(adapter, 'full');
    expect(second.status).toBe('success');
    expect(second.created).toBe(0);

    const countAfterSecond = await prisma.transaction.count({
      where: { source: 'seed_finance' },
    });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('an invalid stored cursor triggers a self-healing full fetch, not a failure', async () => {
    await prisma.syncState.update({
      where: { source: 'seed_finance' },
      data: { cursor: 'this-is-not-a-valid-iso-date' },
    });

    const countBefore = await prisma.transaction.count({
      where: { source: 'seed_finance' },
    });

    const result = await runner.runStandalone(adapter, 'incremental');

    expect(result.status).toBe('success');
    expect(result.mode).toBe('full'); // fell back, despite being asked for incremental

    const countAfter = await prisma.transaction.count({
      where: { source: 'seed_finance' },
    });
    expect(countAfter).toBe(countBefore); // still idempotent through the fallback
  });
});
