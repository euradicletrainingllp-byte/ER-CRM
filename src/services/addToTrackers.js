/**
 * EURADICLE CRM — "Add to Ops Checklist" / "Add to Content Dev Tracker"
 *
 * One engagement at a time, started by a button on the Engagement Calendar
 * card. The new tracker row carries the engagement's Index, so the two rows
 * stay linked. If the tracker already has a row with that Index, nothing is
 * added (no duplicates). Nothing is ever updated or deleted here.
 *
 * (Replaces the old bulk "Sync with EC", which was removed on 2026-10-07.)
 */

import { getOpsChecklist, addOpsRow, getContentDevTracker, addContentDevRow, peekList } from './api.js';

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
  await addOpsRow({ ...ecToOC(eng), engagementKey: index });
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
  await addContentDevRow({ ...ecToCDT(eng), engagementKey: index });
  return { added: true, index };
}
