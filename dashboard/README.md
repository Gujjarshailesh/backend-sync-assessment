# Admin Dashboard

A static HTML/CSS/Bootstrap 5/vanilla JS admin dashboard for the sync pipeline and revenue API. No build step, no framework, no bundler.

## Run it

Any static file server works. From this folder:

```bash
npx serve .
# or: python -m http.server 5500
```

Then open the printed URL. Make sure the API (`npm run start:dev` in the project root) is running too — by default the dashboard expects it at `http://localhost:3000` (edit `API_BASE` at the top of `script.js` if yours runs elsewhere).

## What's real vs. what's honestly unavailable

This dashboard calls **only** the endpoints that actually exist on the backend:

| Endpoint | Used for |
|---|---|
| `GET /health` | Health Dashboard |
| `GET /sync/state` | Connected providers, per-source sync state |
| `GET /sync/runs`, `GET /sync/runs/:id` | Sync history, run detail modal |
| `POST /sync/trigger` | Trigger Sync button |
| `GET /metrics/revenue/summary`, `GET /metrics/revenue/breakdown` | Revenue section (summary, chart, breakdown table) |

The backend does **not** expose list endpoints for Google Calendar events, HubSpot contacts/companies/deals, Stripe transactions, or audit logs. Those sections show an explicit notice explaining exactly which endpoint is missing, instead of fake data — see the alerts in the Google Calendar, HubSpot, Stripe, and Audit Logs sections.

## CORS

The backend enables CORS (`app.enableCors()` in `src/main.ts`) specifically so this dashboard can call it from a different origin (a different port, or a local file). If you see network errors in the browser console, confirm the API is actually running and reachable at the configured `API_BASE`.
