# Implementation Roadmap (Finalized)

Status: finalized for implementation. Each task leaves the project in a working, runnable state. Implement and verify one task at a time, in order.

Changes from the previous draft are called out inline. Cut items moved to **Stretch Goals** at the end — not part of the core submission path, only pulled in if time remains after Phase 13.

---

## Phase 0 — Project Setup

### 1. Scaffold NestJS project
- **Objective**: Base NestJS + TS project matching `docs/DESIGN.md`.
- **Files**: `package.json`, `tsconfig.json`, `nest-cli.json`, `.eslintrc`, `.prettierrc`, `src/main.ts`, `src/app.module.ts`, empty `config/ common/ database/ sources/ sync/ metrics/ health/`.
- **Outcome**: `npm run start:dev` boots a bare app.
- **Depends on**: none.
- **Verify**: app starts; `npm run lint`/`build` pass.

### 2. Health module
- **Objective**: Prove the app boots and give Render a health check early.
- **Files**: `src/health/health.module.ts`, `health.controller.ts`.
- **Outcome**: `GET /health` → `200 { status: 'ok' }`.
- **Depends on**: 1.
- **Verify**: `curl localhost:3000/health` → 200.

---

## Phase 1 — Configuration

### 3. Config module, validated + wired through DI
*(merged the old "define schema" and "wire ConfigService" steps — splitting them added a checkpoint with no independent value.)*
- **Objective**: Typed, fail-fast environment configuration, proven reachable via DI.
- **Files**: `src/config/validation.schema.ts` (zod), `configuration.ts`, `config.module.ts`, `.env.example`; extend `health.controller.ts` to surface a config-sourced field (e.g. `env`).
- **Outcome**: App refuses to boot with a clear error on a missing required var; `/health` reflects a config value.
- **Depends on**: 1.
- **Verify**: remove a required var → fails fast with readable error; restore it, change `NODE_ENV` → `/health` reflects it.

---

## Phase 2 — Database Setup

### 4. Provision Postgres + Prisma wiring
- **Objective**: Connect the app to a real database.
- **Files**: Supabase project (external), `prisma/schema.prisma` (datasource), `src/database/prisma.module.ts`, `prisma.service.ts`.
- **Outcome**: App connects on boot; `PrismaService` injectable.
- **Depends on**: 3.
- **Verify**: `/health` runs `SELECT 1` via Prisma, reports DB connectivity ok.

### 5. Migration 1 — sync/run tracking tables
- **Objective**: `sync_state`, `sync_run`, `sync_run_source`.
- **Files**: `prisma/schema.prisma`, migration folder.
- **Outcome**: Tables exist with correct columns/enums.
- **Depends on**: 4.
- **Verify**: `npx prisma migrate dev` succeeds; inspect in Supabase/`psql`.

### 6. Migration 2 — normalized entity tables
- **Objective**: `contacts`, `calendar_events`, `transactions`, with unique constraints + indexes.
- **Files**: `prisma/schema.prisma`, migration folder.
- **Outcome**: `UNIQUE(source, external_id)` enforced on all three.
- **Depends on**: 5.
- **Verify**: insert two rows with the same `(source, external_id)` via a scratch script → constraint fires / upsert overwrites.

### 7. Migration 3 — status mapping, audit, webhook tables
- **Objective**: `status_mapping`, `audit_log`, `webhook_event`.
- **Files**: `prisma/schema.prisma`, migration folder.
- **Outcome**: `UNIQUE(source, raw_status)` and `UNIQUE(source, event_id)` enforced.
- **Depends on**: 6.
- **Verify**: same constraint smoke test as task 6, scoped to these tables.

### 8. Seed baseline status mappings
- **Objective**: Populate `status_mapping` with the initial allow-list.
- **Files**: `src/scripts/seed-status-mapping.ts` (idempotent — safe to rerun).
- **Outcome**: Rows mapping known Stripe/seed-finance statuses to `collected`/`not_collected`.
- **Depends on**: 7.
- **Verify**: query the table, confirm rows match the design doc's allow-list.

---

## Phase 3 — Canonical Models & Shared Kernel

### 9. Canonical interfaces
- **Objective**: Shared TS contracts every adapter implements.
- **Files**: `src/common/interfaces/canonical-entities.interface.ts`, `source-adapter.interface.ts`.
- **Outcome**: `CanonicalContact/CalendarEvent/Transaction`, `CanonicalEnvelope<T>`, `SourceAdapter` compile with no concrete implementation.
- **Depends on**: 1.
- **Verify**: `tsc --noEmit` passes.

