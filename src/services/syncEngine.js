/**
 * EURADICLE CRM — Engagement Calendar → Ops Checklist / Content Dev Tracker
 * SYNC ENGINE (all-or-nothing, incremental) — runs only from the Sync buttons
 *
 * How one run works
 *   1. PLAN   – read Engagement Calendar rows from the 1st of LAST month onward
 *               (current + all future months), plus the Ops Checklist and the
 *               Content Dev Tracker. Compare field-by-field and list ONLY the
 *               rows that are missing or different. Nothing is written yet.
 *   2. APPLY  – write the planned changes one by one. Before each write the
 *               previous values are saved in a journal (browser storage).
 *   3. COMMIT – when every change has succeeded the journal is cleared and the
 *               run is recorded as successful.
 *
 * If anything fails (flow error, network drop, tab closed, laptop asleep):
 *   – every change already written in that run is UNDONE (updates restored to
 *     their previous values, added rows deleted), so the trackers end up
 *     exactly as they were before the run started;
 *   – if the tab was closed mid-run, the undo happens automatically the next
 *     time the CRM is opened (before any new sync starts).
 *
 * Only one run at a time per browser (a lock shared by all open CRM tabs).
 */

import {
  getEngagementsForRange, getAllEngagementsCached,
  getOpsChecklist,      updateOpsRow,        addOpsRow,        deleteOpsRow,
  getContentDevTracker, updateContentDevRow, addContentDevRow, deleteContentDevRow,
} from './api.js';

// ─── Field mapping (EC row → tracker fields owned by the EC) ─────────────────

/** EC row → Ops Checklist camelCase keys (only these columns are ever changed). */
export function ecToOC(ec) {
  const p = {
    sno:            ec.sno,
    egId:           ec.egId        || '',
    company:        ec.company     || '',
    startDate:      ec.startDate   || '',
    endDate:        ec.endDate     || '',
    topic:          ec.topic       || '',
    sector:         ec.sector      || '',
    serviceType:    ec.serviceType || '',
    offering:       ec.offering    || '',
    location:       ec.location    || '',
    consultant1:    ec.consultant1 || '',
    consultant2:    ec.consultant2 || '',
    consultant3:    ec.consultant3 || '',
    status:         ec.status      || '',
    contractType:   ec.contract    || '',   // EC 'Contract'  → OC 'Contract Type'
    contractStatus: ec.poStatus    || '',   // EC 'PO Status' → OC 'Contract Status'
  };
  // Day: only when the EC value is a real number (e.g. "0.5+0.5" is left untouched)
  if (ec.day > 0) p.day = String(ec.day);
  return p;
}

/** EC row → Content Dev Tracker keys (CDT has no End Date column). */
export function ecToCDT(ec) {
  return {
    client:    ec.company   || '',
    startDate: ec.startDate || '',
    topic:     ec.topic     || '',
  };
}

// ─── Scope ───────────────────────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');

/** 1st day of last month, e.g. on 24 Sep 2026 → '2026-08-01'. */
export function syncScopeFrom(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}
const SCOPE_TO = '2099-12-31';            // "all future months"

// ─── Browser storage: journal, lock, last-run state ──────────────────────────
const JOURNAL_KEY = 'ercrm.sync.journal.v1';
const STATE_KEY   = 'ercrm.sync.state.v1';
const LOCK_KEY    = 'ercrm.sync.lock.v1';
const LOCK_TTL_MS = 90 * 1000;
const TAB_ID      = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const readJSON  = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const writeJSON = (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const removeKey = k       => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export function readSyncState() { return readJSON(STATE_KEY, {}); }
function saveSyncState(patch)   { writeJSON(STATE_KEY, { ...readSyncState(), ...patch }); }

function acquireLock() {
  const now = Date.now();
  const cur = readJSON(LOCK_KEY, null);
  if (cur && cur.owner !== TAB_ID && cur.exp > now) return false;
  writeJSON(LOCK_KEY, { owner: TAB_ID, exp: now + LOCK_TTL_MS });
  const check = readJSON(LOCK_KEY, null);
  return !!check && check.owner === TAB_ID;
}
function refreshLock() {
  const cur = readJSON(LOCK_KEY, null);
  if (cur && cur.owner === TAB_ID) writeJSON(LOCK_KEY, { owner: TAB_ID, exp: Date.now() + LOCK_TTL_MS });
}
function releaseLock() {
  const cur = readJSON(LOCK_KEY, null);
  if (cur && cur.owner === TAB_ID) removeKey(LOCK_KEY);
}

/** True while any open CRM tab is running a sync. */
/** True when a previous sync was cut off and still needs undoing. */
export function hasInterruptedSync() {
  return !!readJSON(JOURNAL_KEY, null);
}

export function isSyncRunning() {
  const cur = readJSON(LOCK_KEY, null);
  return !!cur && cur.exp > Date.now();
}

// ─── Events for the UI ───────────────────────────────────────────────────────
function emit(name, detail) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* non-browser */ }
}

