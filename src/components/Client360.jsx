/**
 * CLIENT 360 — tracker data inside the Client Directory
 * ======================================================
 *  useClientWorld()   loads the trackers once (on first use) and indexes every row by client
 *  LiveStrip          live key numbers for one client (sessions, proposals, money, next session)
 *  NameLinks          "also appears as …" + possible matches under another spelling (gold)
 *  ProfileTabs        Overview · Engagements · Proposals · Leads · Finance · Delivery · Vendors & POs · Tasks
 *  TrackerTab         the read-only table(s) of one tab
 *  UnlinkedView       "Not in directory": client names used in the trackers that have no profile
 * Read-only: nothing here writes to a tracker. Linking a name saves it in the client's "Also Known As".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, FileText, Sparkles, Wallet, ClipboardCheck, Truck, ListTodo, LayoutDashboard, Link2, AlertTriangle,
  ArrowUpRight, RefreshCw, UserPlus, EyeOff, Eye, CheckCircle2, Info, Star, Search,
} from 'lucide-react';
import { useDirectory } from './pickers/index.jsx';
import {
  SOURCES, SOURCE_BY_ID, loadWorld, peekWorld, buildIndex, clientAlerts, ecState, feedbackOf, consultantsOf, todayIso,
} from '../services/client360.js';
import { financeStage, totalOf, overdueDays } from '../pages/FinanceTracker.jsx';
import { clScore } from '../pages/OpsChecklist.jsx';
import { money, collectedOf, fmtInrShort } from '../services/money.js';
import { splitLinks } from '../services/poApi.js';
import { leadIsOpen } from '../config/leadVendorOptions.js';
import { taskIsOpen } from '../config/taskOptions.js';
import '../styles/client360.css';

const txt = v => String(v ?? '').trim();
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = v => { const m = txt(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : txt(v); };
const inr = v => (Number(v) ? `₹ ${Math.round(Number(v)).toLocaleString('en-IN')}` : '—');
const short = v => (Number(v) ? fmtInrShort(Number(v)) : '₹ 0');
const daysTo = iso => (iso ? Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(todayIso())) / 86400000) : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const IGNORE_KEY = 'ercrm.clients.notClient.v1';
const readIgnored = () => { try { return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) || '[]')); } catch { return new Set(); } };

/* ─── Data hook ─── */
export function useClientWorld() {
  const dir = useDirectory();
  const [world, setWorld] = useState(() => peekWorld());
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState('');
  const [ignored, setIgnored] = useState(readIgnored);
  const started = useRef(false);

  const refresh = useCallback(async (force = false) => {
    started.current = true; setLoading(true);
    try { setWorld(await loadWorld({ force })); setLoadedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
    catch (e) { setWorld(w => w || { rows: {}, failed: [e.message || String(e)], partial: true }); }
    finally { setLoading(false); }
  }, []);
  /** Called by the profile / the Not-in-directory view: loads the trackers the first time only. */
  const ensure = useCallback(() => { if (!started.current) refresh(false); }, [refresh]);
  const index = useMemo(() => (world && dir.ready.clients ? buildIndex(world.rows, dir, ignored) : null), [world, dir, ignored]);
  const toggleIgnore = useCallback(key => setIgnored(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(IGNORE_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
    return n;
  }), []);
  return { world, index, loading, loadedAt, ensure, refresh, toggleIgnore, complete: !!world && !world.partial, failed: world?.failed || [] };
}

/* ─── Small pieces ─── */
const STATE_CLS = { Delivered: 'lv-st-won', Upcoming: 'lv-st-prog', Tentative: 'lv-st-hold', 'On hold': 'lv-st-hold', Cancelled: 'lv-st-lost', 'Ended – status not updated': 'c360-pill-warn' };
const PIPE = { closed: ['Won', 'lv-st-won'], process: ['In process', 'lv-st-prog'], lost: ['Lost', 'lv-st-lost'] };
const FIN_CLS = { Received: 'lv-st-won', 'Awaiting Payment': 'lv-st-prog', 'Partly Received': 'lv-st-hold', 'Payment Overdue': 'lv-st-lost', 'Invoice Overdue': 'lv-st-lost', 'To Invoice': 'lv-st-hold', Upcoming: 'lv-st-new' };
const Pill = ({ cls, children }) => <span className={`lv-pill ${cls || 'lv-st-new'}`}>{children}</span>;
const Bar = ({ pct }) => <span className="c360-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} className={pct >= 100 ? 'ok' : pct < 50 ? 'low' : ''} /></span>;

function Section({ icon: I, title, count, source, note, children }) {
  const navigate = useNavigate();
  const s = source && SOURCE_BY_ID[source];
  return (
    <section className="cl-panel c360-section">
      <header className="cl-panel-head">
        <span className="cl-panel-title"><I size={16} />{title}{count != null && <span className="cl-count">{count}</span>}</span>
        <span className="c360-head-right">{note && <span className="lv-muted">{note}</span>}
          {s && <button type="button" className="c360-open" onClick={() => navigate(s.route)}>Open {s.label}<ArrowUpRight size={13} /></button>}</span>
      </header>
      <div className="c360-body">{children}</div>
    </section>
  );
}
const Empty = ({ children }) => <div className="lv-empty" style={{ margin: 14 }}>{children}</div>;
const Table = ({ head, children }) => (
  <div className="table-wrap"><table className="lv-table c360-table"><thead><tr>{head.map((h, i) => <th key={i} className={/₹|^Days$|^Pax$|^Solutions$|^Open work/.test(h) ? 'num' : ''}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);
const Tile = ({ label, value, sub, tone }) => <div className={`c360-tile${tone ? ` ${tone}` : ''}`}><span>{label}</span><b>{value}</b><em>{sub}</em></div>;

/* ─── Live key numbers ─── */
export function LiveStrip({ sm, showMoney, loading, complete, onTab, onRefresh }) {
  if (!sm) return <div className="c360-live"><div className="c360-live-head"><span><i className={loading ? 'spin' : ''} />{loading ? 'Reading this client from the trackers…' : 'Tracker data not loaded'}</span></div></div>;
  const nx = sm.next, d = nx ? daysTo(nx.startDate) : null;
  const tiles = [
    { tab: 'ec', label: 'Sessions delivered', value: sm.delivered, sub: sm.delivered ? `${sm.days || 0} days · ${sm.pax ? `${sm.pax.toLocaleString('en-IN')} participants` : 'participants not recorded'}` : sm.sessions ? `${sm.sessions} on the calendar` : 'none on the calendar' },
    { tab: 'ec', label: 'Next session', value: nx ? fmtD(nx.startDate) : '—', sub: nx ? `${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`} · ${txt(nx.topic) || 'topic not set'}` : 'nothing booked', tone: sm.delivered && !nx ? 'warn' : '' },
    { tab: 'bd', label: 'Proposals', value: sm.proposals, sub: sm.proposals ? `${sm.won} won · ${sm.open} open · ${sm.lost} lost${sm.winRate != null ? ` · ${sm.winRate}% win` : ''}` : 'none in the BD Tracker' },
    showMoney
      ? { tab: 'ec', label: 'Total business', value: short(sm.totalValue), sub: `${short(sm.deliveredValue)} delivered${sm.totalValue - sm.deliveredValue > 0 ? ` · ${short(sm.totalValue - sm.deliveredValue)} not yet delivered` : ''}${sm.cancelledCount ? ` · ${sm.cancelledCount} cancelled excluded` : ''}` }
      : { tab: 'leads', label: 'Open leads', value: sm.leadsOpen.length, sub: `${sm.leads} in the Lead Tracker` },
    showMoney
      ? { tab: 'finance', label: 'Outstanding', value: short(sm.outstanding), sub: sm.overdue ? `${short(sm.overdue)} overdue · ${sm.maxOverdue}d` : sm.toInvoice ? `${short(sm.toInvoice)} to invoice` : 'nothing overdue', tone: sm.overdue ? 'bad' : sm.outstanding || sm.toInvoice ? 'warn' : '' }
      : { tab: 'tasks', label: 'Open tasks', value: sm.tasksOpen.length, sub: sm.tasksOverdue ? `${sm.tasksOverdue} overdue` : 'none overdue', tone: sm.tasksOverdue ? 'bad' : '' },
    { tab: 'ec', label: 'Feedback', value: sm.feedbackAvg != null ? `${sm.feedbackAvg.toFixed(2)} / 5` : '—', sub: sm.feedbackCount ? `across ${plural(sm.feedbackCount, 'session')}` : 'no scores recorded', tone: sm.feedbackAvg != null && sm.feedbackAvg < 4 ? 'warn' : '' },
  ];
  return (
    <div className="c360-live">
      <div className="c360-live-head"><span><i className={loading ? 'spin' : ''} />Live from the trackers</span>{!complete && !loading && <em>some trackers not loaded yet</em>}
        {onRefresh && <button type="button" className="c360-open" disabled={loading} onClick={onRefresh}><RefreshCw size={12} className={loading ? 'c360-spin' : ''} />{loading ? 'Reading…' : 'Re-read trackers'}</button>}</div>
      <div className="c360-strip">{tiles.map(t => (
        <button type="button" key={t.label} className={`c360-tile click${t.tone ? ` ${t.tone}` : ''}`} onClick={() => onTab(t.tab)}><span>{t.label}</span><b>{t.value}</b><em>{t.sub}</em></button>
      ))}</div>
    </div>
  );
}

/* ─── Name links: other spellings + possible matches ─── */
export function NameLinks({ c, index, canLink, aliasReady, busy, onLink, onIgnore }) {
  if (!index) return null;
  const variants = index.variants(c.clientId), near = index.nearBy.get(c.clientId) || [];
  if (!variants.length && !near.length) return null;
  const where = w => Object.entries(w).map(([id, n]) => `${SOURCE_BY_ID[id].short} ${n}`).join(' · ');
  return (
    <div className="c360-names">
      {!!variants.length && <div className="c360-aka"><Link2 size={14} /><span>Also appears in the trackers as</span>
        {variants.map(v => <span key={v.name} className="c360-chip" title={where(v.where)}>{v.name}<b>{v.total}</b></span>)}
        <em>— all included in this profile</em></div>}
      {near.map(u => (
        <div key={u.key} className="c360-near">
          <AlertTriangle size={15} />
          <div><b>“{u.name}”</b> is used on {plural(u.total, 'tracker row')} ({where(u.where)}) and looks like this client <span className="c360-score">{u.score}% match</span>
            <em>These rows are not shown in this profile until the name is linked.</em></div>
          {canLink && <button type="button" className="btn btn-primary btn-sm" disabled={busy || !aliasReady} title={aliasReady ? '' : 'Add the column "Also Known As" to ClientTable first'} onClick={() => onLink(u.name, c)}>Same client — link</button>}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onIgnore(u.key)}>Different</button>
        </div>
      ))}
    </div>
  );
}

/* ─── Tabs ─── */
export const TAB_DEFS = [
  ['overview', 'Overview', LayoutDashboard], ['ec', 'Engagements', CalendarDays], ['bd', 'Proposals', FileText], ['leads', 'Leads', Sparkles],
  ['finance', 'Finance', Wallet], ['delivery', 'Delivery', ClipboardCheck], ['vendors', 'Vendors & POs', Truck], ['tasks', 'Tasks', ListTodo],
];
export function ProfileTabs({ tab, onTab, bucket, sm, showMoney }) {
  const b = bucket;
  const count = { ec: b?.ec.length, bd: sm?.lines.length, leads: b?.leads.length, finance: sm?.dues.length, delivery: b ? b.ops.length + b.cdt.length : null, vendors: b ? b.vendors.length + b.po.length : null, tasks: b?.tasks.length };
  const hot = { finance: sm?.overdue > 0, tasks: sm?.tasksOverdue > 0, ec: sm?.stale.length > 0 };
  return (
    <div className="c360-tabs" role="tablist">
      {TAB_DEFS.filter(([k]) => k !== 'finance' || showMoney).map(([k, label, I]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>
          <I size={14} />{label}{count[k] != null && k !== 'overview' && <b className={hot[k] ? 'hot' : ''}>{count[k]}</b>}
        </button>
      ))}
    </div>
  );
}

/** Alerts worked out from the trackers — shown on the Overview tab. */
export function AlertList({ sm, showMoney, onTab }) {
  const alerts = sm ? clientAlerts(sm, { showMoney }) : [];
  if (!alerts.length) return null;
  return (
    <div className="c360-alerts">{alerts.map((a, i) => (
      <button type="button" key={i} className={`c360-alert ${a.tone}`} onClick={() => onTab(a.tab === 'finance' && !showMoney ? 'ec' : a.tab)}>
        {a.tone === 'info' ? <Info size={14} /> : <AlertTriangle size={14} />}<span>{a.text}</span>{a.amount > 0 && showMoney && <b>{short(a.amount)}</b>}<ArrowUpRight size={13} />
      </button>))}
    </div>
  );
}

/* ─── One tab's content ─── */
export function TrackerTab({ tab, bucket, sm, showMoney, canSee, loading }) {
  if (!bucket || !sm) return <Empty>{loading ? 'Reading the trackers…' : 'Tracker data could not be loaded. Use ↺ to try again.'}</Empty>;
  const today = todayIso();
  const moneyFor = page => showMoney || canSee(page);
  const byDateDesc = f => (a, b) => txt(f(b)).localeCompare(txt(f(a)));

  if (tab === 'ec') {
    const rows = [...bucket.ec].sort(byDateDesc(e => e.startDate)), m = showMoney;
    return (<>
      {(!!sm.topics.length || !!sm.consultants.length) && <div className="c360-facts">
        {!!sm.topics.length && <div><span>Programs delivered / booked</span><p>{sm.topics.slice(0, 12).map(([t, n]) => <span key={t} className="c360-chip">{t}<b>{n}</b></span>)}{sm.topics.length > 12 && <em>+{sm.topics.length - 12} more</em>}</p></div>}
        {!!sm.consultants.length && <div><span>Consultants who worked with this client</span><p>{sm.consultants.slice(0, 12).map(([t, n]) => <span key={t} className="c360-chip">{t}<b>{n}</b></span>)}</p></div>}
      </div>}
      <Section icon={CalendarDays} title="Engagement Calendar" count={rows.length} source="ec" note={sm.firstSession ? `since ${fmtD(sm.firstSession)}` : ''}>
        {!rows.length ? <Empty>No engagements on the calendar for this client.</Empty> : (
          <Table head={['S No', 'Dates', 'Program', 'Service', 'Days', 'Consultant', 'Location', 'Pax', 'Status', 'Feedback', ...(m ? ['Price (₹)'] : [])]}>
            {rows.map((e, i) => { const st = ecState(e, today), fb = feedbackOf(e); return (
              <tr key={e.engagementKey || i} className={st === 'Cancelled' ? 'dim' : ''}>
                <td><span className="lv-id">{e.sno}</span></td>
                <td className="nowrap">{fmtD(e.startDate) || '—'}{e.endDate && e.endDate !== e.startDate ? ` → ${fmtD(e.endDate)}` : ''}</td>
                <td><b>{e.topic || '—'}</b></td><td>{[e.serviceType, e.offering].map(txt).filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{e.day || '—'}</td><td>{consultantsOf(e).join(', ') || '—'}</td><td>{txt(e.location) || '—'}</td><td className="num">{e.pax || '—'}</td>
                <td><Pill cls={STATE_CLS[st]}>{['Upcoming', 'Tentative', 'On hold'].includes(st) ? txt(e.status) || st : st}</Pill></td>
                <td>{fb != null ? <span className="c360-fb"><Star size={11} />{fb.toFixed(1)}</span> : '—'}</td>
                {m && <td className="num">{inr(money(e.price))}</td>}
              </tr>); })}
          </Table>)}
      </Section>
    </>);
  }

  if (tab === 'bd') {
    const m = moneyFor('bd'), lines = [...sm.lines].sort(byDateDesc(l => l.date));
    return (
      <Section icon={FileText} title="Proposals" count={lines.length} source="bd" note={sm.proposals ? `${sm.won} won · ${sm.open} open · ${sm.lost} lost${m ? ` · won ${short(sm.wonValue)} · open ${short(sm.openValue)}` : ''}` : ''}>
        {!lines.length ? <Empty>No proposals in the BD Tracker for this client.</Empty> : (
          <Table head={['P.ID', 'Version', 'Topic', 'Date', 'Solutions', 'Status', ...(m ? ['BD Value (₹)'] : []), 'Proposal']}>
            {lines.map(l => { const [lab, cls] = l.replaced ? ['Revised', 'lv-st-new'] : PIPE[l.pipeline] || ['—', '']; return (
              <tr key={l.key} className={l.replaced ? 'dim' : ''}>
                <td><span className="lv-id">P-{l.id}</span></td><td>V{l.version}</td><td><b>{l.topic || '—'}</b></td><td className="nowrap">{fmtD(l.date) || '—'}</td>
                <td className="num">{l.solCount || '—'}</td><td><Pill cls={cls}>{lab}</Pill>{l.status && !l.replaced && txt(l.status).toLowerCase() !== lab.toLowerCase() && <span className="lv-muted"> {l.status}</span>}</td>
                {m && <td className="num">{inr(l.bdValue)}</td>}
                <td>{/^https?:/i.test(txt(l.link)) ? <a className="cl-ext" href={l.link} target="_blank" rel="noreferrer">Open<ArrowUpRight size={12} /></a> : '—'}</td>
              </tr>); })}
          </Table>)}
      </Section>
    );
  }

  if (tab === 'leads') {
    const m = moneyFor('leads'), rows = [...bucket.leads].sort(byDateDesc(l => l.dateReceived));
    return (
      <Section icon={Sparkles} title="Leads" count={rows.length} source="leads" note={rows.length ? `${sm.leadsOpen.length} open` : ''}>
        {!rows.length ? <Empty>No leads recorded for this client.</Empty> : (
          <Table head={['Lead ID', 'Received', 'Source', 'Contact', 'Requirement', 'Owner', 'Status', 'Next follow-up', 'Last action', ...(m ? ['Est. Value (₹)'] : [])]}>
            {rows.map(l => { const last = Array.isArray(l.actions) && l.actions.length ? l.actions[l.actions.length - 1] : null; const d = daysTo(l.nextFollowUp); return (
              <tr key={l.leadId} className={leadIsOpen(l) ? '' : 'dim'}>
                <td><span className="lv-id">{l.leadId}</span></td><td className="nowrap">{fmtD(l.dateReceived) || '—'}</td><td>{[l.source, l.sharedBy && `via ${l.sharedBy}`].filter(Boolean).join(' · ') || '—'}</td>
                <td>{[l.contactName, l.designation].filter(Boolean).join(', ') || '—'}</td><td className="wrap">{l.requirement || l.programInterest || '—'}</td><td>{l.owner || '—'}</td>
                <td><Pill cls={/convert/i.test(l.status) ? 'lv-st-won' : leadIsOpen(l) ? 'lv-st-prog' : 'lv-st-lost'}>{l.status || 'New'}</Pill></td>
                <td className={`nowrap${leadIsOpen(l) && d != null && d < 0 ? ' bad' : ''}`}>{fmtD(l.nextFollowUp) || '—'}</td>
                <td className="wrap lv-muted">{last ? [last.type, last.comment].map(txt).filter(Boolean).join(': ') : '—'}</td>
                {m && <td className="num">{inr(l.estValue)}</td>}
              </tr>); })}
          </Table>)}
      </Section>
    );
  }

  if (tab === 'finance' && showMoney) {
    const rows = bucket.ec.filter(e => !/cancel|drop/i.test(txt(e.status)) && totalOf(e) > 0).sort(byDateDesc(e => e.invoice || e.startDate));
    return (<>
      <div className="c360-strip five">
        <Tile label="Invoiced" value={short(sm.billed)} sub="net of TDS, incl. GST & travel" />
        <Tile label="Received" value={short(sm.received)} sub={sm.billed ? `${Math.round((sm.received / sm.billed) * 100)}% of invoiced` : ''} />
        <Tile label="Outstanding" value={short(sm.outstanding)} sub="invoiced, not yet received" tone={sm.outstanding ? 'warn' : ''} />
        <Tile label="Overdue" value={short(sm.overdue)} sub={sm.overdue ? `oldest ${sm.maxOverdue} days past terms` : 'nothing past 30 days'} tone={sm.overdue ? 'bad' : ''} />
        <Tile label="To invoice" value={short(sm.toInvoice)} sub="session over, invoice not raised" tone={sm.toInvoice ? 'warn' : ''} />
      </div>
      {!!sm.suspect && <div className="c360-note"><AlertTriangle size={14} />{plural(sm.suspect, 'Amount Received cell')} of this client need checking in the Finance Tracker.</div>}
      <Section icon={Wallet} title="Invoices & payments" count={rows.length} source="ec" note="Edit in the Finance Tracker">
        {!rows.length ? <Empty>No billable engagements for this client.</Empty> : (
          <Table head={['S No', 'Program', 'Session', 'Invoice date', 'Total to Receive (₹)', 'Received (₹)', 'Balance (₹)', 'Received on', 'Stage']}>
            {rows.map((e, i) => { const st = financeStage(e), tot = totalOf(e), got = Math.min(collectedOf(e).gross, tot), od = overdueDays(e); return (
              <tr key={e.engagementKey || i}>
                <td><span className="lv-id">{e.sno}</span></td><td><b>{e.topic || '—'}</b></td><td className="nowrap">{fmtD(e.startDate) || '—'}</td><td className="nowrap">{fmtD(e.invoice) || '—'}</td>
                <td className="num">{inr(tot)}</td><td className="num">{inr(got)}</td><td className={`num${od ? ' bad' : ''}`}>{st === 'Received' ? '—' : inr(Math.max(0, tot - got))}</td>
                <td className="nowrap">{fmtD(e.receivedDate) || '—'}</td><td><Pill cls={FIN_CLS[st]}>{st}{od ? ` · ${od}d` : ''}</Pill></td>
              </tr>); })}
          </Table>)}
      </Section>
    </>);
  }

  if (tab === 'delivery') {
    const ops = [...bucket.ops].sort(byDateDesc(o => o.startDate)), cdt = [...bucket.cdt].sort(byDateDesc(c => c.startDate));
    const openItems = c => ['contentAssets', 'preWork', 'postWork'].reduce((t, k) => t + (Array.isArray(c[k]) ? c[k].filter(w => !w.done).length : 0), 0);
    return (<>
      <Section icon={ClipboardCheck} title="Ops Checklist — session readiness" count={ops.length} source="ops" note={sm.readiness != null ? `upcoming sessions ${sm.readiness}% ready` : ''}>
        {!ops.length ? <Empty>No Ops Checklist rows for this client.</Empty> : (
          <Table head={['Dates', 'Program', 'Client SPOC', 'Internal POC', 'Consultant', 'Status', 'Readiness']}>
            {ops.map((o, i) => { const sc = clScore(o), up = (txt(o.endDate) || txt(o.startDate)) >= today; return (
              <tr key={o.engagementKey || i} className={up ? '' : 'dim'}>
                <td className="nowrap">{fmtD(o.startDate) || '—'}</td><td><b>{o.topic || '—'}</b></td><td>{o.clientSpoc || '—'}</td><td>{o.internalPoc || '—'}</td>
                <td>{[o.consultant1, o.consultant2, o.consultant3].map(txt).filter(Boolean).join(', ') || '—'}</td><td>{txt(o.status) || '—'}</td>
                <td className="nowrap"><Bar pct={sc} /> {sc}%</td>
              </tr>); })}
          </Table>)}
      </Section>
      <Section icon={FileText} title="Content development" count={cdt.length} source="cdt" note={cdt.length ? `${sm.cdtOpen.length} open` : ''}>
        {!cdt.length ? <Empty>No content development entries for this client.</Empty> : (
          <Table head={['Session', 'Topic', 'Program type', 'POC', 'Due', 'Completed', 'Open work items']}>
            {cdt.map((c, i) => { const late = !txt(c.completionDate) && txt(c.dueDate) && txt(c.dueDate) < today; return (
              <tr key={c.engagementKey || i} className={txt(c.completionDate) ? 'dim' : ''}>
                <td className="nowrap">{fmtD(c.startDate) || '—'}</td><td><b>{c.topic || '—'}</b></td><td>{c.programType || '—'}</td><td>{c.poc || '—'}</td>
                <td className={`nowrap${late ? ' bad' : ''}`}>{fmtD(c.dueDate) || '—'}</td>
                <td>{txt(c.completionDate) ? <span className="c360-ok"><CheckCircle2 size={12} />{fmtD(c.completionDate)}</span> : <Pill cls={late ? 'lv-st-lost' : 'lv-st-prog'}>{late ? 'Overdue' : 'In progress'}</Pill>}</td>
                <td className="num">{openItems(c) || '—'}</td>
              </tr>); })}
          </Table>)}
      </Section>
    </>);
  }

  if (tab === 'vendors') {
    const mv = moneyFor('vendors'), mp = moneyFor('po');
    const vs = [...bucket.vendors].sort(byDateDesc(v => v.serviceDate)), po = [...bucket.po].sort(byDateDesc(p => p.poDate));
    return (<>
      <Section icon={FileText} title="Purchase orders" count={po.length} source="po" note={po.length && mp ? `${plural(sm.poActive.length, 'active PO')} · balance ${short(sm.poBalance)}` : ''}>
        {!po.length ? <Empty>No POs recorded for this client.</Empty> : (
          <Table head={['PO ID', 'PO Number', 'PO date', 'Scope', 'Valid to', ...(mp ? ['Value (₹)', 'Balance (₹)'] : []), 'Status', 'PO']}>
            {po.map(p => { const d = daysTo(p.validTo); return (
              <tr key={p.poId}>
                <td><span className="lv-id">{p.poId}</span></td><td><b>{p.poNumber || '—'}</b></td><td className="nowrap">{fmtD(p.poDate) || '—'}</td><td className="wrap">{p.scope || '—'}</td>
                <td className={`nowrap${d != null && d < 0 ? ' bad' : ''}`}>{fmtD(p.validTo) || '—'}</td>
                {mp && <><td className="num">{inr(p.value)}</td><td className="num">{inr(p.balance)}</td></>}
                <td><Pill cls={/active/i.test(p.status) ? 'lv-st-won' : 'lv-st-new'}>{p.status || '—'}</Pill></td>
                <td>{splitLinks(p.link).length ? splitLinks(p.link).map((url, i, all) => <a key={url} className="cl-ext" style={{ marginRight: 8 }} href={url} target="_blank" rel="noreferrer">{all.length > 1 ? `PO ${i + 1}` : 'Open'}<ArrowUpRight size={12} /></a>) : '—'}</td>
              </tr>); })}
          </Table>)}
      </Section>
      <Section icon={Truck} title="Vendor services taken for this client" count={vs.length} source="vendors" note={vs.length ? `${mv ? `cost ${short(sm.vendorCost)} · ` : ''}${sm.vendorToBill.length} to bill to the client` : ''}>
        {!vs.length ? <Empty>No vendor services recorded for this client.</Empty> : (
          <Table head={['Service ID', 'Date', 'Vendor', 'Category', 'Description', 'Program', ...(mv ? ['Total (₹)'] : []), 'Billable', 'Client billing', 'Vendor payment']}>
            {vs.map(v => (
              <tr key={v.serviceId}>
                <td><span className="lv-id">{v.serviceId}</span></td><td className="nowrap">{fmtD(v.serviceDate) || '—'}</td><td><b>{v.vendorName || '—'}</b></td><td>{v.category || '—'}</td>
                <td className="wrap">{v.description || '—'}</td><td>{v.program || '—'}</td>{mv && <td className="num">{inr(money(v.total) || money(v.amount))}</td>}
                <td>{v.billable || '—'}</td><td><Pill cls={/^to bill$/i.test(txt(v.clientBilling)) ? 'lv-st-hold' : /billed/i.test(txt(v.clientBilling)) ? 'lv-st-won' : ''}>{v.clientBilling || '—'}</Pill></td><td>{v.paymentStatus || '—'}</td>
              </tr>))}
          </Table>)}
      </Section>
    </>);
  }

  if (tab === 'tasks') {
    const rows = [...bucket.tasks].sort((a, b) => (taskIsOpen(b) - taskIsOpen(a)) || txt(a.dueDate || '9999').localeCompare(txt(b.dueDate || '9999')));
    return (
      <Section icon={ListTodo} title="Projects & tasks" count={rows.length} source="tasks" note={rows.length ? `${sm.tasksOpen.length} open${sm.tasksOverdue ? ` · ${sm.tasksOverdue} overdue` : ''}` : ''}>
        {!rows.length ? <Empty>No project tasks tagged to this client.</Empty> : (
          <Table head={['Task ID', 'Project', 'Task', 'Assigned to', 'Due', 'Priority', 'Status']}>
            {rows.map(t => { const late = taskIsOpen(t) && txt(t.dueDate) && txt(t.dueDate) < today; return (
              <tr key={t.taskId} className={taskIsOpen(t) ? '' : 'dim'}>
                <td><span className="lv-id">{t.taskId}</span></td><td>{t.projectName || '—'}</td><td><b>{t.title || '—'}</b></td><td>{t.assignedTo || '—'}</td>
                <td className={`nowrap${late ? ' bad' : ''}`}>{fmtD(t.dueDate) || '—'}</td><td>{t.priority || '—'}</td>
                <td><Pill cls={/done/i.test(t.status) ? 'lv-st-won' : late ? 'lv-st-lost' : taskIsOpen(t) ? 'lv-st-prog' : 'lv-st-new'}>{t.status || 'To do'}</Pill></td>
              </tr>); })}
          </Table>)}
      </Section>
    );
  }
  return null;
}

/* ─── Not in directory ─── */
export function UnlinkedView({ w, search, perm, aliasReady, busy, onCreate, onLink, onOpenClient }) {
  const [showIgnored, setShowIgnored] = useState(false);
  const [pick, setPick] = useState({});
  const { ensure } = w;
  useEffect(() => { ensure(); }, [ensure]);
  const dir = useDirectory();
  const q = txt(search).toLowerCase();
  const all = w.index?.unlinked || [];
  const list = all.filter(u => (showIgnored ? u.ignored : !u.ignored) && (!q || u.name.toLowerCase().includes(q) || u.near.some(n => txt(n.client.name).toLowerCase().includes(q))));
  const active = all.filter(u => !u.ignored), near = active.filter(u => u.near.length);
  const rowsCount = active.reduce((t, u) => t + u.total, 0);
  const where = u => SOURCES.filter(s => u.where[s.id]).map(s => <span key={s.id} className="c360-src">{s.short}<b>{u.where[s.id]}</b></span>);
  const options = useMemo(() => [...(dir.clients || [])].filter(c => txt(c.name)).sort((a, b) => a.name.localeCompare(b.name)), [dir]);

  return (
    <div className="tracker-scroll">
      <div className="c360-un-head">
        <div className="c360-strip four">
          <Tile label="Names without a profile" value={active.length} sub={`on ${plural(rowsCount, 'tracker row')}`} tone={active.length ? 'bad' : ''} />
          <Tile label="Look like an existing client" value={near.length} sub="link them — no retyping in the trackers" tone={near.length ? 'warn' : ''} />
          <Tile label="New — need a profile" value={active.length - near.length} sub="create the profile from the tracker data" />
          <Tile label="Marked not a client" value={all.length - active.length} sub="hidden on this browser" />
        </div>
        <div className="c360-un-bar">
          <span className="lv-muted">{w.loading ? 'Reading every tracker…' : w.loadedAt ? `Trackers read at ${w.loadedAt}` : ''}{!!w.failed.length && ` · could not read: ${w.failed.join(' | ')}`}</span>
          <span style={{ flex: 1 }} />
          {!aliasReady && <span className="c360-note inline"><Info size={13} />To save links from here, add the column&nbsp;<b>Also Known As</b>&nbsp;to ClientTable (Client_Directory.xlsx).</span>}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowIgnored(v => !v)}>{showIgnored ? <><Eye size={13} /> Show open</> : <><EyeOff size={13} /> Show hidden</>}</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={w.loading} onClick={() => w.refresh(true)}><RefreshCw size={13} className={w.loading ? 'c360-spin' : ''} /> Re-read trackers</button>
        </div>
      </div>
      {!w.index ? <Empty>{w.loading ? 'Reading every tracker…' : 'Tracker data could not be loaded.'}</Empty>
        : !list.length ? <Empty>{showIgnored ? 'Nothing hidden.' : q ? 'No unlinked names match the search.' : 'Every client name used in the trackers has a profile in the directory.'}</Empty> : (
          <div className="card" style={{ padding: 0, margin: '0 0 90px' }}><div className="table-wrap">
            <table className="lv-table c360-table c360-un"><thead><tr><th>Name used in the trackers</th><th>Found in</th><th>Activity</th><th>Closest client in the directory</th><th></th></tr></thead>
              <tbody>{list.map(u => {
                const best = u.near[0], chosen = pick[u.key] ?? best?.client.clientId ?? '';
                const target = options.find(c => c.clientId === chosen);
                return (
                  <tr key={u.key} className={best ? 'near' : ''}>
                    <td><div className="c360-un-name"><span className={`c360-dot ${best ? 'warn' : 'bad'}`} /><b>{u.name}</b></div><span className="lv-muted">{plural(u.total, 'row')}</span></td>
                    <td><div className="c360-srcs">{where(u)}</div></td>
                    <td className="nowrap lv-muted">{u.first ? `${fmtD(u.first)}${u.last && u.last !== u.first ? ` → ${fmtD(u.last)}` : ''}` : '—'}</td>
                    <td>
                      {best ? <div className="c360-match"><button type="button" className="c360-link" onClick={() => onOpenClient(best.client.clientId)}>{best.client.name}</button><span className="c360-score">{best.score}% match</span>
                        {u.near.slice(1).map(n => <span key={n.client.clientId} className="lv-muted">· {n.client.name} {n.score}%</span>)}</div> : <span className="lv-muted">No similar client</span>}
                      {perm.update && <div className="c360-pick"><Search size={12} />
                        <select className="form-input" value={chosen} onChange={e => setPick(p => ({ ...p, [u.key]: e.target.value }))}>
                          <option value="">Link to another client…</option>{options.map(c => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
                        </select></div>}
                    </td>
                    <td><div className="c360-un-acts">
                      {perm.update && <button type="button" className="btn btn-primary btn-sm" disabled={busy || !target || !aliasReady} title={!aliasReady ? 'Add the column "Also Known As" to ClientTable first' : target ? `Show these rows in ${target.name}` : 'Pick a client'} onClick={() => onLink(u.name, target)}><Link2 size={13} />Link</button>}
                      {perm.create && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onCreate(u)}><UserPlus size={13} />Create profile</button>}
                      <button type="button" className="btn btn-outline btn-sm" title={u.ignored ? 'Show again' : 'Not a client — hide'} onClick={() => w.toggleIgnore(u.key)}>{u.ignored ? <Eye size={13} /> : <EyeOff size={13} />}</button>
                    </div></td>
                  </tr>);
              })}</tbody></table></div></div>)}
    </div>
  );
}

/** Pre-fills a new client profile from the tracker rows found under a name. */
export function profileDefaultsFrom(u) {
  const ec = u.rows.ec || [], bd = u.rows.bd || [], leads = u.rows.leads || [];
  const mode = l => { const m = new Map(); for (const v of l.map(txt).filter(Boolean)) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
  const delivered = ec.filter(e => /deliver/i.test(txt(e.status)));
  const topics = [...new Set(ec.map(e => txt(e.topic)).filter(Boolean))];
  const years = ec.map(e => txt(e.startDate).slice(0, 4)).filter(y => /^\d{4}$/.test(y)).sort();
  const lastEnd = delivered.map(e => txt(e.endDate) || txt(e.startDate)).filter(Boolean).sort().pop() || '';
  return {
    name: u.name, clientType: ec.length ? 'Existing' : 'Prospect', industry: mode([...ec.map(e => e.sector), ...bd.map(r => r.industry)]),
    locations: [...new Set(ec.map(e => txt(e.location)).filter(Boolean))].slice(0, 6).join(', '), clientSince: years[0] || '', lastEngagement: lastEnd,
    delivered: topics.slice(0, 15).join('; '), relStatus: ec.length ? 'Active' : '', howAcquired: mode(leads.map(l => l.source)),
    dataNotes: `Created from tracker data (${SOURCES.filter(s => u.where[s.id]).map(s => `${s.short} ${u.where[s.id]}`).join(', ')}) on ${fmtD(todayIso())}.`,
  };
}

// Shared building blocks, re-used by Consultant360.jsx
export { Section, Empty, Table, Tile, Pill, Bar };
