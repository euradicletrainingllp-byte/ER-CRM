/**
 * EURADICLE CRM — Finance Tracker → Engagement Calendar writes (per Index, one at a time).
 * The old Ops Checklist finance copy was removed with the old checklist on 2026-11-22.
 */

import { getEngagements, updateEngagementRow, patchEngagementCaches, isoToExcelSerial, ecContractFields, EC_EXTRA_COLS, ecExtraFields } from './api.js';
import { gstForExcel } from './gstRule.js';


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
    ...ecContractFields(e.contract),
    'PO Status':                       e.poStatus       || '',
    invoice:                           e.invoice        || '',
    'Price (INR)':                     Number(e.price)  || 0,
    'Travel, Stay and Misc Expenses':  Number(e.travelExpenses) || 0,
    gst:                               gstForExcel(e),   // 18% of Price unless GST was typed as 0
    payment:                           e.payment        || '',
    'Amount Received':                 e.amountReceived || '',
    'Received Date':                   e.receivedDate   || '',
    comments:                          e.comments       || '',
    feedback:                          e.feedback       || '',
    nps:                               e.nps            || '',
    'Proposal Link':                   e.proposalLink   || '',
    'Ops Checklist':                   e.opsChecklist   || '',
    ...ecExtraFields(e),
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
const blank = v => String(v ?? '').trim() === '';
const sameVal = (k, a, b) =>
  ['invoice', 'receivedDate'].includes(k) ? isoDate(a) === isoDate(b)
  : k === 'gst' ? blank(a) === blank(b) && (Number(a) || 0) === (Number(b) || 0)   // blank GST (auto) ≠ 0 (no GST, locked)
  : ['travelExpenses', 'gst', 'price', 'creditNoteTotal'].includes(k) ? (Number(a) || 0) === (Number(b) || 0)
  : String(a ?? '').trim() === String(b ?? '').trim();

// ─── Is this EC row really the same engagement as the one shown? ───────────
const normTxt = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fmtShort = iso => { const d = isoDate(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '—'; };

/** True when two engagement rows (fresh EC row vs the row on screen) describe the same engagement. */
export function ecMatchesOps(ec, oc) {
  if (!ec || !oc) return false;
  const a = normTxt(ec.company), b = normTxt(oc.company);
  const sameCompany = !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const sameDate = !!isoDate(ec.startDate) && isoDate(ec.startDate) === isoDate(oc.startDate);
  const sameEg = !!normTxt(ec.egId) && normTxt(ec.egId) === normTxt(oc.egId);
  return sameCompany && (sameDate || sameEg);
}


const describeEc = ec => `"${ec.company}" (${ec.egId}, ${fmtShort(ec.startDate)})`;

const EC_LABEL = { invoiceNo: 'Invoice No', invoice: 'Invoice date', receivedDate: 'Received date', payment: 'Payment status', travelExpenses: 'Travel, Stay & Misc', gst: 'GST', ...Object.fromEntries(EC_EXTRA_COLS.map(([k, h]) => [k, h])), travelInvoiceNo: 'Travel Invoice No', cancelledInvoiceNo: 'Cancelled Invoice No', creditNotes: 'Credit Notes', creditNoteTotal: 'Credit Note Total' };
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



// ─── Finance Tracker → Engagement Calendar (Travel, Stay & Misc / GST) ───────

/** EC fields the Finance Tracker edits directly (they only exist in the EC table). */
export const FINANCE_EC_FIELDS = ['travelExpenses', 'gst'];

/**
 * Saves Travel, Stay & Misc and/or GST on the Engagement Calendar row with this Index.
 * Queued with the other EC writes for the same Index, and checked against Excel.
 *
 * @param {string} engagementKey  Engagement Calendar Index
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


// ═════════════════════════════════════════════════════════════════════════════
// Finance Tracker — Engagement Calendar is the master for finance (2026-10-14)
// ═════════════════════════════════════════════════════════════════════════════

/** EC columns the Finance Tracker owns (locked in the Engagement Calendar form). */
// Finance-owned EC fields (the EC edit form takes these fresh from Excel). Price breakup is owned by the EC form, so it is not here.
export const EC_FINANCE_FIELDS = ['invoiceNo', 'invoice', 'payment', 'receivedDate', 'amountReceived', 'travelExpenses', 'gst', 'travelInvoiceRaised', 'travelInvoiceDate', 'travelReceived', 'travelReceivedAmount', 'travelReceivedDate', 'travelInvoiceNo', 'cancelledInvoiceNo', 'creditNotes', 'creditNoteTotal'];

/** Fixed Payment status values (the EC 'Payment' column). */
export const PAYMENT_OPTIONS = ['Invoice Not Raised', 'Invoice Raised', 'Partly Received', 'Received', 'NA', 'Pro Bono'];

/** Reads any older free-text Payment value as one of PAYMENT_OPTIONS ('' when unknown / blank). */
export function normPayment(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/pro\s*-?\s*bono/.test(s)) return 'Pro Bono';
  if (/not\s*raised/.test(s)) return 'Invoice Not Raised';
  if (/part/.test(s)) return 'Partly Received';
  if (/^n\/?a$|not applicable/.test(s)) return 'NA';
  if (/un\s*-?\s*paid|not\s*(paid|received)/.test(s)) return 'Invoice Raised';   // "Unpaid" contains "paid" — test it first
  if (/receiv|paid|yes/.test(s)) return 'Received';
  if (/raised|invoiced|pending/.test(s)) return 'Invoice Raised';
  return '';
}


