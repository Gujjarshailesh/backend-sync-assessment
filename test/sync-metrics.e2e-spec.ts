import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface HealthBody {
  status: string;
  db: string;
}

interface SyncRunSummaryBody {
  syncRunId: string;
  status: string;
  sources: { source: string; status: string }[];
}

interface SyncRunBody {
  id: string;
}

interface SyncStateEntry {
  source: string;
  cursor: string | null;
}

interface RevenueSummaryBody {
  totalCollected: number;
}

interface RevenueBreakdownBody {
  buckets: { totalCollected: number }[];
}

/**
 * Happy-path coverage of the HTTP surface: trigger -> runs -> state ->
 * metrics. Deliberately scoped to `seed_finance` (needs no external
 * credentials) rather than triggering every provider, so this suite runs
 * the same in CI as it does locally regardless of which real API keys are
 * configured in a given environment.
 */
describe('Sync + Metrics API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok with db connectivity confirmed', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body as HealthBody).toMatchObject({
      status: 'ok',
      db: 'ok',
    });
  });

  it('POST /sync/trigger runs seed_finance and returns a run summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/sync/trigger')
      .send({ source: 'seed_finance', mode: 'auto' });

    const body = response.body as SyncRunSummaryBody;
    expect(response.status).toBe(201);
    expect(body.status).toBe('success');
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({
      source: 'seed_finance',
      status: 'success',
    });
  });

  it('GET /sync/runs lists recent runs, and GET /sync/runs/:id fetches one by id', async () => {
    const list = await request(app.getHttpServer()).get('/sync/runs?limit=5');
    const runs = list.body as SyncRunBody[];
    expect(list.status).toBe(200);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);

    const runId = runs[0].id;
    const single = await request(app.getHttpServer()).get(
      `/sync/runs/${runId}`,
    );
    expect(single.status).toBe(200);
    expect((single.body as SyncRunBody).id).toBe(runId);
  });

  it('GET /sync/runs/:id returns 404 for an unknown id', async () => {
    const response = await request(app.getHttpServer()).get(
      '/sync/runs/00000000-0000-0000-0000-000000000000',
    );
    expect(response.status).toBe(404);
  });

  it('GET /sync/state includes seed_finance with a stored cursor', async () => {
    const response = await request(app.getHttpServer()).get('/sync/state');
    const state = response.body as SyncStateEntry[];
    expect(response.status).toBe(200);
    const seedFinanceState = state.find((s) => s.source === 'seed_finance');
    expect(seedFinanceState).toBeDefined();
    expect(seedFinanceState?.cursor).toEqual(expect.any(String));
  });

  it('GET /metrics/revenue/summary and /breakdown agree, and reject bad input', async () => {
    // ~2 year span, within the controller's max-range cap (~3 years).
    const summary = await request(app.getHttpServer()).get(
      '/metrics/revenue/summary?from=2025-01-01&to=2027-01-01',
    );
    const summaryBody = summary.body as RevenueSummaryBody;
    expect(summary.status).toBe(200);
    expect(typeof summaryBody.totalCollected).toBe('number');

    const breakdown = await request(app.getHttpServer()).get(
      '/metrics/revenue/breakdown?from=2025-01-01&to=2027-01-01&granularity=day',
    );
    const breakdownBody = breakdown.body as RevenueBreakdownBody;
    expect(breakdown.status).toBe(200);
    const breakdownSum = breakdownBody.buckets.reduce(
      (sum, bucket) => sum + bucket.totalCollected,
      0,
    );
    expect(breakdownSum).toBe(summaryBody.totalCollected);

    const badRange = await request(app.getHttpServer()).get(
      '/metrics/revenue/summary?from=not-a-date&to=also-not-a-date',
    );
    expect(badRange.status).toBe(400);

    const tooWide = await request(app.getHttpServer()).get(
      '/metrics/revenue/summary?from=2000-01-01&to=2030-01-01',
    );
    expect(tooWide.status).toBe(400);
  });
});
