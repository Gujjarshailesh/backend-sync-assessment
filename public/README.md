# Admin Dashboard

A static HTML/CSS/Bootstrap 5/vanilla JS admin dashboard for the sync pipeline and revenue API. No build step, no framework, no bundler.

## How it's served

These files are served directly by the NestJS app via `ServeStaticModule` (see `src/app.module.ts`) from this `public/` directory, on the same domain as the API:

- Dashboard: `https://backend-sync-assessment.vercel.app/`
- API: `https://backend-sync-assessment.vercel.app/health`, `/sync/...`, `/metrics/...`, etc.

`API_BASE` at the top of `script.js` points at that same live URL. Change it if you deploy elsewhere.

## What's real vs. what's honestly unavailable

This dashboard calls **only** endpoints that actually exist on the backend:

| Endpoint | Used for |
|---|---|
| `GET /health` | Health Dashboard |
| `GET /sync/state` | Connected providers, per-source sync state |
| `GET /sync/runs`, `GET /sync/runs/:id` | Sync history, run detail modal |
| `POST /sync/trigger` | Trigger Sync button |
| `GET /metrics/revenue/summary`, `GET /metrics/revenue/breakdown` | Revenue section (summary, chart, breakdown table) |
| `GET /metrics/revenue/status-mapping` | Resolving each Stripe transaction's "Collected?" badge |
| `GET /calendar-events` | Google Calendar section (event list + detail modal) |
| `GET /contacts` | HubSpot section (contact list + detail modal) |
| `GET /transactions` | Stripe section (transaction list + detail modal) |
| `GET /audit-log` | Audit Logs section (entry list + detail modal) |

The backend has **no** adapter or table for HubSpot Companies or Deals at all — that section shows an explicit notice about this gap instead of fake data. Everything else shown is live data fetched from the database.

## CORS

The backend enables CORS (`app.enableCors()` in `src/main.ts`). Since the dashboard is now served from the same origin as the API, CORS is no longer required for it to work, but it's left on since it's harmless for a read-mostly, no-auth API.
