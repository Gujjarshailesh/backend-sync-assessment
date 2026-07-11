/* ==========================================================================
   Sync Pipeline & Revenue Dashboard
   Vanilla JS + Bootstrap 5 + Chart.js. Talks ONLY to the real endpoints
   implemented by the NestJS backend:
     GET  /health
     POST /sync/trigger
     GET  /sync/runs
     GET  /sync/runs/:id
     GET  /sync/state
     GET  /metrics/revenue/summary
     GET  /metrics/revenue/breakdown
     GET  /metrics/revenue/status-mapping
     GET  /contacts
     GET  /calendar-events
     GET  /transactions
     GET  /audit-log
   HubSpot Companies/Deals have no backing adapter or table anywhere in the
   system, so that gap is called out with a notice instead of fake data.
   ========================================================================== */

// Live backend URL. The dashboard is served from the same NestJS app/domain
// (see ServeStaticModule in src/app.module.ts), but API_BASE is kept explicit
// rather than relative so this file keeps working if it's ever opened
// directly (file://) or served from elsewhere.
const API_BASE = 'https://backend-sync-assessment.vercel.app';

let revenueChart = null;
let activeSection = 'health';
const refreshTimers = {};

/* ---------------------------- fetch helper ---------------------------- */

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    setConnectionStatus(true);
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = (body && (body.message || body.error)) || `HTTP ${response.status}`;
      const err = new Error(Array.isArray(message) ? message.join(', ') : message);
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (error) {
    if (error instanceof TypeError) {
      // Network-level failure: server down, wrong port, or CORS block.
      setConnectionStatus(false);
      showToast(
        `Could not reach the API at ${API_BASE}. Is the server running, and is CORS enabled if this page isn't served from the same origin?`,
        'danger',
      );
    }
    throw error;
  }
}

function setConnectionStatus(ok) {
  const badge = document.getElementById('apiConnectionBadge');
  if (ok) {
    badge.className = 'badge rounded-pill text-bg-success';
    badge.innerHTML = '<i class="bi bi-check-circle me-1"></i>Connected';
  } else {
    badge.className = 'badge rounded-pill text-bg-danger';
    badge.innerHTML = '<i class="bi bi-x-circle me-1"></i>Unreachable';
  }
}

/* ------------------------------- toasts -------------------------------- */

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const icon = type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-exclamation-octagon-fill' : 'bi-info-circle-fill';
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body"><i class="bi ${icon} me-2"></i>${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  container.appendChild(el);
  const toast = new bootstrap.Toast(el, { delay: 6000 });
  toast.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

/* ------------------------------ formatting ------------------------------ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function formatUptime(seconds) {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatMoney(amountMinorUnits, currency) {
  if (amountMinorUnits == null) return '—';
  const value = amountMinorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(value);
  } catch {
    return `${value.toFixed(2)} ${(currency || '').toUpperCase()}`;
  }
}

const STATUS_BADGE_MAP = {
  success: 'text-bg-success',
  ok: 'text-bg-success',
  processed: 'text-bg-success',
  failed: 'text-bg-danger',
  error: 'text-bg-danger',
  partial_failure: 'text-bg-warning',
  running: 'text-bg-info',
  skipped_duplicate: 'text-bg-secondary',
};

function statusBadge(status) {
  const cls = STATUS_BADGE_MAP[status] || 'text-bg-secondary';
  return `<span class="badge rounded-pill ${cls}">${escapeHtml(status ?? 'unknown')}</span>`;
}

function shortId(id) {
  if (!id) return '—';
  return `<code title="${escapeHtml(id)}">${escapeHtml(id).slice(0, 8)}…</code>`;
}

/* ------------------------------ navigation ------------------------------ */

function setActiveSection(section) {
  document.querySelectorAll('.content-section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.sidebar .nav-link').forEach((el) => el.classList.remove('active'));

  const target = document.getElementById(`section-${section}`);
  const navLink = document.querySelector(`.sidebar .nav-link[data-section="${section}"]`);
  if (target) target.classList.add('active');
  if (navLink) navLink.classList.add('active');

  activeSection = section;
  closeMobileSidebar();
  loadSection(section);
}

