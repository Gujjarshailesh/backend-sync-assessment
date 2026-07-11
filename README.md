# backend-sync-assessment

A backend sync pipeline that ingests HubSpot (CRM), Google Calendar, and Stripe (payments) — plus a fabricated `seed_finance` source — into one normalized Postgres schema, and a revenue metrics service that computes a single, drift-proof "collected" total across sources with different status vocabularies.

## Architecture

Full design rationale lives in [`docs/DESIGN.md`](docs/DESIGN.md) and the implementation plan in [`docs/ROADMAP.md`](docs/ROADMAP.md). Short version:

- **`src/sources/`** — one adapter per provider (`google-calendar`, `hubspot`, `stripe`, `seed-finance`), all implementing the same `SourceAdapter` interface (`fetchFull`, `fetchIncremental`, `persist`). Adding a fifth provider means writing one adapter and registering it in `sources.module.ts` — nothing else changes.
- **`src/sync/`** — `AdapterRunnerService` runs one adapter end to end (resolves full-vs-incremental, catches a stale/expired cursor and falls back to a full fetch, writes idempotently, logs to `audit_log`). `SyncOrchestratorService` runs every adapter within one `SyncRun` via `Promise.allSettled`, so one dead source never blocks the others. `StripeWebhookController` handles push-based updates idempotently.
- **`src/metrics/`** — `RevenueCalculatorService` is the single query both the summary and breakdown endpoints call; "collected" is resolved via an allow-list (`status_mapping` table), not an exclusion list, and resolved at query time so adding a new status later never requires a backfill.
- **`prisma/schema.prisma`** — the full data model: sync state/history, normalized entities, the status-mapping allow-list, audit log, webhook idempotency table.

## Requirements

- Node.js >= 20
- A Postgres database (this project was built against a free Supabase project)

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum; provider credentials are optional
npx prisma migrate deploy
npm run db:seed
npm run start:dev
```

`npm install` also runs `prisma generate` automatically (via `postinstall`).

### Environment variables

See [`.env.example`](.env.example) for the full list with instructions on obtaining each. Only `DATABASE_URL` is strictly required to boot — provider credentials are optional at the app level, so the server runs fine with any subset configured; an adapter only errors when you actually try to run it without its credential. This lets each provider be set up and verified independently.

## Running the sync pipeline

```bash
# Trigger via HTTP (all sources, or one):
curl -X POST localhost:3000/sync/trigger -H "Content-Type: application/json" -d '{}'
curl -X POST localhost:3000/sync/trigger -H "Content-Type: application/json" -d '{"source":"stripe","mode":"full"}'

# Or standalone per adapter via CLI (useful for verifying one provider in isolation):
npm run sync:run -- seed_finance full
npm run sync:run -- hubspot incremental
```

Inspect results:

```bash
curl localhost:3000/sync/runs
curl localhost:3000/sync/state
npm run db:studio   # visual browser for every table
```

## Revenue metrics

```bash
curl "localhost:3000/metrics/revenue/summary?from=2026-01-01&to=2026-12-31"
curl "localhost:3000/metrics/revenue/breakdown?from=2026-01-01&to=2026-12-31&granularity=day"
```

Both are guaranteed to agree — see `test/integration/revenue-invariant.spec.ts`.

## Testing

```bash
npm test               # unit tests (mappers, retry util, revenue calculator - all mocked, no DB)
npm run test:integration  # idempotency, stale-cursor fallback, webhook dedup, revenue invariant - hits the real DB
npm run test:e2e        # HTTP surface happy paths (trigger -> runs -> state -> metrics)
```

Integration/e2e tests run against whatever `DATABASE_URL` is configured (the same dev database used throughout this project, not an isolated test database — a dedicated test DB would be the right call for a larger project but is out of scope here). Every row these tests create is cleaned up afterward.

## Deployment (Render)

`render.yaml` is a Render Blueprint — in the Render dashboard: **New + → Blueprint**, point at this repo. It configures:
- Build: `npm install && npx prisma migrate deploy && npm run build` (migrate **deploy**, not `dev` — applies existing committed migrations non-interactively, never generates new ones)
- Start: `npm run start:prod`
- Health check: `/health`

Secrets (`DATABASE_URL`, provider credentials, `STRIPE_WEBHOOK_SECRET`) are marked `sync: false` in the blueprint and must be set once in the Render dashboard after the first deploy.

## Key design decisions / tradeoffs

- **Prisma pinned to 6.19.3, not the newly-released 7.x** — Prisma 7 drops the classic `url = env(...)` datasource pattern in favor of driver adapters and, for its new default client, ESM-only output that doesn't compile cleanly under this project's CommonJS setup. Not worth the added complexity for this project's scope.
- **Sync is request-driven, not scheduled** — no cron job triggers sync automatically; it's triggered via `POST /sync/trigger` (manually, or by an external scheduler in production). Simpler, and sidesteps Render free tier's limited native cron.
- **"Collected" is resolved at query time**, never denormalized onto `transactions` — see `RevenueCalculatorService`. This is what makes "add a new status later and both views still agree" actually true.
- **A fabricated second finance source (`seed_finance`)** — one real Stripe test account can't produce enough genuinely different "collected" vocabulary words to honestly exercise multi-source status normalization, so a small static fixture with its own vocabulary (`completed`/`waiting`/`voided`/`reversed`) fills that gap.
- **Stripe's incremental cursor is a Unix timestamp** (via the Events API's `created.gt` filter), not an event id as originally sketched — Stripe's `events.list` defaults to newest-first, so `starting_after` pagination walks backward, the opposite of what a "since last sync" cursor needs.
- **Only one webhook integration (Stripe)**, not one per provider — it demonstrates the exact "webhook firing twice" idempotency requirement cheaply (via the Stripe CLI's signing scheme), without the added setup cost of a second provider's webhook subscription for the same underlying mechanism.
- **A partial unique index enforces "at most one sync run in progress"** at the database level (`sync_run_single_active_idx`), not an application-level check-then-create — the latter has a real race condition, confirmed by firing two simultaneous triggers during development.
- **Single currency (USD), UTC timestamps** — multi-currency conversion is out of scope.
- Tests run against the same dev database rather than an isolated test database (see Testing section above).

## Sources & references

- NestJS documentation (nestjs.com) — module/DI patterns, testing utilities, pipes/filters.
- Prisma documentation (prisma.io/docs) — schema design, raw SQL via `$queryRaw`/`Prisma.sql`, migrations.
- HubSpot CRM API docs (developers.hubspot.com) — Contacts basic/search APIs.
- Google Calendar API docs (developers.google.com/calendar) — `events.list`, `syncToken`/incremental sync, the `410 fullSyncRequired` error.
- Stripe API docs (docs.stripe.com) — PaymentIntents, Events API, webhook signature verification (`stripe.webhooks.constructEvent`).
- nestjs-pino (github.com/iamolegga/nestjs-pino) — structured logging integration.

## AI usage disclosure

This project was built collaboratively with Claude (Anthropic). Claude was used throughout: architecture and design discussion, implementation of all source files, debugging real issues found during verification (Supabase connectivity, a race condition in the sync concurrency guard, a TypeScript build-output path bug), and writing this documentation. All code was reviewed and verified against real external APIs (live HubSpot, Google Calendar, and Stripe test-mode accounts) and a real Supabase Postgres database before being considered complete.
