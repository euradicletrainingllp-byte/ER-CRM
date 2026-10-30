import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';
import { ErrorState } from '../components/LoadingState.jsx';
import {
  peekList, getOpsChecklist, ecHasExtraCols,
  getEngagementsForRange, peekEngagementsForRange, prefetchEngagementsForRange, buildMonthRange,
} from '../services/api.js';
import {
  saveEcFinance, PAYMENT_OPTIONS, normPayment, ecMatchesOps,
} from '../services/syncWithEC.js';
import { usePermissions } from '../hooks/usePermissions.js';
import ExportButton from '../components/ExportButton.jsx';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { pendingItems, FIN_RULES } from '../config/pendingFields.js';
import { money, gstOf, tdsOf, receivableOf, expectedOf, GST_RATE, TDS_RATE } from '../services/money.js';

/**
 * Finance Tracker
 * ───────────────
 * Lists Engagement Calendar rows (the master for finance) by month window,
 * exactly like the Engagement Calendar page. Rows are referenced and ordered by S No
 * (the Index column stays hidden — it is only the key the Excel flows save with).
 * Finance edits Payment status, Invoice date, Amount Received, Received Date,
 * Travel, Stay & Misc and GST — saved to the Engagement Calendar and copied in
 * the same save to the Ops Checklist row with the same Index (when there is one).
 * If that copy fails, the Engagement Calendar change is undone.
 * Invoice POC / Invoice Comments are edited only in the Ops Checklist (shown here read-only).
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const addMonths = (ym, delta) => { const d = new Date(ym.year, ym.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() }; };
const defaultStart = span => { const t = new Date(); return addMonths({ year: t.getFullYear(), month: t.getMonth() }, -Math.floor((span - 1) / 2)); };
const SPAN_OPTIONS = [1, 3, 6, 12];

const addDays = (iso, n) => {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const toIso = d => {
  if (!d) return '';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};
const fmtDate = d => { const s = toIso(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : (d ? String(d) : '—'); };
const dueColor = due => {
  if (!due) return 'var(--muted)';
  const diff = (new Date(due) - new Date(todayIso())) / 86400000;
  return diff < 0 ? 'var(--red)' : diff <= 3 ? '#f59e0b' : 'var(--green)';
};
// Amounts: money() reads "1,50,000", "₹ 50,000", "1.5 L" and ignores dates typed next to the amount
const num = v => money(v);
const inr = v => (v === '' || v == null ? '—' : '₹ ' + num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
// Total still expected from the client: Price + GST (18%) − TDS (10%) + Travel, Stay & Misc
export const totalOf = e => expectedOf(e);
const keyOf = r => String(r?.engagementKey ?? '').trim();   // hidden save key (Excel flows)
const snoOf = r => String(r?.sno ?? '').trim();             // reference shown to people
const validYear = v => { const y = Number(String(v).slice(0, 4)); return y >= 2000 && y <= 2099; };

// ─── Finance stage (from Engagement Calendar values) ────────────────────────
const STAGES = {
  'Invoice Overdue':  { color: '#b91c1c', bg: '#fee2e2' },
  'To Invoice':       { color: '#9a3412', bg: '#ffedd5' },
  'Upcoming':         { color: '#475569', bg: '#f1f5f9' },
  'Payment Overdue':  { color: '#b91c1c', bg: '#fee2e2' },
  'Awaiting Payment': { color: '#1d4ed8', bg: '#dbeafe' },
  'Partly Received':  { color: '#7c3aed', bg: '#ede9fe' },
  'Received':         { color: '#065f46', bg: '#dcfce7' },
  'Not Applicable':   { color: '#6b7280', bg: '#f3f4f6' },
  'Cancelled':        { color: '#6b7280', bg: '#f3f4f6' },
};
export function financeDates(e) {
  const invDue = addDays(toIso(e.endDate) || toIso(e.startDate), 1);
  const payDue = toIso(e.invoice) ? addDays(toIso(e.invoice), 30) : null;
  return { invDue, payDue };
}
export function financeStage(e) {
  const { invDue, payDue } = financeDates(e);
  const today = todayIso();
  const p = normPayment(e.payment);
  if (/cancel/i.test(String(e.status ?? ''))) return 'Cancelled';
  if (p === 'Received') return 'Received';
  if (p === 'NA') return 'Not Applicable';
  if (p === 'Partly Received') return 'Partly Received';
  if (p === 'Invoice Raised' || toIso(e.invoice)) return payDue && payDue < today ? 'Payment Overdue' : 'Awaiting Payment';
  if (!invDue) return 'To Invoice';
  if (invDue < today) return 'Invoice Overdue';
  if (invDue === today) return 'To Invoice';
  return 'Upcoming';
}
/** Days past the payment term (invoice date + 30 days); 0 when not overdue. Paid / NA / Cancelled are never overdue. */
export function overdueDays(e) {
  const inv = toIso(e.invoice);
  if (!inv) return 0;
  const p = normPayment(e.payment);
  if (p === 'Received' || p === 'NA' || /cancel/i.test(String(e.status ?? ''))) return 0;
  const due = addDays(inv, 30);
  const days = Math.floor((new Date(todayIso()) - new Date(due)) / 86400000);
  return days > 0 ? days : 0;
}
function OverdueTag({ days, big }) {
  if (!days) return null;
  return (
    <span title={`Invoice date + 30 days crossed ${days} day${days > 1 ? 's' : ''} ago`} style={{
      fontSize: big ? 11 : 10, fontWeight: 800, color: '#fff', background: '#dc2626', borderRadius: 10,
      padding: big ? '3px 10px' : '2px 8px', whiteSpace: 'nowrap', letterSpacing: 0.3,
    }}>OVERDUE · {days}d</span>
  );
}