function loadSection(section) {
  switch (section) {
    case 'health':
      loadHealth();
      loadProvidersGrid();
      break;
    case 'sync':
      loadSyncSection();
      break;
    case 'calendar':
      loadCalendarSection();
      break;
    case 'hubspot':
      loadHubspotSection();
      break;
    case 'stripe':
      loadStripeSection();
      break;
    case 'revenue':
      // Revenue only loads on explicit "Apply" - date range must be chosen first.
      break;
    case 'audit':
      loadAuditSection();
      break;
    default:
      break;
  }
}

function initNav() {
  document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveSection(link.dataset.section);
    });
  });
  document.querySelectorAll('[data-section-link]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveSection(link.dataset.sectionLink);
    });
  });

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    sidebar.classList.toggle('show');
    backdrop.classList.toggle('show');
  });
  backdrop.addEventListener('click', closeMobileSidebar);

  document.getElementById('globalRefreshBtn').addEventListener('click', () => loadSection(activeSection));
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

/* -------------------------------- health -------------------------------- */

async function loadHealth() {
  const spinner = document.getElementById('health-spinner');
  spinner.classList.remove('d-none');
  try {
    const health = await apiFetch('/health');
    document.getElementById('health-app-status').innerHTML = statusBadge(health.status);
    document.getElementById('health-db-status').innerHTML = statusBadge(health.db);
    document.getElementById('health-env').textContent = health.env ?? '—';
    document.getElementById('health-uptime').textContent = formatUptime(health.uptimeSeconds);
  } catch {
    document.getElementById('health-app-status').innerHTML = statusBadge('error');
    document.getElementById('health-db-status').innerHTML = statusBadge('error');
  } finally {
    spinner.classList.add('d-none');
  }
}

async function loadProvidersGrid() {
  const grid = document.getElementById('providers-grid');
  try {
    const state = await apiFetch('/sync/state');
    if (!Array.isArray(state) || state.length === 0) {
      grid.innerHTML = '<div class="col-12 text-muted">No providers have synced yet.</div>';
      return;
    }
    grid.innerHTML = state
      .map(
        (s) => `
      <div class="col-sm-6 col-lg-3">
        <div class="provider-chip">
          <div class="d-flex justify-content-between align-items-start">
            <span class="provider-name">${escapeHtml(s.source.replace('_', ' '))}</span>
            ${statusBadge(s.lastStatus || 'unknown')}
          </div>
          <div class="small text-muted mt-2">Cursor type: ${escapeHtml(s.cursorType ?? '—')}</div>
          <div class="small text-muted">Last full sync: ${formatDateTime(s.lastFullSyncAt)}</div>
        </div>
      </div>`,
      )
      .join('');
  } catch {
    grid.innerHTML = '<div class="col-12 text-danger">Could not load provider state.</div>';
  }
}

/* ------------------------------ synchronization ------------------------------ */

async function loadSyncSection() {
  await Promise.all([loadSyncState(), loadSyncHistory()]);
}

async function loadSyncState() {
  const tbody = document.querySelector('#sync-state-table tbody');
  try {
    const state = await apiFetch('/sync/state');
    if (!Array.isArray(state) || state.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No sources have synced yet.</td></tr>';
      return;
    }
    tbody.innerHTML = state
      .map(
        (s) => `
      <tr>
        <td><strong>${escapeHtml(s.source)}</strong></td>
        <td>${escapeHtml(s.cursorType ?? '—')}</td>
        <td>${formatDateTime(s.lastFullSyncAt)}</td>
        <td>${formatDateTime(s.lastIncrementalSyncAt)}</td>
        <td>${statusBadge(s.lastStatus || 'unknown')}</td>
      </tr>`,
      )
      .join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load sync state.</td></tr>';
  }
}