export class SyncRolledBackError extends Error {
  constructor(message, cause) { super(message); this.name = 'SyncRolledBackError'; this.cause = cause; }
}

// ─── Plan ────────────────────────────────────────────────────────────────────
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const differs = (existing, payload) =>
  Object.keys(payload).some(k => k !== 'sno' && norm(existing[k]) !== norm(payload[k]));

async function buildPlan(targets, scope = 'recent') {
  const from = scope === 'all' ? '' : syncScopeFrom();
  const [ecAll, ocRows, cdtRows] = await Promise.all([
    scope === 'all'
      ? getAllEngagementsCached({ force: true })
      : getEngagementsForRange(from, SCOPE_TO, { force: true }),
    targets.includes('ops') ? getOpsChecklist()      : Promise.resolve(null),
    targets.includes('cdt') ? getContentDevTracker() : Promise.resolve(null),
  ]);

  // In-scope EC rows with a start date and an S No (last duplicate S No wins)
  const ecBySno = new Map();
  ecAll.forEach(e => {
    const key = norm(e.sno);
    if (!key || !e.startDate) return;
    // include engagements that started earlier but are still running into scope
    const end = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate;
    if (end < from) return;
    ecBySno.set(key, e);
  });

  const ops = [];
  if (ocRows) {
    const ocBySno = new Map(ocRows.map(r => [norm(r.sno), r]));
    for (const [key, ec] of ecBySno) {
      const payload  = ecToOC(ec);
      const existing = ocBySno.get(key);
      if (!existing)                     ops.push({ target: 'ops', type: 'add',    key, after: payload });
      else if (differs(existing, payload)) ops.push({ target: 'ops', type: 'update', key, before: existing, after: { ...existing, ...payload } });
    }
  }
  if (cdtRows) {
    const cdtBySno = new Map(cdtRows.map(r => [norm(r.sno), r]));
    for (const [key, ec] of ecBySno) {
      const payload  = ecToCDT(ec);
      const existing = cdtBySno.get(key);
      if (!existing)                     ops.push({ target: 'cdt', type: 'add',    key, after: { sno: ec.sno, ...payload } });
      else if (differs(existing, payload)) ops.push({ target: 'cdt', type: 'update', key, before: existing, after: { ...existing, ...payload } });
    }
  }
  return { from, inScope: ecBySno.size, ops };
}

// ─── Apply / undo a single change ────────────────────────────────────────────
async function applyOp(op) {
  if (op.target === 'ops') {
    if (op.type === 'update') return updateOpsRow(op.key, op.after);
    return addOpsRow({ 'S No': op.after.sno, ...op.after });
  }
  if (op.type === 'update') return updateContentDevRow(op.key, op.after);
  return addContentDevRow(op.after);
}

async function revertOp(op) {
  if (op.target === 'ops') {
    if (op.type === 'update') return updateOpsRow(op.key, op.before);
    return deleteOpsRow(op.key);
  }
  if (op.type === 'update') return updateContentDevRow(op.key, op.before);
  return deleteContentDevRow(op.key);
}

/** Undo every applied change of a journal, newest first. Keeps the journal if an undo fails. */
async function rollback(journal, onProgress) {
  journal.status = 'rolling-back';
  writeJSON(JOURNAL_KEY, journal);
  const done = journal.ops.filter(o => o.state === 'done').reverse();
  let i = 0;
  for (const op of done) {
    onProgress?.({ phase: 'rolling-back', done: i, total: done.length });
    await revertOp(op);                  // throws → journal stays for the next attempt
    op.state = 'reverted';
    writeJSON(JOURNAL_KEY, journal);
    i++;
  }
  removeKey(JOURNAL_KEY);
}

/**
 * Finish undoing a run that was interrupted (tab closed / crashed / offline).
 * Safe to call any time; does nothing when there is no unfinished run.
 * @returns {{ recovered: boolean, reverted?: number }}
 */