### 10. Domain errors + shared utils
- **Objective**: Reusable pieces every adapter/orchestrator depends on.
- **Files**: `src/common/errors/domain-errors.ts`, `utils/retry.util.ts`, `utils/date.util.ts`.
- **Outcome**: `StaleCursorError`, `SourceUnavailableError`, `MappingError`; `withRetry()`; timezone-safe date bucketing.
- **Depends on**: 9.
- **Verify**: unit tests — `withRetry` succeeds after N transient failures / gives up after cap; `date.util` bucket boundaries correct across a UTC day rollover.

---

## Phase 4 — Google Calendar Integration

### 11. Google Calendar account + seed data
- **Objective**: Working credentials + sample data.
- **Files**: none (external) — creds in `.env`/`.env.example`.
- **Outcome**: 5-10 sample events in a calendar.
- **Depends on**: 3.
- **Verify**: throwaway script/curl lists the seeded events.

### 12. GoogleCalendarAdapter — full fetch + write path
- **Objective**: First end-to-end adapter.
- **Files**: `src/sources/google-calendar/calendar.client.ts`, `calendar.mapper.ts`, `calendar.adapter.ts`, `calendar.types.ts`.
- **Outcome**: Full fetch populates `calendar_events`.
- **Depends on**: 6, 9, 10, 11.
- **Verify**: run twice back-to-back via a temp script → row count unchanged the second time.

### 13. GoogleCalendarAdapter — incremental + stale-cursor fallback
- **Objective**: `syncToken` incremental + 410 `fullSyncRequired` → full-fetch fallback.
- **Files**: `calendar.adapter.ts`, `calendar.client.ts`.
- **Outcome**: Adapter reuses syncToken; an invalid token triggers full fetch instead of crashing.
- **Depends on**: 12.
- **Verify**: (a) modify one event, run incremental, confirm only it's touched; (b) corrupt the stored token, confirm fallback recovers cleanly (logged, not thrown).

---

## Phase 5 — HubSpot Integration

### 14. HubSpot account + seed data
- **Objective**: Working private-app token + sample contacts.
- **Files**: none (external) — creds in `.env`/`.env.example`.
- **Outcome**: 5-10 sample contacts.
- **Depends on**: 3.
- **Verify**: throwaway script/curl lists the seeded contacts.

### 15. HubspotAdapter — full fetch + write path
- **Objective**: Mirror task 12 for contacts.
- **Files**: `src/sources/hubspot/hubspot.client.ts`, `hubspot.mapper.ts`, `hubspot.adapter.ts`, `hubspot.types.ts`.
- **Outcome**: Full fetch populates `contacts`.
- **Depends on**: 6, 9, 10, 14.
- **Verify**: run twice back-to-back → no duplicates.

### 16. HubspotAdapter — incremental + stale-cursor fallback
- **Objective**: `hs_lastmodifieddate` incremental + fallback on rejected/invalid cursor.
- **Files**: `hubspot.adapter.ts`, `hubspot.client.ts`.
- **Outcome**: Editing one contact and syncing only touches that contact; a broken cursor falls back to full.
- **Depends on**: 15.
- **Verify**: same two-part check as task 13.

---

## Phase 6 — Stripe + Seed-Finance Integration

### 17. Stripe test-mode account + seed data
- **Objective**: Test-mode credentials + sample transactions across varied statuses.
- **Files**: none (external) — creds in `.env`/`.env.example`.
- **Outcome**: A handful of transactions (succeeded, pending, canceled/refunded).
- **Depends on**: 3.
- **Verify**: Stripe test dashboard shows the seeded transactions.

### 18. StripeAdapter — full fetch + write path
- **Objective**: Mirror tasks 12/15 for transactions.
- **Files**: `src/sources/stripe/stripe.client.ts`, `stripe.mapper.ts`, `stripe.adapter.ts`, `stripe.types.ts`.
- **Outcome**: Full fetch populates `transactions`, `raw_status` preserved verbatim.
- **Depends on**: 6, 9, 10, 17.
- **Verify**: run twice back-to-back → no duplicates; spot-check `raw_status` matches Stripe's real vocabulary.

