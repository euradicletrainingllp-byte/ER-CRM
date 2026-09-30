# EuRadicle CRM — Activity & Audit Log Tracker
**Implementation Plan** · 28 Sep 2026 · Status: Proposed

---

## 1. Goal

Record **every user action** in the CRM in one central log that can be pulled into Excel at any time:

- **Auth / Auth Guard:** logins (interactive + silent SSO), session resumes, failed logins, domain-blocked users, page-access denials, **logouts**, session end
- **CRUD:** Create / Read / Update / Delete on BD Tracker, Engagement Calendar, Ops Checklist, Content Dev Tracker, Solution Tracker — with **before → after values** for updates
- **Admin:** permission changes made in the Admin Panel
- **System:** bulk syncs (EC → Ops / CDT), S.No renumbering cascades, Excel exports

Output: an Excel workbook with raw log + ready summaries (e.g. *logins / logouts / creates / updates / deletes per user per day*).

---

## 2. How the CRM works today (relevant findings from the codebase)

| Area | Current implementation | Why it matters for logging |
|---|---|---|
| Hosting | Vite + React SPA on **Vercel** | No backend server today → logger runs in the browser |
| Auth | MSAL (`@azure/msal-react`), `AuthGuard.jsx`, silent SSO, domain allow-list in `authConfig.js` | MSAL raises events (`LOGIN_SUCCESS`, `LOGIN_FAILURE`, `SSO_SILENT_SUCCESS`, `LOGOUT_START`…) that can be captured in one place (`App.jsx`) |
| Logout | `instance.logoutRedirect()` in `TopBar.jsx` and `LoginPage.jsx` | Page navigates away instantly → log must be sent with `keepalive` **before** redirect |
| Data | Excel tables on OneDrive, reached through **Power Automate HTTP flows** (one CRUD-router flow per module, switch on `action`) | **Every CRUD call passes through one function — `callFlow()` in `src/services/api.js`** → a single choke point for CRUD logging |
| Old values | `rememberList()` / `peekList()` cache last-loaded rows | Enables before/after diff for updates & deletes without extra network calls |
| Page access | `PermissionRoute` in `App.jsx` → `NoAccessPage` | Log `PAGE_DENIED` here |
| Permissions | `permissionsApi.js` → `savePermissions()` overwrites the whole table | Diff old vs new to log exactly which user/page/right changed |
| Bulk jobs | `syncEngine.js`, `syncWithEC.js`, `renumberBDRows()` | Group child writes under one **CorrelationId** so exports stay readable |

> Note: the project doc `crm-architecture.md` still describes SharePoint Lists + Graph API + Azure Static Web Apps. The live build uses Excel + Power Automate + Vercel. The doc should be refreshed separately.

---

## 3. Architecture

```
 Browser (React)                                   Microsoft 365
┌──────────────────────────────┐                 ┌───────────────────────────────┐
│ MSAL events ─┐               │                 │  PA flow: "CRM Audit Log"     │
│ AuthGuard ───┤               │  POST (batch)   │   action=append → Create item │
│ callFlow() ──┼─► auditLogger ├────────────────►│   action=query  → Get items   │
│ Permissions ─┤   (queue +    │                 │            │                  │
│ Sync engine ─┘    outbox)    │◄────────────────┤            ▼                  │
│                              │   query rows    │  SharePoint List: CRM_AuditLog │
│ /activity-log page ─► Export │                 │            │                  │
│   (.xlsx via exceljs)        │                 │            ▼                  │
└──────────────────────────────┘                 │  Excel (Power Query refresh)  │
                                                 └───────────────────────────────┘
```

### Storage decision

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. SharePoint List `CRM_AuditLog`** | Handles millions of rows, indexed filters, native *Export to Excel*, Excel **Power Query** live refresh, ₹0 on M365 | New list to create | **Recommended** |
| B. Excel table on OneDrive (same as other trackers) | Familiar | Excel connector throttles (~100 calls/min), slows badly past ~50k rows, file locks when open | Only as a stop-gap |
| C. Vercel serverless API + Postgres (e.g. Supabase) | Tamper-proof identity (server verifies Microsoft token), fastest queries, captures IP | New stack + a small monthly cost at scale | Phase 4 hardening option |

