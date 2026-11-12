/**
 * CONSULTANT 360 — a consultant's journey with EuRadicle inside the Consultant Directory
 * =======================================================================================
 *  useConsultantWorld()  reads the Engagement Calendar + Ops Checklist once and indexes rows by consultant
 *  ConsultantLive        live key numbers (sessions, days, clients, next session, feedback, revenue)
 *  ConsultantTabs        Profile · Journey · Engagements · Clients · Programs · Revenue · Delivery
 *  ConsultantPane        the content of one tab (read-only)
 *  UnlinkedConsultants   names used in the Engagement Calendar that have no profile
 * Read-only: nothing here writes to a tracker. Revenue is shown only to admins / Finance viewers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UserRound, Route, CalendarDays, Building2, BookOpen, Wallet, ClipboardCheck, AlertTriangle, ArrowUpRight, RefreshCw, Info, Star, Link2, Flag, Trophy, Users, MapPin,
} from 'lucide-react';
import { Section, Empty, Table, Tile, Pill, Bar } from './Client360.jsx';
import { peekConsultantWorld, loadConsultantWorld, buildConsultantIndex, consultantAlerts, fyLabel } from '../services/consultant360.js';
import { todayIso } from '../services/client360.js';
import { clScore } from '../pages/OpsChecklist.jsx';
import { money, fmtInrShort } from '../services/money.js';
import '../styles/client360.css';

const txt = v => String(v ?? '').trim();
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = v => { const m = txt(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : txt(v); };
const fmtMY = v => { const m = txt(v).match(/^(\d{4})-(\d{2})/); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ''; };
const inr = v => (Number(v) ? `₹ ${Math.round(Number(v)).toLocaleString('en-IN')}` : '—');
const short = v => (Number(v) ? fmtInrShort(Number(v)) : '₹ 0');
const daysTo = iso => (iso ? Math.round((Date.parse(String(iso).slice(0, 10)) - Date.parse(todayIso())) / 86400000) : null);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const num1 = v => (Number.isInteger(v) ? v : Math.round(v * 10) / 10);
const STATE_CLS = { Delivered: 'lv-st-won', Upcoming: 'lv-st-prog', Tentative: 'lv-st-hold', 'On hold': 'lv-st-hold', 'Ended – status not updated': 'c360-pill-warn' };

/* ─── Data hook ─── */
export function useConsultantWorld(consultants) {
  const [world, setWorld] = useState(() => peekConsultantWorld());
  const [loading, setLoading] = useState(false);
  const started = useRef(false);
  const refresh = useCallback(async (force = false) => {
    started.current = true; setLoading(true);
    try { setWorld(await loadConsultantWorld({ force })); }
    catch (e) { setWorld(w => w || { ec: [], ops: [], failed: [e.message || String(e)], partial: true }); }
    finally { setLoading(false); }
  }, []);
  const ensure = useCallback(() => { if (!started.current) refresh(false); }, [refresh]);
  const index = useMemo(() => (world && consultants?.length ? buildConsultantIndex(world, consultants) : null), [world, consultants]);
  return { world, index, loading, ensure, refresh, failed: world?.failed || [] };
}

