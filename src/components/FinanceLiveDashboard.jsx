/**
 * Finance dashboard — same charts, tables and layout as the Finance tab of the standalone EuRadicle Dashboard HTML report.
 *
 * Live source: the Engagement Calendar finance columns (the same values the Finance Tracker page edits)
 *   Price (INR), Travel / Stay & Misc, GST, Invoice (date), Payment, Amount Received, Received Date, Day, End Date.
 *
 * Definitions (FY 2026-27 onward)
 *   Revenue          Price (INR) of rows with an Invoice date, by invoice month (₹ Lakhs, GST excluded)
 *   Invoice          one Company + Invoice date (several session rows billed together count once)
 *   Billing days     "Day" of the invoiced rows, by invoice month
 *   Collection       Amount Received (or the full invoice when Payment = Received and no amount is entered),
 *                    WITHOUT Travel / Stay & Misc — never more than Price + GST (travel is not revenue or collection). Counted in the selected period by Received Date
 *                    (by Invoice date when no Received Date is filled).
 *   Period           the KPI cards and the summary follow the period picker (This month … Custom dates);
 *                    the FY × month charts always show whole financial years.
 *   Invoice amount   Price + Travel / Stay & Misc + GST
 *   Due in market    invoice amount − received, for every invoice not marked Received / NA (any year)
 *   Overdue          the part of that due whose Invoice date + 30 days has passed
 *   To be raised     sessions that have ended, are not Cancelled / NA and have no Invoice date
 * Earlier years (Apr–Oct as recorded) and credit notes: fixed, Dashboard Report Data (12 Oct 2026).
 */
import { useMemo, useState, useEffect } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, TL, GD, GN, PU, RD, bOpts, fmtNum,
  CURRENT_FY, fyStartOf, fyLong, todayISO, clean, keyOf,
} from './erdCharts.jsx';
import { normPayment } from '../services/syncWithEC.js';
import { money, collectedOf, expectedOf, invoiceExTravel, suspectReceipts } from '../services/money.js';
import { PERIODS, periodRange, periodLabelOf, inRange } from '../services/actionItems.js';
// Same stage / overdue rules as the Finance Tracker page, so the two always agree
import { financeStage, overdueDays } from '../pages/FinanceTracker.jsx';
import {
  LIVE_FROM_FY, FIN_REVENUE_L, FIN_INVOICES, FIN_BILLING_DAYS, FIN_AVG_PER_DAY, FIN_CREDIT_NOTES, FIN_TARGET_CR,
} from '../config/dashboardBaseline.js';

