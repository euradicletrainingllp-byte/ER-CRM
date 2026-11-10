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
  ShieldAlert, Target, Banknote, PieChart,
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
import {
  revenueOutlook, cashForecast, clientMix, deliveryRisks, pipelineHealth, qualitySummary, riskRadar, RISK_AREAS, RISK_RULES,
} from '../services/founderInsights.js';
import '../styles/founder.css';

// Same switch as Dashboard → Finance ("Revenue by: Delivery month / Invoice month") — one setting for both pages
const BASIS_KEY = 'ercrm.dash.finance.basis.v1';
const readBasis = () => { try { return localStorage.getItem(BASIS_KEY) === 'invoice' ? 'invoice' : 'delivery'; } catch { return 'delivery'; } };

/* ─── Sections & views ────────────────────────────────────────────────────── */
const SECTIONS = {
  pulse:     { title: 'Business Pulse',      Icon: Gauge,          desc: 'Revenue, cash, pipeline and workload at a glance', width: 'full' },
  risk:      { title: 'Risk Radar',          Icon: ShieldAlert,    desc: 'What could hurt revenue, cash, delivery or clients next — ranked, with the records behind each risk', width: 'full' },
  outlook:   { title: 'Revenue Outlook',     Icon: Target,         desc: 'FY target vs achieved, bookings ahead, pace and the run-rate still needed', width: 'full' },
  forecast:  { title: 'Cash Forecast',       Icon: Banknote,       desc: 'Money expected in the next 90 days, how fast clients pay, tax tied up', width: 'half' },
  concentration: { title: 'Client Concentration', Icon: PieChart,  desc: 'Revenue share by client and accounts with no next business', width: 'half' },
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
    order: ['pulse', 'risk', 'outlook', 'attention', 'calendar', 'pipeline', 'cash', 'forecast', 'concentration', 'clients', 'projects', 'ops', 'content', 'consultants', 'done', 'owners', 'health'], tracker: 'all', period: 'fy' },
  risk:     { label: 'Risk review', desc: 'Future risks first: target, cash, delivery, client dependence',
    order: ['pulse', 'risk', 'outlook', 'forecast', 'concentration', 'calendar', 'pipeline'], tracker: 'all', period: 'fy' },
  monday:   { label: 'Monday review', desc: 'Weekly meeting: risks, owners, this week, money',
    order: ['pulse', 'risk', 'attention', 'owners', 'projects', 'calendar', 'pipeline', 'clients', 'cash'], tracker: 'all', period: 'month' },
  sales:    { label: 'Sales & pipeline', desc: 'Proposals, wins and follow-ups',
    order: ['pulse', 'outlook', 'pipeline', 'concentration', 'clients', 'attention', 'done'], tracker: 'bd', period: 'quarter' },
  delivery: { label: 'Delivery & operations', desc: 'Sessions, readiness, content, who is stuck',
    order: ['risk', 'calendar', 'ops', 'consultants', 'attention', 'content', 'projects', 'owners'], tracker: 'ops', period: 'month' },
  cash:     { label: 'Cash & collections', desc: 'Invoices to raise, money to collect',
    order: ['pulse', 'cash', 'forecast', 'attention', 'done'], tracker: 'finance', period: 'quarter' },
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
      // A saved ready-made view picks up new sections in its own place; a custom layout keeps its order
      if (v.preset && PRESETS[v.preset]) {
        const base = presetLayout(v.preset);
        return { ...base, collapsed: v.collapsed || {}, period: v.period || base.period, custom: v.custom, tracker: v.tracker || base.tracker };
      }
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
const fyName = y => `FY ${String(y).slice(2)}-${String(y + 1).slice(2)}`;
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
  const [basis, setBasisState] = useState(readBasis);
  const setBasis = b => { setBasisState(b); try { localStorage.setItem(BASIS_KEY, b); } catch { /* storage blocked */ } };

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

  // Forward view + risks (founderInsights.js)
  const outlook = useMemo(() => revenueOutlook(eng, sol, { basis }), [eng, sol, basis]);
  const forecast = useMemo(() => cashForecast(eng), [eng]);
  const mix = useMemo(() => clientMix(eng, sol), [eng, sol]);
  const delivery = useMemo(() => deliveryRisks(eng, ops, consultants), [eng, ops, consultants]);
  const pipeH = useMemo(() => pipelineHealth(sol), [sol]);
  const quality = useMemo(() => qualitySummary(eng), [eng]);
  const risks = useMemo(() => riskRadar({ outlook, forecast, mix, delivery, pipe: pipeH, quality, cash, tasks, clientSum: clientsConfigured() ? clientSum : null, leads, vendors, missing }),
    [outlook, forecast, mix, delivery, pipeH, quality, cash, tasks, clientSum, leads, vendors, missing]);
  const highRisks = risks.filter(r => r.level === 'high').length;

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
        <div className="fd-stats fd-stats-6">
          {basis === 'invoice'
            ? <Stat label={`Revenue invoiced · ${periodLabel}`} value={fmtL(cash.bookedInv)} sub={`${fmtL(cash.booked)} by delivery month`} tone="navy" onClick={() => go('outlook')} how="Revenue by Invoice month (same switch as Dashboard → Finance): Price (INR) of rows whose Invoice date is in the period, cancelled excluded. GST & travel excluded." />
            : <Stat label={`Revenue booked · ${periodLabel}`} value={fmtL(cash.booked)} sub={`${fmtL(cash.delivered)} delivered`} tone="navy" onClick={() => go('outlook')} how="Revenue by Delivery month (same switch as Dashboard → Finance): Price (INR) of sessions starting in the period, not cancelled / lost / postponed / on hold; sub-line = those marked Delivered. GST & travel excluded." />}
          <Stat label={`FY target · ${fyName(outlook.fy)}`} value={outlook.target ? `${Math.round((outlook.achievedPct || 0) * 100)}%` : '—'}
            sub={outlook.target ? `${fmtL(outlook.achievedTotal)} of ${fmtL(outlook.target)} · pace ${outlook.pace == null ? '—' : Math.round(outlook.pace * 100) + '%'}` : 'No target set'}
            tone={outlook.pace == null ? 'navy' : outlook.pace < RISK_RULES.paceHigh ? 'coral' : outlook.pace < RISK_RULES.paceMedium ? 'gold' : 'green'} onClick={() => go('outlook')}
            how="Achieved to date ÷ FY target (config: FIN_TARGET_CR). Pace = achieved ÷ the target due by today (quarterly targets ÷ 3 per month)." />
          <Stat label="Open risks" value={risks.length} sub={`${highRisks} high · ${risks.filter(r => r.level === 'medium').length} medium`} tone={highRisks ? 'coral' : risks.length ? 'gold' : 'green'} onClick={() => go('risk')}
            how="Risk Radar rules across revenue, cash, sales, delivery, clients, people, quality and data." />
          <Stat label={`Collected · ${periodLabel}`} value={fmtL(cash.collected)} sub={`${fmtL(cash.invoiced)} invoiced`} tone="green" onClick={() => go('cash')} how="Amount Received on the Received Date in the period (Invoice date if blank); Price + GST only, never above the invoice." />
          <Stat label="Outstanding" value={fmtL(cash.outstanding)} sub={cash.overdueOut ? `${fmtL(cash.overdueOut)} overdue` : 'Nothing overdue'} tone={cash.overdueOut ? 'coral' : 'green'} onClick={() => go('cash')} how="(Price + GST − TDS + travel) − amount received on every invoice not marked Received / NA (any date); overdue = invoice date + 30 days passed." />
          <Stat label="Cash in · next 90 days" value={fmtL(forecast.next90)} sub={`+ ${fmtL(forecast.overdueNow)} already overdue`} tone="green" onClick={() => go('forecast')}
            how="Open invoices by due date (invoice + 30), sessions to invoice (paid 30 days after invoicing) and coming sessions (end + 31 days; tentative at 50%). Price + GST − TDS + travel." />
          <Stat label="To invoice" value={cash.toInvoiceN} sub={`${fmtL(cash.toInvoice)}${cash.overdueInvoiceN ? ` · ${cash.overdueInvoiceN} late` : ''}`} tone={cash.overdueInvoiceN ? 'coral' : 'gold'} onClick={() => go('cash')} how="Engagements that have ended with no Invoice date (Finance stage To Invoice / Invoice Overdue); value = Price." />
          <Stat label="Open pipeline" value={fmtL(pipe.pipelineAllV)} sub={`${plural(pipe.pipelineAll, 'proposal')} in process`} tone="mauve" onClick={() => go('pipeline')} how="BD Proposal Value of the latest version of every proposal still In Process (any date)." />
          <Stat label={`Win rate · ${periodLabel}`} value={pipe.winRate == null ? '—' : pipe.winRate + '%'} sub={`${pipe.won} won · ${pipe.lost} lost`} tone="navy" onClick={() => go('pipeline')} how="Won ÷ (Won + Lost) unique proposals dated in the period; In Process not counted." />
          <Stat label="Sessions next 7 days" value={upcoming30.filter(e => e._start <= addDaysIso(todayIso(), 7)).length} sub={`${upcoming30.length} in next 30 days`} tone="navy" onClick={() => go('calendar')} how="Engagement Calendar sessions starting today to 7 days ahead, cancelled excluded." />
          <Stat label="Overdue tasks" value={overdue.length} sub={`${soon.length} more due this week`} tone={overdue.length ? 'coral' : 'green'} onClick={() => go('attention')} how="Open tasks across all trackers whose due date / TAT has passed (same rules as the Reminders popup); sub-line = due today or within 7 days." />
          <Stat label="Missing fields" value={missing.reduce((t, m) => t + m.fields, 0)} sub={`in ${missing.reduce((t, m) => t + m.records, 0)} records`} tone="mauve" onClick={() => go('health')} how="Empty fields that should be filled by now, per tracker rules (same as the Missing tab of the Reminders popup)." />
        </div>
      </Section>
    ),

    risk: () => <RiskSection {...sp} risks={risks} go={go} open={open} />,

    outlook: () => {
      const o = outlook;
      const pc = v => (v == null ? '—' : Math.round(v * 100) + '%');
      return (
        <Section id="outlook" {...sp} right={<Seg value={basis} options={[['delivery', 'Delivery month'], ['invoice', 'Invoice month']]} onChange={setBasis} />}>
          <div className="fd-stats fd-stats-6">
            <Stat label="Achieved to date" value={fmtL(o.achievedTotal)} sub={o.target ? `${pc(o.achievedPct)} of ${fmtL(o.target)} target` : 'No FY target set'} tone="navy"
              how={basis === 'invoice' ? 'Price (INR) of rows invoiced this FY up to today, cancelled excluded.' : 'Price (INR) of sessions this FY that have started (or are marked Delivered); cancelled / lost / postponed / on hold excluded.'} />
            <Stat label="Pace vs target" value={pc(o.pace)} sub={`${fmtL(o.proRata)} due by today`} tone={o.pace == null ? '' : o.pace < RISK_RULES.paceHigh ? 'coral' : o.pace < RISK_RULES.paceMedium ? 'gold' : 'green'}
              how="Achieved ÷ the target due by today: monthly targets of the months gone + the elapsed share of this month (monthly = quarterly target ÷ 3)." />
            <Stat label="Booked ahead" value={fmtL(o.confirmedTotal)} sub={`+ ${fmtL(o.tentativeTotal)} tentative`} tone="mauve"
              how={basis === 'invoice' ? 'Sessions not invoiced yet, placed in the month their invoice is due (end + 1 day), up to 31 March.' : 'Future sessions this FY: Scheduled / Re-schedule = confirmed, Tentative shown separately.'} />
            <Stat label="Projected FY landing" value={fmtL(o.projected)} sub={o.target ? `${pc(o.projectedPct)} of target` : ''} tone={o.projectedPct == null ? 'navy' : o.projectedPct >= 1 ? 'green' : o.projectedPct >= 0.8 ? 'gold' : 'coral'}
              how="Achieved + confirmed + 50% of tentative. New wins not included." />
            <Stat label="Still to win" value={fmtL(o.gapAfterBooked)} sub={o.gapAfterBooked ? `${fmtL(o.runRateNeeded)}/month needed · avg so far ${fmtL(o.avgMonthlyAchieved)}` : 'Target covered'} tone={o.gapAfterBooked ? 'gold' : 'green'}
              how="FY target − projection. Run-rate = that gap ÷ months left in the FY; compared with the average achieved per month so far." />
            <Stat label="Pipeline cover" value={o.coverage == null ? '—' : o.coverage.toFixed(1) + '×'} sub={`${fmtL(o.openPipeline)} open · ~${fmtL(o.weightedPipeline)} at ${pc(o.winRate)} win rate`}
              tone={o.coverage == null ? 'green' : o.coverage < RISK_RULES.pipelineCoverHigh ? 'coral' : o.coverage < RISK_RULES.pipelineCoverMedium ? 'gold' : 'green'} onClick={() => go('pipeline')}
              how="Open BD Proposal Value (latest version) ÷ still-to-win. 3× or more is healthy. Weighted = open value × win rate (won ÷ won + lost)." />
          </div>
          <RevenueChart o={o} fyName={fyName} />
          <div className="fd-outlook-foot">
            <div className="fd-qwrap"><table className="fd-table fd-qtable">
              <thead><tr><th>Quarter</th><th className="fd-r">Target</th><th className="fd-r">Achieved</th><th className="fd-r">Booked ahead</th><th className="fd-w40">Covered</th></tr></thead>
              <tbody>
                {o.quarters.map(q => (
                  <tr key={q.q} className={q.current ? 'fd-q-now' : ''}>
                    <td><b>{q.q}</b>{q.current && <span className="fd-flag sm" style={{ marginLeft: 6 }}>now</span>}{!q.targetSet && q.target > 0 && <span className="fd-muted" title="No quarterly target set — the rest of the FY target is shared"> *</span>}</td>
                    <td className="fd-r">{q.target ? fmtL(q.target) : '—'}</td>
                    <td className="fd-r">{fmtL(q.achieved)}</td>
                    <td className="fd-r">{q.past ? '—' : fmtL(q.confirmed + q.tentative)}</td>
                    <td>{q.pct == null ? '—' : <Meter value={Math.min(100, Math.round(q.pct * 100))} title={`${Math.round(q.pct * 100)}% of the quarter target achieved or confirmed`} />}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="fd-muted fd-outlook-notes">
              {o.yoy != null && <div><b className={o.yoy >= 0 ? 'fd-green-t' : 'fd-coral-t'}>{o.yoy >= 0 ? '+' : ''}{Math.round(o.yoy * 100)}%</b> vs the same date last FY ({fmtL(o.lastFyToDate)}).</div>}
              {o.creditNotes > 0 && <div>Credit notes recorded this FY: {fmtL(o.creditNotes)} (not deducted above — same as Dashboard → Finance).</div>}
              <div>Revenue by {basis === 'invoice' ? 'Invoice month' : 'Delivery (session start) month'} — the same switch as Dashboard → Finance. Price (INR) only; GST, TDS and travel excluded.</div>
              {o.quarters.some(q => !q.targetSet && q.target > 0) && <div>* No quarterly target set: the rest of the FY target is shared across it.</div>}
            </div>
          </div>
        </Section>
      );
    },

    forecast: () => {
      const f = forecast;
      const maxB = Math.max(1, ...f.buckets.map(b => b.total));
      const days = v => (v == null ? '—' : Math.round(v) + ' days');
      return (
        <Section id="forecast" {...sp}>
          <div className="fd-stats fd-stats-4">
            <Stat label="Expected · next 90 days" value={fmtL(f.next90)} tone="green" how="Open invoice balances by due date (invoice + 30), sessions to invoice and coming sessions (tentative at 50%). Price + GST − TDS + travel." />
            <Stat label="Overdue now" value={fmtL(f.overdueNow)} tone={f.overdueNow ? 'coral' : 'green'} how="Open invoice balances whose invoice date + 30 days has passed." />
            <Stat label="Days to get paid" value={days(f.dso)} sub={f.dsoRecent != null ? `last 90 days: ${days(f.dsoRecent)}` : `${f.paidCount} payments`}
              tone={f.dso == null ? '' : f.dso > RISK_RULES.dsoHigh ? 'coral' : f.dso > RISK_RULES.dsoMedium ? 'gold' : 'green'} how="Average days from Invoice date to Received Date, weighted by amount, payments in the last 12 months (terms: 30 days)." />
            <Stat label="Paid within 30 days" value={f.onTimePct == null ? '—' : Math.round(f.onTimePct * 100) + '%'} sub={`of ${f.paidCount} payments`} tone="navy" how="Share of payments (last 12 months) received within 30 days of the invoice." />
          </div>
          <div className="fd-legend">
            <span><i className="fd-key navy" />Invoice raised</span><span><i className="fd-key gold" />To invoice</span><span><i className="fd-key mauve" />Coming sessions</span>
          </div>
          <div className="fd-list">
            {f.buckets.map((b, i) => <ForecastRow key={b.label} b={b} max={maxB} overdue={i === 0} open={open} />)}
          </div>
          <div className="fd-tax">
            <div><span>TDS deducted by clients · this FY</span><b>{fmtL(f.tdsFy)}</b><em>10% of Price on rows paid this FY — match with Form 26AS</em></div>
            <div><span>GST already paid on unpaid invoices</span><b>{fmtL(f.gstOnUnpaid)}</b><em>18% GST on the unpaid share of open invoices</em></div>
          </div>
          {f.slowPayers.length > 0 && <>
            <div className="fd-sub-title">Slowest payers · last 12 months</div>
            <div className="fd-bars">
              {f.slowPayers.map(p => (
                <div key={p.client} className="fd-bar-row" title={`${p.payments} payments`}>
                  <span className="fd-bar-label">{p.client}</span>
                  <span className="fd-bar-track"><span className={`fd-bar-fill ${p.days > RISK_RULES.dsoHigh ? 'bad' : p.days > RISK_RULES.dsoMedium ? 'warn' : 'navy'}`} style={{ width: `${Math.min(100, (p.days / Math.max(...f.slowPayers.map(x => x.days))) * 100)}%` }} /></span>
                  <span className="fd-bar-val">{p.days}d</span>
                </div>
              ))}
            </div>
          </>}
        </Section>
      );
    },

    concentration: () => {
      const m = mix;
      const pc = v => Math.round(v * 100) + '%';
      return (
        <Section id="concentration" {...sp} count={m.noForward.length || null}>
          <div className="fd-stats fd-stats-3">
            <Stat label="Largest client" value={m.top[0] ? pc(m.topShare) : '—'} sub={m.top[0]?.name || ''} tone={m.topShare > RISK_RULES.topClientHigh ? 'coral' : m.topShare > RISK_RULES.topClientMedium ? 'gold' : 'green'}
              how="Share of revenue (Price, sessions started in the last 12 months, cancelled / lost / postponed excluded). Client names grouped by first word." />
            <Stat label="Top 3 clients" value={m.top.length ? pc(m.top3Share) : '—'} sub={`${fmtL(m.total)} · last 12 months`} tone={m.top3Share > RISK_RULES.top3Medium ? 'gold' : 'navy'} how="Share of the last-12-month revenue from the three largest clients." />
            <Stat label="Effective clients" value={m.effectiveClients ? m.effectiveClients.toFixed(1) : '—'} sub={`of ${m.clients} paying clients`} tone="navy"
              how="1 ÷ Σ(share²) — how many equal-size clients the revenue is worth. Low = dependent on few accounts." />
          </div>
          <div className="fd-sub-title">Share of revenue · last 12 months</div>
          {m.top.length ? (
            <div className="fd-bars">
              {m.top.map(c => (
                <div key={c.key} className="fd-bar-row fd-bar-row-wide" title={`${fmtL(c.revenue)} · ${c.forward ? fmtL(c.forward) + ' booked ahead' : 'nothing booked ahead'}`}>
                  <span className="fd-bar-label">{c.name}</span>
                  <span className="fd-bar-track"><span className="fd-bar-fill navy" style={{ width: `${(c.share / (m.top[0].share || 1)) * 100}%` }} /></span>
                  <span className="fd-bar-val">{pc(c.share)}</span>
                  <span className={`fd-bar-note${c.forward ? '' : ' fd-coral-t'}`}>{c.forward ? `${fmtL(c.forward)} ahead` : 'none ahead'}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No revenue in the last 12 months</Empty>}
          <div className="fd-sub-title">No next business · recent clients with no future session and no open proposal</div>
          {m.noForward.length ? (
            <ExpandList rows={m.noForward.slice(0, 10).map(c => ({
              id: 'nf' + c.key, main: c.name, sub: `last session ${fmtD(c.last)}${c.lastTopic ? ' · ' + c.lastTopic : ''}`, right: fmtL(c.revenue), tone: c.share > 0.05 ? 'coral' : '',
              details: [['Revenue last 12 months', rupee(c.revenue)], ['Share', pc(c.share)], ['Last session', c.last], ['Program', c.lastTopic]],
            }))} onOpen={() => open('clients')} openLabel="Open in Client Directory" />
          ) : <Empty>Every recent client has a future session or an open proposal</Empty>}
        </Section>
      );
    },

    attention: () => <AttentionSection {...sp} overdue={overdue} soon={soon} ownerFilter={ownerFilter} setOwnerFilter={setOwnerFilter} open={open} />,

    calendar: () => <CalendarSection {...sp} upcoming={upcoming30} open={open} flags={delivery.flags} />,

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
          {pipeH.stale.length > 0 && <span className="fd-flag coral" title={`In Process, dated more than ${RISK_RULES.staleDays} days ago`}>{plural(pipeH.stale.length, 'proposal')} older than {RISK_RULES.staleDays} days · {fmtL(pipeH.staleValue)}</span>}
          {pipeH.noAnswer.length > 0 && <span className="fd-flag gold" title={`Sent to the client more than ${RISK_RULES.noAnswerDays} days ago, still In Process`}>{plural(pipeH.noAnswer.length, 'proposal')} with no client answer {RISK_RULES.noAnswerDays}d+</span>}
          {pipeH.noValue.length > 0 && <span className="fd-flag">{plural(pipeH.noValue.length, 'open proposal')} without a BD value</span>}
        </div>
        {pipeH.open.length > 0 && <>
          <div className="fd-sub-title">Age of open proposals · all dates</div>
          <div className="fd-bars">
            {pipeH.ageBands.map(b => (
              <div key={b.label} className="fd-bar-row" title={`${b.count} proposals · ${fmtL(b.value)}`}>
                <span className="fd-bar-label">{b.label}</span>
                <span className="fd-bar-track"><span className={`fd-bar-fill ${b.label === '90+' ? 'bad' : b.label === '61–90' ? 'warn' : 'navy'}`} style={{ width: `${(b.value / Math.max(1, ...pipeH.ageBands.map(x => x.value))) * 100}%` }} /></span>
                <span className="fd-bar-val">{b.count} · {fmtL(b.value)}</span>
              </div>
            ))}
          </div>
        </>}
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
function CalendarSection({ layout, setLayout, upcoming, open, flags }) {
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
      <div className="fd-muted fd-mb">{plural(list.length, 'session')} · {plural(consultants.size, 'consultant')} · {list.filter(e => /tentative/i.test(e.status || '')).length} tentative · {list.filter(e => !e._ops).length} not in Ops Checklist · {list.filter(e => (flags?.get(`${e.egId}|${e.sno}`) || []).length).length} with risk flags</div>
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
                      {(flags?.get(id) || []).length > 0 && <div className="fd-item-flags">{[...new Set(flags.get(id))].map(f => <span key={f} className="fd-flag coral sm">{f}</span>)}</div>}
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

/* ─── Risk Radar ──────────────────────────────────────────────────────────── */
const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
function RiskSection({ layout, setLayout, risks, go, open }) {
  const [area, setArea] = useState('all');
  const [level, setLevel] = useState('all');
  const [openId, setOpenId] = useState(null);
  const byArea = RISK_AREAS.map(a => {
    const list = risks.filter(r => r.area === a);
    return { area: a, n: list.length, worst: list.some(r => r.level === 'high') ? 'high' : list.some(r => r.level === 'medium') ? 'medium' : list.length ? 'low' : 'none' };
  });
  const list = risks.filter(r => (area === 'all' || r.area === area) && (level === 'all' || r.level === level));
  const n = l => risks.filter(r => r.level === l).length;
  return (
    <Section id="risk" layout={layout} setLayout={setLayout} count={risks.length}
      right={<Seg value={level} options={[['all', `All · ${risks.length}`], ['high', `High · ${n('high')}`], ['medium', `Medium · ${n('medium')}`], ['low', `Low · ${n('low')}`]]} onChange={setLevel} />}>
      <div className="fd-risk-areas">
        {byArea.map(a => (
          <button key={a.area} type="button" className={`fd-risk-area ${a.worst}${area === a.area ? ' on' : ''}`} onClick={() => setArea(area === a.area ? 'all' : a.area)}
            title={a.n ? `${a.n} risk${a.n > 1 ? 's' : ''} · worst: ${LEVEL_LABEL[a.worst]}` : 'No risk found'}>
            <span className="fd-risk-dot" /><b>{a.area}</b><em>{a.n || '✓'}</em>
          </button>
        ))}
      </div>
      {!list.length ? <Empty>{risks.length ? 'No risk for this filter' : 'No risks found — every rule is within its limit'}</Empty> : (
        <div className="fd-list">
          {list.map(r => {
            const isOpen = openId === r.id;
            return (
              <div key={r.id} className={`fd-item${isOpen ? ' open' : ''}`}>
                <div className="fd-item-row" onClick={() => setOpenId(isOpen ? null : r.id)}>
                  <span className={`fd-sev ${r.level === 'high' ? 'bad2' : r.level === 'medium' ? 'warn' : 'ok'}`} />
                  <span className={`fd-level ${r.level}`}>{LEVEL_LABEL[r.level]}</span>
                  <span className="fd-tag fd-risk-tag">{r.area}</span>
                  <div className="fd-item-main">
                    <div className="fd-item-title">{r.title}</div>
                    <div className="fd-item-sub">{r.metric}</div>
                  </div>
                  {r.rows?.length > 0 && <div className="fd-item-owner" title="Records behind this risk">{plural(r.rows.length, 'record')}</div>}
                  <ChevronRight size={15} className="fd-caret" />
                </div>
                {isOpen && (
                  <div className="fd-details">
                    <div className="fd-risk-why">{r.why}</div>
                    <div className="fd-stat-how" style={{ marginTop: 0, borderTop: 'none', paddingTop: 2 }}>How: {r.how}</div>
                    {r.rows?.length > 0 && <div style={{ marginTop: 8 }}><ExpandList rows={r.rows} onOpen={r.tracker ? () => open(r.tracker) : undefined} openLabel={r.tracker ? `Open in ${TRACKERS[r.tracker]?.label}` : ''} /></div>}
                    <div className="fd-row-btns" style={{ marginTop: 10 }}>
                      {r.go && <button type="button" className="fd-link" onClick={() => go(r.go)}><ChevronRight size={13} /> Go to {SECTIONS[r.go]?.title}</button>}
                      {r.tracker && <button type="button" className="fd-link" onClick={() => open(r.tracker)}><ExternalLink size={13} /> Open {TRACKERS[r.tracker]?.label}</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="fd-muted fd-mt">Risks are worked out from the trackers every time this page loads. Thresholds (e.g. 3× pipeline cover, 60-day stale proposals, 35% client share) are in <code>RISK_RULES</code>, founderInsights.js.</div>
    </Section>
  );
}

/* ─── Cash forecast bucket row ───────────────────────────────────────────── */
function ForecastRow({ b, max, overdue, open }) {
  const [isOpen, setOpen] = useState(false);
  const seg = (v, cls) => (v > 0 ? <span className={cls} style={{ width: `${(v / max) * 100}%` }} title={fmtL(v)} /> : null);
  const kinds = b.rows.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
  return (
    <div className={`fd-item${isOpen ? ' open' : ''}`}>
      <div className="fd-item-row" onClick={() => setOpen(!isOpen)}>
        <div className="fd-fc-label"><b className={overdue && b.total ? 'fd-coral-t' : ''}>{b.label}</b><span>{Object.entries(kinds).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ') || 'nothing expected'}</span></div>
        <span className="fd-fc-track">{seg(b.invoiced, 'navy')}{seg(b.toInvoice, 'gold')}{seg(b.upcoming, 'mauve')}</span>
        <div className="fd-item-right">{fmtL(b.total)}</div>
        <ChevronRight size={15} className="fd-caret" />
      </div>
      {isOpen && <Details rows={[['Invoice raised', fmtL(b.invoiced)], ['To invoice', fmtL(b.toInvoice)], ['Coming sessions', fmtL(b.upcoming)],
        ...b.rows.slice(0, 10).map(r => [`${r.e.company}${r.e.sno ? ' · S No ' + r.e.sno : ''}`, `${r.kind} · ${rupee(r.amount)} · due ${fmtD(r.due)}`])]}
        onOpen={() => open('finance')} openLabel="Open Finance Tracker" />}
    </div>
  );
}

/* ─── Revenue chart: monthly achieved / confirmed / tentative vs target, last FY as dots ── */
function RevenueChart({ o, fyName }) {
  const [hover, setHover] = useState(null);
  const W = 1000, H = 270, padL = 46, padR = 10, padT = 14, padB = 26;
  const cw = (W - padL - padR) / 12;
  const totals = o.months.map((_, i) => o.achieved[i] + o.confirmed[i] + o.tentative[i]);
  const maxV = Math.max(1, ...totals, ...o.monthTarget, ...o.lastFy) * 1.08;
  const y = v => padT + (H - padT - padB) * (1 - v / maxV);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV * f);
  const bw = Math.min(34, cw * 0.56);
  const GAP = 2;
  return (
    <div className="fd-chart">
      <div className="fd-legend">
        <span><i className="fd-key navy" />Achieved</span><span><i className="fd-key mauve" />Confirmed ahead</span><span><i className="fd-key mauve-lt" />Tentative</span>
        <span><i className="fd-key line" />Monthly target</span><span><i className="fd-key dot" />{fyName(o.fy - 1)}</span>
      </div>
      <div className="fd-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly revenue ${fyName(o.fy)} against target`} onMouseLeave={() => setHover(null)}>
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="fd-grid-line" />
              <text x={padL - 6} y={y(v) + 3} className="fd-axis" textAnchor="end">{v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : Math.round(v / 1e5) + 'L'}</text>
            </g>
          ))}
          {o.months.map((m, i) => {
            const cx = padL + cw * i + cw / 2;
            const segs = [['achieved', o.achieved[i]], ['confirmed', o.confirmed[i]], ['tentative', o.tentative[i]]].filter(([, v]) => v > 0);
            let acc = 0;
            return (
              <g key={m} onMouseEnter={() => setHover(i)}>
                <rect x={padL + cw * i} y={padT} width={cw} height={H - padT - padB} className={`fd-hit${hover === i ? ' on' : ''}`} />
                {segs.map(([k, v], si) => {
                  const top = y(acc + v), bottom = y(acc);
                  acc += v;
                  const h = Math.max(0, bottom - top - (si > 0 ? GAP : 0));
                  const last = si === segs.length - 1;
                  return <rect key={k} x={cx - bw / 2} y={top} width={bw} height={h} rx={last ? 4 : 0} className={`fd-bar-${k}`} />;
                })}
                {o.monthTarget[i] > 0 && <line x1={cx - bw / 2 - 4} x2={cx + bw / 2 + 4} y1={y(o.monthTarget[i])} y2={y(o.monthTarget[i])} className="fd-target-line" />}
                {o.lastFy[i] > 0 && <circle cx={cx + bw / 2 + 8} cy={y(o.lastFy[i])} r="4" className="fd-last-dot" />}
                <text x={cx} y={H - 8} textAnchor="middle" className={`fd-axis${i === o.nowSlot ? ' now' : ''}`}>{m}</text>
              </g>
            );
          })}
        </svg>
        {hover != null && (
          <div className="fd-tip" style={{ left: `${((padL + cw * hover + cw / 2) / W) * 100}%` }}>
            <b>{o.months[hover]} {hover === o.nowSlot ? '(this month)' : ''}</b>
            {o.achieved[hover] > 0 && <div><i className="fd-key navy" />Achieved <span>{fmtL(o.achieved[hover])}</span></div>}
            {o.confirmed[hover] > 0 && <div><i className="fd-key mauve" />Confirmed <span>{fmtL(o.confirmed[hover])}</span></div>}
            {o.tentative[hover] > 0 && <div><i className="fd-key mauve-lt" />Tentative <span>{fmtL(o.tentative[hover])}</span></div>}
            <div><i className="fd-key line" />Target <span>{o.monthTarget[hover] ? fmtL(o.monthTarget[hover]) : '—'}</span></div>
            <div><i className="fd-key dot" />{fyName(o.fy - 1)} <span>{fmtL(o.lastFy[hover])}</span></div>
          </div>
        )}
      </div>
    </div>
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