async function loadSyncHistory() {
  const tbody = document.querySelector('#sync-history-table tbody');
  try {
    const runs = await apiFetch('/sync/runs?limit=20');
    if (!Array.isArray(runs) || runs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No sync runs yet - trigger one above.</td></tr>';
      updateLatestSyncCards(null);
      return;
    }
    tbody.innerHTML = runs
      .map(
        (run) => `
      <tr class="clickable-row" onclick="showRunDetail('${run.id}')">
        <td>${formatDateTime(run.startedAt)}</td>
        <td><span class="badge text-bg-light border">${escapeHtml(run.triggerType)}</span></td>
        <td>${statusBadge(run.status)}</td>
        <td>${(run.sources || []).length}</td>
        <td class="text-end"><i class="bi bi-chevron-right text-muted"></i></td>
      </tr>`,
      )
      .join('');
    updateLatestSyncCards(runs[0]);
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-3">Failed to load sync history.</td></tr>';
  }
}

function updateLatestSyncCards(latestRun) {
  const statusEl = document.getElementById('latest-sync-status');
  const summaryBody = document.querySelector('#latest-sync-summary-table tbody');

  if (!latestRun) {
    statusEl.innerHTML = '<span class="text-muted">No sync runs yet.</span>';
    summaryBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>';
    return;
  }

  statusEl.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2">${statusBadge(latestRun.status)} <span class="text-muted small">${shortId(latestRun.id)}</span></div>
    <div class="small text-muted">Started: ${formatDateTime(latestRun.startedAt)}</div>
    <div class="small text-muted">Finished: ${formatDateTime(latestRun.finishedAt)}</div>
    <div class="small text-muted">Trigger: ${escapeHtml(latestRun.triggerType)}</div>
  `;

  const sources = latestRun.sources || [];
  summaryBody.innerHTML = sources.length
    ? sources
        .map(
          (s) => `
        <tr>
          <td><strong>${escapeHtml(s.source)}</strong></td>
          <td>${escapeHtml(s.mode ?? '—')}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${s.recordsFetched ?? 0}</td>
          <td>${s.recordsUpserted ?? 0}</td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>';
}

