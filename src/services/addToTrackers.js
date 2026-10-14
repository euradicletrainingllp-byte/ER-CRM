/**
 * EURADICLE CRM — "Add to Ops Checklist" / "Add to Content Dev Tracker"
 *
 * One engagement at a time, started by a button on the Engagement Calendar
 * card. The new tracker row carries the engagement's Index, so the two rows
 * stay linked. If the tracker already has a row with that Index, nothing is
 * added (no duplicates). Nothing is ever updated or deleted here.
 * If the tracker row is deleted later, the button offers "Add" again.
 *
 * (Replaces the old bulk "Sync with EC", which was removed on 2026-10-07.)
 */

import { getOpsChecklist, addOpsRow, getContentDevTracker, addContentDevRow, peekList, rememberListRow, readTrackerFresh, getAllEngagementsCached } from './api.js';

const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** EC row → Ops Checklist camelCase keys (only these columns are ever changed). */
export function ecToOC(ec) {
  const p = {
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
  // BD checklist (ticked when the proposal was won) → OC 'BD Checklist'.
  // Only sent when the EC row carries one, so OC values are never blanked.
  if (String(ec.opsChecklist || '').trim()) p.bdChecklist = String(ec.opsChecklist).trim();
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


function requireIndex(eng) {
  const key = norm(eng?.engagementKey);
  if (!key) throw new Error('This engagement has no Index in the Engagement Calendar yet, so it can\'t be linked. Add its Index in Excel first.');
  return key;
}

/** Known from the last loaded copy of the tracker (no network). true / false / null = unknown. */
export function isInTracker(target, eng) {
  const key = norm(eng?.engagementKey);
  if (!key) return null;
  const rows = peekList(target === 'ops' ? 'ops' : 'cdt');
  if (!rows) return null;
  return rows.some(r => norm(r.engagementKey) === key);
}

/**
 * Adds the engagement to the Ops Checklist (only if it isn't there yet).
 * @returns {{ added: boolean, index: string }}
 */
export async function addEngagementToOps(eng) {
  const index = requireIndex(eng);
  const rows = await getOpsChecklist();                       // fresh read — duplicate check
  if (rows.some(r => norm(r.engagementKey) === index)) return { added: false, index };
  const row = { ...ecToOC(eng), engagementKey: index };
  await addOpsRow(row);
  await confirmIndexSaved('ops', row, index);
  rememberListRow('ops', row);
  return { added: true, index };
}

/**
 * Adds the engagement to the Content Development Tracker (only if it isn't there yet).
 * @returns {{ added: boolean, index: string }}
 */
export async function addEngagementToCDT(eng) {
  const index = requireIndex(eng);
  const rows = await getContentDevTracker();                  // fresh read — duplicate check
  if (rows.some(r => norm(r.engagementKey) === index)) return { added: false, index };
  const row = { ...ecToCDT(eng), engagementKey: index };
  await addContentDevRow(row);
  await confirmIndexSaved('cdt', row, index);
  rememberListRow('cdt', row);
  return { added: true, index };
}

// ─── Did the Index actually reach Excel? ─────────────────────────────────────
// The flows answer "OK" even when their "Add a row" step doesn't map the Index
// column — the row is created with an empty Index, can't be edited later
// ("has no Index") and the duplicate check can't see it. So read the tracker
// back and stop with a clear message if that happened.
const FLOW_OF   = { ops: 'OPS_CHECKLIST_CRUD', cdt: 'CONTENT_DEV_CRUD' };
const TABLE_OF  = { ops: 'Operations Checklist → Table2', cdt: 'Content_Development_Tracker → ContentDevTable' };
const LABEL_OF  = { ops: 'Ops Checklist', cdt: 'Content Dev Tracker' };
const low = v => norm(v).toLowerCase();
const nameOf = r => low(r.client ?? r.company);

async function confirmIndexSaved(target, row, index) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(res => setTimeout(res, 2000));
    let rows;
    try { rows = await readTrackerFresh(target); } catch { return; }   // can't check — don't block
    if (rows.some(r => norm(r.engagementKey) === index)) return;       // ✓ saved with its Index
    const orphan = rows.some(r => !norm(r.engagementKey) && nameOf(r) === nameOf(row) && low(r.topic) === low(row.topic));
    if (orphan) {
      throw new Error(
        `The row was added to the ${LABEL_OF[target]}, but Excel did not save its Index (${index}), ` +
        `so it can't be edited from the CRM. Fix once in Power Automate: ${FLOW_OF[target]} → "Add a row" → ` +
        `map the Index column = triggerBody()?['Index'] (add an "Index" column to ${TABLE_OF[target]} first if it isn't there). ` +
        `Then type ${index} in that row's Index cell in Excel — don't click Add again, it would create a duplicate.`);
    }
  }
  // Row not visible yet (Excel lag) — nothing to report.
}

/**
 * For a tracker row with no Index: the Engagement Calendar Index it most likely
 * belongs to (same client + topic, and start date when both have one). '' if unsure.
 */
export async function suggestIndexFor(row) {
  try {
    const all = await getAllEngagementsCached();
    const hits = all.filter(e => norm(e.engagementKey) &&
      low(e.company) === nameOf(row) && low(e.topic) === low(row.topic) &&
      (!row.startDate || !e.startDate || String(e.startDate).slice(0, 10) === String(row.startDate).slice(0, 10)));
    return hits.length === 1 ? norm(hits[0].engagementKey) : '';
  } catch { return ''; }
}