const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
const COLORS = [TL, GD, NV, PU, GN, RD, '#3B82F6', '#0EA5A4', '#F97316', '#64748B', '#A855F7', '#84CC16'];
const CREDIT_DAYS = 30;
const slot = iso => (+iso.slice(5, 7) + 8) % 12;           // Apr = 0 … Mar = 11
const num = v => money(v);   // reads "1,50,000", "₹ 50,000", "1.5 L"; ignores dates typed next to the amount
const L = v => v / 1e5;                                      // ₹ → Lakhs
const fmtL = v => { const n = Number(v) || 0; return Math.abs(n) >= 100 ? `Rs.${(n / 100).toFixed(2)} Cr` : `Rs.${n.toFixed(2)}L`; };   // v in Lakhs
const PERIOD_KEY = 'ercrm.dash.finance.period.v1';
const BASIS_KEY = 'ercrm.dash.finance.basis.v1';
const NOT_REVENUE = /cancel|lost|drop|postpon|hold/i;     // same rule as the Sales tab
function readBasis() { try { return localStorage.getItem(BASIS_KEY) === 'invoice' ? 'invoice' : 'delivery'; } catch { return 'delivery'; } }
function readPeriod() {
  try { const v = JSON.parse(localStorage.getItem(PERIOD_KEY) || 'null'); if (v && PERIODS.some(p => p.id === v.id)) return v; } catch { /* storage blocked */ }
  return { id: 'fy', custom: null };
}
const fyShortName = y => `${y}-${y + 1}`;                    // 2026-2027 (as in the Excel)
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = iso => (iso ? `${+iso.slice(8, 10)} ${MON3[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');
function toIso(d) {
  const s = clean(d);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) { if (n > 25000) { const dt = new Date(Math.round((n - 25569) * 86400 * 1000)); return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10); } return ''; }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

/** FY × Month grouped bars — fyMonthChart in the HTML report (FY total under each label). */
function fyMonthConfig(rows, months, totFmt) {
  return { type: 'bar',
    data: {
      labels: rows.map(r => [r.label, `Total: ${totFmt(r.values.slice(0, months.length).reduce((s, v) => s + v, 0))}`]),
      datasets: months.map((m, i) => ({ label: m, data: rows.map(r => r.values[i] || 0), backgroundColor: COLORS[i % COLORS.length], borderRadius: 4 })),
    },
    options: { ...bOpts(false, false), layout: { padding: { top: 52 } },
      plugins: { legend: { position: 'top' },
        datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'end', rotation: -90, offset: 2, clamp: true, padding: 2,
          formatter: v => (v > 0 ? fmtNum(Math.round(v * 100) / 100) : ''), font: { size: 11, weight: '700' }, color: '#374151' } } } };
}

export default function FinanceLiveDashboard({ engagements, refreshing }) {
  const NOW_SLOT = slot(todayISO);   // read each render (todayISO moves on at midnight)
  const [period, setPeriod] = useState(readPeriod);
  useEffect(() => { try { localStorage.setItem(PERIOD_KEY, JSON.stringify(period)); } catch { /* storage blocked */ } }, [period]);
  const range = useMemo(() => periodRange(period.id, todayISO, period.custom), [period, todayISO]);   // eslint-disable-line react-hooks/exhaustive-deps
  const periodName = periodLabelOf(period.id, period.custom);
  // Revenue by: 'delivery' = session start month (as the Sales tab and the COMPARISON sheet) · 'invoice' = Invoice date month
  const [basis, setBasis] = useState(readBasis);
  useEffect(() => { try { localStorage.setItem(BASIS_KEY, basis); } catch { /* storage blocked */ } }, [basis]);
  const setCustom = (k, v) => setPeriod(p => ({ ...p, custom: { ...range, ...(p.custom || {}), [k]: v } }));
  /* Engagement Calendar rows with their finance values */
  const rows = useMemo(() => (engagements || []).map(e => {
    const inv = toIso(e.invoice);
    const end = toIso(e.endDate) || toIso(e.startDate);
    const p = normPayment(e.payment);
    const amount = expectedOf(e);       // Price + GST (18%) − TDS (10%) + Travel — what the client still has to pay
    const col = collectedOf(e);          // capped at the invoice amount; suspect = cell needs checking
    const stage = financeStage(e);
    return {
      ...e, inv, end, p, amount, price: num(e.price), got: col.gross, col: col.amount, net: invoiceExTravel(e), suspect: col.suspect, rec: toIso(e.receivedDate), stage,
      cancelled: stage === 'Cancelled',
      invFy: inv ? fyStartOf(inv) : null,
      start: toIso(e.startDate),
      notRevenue: NOT_REVENUE.test(clean(e.status)),
    };
  }), [engagements]);

  /* Revenue date of a row for the chosen basis ('' = not revenue) */
  const revDate = r => (basis === 'invoice' ? (r.inv && !r.cancelled ? r.inv : '') : (r.start && !r.notRevenue ? r.start : ''));

  /* ── Monthly series for live FYs (revenue by the chosen basis; invoices and billing days by invoice month) ── */
  const live = useMemo(() => {
    const out = {};
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) out[y] = { rev: Array(12).fill(0), inv: Array(12).fill(0), days: Array(12).fill(0), invSet: Array.from({ length: 12 }, () => new Set()) };
    rows.forEach(r => {
      const rd = revDate(r);
      if (rd && out[fyStartOf(rd)]) out[fyStartOf(rd)].rev[slot(rd)] += L(r.price);
      if (!r.inv || r.cancelled || !out[r.invFy]) return;
      const o = out[r.invFy], s = slot(r.inv);
      o.days[s] += Number(r.day) > 0 ? Number(r.day) : 0;
      o.invSet[s].add(`${keyOf(r.company)}|${r.inv}`);
    });
    Object.values(out).forEach(o => { o.inv = o.invSet.map(s => s.size); });
    return out;
  }, [rows, basis]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Months shown: April → current month (same-period comparison with the earlier years, like the Excel)
  const months = MONTHS.slice(0, Math.max(7, NOW_SLOT + 1));
  const series = (fixed, key) => {
    const out = Object.entries(fixed).map(([y, v]) => ({ label: fyShortName(+y), values: v }));
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) out.push({ label: fyShortName(y), values: live[y][key].map(v => Math.round(v * 100) / 100) });
    return out;
  };
  const revRows = useMemo(() => series(FIN_REVENUE_L, 'rev'), [live]);        // eslint-disable-line react-hooks/exhaustive-deps
  const invRows = useMemo(() => series(FIN_INVOICES, 'inv'), [live]);         // eslint-disable-line react-hooks/exhaustive-deps
  const dayRows = useMemo(() => series(FIN_BILLING_DAYS, 'days'), [live]);    // eslint-disable-line react-hooks/exhaustive-deps
  const revCfg = useMemo(() => fyMonthConfig(revRows, months, t => `${fmtNum(Math.round(t * 100) / 100)}L`), [revRows]);   // eslint-disable-line react-hooks/exhaustive-deps
  const invCfg = useMemo(() => fyMonthConfig(invRows, months, t => fmtNum(t)), [invRows]);                                 // eslint-disable-line react-hooks/exhaustive-deps
  const dayCfg = useMemo(() => fyMonthConfig(dayRows, months, t => `${fmtNum(Math.round(t * 100) / 100)} days`), [dayRows]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Current FY totals ── */
  const cur = live[CURRENT_FY];
  const curRevL = cur.rev.reduce((s, v) => s + v, 0);
  const curInvoices = cur.inv.reduce((s, v) => s + v, 0);
  const curDays = cur.days.reduce((s, v) => s + v, 0);
  const curMonthsNamed = MONTHS.filter((m, i) => cur.rev[i] > 0).join(' + ');
  const collectionL = L(rows.filter(r => r.invFy === CURRENT_FY && !r.cancelled).reduce((s, r) => s + r.col, 0));

  /* ── Selected period (KPI cards) ── */
  const pk = useMemo(() => {
    const inv = rows.filter(r => r.inv && !r.cancelled && inRange(r.inv, range));
    const invoices = new Set(inv.map(r => `${keyOf(r.company)}|${r.inv}`)).size;
    const revRows = rows.filter(r => { const d = revDate(r); return d && inRange(d, range); });
    const revenue = revRows.reduce((s, r) => s + r.price, 0);
    const invoiced = inv.reduce((s, r) => s + r.net, 0);          // Price + GST, travel excluded
    const paid = rows.filter(r => !r.cancelled && r.col > 0 && (r.rec ? inRange(r.rec, range) : (r.inv && inRange(r.inv, range))));
    const collected = paid.reduce((s, r) => s + r.col, 0);
    const months = [...new Set(revRows.map(r => MONTHS[slot(revDate(r))]))];
    return { invoices, revenueL: L(revenue), invoicedL: L(invoiced), collectedL: L(collected), payments: paid.length, months,
      suspects: suspectReceipts(engagements) };
  }, [rows, range, basis, engagements]);   // eslint-disable-line react-hooks/exhaustive-deps
  const collectPct = pk.invoicedL > 0 ? Math.round((pk.collectedL / pk.invoicedL) * 100) : null;

  /* ── Dues: every invoice not fully received (any year) ── */
  const dues = useMemo(() => rows
    .filter(r => r.inv && ['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(r.stage) && r.amount - r.got > 0)
    .map(r => {
      const due = addDays(r.inv, CREDIT_DAYS);
      const past = overdueDays(r);   // Finance Tracker rule: invoice date + 30 days
      return { r, dueDate: due, pastDays: past, open: r.amount - r.got, overdue: past > 0 };
    })
    .sort((a, b) => b.pastDays - a.pastDays || b.open - a.open), [rows]);
  const dueTotal = L(dues.reduce((s, d) => s + d.open, 0));
  const overdueTotal = L(dues.filter(d => d.overdue).reduce((s, d) => s + d.open, 0));
  const byClient = useMemo(() => {
    const m = new Map();
    dues.forEach(d => {
      const k = keyOf(d.r.company) || '(no company)';
      if (!m.has(k)) m.set(k, { client: clean(d.r.company) || '(no company)', out: 0, overdue: 0, dueMonths: new Set(), past: 0 });
      const g = m.get(k);
      g.out += d.open; if (d.overdue) g.overdue += d.open;
      g.dueMonths.add(MON3[+d.dueDate.slice(5, 7) - 1]);
      g.past = Math.max(g.past, d.pastDays);
    });
    return [...m.values()].sort((a, b) => b.out - a.out);
  }, [dues]);

  /* ── To be invoiced: ended sessions with no invoice date ── */
  const toInvoice = useMemo(() => {
    const m = new Map();
    // Finance Tracker "To Invoice" + "Invoice Overdue" stages (engagement ended, no invoice yet)
    rows.filter(r => ['Invoice Overdue', 'To Invoice'].includes(r.stage) && r.amount > 0)
      .forEach(r => {
        const k = `${keyOf(r.company)}|${keyOf(r.topic)}`;
        if (!m.has(k)) m.set(k, { client: clean(r.company), topic: clean(r.topic), amount: 0, first: r.end, last: r.end, po: clean(r.poStatus), sessions: 0 });
        const g = m.get(k);
        g.amount += r.amount; g.sessions++;
        if (r.end && (!g.first || r.end < g.first)) g.first = r.end; if (r.end > g.last) g.last = r.end;
        if (!g.po && clean(r.poStatus)) g.po = clean(r.poStatus);
      });
    return [...m.values()].map(g => ({ ...g, waiting: g.last ? daysBetween(g.last, todayISO) : null })).sort((a, b) => b.amount - a.amount);
  }, [rows]);
  const toInvoiceL = L(toInvoice.reduce((s, t) => s + t.amount, 0));

  /* ── Average revenue per engaged day ── */
  const avgRows = useMemo(() => {
    const out = FIN_AVG_PER_DAY.map(r => ({ fy: fyShortName(r.fy), rev: r.revenueL, days: r.days, note: 'Full year (Excel)' }));
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) {
      const rev = live[y].rev.reduce((s, v) => s + v, 0), days = live[y].days.reduce((s, v) => s + v, 0);
      out.push({ fy: fyShortName(y), rev, days, note: y === CURRENT_FY ? 'Live — year to date, invoiced sessions' : 'Live — invoiced sessions' });
    }
    out.forEach(r => { r.avg = r.days > 0 ? r.rev / r.days : 0; });
    const tr = out.reduce((s, r) => s + r.rev, 0), td = out.reduce((s, r) => s + r.days, 0);
    return { rows: out, grand: { fy: 'Grand Total', rev: tr, days: td, avg: td > 0 ? tr / td : 0, note: '' } };
  }, [live]);

  const credit = FIN_CREDIT_NOTES[CURRENT_FY] || [];
  const target = FIN_TARGET_CR[CURRENT_FY];
  const yetL = Math.max(0, dueTotal - overdueTotal);
  const summary = [
    ['No. of Invoices Raised', fmtNum(curInvoices)],
    ['Total Revenue (L)', curRevL.toFixed(2)],
    ['Collection (L)', collectionL.toFixed(2)],
    ['To be Raised (L)', toInvoiceL.toFixed(2)],
    ['Raised within Timeline - Yet to Receive (L)', yetL.toFixed(2)],
    ['Raised within Timeline - Overdue (L)', overdueTotal.toFixed(2)],
    ['Total Due in Market (L)', dueTotal.toFixed(2)],
    ...(target ? [['Total Targeted Revenue (CR)', String(target)], ['Achieved vs Target', `${((curRevL / (target * 100)) * 100).toFixed(1)}%`]] : []),
  ];
  const curName = fyLong(CURRENT_FY);

  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Finance</h2><p>Revenue, invoices &amp; outstanding collections</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward and all dues from the Engagement Calendar finance columns (same values as the Finance Tracker)`}
                  fixed="earlier years (Apr–Oct) and credit notes from Dashboard Report Data (12 Oct 2026)" />

      <div className="erd-period" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '4px 0 12px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--e-text2, #6B7280)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Period</span>
        <select className="form-input" style={{ height: 34, fontSize: 13, minWidth: 150, width: 'auto' }} value={period.id} onChange={e => setPeriod(p => ({ ...p, id: e.target.value }))}>
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {period.id === 'custom' && (<>
          <input type="date" className="form-input" style={{ height: 34, fontSize: 13, width: 'auto' }} value={range.from} max={range.to} onChange={e => setCustom('from', e.target.value)} />
          <span style={{ fontSize: 12, color: '#6B7280' }}>to</span>
          <input type="date" className="form-input" style={{ height: 34, fontSize: 13, width: 'auto' }} value={range.to} min={range.from} onChange={e => setCustom('to', e.target.value)} />
        </>)}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--e-text2, #6B7280)', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 8 }}>Revenue by</span>
        <div className="erd-seg">
          {[['delivery', 'Delivery month'], ['invoice', 'Invoice month']].map(([k, l]) => (
            <button key={k} type="button" className={basis === k ? 'on' : ''} aria-pressed={basis === k} onClick={() => setBasis(k)}
              title={k === 'delivery' ? 'Session start date — same as the Sales tab and the COMPARISON sheet' : 'Invoice date — when the bill was raised'}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: '#6B7280', flexBasis: '100%' }}>{period.id === 'all' ? 'All dates' : `${fmtDate(range.from)} → ${fmtDate(range.to)}`} · cards below follow this period; charts show whole financial years</span>
      </div>

      <div className="kg g3">
        <Kpi tone="gd" label="No. of Invoices Raised" value={fmtNum(pk.invoices)} sub={`Invoices raised · ${periodName}`} how="Distinct Company + Invoice date pairs with an Invoice date in the period (several session rows billed together count once); cancelled excluded." />
        <Kpi tone="tl" label="Total Revenue" value={fmtL(pk.revenueL)} sub={pk.months.length && pk.months.length <= 4 ? `${pk.months.join(' + ')} · price excl. GST` : `${basis === 'invoice' ? 'Invoiced' : 'Delivered / scheduled'} price excl. GST · ${periodName}`}
             how={basis === 'invoice' ? 'Sum of Price (INR) of rows whose Invoice date falls in the period; GST and travel excluded, cancelled rows excluded.' : 'Sum of Price (INR) of sessions whose start date falls in the period (cancelled / lost / postponed / on hold excluded); GST and travel excluded.'} />
        <Kpi tone="gn" label="Collection" value={fmtL(pk.collectedL)} sub={`${pk.payments} payment(s) · ${periodName}${collectPct != null ? ` · ${collectPct}% of ${fmtL(pk.invoicedL)} invoiced` : ''} · excl. travel & stay`} tag="Collected" tagTone="up"
             how="Amount Received counted on the Received Date in the period (Invoice date when Received Date is blank); Price + GST only — travel excluded — and never above the invoice value." />
      </div>
      {pk.suspects.length > 0 && (
        <div style={{ fontSize: 12, color: '#7f1d1d', background: '#FFF5F5', borderLeft: '3px solid #E98272', borderRadius: 6, padding: '8px 12px', margin: '-4px 0 12px' }}>
          {pk.suspects.length} "Amount Received" cell{pk.suspects.length > 1 ? 's need' : ' needs'} checking (capped at the row's bill meanwhile):{' '}
          {pk.suspects.slice(0, 6).map(({ e, reason }) => `${clean(e.company)}${e.sno ? ` (S No ${e.sno})` : ''}: "${clean(e.amountReceived)}" — ${reason}`).join(' · ')}{pk.suspects.length > 6 ? ' …' : ''}. Payments split over several rows of one invoice, or several payments in one cell ("140400, 48492"), are handled automatically.
        </div>
      )}
      <div className="kg g4">
        <Kpi tone="pu" label="To be Raised" value={fmtL(toInvoiceL)} sub={`${toInvoice.length} program(s) delivered, not yet invoiced`} tag="Pending" tagTone="warn" how="Price + GST (18%) − TDS (10%) + travel of sessions that have ended, are not cancelled / NA and have no Invoice date yet (all dates, not the period)." />
        <Kpi tone="nv" label="Raised within Timeline – Yet to Receive" value={fmtL(yetL)} sub={`Invoiced, within ${CREDIT_DAYS}-day credit period`} tag="Within credit period" how="Unpaid balance — (Price + GST − TDS + travel) − amount received — of invoices raised less than 30 days ago; all years." />
        <Kpi tone="rd" label="Raised within Timeline – Overdue" value={fmtL(overdueTotal)} sub="Past due date, pending collection" tag="Overdue" tagTone="bad" how="Unpaid balance of invoices whose Invoice date + 30 days has passed and that are not marked Received / NA." />
        <Kpi tone="rd" label="Total Due in Market" value={fmtL(dueTotal)} sub={`${byClient.length} clients · all outstanding market dues`} tag="Watch" tagTone="bad" how="Yet to receive + Overdue: every invoice not marked Received / NA, any year — Price + GST − TDS + travel, less what has been received." />
      </div>

      <div className="cg c11">
        <div className="card"><h3>Revenue by FY (Rs. Lakhs)</h3><div className="cs">Monthly revenue per financial year (FY total shown with label) · April → {months[months.length - 1]} · live years by {basis === 'invoice' ? 'Invoice date' : 'session start date'}; earlier years fixed from the Excel report</div><ChartBox config={revCfg} className="ch-wrap tall" /></div>
        <div className="card"><h3>Invoices &amp; Vouchers Raised</h3><div className="cs">Count per month by financial year (FY total shown with label)</div><ChartBox config={invCfg} className="ch-wrap tall" /></div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Outstanding Payments Due</h3>
          <div className="cs">Total outstanding: {fmtL(dueTotal)} across {byClient.length} clients · Amount due now: {fmtL(overdueTotal)} ({byClient.filter(c => c.overdue > 0).length} clients) · values in Rs. Lakhs</div>
          <div className="tbl-x"><table className="mt">
            <thead><tr><th>Client / Description</th><th className="nr">Total Outstanding (L)</th><th>Due Dates</th><th>Credit Period</th><th className="nr">Amount Due (L)</th><th className="nr">Past Due Days</th></tr></thead>
            <tbody>
              {byClient.length === 0 && <tr><td colSpan={6} className="erd-empty">No outstanding invoices</td></tr>}
              {byClient.map(c => (
                <tr key={c.client}><td style={{ fontWeight: 600 }}>{c.client}</td><td className="nr">{L(c.out).toFixed(2)}</td><td>{[...c.dueMonths].join('-')}</td>
                  <td>{CREDIT_DAYS} days</td><td className="nr" style={{ color: c.overdue > 0 ? RD : undefined }}>{L(c.overdue).toFixed(2)}</td><td className="nr">{c.past} Days</td></tr>
              ))}
              {byClient.length > 0 && <tr className="tot"><td>Total</td><td className="nr">{dueTotal.toFixed(2)}</td><td /><td /><td className="nr">{overdueTotal.toFixed(2)}</td><td /></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Outstanding Payments — Invoice-Level Breakdown</h3>
          <div className="cs">Invoice-level dues: {fmtL(dueTotal)} across {dues.length} line items</div>
          <div className="mt-scroll"><table className="mt">
            <thead><tr><th>Client / Description</th><th className="nr">Amount Due (Rs. L)</th><th>Invoice Date</th><th>Due Date</th><th>Type</th></tr></thead>
            <tbody>
              {dues.map((d, i) => (
                <tr key={i}><td>{clean(d.r.company)} — <span style={{ opacity: 0.75 }}>{clean(d.r.topic)}</span></td><td className="nr" style={{ whiteSpace: 'nowrap' }}>{L(d.open).toFixed(2)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.r.inv)}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.dueDate)}</td>
                  <td style={{ color: d.overdue ? RD : undefined, fontWeight: d.overdue ? 700 : 400 }}>{d.overdue ? `Overdue · ${d.pastDays} days` : d.r.p === 'Partly Received' ? 'Partly received' : 'Within credit period'}</td></tr>
              ))}
              {dues.length > 0 && <tr className="tot"><td>Total</td><td className="nr">{dueTotal.toFixed(2)}</td><td /><td /><td /></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>To be Invoiced — Pending Billing</h3>
          <div className="cs">Pending billing: {fmtL(toInvoiceL)} across {toInvoice.length} program(s) — sessions ended with no Invoice date</div>
          <div className="mt-scroll"><table className="mt">
            <thead><tr><th>Client</th><th className="nr">Amount (Rs. L)</th><th>Program Details</th><th>Program Dates</th><th>Reason Pending</th></tr></thead>
            <tbody>
              {toInvoice.length === 0 && <tr><td colSpan={5} className="erd-empty">Nothing pending — every ended session has an Invoice date</td></tr>}
              {toInvoice.map((t, i) => (
                <tr key={i}><td style={{ fontWeight: 600 }}>{t.client}</td><td className="nr" style={{ whiteSpace: 'nowrap' }}>{L(t.amount).toFixed(2)}</td><td>{t.topic}{t.sessions > 1 ? ` (${t.sessions} sessions)` : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.first === t.last ? fmtDate(t.first) : `${fmtDate(t.first)} – ${fmtDate(t.last)}`}</td>
                  <td style={{ fontSize: 12, color: 'var(--e-text2)' }}>{t.po ? `PO: ${t.po} · ` : ''}Invoice not raised · {t.waiting != null ? `${t.waiting} days since last session` : 'no session date in the Engagement Calendar'}</td></tr>
              ))}
              {toInvoice.length > 0 && <tr className="tot"><td>Total</td><td className="nr">{toInvoiceL.toFixed(2)}</td><td /><td /><td /></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Invoice &amp; Payment Summary</h3><div className="cs">{curName} — calculated live from the Engagement Calendar finance columns</div>
          <div className="tbl-x"><table className="mt">
            <thead><tr><th>Field</th><th className="nr">Value</th></tr></thead>
            <tbody>{summary.map(([k, v]) => <tr key={k}><td style={{ fontWeight: 600 }}>{k}</td><td className="nr">{v}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>No. of Billing Days per Month</h3><div className="cs">Monthly billing distribution by financial year (FY total shown with label)</div><ChartBox config={dayCfg} className="ch-wrap tall" /></div>
        <div className="card"><h3>Average Revenue per Engaged Day</h3><div className="cs">Revenue efficiency by financial year (Rs. Lakhs per engaged day)</div>
          <table className="mt">
            <thead><tr><th>Financial Year</th><th className="nr">Total Revenue (Rs. L)</th><th className="nr">Engaged Days</th><th className="nr">Avg / Day (Rs. L)</th><th>Notes</th></tr></thead>
            <tbody>
              {avgRows.rows.map(r => (
                <tr key={r.fy}><td style={{ whiteSpace: 'nowrap' }}>{r.fy}</td><td className="nr">{r.rev.toFixed(2)}</td><td className="nr">{fmtNum(Math.round(r.days * 100) / 100)}</td><td className="nr">{r.avg.toFixed(2)}</td><td style={{ fontSize: 12, color: 'var(--e-text2)' }}>{r.note}</td></tr>
              ))}
              <tr className="tot"><td>Grand Total</td><td className="nr">{avgRows.grand.rev.toFixed(2)}</td><td className="nr">{fmtNum(Math.round(avgRows.grand.days * 100) / 100)}</td><td className="nr">{avgRows.grand.avg.toFixed(2)}</td><td /></tr>
            </tbody>
          </table>
          <div className="mt-note">Live years: Price (INR) of invoiced sessions ÷ their "Day" total. Curr. year revenue {fmtL(curRevL)} over {fmtNum(Math.round(curDays * 100) / 100)} days.</div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Credit Notes — {curName}</h3><div className="cs">Credit notes raised this financial year (no tracker column yet — values from the Excel)</div>
          <table className="mt">
            <thead><tr><th>Credit Note</th><th className="nr">Count</th><th className="nr">Value</th><th>Date / Notes</th></tr></thead>
            <tbody>
              {credit.length === 0 && <tr><td colSpan={4} className="erd-empty">No credit notes recorded for {curName}</td></tr>}
              {credit.map((c, i) => <tr key={i}><td>{c[0]}</td><td className="nr">{c[1]}</td><td className="nr">{fmtL(c[2])}</td><td>{c[3]}</td></tr>)}
              {credit.length > 0 && <tr className="tot"><td>Total</td><td className="nr">{credit.reduce((s, c) => s + c[1], 0)}</td><td className="nr">{fmtL(credit.reduce((s, c) => s + c[2], 0))}</td><td /></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