async function showRunDetail(runId) {
  const modalEl = document.getElementById('runDetailModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  const body = document.getElementById('runDetailBody');
  body.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</span>';
  modal.show();

  try {
    const run = await apiFetch(`/sync/runs/${runId}`);
    const sourcesRows = (run.sources || [])
      .map(
        (s) => `
        <tr>
          <td>${escapeHtml(s.source)}</td>
          <td>${escapeHtml(s.mode ?? '—')}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${s.recordsFetched ?? 0}</td>
          <td>${s.recordsUpserted ?? 0}</td>
          <td class="text-danger small">${escapeHtml(s.errorMessage ?? '')}</td>
        </tr>`,
      )
      .join('');

    body.innerHTML = `
      <div class="mb-3">
        <div><strong>Run ID:</strong> <code>${escapeHtml(run.id)}</code></div>
        <div><strong>Status:</strong> ${statusBadge(run.status)}</div>
        <div><strong>Trigger:</strong> ${escapeHtml(run.triggerType)}</div>
        <div><strong>Started:</strong> ${formatDateTime(run.startedAt)}</div>
        <div><strong>Finished:</strong> ${formatDateTime(run.finishedAt)}</div>
      </div>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Source</th><th>Mode</th><th>Status</th><th>Fetched</th><th>Upserted</th><th>Error</th></tr></thead>
          <tbody>${sourcesRows || '<tr><td colspan="6" class="text-center text-muted">No sources recorded</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (error) {
    body.innerHTML = `<div class="alert alert-danger mb-0">Failed to load run details: ${escapeHtml(error.message)}</div>`;
  }
}

async function handleTriggerSubmit(event) {
  event.preventDefault();
  const source = document.getElementById('triggerSource').value;
  const mode = document.getElementById('triggerMode').value;
  const btn = document.getElementById('triggerBtn');
  const spinner = document.getElementById('trigger-spinner');

  btn.disabled = true;
  spinner.classList.remove('d-none');

  try {
    const payload = { mode };
    if (source) payload.source = source;
    const result = await apiFetch('/sync/trigger', { method: 'POST', body: JSON.stringify(payload) });

    showToast(`Sync run ${result.status === 'success' ? 'completed successfully' : `finished with status "${result.status}"`}.`, result.status === 'success' ? 'success' : result.status === 'partial_failure' ? 'danger' : 'success');

    const summaryHtml = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <strong>Run:</strong> ${shortId(result.syncRunId)} ${statusBadge(result.status)}
      </div>
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th>Source</th><th>Mode</th><th>Status</th><th>Fetched</th><th>Created</th><th>Updated</th></tr></thead>
          <tbody>
            ${(result.sources || [])
              .map(
                (s) => `<tr><td>${escapeHtml(s.source)}</td><td>${escapeHtml(s.mode ?? '—')}</td><td>${statusBadge(s.status)}</td><td>${s.recordsFetched ?? 0}</td><td>${s.created ?? 0}</td><td>${s.updated ?? 0}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('syncResultSummary').innerHTML = summaryHtml;
    document.getElementById('syncResultJson').textContent = JSON.stringify(result, null, 2);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('syncResultModal')).show();

    loadSyncSection();
    if (activeSection === 'health') loadProvidersGrid();
  } catch (error) {
    showToast(`Trigger failed: ${error.message}`, 'danger');
    document.getElementById('syncResultSummary').innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message)}</div>`;
    document.getElementById('syncResultJson').textContent = error.body ? JSON.stringify(error.body, null, 2) : '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('syncResultModal')).show();
  } finally {
    btn.disabled = false;
    spinner.classList.add('d-none');
  }
}

/* ---------------- provider state cards (Calendar/HubSpot/Stripe) ---------------- */

async function loadProviderStateCard(source, containerId) {
  const container = document.getElementById(containerId);
  try {
    const state = await apiFetch('/sync/state');
    const entry = (state || []).find((s) => s.source === source);
    if (!entry) {
      container.innerHTML = `<span class="text-muted">No sync state recorded yet for <code>${escapeHtml(source)}</code> - trigger a sync from the Synchronization tab.</span>`;
      return;
    }
    container.innerHTML = `
      <div class="row g-3">
        <div class="col-sm-6 col-md-3"><div class="small text-muted">Last status</div>${statusBadge(entry.lastStatus || 'unknown')}</div>
        <div class="col-sm-6 col-md-3"><div class="small text-muted">Cursor type</div><div>${escapeHtml(entry.cursorType ?? '—')}</div></div>
        <div class="col-sm-6 col-md-3"><div class="small text-muted">Last full sync</div><div>${formatDateTime(entry.lastFullSyncAt)}</div></div>
        <div class="col-sm-6 col-md-3"><div class="small text-muted">Last incremental sync</div><div>${formatDateTime(entry.lastIncrementalSyncAt)}</div></div>
      </div>`;
  } catch (error) {
    container.innerHTML = `<div class="text-danger">Failed to load sync state: ${escapeHtml(error.message)}</div>`;
  }
}

/* ---------------- shared record-detail modal ---------------- */

function showRecordDetail(title, record) {
  document.getElementById('recordDetailTitle').innerHTML = `<i class="bi bi-card-list me-2"></i>${escapeHtml(title)}`;
  document.getElementById('recordDetailJson').textContent = JSON.stringify(record, null, 2);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('recordDetailModal')).show();
}

let calendarEventsCache = [];
let hubspotContactsCache = [];
let stripeTransactionsCache = [];
let stripeStatusMappingCache = [];

/* ------------------------------ google calendar ------------------------------ */

async function loadCalendarSection() {
  await Promise.all([
    loadProviderStateCard('google_calendar', 'calendar-state-card'),
    loadCalendarEvents(),
  ]);
}

async function loadCalendarEvents() {
  const tbody = document.querySelector('#calendar-events-table tbody');
  try {
    const events = await apiFetch('/calendar-events?limit=100');
    calendarEventsCache = Array.isArray(events) ? events : [];
    if (!calendarEventsCache.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No calendar events yet - trigger a sync from the Synchronization tab.</td></tr>';
      return;
    }
    tbody.innerHTML = calendarEventsCache
      .map(
        (e, i) => `
      <tr class="clickable-row" onclick="showRecordDetail('Calendar Event', calendarEventsCache[${i}])">
        <td>${escapeHtml(e.title ?? '—')}</td>
        <td>${formatDateTime(e.startTime)}</td>
        <td>${formatDateTime(e.endTime)}</td>
        <td>${statusBadge(e.status || 'unknown')}</td>
        <td class="text-muted small">${escapeHtml(e.calendarId ?? '—')}</td>
      </tr>`,
      )
      .join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3">Failed to load calendar events: ${escapeHtml(error.message)}</td></tr>`;
  }
}

