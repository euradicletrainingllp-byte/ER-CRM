/**
 * EURADICLE CRM — ACTIVITY LOG (audit trail)
 * ============================================
 * Records who did what, and when, into the SharePoint list "CRM ACTIVITY LOG"
 * through the Power Automate flow "CRM Activity Log" (URL: FLOW_URLS.AUDIT_LOG).
 *
 * Design rules
 *  - Logging NEVER blocks or breaks the CRM: every call is fire-and-forget and
 *    every error is swallowed.
 *  - Events are batched (every 5 s or 20 events) and kept in browser storage
 *    ("outbox") until the flow confirms them, so a flow timeout or a closed tab
 *    does not lose them. LogId is unique in the list, so a retry can never
 *    create a duplicate row.
 *  - If AUDIT_LOG is empty the logger does nothing.
 */
import FLOW_URLS from '../config/powerAutomate.js';

// ── Switches ─────────────────────────────────────────────────────────────────
export const AUDIT_OPTIONS = {
  logReads:     true,   // one READ row each time a tracker is loaded from Excel
  logPageViews: true,   // one PAGE_VIEW row each time a page is opened
};

const OUTBOX_KEY   = 'ercrm.audit.outbox.v1';
const SESSION_KEY  = 'ercrm.audit.session.v1';
const OUTBOX_MAX   = 2000;       // keep at most this many unsent events
const BATCH_MAX    = 50;         // events per request
const FLUSH_MS     = 5000;
const RETRY_MS     = 30000;
const TEXT_MAX     = 255;        // SharePoint "Single line of text" limit
const NOTE_MAX     = 60000;      // SharePoint "Multiple lines of text" limit (63,999)

const NOTE_FIELDS = new Set(['ChangedFields', 'OldValues', 'NewValues', 'ErrorMessage', 'Client']);

// ── Helpers ──────────────────────────────────────────────────────────────────
function uuid() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* old browser */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function toText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function istStamp(d) {
  try {
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '');
  } catch { return ''; }
}

function readOutbox() {
  try { const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeOutbox(list) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX))); } catch { /* storage full / blocked */ }
}

// ── Session (one per browser tab; survives a page refresh) ───────────────────
export const sessionId = (() => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = uuid(); sessionStorage.setItem(SESSION_KEY, id); }
    return id;
  } catch { return uuid(); }
})();