function StageBadge({ stage }) {
  const s = STAGES[stage] || STAGES.Upcoming;
  return <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>{stage}</span>;
}

/** Automatic Payment status when dates / amounts are entered (only moves forward). */
function autoPayment(next) {
  const p = normPayment(next.payment);
  const total = totalOf(next), got = num(next.amountReceived);
  if (p === 'NA') return next.payment;
  if (toIso(next.receivedDate) || got > 0) {
    if (total > 0 && got > 0 && got < total) return 'Partly Received';
    if (toIso(next.receivedDate) || (total > 0 && got >= total)) return 'Received';
  }
  if (toIso(next.invoice) && (!p || p === 'Invoice Not Raised')) return 'Invoice Raised';
  return next.payment;
}

const Field = ({ label, children, full }) => (
  <div style={full ? { gridColumn: '1 / -1' } : undefined}>
    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
    {children}
  </div>
);
const Val = ({ children, style }) => <div style={{ fontWeight: 500, ...style }}>{children || '—'}</div>;
const Section = ({ children }) => (
  <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginTop: 4 }}>{children}</div>
);

// ─── Detail panel ────────────────────────────────────────────────────────────
// Travel billing (Engagement Calendar columns added 30 Oct 2026). Price breakup is edited in the Engagement Calendar.
const EXTRA_KEYS = ['travelInvoiceRaised', 'travelInvoiceDate', 'travelReceived', 'travelReceivedAmount', 'travelReceivedDate'];
const EDIT_KEYS = ['payment', 'invoice', 'amountReceived', 'receivedDate', 'travelExpenses', ...EXTRA_KEYS];   // GST is calculated (18% of Price)
const fromRow = e => ({
  payment: e.payment ?? '', invoice: toIso(e.invoice), amountReceived: e.amountReceived ?? '',
  receivedDate: toIso(e.receivedDate), travelExpenses: e.travelExpenses ?? '',
  ...Object.fromEntries(EXTRA_KEYS.map(k => [k, k.endsWith('Date') ? toIso(e[k]) : (e[k] ?? '')])),
});


