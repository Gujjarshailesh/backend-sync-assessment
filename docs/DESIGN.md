# Technical Design — Sync Pipeline & Revenue Metrics

Status: draft, under review with user before implementation.

## 1. Project structure

```
src/
  main.ts
  app.module.ts
  config/
    configuration.ts
    validation.schema.ts
    config.module.ts
  common/
    filters/
      all-exceptions.filter.ts
    interceptors/
      logging.interceptor.ts
    interfaces/
      source-adapter.interface.ts
      canonical-entities.interface.ts
    errors/
      domain-errors.ts        # StaleCursorError, SourceUnavailableError, MappingError
    utils/
      retry.util.ts
      date.util.ts
      pagination.util.ts
  database/
    prisma.module.ts
    prisma.service.ts
    prisma/schema.prisma
    prisma/migrations/
  sources/
    sources.module.ts
    interfaces/source-adapter.interface.ts
    hubspot/
      hubspot.adapter.ts
      hubspot.client.ts
      hubspot.mapper.ts
      hubspot.types.ts
    google-calendar/
      calendar.adapter.ts
      calendar.client.ts
      calendar.mapper.ts
      calendar.types.ts
    stripe/
      stripe.adapter.ts
      stripe.client.ts
      stripe.mapper.ts
      stripe.types.ts
    seed-finance/            # fabricated second "collected" vocabulary source
      seed-finance.adapter.ts
  sync/
    sync.module.ts
    sync.controller.ts
    sync-orchestrator.service.ts
    sync-state.service.ts
    sync-run.service.ts
    webhooks/
      hubspot-webhook.controller.ts
      stripe-webhook.controller.ts
    dto/trigger-sync.dto.ts
  metrics/
    metrics.module.ts
    metrics.controller.ts
    revenue-calculator.service.ts
    status-mapping.service.ts
    dto/date-range-query.dto.ts
  health/
    health.module.ts
    health.controller.ts
  scripts/
    seed-hubspot.ts
    seed-calendar.ts
test/
  unit/
  integration/
  e2e/
```

## 2. Module responsibilities