/* ---------------------------------- hubspot ---------------------------------- */

async function loadHubspotSection() {
  await Promise.all([
    loadProviderStateCard('hubspot', 'hubspot-state-card'),
    loadHubspotContacts(),
  ]);
}

async function loadHubspotContacts() {
  const tbody = document.querySelector('#hubspot-contacts-table tbody');
  try {
    const contacts = await apiFetch('/contacts?limit=100');
    hubspotContactsCache = Array.isArray(contacts) ? contacts : [];
    if (!hubspotContactsCache.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No contacts yet - trigger a sync from the Synchronization tab.</td></tr>';
      return;
    }
    tbody.innerHTML = hubspotContactsCache
      .map(
        (c, i) => `
      <tr class="clickable-row" onclick="showRecordDetail('HubSpot Contact', hubspotContactsCache[${i}])">
        <td>${escapeHtml([c.firstName, c.lastName].filter(Boolean).join(' ') || '—')}</td>
        <td>${escapeHtml(c.email ?? '—')}</td>
        <td>${escapeHtml(c.phone ?? '—')}</td>
        <td>${escapeHtml(c.lifecycleStage ?? '—')}</td>
        <td>${formatDateTime(c.sourceUpdatedAt)}</td>
      </tr>`,
      )
      .join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3">Failed to load contacts: ${escapeHtml(error.message)}</td></tr>`;
  }
}

/* ---------------------------------- stripe ---------------------------------- */

async function loadStripeSection() {
  await Promise.all([
    loadProviderStateCard('stripe', 'stripe-state-card'),
    loadStripeTransactions(),
  ]);
}

async function loadStripeTransactions() {
  const tbody = document.querySelector('#stripe-transactions-table tbody');
  try {
    const [transactions, mappings] = await Promise.all([
      apiFetch('/transactions?limit=100'),
      apiFetch('/metrics/revenue/status-mapping'),
    ]);
    stripeTransactionsCache = Array.isArray(transactions) ? transactions : [];
    stripeStatusMappingCache = Array.isArray(mappings) ? mappings : [];
    if (!stripeTransactionsCache.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No transactions yet - trigger a sync from the Synchronization tab.</td></tr>';
      return;
    }
    tbody.innerHTML = stripeTransactionsCache
      .map((t, i) => {
        const mapping = stripeStatusMappingCache.find((m) => m.source === t.source && m.rawStatus === t.rawStatus);
        const collected = mapping?.canonicalStatus === 'collected';
        return `
      <tr class="clickable-row" onclick="showRecordDetail('Stripe Transaction', stripeTransactionsCache[${i}])">
        <td>${formatDateTime(t.occurredAt)}</td>
        <td>${formatMoney(t.amount, t.currency)}</td>
        <td><span class="badge text-bg-light border">${escapeHtml(t.rawStatus)}</span></td>
        <td><span class="badge rounded-pill ${collected ? 'text-bg-success' : 'text-bg-secondary'}">${collected ? 'Collected' : 'Not collected'}</span></td>
      </tr>`;
      })
      .join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-3">Failed to load transactions: ${escapeHtml(error.message)}</td></tr>`;
  }
}

/* -------------------------------- audit logs -------------------------------- */

let auditLogCache = [];