function FinancePanel({ ec, link, canEdit, onEdit, saving, focusN }) {
  const [tab, setTab] = useState('finance');
  // Opened from the pending-fields bar → make sure the Finance tab (with the inputs) is showing
  useEffect(() => { if (focusN) setTab('finance'); }, [focusN]);
  const [form, setForm] = useState(() => fromRow(ec));

  // Keep the boxes in step with the row (e.g. after an undo) — but never the box being typed in
  useEffect(() => {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    const busy = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.name : '';
    const r = fromRow(ec);
    setForm(f => Object.fromEntries(EDIT_KEYS.map(k => [k, k === busy ? f[k] : r[k]])));
  }, [ec.payment, ec.invoice, ec.amountReceived, ec.receivedDate, ec.travelExpenses, ec.gst, ...EXTRA_KEYS.map(k => ec[k])]);   // eslint-disable-line react-hooks/exhaustive-deps

  const live = { ...ec, ...form };
  const stage = financeStage(live);
  const { invDue, payDue } = financeDates(live);
  const total = totalOf(live);
  const balance = total - num(live.amountReceived);

  // Autosave: every change goes to the page, which combines quick changes into one save
  const edit = k => e => {
    const v = e.target.value;
    if (k.endsWith('Date') || k === 'invoice') { if (v && !validYear(v)) { setForm(f => ({ ...f, [k]: v })); return; } }
    const next = { ...form, [k]: v };
    const pay = k === 'payment' ? v : autoPayment({ ...ec, ...next });
    const changes = { [k]: v };
    if (k !== 'payment' && pay !== form.payment) { next.payment = pay; changes.payment = pay; }
    // Travel billing moves forward on its own: a travel invoice date → Raised; an amount received → Yes / Partly
    if (k === 'travelInvoiceDate' && v && !next.travelInvoiceRaised) { next.travelInvoiceRaised = 'Yes'; changes.travelInvoiceRaised = 'Yes'; }
    if (k === 'travelReceivedAmount' && money(v) > 0 && !['Yes', 'NA'].includes(next.travelReceived)) {
      const st = money(v) >= money(ec.travelExpenses) ? 'Yes' : 'Partly';
      next.travelReceived = st; changes.travelReceived = st;
    }
    // Keep the Excel GST column in step with the rule (18% of Price) whenever this engagement is saved
    const gstCalc = gstOf(ec);
    if (money(ec.price) > 0 && Math.abs(money(ec.gst) - gstCalc) > 0.5) changes.gst = String(gstCalc);
    setForm(next);
    onEdit(ec, changes);
  };

  const p = normPayment(form.payment);
  const oc = link.state === 'ok' ? link.oc : null;

  return (
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="card-header" style={{ flexShrink: 0, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title" style={{ fontSize: 15 }}>{ec.company}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            S No {snoOf(ec) || '—'} · {ec.egId} · {fmtDate(ec.startDate)}{ec.endDate && ec.endDate !== ec.startDate ? ` → ${fmtDate(ec.endDate)}` : ''}
          </div>
          {ec.topic && <div style={{ fontSize: 12, marginTop: 2 }}>{ec.topic}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, marginTop: 4, color: 'var(--muted)' }}>
            {['To Invoice', 'Invoice Overdue', 'Upcoming'].includes(stage) && invDue && <span style={{ color: dueColor(invDue), fontWeight: 600 }}>🧾 Invoice by {fmtDate(invDue)}</span>}
            {toIso(live.invoice) && <span>🧾 Invoiced {fmtDate(live.invoice)}</span>}
            {['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(stage) && payDue && <span style={{ color: dueColor(payDue), fontWeight: 600 }}>💳 Payment due {fmtDate(payDue)}</span>}
            {toIso(live.receivedDate) && <span>💳 Received {fmtDate(live.receivedDate)}</span>}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            <StatusBadge value={ec.status} />
            {ec.contract && <span className="badge badge-gray">📄 {ec.contract}{ec.poStatus ? ` · ${ec.poStatus}` : ''}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <StageBadge stage={stage} />
          <OverdueTag days={overdueDays(live)} big />
          {saving && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>⏳ Saving…</span>}
          {total > 0 && <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }} title="Price + GST (18%) − TDS (10%) + Travel, Stay & Misc">{inr(total)}</div>}
          {total > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>to receive · after TDS</div>}
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, padding: '0 16px' }}>
        {[['finance', '💰 Finance'], ['details', '📋 Engagement Info']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            border: 'none', background: 'none', padding: '8px 14px', cursor: 'pointer', fontSize: 12,
            fontWeight: tab === t ? 700 : 500, color: tab === t ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent', marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {tab === 'finance' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 13 }}>
            <Section>Invoice</Section>
            <Field label="Payment Status">
              {canEdit ? (
                <select name="payment" className="form-input" style={{ fontSize: 12 }} value={form.payment} onChange={edit('payment')}>
                  <option value="">— select —</option>
                  {PAYMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  {form.payment && !PAYMENT_OPTIONS.includes(form.payment) && <option value={form.payment}>{form.payment} (old value)</option>}
                </select>
              ) : <Val>{ec.payment}</Val>}
            </Field>
            <Field label="Invoice Due Date (TAT)">
              <Val style={{ color: p && p !== 'Invoice Not Raised' ? 'var(--muted)' : dueColor(invDue) }}>{fmtDate(invDue)}</Val>
            </Field>
            <Field label="Invoice Date">
              {canEdit
                ? <input name="invoice" type="date" className="form-input" style={{ fontSize: 12 }} value={form.invoice} onChange={edit('invoice')} />
                : <Val>{toIso(ec.invoice) ? fmtDate(ec.invoice) : ''}</Val>}
            </Field>
            <Field label="Payment Due Date (TAT)">
              <Val style={{ color: p === 'Received' ? 'var(--muted)' : dueColor(payDue) }}>{payDue ? fmtDate(payDue) : 'Set invoice date first'}</Val>
            </Field>

            <Section>Payment</Section>
            <Field label="Amount Received (₹)">
              {canEdit
                ? <input name="amountReceived" type="number" min="0" step="0.01" className="form-input" style={{ fontSize: 12 }} value={form.amountReceived} onChange={edit('amountReceived')} placeholder="0" />
                : <Val>{ec.amountReceived ? inr(ec.amountReceived) : ''}</Val>}
            </Field>
            <Field label="Received Date">
              {canEdit
                ? <input name="receivedDate" type="date" className="form-input" style={{ fontSize: 12 }} value={form.receivedDate} onChange={edit('receivedDate')} />
                : <Val>{toIso(ec.receivedDate) ? fmtDate(ec.receivedDate) : ''}</Val>}
            </Field>
            <Field label="Balance">
              <Val style={{ fontWeight: 700, color: balance > 0 && num(live.amountReceived) > 0 ? '#7c3aed' : undefined }}>{total ? inr(balance) : ''}</Val>
            </Field>

            <Section>Commercials</Section>
            <Field label="Price (INR) 🔒"><Val>{ec.price ? inr(ec.price) : ''}</Val></Field>
            <Field label="Travel, Stay & Misc (₹)">
              {canEdit
                ? <input name="travelExpenses" type="number" min="0" step="0.01" className="form-input" style={{ fontSize: 12 }} value={form.travelExpenses} onChange={edit('travelExpenses')} placeholder="0" />
                : <Val>{ec.travelExpenses ? inr(ec.travelExpenses) : ''}</Val>}
            </Field>
            <Field label={`GST (${GST_RATE * 100}% of Price) · auto`}><Val>{num(ec.price) ? inr(gstOf(ec)) : ''}</Val></Field>
            <Field label={`TDS (${TDS_RATE * 100}% of Price) · auto`}><Val style={{ color: '#b45309' }}>{num(ec.price) ? `− ${inr(tdsOf(ec))}` : ''}</Val></Field>
            <Field label="Amount to be Received (Price + GST − TDS)">
              <Val style={{ fontWeight: 800, color: 'var(--primary)' }}>{num(ec.price) ? inr(receivableOf(ec)) : ''}</Val>
            </Field>
            <Field label="Total to Receive (incl. Travel)"><Val style={{ fontWeight: 700 }}>{total ? inr(total) : ''}</Val></Field>

            {ecHasExtraCols() ? (() => {
              const inp = (k, type = 'number', ph = '0') => (canEdit
                ? <input name={k} type={type} {...(type === 'number' ? { min: 0, step: '0.01' } : {})} className="form-input" style={{ fontSize: 12 }} value={form[k]} onChange={edit(k)} placeholder={ph} />
                : <Val>{type === 'number' ? (form[k] ? inr(form[k]) : '') : type === 'date' ? (form[k] ? fmtDate(form[k]) : '') : form[k]}</Val>);
              const sel = (k, opts) => (canEdit
                ? <select name={k} className="form-input" style={{ fontSize: 12 }} value={form[k]} onChange={edit(k)}><option value="">—</option>{opts.map(o => <option key={o}>{o}</option>)}</select>
                : <Val>{form[k]}</Val>);
              const travelBal = money(live.travelExpenses) - money(live.travelReceivedAmount);
              return (<>
                <Section>Travel, Stay &amp; Misc Billing</Section>
                <Field label="Travel Invoice Raised">{sel('travelInvoiceRaised', ['Yes', 'No', 'NA'])}</Field>
                <Field label="Travel Invoice Date">{inp('travelInvoiceDate', 'date')}</Field>
                <Field label="Travel Amount Received">{sel('travelReceived', ['Yes', 'No', 'Partly', 'NA'])}</Field>
                <Field label="Travel Received Amount (₹)">{inp('travelReceivedAmount')}</Field>
                <Field label="Travel Received Date">{inp('travelReceivedDate', 'date')}</Field>
                <Field label="Travel Balance">
                  <Val style={{ fontWeight: 700, color: travelBal > 0 && live.travelInvoiceRaised === 'Yes' ? '#b91c1c' : undefined }}>{money(live.travelExpenses) ? inr(Math.max(0, travelBal)) : ''}</Val>
                </Field>
              </>);
            })() : (
              <Field label="Travel billing" full>
                <Val style={{ color: 'var(--muted)', fontWeight: 400 }}>Add the Travel Invoice Raised … Travel Received Date columns to the Engagement Calendar table to use these fields.</Val>
              </Field>
            )}

            <Section>Ops Checklist</Section>
            {oc ? (
              <>
                <Field label="Invoice POC 🔒"><Val>{oc.invoicePoc}</Val></Field>
                <Field label="Ops Checklist row"><Val>S No {oc.sno} · copies kept in step</Val></Field>
                <Field label="Invoice Comments 🔒" full><Val style={{ fontStyle: oc.invoiceComment ? 'italic' : 'normal' }}>{oc.invoiceComment}</Val></Field>
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--muted)' }}>🔒 Invoice POC and Invoice Comments are edited in the Ops Checklist → Finance tab.</div>
              </>
            ) : link.state === 'wrong' ? (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#7f1d1d', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
                ⚠ The Ops Checklist row linked to this engagement (S No {link.oc.sno}) is <strong>{link.oc.company}</strong> ({link.oc.egId}, {fmtDate(link.oc.startDate)}) — a different engagement, so nothing is copied to it. Correct the link on that Ops Checklist row.
              </div>
            ) : (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted)' }}>
                {link.state === 'loading' ? '⏳ Loading the Ops Checklist…' : 'Not in the Ops Checklist — saved to the Engagement Calendar only.'}
              </div>
            )}
          </div>
        )}

        {tab === 'details' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: 13 }}>
            {[
              ['S No', snoOf(ec)], ['EG.ID', ec.egId], ['Company', ec.company], ['Status', ec.status],
              ['Start Date', fmtDate(ec.startDate)], ['End Date', fmtDate(ec.endDate)], ['Topic', ec.topic],
              ['Sector', ec.sector], ['Service Type', ec.serviceType], ['Offering', ec.offering], ['No. of Days', ec.day],
              ['Location', ec.location], ['Consultant 1', ec.consultant1], ['Consultant 2', ec.consultant2],
              ['Contract Type', ec.contract], ['Contract Status', ec.poStatus], ['Comments', ec.comments],
            ].map(([label, val]) => <Field key={label} label={label}><Val>{val}</Val></Field>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ops Checklist link for an EC row: same Index AND same engagement. */
function linkFor(ec, opsList) {
  if (opsList == null) return { state: 'loading' };
  const k = keyOf(ec);
  const oc = k ? opsList.find(o => keyOf(o) === k) : null;
  if (!oc) return { state: 'none' };
  return ecMatchesOps(ec, oc) ? { state: 'ok', oc } : { state: 'wrong', oc };
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function FinanceTracker({ onRefreshed }) {
  // Month window — same behaviour as the Engagement Calendar page
  const [span, setSpan] = useState(3);
  const [start, setStart] = useState(() => defaultStart(3));
  const win = useMemo(() => buildMonthRange(start.year, start.month, span), [start, span]);
  const today = todayIso();
  const containsToday = today >= win.from && today <= win.to;
  const rangeLabel = win.months.length === 1 ? win.months[0].label : `${win.months[0].label} – ${win.months[win.months.length - 1].label}`;

  const [data, setData] = useState(() => peekEngagementsForRange(win.from, win.to) || []);
  const [rangeLoading, setRangeLoading] = useState(() => !peekEngagementsForRange(win.from, win.to));
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [ops, setOps] = useState(() => peekList('ops') || null);
  const [search, setSearch] = useState('');
  const [stageF, setStageF] = useState('All');
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState('');
  const [savingKeys, setSavingKeys] = useState(() => new Set());
  const [focusN, setFocusN] = useState(0);

  const { canEdit } = usePermissions();
  const canEditFin = canEdit('finance');

  const toastTimer = useRef(null);
  const showToast = msg => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    const m = String(msg);
    toastTimer.current = setTimeout(() => setToast(''), m.includes('⚠') || m.includes('❌') ? 12000 : 2500);
  };

  // Stale-while-revalidate load of the window (saved copy first, fresh copy in the background)
  const requestId = useRef(0);
  const load = useCallback(async ({ force = false, keepCurrent = false } = {}) => {
    const id = ++requestId.current;
    let hasData = keepCurrent;
    if (!keepCurrent) {
      const cached = peekEngagementsForRange(win.from, win.to);
      if (cached) { setData(cached); setRangeLoading(false); hasData = true; }
      else { setData([]); setRangeLoading(true); }
    }
    setSyncing(true); setError(null);
    try {
      const rows = await getEngagementsForRange(win.from, win.to, { force });
      if (id !== requestId.current) return;
      setData(rows); setRangeLoading(false);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) {
      if (id !== requestId.current) return;
      if (hasData) showToast('⚠ Could not refresh from Excel — showing the last saved copy.');
      else { setError(e); setRangeLoading(false); }
    } finally { if (id === requestId.current) setSyncing(false); }
  }, [win.from, win.to, onRefreshed]);

  useEffect(() => { load(); }, [win.from, win.to]);
  useEffect(() => { getOpsChecklist().then(setOps).catch(() => setOps(o => o || [])); }, []);
  // Preload previous / next windows so paging feels instant
  useEffect(() => {
    if (syncing || rangeLoading) return;
    const t = setTimeout(() => [-span, span].forEach(d => {
      const s = addMonths(start, d); const r = buildMonthRange(s.year, s.month, span);
      prefetchEngagementsForRange(r.from, r.to);
    }), 1200);
    return () => clearTimeout(t);
  }, [syncing, rangeLoading, win.from, win.to]);

  const shift = dir => setStart(s => addMonths(s, dir * span));
  const goToday = () => setStart(defaultStart(span));
  const changeSpan = n => { setSpan(n); if (containsToday) setStart(defaultStart(n)); };

  // Ops Checklist link per engagement (same Index AND same engagement)
  const linkOf = ec => linkFor(ec, ops);
  const opsRef = useRef(ops);
  opsRef.current = ops;

  const rows = useMemo(() =>
    data.filter(e => (e.undated ? containsToday : true)).map(e => ({ ...e, _stage: financeStage(e) })),
  [data, containsToday]);

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.toLowerCase();
    const mQ = !q || [r.company, r.topic, r.egId, r.sno, r.consultant1].some(v => String(v ?? '').toLowerCase().includes(q));
    const mS = stageF === 'All'
      || (stageF === 'Needs Action' ? (['Invoice Overdue', 'To Invoice', 'Payment Overdue'].includes(r._stage) || overdueDays(r) > 0)
      : stageF === 'All To Invoice' ? ['Invoice Overdue', 'To Invoice'].includes(r._stage)
      : stageF === 'All Awaiting Payment' ? ['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(r._stage)
      : stageF === 'Overdue (30+ days)' ? overdueDays(r) > 0
      : r._stage === stageF);
    return mQ && mS;
  }).sort((a, b) => (Number(snoOf(a)) || 1e9) - (Number(snoOf(b)) || 1e9) || String(a.startDate || '9999').localeCompare(String(b.startDate || '9999'))),
  [rows, search, stageF]);

  // KPI counts follow the period and the search. The stage filter is not applied to the
  // cards — the cards ARE the stage filter (click to filter), so applying it would zero the others.
  const kpiRows = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r => [r.company, r.topic, r.egId, r.sno, r.consultant1].some(v => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);
  const count = (...st) => kpiRows.filter(r => st.includes(r._stage)).length;

  // Pending-fields bar: engagements with finance details due but empty, in the list order
  const pendingBar = useMemo(() => pendingItems(filtered.filter(r => keyOf(r)), FIN_RULES, r => ({
    id: keyOf(r), serial: snoOf(r), title: r.company || '(no company)',
    subtitle: [r.egId, r.topic, fmtDate(r.startDate)].filter(Boolean).join(' · '),
  })), [filtered]);
  const openPending = (it, f) => { setSelected(it.id); setFocusN(n => n + 1); revealField(f.key, f.label); };

  // Reminders popup: invoice due (end date + 1) until invoiced, payment due (invoice date + 30) until received
  const dueBar = useMemo(() => filtered.filter(r => keyOf(r)).map(r => {
    const { invDue, payDue } = financeDates(r);
    const tasks = [];
    if (['To Invoice', 'Invoice Overdue', 'Upcoming'].includes(r._stage) && invDue) tasks.push({ key: 'invoice', label: 'Raise invoice', due: invDue });
    if (['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(r._stage) && payDue) tasks.push({ key: 'receivedDate', label: r._stage === 'Partly Received' ? 'Collect balance' : 'Collect payment', due: payDue });
    return {
      id: keyOf(r), serial: snoOf(r), title: r.company || '(no company)',
      subtitle: [r.egId, r.topic, totalOf(r) ? inr(totalOf(r)) : ''].filter(Boolean).join(' · '), tasks, row: r,
    };
  }).filter(x => x.tasks.length), [filtered]);
  const openDue = (it, t) => { setSelected(it.id); setFocusN(n => n + 1); revealField(t.key, t.key === 'invoice' ? 'Invoice Date' : 'Received Date'); };
  const sel = selected != null ? data.find(e => keyOf(e) === selected) : null;

  // ── Saving: one combined save per engagement, 1.2 s after the last change ─
  const pendingRef = useRef(new Map());   // Index → { ec, before, changes, timer }
  const runningRef = useRef(new Map());   // Index → promise
  const setSaving = (key, on) => setSavingKeys(prev => {
    if (prev.has(key) === on) return prev;
    const n = new Set(prev); on ? n.add(key) : n.delete(key); return n;
  });
  const patchRow = (key, values) => setData(prev => prev.map(e => (keyOf(e) === key ? { ...e, ...values } : e)));

  const runSave = async (key, p) => {
    // Make sure the Ops Checklist is loaded, so the copy is never skipped by accident
    let opsNow = opsRef.current;
    if (opsNow == null) {
      opsNow = await getOpsChecklist().catch(() => null);
      if (opsNow) setOps(opsNow);
      else { patchRow(key, p.before); showToast(`❌ ${p.ec.company}: not saved — the Ops Checklist could not be loaded. Please try again.`); return; }
    }
    const l = linkFor(p.ec, opsNow);
    const res = await saveEcFinance({ ec: p.ec, changes: p.changes, oc: l.state === 'ok' ? l.oc : null })
      .catch(e => ({ ok: false, reason: String(e?.message || e) }));
    if (res.ok) {
      if (res.ocChanges && Object.keys(res.ocChanges).length) {
        setOps(prev => (prev || []).map(o => (keyOf(o) === key ? { ...o, ...res.ocChanges } : o)));
      }
      showToast(`✓ ${p.ec.company} saved${res.opsCopied ? ' · Ops Checklist updated' : ''}`);
    } else {
      patchRow(key, p.before);   // screen goes back to what Excel holds
      showToast(`❌ ${p.ec.company}: not saved — ${res.reason}`);
    }
  };

  const flush = key => {
    const p = pendingRef.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current.delete(key);
    const job = (runningRef.current.get(key) || Promise.resolve()).catch(() => {}).then(() => runSave(key, p));
    runningRef.current.set(key, job);
    job.finally(() => {
      if (runningRef.current.get(key) === job) runningRef.current.delete(key);
      if (!pendingRef.current.has(key) && !runningRef.current.has(key)) setSaving(key, false);
    });
  };

  const handleEdit = (ec, changes) => {
    const key = keyOf(ec);
    if (!key) { showToast(`❌ ${ec.company}: S No ${snoOf(ec) || '—'} has no link ID (Index) in the Engagement Calendar, so it cannot be saved.`); return; }
    const p = pendingRef.current.get(key) || { ec, before: {}, changes: {} };
    for (const k of Object.keys(changes)) if (!(k in p.before)) p.before[k] = ec[k] ?? '';
    p.changes = { ...p.changes, ...changes };
    clearTimeout(p.timer);
    p.timer = setTimeout(() => flush(key), 1200);
    pendingRef.current.set(key, p);
    patchRow(key, changes);
    setSaving(key, true);
  };

  // Leaving the page sends waiting edits; closing the tab mid-save asks first
  useEffect(() => {
    const warn = e => { if (pendingRef.current.size || runningRef.current.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); [...pendingRef.current.keys()].forEach(flush); };
  }, []);

  const wrongLinks = ops == null ? 0 : rows.filter(r => linkOf(r).state === 'wrong').length;

  const exportCols = [
    { label: 'S No', get: r => snoOf(r) }, { label: 'EG ID', key: 'egId' }, { label: 'Company', key: 'company' },
    { label: 'Topic', key: 'topic' }, { label: 'Start Date', get: r => fmtDate(r.startDate) }, { label: 'End Date', get: r => fmtDate(r.endDate) },
    { label: 'Status', key: 'status' }, { label: 'Finance Stage', key: '_stage' },
    { label: 'Price (INR)', key: 'price' }, { label: 'Travel, Stay & Misc', key: 'travelExpenses' }, { label: 'GST (18%)', get: r => (num(r.price) ? gstOf(r) : '') }, { label: 'TDS (10%)', get: r => (num(r.price) ? tdsOf(r) : '') },
    { label: 'Amount to be Received (Price + GST − TDS)', get: r => (num(r.price) ? receivableOf(r) : '') },
    { label: 'Total to Receive (incl. Travel)', get: r => totalOf(r) || '' }, { label: 'Payment Status', key: 'payment' },
    { label: 'Invoice Date', get: r => (toIso(r.invoice) ? fmtDate(r.invoice) : '') },
    { label: 'Payment Due Date', get: r => { const d = financeDates(r).payDue; return d ? fmtDate(d) : ''; } },
    { label: 'Days Overdue', get: r => overdueDays(r) || '' },
    { label: 'Amount Received', key: 'amountReceived' }, { label: 'Received Date', get: r => (toIso(r.receivedDate) ? fmtDate(r.receivedDate) : '') },
    { label: 'Balance', get: r => (totalOf(r) ? totalOf(r) - num(r.amountReceived) : '') },
    { label: 'Invoice POC (Ops)', get: r => linkOf(r).oc?.invoicePoc ?? '' },
    { label: 'Invoice Comments (Ops)', get: r => linkOf(r).oc?.invoiceComment ?? '' },
    ...(ecHasExtraCols() ? [
      { label: 'Travel Invoice Raised', key: 'travelInvoiceRaised' },
      { label: 'Travel Invoice Date', get: r => (toIso(r.travelInvoiceDate) ? fmtDate(r.travelInvoiceDate) : '') }, { label: 'Travel Amount Received', key: 'travelReceived' },
      { label: 'Travel Received Amount (INR)', key: 'travelReceivedAmount' }, { label: 'Travel Received Date', get: r => (toIso(r.travelReceivedDate) ? fmtDate(r.travelReceivedDate) : '') },
    ] : []),
  ];

  if (error && !data.length) return <ErrorState error={error} onRetry={() => load({ force: true })} />;

  const overdueTag = n => n > 0 && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginLeft: 6 }}>{n} overdue</span>;

  return (
    <div className="tracker-page">
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, maxWidth: 520, zIndex: 999, fontSize: 13, fontWeight: 600, color: '#fff', padding: '10px 20px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          background: toast.startsWith('❌') ? '#b91c1c' : toast.startsWith('⚠') ? '#b45309' : toast.startsWith('✓') ? '#15803d' : 'var(--primary)' }}>
          {toast}
        </div>
      )}

      {/* KPIs — click to filter */}
      <div className="kpi-compact">
        <div className="kpi-card accent" style={{ cursor: 'pointer' }} onClick={() => setStageF('All')}>
          <div className="kpi-label">Engagements · {rangeLabel}</div><div className="kpi-value">{kpiRows.length}</div>{(kpiRows.length !== rows.length || filtered.length !== kpiRows.length) && <div className="kpi-sub">{filtered.length !== kpiRows.length ? `${filtered.length} in list · ` : ''}of {rows.length} in period</div>}
        </div>
        <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => setStageF('All To Invoice')} title="Engagement ended, invoice not raised yet">
          <div className="kpi-label">To Invoice</div><div className="kpi-value">{count('Invoice Overdue', 'To Invoice')}{overdueTag(count('Invoice Overdue'))}</div>
        </div>
        <div className="kpi-card blue" style={{ cursor: 'pointer' }} onClick={() => setStageF('All Awaiting Payment')} title="Invoice raised, not fully paid">
          <div className="kpi-label">Awaiting Payment</div><div className="kpi-value">{count('Awaiting Payment', 'Payment Overdue', 'Partly Received')}{overdueTag(kpiRows.filter(r => overdueDays(r) > 0).length)}</div>
        </div>
        <div className="kpi-card green" style={{ cursor: 'pointer' }} onClick={() => setStageF('Received')}>
          <div className="kpi-label">Received</div><div className="kpi-value">{count('Received')}</div>
        </div>
      </div>

      {!rangeLoading && (
        <PendingFieldsBar items={pendingBar} dueItems={dueBar} onPick={openPending} onPickDue={openDue} canEdit={canEditFin} storageKey="finance" noun="engagement" />
      )}

      {wrongLinks > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 12px', marginBottom: 8, fontSize: 12, color: '#7f1d1d' }}>
          ⚠ {wrongLinks} engagement{wrongLinks > 1 ? 's' : ''} in this period are linked to a different engagement's Ops Checklist row — finance is saved to the Engagement Calendar, but nothing is copied to that Ops row. Open the engagement for details.
        </div>
      )}

      <div className="grid-sidebar" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* LEFT — engagement list */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div className="filter-bar" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn btn-outline btn-sm" onClick={() => shift(-1)} title="Previous period">◀</button>
            <span style={{ fontSize: 12, fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{rangeLabel}</span>
            <button className="btn btn-outline btn-sm" onClick={() => shift(1)} title="Next period">▶</button>
            {!containsToday && <button className="btn btn-outline btn-sm" onClick={goToday}>Today</button>}
            <select className="form-input" value={span} onChange={e => changeSpan(Number(e.target.value))} title="Months shown">
              {SPAN_OPTIONS.map(n => <option key={n} value={n}>{n === 12 ? '12 months' : n === 1 ? '1 month' : `${n} months`}</option>)}
            </select>
            <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID, S No…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="form-input" value={stageF} onChange={e => setStageF(e.target.value)}>
              {['All', 'Overdue (30+ days)', 'Needs Action', 'All To Invoice', 'All Awaiting Payment', ...Object.keys(STAGES)].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={() => load({ force: true, keepCurrent: true })} disabled={syncing} title={syncing ? 'Refreshing from Excel…' : 'Refresh'}>{syncing ? '⟳' : '↺'}</button>
            <ExportButton page="finance" filename={`Finance Tracker ${rangeLabel}`} sheetName="Finance Tracker" rows={() => filtered} columns={exportCols} disabled={rangeLoading} />
          </div>

          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="card-header" style={{ flexShrink: 0 }}>
              <span className="card-title">💰 Engagements</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{syncing && !rangeLoading ? '⟳ ' : ''}{filtered.length} of {rows.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rangeLoading
                ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="ec-skel" style={{ height: 64, margin: '8px 12px', borderRadius: 8, background: '#f1f5f9' }} />)
                : filtered.length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>No engagements in {rangeLabel}</div>
                  : filtered.map(r => {
                      const key = keyOf(r);
                      const isSel = selected === key;
                      const { invDue, payDue } = financeDates(r);
                      const total = totalOf(r);
                      const l = linkOf(r);
                      const late = overdueDays(r);
                      return (
                        <div key={key || `${r.egId}|${r.sno}`} onClick={() => key && setSelected(isSel ? null : key)} style={{
                          padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                          background: isSel ? '#f0f7ff' : late ? '#fef2f2' : 'transparent',
                          borderLeft: isSel ? '3px solid var(--accent)' : late ? '3px solid #dc2626' : '3px solid transparent',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', background: 'var(--border)', borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>{snoOf(r) || '—'}</span>
                                <span style={{ fontWeight: 700, fontSize: 13 }}>{r.company}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.topic}>{r.topic}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              {savingKeys.has(key) && <span title="Saving…" style={{ fontSize: 11, marginRight: 4 }}>⏳</span>}
                              {l.state === 'wrong' && <span title="Linked Ops Checklist row is a different engagement" style={{ fontSize: 10, fontWeight: 800, color: '#b91c1c', marginRight: 4 }}>⚠ Ops link</span>}
                              <StageBadge stage={r._stage} />
                              {late > 0 && <div style={{ marginTop: 4 }}><OverdueTag days={late} /></div>}
                              {total > 0 && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{inr(total)}</div>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                            <span>📅 {fmtDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? ` → ${fmtDate(r.endDate)}` : ''}</span>
                            {r.egId && <span style={{ fontFamily: 'monospace' }}>{r.egId}</span>}
                            {['To Invoice', 'Invoice Overdue', 'Upcoming'].includes(r._stage) && invDue && <span style={{ color: dueColor(invDue), fontWeight: 600 }}>🧾 Invoice by {fmtDate(invDue)}</span>}
                            {toIso(r.invoice) && <span>🧾 Invoiced {fmtDate(r.invoice)}</span>}
                            {['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(r._stage) && payDue && <span style={{ color: late ? '#dc2626' : dueColor(payDue), fontWeight: late ? 800 : 600 }}>💳 Payment due {fmtDate(payDue)}{late ? ` · ${late} days overdue` : ''}</span>}
                            {num(r.amountReceived) > 0 && <span>💰 {inr(r.amountReceived)} received</span>}
                          </div>
                        </div>
                      );
                    })}
            </div>
          </div>
        </div>

        {/* RIGHT — detail panel */}
        <div style={{ height: '100%', overflowY: 'auto' }}>
          {sel
            ? <FinancePanel key={keyOf(sel)} ec={sel} link={linkOf(sel)} canEdit={canEditFin} onEdit={handleEdit} saving={savingKeys.has(keyOf(sel))} focusN={focusN} />
            : (
              <div className="card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👈</div>
                <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>Select an engagement</div>
                <div style={{ fontSize: 13 }}>Click any engagement on the left to update its invoice and payment details</div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
