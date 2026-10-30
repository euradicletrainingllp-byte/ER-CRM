/**
 * FOUNDER'S DESK — one page for the whole business
 * ================================================
 * Pulls every tracker (BD / Solution, Engagement Calendar, Ops Checklist, Content Dev, Finance, Leads, Vendors,
 * Project Management, Consultant Directory, Client Directory)
 * and shows, in one place: what is overdue, what is due this week, who owns it, upcoming deliveries
 * with Ops readiness, the sales pipeline, cash & collections, completed work and data gaps.
 * Every row expands in place — the founder never has to open a tracker just to read something.
 *
 * Layout is the founder's to shape: views (Founder overview, Monday review, Sales, Delivery, Cash),
 * show / hide, reorder, full / half width and collapse per section — saved in this browser.
 */
import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Gauge, AlertTriangle, CalendarDays, TrendingUp, Wallet, ClipboardCheck, BookOpen, CheckCircle2, Users, Database,
  Settings2, ChevronUp, ChevronDown, ChevronRight, RefreshCw, ExternalLink, X, Eye, EyeOff, RotateCcw, Building2, Briefcase, UserCheck,
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge.jsx';
import { peekList, peekAllEngagements, getSolutionTracker, getAllEngagementsCached, getOpsChecklist, getContentDevTracker } from '../services/api.js';
import { getLeads, getVendorServices } from '../services/leadsVendorsApi.js';
import { getTasks, tasksConfigured } from '../services/tasksApi.js';
import { getConsultants, consultantsConfigured } from '../services/consultantsApi.js';
import { getClientDirectory, peekClientDirectory, clientsConfigured } from '../services/clientsApi.js';
import {
  TRACKERS, PERIODS, periodRange, periodLabelOf, inRange, todayIso, addDaysIso, openTasks, completedWork, missingByTracker,
  cashSummary, pipelineSummary, upcomingDeliveries, fmtL, clientSummary, projectSummary, consultantSummary, daysBetween,
} from '../services/actionItems.js';
import '../styles/founder.css';

/* ─── Sections & views ────────────────────────────────────────────────────── */
const SECTIONS = {
  pulse:     { title: 'Business Pulse',      Icon: Gauge,          desc: 'Revenue, cash, pipeline and workload at a glance', width: 'full' },
  attention: { title: 'Needs Attention',     Icon: AlertTriangle,  desc: 'Every overdue and due-this-week task across all trackers', width: 'full' },
  calendar:  { title: 'Upcoming Deliveries', Icon: CalendarDays,   desc: 'Engagement Calendar with Ops readiness', width: 'half' },
  pipeline:  { title: 'Sales Pipeline',      Icon: TrendingUp,     desc: 'Proposals, wins, win rate and open value', width: 'half' },
  cash:      { title: 'Cash & Collections',  Icon: Wallet,         desc: 'Invoicing, receivables and ageing', width: 'half' },
  ops:       { title: 'Delivery Readiness',  Icon: ClipboardCheck, desc: 'Ops Checklist status for the next 30 days', width: 'half' },
  content:   { title: 'Content Development', Icon: BookOpen,       desc: 'Open content work and deadlines', width: 'half' },
  done:      { title: 'Completed',           Icon: CheckCircle2,   desc: 'What the team finished in the selected period', width: 'half' },
  owners:    { title: 'Team Load',           Icon: Users,          desc: 'Overdue and this-week tasks by owner', width: 'half' },
  health:    { title: 'Data Health',         Icon: Database,       desc: 'Missing fields in each tracker', width: 'half' },
  clients:   { title: 'Clients & Relationships', Icon: Building2,  desc: 'Accounts at risk or going cold, follow-ups, dues', width: 'half' },
  projects:  { title: 'Projects & Tasks',    Icon: Briefcase,      desc: 'Internal projects, progress and overdue tasks', width: 'half' },
  consultants: { title: 'Consultant Bench',  Icon: UserCheck,      desc: 'Who is delivering next, contract renewals', width: 'half' },
};
const ALL_IDS = Object.keys(SECTIONS);

const PRESETS = {
  founder:  { label: 'Founder overview', desc: 'Everything, most urgent first',
    order: ['pulse', 'attention', 'calendar', 'pipeline', 'cash', 'clients', 'projects', 'ops', 'content', 'consultants', 'done', 'owners', 'health'], tracker: 'all', period: 'fy' },
  monday:   { label: 'Monday review', desc: 'Weekly meeting: risks, owners, this week, money',
    order: ['pulse', 'attention', 'owners', 'projects', 'calendar', 'pipeline', 'clients', 'cash'], tracker: 'all', period: 'month' },
  sales:    { label: 'Sales & pipeline', desc: 'Proposals, wins and follow-ups',
    order: ['pulse', 'pipeline', 'clients', 'attention', 'done'], tracker: 'bd', period: 'quarter' },
  delivery: { label: 'Delivery & operations', desc: 'Sessions, readiness, content, who is stuck',
    order: ['calendar', 'ops', 'consultants', 'attention', 'content', 'projects', 'owners'], tracker: 'ops', period: 'month' },
  cash:     { label: 'Cash & collections', desc: 'Invoices to raise, money to collect',
    order: ['pulse', 'cash', 'attention', 'done'], tracker: 'finance', period: 'quarter' },
};

const LS_KEY = 'ercrm.founder.layout.v1';
function presetLayout(id) {
  const p = PRESETS[id];
  return {
    preset: id, order: [...p.order, ...ALL_IDS.filter(x => !p.order.includes(x))],
    hidden: Object.fromEntries(ALL_IDS.filter(x => !p.order.includes(x)).map(x => [x, true])),
    width: Object.fromEntries(ALL_IDS.map(x => [x, SECTIONS[x].width])), collapsed: {},
    period: p.period, tracker: p.tracker,
  };
}
function readLayout() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (v && Array.isArray(v.order)) {
      const order = [...v.order.filter(x => SECTIONS[x]), ...ALL_IDS.filter(x => !v.order.includes(x))];
      const base = presetLayout('founder');
      return { ...base, ...v, order, width: { ...base.width, ...(v.width || {}) } };
    }
  } catch { /* storage blocked */ }
  return presetLayout('founder');
}

