/**
 * Money helpers shared by the Finance Tracker, the Dashboard Finance tab and Founder's Desk.
 *
 * Why: "Amount Received" is a free cell in the Engagement Calendar. Text such as
 * "1,77,000 on 12/09/2026" used to be read by stripping every non-digit, which glued the
 * amount and the date into one huge number (e.g. 1770001209 2026) and blew up Collection.
 */
import { normPayment } from './syncWithEC.js';

const DATE_PATTERNS = [
  /\b\d{4}-\d{1,2}-\d{1,2}(?:T[\d:.]+Z?)?\b/g,                       // 2026-10-12
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,                              // 12/10/2026, 12.10.26
  /\b\d{1,2}(?:st|nd|rd|th)?[\s-]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s,-]*(?:\d{2,4})?\b/gi, // 12 Oct 2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}\b/gi,          // Oct 12, 2026
];

/**
 * Read a money cell. Returns { value, ok }.
 * ok = false when the cell holds text that could not be read as one clear amount.
 * Handles 150000, "1,50,000", "₹ 50,000", "Rs. 12,500/-", "1.5 L", "1.2 Cr", "50,000 + 25,000",
 * several payments in one cell ("140400, 48492", "149580 / 15164", "90720; 4096" → added up),
 * and ignores dates written next to the amount.
 */
export function readMoney(v) {
  if (typeof v === 'string') {
    // Several payments in one cell: separated by "; ", " / " or ", " (comma + space — Indian
    // thousand separators never have a space after them)
    let t = v; DATE_PATTERNS.forEach(re => { t = t.replace(re, ' '); });
    t = t.replace(/\/-/g, ' ');
    const parts = t.split(/\s*;\s*|\s+\/\s*|\s*\/\s+|,\s+(?=[₹\d])/).map(x => x.trim()).filter(x => /\d/.test(x));
    if (parts.length > 1) {
      const read = parts.map(readOne);
      if (read.every(x => x.ok)) return { value: read.reduce((a, x) => a + x.value, 0), ok: true };
    }
  }
  return readOne(v);
}
function readOne(v) {
  if (v === null || v === undefined || v === '') return { value: 0, ok: true };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, ok: true } : { value: 0, ok: false };
  let s = String(v).trim();
  if (!s) return { value: 0, ok: true };
  DATE_PATTERNS.forEach(re => { s = s.replace(re, ' '); });
  s = s.replace(/rs\.?|inr|₹|\/-/gi, ' ');
  const tokens = [...s.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l|crores?|cr)?\b/gi)]
    .map(m => {
      const n = Number(m[1].replace(/,/g, ''));
      const unit = (m[2] || '').toLowerCase();
      return unit.startsWith('c') ? n * 1e7 : unit ? n * 1e5 : n;
    })
    .filter(Number.isFinite);
  if (!tokens.length) return { value: 0, ok: !/\d/.test(String(v)) };
  if (tokens.length === 1) return { value: tokens[0], ok: true };
  // Several numbers: a sum only when written as one ("50,000 + 25,000", "50,000 & 25,000")
  if (/[+&]|\band\b/i.test(s)) return { value: tokens.reduce((a, b) => a + b, 0), ok: true };
  return { value: tokens[0], ok: false };
}
export const money = v => readMoney(v).value;

/* ── Tax rules (Finance decision, 30 Oct 2026) ──────────────────────────────
 *  GST  = 18% of Price (INR)       — calculated, not typed
 *  TDS  = 10% of Price (INR)       — deducted by the client at payment
 *  Amount to be received = Price + GST − TDS   (Travel, Stay & Misc is billed on top)
 */
export const GST_RATE = 0.18;
export const TDS_RATE = 0.10;
const r2 = n => Math.round(n * 100) / 100;
// Travel-only invoices (Price 0) keep the GST typed in Excel (GST charged on the travel)
export const gstOf = e => (money(e?.price) > 0 ? r2(money(e?.price) * GST_RATE) : r2(money(e?.gst)));
export const tdsOf = e => r2(money(e?.price) * TDS_RATE);
/** Price + GST − TDS — what the client actually pays for the program (travel excluded). */
export const receivableOf = e => r2(money(e?.price) + gstOf(e) - tdsOf(e));
/** Amount to be received + Travel, Stay & Misc — everything the client still has to pay us. */
export const expectedOf = e => r2(receivableOf(e) + money(e?.travelExpenses));

/** Billed amount: Price + GST (18%) + Travel, Stay & Misc. */
export const invoiceTotal = e => r2(money(e?.price) + gstOf(e) + money(e?.travelExpenses));
/** Billed amount without Travel / Stay & Misc (Price + GST) — travel is a pass-through, never revenue or collection. */
export const invoiceExTravel = e => r2(money(e?.price) + gstOf(e));