- **ConfigModule** — loads/validates env once at boot (zod schema), typed `ConfigService`, fail fast on missing secrets.
- **DatabaseModule (Prisma)** — single `PrismaService`, connection lifecycle.
- **SourcesModule** — exports all adapters behind a common `SourceAdapter` interface via a multi-provider token; the orchestrator never imports a concrete adapter class.
- **SyncModule** — trigger endpoint, cron trigger, orchestrator, cursor persistence, run/audit logging, webhook receivers.
- **MetricsModule** — reads only from normalized tables; decoupled from how data got there.
- **HealthModule** — `/health` for Render + demo.
- **common/** — cross-cutting: exception filter, logging interceptor, domain errors, retry/date/pagination utils.

## 3. Database schema

**sync_state** — one row per source
- `source` (PK, text)
- `cursor` (text, nullable)
- `cursor_type` (enum: timestamp | token)
- `last_full_sync_at`, `last_incremental_sync_at` (timestamptz, nullable)
- `last_status` (enum: success | partial | failed)
- `updated_at`

**sync_run** — one row per pipeline execution
- `id` (PK uuid), `trigger_type` (manual | scheduled | webhook)
- `started_at`, `finished_at` (nullable)
- `status` (running | success | partial_failure | failed)

**sync_run_source** — per-source outcome within a run
- `id` (PK uuid), `sync_run_id` (FK → sync_run.id, ON DELETE CASCADE)
- `source`, `mode` (incremental | full)
- `status` (success | failed), `records_fetched`, `records_upserted`, `error_message`
- `started_at`, `finished_at`
- INDEX (sync_run_id), (source, started_at desc)

**contacts**
- `id` (PK uuid), `source`, `external_id`
- `email`, `first_name`, `last_name`, `phone`, `lifecycle_stage`
- `source_created_at`, `source_updated_at`, `raw_payload` (jsonb)
- `synced_at`, `deleted_at` (nullable, tombstone)
- UNIQUE (source, external_id); INDEX (source_updated_at), (email)

**calendar_events**
- `id`, `source`, `external_id`, `calendar_id`
- `title`, `description`, `location`, `start_time`, `end_time`, `status`, `attendees` (jsonb)
- `source_updated_at`, `raw_payload`, `synced_at`, `deleted_at`
- UNIQUE (source, external_id); INDEX (source_updated_at), (start_time)

**transactions** (PS2-critical)
- `id`, `source`, `external_id`, `customer_ref` (nullable)
- `amount` (int, minor units), `currency`
- `raw_status` (text — **no denormalized canonical_status column**, see below)
- `occurred_at` (timestamptz — authoritative bucketing field)
- `source_updated_at`, `raw_payload`, `synced_at`
- UNIQUE (source, external_id); INDEX (occurred_at), (source, raw_status, occurred_at)

**status_mapping** — the allow-list, as data (the single place "does this count" is decided)
- `id`, `source`, `raw_status`, `canonical_status` (collected | not_collected | unknown)
- UNIQUE (source, raw_status)

Design decision: canonical "collected" status is **resolved at query time** by joining `transactions` to `status_mapping`, never materialized/frozen on the transaction row. This is what makes "add a new status later and totals still agree" true — a materialized column would need a backfill migration and could go stale between mapping updates. Both metrics endpoints must go through one shared query (a view or one repository method) — that is the actual mechanism behind "something would catch a second divergent implementation," backed by an invariant test.

**audit_log**
- `id`, `entity_type` (contact | calendar_event | transaction), `source`, `external_id`
- `action` (created | updated | skipped_duplicate | soft_deleted)
- `sync_run_id` (FK, nullable), `diff` (jsonb, nullable), `created_at`
- INDEX (entity_type, external_id), (sync_run_id)

**webhook_event** — webhook-specific idempotency guard
- `id`, `source`, `event_id`, `received_at`, `processed_at` (nullable)
- `status` (received | processed | ignored_duplicate | failed)
- UNIQUE (source, event_id)

No hard FK from `contacts`/`calendar_events`/`transactions` to `sync_run` — keeps normalized data lifecycle decoupled from pipeline run history; `audit_log` carries that link softly instead.

## 4. Canonical data model

```
CanonicalEnvelope<T> { source, externalId, sourceUpdatedAt, raw: unknown, data: T }

CanonicalContact {
  email, firstName, lastName, phone,
  lifecycleStage,   // raw CRM stage, not interpreted
  createdAt, updatedAt
}

CanonicalCalendarEvent {
  calendarId, title, description, location,
  startTime, endTime,
  status,           // raw, e.g. 'confirmed' | 'cancelled'
  attendees: { email, responseStatus }[],
  updatedAt
}

CanonicalTransaction {
  customerRef, amount /* minor units */, currency,
  rawStatus,        // untouched, e.g. 'succeeded' | 'voided'
  occurredAt, updatedAt
}
```

Principle: canonical model normalizes **shape** (field names/types/units), not **status meaning** — that resolution is deliberately deferred to `status_mapping`, kept separate from ingestion so new statuses are a data change, not a code change.

## 5. Provider → canonical mapping

**HubSpot (Contacts)**
- Fields: `id`, `properties.email/firstname/lastname/phone/lifecyclestage`, `properties.hs_lastmodifieddate`, `createdAt`, `updatedAt`.
- Incremental: CRM v3 Search API filtered on `hs_lastmodifieddate >` stored cursor, sorted ascending; cursor = last seen `hs_lastmodifieddate`.
- Full: list-all via HubSpot's own `after` pagination.
- "Stale cursor": search request failing validation (malformed/too-old timestamp) treated as the trigger → fall back to full.
- Webhook: HubSpot Workflows webhook delivers `objectId` + `subscriptionId` + `occurredAt`; combine into a synthetic event id for `webhook_event` (exact payload shape to confirm during implementation).

**Google Calendar**
- Fields: `id`, `summary`, `description`, `location`, `start.dateTime`, `end.dateTime`, `status`, `attendees[]`, `updated`.
- Incremental: `events.list` with stored `syncToken`; store `nextSyncToken` from the response as new cursor.
- Full: `events.list` without syncToken, bounded by a `timeMin`/`timeMax` window (e.g. -1y/+1y) rather than unbounded all-time.
- Stale cursor: API returns **HTTP 410** with reason `fullSyncRequired` — this is the literal case the assignment's "410" hint points at. Clear cursor, run full fetch, store new `nextSyncToken`.
- No push webhook for MVP (Google's channel-based push needs a public callback + renewal — out of scope); rely on scheduled incremental sync. Flagged as an assumption.

**Stripe**
- Fields: PaymentIntent/Charge `id`, `amount`, `currency`, `status` (`succeeded`/`processing`/`canceled`, etc. — genuinely different vocabulary from the prompt's example words), `customer`, `created`.
- Incremental: use the **Events API** (`payment_intent.*` types) — event `id` is a usable monotonic cursor representing "something changed"; direct list APIs only filter by creation time, not "changed since."
- Full: list PaymentIntents/Charges directly.
- Stale cursor: Stripe retains events ~30 days; if the stored event cursor can't be resolved, fall back to full list.
- Webhook: Stripe's `event.id` is unique and documented as needing dedup on the consumer side — textbook fit for `webhook_event.event_id`.

**seed-finance (fabricated second vocabulary source)**
- A static JSON/seed adapter using the same `SourceAdapter` interface, emitting its own distinct status words (e.g. `completed`/`voided`/`waiting`) so multi-vocabulary normalization is actually exercised — one real Stripe test account can't produce enough distinct "collected" vocabularies on its own.

## 6. REST API endpoints

Sync:
- `POST /sync/trigger` — `{ source?, mode?: 'incremental'|'full' }`; returns sync run summary
- `GET /sync/runs` — paginated list of recent runs
- `GET /sync/runs/:id` — run detail incl. per-source outcomes
- `GET /sync/state` — current cursor/status per source
- `POST /webhooks/hubspot`
- `POST /webhooks/stripe` (raw body required for signature verification)

Metrics:
- `GET /metrics/revenue/summary?from=&to=` → `{ from, to, totalCollected, currency }`
- `GET /metrics/revenue/breakdown?from=&to=&granularity=day|week` → `{ buckets: [{ periodStart, periodEnd, totalCollected }] }`
- `GET /metrics/status-mapping` — introspection of the current allow-list (handy for demo)

Data browsing (demo/curl convenience, not core requirement):
- `GET /contacts`, `GET /calendar-events`, `GET /transactions`

Health:
- `GET /health`

## 7. Complete sync flow

1. Trigger arrives via `POST /sync/trigger`, a `@Cron` job calling the same service method, or an inbound webhook.
2. `SyncController` validates the DTO, calls `SyncOrchestratorService.runSync(sourceFilter?, mode?)`.
3. Orchestrator creates a `sync_run` row (`status='running'`). Given expected small data volumes, run **synchronously** and return the final result — avoids building job-status polling for little benefit; revisit if a source turns out slow.
4. For each relevant adapter, run inside `Promise.allSettled`:
   1. Create a `sync_run_source` row.
   2. Read the current cursor from `sync_state`.
   3. If cursor exists and mode isn't forced-full → `adapter.fetchIncremental(cursor)`. A recognized `StaleCursorError` → log it, clear the cursor, fall back to `adapter.fetchFull()`. Other errors propagate to the per-adapter catch.
   4. No cursor / forced full → `adapter.fetchFull()`.
   5. Map each raw record via `adapter.mapToCanonical(raw)`.
   6. Upsert each canonical record — conflict target `(source, external_id)` — inside a transaction scoped to that adapter's batch only (not a cross-source transaction, so one adapter's failure can't roll back another's committed writes).
   7. Write `audit_log` rows for created/updated/skipped records.
   8. Update `sync_state` (new cursor + status) only after a successful fetch+write.
   9. Mark `sync_run_source` success (with counts) or failed (with `error_message`), and continue to the next adapter regardless.
5. Once all adapters settle, set `sync_run.status` to success / partial_failure / failed, set `finished_at`.
6. Return the run summary as the HTTP response.
7. Webhook path: verify signature → check `webhook_event(source, event_id)` → if already processed, return 200 no-op; else insert a `received` row, resolve the single affected record (via payload or a `fetchOne`), run it through the same mapper+upsert+audit path, mark `processed`.

## 8. Incremental + full sync interplay

- `sync_state.cursor = null` → first-ever run for a source is always full, seeding the first cursor.
- Steady state → incremental using the stored cursor.
- Cursor rejection (410 / invalid token / unresolvable Stripe event id) is a **signal, not an error** — clear cursor, run full fetch in the same pass, so it self-heals within one run instead of failing.
- Full fetch always goes through the same idempotent upsert path — this is why "full backfill never duplicates" is directly testable (run full fetch twice back-to-back).
- Manual `mode=full` override always available via the trigger endpoint, for demo purposes.
- Recommended addition (not a hard requirement): a periodic scheduled full fetch as a safety net against silent incremental drift (e.g. deletions some APIs don't surface as "changed").

## 9. Idempotency, dedup, retry, partial-failure recovery

- **Row-level idempotency**: `UNIQUE(source, external_id)` + upsert everywhere — solves back-to-back re-runs and post-stale-cursor backfills.
- **Webhook-level idempotency**: separate `UNIQUE(source, event_id)` check *before* processing — cheaper short-circuit, and necessary for events with no direct row equivalent (e.g. deletions).
- **Retry strategy**: small backoff-with-jitter helper around outbound calls, retrying only transient classes (429, 502/503/504, timeouts); non-retryable errors (401, 404, 410-as-stale-signal) fail fast and are handled explicitly. Cap retries (e.g. 3) so a dead source fails within bounded time.
- **Partial failure recovery**: `Promise.allSettled` at the adapter level + per-adapter transactions is the core mechanism — one failing adapter becomes a `failed` `sync_run_source` row, not an aborted run.
- **Recovery on next run**: cursors only advance after success, so a failed adapter naturally retries from its last-good cursor next time — no special resume logic needed.
- **Metrics correctness**: enforced structurally (one shared query/service for both endpoints) plus an invariant test (`summary === sum(breakdown)` across randomized ranges) as a regression guard.

## 10. Config, logging, validation, exceptions, shared utilities

- **Config**: `@nestjs/config` + zod schema validated at bootstrap; typed `ConfigService`; fail fast on missing secrets.
- **Logging**: structured JSON via `nestjs-pino`; a logging interceptor for request/duration; the orchestrator logs one structured event per adapter run (source, mode, duration, recordsFetched/Upserted, outcome) — doubles as demo-video narrative.
- **Validation**: DTOs + global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`; standardize on **zod** for env + query DTOs, only reach for class-validator if Nest's body-DTO pipe ergonomics are wanted — don't mix arbitrarily.
- **Exceptions**: small domain error hierarchy (`StaleCursorError`, `SourceUnavailableError`, `MappingError`) thrown by adapters; a global `AllExceptionsFilter` maps them to consistent HTTP shapes for controller-triggered paths; the orchestrator catches them directly for non-HTTP-triggered runs (cron/webhook).
- **Shared utilities**: `retry.util.ts`, `date.util.ts` (timezone-safe bucketing shared between breakdown query and range validation), `pagination.util.ts`, `SourceAdapter` interface keeping the orchestrator decoupled from provider specifics.

## 11. Library choices

- **Prisma** — type-safe end-to-end, easy migrations against Supabase Postgres, `schema.prisma` doubles as readable documentation.
- **zod** — env validation + query DTOs, good TS inference, lighter than Joi.
- **@nestjs/schedule** — cron trigger without extra infra.
- **@hubspot/api-client, googleapis, stripe** — official SDKs handle auth/pagination/retry shape correctly.
- **nestjs-pino** — structured logs, readable both locally and in Render's log viewer.
- **p-retry** (or a small hand-rolled equivalent) — don't reinvent backoff for something this small; either is fine.
- **luxon** — clean UTC/timezone bucket-boundary math.
- **Jest + Supertest** — ships with Nest; Supertest for e2e against a real/dockerized test DB.

## Open decisions flagged for review

1. Synchronous vs fire-and-forget trigger response — currently recommending synchronous given small data volumes.
2. Query-time vs materialized canonical status — currently recommending query-time only (no `canonical_status` column).
3. Whether to add a periodic full-sync safety net beyond the assignment's minimum ask.
4. zod vs class-validator standardization for body DTOs.
