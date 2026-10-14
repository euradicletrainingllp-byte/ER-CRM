/**
 * EURADICLE CRM — Ops Checklist finance → Engagement Calendar
 *
 * When Invoice / Payment fields are edited in the Ops Checklist, the matching
 * Engagement Calendar row (same Index) gets the Invoice date, Payment status
 * and Received date. This is the only automatic link left — the bulk
 * "Sync with EC" was removed on 2026-10-07 (see addToTrackers.js).
 */

import { getEngagements, updateEngagementRow, patchEngagementCaches, isoToExcelSerial } from './api.js';

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

// ─── One EC write at a time per engagement ──────────────────────────────────
// The EC update flow overwrites the WHOLE row. If two saves for the same
// engagement overlap (e.g. Invoice Status, then Invoice Date a second later),
// the slower one can land last and put the old (blank) Invoice date back.
// So writes for one Index are queued, and each one is built from the latest
// finance values known at the moment it actually runs.
const _ecQueue = new Map();     // Index → promise of the last queued job
const _latestOc = new Map();    // Index → latest OC finance values (click order)

function runForIndex(key, job) {
  const prev = _ecQueue.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  _ecQueue.set(key, next);
  next.finally(() => { if (_ecQueue.get(key) === next) _ecQueue.delete(key); }).catch(() => {});
  return next;
}

const isoDate = v => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  if (!isNaN(n) && n > 25000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
};
const sameVal = (k, a, b) =>
  ['invoice', 'receivedDate'].includes(k) ? isoDate(a) === isoDate(b)
  : ['travelExpenses', 'gst', 'price'].includes(k) ? (Number(a) || 0) === (Number(b) || 0)
  : String(a ?? '').trim() === String(b ?? '').trim();

