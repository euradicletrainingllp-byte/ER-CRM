/**
 * EURADICLE CRM — Engagement Calendar Sync Utility
 *
 * syncOpsWithEC() / syncCDTWithEC() — manual "Sync with EC" buttons; both
 * delegate to the all-or-nothing engine in syncEngine.js (rows are linked
 * by S No; only EC-owned columns are written).
 *
 * Columns that live only in the tracker (e.g. Contract Status, Pax List,
 * POC, completion dates) are NEVER touched — even on updates.
 */

import { getEngagements, updateEngagementRow } from './api.js';
import { runEcSync } from './syncEngine.js';

// ─── Manual "Sync with EC" buttons ────────────────────────────────────────────
// Both buttons use the all-or-nothing, incremental engine (syncEngine.js).
// scope 'recent' = engagements from last month onward, 'all' = whole calendar;
// only rows that are missing or different, and everything is undone if any
// write fails. Return shape is unchanged: { updated, added, errors[] }.

async function manualSync(target, onProgress, scope = 'recent') {
  const res = await runEcSync({
    targets: [target],
    scope,
    onProgress: p => onProgress?.({ done: p.done, total: p.total, updated: p.updated, added: p.added, errors: 0 }),
  });
  if (res.skipped === 'locked') {
    throw new Error('Another sync is already running (maybe in another CRM tab) — please try again in a minute.');
  }
  return { updated: res.updated, added: res.added, errors: [] };
}

/** Engagement Calendar → Ops Checklist (all-or-nothing). */
export function syncOpsWithEC(onProgress, scope = 'recent') { return manualSync('ops', onProgress, scope); }

/** Engagement Calendar → Content Dev Tracker (all-or-nothing). */
export function syncCDTWithEC(onProgress, scope = 'recent') { return manualSync('cdt', onProgress, scope); }

// ─── Ops Checklist Finance → Engagement Calendar (live, per edit) ────────────

/**
 * Ops Checklist finance field → Engagement Calendar field.
 * Only fields that have a matching EC column are synced.
 * (Invoice Status, Invoice POC and Invoice Comments have no EC column.)
 */
export const OPS_FINANCE_TO_EC = {
  invoiceActualDate: 'invoice',       // OC 'Actual Gen. Date'   → EC 'Invoice' (Invoice Date)
  invoiceGenerated:  'payment',       // OC 'Invoice Status'     → EC 'Payment' (Payment Status) — see ecPaymentStatus
  paymentReceived:   'payment',       // OC 'Payment Received'   → EC 'Payment' (Payment Status) — see ecPaymentStatus
  paymentActualDate: 'receivedDate',  // OC 'Actual Payout Date' → EC 'Received Date'
};

/**
 * EC Payment Status derived from the OC finance state (priority order):
 *   1. Payout date entered          → 'Received'
 *   2. Invoice Status Raised        → 'Invoice Raised'
 *      Invoice Status Not Raised    → 'Invoice Not Raised'
 *   3. otherwise                    → OC 'Payment Received' value as-is
 */
export function ecPaymentStatus(oc) {
  if (String(oc.paymentActualDate ?? '').trim()) return 'Received';
  const inv = String(oc.invoiceGenerated ?? '').trim();
  if (inv === 'Raised')     return 'Invoice Raised';
  if (inv === 'Not Raised') return 'Invoice Not Raised';
  return oc.paymentReceived ?? '';
}

/**
 * Builds the complete EC row body the UPDATE_ENGAGEMENT flow expects.
 * The flow overwrites the whole row, so every column must be sent —
 * same column names as the Engagement Calendar edit form uses.
 */
function ecUpdateBody(e) {
  return {
    'EG ID':                           e.egId           || '',
    company:                           e.company        || '',
    'Start Date':                      e.startDate      || '',
    'End Date':                        e.endDate        || '',
    topic:                             e.topic          || '',
    sector:                            e.sector         || '',
    'Service Type':                    e.serviceType    || '',
    offering:                          e.offering       || '',
    day:                               Number(e.day)    || 1,
    location:                          e.location       || '',
    'Consultant - 1':                  e.consultant1    || '',
    'Consultant - 2':                  e.consultant2    || '',
    status:                            e.status         || '',
    contract:                          e.contract       || '',
    'PO Status':                       e.poStatus       || '',
    invoice:                           e.invoice        || '',
    'Price (INR)':                     Number(e.price)  || 0,
    'Travel, Stay and Misc Expenses':  Number(e.travelExpenses) || 0,
    gst:                               Number(e.gst)    || 0,
    payment:                           e.payment        || '',
    'Amount Received':                 e.amountReceived || '',
    'Received Date':                   e.receivedDate   || '',
    comments:                          e.comments       || '',
    feedback:                          e.feedback       || '',
    nps:                               e.nps            || '',
  };
}

/**
 * Pushes Ops Checklist finance changes to the matching Engagement Calendar row
 * (rows are linked by S No, the same key syncOpsWithEC uses).
 *
 * @param {string|number} sno      S No of the Ops Checklist row
 * @param {object}        changes  OC camelCase changes just saved
 * @returns {{ synced: boolean, reason?: string }}
 */
export async function syncOpsFinanceToEC(sno, changes, fullRow) {
  if (!Object.keys(OPS_FINANCE_TO_EC).some(k => k in changes)) {
    return { synced: false, reason: 'no finance fields' };
  }
  // Use the complete OC finance state (row after this edit) so derived values stay correct
  const oc = { ...(fullRow || {}), ...changes };
  const ecChanges = {};
  if ('invoiceActualDate' in oc) ecChanges.invoice      = oc.invoiceActualDate ?? '';
  if ('paymentActualDate' in oc) ecChanges.receivedDate = oc.paymentActualDate ?? '';
  ecChanges.payment = ecPaymentStatus(oc);

  if (sno == null || String(sno).trim() === '') return { synced: false, reason: 'row has no S No' };

  const ecRows = await getEngagements();
  const ec = ecRows.find(r => String(r.sno) === String(sno));
  if (!ec) return { synced: false, reason: `S No ${sno} not found in Engagement Calendar` };

  // Skip the PA call if EC already holds these values
  const differs = Object.entries(ecChanges).some(([k, v]) => String(ec[k] ?? '') !== String(v ?? ''));
  if (!differs) return { synced: true };

  await updateEngagementRow(ec.egId, ec.sno, ecUpdateBody({ ...ec, ...ecChanges }));
  return { synced: true };
}
