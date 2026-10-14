/**
 * EURADICLE CRM — Ops Checklist finance → Engagement Calendar
 *
 * When Invoice / Payment fields are edited in the Ops Checklist, the matching
 * Engagement Calendar row (same Index) gets the Invoice date, Payment status
 * and Received date. This is the only automatic link left — the bulk
 * "Sync with EC" was removed on 2026-10-07 (see addToTrackers.js).
 */

import { getEngagements, updateEngagementRow, patchEngagementCaches, isoToExcelSerial, ecContractFields, updateOpsRow, readTrackerFresh } from './api.js';

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
    ...ecContractFields(e.contract),
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


// ═════════════════════════════════════════════════════════════════════════════
// Finance Tracker — Engagement Calendar is the master for finance (2026-10-14)
// ═════════════════════════════════════════════════════════════════════════════

/** EC columns the Finance Tracker owns (locked in the Engagement Calendar form). */
export const EC_FINANCE_FIELDS = ['invoice', 'payment', 'receivedDate', 'amountReceived', 'travelExpenses', 'gst'];

/** Fixed Payment status values (the EC 'Payment' column). */
export const PAYMENT_OPTIONS = ['Invoice Not Raised', 'Invoice Raised', 'Partly Received', 'Received', 'NA'];

/** Reads any older free-text Payment value as one of PAYMENT_OPTIONS ('' when unknown / blank). */
export function normPayment(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  if (/not\s*raised/.test(s)) return 'Invoice Not Raised';
  if (/part/.test(s)) return 'Partly Received';
  if (/^n\/?a$|not applicable/.test(s)) return 'NA';
  if (/receiv|paid|yes/.test(s)) return 'Received';
  if (/raised|invoiced|pending/.test(s)) return 'Invoice Raised';
  return '';
}

/** EC finance values → Ops Checklist finance columns (only the ones that exist there). */
export function ecToOcFinance(ec, changedKeys) {
  const out = {};
  const ch = new Set(changedKeys || EC_FINANCE_FIELDS);
  if (ch.has('invoice'))      out.invoiceActualDate = isoDate(ec.invoice);
  if (ch.has('receivedDate')) out.paymentActualDate = isoDate(ec.receivedDate);
  if (ch.has('payment')) {
    const p = normPayment(ec.payment);
    out.invoiceGenerated = p === 'Invoice Not Raised' ? 'Not Raised'
                         : p === 'NA' ? 'NA'
                         : p ? 'Raised' : '';
    out.paymentReceived  = p === 'Received' ? 'Yes'
                         : p === 'NA' ? 'NA'
                         : (p === 'Invoice Raised' || p === 'Partly Received') ? 'No' : '';
  }
  return out;
}

const sameFin = (k, a, b) => {
  if (['invoice', 'receivedDate', 'invoiceActualDate', 'paymentActualDate'].includes(k)) return isoDate(a) === isoDate(b);
  if (['travelExpenses', 'gst', 'amountReceived'].includes(k)) {
    const na = Number(String(a ?? '').replace(/[^0-9.-]/g, '')), nb = Number(String(b ?? '').replace(/[^0-9.-]/g, ''));
    const ea = String(a ?? '').trim() === '', eb = String(b ?? '').trim() === '';
    if (ea || eb) return ea && eb || (ea ? nb === 0 : na === 0);
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
 *  3. Copies the matching values to the Ops Checklist row (same Index, same engagement) and confirms.
 *  4. If the Ops Checklist copy fails, the EC change is put back — both files always agree.
 * Ops Checklist rows that don't exist (or belong to another engagement) are skipped.
 *
 * @param {object} p  { ec: EC row as shown, changes: { field: value }, oc: linked Ops row or null }
 * @returns {Promise<{ ok: boolean, row?: object, reason?: string, opsCopied?: boolean, rolledBack?: boolean }>}
 */
export function saveEcFinance({ ec: shown, changes, oc }) {
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
    const before  = Object.fromEntries(Object.keys(toWrite).map(k => [k, fresh[k] ?? '']));
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

    // 3 — Ops Checklist copy (only for a row that really is this engagement)
    const linked = oc && String(oc.engagementKey ?? '').trim() === key && ecMatchesOps(fresh, oc);
    const ocWanted = linked ? ecToOcFinance(row, Object.keys(changes)) : {};
    const ocChanges = linked ? Object.fromEntries(Object.entries(ocWanted).filter(([k, v]) => !sameFin(k, oc[k], v))) : {};
    let opsCopied = false;
    if (Object.keys(ocChanges).length) {
      let ocError = '';
      try {
        await retryBusy(() => updateOpsRow(oc.sno, ocChanges, oc.engagementKey));
        let missed = Object.keys(ocChanges);
        for (const ms of [2500, 4000]) {
          await wait(ms);
          let fresh2;
          try { fresh2 = (await readTrackerFresh('ops')).find(r => String(r.engagementKey ?? '').trim() === key); } catch { continue; }
          missed = fresh2 ? Object.keys(ocChanges).filter(k => !sameFin(k, fresh2[k], ocChanges[k])) : missed;
          if (!missed.length) break;
        }
        if (missed.length) ocError = `the Ops Checklist did not keep ${missed.join(', ')}`;
      } catch (e) { ocError = String(e?.message || e); }

      // 4 — copy failed → undo the EC change so both files agree
      if (ocError) {
        let rolledBack = false;
        if (Object.keys(before).length) {
          try {
            const { ec: now } = await findEcRow(key, fresh.startDate);
            await retryBusy(() => updateEngagementRow(fresh.egId, fresh.sno, ecUpdateBody({ ...(now || fresh), ...before }), key));
            rolledBack = true;
          } catch { /* reported below */ }
        }
        return { ok: false, rolledBack, reason: `could not copy to the Ops Checklist (${ocError})` +
          (rolledBack ? ' — the Engagement Calendar change was undone' : ' — and undoing the Engagement Calendar change also failed, please check this row') };
      }
      opsCopied = true;
    }

    try { patchEngagementCaches(rows => rows.map(r => (String(r.engagementKey).trim() === key ? { ...r, ...toWrite } : r))); } catch { /* cache only */ }
    return { ok: true, row, opsCopied, ocChanges };
  });
}