/**
 * Amount collected on an Engagement Calendar row.
 *  • Payment = Received and no amount typed → the full invoice amount
 *  • Never more than the invoice amount (a typed figure above it is treated as a data error)
 * Returns { amount, gross, suspect }
 *  • amount = COLLECTION: excludes Travel / Stay & Misc (never above Price + GST)
 *  • gross  = everything received incl. travel — only for balances still owed by the client
 *  • suspect = the Amount Received cell needs checking in Excel
 */
export function collectedOf(e) {
  const total = invoiceTotal(e);                 // full bill (no TDS taken off) — the most a client can pay
  const { value, ok } = readMoney(e?.amountReceived);
  const p = normPayment(e?.payment);
  let got = Math.max(0, value);
  let suspect = !ok;
  if (p === 'Received' && got === 0) {           // marked Received, no amount typed → what was due after TDS
    const exp = expectedOf(e);
    return { amount: Math.min(receivableOf(e), exp), gross: exp, suspect };
  }
  if (total > 0 && got > total) { suspect = suspect || got > total * 1.05; got = total; }
  if (total === 0 && got > 5e7) { suspect = true; got = 0; }   // > ₹5 Cr on a row with no price: not a real figure
  // Program part of the payment (travel excluded). Travel is taken as paid last: once the client has paid
  // at least Price + GST − TDS + Travel, the travel amount is removed; below that, it all counts as program money.
  const travel = money(e?.travelExpenses);
  const amount = total <= 0 ? got
    : got >= expectedOf(e) ? Math.min(got - travel, invoiceExTravel(e))
    : Math.min(got, receivableOf(e));
  return { amount: r2(Math.max(0, amount)), gross: got, suspect };
}

/** ₹ amount → "₹ 12.34 L" or "₹ 1.23 Cr" (Indian units). */
export function fmtInrShort(rupees) {
  const v = Number(rupees) || 0;
  const a = Math.abs(v);
  if (a >= 1e7) return `₹ ${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹ ${(v / 1e5).toFixed(2)} L`;
  return `₹ ${Math.round(v).toLocaleString('en-IN')}`;
}

/**
 * "Amount Received" cells that need checking, from a list of Engagement Calendar rows.
 * A cell that is larger than its own row's bill is NOT flagged when it is clearly one payment for
 * several rows (the CRM already caps each row at its own bill, so totals stay right):
 *   • the same amount + same Received Date is typed on several rows of the same company, or
 *   • the other rows of the same invoice (same company + same Invoice date) together cover it.
 * Returns the rows still worth checking, each with a short reason.
 */
const isoOf = v => { const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/) || String(v ?? '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return ''; return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const dayDiff = (a, b) => (a && b ? (Date.parse(a) - Date.parse(b)) / 86400000 : 1e9);
export function suspectReceipts(list) {
  const key = v => String(v ?? '').trim().toLowerCase();
  const co = e => key(e.company);
  const inv = e => key(e.invoice);
  const byInvoice = new Map();
  const repeats = new Map();
  (list || []).forEach(e => {
    if (!co(e)) return;
    if (inv(e)) { const k = `${co(e)}|${inv(e)}`; byInvoice.set(k, (byInvoice.get(k) || []).concat(e)); }
    const amt = readMoney(e.amountReceived).value;
    if (amt > 0) { const k = `${co(e)}|${amt}`; repeats.set(k, (repeats.get(k) || 0) + 1); }
  });
  const out = [];
  (list || []).forEach(e => {
    if (!co(e)) return;
    const { value, ok } = readMoney(e.amountReceived);
    if (!ok) { out.push({ e, reason: 'cannot be read as one amount' }); return; }
    const bill = invoiceTotal(e);
    const tooBig = (bill > 0 && value > bill * 1.05) || (bill === 0 && value > 5e7);
    if (!tooBig) return;
    if ((repeats.get(`${co(e)}|${value}`) || 0) > 1) return;            // same payment typed on several rows (any date)
    const group = inv(e) ? byInvoice.get(`${co(e)}|${inv(e)}`) || [] : [];
    if (group.length > 1 && group.reduce((t, x) => t + invoiceTotal(x), 0) >= value * 0.95) return;   // payment for the whole invoice
    // One payment for a whole batch (pre-work, sessions, coaching connects invoiced separately): the same company's
    // rows invoiced within 90 days that have no amount of their own (or are marked paid) together cover it
    const d0 = isoOf(e.invoice) || isoOf(e.startDate);
    if (d0) {
      const near = (list || []).filter(x => co(x) === co(e) && Math.abs(dayDiff(isoOf(x.invoice) || isoOf(x.startDate), d0)) <= 90
        && (x === e || readMoney(x.amountReceived).value === 0 || readMoney(x.amountReceived).value === value));
      if (near.reduce((t, x) => t + invoiceTotal(x), 0) >= value * 0.95) return;
    }
    out.push({ e, reason: bill > 0 ? `more than this row's bill (${Math.round(bill).toLocaleString('en-IN')})` : 'no price on this row' });
  });
  return out;
}