export async function recoverInterruptedSync(onProgress) {
  const journal = readJSON(JOURNAL_KEY, null);
  if (!journal) return { recovered: false };
  if (!acquireLock()) return { recovered: false, busy: true };
  const hb = setInterval(refreshLock, 20000);
  try {
    const n = journal.ops.filter(o => o.state === 'done').length;
    await rollback(journal, onProgress);
    saveSyncState({ lastRecoveredAt: Date.now(), lastResult: { ok: false, rolledBack: true, reverted: n, reason: 'Previous sync was interrupted — its changes were undone.' } });
    emit('ercrm:sync-complete', { targets: [...new Set(journal.ops.map(o => o.target))], rolledBack: true });
    return { recovered: true, reverted: n };
  } finally {
    clearInterval(hb);
    releaseLock();
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
/**
 * Run one all-or-nothing sync.
 * @param {object}   opts
 * @param {string[]} [opts.targets=['ops','cdt']]
 * @param {'recent'|'all'} [opts.scope='recent']  recent = last month onward, all = whole calendar
 * @param {function} [opts.onProgress]  ({ phase, done, total, updated, added })
 * @returns {Promise<{ skipped?: string, updated: number, added: number, planned: number, inScope: number, byTarget: object }>}
 * @throws  {SyncRolledBackError} when a change failed and the run was undone
 */
export async function runEcSync({ targets = ['ops', 'cdt'], scope = 'recent', onProgress } = {}) {
  const empty = { updated: 0, added: 0, planned: 0, inScope: 0, byTarget: {} };
  if (!targets.length) return { ...empty, skipped: 'no-targets' };
  if (!acquireLock())  return { ...empty, skipped: 'locked' };

  const hb = setInterval(refreshLock, 20000);
  const warnOnLeave = e => { e.preventDefault(); e.returnValue = ''; };
  saveSyncState({ lastAttemptAt: Date.now() });

  try {
    // Finish undoing any earlier interrupted run before starting a new one
    const leftover = readJSON(JOURNAL_KEY, null);
    if (leftover) await rollback(leftover, onProgress);

    onProgress?.({ phase: 'planning', done: 0, total: 0, updated: 0, added: 0 });
    const plan = await buildPlan(targets, scope);

    const byTarget = {};
    plan.ops.forEach(o => {
      byTarget[o.target] = byTarget[o.target] || { updated: 0, added: 0 };
      byTarget[o.target][o.type === 'add' ? 'added' : 'updated']++;
    });

    if (!plan.ops.length) {
      saveSyncState({ lastSuccessAt: Date.now(), lastResult: { ok: true, updated: 0, added: 0, inScope: plan.inScope, from: plan.from } });
      onProgress?.({ phase: 'done', done: 0, total: 0, updated: 0, added: 0 });
      return { ...empty, inScope: plan.inScope };
    }

    const journal = {
      id: `${Date.now()}`, startedAt: Date.now(), owner: TAB_ID, status: 'applying',
      ops: plan.ops.map(o => ({ ...o, state: 'pending' })),
    };
    if (!writeJSON(JOURNAL_KEY, journal)) {
      throw new Error('Browser storage is unavailable, so a safe (undoable) sync cannot run.');
    }
    window.addEventListener('beforeunload', warnOnLeave);

    let updated = 0, added = 0;
    for (let i = 0; i < journal.ops.length; i++) {
      const op = journal.ops[i];
      onProgress?.({ phase: 'applying', done: i, total: journal.ops.length, updated, added });
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Went offline');
        await applyOp(op);
      } catch (err) {
        // ── Any failure → undo everything written in this run ──
        try {
          await rollback(journal, onProgress);
        } catch (undoErr) {
          saveSyncState({ lastResult: { ok: false, rolledBack: false, reason: `Undo will be retried automatically: ${undoErr.message}` } });
          throw new SyncRolledBackError(`Sync failed at S No ${op.key} and the undo could not finish yet — it will be retried automatically. (${err.message})`, err);
        }
        saveSyncState({ lastResult: { ok: false, rolledBack: true, reason: err.message, failedAt: op.key } });
        emit('ercrm:sync-complete', { targets, rolledBack: true });
        throw new SyncRolledBackError(`Sync failed at S No ${op.key} — all changes from this run were undone. (${err.message})`, err);
      }
      op.state = 'done';
      writeJSON(JOURNAL_KEY, journal);
      if (op.type === 'add') added++; else updated++;
    }

    // ── Commit ──
    removeKey(JOURNAL_KEY);
    saveSyncState({ lastSuccessAt: Date.now(), lastResult: { ok: true, updated, added, inScope: plan.inScope, from: plan.from } });
    onProgress?.({ phase: 'done', done: journal.ops.length, total: journal.ops.length, updated, added });
    emit('ercrm:sync-complete', { targets: Object.keys(byTarget), updated, added, byTarget });
    return { updated, added, planned: plan.ops.length, inScope: plan.inScope, byTarget };
  } finally {
    window.removeEventListener('beforeunload', warnOnLeave);
    clearInterval(hb);
    releaseLock();
  }
}