/* ─── Small helpers ───────────────────────────────────────────────────────── */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { if (!iso) return '—'; const d = new Date(iso + 'T00:00:00Z'); return isNaN(d) ? iso : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const fmtDay = iso => { const d = new Date(iso + 'T00:00:00Z'); return isNaN(d) ? iso : `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const dueText = d => (d < 0 ? `${-d}d overdue` : d === 0 ? 'Due today' : d === 1 ? 'Tomorrow' : `In ${d}d`);
const rupee = v => (v ? '₹ ' + Math.round(v).toLocaleString('en-IN') : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Section({ id, layout, setLayout, right, children, count }) {
  const meta = SECTIONS[id];
  const collapsed = !!layout.collapsed[id];
  const toggle = () => setLayout(l => ({ ...l, collapsed: { ...l.collapsed, [id]: !collapsed } }));
  return (
    <section id={`fd-sec-${id}`} className={`fd-sec ${layout.width[id] === 'full' ? 'fd-full' : 'fd-half'}`}>
      <header className="fd-sec-head">
        <button type="button" className="fd-sec-toggle" onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <span className="fd-sec-icon"><meta.Icon size={15} strokeWidth={2} /></span>
        <div className="fd-sec-titles">
          <div className="fd-sec-title">{meta.title}{count != null && <span className="fd-sec-count">{count}</span>}</div>
          <div className="fd-sec-desc">{meta.desc}</div>
        </div>
        {!collapsed && right && <div className="fd-sec-right">{right}</div>}
      </header>
      {!collapsed && <div className="fd-sec-body">{children}</div>}
    </section>
  );
}

function Seg({ value, options, onChange, size }) {
  return (
    <div className={`fd-seg${size ? ' ' + size : ''}`}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, tone, onClick, how }) {
  return (
    <div className={`fd-stat${tone ? ' fd-' + tone : ''}${onClick ? ' fd-click' : ''}`} onClick={onClick} title={onClick ? 'Go to section' : undefined}>
      <div className="fd-stat-label">{label}</div>
      <div className="fd-stat-value">{value}</div>
      {sub && <div className="fd-stat-sub">{sub}</div>}
      {how && <div className="fd-stat-how" title={how}>How: {how}</div>}
    </div>
  );
}

function Details({ rows, onOpen, openLabel }) {
  const shown = (rows || []).filter(([, v]) => v !== '' && v != null);
  return (
    <div className="fd-details">
      <dl>{shown.map(([k, v], i) => (
        <div key={k + i}><dt>{k}</dt><dd>{/^https?:/i.test(String(v)) ? <a href={v} target="_blank" rel="noreferrer">Open link</a> : String(v)}</dd></div>
      ))}</dl>
      {onOpen && <button type="button" className="fd-link" onClick={onOpen}><ExternalLink size={13} /> {openLabel}</button>}
    </div>
  );
}

const Empty = ({ children }) => <div className="fd-empty">{children}</div>;
const Meter = ({ value, title }) => (
  <span className="fd-meter" title={title || `${value}% ready`}>
    <span style={{ width: value + '%' }} className={value >= 80 ? 'ok' : value >= 50 ? 'warn' : 'bad'} /><em>{value}%</em>
  </span>
);

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function FounderDashboard({ onRefreshed }) {
  const navigate = useNavigate();
  const [sol, setSol] = useState(() => peekList('solution') || []);
  const [eng, setEng] = useState(() => peekAllEngagements() || []);
  const [ops, setOps] = useState(() => peekList('ops') || []);
  const [cdt, setCdt] = useState(() => peekList('cdt') || []);
  const [leads, setLeads] = useState(() => peekList('leads') || []);
  const [vendors, setVendors] = useState(() => peekList('vendors') || []);
  const [projTasks, setProjTasks] = useState(() => peekList('tasks') || []);
  const [consultants, setConsultants] = useState(() => peekList('consultants') || []);
  const [clients, setClients] = useState(() => peekClientDirectory());
  const [loading, setLoading] = useState(() => !(peekList('solution') && peekAllEngagements() && peekList('ops') && peekList('cdt')));
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState({});
  const [layout, setLayoutState] = useState(readLayout);
  const [customising, setCustomising] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('all');

  const setLayout = fn => setLayoutState(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  // A change to sections turns the view into "Custom layout"
  const customise = fn => setLayout(l => ({ ...fn(l), preset: 'custom' }));

  const load = async () => {
    setRefreshing(true);
    const errs = {};
    await Promise.allSettled([
      getSolutionTracker().then(setSol).catch(e => { errs['BD / Solution'] = e; }),
      getAllEngagementsCached({ force: true }).then(setEng).catch(e => { errs['Engagement Calendar'] = e; }),
      getOpsChecklist().then(setOps).catch(e => { errs['Ops Checklist'] = e; }),
      getContentDevTracker().then(setCdt).catch(e => { errs['Content Dev'] = e; }),
      // Lead / Vendor trackers are optional until their flows are set up — skip quietly when not configured
      getLeads().then(setLeads).catch(e => { if (!/FLOW_NOT_CONFIGURED/.test(e?.message)) errs['Lead Tracker'] = e; }),
      getVendorServices().then(setVendors).catch(e => { if (!/FLOW_NOT_CONFIGURED/.test(e?.message)) errs['Vendor Services'] = e; }),
      // Project Management / Consultant / Client directories — also optional until their flows exist
      tasksConfigured() && getTasks().then(setProjTasks).catch(e => { errs['Project Management'] = e; }),
      consultantsConfigured() && getConsultants().then(setConsultants).catch(e => { errs['Consultant Directory'] = e; }),
      clientsConfigured() && getClientDirectory().then(setClients).catch(e => { errs['Client Directory'] = e; }),
    ]);
    setErrors(errs); setLoading(false); setRefreshing(false);
    onRefreshed?.(new Date().toLocaleTimeString());
  };
  useEffect(() => { load(); }, []);

  const data = useMemo(() => ({ sol, eng, ops, cdt, leads, vendors, tasks: projTasks, consultants, clients }),
    [sol, eng, ops, cdt, leads, vendors, projTasks, consultants, clients]);
  const range = useMemo(() => periodRange(layout.period, undefined, layout.custom), [layout.period, layout.custom]);
  const tasks = useMemo(() => openTasks(data), [data]);
  const done = useMemo(() => completedWork(data), [data]);
  const missing = useMemo(() => missingByTracker(data), [data]);
  const cash = useMemo(() => cashSummary(eng, range), [eng, range]);
  const pipe = useMemo(() => pipelineSummary(sol, range), [sol, range]);
  const upcoming30 = useMemo(() => upcomingDeliveries(eng, ops, 30), [eng, ops]);
  const clientSum = useMemo(() => clientSummary(clients, eng), [clients, eng]);
  const projSum = useMemo(() => projectSummary(projTasks, range), [projTasks, range]);
  const benchSum = useMemo(() => consultantSummary(consultants, eng, 30), [consultants, eng]);

  const overdue = useMemo(() => tasks.filter(t => t.days < 0), [tasks]);
  const soon = useMemo(() => tasks.filter(t => t.days >= 0 && t.days <= 7), [tasks]);
  const periodLabel = periodLabelOf(layout.period, layout.custom);
  const setCustom = (k, v) => setLayout(l => ({ ...l, custom: { ...range, ...(l.custom || {}), [k]: v } }));
  const customInputs = layout.period === 'custom' && (
    <span className="fd-period-dates" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="date" className="fd-select" value={range.from} max={range.to} onChange={e => setCustom('from', e.target.value)} title="From" />
      <span className="fd-muted">to</span>
      <input type="date" className="fd-select" value={range.to} min={range.from} onChange={e => setCustom('to', e.target.value)} title="To" />
    </span>
  );
  const go = id => {
    if (layout.collapsed[id]) setLayout(l => ({ ...l, collapsed: { ...l.collapsed, [id]: false } }));
    setTimeout(() => document.getElementById(`fd-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const open = tracker => navigate(TRACKERS[tracker]?.route || '/');
  const sp = { layout, setLayout };

  /* ── Section renderers ── */
  const render = {
    pulse: () => (
      <Section id="pulse" {...sp}>
        <div className="fd-stats fd-stats-5">
          <Stat label={`Revenue booked · ${periodLabel}`} value={fmtL(cash.booked)} sub={`${fmtL(cash.delivered)} delivered`} tone="navy" how="Price (INR) of sessions starting in the period, not cancelled / lost / postponed / on hold; sub-line = those marked Delivered. GST & travel excluded." />
          <Stat label={`Collected · ${periodLabel}`} value={fmtL(cash.collected)} sub={`${fmtL(cash.invoiced)} invoiced`} tone="green" onClick={() => go('cash')} how="Amount Received on the Received Date in the period (Invoice date if blank); Price + GST only, never above the invoice." />
          <Stat label="Outstanding" value={fmtL(cash.outstanding)} sub={cash.overdueOut ? `${fmtL(cash.overdueOut)} overdue` : 'Nothing overdue'} tone={cash.overdueOut ? 'coral' : 'green'} onClick={() => go('cash')} how="(Price + GST − TDS + travel) − amount received on every invoice not marked Received / NA (any date); overdue = invoice date + 30 days passed." />
          <Stat label="To invoice" value={cash.toInvoiceN} sub={`${fmtL(cash.toInvoice)}${cash.overdueInvoiceN ? ` · ${cash.overdueInvoiceN} late` : ''}`} tone={cash.overdueInvoiceN ? 'coral' : 'gold'} onClick={() => go('cash')} how="Engagements that have ended with no Invoice date (Finance stage To Invoice / Invoice Overdue); value = Price." />
          <Stat label="Open pipeline" value={fmtL(pipe.pipelineAllV)} sub={`${plural(pipe.pipelineAll, 'proposal')} in process`} tone="mauve" onClick={() => go('pipeline')} how="BD Proposal Value of the latest version of every proposal still In Process (any date)." />
          <Stat label={`Win rate · ${periodLabel}`} value={pipe.winRate == null ? '—' : pipe.winRate + '%'} sub={`${pipe.won} won · ${pipe.lost} lost`} tone="navy" onClick={() => go('pipeline')} how="Won ÷ (Won + Lost) unique proposals dated in the period; In Process not counted." />
          <Stat label="Sessions next 7 days" value={upcoming30.filter(e => e._start <= addDaysIso(todayIso(), 7)).length} sub={`${upcoming30.length} in next 30 days`} tone="navy" onClick={() => go('calendar')} how="Engagement Calendar sessions starting today to 7 days ahead, cancelled excluded." />
          <Stat label="Overdue tasks" value={overdue.length} sub={`across ${plural(new Set(overdue.map(t => t.tracker)).size, 'tracker')}`} tone={overdue.length ? 'coral' : 'green'} onClick={() => go('attention')} how="Open tasks across all trackers whose due date / TAT has passed (same rules as the Reminders popup)." />
          <Stat label="Due this week" value={soon.length} sub="today + next 7 days" tone="gold" onClick={() => go('attention')} how="Open tasks across all trackers due today or within the next 7 days." />
          <Stat label="Missing fields" value={missing.reduce((t, m) => t + m.fields, 0)} sub={`in ${missing.reduce((t, m) => t + m.records, 0)} records`} tone="mauve" onClick={() => go('health')} how="Empty fields that should be filled by now, per tracker rules (same as the Missing tab of the Reminders popup)." />
        </div>
      </Section>
    ),

    attention: () => <AttentionSection {...sp} overdue={overdue} soon={soon} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} open={open} />,

    calendar: () => <CalendarSection {...sp} upcoming={upcoming30} open={open} />,

    pipeline: () => (
      <Section id="pipeline" {...sp} right={<span className="fd-muted">{periodLabel}</span>}>
        <div className="fd-stats fd-stats-4">
          <Stat label="Proposals" value={pipe.count} sub={fmtL(pipe.totalV)} how="Unique proposals dated in the period (latest version); value = BD Proposal Value." />
          <Stat label="Won" value={pipe.won} sub={fmtL(pipe.wonV)} tone="green" how="Proposals in the period with BD Status = Won; BD Proposal Value." />
          <Stat label="In process" value={pipe.open} sub={fmtL(pipe.openV)} tone="gold" how="Proposals in the period still In Process; BD Proposal Value." />
          <Stat label="Lost" value={pipe.lost} sub={fmtL(pipe.lostV)} tone="coral" how="Proposals in the period with BD Status = Lost; BD Proposal Value." />
        </div>
        {pipe.totalV > 0 && (
          <div className="fd-funnel" title="Share of proposal value: won · in process · lost">
            {[['won', pipe.wonV], ['open', pipe.openV], ['lost', pipe.lostV]].filter(([, v]) => v > 0).map(([k, v]) =>
              <div key={k} className={`fd-funnel-${k}`} style={{ flex: v }}>{Math.round((v / pipe.totalV) * 100)}%</div>)}
          </div>
        )}
        <div className="fd-flags">
          {pipe.awaitingSubmission > 0 && <span className="fd-flag gold">{plural(pipe.awaitingSubmission, 'proposal')} in process, not yet submitted</span>}
          {pipe.checklistPending > 0 && <span className="fd-flag coral">{plural(pipe.checklistPending, 'proposal')} without the Operations checklist</span>}
        </div>
        <div className="fd-sub-title">Biggest open proposals</div>
        {pipe.topOpen.length ? (
          <ExpandList rows={pipe.topOpen.map(p => ({
            id: p.id, main: p.client || '(no client)', sub: `${p.id} · ${p.topic || '—'}`, right: fmtL(p.value),
            details: [['Proposal', p.id], ['Program', p.topic], ['Status', p.status], ['Date', p.date], ['Industry', p.industry], ['Line of service', p.lineOfService], ['Proposal link', p.link]],
          }))} onOpen={() => open('bd')} openLabel="Open in BD Tracker" />
        ) : <Empty>No open proposals</Empty>}
        {pipe.recentWins.length > 0 && <>
          <div className="fd-sub-title">Wins · {periodLabel}</div>
          <ExpandList rows={pipe.recentWins.map(p => ({
            id: 'w' + p.id, main: p.client, sub: `${p.id} · ${p.topic || '—'}`, right: fmtL(p.value), tone: 'green',
            details: [['Proposal', p.id], ['Program', p.topic], ['Date', p.date], ['Industry', p.industry], ['Proposal link', p.link]],
          }))} onOpen={() => open('bd')} openLabel="Open in BD Tracker" />
        </>}
      </Section>
    ),

    cash: () => {
      const maxAge = Math.max(1, ...Object.values(cash.aging));
      return (
        <Section id="cash" {...sp} right={<span className="fd-muted">{periodLabel}</span>}>
          <div className="fd-stats fd-stats-4">
            <Stat label="Invoiced" value={fmtL(cash.invoiced)} how="Price + GST (18%) of rows whose Invoice date is in the period; travel excluded." />
            <Stat label="Collected" value={fmtL(cash.collected)} sub={cash.invoiced ? `${Math.round((cash.collected / cash.invoiced) * 100)}% of invoiced` : `${cash.collectedN} payment(s)`} tone="green" how="Amount Received on the Received Date in the period (Invoice date if blank); Price + GST only." />
            <Stat label="Outstanding" value={fmtL(cash.outstanding)} tone="gold" how="(Price + GST − TDS + travel) − amount received on all invoices not marked Received / NA, any date." />
            <Stat label="Overdue (30d+)" value={fmtL(cash.overdueOut)} tone={cash.overdueOut ? 'coral' : 'green'} how="Part of Outstanding whose Invoice date + 30 days has passed." />
          </div>
          {cash.suspects.length > 0 && (
            <div className="fd-alert" style={{ marginTop: 8 }}>
              {cash.suspects.length} "Amount Received" cell{cash.suspects.length > 1 ? 's' : ''} need{cash.suspects.length > 1 ? '' : 's'} checking (capped at the row's bill meanwhile) — fix in the Finance Tracker:{' '}
              {cash.suspects.slice(0, 5).map(x => `${x.company}${x.sno ? ` (S No ${x.sno})` : ''}: "${x.raw}" — ${x.reason}`).join(' · ')}{cash.suspects.length > 5 ? ' …' : ''}
            </div>
          )}
          <div className="fd-sub-title">Receivables ageing · days since invoice (all open invoices)</div>
          <div className="fd-bars">
            {Object.entries(cash.aging).map(([k, v]) => (
              <div key={k} className="fd-bar-row">
                <span className="fd-bar-label">{k} days</span>
                <span className="fd-bar-track"><span className={`fd-bar-fill ${k === '0–30' ? 'ok' : k === '31–60' ? 'warn' : 'bad'}`} style={{ width: `${(v / maxAge) * 100}%` }} /></span>
                <span className="fd-bar-val">{fmtL(v)}</span>
              </div>
            ))}
          </div>
          <div className="fd-sub-title">Largest balances to collect</div>
          {cash.topOutstanding.length ? (
            <div className="fd-bars">
              {cash.topOutstanding.map(([c, v]) => (
                <div key={c} className="fd-bar-row">
                  <span className="fd-bar-label" title={c}>{c}</span>
                  <span className="fd-bar-track"><span className="fd-bar-fill navy" style={{ width: `${(v / (cash.topOutstanding[0][1] || 1)) * 100}%` }} /></span>
                  <span className="fd-bar-val">{fmtL(v)}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No money outstanding</Empty>}
          <div className="fd-foot-link"><button type="button" className="fd-link" onClick={() => open('finance')}><ExternalLink size={13} /> Open Finance Tracker</button></div>
        </Section>
      );
    },

    ops: () => {
      const list = upcoming30.filter(e => e.ready == null || e.ready < 100)
        .sort((a, b) => (a.ready ?? -1) - (b.ready ?? -1) || a._start.localeCompare(b._start));
      const tracked = upcoming30.filter(e => e.ready != null);
      const avg = tracked.length ? Math.round(tracked.reduce((t, e) => t + e.ready, 0) / tracked.length) : null;
      return (
        <Section id="ops" {...sp} count={list.length}>
          <div className="fd-stats fd-stats-3">
            <Stat label="Sessions · next 30 days" value={upcoming30.length} how="Engagement Calendar sessions starting today to 30 days ahead, cancelled excluded." />
            <Stat label="Average readiness" value={avg == null ? '—' : avg + '%'} tone={avg == null ? '' : avg >= 80 ? 'green' : avg >= 50 ? 'gold' : 'coral'} how="Average Ops Checklist completion (items Yes / NA ÷ all items) of those sessions that have an Ops row." />
            <Stat label="Not in Ops Checklist" value={upcoming30.filter(e => !e._ops).length} tone={upcoming30.some(e => !e._ops) ? 'coral' : 'green'} how="Sessions in the next 30 days with no Ops Checklist row of the same Index." />
          </div>
          {list.length ? (
            <ExpandList rows={list.slice(0, 12).map(e => ({
              id: `${e.egId}|${e.sno}`, main: e.company, sub: `${fmtDay(e._start)} · ${e.topic || '—'}`,
              meter: e.ready, right: e._ops ? `${e.openItems} open${e.lateItems ? ` · ${e.lateItems} late` : ''}` : 'Not added', tone: e.lateItems || !e._ops ? 'coral' : '',
              details: [['Dates', `${e._start}${e._end !== e._start ? ' → ' + e._end : ''}`], ['Lead consultant', e.consultant1], ['Co-consultant', e.consultant2], ['Location', e.location],
                ['Internal POC', e._ops?.internalPoc], ['Participants', e._ops?.noOfParticipants], ['Pax list received', e._ops?.paxListReceived],
                ['Contract', [e.contract, e.poStatus].filter(Boolean).join(' · ')]],
            }))} onOpen={() => open('ops')} openLabel="Open in Ops Checklist" />
          ) : <Empty>Every session in the next 30 days is 100% ready</Empty>}
        </Section>
      );
    },

    content: () => {
      const ct = [...overdue, ...soon].filter(t => t.tracker === 'content-dev').sort((a, b) => a.days - b.days);
      const openEntries = cdt.filter(r => { const d = String(r.completionDate ?? '').trim(); return !d || d === '—'; }).length;
      return (
        <Section id="content" {...sp} count={ct.length}>
          <div className="fd-stats fd-stats-3">
            <Stat label="Open entries" value={openEntries} sub={`of ${cdt.length}`} how="Content Dev Tracker entries with no Completion Date." />
            <Stat label="Overdue items" value={ct.filter(t => t.days < 0).length} tone={ct.some(t => t.days < 0) ? 'coral' : 'green'} how="Open content work items and entries whose deadline / due date has passed." />
            <Stat label="Due this week" value={ct.filter(t => t.days >= 0).length} tone="gold" how="Open content work due today or within 7 days." />
          </div>
          {ct.length ? <TaskList tasks={ct.slice(0, 12)} open={open} /> : <Empty>No content work overdue or due this week</Empty>}
        </Section>
      );
    },

    done: () => {
      const inP = done.filter(d => inRange(d.date, range));
      const groups = {};
      inP.forEach(d => { const k = d.tracker === 'ops' ? 'Ops checklist items' : d.label.split(':')[0]; groups[k] = groups[k] || { n: 0, amt: 0 }; groups[k].n++; groups[k].amt += d.amount || 0; });
      const order = ['Session delivered', 'Proposal submitted', 'Invoice raised', 'Payment received', 'Lead converted to BD', 'Lead action', 'Client interaction', 'Client action closed', 'Task completed', 'Vendor cost billed to client', 'Vendor paid', 'Ops checklist items', 'Content completed', 'Content Assets', 'Pre-Work', 'Post-Work', 'Consultant contract renewed'];
      return (
        <Section id="done" {...sp} right={<span className="fd-muted">{periodLabel}</span>} count={inP.length}>
          {inP.length ? (
            <div className="fd-done-grid">
              {order.filter(k => groups[k]).map(k => (
                <div key={k} className="fd-done-tile"><b>{groups[k].n}</b><span>{k}</span>{groups[k].amt > 0 && <em>{fmtL(groups[k].amt)}</em>}</div>
              ))}
            </div>
          ) : <Empty>Nothing completed in this period yet</Empty>}
          {inP.length > 0 && <>
            <div className="fd-sub-title">Latest</div>
            <ExpandList rows={inP.slice(0, 10).map(d => ({
              id: d.id, tag: TRACKERS[d.tracker]?.short, main: d.label, sub: `${d.record}${d.sub ? ' · ' + d.sub : ''}`, right: fmtD(d.date),
              details: [['Tracker', TRACKERS[d.tracker]?.label], ['Record', d.record], ['Detail', d.sub], ['Date', d.date], ['By / owner', d.who], ['Amount', rupee(d.amount)]],
            }))} />
          </>}
        </Section>
      );
    },

    owners: () => {
      const map = new Map();
      [...overdue, ...soon].forEach(t => {
        const o = map.get(t.owner) || { owner: t.owner, over: 0, soon: 0, trackers: new Set() };
        if (t.days < 0) o.over++; else o.soon++;
        o.trackers.add(TRACKERS[t.tracker]?.short);
        map.set(t.owner, o);
      });
      const rows = [...map.values()].sort((a, b) => b.over - a.over || b.soon - a.soon);
      const max = Math.max(1, ...rows.map(r => r.over + r.soon));
      return (
        <Section id="owners" {...sp} count={rows.length}>
          {rows.length ? (
            <table className="fd-table">
              <thead><tr><th>Owner</th><th className="fd-num">Overdue</th><th className="fd-num">This week</th><th className="fd-w40">Load</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.owner} className="fd-click" title="Show this person's tasks in Needs Attention"
                    onClick={() => { setOwnerFilter(r.owner); go('attention'); }}>
                    <td><b>{r.owner}</b><div className="fd-muted">{[...r.trackers].join(', ')}</div></td>
                    <td className={`fd-num${r.over ? ' fd-coral-t' : ''}`}>{r.over}</td>
                    <td className="fd-num">{r.soon}</td>
                    <td><span className="fd-stack"><span className="bad" style={{ width: `${(r.over / max) * 100}%` }} /><span className="warn" style={{ width: `${(r.soon / max) * 100}%` }} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No open tasks</Empty>}
          <div className="fd-muted fd-mt">Owner = the item's POC in the tracker (Ops item POC, Content POC, Invoice POC, lead consultant, task assignee, client account owner, consultant relationship owner). Click a name to see their tasks.</div>
        </Section>
      );
    },

    clients: () => {
      const c = clientSum;
      if (!clientsConfigured()) return <Section id="clients" {...sp}><Empty>Client Directory is not connected yet (CLIENTS_CRUD flow).</Empty></Section>;
      const ago = d => (d ? `${daysBetween(d, todayIso())}d ago` : 'never');
      return (
        <Section id="clients" {...sp} count={c.watch.length}>
          <div className="fd-stats fd-stats-4">
            <Stat label="Existing clients" value={c.existing} sub={`${c.prospects} prospects · ${c.total} in directory`} tone="navy" how="Client Directory records with Client Type = Existing." />
            <Stat label="At risk" value={c.atRisk} sub="amber / red health" tone={c.atRisk ? 'coral' : 'green'} how="Active / existing clients whose Relationship Health is Amber or Red." />
            <Stat label={`No contact ${c.coldDays}d+`} value={c.cold} sub="active / existing accounts" tone={c.cold ? 'gold' : 'green'} how={`Active / existing clients whose last interaction is older than ${c.coldDays} days (or never logged).`} />
            <Stat label="Follow-ups ≤ 7 days" value={c.followWeek} sub={`${c.openActions} open client actions`} tone="mauve" how="Clients whose Next Follow-up date is within the next 7 days (or already passed)." />
          </div>
          <div className="fd-flags">
            {c.noOwner > 0 && <span className="fd-flag gold">{plural(c.noOwner, 'client')} without an account owner</span>}
            {c.withDues > 0 && <span className="fd-flag coral">{fmtL(c.dues)} dues noted on {plural(c.withDues, 'client')}</span>}
          </div>
          <div className="fd-sub-title">Watch list · at risk or going cold</div>
          {c.watch.length ? (
            <ExpandList rows={c.watch.map(x => ({
              id: 'cw' + x.id, main: x.name, sub: [x.type, x.owner ? `owner ${x.owner}` : 'no owner', `last contact ${ago(x.lastTouch)}`].filter(Boolean).join(' · '),
              right: x.health ? `${x.health} health` : 'No contact', tone: x.health === 'Red' ? 'coral' : '',
              details: [['Client', `${x.id} · ${x.name}`], ['Relationship', [x.status, x.health && `${x.health} health`].filter(Boolean).join(' · ')], ['Account owner', x.owner],
                ['Last interaction', x.lastTouch], ['Next follow-up', x.next], ['Next action', x.nextAction], ['Open actions', String(x.openActions)],
                ['Sessions in calendar', String(x.sessions)], ['Dues noted', rupee(x.outstanding)]],
            }))} onOpen={() => open('clients')} openLabel="Open in Client Directory" />
          ) : <Empty>No accounts at risk or going cold</Empty>}
          {c.upcoming.length > 0 && <>
            <div className="fd-sub-title">Follow-ups this week</div>
            <ExpandList rows={c.upcoming.map(x => ({
              id: 'cu' + x.id, main: x.name, sub: x.nextAction || 'Follow up', right: fmtD(x.next), tone: x.next < todayIso() ? 'coral' : '',
              details: [['Client', `${x.id} · ${x.name}`], ['Next action', x.nextAction], ['Due', x.next], ['Account owner', x.owner], ['Last interaction', x.lastTouch]],
            }))} onOpen={() => open('clients')} openLabel="Open in Client Directory" />
          </>}
        </Section>
      );
    },

    projects: () => {
      const p = projSum;
      if (!tasksConfigured()) return <Section id="projects" {...sp}><Empty>Project Management is not connected yet (TASKS_CRUD flow).</Empty></Section>;
      return (
        <Section id="projects" {...sp} count={p.atRisk} right={<span className="fd-muted">done · {periodLabel}</span>}>
          <div className="fd-stats fd-stats-4">
            <Stat label="Active projects" value={p.activeProjects} sub={`${p.atRisk} at risk`} tone={p.atRisk ? 'coral' : 'navy'} how="Projects with at least one open task; at risk = overdue tasks or past the project due date." />
            <Stat label="Open tasks" value={p.open} sub={`${p.waiting} waiting on someone`} how="Tasks not Done / Cancelled across all projects." />
            <Stat label="Overdue tasks" value={p.overdue} sub={`${p.dueWeek} due this week`} tone={p.overdue ? 'coral' : 'green'} onClick={() => { setLayout(l => ({ ...l, tracker: 'tasks' })); go('attention'); }} how="Open project tasks whose Due Date has passed." />
            <Stat label="Tasks done" value={p.done} sub={periodLabel} tone="green" how="Tasks with a Completed Date in the period." />
          </div>
          {p.projects.length ? (
            <ExpandList rows={p.projects.map(x => ({
              id: 'pj' + x.id, main: x.name, sub: [x.client, x.team, x.owner && `owner ${x.owner}`, x.due && `due ${fmtD(x.due)}`].filter(Boolean).join(' · '),
              meter: x.pct, right: x.state === 'At risk' ? `${x.overdue} overdue` : x.state, tone: x.state === 'At risk' ? 'coral' : '',
              details: [['Project', `${x.id} · ${x.name}`], ['Status', x.state], ['Progress', `${x.done} of ${x.total} tasks done (${x.pct}%)`], ['Open tasks', String(x.open)],
                ['Overdue tasks', String(x.overdue)], ['Project owner', x.owner], ['Client', x.client], ['Team', x.team], ['Project due', x.due]],
            }))} onOpen={() => open('tasks')} openLabel="Open in Project Management" />
          ) : <Empty>No active projects</Empty>}
        </Section>
      );
    },

    consultants: () => {
      const b = benchSum;
      if (!consultantsConfigured()) return <Section id="consultants" {...sp}><Empty>Consultant Directory is not connected yet (CONSULTANTS_CRUD flow).</Empty></Section>;
      const max = Math.max(1, ...b.bench.map(x => x.total));
      return (
        <Section id="consultants" {...sp} count={b.renewals.length}>
          <div className="fd-stats fd-stats-4">
            <Stat label="Active consultants" value={b.active} sub={`${b.onboarding} onboarding · ${b.total} listed`} tone="navy" how="Consultant Directory records with Status = Active." />
            <Stat label="Contracts valid" value={b.alerts.ok} tone="green" how="Contract end date further away than the renewal notice days." />
            <Stat label="Renew / expired" value={b.alerts.renew + b.alerts.expired} sub={`${b.alerts.expired} expired`} tone={b.alerts.renew + b.alerts.expired ? 'coral' : 'green'} how="Contracts inside the renewal notice window or already past their end date." />
            <Stat label="No contract date" value={b.alerts.none} tone={b.alerts.none ? 'gold' : 'green'} how="Consultants (inactive skipped) with no Contract End date." />
          </div>
          <div className="fd-sub-title">Sessions in the next {b.days} days · lead + co-consultant</div>
          {b.bench.length ? (
            <div className="fd-bars">
              {b.bench.map(x => (
                <div key={x.name} className="fd-bar-row" title={`${x.lead} as lead · ${x.co} as co-consultant${x.inDirectory ? '' : ' · not in the Consultant Directory'}`}>
                  <span className="fd-bar-label">{x.name}{!x.inDirectory && ' *'}</span>
                  <span className="fd-bar-track"><span className="fd-bar-fill navy" style={{ width: `${(x.total / max) * 100}%` }} /></span>
                  <span className="fd-bar-val">{x.total}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No sessions booked in the next {b.days} days</Empty>}
          {b.notInDirectory > 0 && <div className="fd-muted fd-mt">* {plural(b.notInDirectory, 'name')} in the Engagement Calendar not found in the Consultant Directory (spelling or missing profile).</div>}
          {b.renewals.length > 0 && <>
            <div className="fd-sub-title">Contracts to renew</div>
            <ExpandList rows={b.renewals.map(x => ({
              id: 'cr' + x.id, main: x.name, sub: [x.id, x.type, x.owner && `owner ${x.owner}`].filter(Boolean).join(' · '),
              right: x.alert === 'expired' ? `Expired ${fmtD(x.end)}` : `Ends ${fmtD(x.end)}`, tone: x.alert === 'expired' ? 'coral' : '',
              details: [['Consultant', `${x.id} · ${x.name}`], ['Contract', x.type], ['Ends', x.end], ['Relationship owner', x.owner]],
            }))} onOpen={() => open('consultants')} openLabel="Open in Consultant Directory" />
          </>}
        </Section>
      );
    },

    health: () => (
      <Section id="health" {...sp} count={missing.reduce((t, m) => t + m.fields, 0)}>
        <ExpandList rows={missing.map(m => ({
          id: m.tracker, tracker: m.tracker, main: TRACKERS[m.tracker].label,
          sub: m.records ? m.top.map(([k, n]) => `${k} (${n})`).join(' · ') : 'All required fields filled',
          right: m.fields ? `${m.fields} fields · ${m.records} records` : 'Complete', tone: m.fields ? '' : 'green',
          details: m.items.slice(0, 8).map(it => [`${it.serial ? '#' + it.serial + ' ' : ''}${it.title}`, it.missing.map(x => x.label).join(', ')])
            .concat(m.items.length > 8 ? [[`+ ${m.items.length - 8} more`, 'Open the tracker → Reminders → Missing']] : []),
        }))} onOpenRow={r => open(r.tracker)} openLabel="Fix in the tracker (Reminders → Missing)" />
      </Section>
    ),
  };

  const visible = layout.order.filter(id => !layout.hidden[id]);
  const presetName = layout.preset === 'custom' ? 'Custom layout' : PRESETS[layout.preset]?.label;

  return (
    <div className="fd-page">
      <div className="fd-header">
        <div className="fd-header-left">
          <h1 className="fd-title">Founder's Desk</h1>
          <div className="fd-muted">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {presetName} · all trackers in one place
          </div>
        </div>
        <div className="fd-header-right">
          <select className="fd-select" value={layout.preset} onChange={e => e.target.value !== 'custom' && setLayout(presetLayout(e.target.value))} title="Dashboard view">
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            {layout.preset === 'custom' && <option value="custom">Custom layout</option>}
          </select>
          <select className="fd-select" value={layout.period} onChange={e => setLayout(l => ({ ...l, period: e.target.value }))} title="Period for revenue, pipeline and completed work">
            {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {customInputs}
          <button type="button" className="fd-btn" onClick={load} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'fd-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="fd-btn fd-btn-primary" onClick={() => setCustomising(true)}><Settings2 size={14} /> Customise</button>
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="fd-alert">Showing the last loaded copy for: {Object.entries(errors).map(([k, e]) => `${k} (${e.message})`).join(', ')}</div>
      )}

      {loading ? (
        <div className="fd-grid">{[1, 2, 3, 4].map(i => <div key={i} className="fd-sec fd-half fd-skel" />)}</div>
      ) : (
        <div className="fd-grid">{visible.map(id => <Fragment key={id}>{render[id]()}</Fragment>)}</div>
      )}

      {customising && <CustomisePanel layout={layout} setLayout={setLayout} customise={customise} onClose={() => setCustomising(false)} />}
    </div>
  );
}

/* ─── Needs Attention ─────────────────────────────────────────────────────── */
function AttentionSection({ layout, setLayout, overdue, soon, ownerFilter, setOwnerFilter, open }) {
  const [tab, setTab] = useState('over');
  const [groupBy, setGroupBy] = useState('none');
  const [showAll, setShowAll] = useState(false);
  const tracker = layout.tracker || 'all';
  const base = tab === 'over' ? overdue : soon;
  const owners = [...new Set([...overdue, ...soon].map(t => t.owner))].sort();
  const list = base
    .filter(t => (tracker === 'all' || t.tracker === tracker) && (ownerFilter === 'all' || t.owner === ownerFilter))
    .sort((a, b) => a.days - b.days);
  const counts = {};
  base.forEach(t => { counts[t.tracker] = (counts[t.tracker] || 0) + 1; });
  const shown = showAll ? list : list.slice(0, 15);
  const groups = groupBy === 'none' ? [['', shown]] : Object.entries(shown.reduce((m, t) => {
    const k = groupBy === 'owner' ? t.owner : groupBy === 'tracker' ? TRACKERS[t.tracker].label : t.record;
    (m[k] = m[k] || []).push(t); return m;
  }, {}));
  const filtered = tracker !== 'all' || ownerFilter !== 'all';

  return (
    <Section id="attention" layout={layout} setLayout={setLayout} count={overdue.length + soon.length}
      right={<Seg value={tab} options={[['over', `Overdue · ${overdue.length}`], ['soon', `Due this week · ${soon.length}`]]} onChange={v => { setTab(v); setShowAll(false); }} />}>
      <div className="fd-filters">
        <div className="fd-chips">
          {[['all', 'All', base.length], ...Object.keys(TRACKERS).filter(k => counts[k] || tracker === k).map(k => [k, TRACKERS[k].short, counts[k] || 0])].map(([k, l, n]) => (
            <button key={k} type="button" className={`fd-chip${tracker === k ? ' on' : ''}`} onClick={() => setLayout(x => ({ ...x, tracker: k }))}>{l} <b>{n}</b></button>
          ))}
        </div>
        <div className="fd-filters-right">
          <select className="fd-select sm" value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} title="Owner">
            <option value="all">All owners</option>
            {owners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select className="fd-select sm" value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Group by">
            <option value="none">No grouping</option><option value="tracker">Group by tracker</option>
            <option value="owner">Group by owner</option><option value="record">Group by client</option>
          </select>
          {filtered && <button type="button" className="fd-link" onClick={() => { setOwnerFilter('all'); setLayout(x => ({ ...x, tracker: 'all' })); }}>Clear filters</button>}
        </div>
      </div>
      {!list.length ? <Empty>{tab === 'over' ? 'Nothing overdue' : 'Nothing due this week'}{filtered ? ' for this filter' : ''}</Empty> : (
        <>
          {groups.map(([g, ts]) => (
            <div key={g || 'all'}>
              {g && <div className="fd-group-head">{g} <span>{ts.length}</span></div>}
              <TaskList tasks={ts} open={open} />
            </div>
          ))}
          {list.length > 15 && (
            <button type="button" className="fd-more" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show less' : `Show all ${list.length}`}</button>
          )}
        </>
      )}
    </Section>
  );
}

function TaskList({ tasks, open }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="fd-list">
      {tasks.map(t => {
        const isOpen = openId === t.id;
        return (
          <div key={t.id} className={`fd-item${isOpen ? ' open' : ''}`}>
            <div className="fd-item-row" onClick={() => setOpenId(isOpen ? null : t.id)}>
              <span className={`fd-sev ${t.days < 0 ? (t.days < -14 ? 'bad2' : 'bad') : t.days <= 2 ? 'warn' : 'ok'}`} />
              <span className="fd-tag">{TRACKERS[t.tracker]?.short}</span>
              <div className="fd-item-main">
                <div className="fd-item-title">{t.label}</div>
                <div className="fd-item-sub">{t.serial ? `#${t.serial} · ` : ''}{t.record}{t.sub ? ` · ${t.sub}` : ''}</div>
              </div>
              <div className="fd-item-owner" title="Owner">{t.owner}</div>
              {t.amount > 0 && <div className="fd-item-amt">{fmtL(t.amount)}</div>}
              <div className={`fd-due ${t.days < 0 ? 'bad' : t.days <= 2 ? 'warn' : ''}`}>
                <b>{dueText(t.days)}</b><span>{fmtD(t.due)}</span>
              </div>
              <ChevronRight size={15} className="fd-caret" />
            </div>
            {isOpen && <Details rows={[['Task', t.label], ['Due', t.due], ['Owner', t.owner], ...t.details]} onOpen={() => open(t.tracker)} openLabel={`Open in ${TRACKERS[t.tracker]?.label}`} />}
          </div>
        );
      })}
    </div>
  );
}

function ExpandList({ rows, onOpen, onOpenRow, openLabel }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="fd-list">
      {rows.map(r => {
        const isOpen = openId === r.id;
        return (
          <div key={r.id} className={`fd-item${isOpen ? ' open' : ''}`}>
            <div className="fd-item-row" onClick={() => setOpenId(isOpen ? null : r.id)}>
              {r.tag && <span className="fd-tag">{r.tag}</span>}
              <div className="fd-item-main">
                <div className="fd-item-title">{r.main}</div>
                {r.sub && <div className="fd-item-sub">{r.sub}</div>}
              </div>
              {r.meter != null && <Meter value={r.meter} />}
              {r.right && <div className={`fd-item-right${r.tone ? ' fd-' + r.tone + '-t' : ''}`}>{r.right}</div>}
              <ChevronRight size={15} className="fd-caret" />
            </div>
            {isOpen && <Details rows={r.details} onOpen={onOpenRow ? () => onOpenRow(r) : onOpen} openLabel={openLabel} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Upcoming deliveries ─────────────────────────────────────────────────── */
function CalendarSection({ layout, setLayout, upcoming, open }) {
  const [days, setDays] = useState(14);
  const [openId, setOpenId] = useState(null);
  const t = todayIso(), until = addDaysIso(t, days);
  const list = upcoming.filter(e => e._start <= until);
  const byDay = list.reduce((m, e) => { const k = e._start < t ? t : e._start; (m[k] = m[k] || []).push(e); return m; }, {});
  const consultants = new Set(list.map(e => e.consultant1).filter(Boolean));
  const label = iso => (iso === t ? 'Today' : iso === addDaysIso(t, 1) ? 'Tomorrow' : fmtDay(iso));
  return (
    <Section id="calendar" layout={layout} setLayout={setLayout} count={list.length}
      right={<Seg value={days} options={[[7, '7d'], [14, '14d'], [30, '30d']]} onChange={setDays} />}>
      <div className="fd-muted fd-mb">{plural(list.length, 'session')} · {plural(consultants.size, 'consultant')} · {list.filter(e => /tentative/i.test(e.status || '')).length} tentative · {list.filter(e => !e._ops).length} not in Ops Checklist</div>
      {!list.length ? <Empty>No deliveries in the next {days} days</Empty> : Object.entries(byDay).map(([d, es]) => (
        <div key={d} className="fd-day">
          <div className="fd-day-head">{label(d)}</div>
          <div className="fd-list">
            {es.map(e => {
              const id = `${e.egId}|${e.sno}`;
              const isOpen = openId === id;
              return (
                <div key={id} className={`fd-item${isOpen ? ' open' : ''}`}>
                  <div className="fd-item-row" onClick={() => setOpenId(isOpen ? null : id)}>
                    <div className="fd-item-main">
                      <div className="fd-item-title">{e.company} <StatusBadge value={e.status} />{e._start < t && <span className="fd-flag sm">ongoing</span>}</div>
                      <div className="fd-item-sub">{e.topic || '—'} · {e.consultant1 || 'No consultant'} · {e.location || '—'}</div>
                    </div>
                    {e.ready != null
                      ? <Meter value={e.ready} title={`Ops checklist ${e.ready}% · ${e.openItems} open, ${e.lateItems} late`} />
                      : <span className="fd-flag coral sm">Not in Ops</span>}
                    <ChevronRight size={15} className="fd-caret" />
                  </div>
                  {isOpen && <Details rows={[
                    ['EG.ID', e.egId], ['Dates', `${e._start}${e._end !== e._start ? ' → ' + e._end : ''}`], ['Days', e.day], ['Lead consultant', e.consultant1], ['Co-consultant', e.consultant2],
                    ['Location', e.location], ['Service', [e.serviceType, e.offering].filter(Boolean).join(' · ')], ['Contract', [e.contract, e.poStatus].filter(Boolean).join(' · ')],
                    ['Price', rupee(Number(e.price))], ['Ops readiness', e.ready != null ? `${e.ready}% · ${e.openItems} open · ${e.lateItems} late` : 'Not added to Ops Checklist'],
                    ['Internal POC', e._ops?.internalPoc], ['Participants', e._ops?.noOfParticipants], ['Comments', e.comments], ['Proposal link', e.proposalLink],
                  ]} onOpen={() => open('engagement')} openLabel="Open in Engagement Calendar" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Section>
  );
}

/* ─── Customise panel ─────────────────────────────────────────────────────── */
function CustomisePanel({ layout, setLayout, customise, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const move = (id, d) => customise(l => {
    const o = [...l.order]; const i = o.indexOf(id); const j = i + d;
    if (j < 0 || j >= o.length) return l;
    [o[i], o[j]] = [o[j], o[i]]; return { ...l, order: o };
  });
  return (
    <div className="fd-drawer-overlay" onMouseDown={e => { if (ref.current && !ref.current.contains(e.target)) onClose(); }}>
      <aside className="fd-drawer" ref={ref} role="dialog" aria-label="Customise dashboard">
        <div className="fd-drawer-head">
          <div><div className="fd-drawer-title">Customise dashboard</div><div className="fd-muted">Saved in this browser</div></div>
          <button type="button" className="fd-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="fd-drawer-body">
          <div className="fd-drawer-label">Start from a view</div>
          <div className="fd-presets">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} type="button" className={`fd-preset${layout.preset === k ? ' on' : ''}`} onClick={() => setLayout(presetLayout(k))}>
                <b>{p.label}</b><span>{p.desc}</span>
              </button>
            ))}
          </div>

          <div className="fd-drawer-label">Sections · show / hide, width, order</div>
          <div className="fd-sec-list">
            {layout.order.map((id, i) => {
              const S = SECTIONS[id]; const hidden = !!layout.hidden[id];
              return (
                <div key={id} className={`fd-sec-line${hidden ? ' off' : ''}`}>
                  <button type="button" className="fd-icon-btn" title={hidden ? 'Show section' : 'Hide section'}
                    onClick={() => customise(l => ({ ...l, hidden: { ...l.hidden, [id]: !hidden } }))}>{hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  <S.Icon size={14} className="fd-sec-line-icon" />
                  <span className="fd-sec-line-name">{S.title}</span>
                  <div className="fd-seg xs">
                    {[['half', 'Half'], ['full', 'Full']].map(([w, l]) => (
                      <button key={w} type="button" className={layout.width[id] === w ? 'on' : ''} disabled={hidden}
                        onClick={() => customise(x => ({ ...x, width: { ...x.width, [id]: w } }))}>{l}</button>
                    ))}
                  </div>
                  <button type="button" className="fd-icon-btn" disabled={i === 0} onClick={() => move(id, -1)} title="Move up"><ChevronUp size={15} /></button>
                  <button type="button" className="fd-icon-btn" disabled={i === layout.order.length - 1} onClick={() => move(id, 1)} title="Move down"><ChevronDown size={15} /></button>
                </div>
              );
            })}
          </div>

          <div className="fd-drawer-label">Period for revenue, pipeline and completed work</div>
          <select className="fd-select" value={layout.period} onChange={e => setLayout(l => ({ ...l, period: e.target.value }))}>
            {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {layout.period === 'custom' && <div className="fd-muted" style={{ marginTop: 4 }}>Set the dates in the header, next to the period list.</div>}

          <div className="fd-drawer-label">Collapse</div>
          <div className="fd-row-btns">
            <button type="button" className="fd-btn" onClick={() => setLayout(l => ({ ...l, collapsed: Object.fromEntries(ALL_IDS.map(x => [x, true])) }))}>Collapse all</button>
            <button type="button" className="fd-btn" onClick={() => setLayout(l => ({ ...l, collapsed: {} }))}>Expand all</button>
          </div>
        </div>

        <div className="fd-drawer-foot">
          <button type="button" className="fd-btn" onClick={() => setLayout(presetLayout('founder'))}><RotateCcw size={14} /> Reset</button>
          <button type="button" className="fd-btn fd-btn-primary" onClick={onClose}>Done</button>
        </div>
      </aside>
    </div>
  );
}