Volume estimate: 10 users × ~150 events/day ≈ 1,500 rows/day ≈ **~0.5 million rows/year** → too large for an Excel table as the store, comfortable for a SharePoint list. Excel is the **reporting layer**, not the database.

---

## 4. Log schema (SharePoint list columns = Excel columns)

| Column | Type | Example | Notes |
|---|---|---|---|
| LogId | Text (unique) | `7f3c…` | UUID created in browser → prevents duplicates on retry |
| TimestampUTC | Date/Time | 2026-09-28T06:41:12Z | **Indexed** |
| TimestampIST | Text | 28-Sep-2026 12:11:12 | Convenience for Excel users |
| UserEmail | Text | revanth.ram@euradicle.com | **Indexed** |
| UserName | Text | Revanth Ram | |
| UserOid | Text | Azure object id | Stable even if email changes |
| SessionId | Text | UUID per login/tab | Links all actions of one session |
| Category | Choice | AUTH / CRUD / ACCESS / ADMIN / SYNC / SYSTEM | **Indexed** |
| Action | Choice | LOGIN, LOGOUT, CREATE, UPDATE… (see §5) | **Indexed** |
| Module | Choice | bd, engagement, ops, content-dev, solution, permissions, auth | **Indexed** |
| RecordId | Text | S.No 42 / EG-1031 / P-207 | |
| RecordLabel | Text | "DBS – Negotiation ++" | Human-readable (client + topic) |
| ChangedFields | Text | Status, Commercials | Comma-separated |
| OldValues | Multi-line | `{"Status":"Proposal"}` | JSON, only changed fields |
| NewValues | Multi-line | `{"Status":"Won"}` | JSON, only changed fields |
| Result | Choice | SUCCESS / FAILED | |
| ErrorMessage | Multi-line | Flow failed (502)… | |
| DurationMs | Number | 1840 | Flow response time — useful for performance tracking too |
| CorrelationId | Text | UUID | Groups sync / renumber / cascade-delete children under the parent action |
| Route | Text | /bd-tracker | Page the action came from |
| Client | Text | Chrome 129 / Windows | Browser + OS |
| AppVersion | Text | git short hash / build date | Which build the user was on |

Never logged: access tokens, ID tokens, flow URLs/signatures.

---

## 5. Event catalogue

### 5.1 Auth & Auth Guard

| Action | Trigger point | File |
|---|---|---|
| `LOGIN` | MSAL `EventType.LOGIN_SUCCESS` (interactive sign-in) | `App.jsx` event callback |
| `LOGIN_SSO` | MSAL `EventType.SSO_SILENT_SUCCESS` (auto sign-in from Outlook/Teams session) | `App.jsx` |
| `SESSION_RESUMED` | App opened with cached account, no login event — logged once per SessionId | `AuthGuard.jsx` |
| `LOGIN_FAILED` | MSAL `LOGIN_FAILURE` / `SSO_SILENT_FAILURE` (error code only) | `App.jsx` |
| `ACCESS_DENIED_DOMAIN` | `isAllowed(email) === false` in Auth Guard — once per session | `AuthGuard.jsx` |
| `TOKEN_FAILURE` | MSAL `ACQUIRE_TOKEN_FAILURE` | `App.jsx` |
| `PAGE_VIEW` | Route change (optional, can be switched off) | `Shell` in `App.jsx` |
| `PAGE_DENIED` | `PermissionRoute` renders `NoAccessPage` | `App.jsx` |
| `LOGOUT` | Logout button — log + flush **before** `logoutRedirect()` | `TopBar.jsx`, `LoginPage.jsx` |
| `SESSION_END` | Tab/browser closed (`pagehide`, keepalive send) — best effort | `auditLogger.js` |

This gives **login count, logout count, sessions per user, session duration** (SESSION_START → LOGOUT/SESSION_END) and **blocked-access attempts**.

### 5.2 CRUD (all 5 modules)

