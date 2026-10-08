/**
 * EURADICLE CRM — Ops Checklist finance → Engagement Calendar
 *
 * When Invoice / Payment fields are edited in the Ops Checklist, the matching
 * Engagement Calendar row (same Index) gets the Invoice date, Payment status
 * and Received date. This is the only automatic link left — the bulk
 * "Sync with EC" was removed on 2026-10-07 (see addToTrackers.js).
 */

import { getEngagements, updateEngagementRow } from './api.js';

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
    'Proposal Link':                   e.proposalLink   || '',
    'Ops Checklist':                   e.opsChecklist   || '',
    'Index':                  e.engagementKey  || '',
  };
}

/**
 * Pushes Ops Checklist finance changes to the matching Engagement Calendar row
 * (rows are linked by Index, the same key the sync uses).
 *
 * @param {string|number} sno      S No of the Ops Checklist row (display only)
 * @param {object}        changes  OC camelCase changes just saved
 * @param {object}        fullRow  the OC row before the edit (carries engagementKey)
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

  const key = String(fullRow?.engagementKey ?? '').trim();
  if (!key) return { synced: false, reason: 'this Ops Checklist row has no Index' };

  const ecRows = await getEngagements();
  const ec = ecRows.find(r => String(r.engagementKey).trim() === key);
  if (!ec) return { synced: false, reason: `Index ${key} not found in Engagement Calendar` };

  // Skip the PA call if EC already holds these values
  const differs = Object.entries(ecChanges).some(([k, v]) => String(ec[k] ?? '') !== String(v ?? ''));
  if (!differs) return { synced: true };

  await updateEngagementRow(ec.egId, ec.sno, ecUpdateBody({ ...ec, ...ecChanges }), key);
  return { synced: true };
}