/** True the first time it is called for a given key in this tab session. */
export function firstTimeThisSession(key) {
  try {
    const k = `ercrm.audit.once.${key}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
    return true;
  } catch { return true; }
}

// ── Current user ─────────────────────────────────────────────────────────────
let user = { email: '', name: '', oid: '' };

export function setAuditUser(account) {
  try {
    if (!account) return;
    const email = (
      account.username || account.idTokenClaims?.email ||
      account.idTokenClaims?.preferred_username || ''
    ).toLowerCase().trim();
    user = {
      email,
      name: account.name || email.split('@')[0] || '',
      oid:  account.idTokenClaims?.oid || account.localAccountId || '',
    };
  } catch { /* ignore */ }
}
export function getAuditUser() { return user; }

// ── Context (groups child writes of a sync / renumber under one CorrelationId)
let context = null;

/** Run `fn` with extra fields ({ CorrelationId, Action, Category }) applied to CRUD events inside it. */
export async function withAuditContext(extra, fn) {
  const prev = context;
  context = { CorrelationId: uuid(), ...extra };
  try { return await fn(context); }
  finally { context = prev; }
}
export const newCorrelationId = uuid;

// ── Queue ────────────────────────────────────────────────────────────────────
let queue   = [];
let timer   = null;
let sending = false;
let loggedOut = false;

function schedule(ms) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, ms);
}

/**
 * Record one event. Only Category and Action are required.
 * Example: logEvent({ Category: 'AUTH', Action: 'LOGOUT', Module: 'auth' })
 */
export function logEvent(e = {}) {
  try {
    if (!FLOW_URLS.AUDIT_LOG) return;
    const now = new Date();
    const ev = { ...e };
    if (context) {
      if (!ev.CorrelationId) ev.CorrelationId = context.CorrelationId;
      if (ev.Category === 'CRUD' && ev.Action !== 'READ') {
        if (context.Action)   ev.Action   = context.Action;
        if (context.Category) ev.Category = context.Category;
      }
    }
    if (ev.Action === 'LOGOUT') loggedOut = true;

    const row = {
      LogId:         uuid(),
      TimestampUTC:  now.toISOString(),
      TimestampIST:  istStamp(now),
      UserEmail:     user.email,
      UserName:      user.name,
      UserOid:       user.oid,
      SessionId:     sessionId,
      Category:      'SYSTEM',
      Action:        '',
      Module:        '',
      RecordId:      '',
      RecordLabel:   '',
      ChangedFields: '',
      OldValues:     '',
      NewValues:     '',
      Result:        'SUCCESS',
      ErrorMessage:  '',
      DurationMs:    0,
      CorrelationId: '',
      Route:         (typeof location !== 'undefined' ? location.pathname : ''),
      Client:        (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      AppVersion:    (import.meta.env?.VITE_APP_VERSION || ''),
      Source:        'APP',
      ...ev,
    };
    // Every field as text (except DurationMs), trimmed to what SharePoint accepts
    for (const k of Object.keys(row)) {
      if (k === 'DurationMs') { row[k] = Math.max(0, Math.round(Number(row[k]) || 0)); continue; }
      const s = toText(row[k]);
      row[k] = s.length > (NOTE_FIELDS.has(k) ? NOTE_MAX : TEXT_MAX)
        ? s.slice(0, (NOTE_FIELDS.has(k) ? NOTE_MAX : TEXT_MAX) - 1) + '…'
        : s;
    }
    queue.push(row);
    if (queue.length >= 20) flush(); else schedule(FLUSH_MS);
  } catch { /* never break the app */ }
}

/**
 * Send queued events. `keepalive` lets the request finish while the page
 * unloads (logout / tab close). Unconfirmed events stay in the outbox and are
 * re-sent later; LogId uniqueness prevents duplicates.
 */
export async function flush({ keepalive = false } = {}) {
  try {
    if (timer) { clearTimeout(timer); timer = null; }
    const url = FLOW_URLS.AUDIT_LOG;
    if (!url) { queue = []; return; }
    if (queue.length) { writeOutbox([...readOutbox(), ...queue]); queue = []; }
    if (sending && !keepalive) return;

    const batch = readOutbox().slice(0, BATCH_MAX);
    if (!batch.length) return;

    const body = JSON.stringify({ action: 'append', events: batch });
    // Browsers cap keepalive bodies at 64 KB
    const useKeepalive = keepalive && body.length < 60000;

    sending = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useKeepalive,
      });
      if (!res.ok) throw new Error(`Activity log flow returned ${res.status}`);
      const sent = new Set(batch.map(e => e.LogId));
      const rest = readOutbox().filter(e => !sent.has(e.LogId));
      writeOutbox(rest);
      if (rest.length && !keepalive) schedule(1000);
    } catch {
      if (!keepalive) schedule(RETRY_MS);
    } finally {
      sending = false;
    }
  } catch { /* never break the app */ }
}

/** Flush, but never wait longer than `ms` (used right before logout redirect). */
export function flushSoon(ms = 1500) {
  return Promise.race([flush({ keepalive: true }), new Promise(r => setTimeout(r, ms))]);
}

// ── Page lifecycle ───────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  // Tab closed / reloaded / navigated away
  window.addEventListener('pagehide', () => {
    if (user.email && !loggedOut) {
      logEvent({ Category: 'AUTH', Action: 'SESSION_END', Module: 'auth' });
    }
    flush({ keepalive: true });
  });
  // Deliver anything left over from a previous visit
  if (readOutbox().length) schedule(3000);
}

// ── Diff helpers (used by api.js and the permissions context) ────────────────
/** Normalise a column name so 'Start Date ', 'Start_Date' and 'StartDate' match. */
export function normKey(k) {
  return String(k).replace(/_x[0-9a-f]{4}_/gi, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalise a value for comparison (Excel date serials → YYYY-MM-DD). */
export function normVal(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

/** Start a fresh SessionId after logout (next sign-in in this tab = new session). */
export function endAuditSession() {
  try {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k === SESSION_KEY || k?.startsWith('ercrm.audit.once.')) keys.push(k);
    }
    keys.forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}