### 19. StripeAdapter — incremental via Events API + stale-cursor fallback
- **Objective**: Events-API incremental fetch with fallback when the cursor can't be resolved.
- **Files**: `stripe.adapter.ts`, `stripe.client.ts`.
- **Outcome**: New/changed transactions picked up since last cursor; unresolvable cursor triggers full fetch.
- **Depends on**: 18.
- **Verify**: create one new test transaction, run incremental, confirm only it lands; corrupt the cursor, confirm fallback.

### 20. seed-finance fabricated adapter
- **Objective**: A second source with its own distinct status vocabulary, to genuinely exercise multi-vocabulary normalization (one Stripe account can't produce enough distinct "collected" words on its own).
- **Files**: `src/sources/seed-finance/seed-finance.adapter.ts`, static fixture JSON.
- **Outcome**: Fabricated transactions land with `source='seed_finance'` and words like `completed`/`voided`/`waiting`.
- **Depends on**: 6, 9, 10.
- **Verify**: run it, confirm rows with unique `(source, external_id)` and distinguishable `raw_status` values.

---

## Phase 6.5 — Adapter Verification Gate *(new)*

### 21. Verify all adapters in isolation before integrating
*(addresses "add adapter verification before integrating everything together" — an explicit gate rather than relying only on each adapter's own ad hoc check.)*
- **Objective**: Confirm all four adapters (Calendar, HubSpot, Stripe, seed-finance) conform to the shared `SourceAdapter` interface and behave correctly *standalone*, before the orchestrator ever touches them.
- **Files**: `test/integration/adapter-conformance.spec.ts` — one parameterized test suite run against all four adapters: `fetchFull()` returns canonical records, `fetchIncremental(cursor)` returns only changed records, a forced bad cursor throws the expected `StaleCursorError`, and upserting the same batch twice produces no duplicate rows.
- **Outcome**: One test file proves every adapter is interchangeable and individually correct.
- **Depends on**: 13, 16, 19, 20.
- **Verify**: test suite passes for all four adapters using the same assertions.

---

## Phase 7 — Sync Orchestration & API (request-driven only)

### 22. SyncOrchestratorService
*(includes a lightweight concurrency guard — reject/queue a trigger if a run is already `in_progress` for the requested scope — since this becomes a real possibility once the same source can be triggered manually at any time.)*
- **Objective**: Tie all four adapters together with per-adapter error isolation and run bookkeeping.
- **Files**: `src/sync/sync-orchestrator.service.ts`, `sync-state.service.ts`, `sync-run.service.ts`, `sync.module.ts`.
- **Outcome**: One call runs every adapter via `Promise.allSettled`, writes `sync_run`/`sync_run_source`, advances `sync_state` only on success; a second concurrent trigger for a running source is rejected with a clear error rather than racing.
- **Depends on**: 21.
- **Verify**: run once → all four sources land data, `sync_run.status = success`. Break one adapter's credentials → run completes `partial_failure`, other three still land data. Fire two triggers back-to-back → second is rejected/queued, not racing the first.

### 23. SyncController
*(manual trigger only — no scheduler. This is the deliberate "request-driven" simplification: a real sync system either way needs a trigger endpoint for the demo/grading, and adding a scheduler on top is a separate concern we're deferring, not a prerequisite.)*
- **Objective**: Expose the orchestrator over HTTP.
- **Files**: `src/sync/sync.controller.ts`, `dto/trigger-sync.dto.ts`.
- **Outcome**: `POST /sync/trigger`, `GET /sync/runs`, `GET /sync/runs/:id`, `GET /sync/state` all work.
- **Depends on**: 22.
- **Verify**: curl each endpoint; trigger via curl, see the run appear in `GET /sync/runs`.

### 24. Audit log wiring
- **Objective**: Record created/updated/skipped events during upserts.
- **Files**: shared upsert helper referencing `audit_log`.
- **Outcome**: Every upsert writes a corresponding `audit_log` row.
- **Depends on**: 22.
- **Verify**: trigger a sync, query `audit_log`, confirm entries match what changed.

---

## Phase 8 — Webhook (Stripe only — see note)

### 25. Stripe webhook endpoint
*(Recommendation: keep exactly one webhook integration in the core path, not zero and not two. Stripe is the cheapest to prove — official CLI can fire and replay a real signed event with no public URL needed locally, and it directly demonstrates the assignment's literal "same webhook firing twice" language. HubSpot's webhook subscription setup adds real overhead for the same idempotency mechanism already proven here — moved to stretch goals. If you'd rather cut this too and rely solely on the job-rerun idempotency already proven in tasks 12/15/18 and 21, that's a defensible simplification — say so and we'll drop it.)*
- **Objective**: Handle push-based updates idempotently.
- **Files**: `src/sync/webhooks/stripe-webhook.controller.ts`.
- **Outcome**: `POST /webhooks/stripe` verifies signature, checks `webhook_event(source, event_id)`, processes new events through the same mapper/upsert path, marks duplicates as no-ops.
- **Depends on**: 18, 24.
- **Verify**: Stripe CLI sends a real test event twice — one row created, second delivery logged `ignored_duplicate`, no new row/audit entry.

---

## Phase 9 — Revenue Metrics

### 26. StatusMappingService
*(trimmed: dropped the introspection HTTP endpoint from this task — it's not required by the assignment and is just a demo nicety; moved to stretch goals. The service itself is required, the endpoint isn't.)*
- **Objective**: Single lookup point for the allow-list, used by the calculator.
- **Files**: `src/metrics/status-mapping.service.ts`.
- **Outcome**: A method resolving `(source, raw_status) → collected | not_collected | unknown`, backed by the `status_mapping` table.
- **Depends on**: 8.
- **Verify**: unit test covering a known mapped status, an unmapped status (defaults to not-collected), and a source with no rows at all.

### 27. RevenueCalculatorService
- **Objective**: One canonical, shared query for "collected" totals over a date range.
- **Files**: `src/metrics/revenue-calculator.service.ts`.
- **Outcome**: A single method returning both a total and bucketed totals, joining `transactions` to `status_mapping` at query time (no materialized `canonical_status` column).
- **Depends on**: 18, 20, 26.
- **Verify**: unit test against seeded transaction data confirms the total matches a hand-computed expected value.

### 28. MetricsController
*(query DTO includes a sane max date-range span to reject pathological requests — small addition, folded in rather than a separate task.)*
- **Objective**: Expose summary and breakdown views, both built on `RevenueCalculatorService`.
- **Files**: `src/metrics/metrics.controller.ts`, `dto/date-range-query.dto.ts`.
- **Outcome**: `GET /metrics/revenue/summary` and `GET /metrics/revenue/breakdown` both work and agree; an excessive date range is rejected with 400.
- **Depends on**: 27.
- **Verify**: curl both endpoints for the same range, manually sum breakdown buckets, confirm equals summary total; request a huge range, confirm clean 400.

### 29. Invariant + allow-list tests
- **Objective**: Prove "never drifts" with an automated test, not manual spot-checks.
- **Files**: `test/integration/revenue-invariant.spec.ts`.
- **Outcome**: Test asserting `summary === sum(breakdown)` across randomized ranges, plus a test proving an unmapped/new status is excluded by default.
- **Depends on**: 28.
- **Verify**: suite passes; temporarily hardcode a second, slightly different calculation to confirm the test *would* fail, then remove it.

---

## Phase 10 — Cross-Cutting Polish

### 30. Global exception filter
- **Objective**: Consistent HTTP error shapes for domain errors.
- **Files**: `src/common/filters/all-exceptions.filter.ts`, registered in `main.ts`.
- **Outcome**: Domain errors map to sensible HTTP statuses/bodies when they escape to a controller.
- **Depends on**: 10, 23.
- **Verify**: force a domain error from a controller path, confirm consistent response, no leaked stack trace.

### 31. Structured logging + validation pipe
- **Objective**: Observability and input hygiene across the app.
- **Files**: `src/common/interceptors/logging.interceptor.ts`, `main.ts` (nestjs-pino, global `ValidationPipe`).
- **Outcome**: Structured JSON request logs; one structured line per adapter run; invalid inputs rejected with clean 400s.
- **Depends on**: 22, 23, 28.
- **Verify**: trigger a sync, tail logs, confirm readable structured entries per adapter; send a malformed request, confirm clean 400.

---

## Phase 11 — Testing

### 32. Unit tests — mappers & calculator
- **Files**: `test/unit/*.spec.ts`.
- **Outcome**: Mapping edge cases and calculator math covered.
- **Depends on**: 12, 15, 18, 20, 27.
- **Verify**: `npm test` passes.

### 33. Integration tests — idempotency, stale-cursor, webhook dedup
- **Objective**: Automate the manual verifications from tasks 12/13/15/16/18/19/25.
- **Files**: `test/integration/*.spec.ts`.
- **Depends on**: 22, 25.
- **Verify**: tests pass against a real/dockerized test DB.

### 34. e2e tests
- **Files**: `test/e2e/*.e2e-spec.ts`.
- **Outcome**: Supertest coverage of `/sync/trigger` → `/sync/runs` → `/metrics/revenue/*` happy paths.
- **Depends on**: 23, 28, 33.
- **Verify**: `npm run test:e2e` passes.

---

## Phase 12 — Deployment

### 35. Render deployment config
*(explicitly includes the production-migration gotcha: `prisma migrate deploy` in the build/start command, not `migrate dev`; `prisma generate` as a build step — easy to miss and a real production-quality signal.)*
- **Files**: `Dockerfile` or Render-native build/start commands, env vars in Render dashboard.
- **Outcome**: Render web service builds and starts successfully using `migrate deploy`.
- **Depends on**: tasks 1–31 substantially complete.
- **Verify**: Render build logs show success; service reachable.

### 36. Live smoke check
- **Outcome**: Live `/health`, `/sync/trigger`, `/metrics/revenue/summary` all respond correctly against the deployed URL.
- **Depends on**: 35.
- **Verify**: curl the live Render URL for each.

---

## Phase 13 — Final Validation & Submission

### 37. Live failure-mode smoke test
- **Objective**: Confirm resilience holds on the real deployment — this becomes the demo video content.
- **Outcome**: Deliberately breaking one source (bad credential/expired cursor) against the live instance still lands the other sources' data, shows a clean partial-failure/backfill result, and (if task 25 is kept) a duplicate webhook delivery is a no-op live.
- **Depends on**: 36.
- **Verify**: manual live test matching at least one edge case from the problem statement, screen-recorded for the demo.

### 38. Documentation & submission
*(README explicitly answers the open decisions from `docs/DESIGN.md` — sync trigger is request-driven not scheduled, canonical status resolved at query time not materialized, only one webhook integration — as stated tradeoffs, not omissions.)*
- **Files**: `README.md` (setup, run-locally, tradeoffs, sources/references, AI usage disclosure), demo video, final repo cleanup.
- **Outcome**: All five "What to Submit" items ready.
- **Depends on**: everything else.
- **Verify**: walk the assignment's submission checklist item by item.

---

## Stretch Goals (post-MVP, only if time remains)

Not tracked as active tasks — pulled back in only after task 38 is otherwise done.

- **Scheduled cron trigger** (`@nestjs/schedule`) for periodic automatic sync — cut for MVP in favor of a manual, request-driven trigger; also sidesteps Render free tier's limited native cron.
- **Production scheduling** (Render Cron Job / external GitHub Actions trigger) — depends on the above; no scheduler in MVP means nothing to schedule in prod yet.
- **HubSpot webhook endpoint** — same idempotency mechanism as the Stripe webhook, lower grading value for the added HubSpot app/webhook-subscription setup.
- **`GET /metrics/status-mapping` introspection endpoint** — nice demo touch, not required; the underlying service (task 26) is required, the HTTP surface isn't.
- **Data-browsing endpoints** (`GET /contacts`, `/calendar-events`, `/transactions`) — convenient during manual verification, but Prisma Studio / direct queries cover the same need without adding API surface.

---

## Review notes

- **Provider integrations fully precede orchestration** (phases 4–6 before 7) — already the right order, kept as-is.
- **Adapter verification gate added** (phase 6.5) as an explicit checkpoint before wiring adapters into the orchestrator.
- **Sync is request-driven only** in the core path — no scheduler dependency, simpler Render deployment, still fully satisfies "sync job re-running back-to-back never produces duplicates" since that's about the trigger being re-callable, not about *how* it's invoked.
- **Webhook scope trimmed to one provider** (Stripe) — flagged as a judgment call in task 25, easy to cut further or extend if you disagree.
- **Net effect**: 38 core tasks (down from 41), one new explicit verification gate, three items demoted to stretch, a few small production-quality details folded into existing tasks rather than new ones (concurrency guard, migrate deploy, date-range validation).
- **Balance check**: no queueing infrastructure, no microservices, no premature scheduling — matches the assessment's explicit framing ("we care about data correctness and failure, not how anything looks") without gold-plating.
