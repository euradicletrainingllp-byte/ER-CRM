import { useState, useEffect, useMemo, useRef } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { peekList, getOpsChecklist, updateOpsRow, peekAllEngagements, getAllEngagementsCached, readTrackerFresh, rawOpsRowFor } from '../services/api.js';
import { syncOpsFinanceToEC, OPS_FINANCE_TO_EC, updateECFinanceAmounts, ecMatchesOps, suggestEcIndex } from '../services/syncWithEC.js';
import { usePermissions } from '../hooks/usePermissions.js';
import ExportButton from '../components/ExportButton.jsx';

/**
 * Finance Tracker
 * ───────────────
 * Same engagements as the Ops Checklist (the finance columns live in the Ops Checklist
 * Excel table), but this is the ONLY place invoice / payment details are edited.
 * The Ops Checklist shows them read-only.
 * Travel, Stay & Misc and GST are edited here too and saved straight to the
 * Engagement Calendar row with the same Index (those columns only exist there).
 * Price, Amount Received, Contract and PO Status are shown from the EC read-only.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────
const addDays = (dateStr, n) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const fmtDate = d => {
  if (!d) return '—';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return s;
    return `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${String(dt.getUTCFullYear()).slice(2)}`;
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
    const [y,m,day] = s.split('-');
    return `${day.slice(0,2)}/${m}/${y.slice(2)}`;
  }
  return s;
};

const toInputDate = d => {
  if (!d) return '';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0, 10);
  // dd/mm/yyyy or dd/mm/yy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return '';
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const dueDateColor = (dueDate) => {
  if (!dueDate) return 'var(--muted)';
  const diff = (new Date(dueDate) - new Date()) / 86400000;
  if (diff < 0) return 'var(--red)';
  if (diff <= 3) return '#f59e0b';
  return 'var(--green)';
};

const inr = v => {
  if (v === '' || v == null) return '—';
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (isNaN(n)) return String(v);
  return '₹ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const ecTotal = ec => ec ? (Number(ec.price) || 0) + (Number(ec.travelExpenses) || 0) + (Number(ec.gst) || 0) : 0;

// Older rows used Yes/No for "Invoice Generated"
const isRaised = v => ['raised', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/** Invoice due = day after the engagement ends. Payment due = invoice date + 30 days. */
function financeDates(row) {
  const invDue = addDays(toInputDate(row.endDate) || toInputDate(row.startDate), 1);
  const payDue = row.invoiceActualDate ? addDays(toInputDate(row.invoiceActualDate), 30) : null;
  return { invDue, payDue };
}

// ─── Finance stage (one label per engagement) ───────────────────────────────
const STAGES = {
  'Invoice Overdue':  { color:'#b91c1c', bg:'#fee2e2' },
  'To Invoice':       { color:'#9a3412', bg:'#ffedd5' },
  'Upcoming':         { color:'#475569', bg:'#f1f5f9' },
  'Payment Overdue':  { color:'#b91c1c', bg:'#fee2e2' },
  'Awaiting Payment': { color:'#1d4ed8', bg:'#dbeafe' },
  'Paid':             { color:'#065f46', bg:'#dcfce7' },
  'Not Applicable':   { color:'#6b7280', bg:'#f3f4f6' },
  'Cancelled':        { color:'#6b7280', bg:'#f3f4f6' },
};

function financeStage(row) {
  const { invDue, payDue } = financeDates(row);
  const today = todayIso();
  const pay = String(row.paymentReceived ?? '').trim();
  const inv = String(row.invoiceGenerated ?? '').trim();
  if (String(row.status ?? '').trim() === 'Cancelled') return 'Cancelled';
  if (pay === 'Yes') return 'Paid';
  if (pay === 'NA' || inv === 'NA') return 'Not Applicable';
  if (isRaised(inv) || toInputDate(row.invoiceActualDate)) return payDue && payDue < today ? 'Payment Overdue' : 'Awaiting Payment';
  if (!invDue) return 'To Invoice';
  if (invDue < today) return 'Invoice Overdue';
  if (invDue === today) return 'To Invoice';
  return 'Upcoming';
}

function StageBadge({ stage }) {
  const s = STAGES[stage] || STAGES['Upcoming'];
  return (
    <span style={{ fontSize:10, fontWeight:700, color:s.color, background:s.bg, borderRadius:10, padding:'2px 8px', whiteSpace:'nowrap' }}>
      {stage}
    </span>
  );
}

