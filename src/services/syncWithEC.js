/**
 * EURADICLE CRM — Engagement Calendar Sync Utility
 *
 * React pages call syncOpsWithEC() / syncCDTWithEC() when the user taps
 * "Sync with Engagement Calendar".  Each function:
 *   1. Fetches EC + target sheet in parallel (two PA calls)
 *   2. Builds a Map of the target sheet keyed by S No
 *   3. For every EC row:
 *        - S No found in target  → update ONLY the EC-sourced columns
 *        - S No missing          → add as a new row
 *   4. Returns { updated, added, errors[] }
 *
 * Columns that live only in the tracker (e.g. Contract Status, Pax List,
 * POC, completion dates) are NEVER touched — even on updates.
 */

import {
  getEngagements,         updateEngagementRow,
  getOpsChecklist,        updateOpsRow,       addOpsRow,
  getContentDevTracker,   updateContentDevRow, addContentDevRow,
} from './api.js';

// ─── Field extractors ─────────────────────────────────────────────────────────

/**
 * Maps one EC row to the OC camelCase keys that updateOpsRow / addOpsRow accept.
 * Keys NOT listed here are left untouched on existing OC rows.
 */
function ecToOC(ec) {
  return {
    sno:         ec.sno,               // sync S No cell value (OPS_FIELD_MAP maps this to 'S No')
    egId:        ec.egId        || '',
    company:     ec.company     || '',
    startDate:   ec.startDate   || '',
    endDate:     ec.endDate     || '',
    topic:       ec.topic       || '',
    sector:      ec.sector      || '',
    serviceType: ec.serviceType || '',
    offering:    ec.offering    || '',
    location:    ec.location    || '',
    consultant1: ec.consultant1 || '',
    consultant2: ec.consultant2 || '',
    consultant3: ec.consultant3 || '',
    // day is a number in EC; OC stores it as a string cell
    day:         ec.day > 0 ? String(ec.day) : '',
    status:      ec.status      || '',
    contractType:   ec.contract  || '',   // EC 'Contract'  → OC 'Contract Type'
    contractStatus: ec.poStatus  || '',   // EC 'PO Status' → OC 'Contract Status'
  };
}

/**
 * Maps one EC row to the CDT camelCase keys that updateContentDevRow /
 * addContentDevRow accept.
 * Only client, startDate and endDate come from EC — everything else
 * (programType, poc, dueDate, completionDate, pmRequired) stays as-is.
 */
function ecToCDT(ec) {
  return {
    client:    ec.company   || '',
    startDate: ec.startDate || '',
    // endDate omitted — CDT Excel has no End Date column.
    // To sync end dates, add an 'End Date' column to the CDT sheet first.
    topic:     ec.topic     || '',
  };
}

// ─── Ops Checklist sync ───────────────────────────────────────────────────────

/**
 * Syncs Engagement Calendar → Ops Checklist.
 *
 * @param {function} [onProgress]  Optional callback({ done, total, updated, added, errors })
 *                                 called after each EC row is processed — use to show a
 *                                 live progress indicator in the UI if desired.
 * @returns {{ updated: number, added: number, errors: Array<{sno, error}> }}
 */
export async function syncOpsWithEC(onProgress) {
  // Fetch both sheets in parallel — two PA HTTP calls at once
  const [ecRows, ocRows] = await Promise.all([
    getEngagements(),
    getOpsChecklist(),
  ]);

  // Index OC by S No so lookups are O(1)
  const ocBySno = new Map(ocRows.map(r => [String(r.sno), r]));

  let updated = 0;
  let added   = 0;
  const errors = [];
  const total  = ecRows.length;

  for (let i = 0; i < ecRows.length; i++) {
    const ec = ecRows[i];

    // Skip rows that have no valid S No (blank header rows, etc.)
    if (ec.sno == null || ec.sno === '') continue;

    const key     = String(ec.sno);
    const payload = ecToOC(ec);

    try {
      if (ocBySno.has(key)) {
        const existing = ocBySno.get(key);
        // ── UPDATE: merge existing OC row first (preserves OC-managed columns:
        //    Client SPOC, Internal POC, Pax List, No of Participants, Program Type,
        //    Consultant 3, and all checklist columns) then overwrite with EC payload.
        //    Same merge strategy CDT uses — required so PA receives a complete row body.
        await updateOpsRow(key, { ...existing, ...payload });
        updated++;
      } else {
        // ── ADD: new row — S No must be sent with the exact Excel column name
        //    addOpsRow's fallback (OPS_FIELD_MAP[k] || k) preserves 'S No' as-is
        await addOpsRow({ 'S No': ec.sno, ...payload });
        added++;
      }
    } catch (err) {
      errors.push({ sno: key, error: err.message });
    }

    // Fire progress callback (useful for a progress bar or % counter)
    onProgress?.({ done: i + 1, total, updated, added, errors: errors.length });
  }

  return { updated, added, errors };
}

// ─── Content Dev Tracker sync ─────────────────────────────────────────────────

/**
 * Syncs Engagement Calendar → Content Development Tracker.
 *
 * For updates: merges only { client, startDate, endDate } from EC into the
 * existing CDT row — programType, evRequired, poc, dueDate, completionDate
 * and pmRequired are preserved unchanged by spreading the existing row first.
 *
 * @param {function} [onProgress]  Same signature as syncOpsWithEC.
 * @returns {{ updated: number, added: number, errors: Array<{sno, error}> }}
 */
export async function syncCDTWithEC(onProgress) {
  const [ecRows, cdtRows] = await Promise.all([
    getEngagements(),
    getContentDevTracker(),
  ]);

  const cdtBySno = new Map(cdtRows.map(r => [String(r.sno), r]));

  let updated = 0;
  let added   = 0;
  const errors = [];
  const total  = ecRows.length;

  for (let i = 0; i < ecRows.length; i++) {
    const ec = ecRows[i];

    if (ec.sno == null || ec.sno === '') continue;

    const key       = String(ec.sno);
    const ecPayload = ecToCDT(ec);

    try {
      if (cdtBySno.has(key)) {
        const existing = cdtBySno.get(key);
        // Merge strategy:
        //   spread existing first  → preserves programType, poc, dueDate, etc.
        //   then spread ecPayload  → overwrites client, startDate, endDate from EC
        await updateContentDevRow(key, { ...existing, ...ecPayload });
        updated++;
      } else {
        // sno is passed so addContentDevRow can include it in the PA body
        await addContentDevRow({ sno: ec.sno, ...ecPayload });
        added++;
      }
    } catch (err) {
      errors.push({ sno: key, error: err.message });
    }

    onProgress?.({ done: i + 1, total, updated, added, errors: errors.length });
  }

  return { updated, added, errors };
}

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