// ─── Is this EC row really the same engagement as the Ops Checklist row? ────
const normTxt = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fmtShort = iso => { const d = isoDate(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '—'; };

/** True when the EC row and the Ops Checklist row describe the same engagement. */
export function ecMatchesOps(ec, oc) {
  if (!ec || !oc) return false;
  const a = normTxt(ec.company), b = normTxt(oc.company);
  const sameCompany = !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const sameDate = !!isoDate(ec.startDate) && isoDate(ec.startDate) === isoDate(oc.startDate);
  const sameEg = !!normTxt(ec.egId) && normTxt(ec.egId) === normTxt(oc.egId);
  return sameCompany && (sameDate || sameEg);
}

/** The EC Index this Ops Checklist row should carry (same company + start date, EG ID preferred), or ''. */
export function suggestEcIndex(oc, ecRows) {
  const c = (ecRows || []).filter(e => ecMatchesOps(e, oc) && isoDate(e.startDate) === isoDate(oc.startDate));
  const best = c.find(e => normTxt(e.egId) === normTxt(oc.egId)) || (c.length === 1 ? c[0] : null);
  return best ? String(best.engagementKey ?? '').trim() : '';
}

const describeEc = ec => `"${ec.company}" (${ec.egId}, ${fmtShort(ec.startDate)})`;

const EC_LABEL = { invoice: 'Invoice date', receivedDate: 'Received date', payment: 'Payment status', travelExpenses: 'Travel, Stay & Misc', gst: 'GST' };
const wait = ms => new Promise(r => setTimeout(r, ms));

const shiftIso = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/**
 * Finds the EC row for this Index. Reading the whole Engagement Calendar takes
 * ~12 s, so when the engagement's start date is known only a few days around it
 * are read (the same small read the Engagement Calendar page uses). Falls back
 * to the full read if the row is not in that window.
 */
async function findEcRow(key, hintDate) {
  const match = rows => rows.filter(r => String(r.engagementKey).trim() === key);
  const iso = isoDate(hintDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    try {
      const from = shiftIso(iso, -3), to = shiftIso(iso, 3);
      const m = match(await getEngagements({ fromDate: from, toDate: to, fromSerial: isoToExcelSerial(from), toSerial: isoToExcelSerial(to) }));
      if (m.length) return { ec: m[0], dupes: m.length };
    } catch { /* fall back to the full read */ }
  }
  const m = match(await getEngagements());
  return { ec: m[0] || null, dupes: m.length };
}

/**
 * Writes `ecChanges` onto the EC row with this Index, then reads Excel back
 * to confirm the values were really kept (the flow can return OK without
 * writing a column). Returns { synced, reason? }.
 */
async function writeEcAndVerify(key, ecChanges, hintDate, expect) {
  const { ec, dupes } = await findEcRow(key, hintDate);
  if (!ec) return { synced: false, reason: `Index ${key} not found in Engagement Calendar` };
  // Safety: never write onto another engagement's row
  if (expect && !ecMatchesOps(ec, expect)) {
    return { synced: false, wrongLink: true,
      reason: `Index ${key} in the Engagement Calendar is ${describeEc(ec)}, not "${expect.company}" (${expect.egId || '—'}, ${fmtShort(expect.startDate)}). Nothing was written — the Index in the Ops Checklist is wrong.` };
  }

  const toWrite = Object.fromEntries(Object.entries(ecChanges).filter(([k, v]) => !sameVal(k, ec[k], v)));
  if (!Object.keys(toWrite).length) return { synced: true, row: ec };

  await updateEngagementRow(ec.egId, ec.sno, ecUpdateBody({ ...ec, ...toWrite }), key);

  // Quick confirmation read (small window read, 2 tries) — Excel Online can lag a few seconds
  let after = null, missed = Object.keys(toWrite);
  for (const ms of [2500, 4000]) {
    await wait(ms);
    ({ ec: after } = await findEcRow(key, ec.startDate || hintDate));
    missed = after ? Object.keys(toWrite).filter(k => !sameVal(k, after[k], toWrite[k])) : Object.keys(toWrite);
    if (!missed.length) break;
  }
  if (missed.length) {
    const detail = missed.map(k => `${EC_LABEL[k] || k}: sent "${toWrite[k]}", Excel shows "${after?.[k] ?? ''}"`).join('; ');
    return { synced: false, reason: `Engagement Calendar did not keep ${detail}` + (dupes > 1 ? ` (Index ${key} appears ${dupes}× in the EC table)` : '') };
  }
  const row = { ...ec, ...toWrite };
  // Show the new values on the Engagement Calendar page straight away
  try { patchEngagementCaches(rows => rows.map(r => (String(r.engagementKey).trim() === key ? { ...r, ...toWrite } : r))); } catch { /* cache only */ }
  return { synced: true, row };
}

/**
 * Pushes finance changes (made in the Finance Tracker) to the matching
 * Engagement Calendar row (rows are linked by Index).
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
  const key = String(fullRow?.engagementKey ?? '').trim();
  if (!key) return { synced: false, reason: 'this Ops Checklist row has no Index' };

  // Merge in click order, so a later job always sees every earlier change
  _latestOc.set(key, { ...(fullRow || {}), ...(_latestOc.get(key) || {}), ...changes });

  return runForIndex(key, async () => {
    const oc = _latestOc.get(key);
    const ecChanges = {
      invoice:      oc.invoiceActualDate ?? '',
      receivedDate: oc.paymentActualDate ?? '',
      payment:      ecPaymentStatus(oc),
    };
    const res = await writeEcAndVerify(key, ecChanges, oc.startDate, oc);
    return { synced: res.synced, reason: res.reason };
  });
}


// ─── Finance Tracker → Engagement Calendar (Travel, Stay & Misc / GST) ───────

/** EC fields the Finance Tracker edits directly (they only exist in the EC table). */
export const FINANCE_EC_FIELDS = ['travelExpenses', 'gst'];

/**
 * Saves Travel, Stay & Misc and/or GST on the Engagement Calendar row with this Index.
 * Queued with the other EC writes for the same Index, and checked against Excel.
 *
 * @param {string} engagementKey  Index shared by the Ops Checklist and EC rows
 * @param {object} amounts        { travelExpenses?, gst? }
 * @returns {Promise<object>}     the EC row after the change
 */
export async function updateECFinanceAmounts(engagementKey, amounts, hintDate, expect) {
  const key = String(engagementKey ?? '').trim();
  if (!key) throw new Error('This engagement has no Index, so the Engagement Calendar row cannot be found');
  const changes = {};
  for (const k of FINANCE_EC_FIELDS) if (k in amounts) changes[k] = Number(amounts[k]) || 0;
  return runForIndex(key, async () => {
    const res = await writeEcAndVerify(key, changes, hintDate, expect);
    if (!res.synced) throw new Error(res.reason);
    return res.row;
  });
}
