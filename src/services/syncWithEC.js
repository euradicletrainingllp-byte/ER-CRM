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
  getEngagements,
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