/* ─── Live key numbers ─── */
export function ConsultantLive({ sm, showMoney, loading, onTab, onRefresh }) {
  if (!sm) return <div className="c360-live"><div className="c360-live-head"><span><i className={loading ? 'spin' : ''} />{loading ? 'Reading this consultant from the Engagement Calendar…' : 'Tracker data not loaded'}</span></div></div>;
  const nx = sm.next, d = nx ? daysTo(nx.d) : null;
  const yoy = sm.cur && sm.prev && sm.prev.n ? Math.round(((sm.cur.n - sm.prev.n) / sm.prev.n) * 100) : null;
  const tiles = [
    { tab: 'journey', label: 'With EuRadicle since', value: sm.first ? fmtMY(sm.first.d) : '—', sub: sm.first ? `${plural(sm.byFy.length, 'financial year')} · first: ${sm.first.client}` : 'no sessions on the calendar' },
    { tab: 'ec', label: 'Sessions delivered', value: sm.delivered, sub: sm.delivered ? `${num1(sm.days)} days${sm.pax ? ` · ${sm.pax.toLocaleString('en-IN')} participants` : ''}` : `${sm.sessions} on the calendar` },
    { tab: 'clients', label: 'Clients served', value: sm.clients, sub: sm.byClient[0] ? `most with ${sm.byClient[0].key} (${sm.byClient[0].n})` : '—' },
    { tab: 'ec', label: 'Next session', value: nx ? fmtD(nx.d) : '—', sub: nx ? `${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`} · ${nx.client}` : sm.idleDays != null ? `nothing booked · idle ${sm.idleDays}d` : 'nothing booked', tone: sm.delivered && !nx ? 'warn' : '' },
    { tab: 'programs', label: 'Feedback', value: sm.feedbackAvg != null ? `${sm.feedbackAvg.toFixed(2)} / 5` : '—', sub: sm.feedbackCount ? `across ${plural(sm.feedbackCount, 'session')}` : 'no scores recorded', tone: sm.feedbackAvg != null && sm.feedbackAvg < 4 ? 'warn' : '' },
    showMoney
      ? { tab: 'revenue', label: 'Revenue delivered', value: short(sm.revenue), sub: sm.booked ? `+ ${short(sm.booked)} booked ahead` : 'nothing booked ahead' }
      : { tab: 'journey', label: `This FY (${fyLabel(sm.curFy)})`, value: sm.cur ? sm.cur.n : 0, sub: yoy != null ? `${yoy >= 0 ? '▲' : '▼'} ${Math.abs(yoy)}% vs last FY` : 'sessions incl. booked' },
  ];
  return (
    <div className="c360-live">
      <div className="c360-live-head"><span><i className={loading ? 'spin' : ''} />Live from the Engagement Calendar</span>
        {onRefresh && <button type="button" className="c360-open" disabled={loading} onClick={onRefresh}><RefreshCw size={12} className={loading ? 'c360-spin' : ''} />{loading ? 'Reading…' : 'Re-read trackers'}</button>}</div>
      <div className="c360-strip">{tiles.map(t => (
        <button type="button" key={t.label} className={`c360-tile click${t.tone ? ` ${t.tone}` : ''}`} onClick={() => onTab(t.tab)}><span>{t.label}</span><b>{t.value}</b><em>{t.sub}</em></button>
      ))}</div>
    </div>
  );
}

/* ─── Tabs ─── */
const TABS = [['profile', 'Profile', UserRound], ['journey', 'Journey', Route], ['ec', 'Engagements', CalendarDays], ['clients', 'Clients', Building2],
  ['programs', 'Programs', BookOpen], ['revenue', 'Revenue', Wallet], ['delivery', 'Delivery', ClipboardCheck]];
export function ConsultantTabs({ tab, onTab, sm, showMoney }) {
  const count = { ec: sm?.sessions, clients: sm?.clients, programs: sm?.byTopic.length, delivery: sm?.ops.length };
  return (
    <div className="c360-tabs" role="tablist">
      {TABS.filter(([k]) => k !== 'revenue' || showMoney).map(([k, label, I]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>
          <I size={14} />{label}{count[k] != null && <b className={k === 'ec' && sm?.stale.length ? 'hot' : ''}>{count[k]}</b>}
        </button>))}
    </div>
  );
}

const Fb = ({ v, n }) => (v != null ? <span className="c360-fb"><Star size={11} />{v.toFixed(2)}{n != null && <i className="c360-fb-n">({n})</i>}</span> : '—');
const Chips = ({ list, max = 10 }) => <p>{list.slice(0, max).map(([t, n]) => <span key={t} className="c360-chip">{t}<b>{n}</b></span>)}{list.length > max && <em>+{list.length - max} more</em>}</p>;

/* ─── Journey (overview) ─── */
function Journey({ c, sm, showMoney, contract, variants, onTab }) {
  const alerts = consultantAlerts(sm, contract);
  if (!sm.sessions) return <Empty>No Engagement Calendar sessions carry this consultant's name yet. If a short name is used there, add it to CONSULTANT_ALIASES in src/config/clientAliases.js.</Empty>;
  const max = Math.max(1, ...sm.byFy.map(f => f.n));
  const top = sm.byClient[0], topProg = sm.byTopic[0];
  const share = top && sm.sessions ? Math.round((top.n / sm.sessions) * 100) : 0;
  const miles = [
    sm.first && [Flag, 'First session', `${fmtD(sm.first.d)} — ${sm.first.client}`, txt(sm.first.e.topic)],
    top && [Building2, 'Biggest client', `${top.key} — ${plural(top.n, 'session')}`, `${share}% of all sessions${top.first ? ` · since ${fmtMY(top.first)}` : ''}`],
    topProg && [BookOpen, 'Most delivered program', `${topProg.key} — ${topProg.n}×`, `for ${plural(topProg.others.length, 'client')}`],
    sm.bestTopic && [Trophy, 'Best-rated program', `${sm.bestTopic.key} — ${sm.bestTopic.fb.toFixed(2)} / 5`, `across ${plural(sm.bestTopic.fbN, 'rated session')}`],
    sm.lastDelivered && [CalendarDays, 'Last delivered', fmtD(sm.lastDelivered), sm.next ? `next: ${fmtD(sm.next.d)} · ${sm.next.client}` : 'nothing booked ahead'],
  ].filter(Boolean);
  return (<>
    {!!alerts.length && <div className="c360-alerts">{alerts.map((a, i) => (
      <button type="button" key={i} className={`c360-alert ${a.tone}`} onClick={() => onTab(a.tab)}>{a.tone === 'info' ? <Info size={14} /> : <AlertTriangle size={14} />}<span>{a.text}</span><ArrowUpRight size={13} /></button>))}</div>}
    {!!variants.length && <div className="c360-aka"><Link2 size={14} /><span>Appears in the Engagement Calendar as</span>{variants.map(v => <span key={v.name} className="c360-chip">{v.name}<b>{v.total}</b></span>)}<em>— all included here</em></div>}
    <div className="c360-j-grid">
      <Section icon={Route} title={`Journey with EuRadicle — ${c.fullName}`} note={sm.first ? `${fmtMY(sm.first.d)} → ${sm.next ? fmtMY(sm.upcoming[sm.upcoming.length - 1].d) : fmtMY(sm.lastDelivered) || 'today'}` : ''}>
        <div className="c360-fy">
          <div className="c360-fy-row hd"><span>Year</span><span>Sessions (delivered + booked)</span><span className="r">Days</span><span className="r">Clients</span><span className="r">Feedback</span>{showMoney && <span className="r">Revenue</span>}</div>
          {sm.byFy.map(f => (
            <div key={f.key} className={`c360-fy-row${f.key === sm.curFy ? ' cur' : ''}`}>
              <span><b>{fyLabel(f.key)}</b>{f.key === sm.curFy && <i>current</i>}</span>
              <span className="c360-fy-bar"><span className="trk"><i className="d" style={{ width: `${(f.delivered / max) * 100}%` }} /><i className="b" style={{ width: `${((f.n - f.delivered) / max) * 100}%` }} /></span><b>{f.n}</b>{f.n > f.delivered && <em>{f.delivered} done</em>}</span>
              <span className="r">{num1(f.days) || '—'}</span><span className="r" title={f.others.join(', ')}>{f.others.length}</span><span className="r"><Fb v={f.fb} /></span>
              {showMoney && <span className="r">{f.rev || f.booked ? short(f.rev + f.booked) : '—'}</span>}
            </div>))}
        </div>
        <div className="c360-legend"><span><i className="d" />Delivered</span><span><i className="b" />Booked / not yet marked delivered</span>{sm.cancelled > 0 && <em>{plural(sm.cancelled, 'cancelled session')} excluded</em>}</div>
      </Section>
      <Section icon={Flag} title="Milestones">
        <ul className="c360-miles">{miles.map(([I, lab, main, sub]) => <li key={lab}><span className="ic"><I size={14} /></span><div><span>{lab}</span><b>{main}</b>{sub && <em>{sub}</em>}</div></li>)}</ul>
      </Section>
    </div>
    <div className="c360-facts">
      <div><span>Clients worked with</span><Chips list={sm.byClient.map(g => [g.key, g.n])} max={14} /></div>
      <div><span>Programs delivered</span><Chips list={sm.byTopic.map(g => [g.key, g.n])} max={12} /></div>
      {!!sm.services.length && <div><span>Type of work</span><Chips list={sm.services} />{sm.delivered > 0 && <em className="c360-sub">{sm.virtual} virtual · {sm.delivered - sm.virtual} in person / location not marked virtual</em>}</div>}
      {(!!sm.co.length || !!sm.cities.length) && <div><span>{sm.co.length ? 'Co-facilitated with' : 'Delivered in'}</span><Chips list={sm.co.length ? sm.co : sm.cities} />
        {!!sm.co.length && !!sm.cities.length && <><span className="c360-gap">Delivered in</span><Chips list={sm.cities} max={8} /></>}</div>}
    </div>
  </>);
}

/* ─── One tab's content ─── */
export function ConsultantPane({ tab, c, sm, showMoney, loading, contract, variants, onTab }) {
  if (!sm) return <Empty>{loading ? 'Reading the Engagement Calendar…' : 'Tracker data could not be loaded. Use “Re-read trackers”.'}</Empty>;
  const today = todayIso();
  if (tab === 'journey') return <Journey c={c} sm={sm} showMoney={showMoney} contract={contract} variants={variants} onTab={onTab} />;

  if (tab === 'ec') {
    const rows = [...sm.rows].sort((a, b) => b.d.localeCompare(a.d));
    return (
      <Section icon={CalendarDays} title="Every session on the Engagement Calendar" count={rows.length} source="ec" note={`${sm.delivered} delivered · ${sm.upcoming.length} booked${sm.stale.length ? ` · ${sm.stale.length} to update` : ''}`}>
        {!rows.length ? <Empty>No sessions for this consultant.</Empty> : (
          <Table head={['S No', 'Dates', 'Client', 'Program', 'Service', 'Days', 'Location', 'Pax', 'With', 'Status', 'Feedback', ...(showMoney ? ['Share of Price (₹)'] : [])]}>
            {rows.map((x, i) => { const e = x.e; return (
              <tr key={e.engagementKey || i}>
                <td><span className="lv-id">{e.sno}</span></td>
                <td className="nowrap">{fmtD(e.startDate) || '—'}{e.endDate && e.endDate !== e.startDate ? ` → ${fmtD(e.endDate)}` : ''}</td>
                <td><b>{x.client}</b></td><td>{e.topic || '—'}</td><td>{[e.serviceType, e.offering].map(txt).filter(Boolean).join(' · ') || '—'}</td>
                <td className="num">{e.day || '—'}</td><td>{txt(e.location) || '—'}</td><td className="num">{e.pax || '—'}</td>
                <td className="lv-muted">{x.with.join(', ') || '—'}</td>
                <td><Pill cls={STATE_CLS[x.state]}>{['Upcoming', 'Tentative', 'On hold'].includes(x.state) ? txt(e.status) || x.state : x.state}</Pill></td>
                <td><Fb v={x.fb} /></td>
                {showMoney && <td className="num" title={x.share < 1 ? `Session price ${inr(money(e.price))} split between ${Math.round(1 / x.share)} consultants` : ''}>{inr(x.rev)}{x.share < 1 && <i className="c360-fb-n">÷{Math.round(1 / x.share)}</i>}</td>}
              </tr>); })}
          </Table>)}
      </Section>
    );
  }

  if (tab === 'clients') return (
    <Section icon={Building2} title="Companies worked with" count={sm.byClient.length} note="through EuRadicle engagements">
      {!sm.byClient.length ? <Empty>No clients yet.</Empty> : (
        <Table head={['Client', 'Sessions', 'Delivered', 'Days', 'First session', 'Latest session', 'Programs', 'Feedback', ...(showMoney ? ['Revenue delivered (₹)', 'Booked (₹)'] : [])]}>
          {sm.byClient.map(g => (
            <tr key={g.key}>
              <td><b>{g.key}</b></td><td>{g.n}</td><td>{g.delivered}</td><td className="num">{num1(g.days) || '—'}</td>
              <td className="nowrap">{fmtD(g.first) || '—'}</td><td className="nowrap">{fmtD(g.last) || '—'}</td>
              <td className="wrap lv-muted">{g.others.slice(0, 4).join(' · ')}{g.others.length > 4 ? ` · +${g.others.length - 4}` : ''}</td>
              <td><Fb v={g.fb} n={g.fbN} /></td>
              {showMoney && <><td className="num">{inr(g.rev)}</td><td className="num">{inr(g.booked)}</td></>}
            </tr>))}
        </Table>)}
    </Section>
  );

  if (tab === 'programs') return (
    <Section icon={BookOpen} title="Programs delivered" count={sm.byTopic.length} note="use when allocating — how often and how well each topic was delivered">
      {!sm.byTopic.length ? <Empty>No programs yet.</Empty> : (
        <Table head={['Program / topic', 'Times', 'Delivered', 'Days', 'Clients', 'Latest', 'Feedback']}>
          {sm.byTopic.map(g => (
            <tr key={g.key}>
              <td><b>{g.key}</b></td><td>{g.n}</td><td>{g.delivered}</td><td className="num">{num1(g.days) || '—'}</td>
              <td className="wrap lv-muted">{g.others.slice(0, 5).join(' · ')}{g.others.length > 5 ? ` · +${g.others.length - 5}` : ''}</td>
              <td className="nowrap">{fmtD(g.last) || '—'}</td>
              <td className={g.fb != null && g.fb < 4 ? 'bad' : ''}><Fb v={g.fb} n={g.fbN} /></td>
            </tr>))}
        </Table>)}
    </Section>
  );

  if (tab === 'revenue' && showMoney) {
    const tot = sm.revenue || 1, perDay = sm.days ? sm.revenue / sm.days : 0;
    return (<>
      <div className="c360-strip four" style={{ marginBottom: 0 }}>
        <Tile label="Revenue delivered" value={short(sm.revenue)} sub={`${plural(sm.delivered, 'delivered session')} · all years`} />
        <Tile label={`This FY (${fyLabel(sm.curFy)})`} value={short(sm.cur ? sm.cur.rev : 0)} sub={sm.prev ? `last FY ${short(sm.prev.rev)}` : 'no sessions last FY'} />
        <Tile label="Booked ahead" value={short(sm.booked)} sub={sm.upcoming.length ? `${plural(sm.upcoming.length, 'session')} · ${num1(sm.bookedDays)} days` : 'nothing booked'} tone={sm.booked ? '' : 'warn'} />
        <Tile label="Revenue per delivered day" value={perDay ? short(perDay) : '—'} sub={`${num1(sm.days)} days delivered`} />
      </div>
      <div className="c360-note"><Info size={14} />Revenue = Engagement Calendar Price (INR) of the sessions this consultant delivered, excluding GST and travel. {sm.shared ? `${plural(sm.shared, 'session')} had more than one consultant — the price is split equally between them. ` : ''}This is client revenue, not the fee paid to the consultant.</div>
      <div className="c360-facts">
        <div><span>By financial year</span><div className="c360-rev">{sm.byFy.map(f => <div key={f.key}><b>{fyLabel(f.key)}</b><span className="trk"><i style={{ width: `${Math.min(100, ((f.rev + f.booked) / Math.max(1, ...sm.byFy.map(y => y.rev + y.booked))) * 100)}%` }} /></span><em>{short(f.rev)}{f.booked ? ` + ${short(f.booked)} booked` : ''}</em></div>)}</div></div>
        <div><span>By client (delivered)</span><div className="c360-rev">{[...sm.byClient].sort((a, b) => b.rev - a.rev).filter(g => g.rev > 0).slice(0, 8).map(g => <div key={g.key}><b title={g.key}>{g.key}</b><span className="trk"><i style={{ width: `${(g.rev / Math.max(1, ...sm.byClient.map(y => y.rev))) * 100}%` }} /></span><em>{short(g.rev)} · {Math.round((g.rev / tot) * 100)}%</em></div>)}</div></div>
      </div>
    </>);
  }

  if (tab === 'delivery') {
    const ops = [...sm.ops].sort((a, b) => txt(b.startDate).localeCompare(txt(a.startDate)));
    return (
      <Section icon={ClipboardCheck} title="Ops Checklist — sessions with this consultant" count={ops.length} source="ops">
        {!ops.length ? <Empty>No Ops Checklist rows name this consultant.</Empty> : (
          <Table head={['Dates', 'Client', 'Program', 'Client SPOC', 'Internal POC', 'Calendar blocked', 'Travel finalised', 'Status', 'Readiness']}>
            {ops.map((o, i) => { const sc = clScore(o), up = (txt(o.endDate) || txt(o.startDate)) >= today; return (
              <tr key={o.engagementKey || i} className={up ? '' : 'dim'}>
                <td className="nowrap">{fmtD(o.startDate) || '—'}</td><td><b>{o.company || '—'}</b></td><td>{o.topic || '—'}</td><td>{o.clientSpoc || '—'}</td><td>{o.internalPoc || '—'}</td>
                <td>{txt(o.calendarBlock) || '—'}</td><td>{txt(o.travelDetails) || '—'}</td><td>{txt(o.status) || '—'}</td>
                <td className="nowrap"><Bar pct={sc} /> {sc}%</td>
              </tr>); })}
          </Table>)}
      </Section>
    );
  }
  return null;
}

/* ─── Names on the calendar with no profile ─── */
export function UnlinkedConsultants({ index, loading }) {
  const [open, setOpen] = useState(false);
  const list = index?.unlinked || [];
  if (!list.length) return null;
  return (
    <div className="c360-un-cons">
      <button type="button" className="c360-banner" style={{ marginBottom: open ? 8 : 14 }} onClick={() => setOpen(o => !o)}>
        <Users size={16} /><span><b>{plural(list.length, 'consultant name')} on the Engagement Calendar {list.length === 1 ? 'has' : 'have'} no profile here</b> — their sessions are not in any profile ({list.slice(0, 3).map(u => u.name).join(', ')}{list.length > 3 ? '…' : ''})</span><em>{open ? 'Hide' : 'Show'}{loading ? ' · reading…' : ''}</em>
      </button>
      {open && <div className="card" style={{ padding: 0, marginBottom: 14 }}><Table head={['Name on the calendar', 'Sessions', 'First', 'Latest', 'Clients']}>
        {list.map(u => <tr key={u.key}><td><b>{u.name}</b></td><td>{u.total}</td><td className="nowrap">{fmtD(u.first) || '—'}</td><td className="nowrap">{fmtD(u.last) || '—'}</td><td className="wrap lv-muted">{u.clients.slice(0, 5).join(' · ')}{u.clients.length > 5 ? ` · +${u.clients.length - 5}` : ''}</td></tr>)}
      </Table><div className="c360-note" style={{ margin: 12 }}><MapPin size={14} />Add the consultant with “+ Add Consultant” using the same name, or map a short name to a profile in CONSULTANT_ALIASES (src/config/clientAliases.js).</div></div>}
    </div>
  );
}