| Action | Source | Detail captured |
|---|---|---|
| `CREATE` | `callFlow(…, {action:'create'})` | NewValues = full row |
| `READ` | `callFlow(…, {action:'get'})` — **network reads only**, not instant-cache displays | Row count returned; one entry per list load, not per row |
| `UPDATE` | `action:'update'` | Old row from `peekList()` cache → ChangedFields + Old/New values of changed fields only |
| `DELETE` | `action:'delete'` | OldValues = full deleted row (recoverable from log) |
| `RENUMBER` | `renumberBDRows()` | Child of the DELETE via CorrelationId, flagged SYSTEM |

### 5.3 Admin, Sync & Export

| Action | Source |
|---|---|
| `PERMISSION_CHANGE` | `savePermissions()` — one row per user × page × right changed (e.g. *BD – Delete: false → true for asha@…*) |
| `PERMISSION_USER_ADDED / REMOVED` | Same diff |
| `BULK_SYNC` | `runEcSync()` — summary row (scope, rows touched, failures) + children via CorrelationId |
| `LOG_EXPORT` | Activity Log page export button (who pulled the audit data, and when) |

---

## 6. Build steps

### Step 1 — SharePoint list (≈1 h)
1. Create list **`CRM_AuditLog`** on the EuRadicle SharePoint site with the columns in §4.
2. **Index** TimestampUTC, UserEmail, Category, Action, Module (required for filtering beyond SharePoint's 5,000-item view threshold).
3. List permissions: **Admins only** (break inheritance). Regular users never read the list directly; the flow writes on their behalf.

### Step 2 — Power Automate flow "CRM Audit Log" (≈2 h)
- Trigger: *When an HTTP request is received*, body `{ action, events: [ … ] }` or `{ action:'query', from, to, user, module }`.
- **Switch on `action`:**
  - `append` → **Response 202 first** (UI never waits) → *Apply to each* event (concurrency 20) → SharePoint *Create item*.
  - `query` → *Get items* with OData filter on TimestampUTC / UserEmail / Module, pagination ON (limit 100,000) → *Response* 200 with JSON array.
- Add the URL to `src/config/powerAutomate.js` as `AUDIT_LOG`.

### Step 3 — `src/services/auditLogger.js` (new, ≈3 h)
Responsibilities:
- `setAuditUser(account)` — email, name, oid from MSAL account
- `sessionId` — UUID kept in `sessionStorage` per tab session
- `logEvent({category, action, module, recordId, …})` — adds LogId, timestamps, route, browser, app version → pushes to queue
- **Batching:** flush every 5 s or at 20 events
- **Outbox:** failed batches saved in `localStorage` and retried on next flush/app load → nothing lost when a flow times out (502s already seen in this project)
- `flush({ keepalive: true })` — used by logout and `pagehide`
- Logging is **fire-and-forget**: a logging failure never breaks or slows a CRUD action

Core sketch:
```js
// src/services/auditLogger.js
import FLOW_URLS from '../config/powerAutomate.js';

const OUTBOX_KEY = 'ercrm.audit.outbox.v1';
let user = {}; let queue = []; let timer = null;

export const sessionId = (() => {
  try {
    let id = sessionStorage.getItem('ercrm.sid');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('ercrm.sid', id); }
    return id;
  } catch { return crypto.randomUUID(); }
})();

export function setAuditUser(acc) {
  user = { email: (acc?.username || '').toLowerCase(), name: acc?.name || '',
           oid: acc?.idTokenClaims?.oid || '' };
}

export function logEvent(e) {
  const now = new Date();
  queue.push({
    LogId: crypto.randomUUID(),
    TimestampUTC: now.toISOString(),
    TimestampIST: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    UserEmail: user.email, UserName: user.name, UserOid: user.oid,
    SessionId: sessionId, Route: location.pathname,
    Client: navigator.userAgent, AppVersion: import.meta.env.VITE_APP_VERSION || '',
    Result: 'SUCCESS', ...e,
    OldValues: e.OldValues ? JSON.stringify(e.OldValues) : '',
    NewValues: e.NewValues ? JSON.stringify(e.NewValues) : '',
  });
  if (queue.length >= 20) flush(); else if (!timer) timer = setTimeout(flush, 5000);
}

export async function flush({ keepalive = false } = {}) {
  clearTimeout(timer); timer = null;
  const outbox = readOutbox();
  const events = [...outbox, ...queue]; queue = [];
  if (!events.length || !FLOW_URLS.AUDIT_LOG) return;
  try {
    const res = await fetch(FLOW_URLS.AUDIT_LOG, {
      method: 'POST', keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'append', events }),
    });
    if (!res.ok) throw new Error(res.status);
    writeOutbox([]);
  } catch { writeOutbox(events.slice(-2000)); }   // keep last 2,000 for retry
}

function readOutbox()  { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } }
function writeOutbox(v){ try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(v)); } catch {} }

addEventListener('pagehide', () => { logEvent({ Category:'AUTH', Action:'SESSION_END', Module:'auth' }); flush({ keepalive: true }); });
```

### Step 4 — Auth hooks (≈2 h)
- **`App.jsx`** — extend the existing `msalInstance.addEventCallback`:
  - `LOGIN_SUCCESS` → `setAuditUser` + `LOGIN`
  - `SSO_SILENT_SUCCESS` → `LOGIN_SSO`
  - `LOGIN_FAILURE`, `SSO_SILENT_FAILURE`, `ACQUIRE_TOKEN_FAILURE` → failure events (error code only)
- **`AuthGuard.jsx`** — once per SessionId: `SESSION_RESUMED` when a cached account is restored; `ACCESS_DENIED_DOMAIN` when `isAllowed()` fails.
- **`PermissionRoute`** — `PAGE_DENIED` with the page key.
- **`TopBar.jsx` / `LoginPage.jsx`** logout:
  ```js
  const handleLogout = async () => {
    logEvent({ Category: 'AUTH', Action: 'LOGOUT', Module: 'auth' });
    await Promise.race([flush({ keepalive: true }), new Promise(r => setTimeout(r, 1500))]);
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };
  ```
- Optional `useEffect` on `location.pathname` in `Shell` → `PAGE_VIEW`.

### Step 5 — CRUD hook in `callFlow()` (≈3 h)
One change covers all five modules:
```js
const MODULE_BY_FLOW = { BD_TRACKER_CRUD:'bd', ENGAGEMENT_CRUD:'engagement',
  OPS_CHECKLIST_CRUD:'ops', CONTENT_DEV_CRUD:'content-dev', SOLUTION_CRUD:'solution' };
const ACTION_MAP = { get:'READ', create:'CREATE', update:'UPDATE', delete:'DELETE' };

async function callFlow(flowKey, body = {}, audit = {}) {
  const t0 = performance.now();
  const Module = MODULE_BY_FLOW[flowKey];
  const Action = ACTION_MAP[body.action];
  const RecordId = body.rowId ?? body.egId ?? body.sno ?? '';
  const before = Action === 'UPDATE' || Action === 'DELETE' ? findCachedRow(Module, RecordId) : null;
  try {
    const result = await rawCallFlow(flowKey, body);          // existing logic, renamed
    if (Module && Action) logEvent({
      Category: 'CRUD', Action, Module, RecordId,
      ...buildDiff(Action, before, body, result),            // ChangedFields / Old / New / row count
      DurationMs: Math.round(performance.now() - t0),
      CorrelationId: audit.correlationId || '',
    });
    return result;
  } catch (err) {
    if (Module && Action) logEvent({ Category:'CRUD', Action, Module, RecordId,
      Result:'FAILED', ErrorMessage: String(err.message).slice(0, 500),
      DurationMs: Math.round(performance.now() - t0) });
    throw err;
  }
}
```
- `findCachedRow()` uses the existing `peekList()` / engagement caches to get the row before the change.
- `buildDiff()` compares only fields present in the payload → logs just what changed.
- `renumberBDRows()` and cascade deletes pass `{ correlationId }` of the parent delete and `Category: 'SYSTEM'`.

### Step 6 — Admin & Sync hooks (≈1.5 h)
- `PermissionsContext.jsx` → before `savePermissions(newPerms)`, diff against current `perms` → one `PERMISSION_CHANGE` row per changed right.
- `syncEngine.js runEcSync()` → create a CorrelationId, log `BULK_SYNC` start/finish summary, pass the id to each child update.

### Step 7 — Activity Log page + Excel export (≈5 h)
- Route **`/activity-log`** (admin only, same check as `/admin`) + Sidebar link.
- Filters: date range, user, module, category, action, result.
- KPI tiles: Logins · Logouts · Active users · Creates · Updates · Deletes · Failed actions.
- Table with expandable Old → New values.
- **Export to Excel** button (`exceljs`, lazy-loaded so the main bundle stays small) producing:

| Sheet | Content |
|---|---|
| **Raw Log** | Every event, all columns, filters + frozen header |
| **User Summary** | Per user: Logins, SSO logins, Logouts, Sessions, Creates, Reads, Updates, Deletes, Failed, Last seen |
| **Daily Activity** | Date × user event counts |
| **Auth Events** | Login / logout / denied / failed only |
| **Change History** | One row per field change: When · Who · Module · Record · Field · Old → New |

- The export itself is logged (`LOG_EXPORT`).

### Step 8 — Live Excel without opening the CRM (≈0.5 h, no code)
In Excel: **Data → Get Data → From Online Services → SharePoint Online List** → select `CRM_AuditLog` → load. Build pivots (logins/logouts per user, CRUD per module). **Refresh All** pulls the latest log any time. Save as `CRM Audit Report.xlsx` alongside the other trackers.

### Step 9 — Test checklist (≈2 h)
- [ ] Interactive login, silent SSO, cached resume → correct action each
- [ ] Non-allowed domain → `ACCESS_DENIED_DOMAIN`
- [ ] Page without rights → `PAGE_DENIED`
- [ ] Logout from TopBar and LoginPage → `LOGOUT` row present
- [ ] Create / update / delete in each of the 5 modules → Old/New correct
- [ ] BD delete with renumber → children share CorrelationId
- [ ] EC sync → one `BULK_SYNC` summary + children
- [ ] Permission change → per-right rows
- [ ] Flow offline (break URL) → events land in outbox → delivered after fix, no duplicates
- [ ] Export → 5 sheets, counts match SharePoint list

---

## 7. Security & integrity

1. **Current limitation:** all Power Automate URLs (including the new audit flow) are visible in the browser bundle. A technically skilled user could call a CRUD flow directly and bypass client-side logging, or post fake log rows.
2. **Mitigation layer 1 (cheap):** add a **server-side log step inside each module's CRUD flow** — every write reaching Excel also appends to `CRM_AuditLog` (`Source = FLOW`), with the user email sent in the payload. Writes are then logged even if the browser logger fails.
3. **Mitigation layer 2 (Phase 4):** a Vercel serverless function `/api/*` that **verifies the Microsoft ID token** and forwards to the flows with URLs kept in Vercel environment variables. Identity becomes tamper-proof, flow URLs leave the bundle, and client IP can be recorded.
4. Log list is admin-only; no tokens or secrets stored; contact numbers appear only in Old/New values visible to admins.
5. **Retention:** keep 24 months in the list; yearly export to an archive workbook and purge older rows via a scheduled flow.

---

## 8. Timeline

| Phase | Scope | Effort |
|---|---|---|
| 1 | SharePoint list + audit flow (Steps 1–2) | ~3 h |
| 2 | Logger + Auth + CRUD + Admin/Sync hooks (Steps 3–6) | ~9.5 h |
| 3 | Activity Log page, Excel export, Power Query report, testing (Steps 7–9) | ~7.5 h |
| 4 (optional) | Server-side flow logging + Vercel token-verifying proxy | ~8 h |
| **Total (1–3)** | | **~20 h / 3 working days** |

## 9. Decisions needed before build
1. Storage: SharePoint list (recommended) vs Excel table stop-gap
2. Log `PAGE_VIEW` and `READ` events? (valuable for usage analytics, ~60% of volume)
3. Who can see the Activity Log — Revanth only, or a named admin group?
4. Include Phase 4 hardening now or later?