const Field = ({ label, children, full }) => (
  <div style={full ? { gridColumn:'1 / -1' } : undefined}>
    <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>{label}</div>
    {children}
  </div>
);
const Val = ({ children, style }) => <div style={{ fontWeight:500, ...style }}>{children || '—'}</div>;
const SectionTitle = ({ children }) => (
  <div style={{ gridColumn:'1 / -1', fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase', color:'var(--primary)', borderBottom:'1px solid var(--border)', paddingBottom:4, marginTop:4 }}>
    {children}
  </div>
);

// ─── Detail Panel ────────────────────────────────────────────────────────────
function FinancePanel({ row, ec, ecState, link, canEdit, onUpdate, onUpdateAmounts, saving }) {
  const [tab, setTab] = useState('finance');
  const [invForm, setInvForm] = useState({
    invoiceGenerated:  row.invoiceGenerated  || '',
    invoicePoc:        row.invoicePoc        || '',
    invoiceActualDate: toInputDate(row.invoiceActualDate) || '',
    invoiceComment:    row.invoiceComment    || '',
    paymentReceived:   row.paymentReceived   || '',
    paymentActualDate: toInputDate(row.paymentActualDate) || '',
  });

  // If a save is undone (Excel did not keep it), show Excel's value again —
  // except in the box currently being typed in.
  const typingIn = () => {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.name : '';
  };
  useEffect(() => {
    const busy = typingIn();
    setInvForm(f => {
      const next = { ...f };
      const fromRow = {
        invoiceGenerated:  row.invoiceGenerated  || '',
        invoicePoc:        row.invoicePoc        || '',
        invoiceComment:    row.invoiceComment    || '',
        paymentReceived:   row.paymentReceived   || '',
        invoiceActualDate: toInputDate(row.invoiceActualDate) || '',
        paymentActualDate: toInputDate(row.paymentActualDate) || '',
      };
      for (const [k, v] of Object.entries(fromRow)) if (k !== busy) next[k] = v;
      return next;
    });
  }, [row.invoiceGenerated, row.invoicePoc, row.invoiceComment, row.paymentReceived, row.invoiceActualDate, row.paymentActualDate]);

  // Switching engagement while a box still has focus: save what was typed
  const latest = useRef({});
  latest.current = { invForm, row, onUpdate };
  useEffect(() => () => {
    const { invForm: f, row: r, onUpdate: up } = latest.current;
    const changed = {};
    for (const k of ['invoicePoc', 'invoiceComment', 'invoiceActualDate', 'paymentActualDate']) {
      const before = k.endsWith('Date') ? toInputDate(r[k]) : (r[k] ?? '');
      if (String(f[k] ?? '') !== String(before)) changed[k] = f[k];
    }
    if (Object.keys(changed).length) up(r, changed);
  }, []);

  const [amtForm, setAmtForm] = useState({ travelExpenses: ec?.travelExpenses ?? '', gst: ec?.gst ?? '' });
  // Fill the boxes once the Engagement Calendar row arrives (it may load after the panel opens)
  useEffect(() => {
    if (!ec) return;
    const busy = typingIn();
    setAmtForm(f => ({
      travelExpenses: busy === 'travelExpenses' ? f.travelExpenses : (ec.travelExpenses ?? ''),
      gst:            busy === 'gst'            ? f.gst            : (ec.gst ?? ''),
    }));
  }, [ec?.engagementKey, ec?.travelExpenses, ec?.gst]);
  const saveAmount = (k, v) => {
    if (!ec) return;
    if ((Number(v) || 0) !== (Number(ec[k]) || 0)) onUpdateAmounts(row, { [k]: Number(v) || 0 });
  };
  // Autosave amounts 1 s after typing stops
  const amtTimers = useRef({});
  const amtLatest = useRef({});
  amtLatest.current = { saveAmount, amtForm };
  const autosaveAmount = (k, v) => {
    clearTimeout(amtTimers.current[k]);
    amtTimers.current[k] = setTimeout(() => { delete amtTimers.current[k]; amtLatest.current.saveAmount(k, v); }, 1000);
  };
  useEffect(() => () => {
    // Panel closing: send amounts that were still waiting
    for (const k of Object.keys(amtTimers.current)) {
      clearTimeout(amtTimers.current[k]);
      amtLatest.current.saveAmount(k, amtLatest.current.amtForm[k]);
    }
  }, []);
  const liveTotal = ec ? (Number(ec.price) || 0) + (Number(amtForm.travelExpenses) || 0) + (Number(amtForm.gst) || 0) : 0;

  const { invDue, payDue } = financeDates({ ...row, invoiceActualDate: invForm.invoiceActualDate || row.invoiceActualDate });
  const stage = financeStage(row);

  // Autosave on every change (the page combines quick changes into one save).
  // Dates save only once they are complete (a year being typed like 0002 is skipped).
  const save = (k, v) => {
    if (k.endsWith('Date') && v) {
      const y = Number(String(v).slice(0, 4));
      if (!(y >= 2000 && y <= 2099)) return;
    }
    const before = k.endsWith('Date') ? toInputDate(row[k]) : (row[k] ?? '');
    if (String(v ?? '') !== String(before)) onUpdate(row, { [k]: v });
  };
  const edit = k => e => {
    const v = e.target.value;
    setInvForm(f => ({ ...f, [k]: v }));
    // An invoice date means the invoice has been raised
    const y = Number(String(v).slice(0, 4));
    if (k === 'invoiceActualDate' && v && y >= 2000 && y <= 2099 && ['', 'Not Raised', 'No'].includes(String(invForm.invoiceGenerated || '').trim())) {
      setInvForm(f => ({ ...f, invoiceGenerated: 'Raised' }));
      onUpdate(row, { invoiceGenerated: 'Raised' });
    }
    save(k, v);
  };

  return (
    <div className="card" style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div className="card-header" style={{ flexShrink:0, flexWrap:'wrap', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div className="card-title" style={{ fontSize:15 }}>{row.company}</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            {row.egId} · {fmtDate(row.startDate)}{row.endDate && row.endDate !== row.startDate ? ` → ${fmtDate(row.endDate)}` : ''}
            {row.internalPoc && <> · <strong>POC:</strong> {row.internalPoc}</>}
          </div>
          {row.topic && <div style={{ fontSize:12, marginTop:2 }}>{row.topic}</div>}
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, fontSize:11, marginTop:4, color:'var(--muted)' }}>
            {['To Invoice','Invoice Overdue','Upcoming'].includes(stage) && invDue &&
              <span style={{ color:dueDateColor(invDue), fontWeight:600 }}>🧾 Invoice by {fmtDate(invDue)}</span>}
            {toInputDate(row.invoiceActualDate) && <span>🧾 Invoiced {fmtDate(row.invoiceActualDate)}</span>}
            {['Awaiting Payment','Payment Overdue'].includes(stage) && payDue &&
              <span style={{ color:dueDateColor(payDue), fontWeight:600 }}>💳 Payment due {fmtDate(payDue)}</span>}
            {row.paymentActualDate && <span>💳 Paid {fmtDate(row.paymentActualDate)}</span>}
          </div>
          <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:5 }}>
            <StatusBadge value={row.status} />
            {row.contractType && <span className="badge badge-gray">📄 {row.contractType}{row.contractStatus ? ` · ${row.contractStatus}` : ''}</span>}
            {row.noOfParticipants > 0 && <span className="badge badge-purple">👥 {row.noOfParticipants} pax</span>}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
          <StageBadge stage={stage} />
          {saving
            ? <span style={{ fontSize:11, color:'var(--muted)', fontWeight:600 }}>⏳ Saving…</span>
            : null}
          {liveTotal > 0 && <div style={{ fontSize:16, fontWeight:800, color:'var(--primary)' }}>{inr(liveTotal)}</div>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0, padding:'0 16px' }}>
        {[['finance','💰 Finance'],['details','📋 Engagement Info']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            border:'none', background:'none', padding:'8px 14px', cursor:'pointer',
            fontSize:12, fontWeight: tab===t ? 700 : 500,
            color: tab===t ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab===t ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom:-1,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>

        {/* ── Finance Tab (editable) ── */}
        {tab === 'finance' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 24px', fontSize:13 }}>
            <SectionTitle>Invoice</SectionTitle>
            <Field label="Invoice Status">
              {canEdit ? (
                <select className="form-input" style={{ fontSize:12 }} value={invForm.invoiceGenerated}
                  onChange={e => { const v=e.target.value; setInvForm(f=>({...f,invoiceGenerated:v})); onUpdate(row,{invoiceGenerated:v}); }}>
                  {['','Raised','Not Raised','NA'].map(v => <option key={v} value={v}>{v||'— select —'}</option>)}
                  {/* keep an older value (e.g. Yes/No) visible until it is changed */}
                  {invForm.invoiceGenerated && !['Raised','Not Raised','NA'].includes(invForm.invoiceGenerated) && (
                    <option value={invForm.invoiceGenerated}>{invForm.invoiceGenerated} (old value)</option>
                  )}
                </select>
              ) : <Val>{row.invoiceGenerated}</Val>}
            </Field>
            <Field label="Invoice POC">
              {canEdit ? (
                <input className="form-input" style={{ fontSize:12 }} value={invForm.invoicePoc}
                  name="invoicePoc" onChange={edit('invoicePoc')}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
              ) : <Val>{row.invoicePoc}</Val>}
            </Field>
            <Field label="Invoice Due Date (TAT)">
              <Val style={{ color: isRaised(invForm.invoiceGenerated) ? 'var(--muted)' : dueDateColor(invDue) }}>{fmtDate(invDue)}</Val>
            </Field>
            <Field label="Actual Invoice Date">
              {canEdit ? (
                <input type="date" className="form-input" style={{ fontSize:12 }} value={invForm.invoiceActualDate}
                  name="invoiceActualDate" onChange={edit('invoiceActualDate')}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
              ) : <Val>{row.invoiceActualDate ? fmtDate(row.invoiceActualDate) : ''}</Val>}
            </Field>
            <Field label="Invoice Comments" full>
              {canEdit ? (
                <textarea className="form-input" style={{ fontSize:12, resize:'vertical', minHeight:48 }}
                  value={invForm.invoiceComment}
                  name="invoiceComment" onChange={edit('invoiceComment')}
                  placeholder="Add invoice notes…"
                />
              ) : <Val style={{ fontStyle: row.invoiceComment ? 'italic' : 'normal' }}>{row.invoiceComment}</Val>}
            </Field>

            <SectionTitle>Payment</SectionTitle>
            <Field label="Payment Due Date (TAT)">
              <Val style={{ color: invForm.paymentReceived === 'Yes' ? 'var(--muted)' : dueDateColor(payDue) }}>{payDue ? fmtDate(payDue) : 'Set invoice date first'}</Val>
            </Field>
            <Field label="Payment Received">
              {canEdit ? (
                <select className="form-input" style={{ fontSize:12 }} value={invForm.paymentReceived}
                  onChange={e => { const v=e.target.value; setInvForm(f=>({...f,paymentReceived:v})); onUpdate(row,{paymentReceived:v}); }}>
                  {['','Yes','No','NA'].map(v => <option key={v} value={v}>{v||'— select —'}</option>)}
                </select>
              ) : <Val>{row.paymentReceived}</Val>}
            </Field>
            <Field label="Actual Payout Date">
              {canEdit ? (
                <input type="date" className="form-input" style={{ fontSize:12 }} value={invForm.paymentActualDate}
                  name="paymentActualDate" onChange={edit('paymentActualDate')}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
              ) : <Val>{row.paymentActualDate ? fmtDate(row.paymentActualDate) : ''}</Val>}
            </Field>

            <SectionTitle>Commercials · saved to Engagement Calendar</SectionTitle>
            {ec ? (
              <>
                <Field label="Price (INR) 🔒"><Val>{ec.price ? inr(ec.price) : ''}</Val></Field>
                <Field label="Travel, Stay & Misc (₹)">
                  {canEdit ? (
                    <input type="number" min="0" step="0.01" className="form-input" style={{ fontSize:12 }}
                      value={amtForm.travelExpenses}
                      name="travelExpenses"
                      onChange={e => { const v = e.target.value; setAmtForm(f => ({ ...f, travelExpenses: v })); autosaveAmount('travelExpenses', v); }}
                      onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder="0" />
                  ) : <Val>{ec.travelExpenses ? inr(ec.travelExpenses) : ''}</Val>}
                </Field>
                <Field label="GST (₹)">
                  {canEdit ? (
                    <input type="number" min="0" step="0.01" className="form-input" style={{ fontSize:12 }}
                      value={amtForm.gst}
                      name="gst"
                      onChange={e => { const v = e.target.value; setAmtForm(f => ({ ...f, gst: v })); autosaveAmount('gst', v); }}
                      onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder="0" />
                  ) : <Val>{ec.gst ? inr(ec.gst) : ''}</Val>}
                </Field>
                <Field label="Total"><Val style={{ fontWeight:700 }}>{liveTotal ? inr(liveTotal) : ''}</Val></Field>
                <Field label="Amount Received 🔒"><Val>{ec.amountReceived ? inr(ec.amountReceived) : ''}</Val></Field>
                <Field label="Received Date"><Val>{ec.receivedDate ? fmtDate(ec.receivedDate) : ''}</Val></Field>
                <Field label="Contract 🔒"><Val>{ec.contract}</Val></Field>
                <Field label="PO Status 🔒"><Val>{ec.poStatus}</Val></Field>
                <div style={{ gridColumn:'1 / -1', fontSize:10, color:'var(--muted)' }}>🔒 Price, Amount Received, Contract and PO Status are edited in the Engagement Calendar.</div>
              </>
            ) : (
              link?.state === 'wrong' ? (
                <div style={{ gridColumn:'1 / -1', fontSize:12, color:'#7f1d1d', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 12px' }}>
                  ⚠ This row's Index <strong>{row.engagementKey}</strong> points to <strong>{link.ec.company}</strong> ({link.ec.egId}, {fmtDate(link.ec.startDate)}) in the Engagement Calendar.
                  Engagement Calendar updates are blocked until the Index in the Ops Checklist Excel is corrected
                  {link.suggest ? <> to <strong>{link.suggest}</strong></> : ''}. Invoice details still save to the Ops Checklist.
                </div>
              ) :
              <div style={{ gridColumn:'1 / -1', fontSize:12, color:'var(--muted)' }}>
                {ecState === 'loading' ? '⏳ Loading commercials from the Engagement Calendar…'
                  : ecState === 'error' ? '⚠ Could not load the Engagement Calendar.'
                  : 'No matching Engagement Calendar row for this Index — Travel and GST cannot be saved until it exists.'}
              </div>
            )}
          </div>
        )}

        {/* ── Engagement Info Tab (read-only) ── */}
        {tab === 'details' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 24px', fontSize:13 }}>
            {[
              ['Index 🔒', row.engagementKey], ['EG.ID', row.egId], ['Company', row.company], ['Client SPOC', row.clientSpoc],
              ['Internal POC', row.internalPoc], ['Start Date', fmtDate(row.startDate)], ['End Date', fmtDate(row.endDate)],
              ['Topic', row.topic], ['Sector', row.sector], ['Service Type', row.serviceType],
              ['Offering', row.offering], ['Program Type', row.programType], ['Location', row.location],
              ['Day(s)', row.day], ['No. of Participants', row.noOfParticipants],
              ['Consultant 1', row.consultant1], ['Consultant 2', row.consultant2], ['Consultant 3', row.consultant3],
              ['Contract Type', row.contractType], ['Contract Status', row.contractStatus],
              ['Pax List Received', row.paxListReceived], ['Status', row.status],
            ].map(([label, val]) => (
              <Field key={label} label={label}><Val>{val}</Val></Field>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function FinanceTracker({ onRefreshed }) {
  const [data,       setData]       = useState(() => peekList('ops') || []);
  const [loading,    setLoading]    = useState(() => !peekList('ops'));   // full loader only on the very first visit
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [ecRows,     setEcRows]     = useState(() => peekAllEngagements() || []);
  const [ecState,    setEcState]    = useState(() => (peekAllEngagements() ? 'ready' : 'loading'));
  const [search,     setSearch]     = useState('');
  const [stageF,     setStageF]     = useState('All');
  const [selected,   setSelected]   = useState(null);
  const [toast,      setToast]      = useState('');

  const { canEdit } = usePermissions();
  const canEditFin = canEdit('finance');

  const toastTimer = useRef(null);
  const showToast = msg => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    const m = String(msg);
    toastTimer.current = setTimeout(() => setToast(''), m.includes('⚠') || m.includes('❌') ? 12000 : 2500);
  };

  // Engagement Calendar — only used for the read-only commercials
  const loadEc = async (force = false) => {
    try {
      const rows = await getAllEngagementsCached({ force });
      setEcRows(rows); setEcState('ready');
    } catch { setEcState(s => (s === 'ready' ? s : 'error')); }
  };

  // Show the last loaded rows straight away, then fetch fresh rows in the background
  const load = async () => {
    const saved = peekList('ops');
    if (saved) { setData(d => (d.length ? d : saved)); setLoading(false); }
    else setLoading(true);
    setRefreshing(true); setError(null);
    loadEc();
    try {
      const rows = await getOpsChecklist();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) {
      if (saved) showToast('⚠ Could not refresh from Excel — showing the last saved copy.');
      else setError(e);
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const ecByKey = useMemo(() => {
    const m = new Map();
    for (const e of ecRows) { const k = String(e.engagementKey ?? '').trim(); if (k) m.set(k, e); }
    return m;
  }, [ecRows]);
  // EC row linked by Index — used only when it really is the same engagement
  const ecLink = r => {
    const ec = ecByKey.get(String(r.engagementKey ?? '').trim());
    if (!ec) return { state: 'missing' };
    if (ecMatchesOps(ec, r)) return { state: 'ok', ec };
    return { state: 'wrong', ec, suggest: suggestEcIndex(r, ecRows) };
  };
  const ecOf = r => { const l = ecLink(r); return l.state === 'ok' ? l.ec : undefined; };
  const wrongLinks = useMemo(() => (ecState === 'ready' ? data.map(r => ({ r, l: ecLink(r) })).filter(x => x.l.state === 'wrong') : []), [data, ecByKey, ecState]);

  const withStage = useMemo(() => data.map(r => ({ ...r, _stage: financeStage(r) })), [data]);

  const filtered = useMemo(() =>
    withStage.filter(r => {
      const q = search.toLowerCase();
      const mQ = !q || [r.company, r.topic, r.egId, r.invoicePoc, r.engagementKey].some(v => String(v ?? '').toLowerCase().includes(q));
      const mS = stageF === 'All'
        || (stageF === 'Needs Action' ? ['Invoice Overdue','To Invoice','Payment Overdue'].includes(r._stage)
        :  stageF === 'All To Invoice' ? ['Invoice Overdue','To Invoice'].includes(r._stage)
        :  stageF === 'All Awaiting Payment' ? ['Awaiting Payment','Payment Overdue'].includes(r._stage)
        :  r._stage === stageF);
      return mQ && mS;
    }).sort((a,b) => (Number(a.sno)||0) - (Number(b.sno)||0)),
    [withStage, search, stageF]
  );

  const count = (...stages) => withStage.filter(r => stages.includes(r._stage)).length;

  const sel = selected != null ? data.find(d => d.sno === selected) : null;

  // Excel column each finance field is saved to (for messages)
  const OPS_COL = {
    invoiceGenerated: 'Invoice Status', invoicePoc: 'Invoice POC', invoiceActualDate: 'Actual Invoice Date',
    invoiceComment: 'Invoice Comments', paymentReceived: 'Payment Received', paymentActualDate: 'Actual Payout Date',
  };
  const sameOps = (k, a, b) => k.endsWith('Date')
    ? toInputDate(a) === toInputDate(b)
    : String(a ?? '').trim() === String(b ?? '').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const keyOf = r => String(r?.engagementKey ?? '').trim();

  // ── Smooth saving ─────────────────────────────────────────────────────────
  // • The screen updates at once; Excel is written in the background.
  // • Autosave: edits on one engagement are combined into ONE save once typing pauses for 1.2 s.
  // • Saves for one engagement run strictly one after another.
  // • Busy/timeout replies from Power Automate are retried automatically.
  // • Only a real failure shows a message, and the screen goes back to what Excel holds.
  const pendingRef = useRef(new Map());   // Index → { row, changes, timer }
  const chainRef   = useRef(new Map());   // Index → promise of the running save
  const [savingKeys, setSavingKeys] = useState(() => new Set());
  const setSaving = (key, on) => setSavingKeys(prev => {
    if (prev.has(key) === on) return prev;
    const n = new Set(prev); on ? n.add(key) : n.delete(key); return n;
  });

  const isTransient = e => e instanceof TypeError || /\((429|502|503|504)\)|timed out|did not respond|502/i.test(String(e?.message || ''));
  const withRetry = async fn => {
    for (const wait of [0, 3000, 6000]) {
      if (wait) await sleep(wait);
      try { return await fn(); }
      catch (e) { if (!isTransient(e) || wait === 6000) throw e; }
    }
  };
  const friendly = e => {
    const m = String(e?.message || e || '');
    if (isTransient(e)) return 'Power Automate is busy or did not respond. Please try again in a minute.';
    return m.length > 220 ? m.slice(0, 220) + '…' : m;
  };

  // Read the Ops Checklist back until the values show (Excel Online can lag a few seconds)
  const confirmOps = async (key, changes) => {
    let after = null, missed = Object.keys(changes), count = 0;
    for (const ms of [3000, 5000]) {
      await sleep(ms);
      let fresh;
      try { fresh = await readTrackerFresh('ops'); } catch { continue; }
      const matches = fresh.filter(r => keyOf(r) === key);
      count = matches.length; after = matches[0] || null;
      missed = Object.keys(changes).filter(k => !after || !sameOps(k, after[k], changes[k]));
      if (!missed.length) break;
    }
    return { ok: !missed.length, after, missed, count };
  };

  // Latest value sent per engagement + field (so a background check never flags an older value)
  const sentRef = useRef(new Map());

  // Background check: the Ops Checklist really holds what was sent (quiet unless it does not)
  const checkOpsLater = async (row, changes) => {
    const key = keyOf(row);
    const v = await confirmOps(key, changes);
    if (v.ok) return;
    const sent = sentRef.current.get(key) || {};
    const stillLatest = v.missed.filter(k => sent[k] === changes[k]);   // ignore fields changed again since
    if (!stillLatest.length) return;
    console.warn('[Finance Tracker] Not kept in Ops Checklist', { index: key, sent: changes, excelRow: v.after, raw: rawOpsRowFor(key) });
    setData(prev => prev.map(r => keyOf(r) === key ? { ...r, ...Object.fromEntries(stillLatest.map(k => [k, v.after ? v.after[k] : row[k]])) } : r));
    showToast(`⚠ ${row.company}: ${stillLatest.map(k => OPS_COL[k] || k).join(', ')} did not save to the Ops Checklist` +
      (v.count > 1 ? ` (Index ${key} is in the Ops Checklist ${v.count} times — remove the duplicate)` : '') + '. Please try again.');
  };

  const saveNow = async (row, changes) => {
    const key = keyOf(row);
    const revert = values => setData(prev => prev.map(r => keyOf(r) === key ? { ...r, ...values } : r));
    sentRef.current.set(key, { ...(sentRef.current.get(key) || {}), ...changes });
    try {
      await withRetry(() => updateOpsRow(row.sno, changes, row.engagementKey));
    } catch (e) {
      revert(Object.fromEntries(Object.keys(changes).map(k => [k, row[k]])));
      showToast(`❌ ${row.company}: not saved — ${friendly(e)}`);
      return;
    }

    const ecRelevant = Object.keys(changes).some(k => k in OPS_FINANCE_TO_EC);
    showToast(`✓ ${row.company} saved${ecRelevant ? ' · updating Engagement Calendar…' : ''}`);
    checkOpsLater(row, changes);   // not awaited — never slows the next save

    if (ecRelevant) {
      let res;
      try { res = await withRetry(() => syncOpsFinanceToEC(row.sno, changes, row)); }
      catch (e) { res = { synced: false, reason: friendly(e) }; }
      if (res.synced) showToast(`✓ ${row.company} saved · Engagement Calendar updated`);
      else {
        console.warn('[Finance Tracker] Engagement Calendar not updated', { index: key, reason: res.reason });
        showToast(`⚠ ${row.company}: saved, but the Engagement Calendar was not updated — ${res.reason}`);
      }
    }
  };

  const flush = key => {
    const p = pendingRef.current.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current.delete(key);
    const job = (chainRef.current.get(key) || Promise.resolve()).catch(() => {}).then(() => saveNow(p.row, p.changes));
    chainRef.current.set(key, job);
    job.finally(() => {
      if (chainRef.current.get(key) === job) chainRef.current.delete(key);
      if (!pendingRef.current.has(key) && !chainRef.current.has(key)) setSaving(key, false);
    });
  };

  const handleUpdate = (row, changes) => {
    const key = keyOf(row);
    if (!key) { showToast(`❌ ${row.company}: this engagement has no Index, so it cannot be saved. Add it again from the Engagement Calendar.`); return; }
    // Show the change straight away
    setData(prev => prev.map(r => keyOf(r) === key ? { ...r, ...changes } : r));
    const p = pendingRef.current.get(key) || { row, changes: {} };   // keep the row as it was before the first edit
    p.changes = { ...p.changes, ...changes };
    clearTimeout(p.timer);
    p.timer = setTimeout(() => flush(key), 1200);
    pendingRef.current.set(key, p);
    setSaving(key, true);
  };

  // Travel, Stay & Misc / GST → saved on the Engagement Calendar row (same Index)
  const handleUpdateAmounts = (row, amounts) => {
    const key = keyOf(row);
    const before = ecByKey.get(key);
    setEcRows(prev => prev.map(e => keyOf(e) === key ? { ...e, ...amounts } : e));   // show at once
    setSaving(key, true);
    const job = (chainRef.current.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      try {
        const next = await withRetry(() => updateECFinanceAmounts(row.engagementKey, amounts, toInputDate(row.startDate), row));
        setEcRows(prev => prev.map(e => keyOf(e) === key ? { ...e, ...next } : e));
        showToast(`✓ ${row.company} saved · Engagement Calendar updated`);
      } catch (e) {
        if (before) setEcRows(prev => prev.map(r => keyOf(r) === key ? { ...r, travelExpenses: before.travelExpenses, gst: before.gst } : r));
        showToast(`❌ ${row.company}: Travel / GST not saved — ${friendly(e)}`);
      }
    });
    chainRef.current.set(key, job);
    job.finally(() => {
      if (chainRef.current.get(key) === job) chainRef.current.delete(key);
      if (!pendingRef.current.has(key) && !chainRef.current.has(key)) setSaving(key, false);
    });
  };

  // Leaving the page: send waiting edits now; closing the tab mid-save: ask first
  useEffect(() => {
    const warn = e => {
      if (pendingRef.current.size || chainRef.current.size) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      [...pendingRef.current.keys()].forEach(flush);
    };
  }, []);

  if (loading) return <LoadingState message="Loading Finance Tracker from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  const exportCols = [
    { label:'S No', key:'sno' }, { label:'Index', key:'engagementKey' }, { label:'EG ID', key:'egId' },
    { label:'Company', key:'company' }, { label:'Topic', key:'topic' },
    { label:'Start Date', get: r => fmtDate(r.startDate) }, { label:'End Date', get: r => fmtDate(r.endDate) },
    { label:'Status', key:'status' }, { label:'Finance Stage', key:'_stage' },
    { label:'Contract Type', key:'contractType' }, { label:'Contract Status', key:'contractStatus' },
    { label:'Price (INR)', get: r => ecOf(r)?.price ?? '' },
    { label:'Travel, Stay & Misc', get: r => ecOf(r)?.travelExpenses ?? '' },
    { label:'GST', get: r => ecOf(r)?.gst ?? '' },
    { label:'Total', get: r => ecTotal(ecOf(r)) || '' },
    { label:'Invoice Status', key:'invoiceGenerated' }, { label:'Invoice POC', key:'invoicePoc' },
    { label:'Invoice Due Date', get: r => fmtDate(financeDates(r).invDue) },
    { label:'Actual Invoice Date', get: r => r.invoiceActualDate ? fmtDate(r.invoiceActualDate) : '' },
    { label:'Invoice Comments', key:'invoiceComment' },
    { label:'Payment Due Date', get: r => { const d = financeDates(r).payDue; return d ? fmtDate(d) : ''; } },
    { label:'Payment Received', key:'paymentReceived' },
    { label:'Actual Payout Date', get: r => r.paymentActualDate ? fmtDate(r.paymentActualDate) : '' },
  ];

  const overdueTag = n => n > 0 && <span style={{ fontSize:11, color:'var(--red)', fontWeight:700, marginLeft:6 }}>{n} overdue</span>;

  return (
    <div className="tracker-page">
      {toast && (
        <div style={{ position:'fixed', top:70, right:24, maxWidth:520, background: toast.startsWith('❌') ? '#b91c1c' : toast.startsWith('⚠') ? '#b45309' : toast.startsWith('✓') ? '#15803d' : 'var(--primary)', color:'#fff', padding:'10px 20px', borderRadius:8, zIndex:999, fontSize:13, fontWeight:600, boxShadow:'0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {wrongLinks.length > 0 && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'10px 14px', marginBottom:10, fontSize:12, color:'#7f1d1d' }}>
          <div style={{ fontWeight:800, marginBottom:4 }}>
            ⚠ {wrongLinks.length} engagement{wrongLinks.length > 1 ? 's are' : ' is'} linked to the wrong Engagement Calendar row — Engagement Calendar updates are blocked for {wrongLinks.length > 1 ? 'them' : 'it'}.
          </div>
          <div style={{ marginBottom:6 }}>Fix the <strong>Index</strong> column in the Ops Checklist Excel for these rows, then press ↺:</div>
          <table style={{ borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ textAlign:'left', color:'#991b1b' }}>
              <th style={{ padding:'2px 12px 2px 0' }}>Ops Checklist row</th><th style={{ padding:'2px 12px 2px 0' }}>Index now</th>
              <th style={{ padding:'2px 12px 2px 0' }}>That Index is in EC</th><th style={{ padding:'2px 0' }}>Correct Index</th>
            </tr></thead>
            <tbody>{wrongLinks.map(({ r, l }) => (
              <tr key={r.engagementKey + '-' + r.sno}>
                <td style={{ padding:'2px 12px 2px 0' }}>S No {r.sno} · {r.company} · {r.egId} · {fmtDate(r.startDate)}</td>
                <td style={{ padding:'2px 12px 2px 0', fontFamily:'monospace' }}>{r.engagementKey}</td>
                <td style={{ padding:'2px 12px 2px 0' }}>{l.ec.company} · {l.ec.egId} · {fmtDate(l.ec.startDate)}</td>
                <td style={{ padding:'2px 0', fontFamily:'monospace', fontWeight:800 }}>{l.suggest || 'not found — check EC'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* KPIs — click to filter */}
      <div className="kpi-compact">
        <div className="kpi-card accent" style={{ cursor:'pointer' }} onClick={() => setStageF('All')}>
          <div className="kpi-label">Total Engagements</div><div className="kpi-value">{data.length}</div>
        </div>
        <div className="kpi-card" style={{ cursor:'pointer' }} onClick={() => setStageF('All To Invoice')} title="Engagement ended, invoice not raised yet">
          <div className="kpi-label">To Invoice</div>
          <div className="kpi-value">{count('Invoice Overdue','To Invoice')}{overdueTag(count('Invoice Overdue'))}</div>
        </div>
        <div className="kpi-card blue" style={{ cursor:'pointer' }} onClick={() => setStageF('All Awaiting Payment')} title="Invoice raised, payment not received yet">
          <div className="kpi-label">Awaiting Payment</div>
          <div className="kpi-value">{count('Awaiting Payment','Payment Overdue')}{overdueTag(count('Payment Overdue'))}</div>
        </div>
        <div className="kpi-card green" style={{ cursor:'pointer' }} onClick={() => setStageF('Paid')}>
          <div className="kpi-label">Paid</div><div className="kpi-value">{count('Paid')}</div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid-sidebar" style={{ flex:1, overflow:'hidden', minHeight:0 }}>

        {/* LEFT — engagement list */}
        <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
          <div className="filter-bar" style={{ flexShrink:0 }}>
            <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID, invoice POC…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="form-input" value={stageF} onChange={e => setStageF(e.target.value)}>
              {['All','Needs Action','All To Invoice','All Awaiting Payment', ...Object.keys(STAGES)].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing} title={refreshing ? 'Refreshing from Excel…' : 'Refresh'}>{refreshing ? '⟳' : '↺'}</button>
            <ExportButton page="finance" filename="Finance Tracker" sheetName="Finance Tracker"
              rows={() => filtered} columns={exportCols} disabled={loading} />
          </div>

          <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div className="card-header" style={{ flexShrink:0 }}>
              <span className="card-title">💰 Engagements</span>
              <span style={{ fontSize:12, color:'var(--muted)' }}>{filtered.length} of {data.length}</span>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {filtered.length === 0
                ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>No engagements found</div>
                : filtered.map(r => {
                    const isSel = selected === r.sno;
                    const { invDue, payDue } = financeDates(r);
                    const total = ecTotal(ecOf(r));
                    return (
                      <div key={r.engagementKey || r.sno} onClick={() => setSelected(isSel ? null : r.sno)} style={{
                        padding:'10px 14px', borderBottom:'1px solid var(--border)',
                        cursor:'pointer', background:isSel?'#f0f7ff':'transparent',
                        borderLeft:isSel?'3px solid var(--accent)':'3px solid transparent',
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', background:'var(--border)', borderRadius:4, padding:'1px 6px', flexShrink:0 }}>#{r.sno}</span>
                              <span style={{ fontWeight:700, fontSize:13 }}>{r.company}</span>
                            </div>
                            <div style={{ fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.topic}>{r.topic}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            {savingKeys.has(keyOf(r)) && <span title="Saving…" style={{ fontSize:11, marginRight:4 }}>⏳</span>}
                            {ecState === 'ready' && ecLink(r).state === 'wrong' && <span title="Linked to another engagement in the Engagement Calendar — fix the Index" style={{ fontSize:10, fontWeight:800, color:'#b91c1c', marginRight:4 }}>⚠ Wrong EC link</span>}
                            <StageBadge stage={r._stage} />
                            {total > 0 && <div style={{ fontSize:12, fontWeight:700, marginTop:4 }}>{inr(total)}</div>}
                          </div>
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:10, fontSize:11, color:'var(--muted)', marginTop:6 }}>
                          <span>📅 {fmtDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? ` → ${fmtDate(r.endDate)}` : ''}</span>
                          {r.egId && <span style={{ fontFamily:'monospace' }}>{r.egId}</span>}
                          {['To Invoice','Invoice Overdue','Upcoming'].includes(r._stage) && invDue &&
                            <span style={{ color:dueDateColor(invDue), fontWeight:600 }}>🧾 Invoice by {fmtDate(invDue)}</span>}
                          {toInputDate(r.invoiceActualDate) && <span>🧾 Invoiced {fmtDate(r.invoiceActualDate)}</span>}
                          {['Awaiting Payment','Payment Overdue'].includes(r._stage) && payDue &&
                            <span style={{ color:dueDateColor(payDue), fontWeight:600 }}>💳 Payment due {fmtDate(payDue)}</span>}
                          {r.invoicePoc && <span>👤 {r.invoicePoc}</span>}
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </div>

        {/* RIGHT — detail panel */}
        <div style={{ height:'100%', overflowY:'auto' }}>
          {sel
            ? <FinancePanel key={sel.engagementKey || sel.sno} row={sel} ec={ecOf(sel)} ecState={ecState} link={ecState === 'ready' ? ecLink(sel) : null}
                canEdit={canEditFin} onUpdate={handleUpdate} onUpdateAmounts={handleUpdateAmounts} saving={savingKeys.has(keyOf(sel))} />
            : (
              <div className="card" style={{ textAlign:'center', padding:'60px 20px', color:'var(--muted)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>👈</div>
                <div style={{ fontWeight:600, color:'var(--primary)', marginBottom:4 }}>Select an engagement</div>
                <div style={{ fontSize:13 }}>Click any engagement on the left to update its invoice and payment details</div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