const sameFin = (k, a, b) => {
  if (['invoice', 'receivedDate', 'invoiceActualDate', 'paymentActualDate', 'travelInvoiceDate', 'travelReceivedDate'].includes(k)) return isoDate(a) === isoDate(b);
  if (['travelExpenses', 'gst', 'amountReceived', 'pmCost', 'materialCost', 'otherCost', 'travelReceivedAmount', 'creditNoteTotal'].includes(k)) {
    const na = Number(String(a ?? '').replace(/[^0-9.-]/g, '')), nb = Number(String(b ?? '').replace(/[^0-9.-]/g, ''));
    const ea = String(a ?? '').trim() === '', eb = String(b ?? '').trim() === '';
    if (ea || eb) return ea && eb || (k !== 'gst' && (ea ? nb === 0 : na === 0));   // GST: blank (auto) ≠ 0 (no GST, locked)
    return !isNaN(na) && !isNaN(nb) ? na === nb : String(a).trim() === String(b).trim();
  }
  return String(a ?? '').trim() === String(b ?? '').trim();
};

/** Run `fn` in the same one-at-a-time queue as every other EC write for this Index. */
export function withEcLock(engagementKey, fn) {
  return runForIndex(String(engagementKey ?? '').trim(), fn);
}

/** Current finance values of an EC row, read fresh from Excel (small date-window read). */
export async function freshEcFinance(engagementKey, hintDate) {
  const { ec } = await findEcRow(String(engagementKey ?? '').trim(), hintDate);
  return ec ? Object.fromEntries(EC_FINANCE_FIELDS.map(k => [k, ec[k] ?? ''])) : null;
}

const isBusy = e => e instanceof TypeError || /\((429|502|503|504)\)|timed out|did not respond|\b502\b/i.test(String(e?.message || ''));
async function retryBusy(fn) {
  for (const ms of [0, 3000, 6000]) {
    if (ms) await wait(ms);
    try { return await fn(); } catch (e) { if (!isBusy(e) || ms === 6000) throw e; }
  }
}

/**
 * Saves finance changes on one engagement.
 *  1. Reads the EC row fresh (so other people's latest edits are kept) and checks it is the same engagement.
 *  2. Writes EC = fresh row + only the changed finance fields, then confirms Excel kept them.
 *
 * @param {object} p  { ec: EC row as shown, changes: { field: value } }
 * @returns {Promise<{ ok: boolean, row?: object, reason?: string }>}
 */
export function saveEcFinance({ ec: shown, changes }) {
  const key = String(shown?.engagementKey ?? '').trim();
  if (!key) return Promise.resolve({ ok: false, reason: 'this engagement has no Index' });
  return runForIndex(key, async () => {
    // 1 — fresh row
    const { ec: fresh, dupes } = await retryBusy(() => findEcRow(key, shown.startDate));
    if (!fresh) return { ok: false, reason: `Index ${key} was not found in the Engagement Calendar` };
    if (!ecMatchesOps(fresh, shown)) {
      return { ok: false, reason: `Index ${key} in Excel is now ${describeEc(fresh)} — refresh the page` };
    }
    const toWrite = Object.fromEntries(Object.entries(changes).filter(([k, v]) => !sameFin(k, fresh[k], v)));
    let row = { ...fresh, ...toWrite };

    // 2 — EC write + confirm
    if (Object.keys(toWrite).length) {
      await retryBusy(() => updateEngagementRow(fresh.egId, fresh.sno, ecUpdateBody(row), key));
      let after = null, missed = Object.keys(toWrite);
      for (const ms of [2500, 4000]) {
        await wait(ms);
        try { ({ ec: after } = await findEcRow(key, fresh.startDate)); } catch { continue; }
        missed = after ? Object.keys(toWrite).filter(k => !sameFin(k, after[k], toWrite[k])) : missed;
        if (!missed.length) break;
      }
      if (missed.length) {
        return { ok: false, reason: `the Engagement Calendar did not keep ${missed.map(k => EC_LABEL[k] || k).join(', ')}` +
          (dupes > 1 ? ` (Index ${key} is in the Engagement Calendar ${dupes} times)` : '') };
      }
    }

    try { patchEngagementCaches(rows => rows.map(r => (String(r.engagementKey).trim() === key ? { ...r, ...toWrite } : r))); } catch { /* cache only */ }
    return { ok: true, row };
  });
}

// Used by bdChecklistSync.js (BD checklist → Engagement Calendar)
export { ecUpdateBody, runForIndex };