async function loadAuditSection() {
  const tbody = document.querySelector('#audit-log-table tbody');
  try {
    const entries = await apiFetch('/audit-log?limit=100');
    auditLogCache = Array.isArray(entries) ? entries : [];
    if (!auditLogCache.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No audit entries yet - trigger a sync from the Synchronization tab.</td></tr>';
      return;
    }
    tbody.innerHTML = auditLogCache
      .map(
        (a, i) => `
      <tr class="clickable-row" onclick="showRecordDetail('Audit Log Entry', auditLogCache[${i}])">
        <td>${formatDateTime(a.createdAt)}</td>
        <td>${escapeHtml(a.entityType ?? '—')}</td>
        <td>${escapeHtml(a.source ?? '—')}</td>
        <td><span class="badge text-bg-light border">${escapeHtml(a.action)}</span></td>
        <td class="text-muted small">${escapeHtml(a.externalId ?? '—')}</td>
      </tr>`,
      )
      .join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3">Failed to load audit log: ${escapeHtml(error.message)}</td></tr>`;
  }
}

/* -------------------------------- revenue -------------------------------- */

async function handleRevenueSubmit(event) {
  event.preventDefault();
  const from = document.getElementById('revenueFrom').value;
  const to = document.getElementById('revenueTo').value;
  const granularity = document.getElementById('revenueGranularity').value;
  const spinner = document.getElementById('revenue-spinner');

  if (!from || !to) {
    showToast('Please choose both a "from" and "to" date.', 'danger');
    return;
  }

  spinner.classList.remove('d-none');
  try {
    const [summary, breakdown] = await Promise.all([
      apiFetch(`/metrics/revenue/summary?from=${from}&to=${to}`),
      apiFetch(`/metrics/revenue/breakdown?from=${from}&to=${to}&granularity=${granularity}`),
    ]);

    document.getElementById('revenue-total').textContent = formatMoney(summary.totalCollected, summary.currency);
    document.getElementById('revenue-currency').textContent = (summary.currency || '—').toUpperCase();
    document.getElementById('revenue-bucket-count').textContent = (breakdown.buckets || []).length;

    renderRevenueChart(breakdown.buckets || [], breakdown.granularity);
    renderRevenueTable(breakdown.buckets || [], summary.currency);

    showToast('Revenue data loaded.', 'success');
  } catch (error) {
    showToast(`Failed to load revenue data: ${error.message}`, 'danger');
  } finally {
    spinner.classList.add('d-none');
  }
}

function renderRevenueChart(buckets, granularity) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  const labels = buckets.map((b) => formatDate(b.periodStart));
  const data = buckets.map((b) => (b.totalCollected || 0) / 100);

  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `Collected revenue per ${granularity || 'period'}`,
          data,
          backgroundColor: '#2563eb',
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `$${v}` } },
      },
    },
  });
}

function renderRevenueTable(buckets, currency) {
  const tbody = document.querySelector('#revenue-breakdown-table tbody');
  if (!buckets.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No revenue in this range.</td></tr>';
    return;
  }
  tbody.innerHTML = buckets
    .map(
      (b) => `
    <tr>
      <td>${formatDate(b.periodStart)}</td>
      <td>${formatDate(b.periodEnd)}</td>
      <td>${formatMoney(b.totalCollected, currency)}</td>
    </tr>`,
    )
    .join('');
}

function setDefaultRevenueDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  document.getElementById('revenueFrom').value = from.toISOString().slice(0, 10);
  document.getElementById('revenueTo').value = to.toISOString().slice(0, 10);
}

/* ------------------------------- auto refresh ------------------------------- */

function startAutoRefresh() {
  refreshTimers.health = setInterval(() => {
    if (activeSection === 'health') {
      loadHealth();
      loadProvidersGrid();
    }
  }, 15000);

  refreshTimers.sync = setInterval(() => {
    if (activeSection === 'sync') loadSyncSection();
  }, 30000);
}

/* --------------------------------- init --------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('apiBaseLabel').textContent = API_BASE;
  initNav();
  document.getElementById('triggerForm').addEventListener('submit', handleTriggerSubmit);
  document.getElementById('revenueForm').addEventListener('submit', handleRevenueSubmit);
  setDefaultRevenueDates();

  setActiveSection('health');
  startAutoRefresh();
});
