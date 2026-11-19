/**
 * Solutioning dashboard — rebuilt 6 Nov 2026 for an L&D solutioning view.
 *
 * Fair comparisons only
 *   Last FY is still the fixed Dashboard Report (full year, its own counting) until FY 2025-26 is added to the
 *   Solution Tracker. So last year is compared by PACE (same months) and by SHARE (% mix) — never raw totals.
 *   As soon as the tracker holds last-FY rows, those are used instead of the fixed numbers (same rules both years).
 *
 * 7 Nov 2026: every chart / KPI counts UNIQUE SOLUTIONS (Proposal ID + Solution Topic, highest version that has it), not proposals. Each item keeps its own
 *   Development Category / Line / Type of Service / Engagement Type and Solution Value; date, FY, status come from its proposal line.
 *   Turnaround stays per proposal (it is a time measure). The fixed report has no item counts, so last FY uses tracker rows only.
 * Live definitions (Solution Tracker)
 *   Proposal line  Proposal ID + version (proposalData.js). Monthly Proposal Status & Pace counts the latest version of each Proposal ID (shared component).
 *   Proposal       latest version of a Proposal ID — used for win rate, deal value, heatmap, pipeline.
 *   Status         BD Status Won / Closed / Confirmed → won · Lost / Dropped / Rejected → lost · else open
 *   Value          Solution Value (same as the Solution Tracker)
 *   Turnaround     Date of Discussion → Date of Submission to Client (else by Sol team), first version
 *   On time        submitted on or before the Client Expected date
 *   IP reuse       solution items whose Solution Topic is used in 2+ proposals
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, GD, GN, RD, CURRENT_FY, fyLong, fyTiny, todayISO, clean, keyOf,
} from './erdCharts.jsx';
import { buildProposalLines, isNA, toISODate, versionNo } from './proposalData.js';
import ProposalStatusPace, { itemPace } from './ProposalStatusPace.jsx';
import { ensureDirectory, findClient, getDirectory, onDirectoryChange } from '../services/directoryCache.js';
import KpiListModal, { solItem } from './KpiListModal.jsx';
import { LIVE_FROM_FY, SOL_BASELINE } from '../config/dashboardBaseline.js';

const NR = 'Not recorded';
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const L = v => { const n = Number(v) || 0; return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const slot = iso => (+iso.slice(5, 7) + 8) % 12;
const label = v => clean(v) || NR;

const DIMS = [
  ['developmentCategory', 'Development Category'], ['lineOfService', 'Line of Service'], ['typeOfService', 'Type of Service'],
  ['industry', 'Industry'], ['engagementType', 'Engagement Type'], ['customization', 'Program Type'],
];

function Tabs({ value, options, onChange }) {
  return <div className="sl-tabs">{options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export default function SolLiveDashboard({ solutions, refreshing }) {
  const [unit, setUnit] = useState('item');           // 'item' = unique solution items · 'prop' = proposals (latest version / lines)
  const [scope, setScope] = useState('fy');          // 'fy' = this FY (YTD) · 'all' = every proposal in the tracker
  const [winDim, setWinDim] = useState('developmentCategory');
  const [drill, setDrill] = useState(null);           // { title, items, how } — tap any figure to list its proposals
  const show = (title, items, how) => setDrill({ title, items, how });
  const prevFy = CURRENT_FY - 1;

  /* ── Client Directory: Industry for proposals whose tracker row has none ── */
  const [dir, setDir] = useState(getDirectory);
  useEffect(() => { ensureDirectory(); return onDirectoryChange(setDir); }, []);

  /* ── Data ── */
  const lines = useMemo(() => buildProposalLines(solutions || [], { industryOf: c => findClient(c, dir)?.industry })
    .map(p => ({ ...p, value: p.solValue || 0, valueNA: p.solNA })), [solutions, dir]);
  const latest = useMemo(() => lines.filter(l => l.isLatest), [lines]);
  // Solution items: one per Solution Topic row; dims + value from the row, date / FY / status from its proposal line
  const rawItems = useMemo(() => [...lines.flatMap(l => (l.itemRows || []).map((r, i) => ({ ...l, key: `${l.key}|${i}`, isSolItem: true, programTopic: l.topic, topic: clean(r.solutionTopic),
    developmentCategory: clean(r.developmentCategory) || l.developmentCategory, lineOfService: clean(r.lineOfService) || l.lineOfService,
    typeOfService: clean(r.typeOfService) || l.typeOfService, engagementType: clean(r.engagementType) || l.engagementType,
    value: Number(String(r.solutionValue ?? '').replace(/[^0-9.]/g, '')) || 0, valueNA: isNA(r.solutionValue) })))
], [lines]);
  // Unique solutions: a topic repeated in a later version (V2, V3 …) of the same Proposal ID counts once — only the
  // highest version that carries it is kept. Rows inside one version are never merged (two items may share a topic).
  const items = useMemo(() => {
    const tk = it => `${it.id}|${it.topic.toLowerCase().replace(/\s+/g, ' ')}`;
    const top = new Map(); rawItems.forEach(it => { const k = tk(it); if (!(top.get(k) >= it.version)) top.set(k, it.version); });
    return rawItems.filter(it => it.version === top.get(tk(it)));
  }, [rawItems]);
  const solPace = useMemo(() => itemPace(rawItems, items), [rawItems, items]);
  const latestItems = useMemo(() => items.filter(l => l.isLatest), [items]);
  const isItem = unit === 'item', Us = isItem ? 'solution items' : 'proposals', UC = isItem ? 'Solution items' : 'Proposals';
  // Drill rows: solution items show as items; proposal lines as proposals — both open the Solution Tracker
  const pi = p => solItem(p, !!p.isSolItem);
  const base = isItem ? items : lines, latestBase = isItem ? latestItems : latest;   // every chart below reads these
  const latestById = useMemo(() => new Map(latest.map(l => [l.id, l])), [latest]);
  const inScope = l => (scope === 'all' ? true : l.fy === CURRENT_FY);
  const scoped = useMemo(() => latestBase.filter(inScope), [latestBase, scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const scopeName = scope === 'all' ? 'all tracker data' : `${fyTiny(CURRENT_FY)} YTD`;
  const prevLive = useMemo(() => base.filter(l => l.fy === prevFy), [base, prevFy]);
  // The fixed report counts proposals only — used for last FY in proposal view while the tracker has no last-FY rows
  const prevBase = !isItem && !prevLive.length ? SOL_BASELINE[prevFy] || null : null;

  /* ── Status helpers on latest-version proposals ── */
  const stat = list => {
    const won = list.filter(p => p.pipeline === 'closed'), lost = list.filter(p => p.pipeline === 'lost'), open = list.filter(p => p.pipeline === 'process');
    const valued = list.filter(p => p.value > 0), wonValued = won.filter(p => p.value > 0);
    return { n: list.length, won: won.length, lost: lost.length, open: open.length, rate: pct(won.length, won.length + lost.length + open.length),
      value: valued.reduce((t, p) => t + p.value, 0), avg: valued.length ? valued.reduce((t, p) => t + p.value, 0) / valued.length : 0,
      wonAvg: wonValued.length ? wonValued.reduce((t, p) => t + p.value, 0) / wonValued.length : 0 };
  };
  const all = useMemo(() => stat(scoped), [scoped]);   // eslint-disable-line react-hooks/exhaustive-deps
  const baseRate = prevBase ? pct(prevBase.summary.closed, prevBase.summary.closed + prevBase.summary.lost + (prevBase.summary.process || 0)) : null;

  /* ── Turnaround & revisions (per Proposal ID, from the raw rows) ── */
  const team = useMemo(() => {
    const byId = new Map();
    (solutions || []).forEach(r => { const id = clean(r.proposalId); if (!id) return; if (!byId.has(id)) byId.set(id, []); byId.get(id).push(r); });
    const latestById = new Map(latest.map(l => [l.id, l]));
    const out = [];
    byId.forEach((rows, id) => {
      const lt = latestById.get(id); if (!lt || !inScope(lt)) return;
      const minV = Math.min(...rows.map(r => versionNo(r.proposalVersion)));
      const first = rows.filter(r => versionNo(r.proposalVersion) === minV);
      const minD = (list, k) => list.map(r => toISODate(r[k])).filter(Boolean).sort()[0] || '';
      const disc = minD(rows, 'dateOfDiscussion'), toCl = minD(first, 'submissionToClient'), bySol = minD(first, 'submissionBySolTeam'), exp = minD(rows, 'clientExpectedDate');
      const sub = toCl || bySol;
      const tat = disc && sub ? days(disc, sub) : null;
      out.push({ id, line: lt, disc, sub, exp, tat: tat != null && tat >= 0 && tat <= 365 ? tat : null,
        solTat: disc && bySol && days(disc, bySol) >= 0 ? days(disc, bySol) : null,
        clTat: bySol && toCl && days(bySol, toCl) >= 0 ? days(bySol, toCl) : null,
        onTime: exp && sub ? sub <= exp : null });
    });
    const avg = (list, k) => { const v = list.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null; };
    const timed = out.filter(x => x.onTime != null);
    // Monthly turnaround (by discussion month, this FY)
    const mAvg = Array(12).fill(null), mOn = Array(12).fill(null);
    MONTHS.forEach((_, i) => {
      const m = out.filter(x => x.disc && slot(x.disc) === i && (scope === 'all' || x.line.fy === CURRENT_FY));
      const t = m.filter(x => x.tat != null); if (t.length) mAvg[i] = Math.round(t.reduce((s, x) => s + x.tat, 0) / t.length * 10) / 10;
      const o = m.filter(x => x.onTime != null); if (o.length) mOn[i] = Math.round((o.filter(x => x.onTime).length / o.length) * 100);
    });
    // Revisions
    const ids = [...new Set(lines.filter(l => inScope(latestById.get(l.id) || l)).map(l => l.id))];
    const versions = ids.map(id => lines.filter(l => l.id === id).length);
    const revised = ids.filter((id, i) => versions[i] > 1);
    const change = revised.map(id => {
      const ls = lines.filter(l => l.id === id).sort((a, b) => a.version - b.version);
      const v1 = ls[0].solFull, fin = ls[ls.length - 1].solFull;
      return v1 > 0 && fin > 0 ? (fin - v1) / v1 : null;
    }).filter(x => x != null);
    return { revisedIds: revised, versionsById: new Map(ids.map((id, i) => [id, versions[i]])), list: out, avgTat: avg(out, 'tat'), avgSol: avg(out, 'solTat'), avgCl: avg(out, 'clTat'), onTimePct: pct(timed.filter(x => x.onTime).length, timed.length), timedN: timed.length,
      tatN: out.filter(x => x.tat != null).length, mAvg, mOn,
      avgVersions: versions.length ? versions.reduce((t, v) => t + v, 0) / versions.length : 0, revisedPct: pct(revised.length, ids.length), revisedN: revised.length,
      valueChange: change.length ? change.reduce((t, v) => t + v, 0) / change.length : null, changeN: change.length,
      vDist: [1, 2, 3].map(n => versions.filter(v => (n === 3 ? v >= 3 : v === n)).length) };
  }, [solutions, latest, lines, scope]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── IP library: solution topics ── */
  const ip = useMemo(() => {
    const latestById = new Map(latest.map(l => [l.id, l]));
    const t = new Map();
    (solutions || []).forEach(r => {
      const raw = clean(r.solutionTopic); if (!raw) return;
      const k = raw.toLowerCase().replace(/\s+/g, ' ');
      const id = clean(r.proposalId), lt = latestById.get(id);
      if (!t.has(k)) t.set(k, { label: raw, ids: new Set(), scopeIds: new Set(), clients: new Set(), won: new Set(), lost: new Set(), items: 0 });
      const g = t.get(k); g.ids.add(id);
      if (lt && inScope(lt)) {
        g.scopeIds.add(id); g.items += 1; if (lt.client) g.clients.add(keyOf(lt.client));
        if (lt.pipeline === 'closed') g.won.add(id); else if (lt.pipeline === 'lost') g.lost.add(id);
      }
    });
    const topics = [...t.values()].filter(g => g.scopeIds.size > 0);
    const items = topics.reduce((s, g) => s + g.items, 0), reusedItems = topics.filter(g => g.ids.size > 1).reduce((s, g) => s + g.items, 0);
    const reusedBy = new Map();
    topics.filter(g => g.ids.size > 1).forEach(g => g.scopeIds.forEach(id => reusedBy.set(id, [...(reusedBy.get(id) || []), g.label])));
    const top = topics.sort((a, b) => b.scopeIds.size - a.scopeIds.size || b.clients.size - a.clients.size).slice(0, 15);
    return { reusedBy, top, distinct: topics.length, reused: topics.filter(g => g.ids.size > 1).length, items, reusePct: pct(reusedItems, items) };
  }, [solutions, latest, scope]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Journey share ── */
  const journey = useMemo(() => {
    const filled = scoped.filter(p => clean(p.engagementType));
    const j = filled.filter(p => /journey/i.test(p.engagementType)).length;
    const bj = prevBase?.engagementType?.find(([l]) => /journey/i.test(l))?.[1] || 0;
    const bt = prevBase?.engagementType?.reduce((t, r) => t + r[1], 0) || 0;
    return { pct: pct(j, filled.length), n: j, of: filled.length, base: pct(bj, bt) };
  }, [scoped, prevBase]);

  /* ── What we win: by dimension ── */
  const winRows = useMemo(() => {
    const m = new Map();
    scoped.forEach(p => { const lb = label(p[winDim]); const k = keyOf(lb); if (!m.has(k)) m.set(k, { label: lb, list: [] }); m.get(k).list.push(p); });
    return [...m.values()].map(g => ({ label: g.label, list: g.list, ...stat(g.list) })).sort((a, b) => (a.label === NR) - (b.label === NR) || b.n - a.n);
  }, [scoped, winDim]);   // eslint-disable-line react-hooks/exhaustive-deps
  const winMax = Math.max(1, ...winRows.map(r => r.n));


  /* ── Heatmap: Industry × Development Category ── */
  const heat = useMemo(() => {
    const rowsM = new Map(), colsM = new Map(), cells = new Map();
    scoped.forEach(p => {
      const r = label(p.industry), c = label(p.developmentCategory);
      rowsM.set(r, (rowsM.get(r) || 0) + 1); colsM.set(c, (colsM.get(c) || 0) + 1);
      const k = `${r}|${c}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(p);
    });
    const order = m => [...m.entries()].sort((a, b) => (a[0] === NR) - (b[0] === NR) || b[1] - a[1]).map(([k]) => k);
    const rows = order(rowsM).slice(0, 12), cols = order(colsM).slice(0, 8);
    const max = Math.max(1, ...[...cells.values()].map(v => v.length));
    return { rows, cols, max, cell: (r, c) => { const l = cells.get(`${r}|${c}`) || []; return l.length ? { ...stat(l), list: l } : null; }, rowTot: r => rowsM.get(r) || 0 };
  }, [scoped]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Pipeline age (open proposals, any date) ── */
  const age = useMemo(() => {
    const open = latestBase.filter(p => p.pipeline === 'process').map(p => ({ ...p, age: p.date ? days(p.date, todayISO) : null }));
    const bands = [['0–30 days', 0, 30, 'ok'], ['31–60', 31, 60, 'a1'], ['61–90', 61, 90, 'a2'], ['90+', 91, 1e9, 'a3']].map(([lb, a, b, c]) => {
      const l = open.filter(p => p.age != null && p.age >= a && p.age <= b).sort((x, y) => y.age - x.age); return { lb, c, list: l, n: l.length, v: l.reduce((t, p) => t + p.value, 0) };
    });
    return { bands, oldest: open.filter(p => p.age != null).sort((a, b) => b.age - a.age).slice(0, 8), n: open.length, undated: open.filter(p => p.age == null).length };
  }, [latestBase]);

  /* ── Data gaps ── */
  const gaps = useMemo(() => [
    ['Development Category', p => p.developmentCategory], ['Industry', p => p.industry], ['Line of Service', p => p.lineOfService],
    ['Type of Service', p => p.typeOfService], ['Engagement Type', p => p.engagementType], ['Program Type', p => p.customization],
    ['Solution Value', p => (p.value > 0 || p.valueNA ? 'x' : '')], ['Proposal date', p => (p.undated ? '' : 'x')],
  ].map(([lb, f]) => { const miss = scoped.filter(p => !clean(f(p))); return { lb, n: miss.length, pct: pct(miss.length, scoped.length) || 0, list: miss }; })
    .sort((a, b) => b.n - a.n), [scoped]);

  /* ── Top KPI row (16 Nov 2026): solutions, top programs, customization, top line of service ── */
  const topKpi = useMemo(() => {
    const tk = it => `${it.id}|${it.topic.toLowerCase().replace(/\s+/g, ' ')}`;
    const vers = new Map(); rawItems.forEach(it => { const k = tk(it); if (!vers.has(k)) vers.set(k, new Set()); vers.get(k).add(it.version); });
    const uniq = items.filter(inScope), revised = uniq.filter(it => vers.get(tk(it)).size > 1);
    const rank = (list, f) => {
      const m = new Map(); list.forEach(x => { const v = clean(f(x)); if (!v) return; const k = keyOf(v); const g = m.get(k) || { label: v, list: [] }; g.list.push(x); m.set(k, g); });
      return [...m.values()].sort((a, b) => b.list.length - a.list.length);
    };
    const programs = rank(latest.filter(inScope), p => p.topic), los = rank(scoped, p => p.lineOfService);
    const typed = scoped.filter(p => clean(p.customization)), cnt = re => typed.filter(p => re.test(p.customization)).length;
    return { uniq, revised, programs, los, typed, cust: cnt(/custom/i), newC: cnt(/new/i), std: cnt(/standard/i) };
  }, [rawItems, items, latest, scoped, scope]);   // eslint-disable-line react-hooks/exhaustive-deps
  const naCount = scoped.filter(p => !(p.value > 0) && p.valueNA).length;
  const top3 = g => g.slice(0, 3).map(x => `${x.label} (${x.list.length})`).join(' · ') || 'none recorded';


  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Solutioning</h2><p>What we propose, what we win, how fast we turn proposals around and how much of our IP we reuse</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward from the Solution Tracker`} fixed={prevBase ? `${fyLong(prevFy)} from the Dashboard Report (full year) — compared only by pace and % share until it is added to the tracker` : 'all years from the tracker'} />

      <div className="erd-bar">
        <label>Show</label>
        <div className="erd-seg">
          {[['fy', `${fyTiny(CURRENT_FY)} (YTD)`], ['all', 'All tracker data']].map(([k, l]) => (
            <button key={k} type="button" className={scope === k ? 'on' : ''} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
        <label>Count</label>
        <div className="erd-seg">
          {[['item', 'Solution items'], ['prop', 'Proposals']].map(([k, l]) => (
            <button key={k} type="button" className={unit === k ? 'on' : ''} aria-pressed={unit === k} onClick={() => setUnit(k)}>{l}</button>
          ))}
        </div>
        <span className="sl-note">Pace always compares {fyTiny(prevFy)} with {fyTiny(CURRENT_FY)}</span>
      </div>

      <div className="kg g5">
        <Kpi tone="tl" label={`Total Solutions · ${scope === 'all' ? 'all' : 'YTD'}`} list={() => topKpi.uniq.map(pi)} value={topKpi.uniq.length}
          sub={`${topKpi.uniq.length - topKpi.revised.length} unique · ${topKpi.revised.length} revised (in 2+ versions)`}
          how="Unique solutions = Proposal ID + Solution Topic, counted once across versions. Revised = those carried in more than one version of the proposal." />
        <Kpi tone="nv" label="Top Programs" list={() => topKpi.programs.slice(0, 3).flatMap(g => g.list).map(pi)} value={topKpi.programs[0]?.label || '--'}
          sub={top3(topKpi.programs)} how={`Program Topic ranked by number of proposals (latest version) · ${scopeName}.`} />
        <Kpi tone="gd" label="% Customization" list={() => topKpi.typed.filter(p => /custom/i.test(p.customization)).map(pi)} value={pct(topKpi.cust, topKpi.typed.length) != null ? `${pct(topKpi.cust, topKpi.typed.length)}%` : '--'}
          sub={`${topKpi.cust} customized · ${topKpi.newC} new creation · ${topKpi.std} standard of ${topKpi.typed.length}`} how={`${UC} whose Program Type is Customized ÷ ${Us} with a Program Type · ${scopeName}.`} />
        <Kpi tone="nv" label={isItem ? 'Avg Item Value' : 'Avg Proposal Value'} list={() => scoped.filter(p => p.value > 0).sort((a, b) => b.value - a.value).map(p => pi(p))} value={all.avg ? L(all.avg) : '--'}
          sub={all.wonAvg ? `won deals avg ${L(all.wonAvg)}` : `${scoped.filter(p => p.value > 0).length} valued ${Us}`} how={`Average Solution Value per ${Us.slice(0, -1)} (latest version) that has a value.`} />
        <Kpi tone="rd" label="Journey Share" list={() => scoped.filter(p => /journey/i.test(p.engagementType)).map(p => pi(p))} value={journey.pct != null ? `${journey.pct}%` : '--'}
          sub={`${journey.n} of ${journey.of} ${Us}${journey.base != null && scope === 'fy' ? ` · ${fyTiny(prevFy)}: ${journey.base}%` : ''}`} how={`${UC} whose Engagement Type is a learning journey ÷ ${Us} with an Engagement Type.`} />
      </div>

      <div className="cg c1">
        <ProposalStatusPace {...solPace} unit="item" valueName="Solution Value" itemOf={pi} />
      </div>

      <div className="s-band"><span className="s-band-tag bd">Win Analysis</span><span className="s-band-txt">What we win · {scopeName} · {Us}, latest version of each proposal</span></div>
      <div className="cg c1">
        <div className="card"><div className="sl-head"><div><h3>What We Win</h3><div className="cs">{UC} by status and win rate</div></div><Tabs value={winDim} options={DIMS} onChange={setWinDim} /></div>
          {winRows.length === 0 ? <div className="erd-empty">No {Us} in {scopeName}</div> : (
            <div className="s-scroll" style={{ maxHeight: 440 }}>
              <div className="sl-win sl-win-hd"><span>{DIMS.find(d => d[0] === winDim)[1]}</span><span>Proposals · won / open / lost</span><span className="r">Win rate</span></div>
              {winRows.map(r => (
                <div key={r.label} className={`sl-win sl-click${r.label === NR ? ' notrec' : ''}`} onClick={() => show(`${DIMS.find(d => d[0] === winDim)[1]}: ${r.label}`, () => r.list.slice().sort((a, b) => b.value - a.value).map(pi), `Latest version of each proposal in ${scopeName} with this ${DIMS.find(d => d[0] === winDim)[1]}. Win rate = won ÷ total (won + lost + in process).`)}>
                  <span className="sl-win-lb" title={r.label}>{r.label}</span>
                  <span className="sl-win-bar"><span className="sl-win-track" style={{ width: `${(r.n / winMax) * 100}%` }}>
                    {r.won > 0 && <i className="won" style={{ flexGrow: r.won }} title={`${r.won} won`}>{r.won}</i>}
                    {r.open > 0 && <i className="open" style={{ flexGrow: r.open }} title={`${r.open} open`}>{r.open}</i>}
                    {r.lost > 0 && <i className="lost" style={{ flexGrow: r.lost }} title={`${r.lost} lost`}>{r.lost}</i>}
                  </span><em>{r.n}</em></span>
                  <span className="r"><b className={`sl-rate ${r.rate == null ? '' : r.rate >= 50 ? 'hi' : r.rate >= 30 ? 'mid' : 'lo'}`}>{r.rate != null ? `${r.rate}%` : '—'}</b></span>
                </div>
              ))}
            </div>
          )}
          <div className="fr-legend"><span><i style={{ background: GN }} />Won</span><span><i style={{ background: GD }} />Open</span><span><i style={{ background: RD }} />Lost</span><span className="sl-note">Win rate = won ÷ total (won + lost + in process)</span></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Industry × Development Category</h3><div className="cs">Where demand comes from · number = {Us}, shade = volume, dot = win rate (green ≥ 50% · amber 30–49% · red &lt; 30%) · {scopeName}</div>
          {heat.rows.length === 0 ? <div className="erd-empty">No {Us} in {scopeName}</div> : (
            <div className="sl-heat-wrap">
              <table className="sl-heat">
                <thead><tr><th>Industry</th>{heat.cols.map(c => <th key={c} title={c}><span>{c}</span></th>)}<th className="tot">Total</th></tr></thead>
                <tbody>{heat.rows.map(r => (
                  <tr key={r}><td className="rl" title={r}>{r}</td>
                    {heat.cols.map(c => { const x = heat.cell(r, c); const a = x ? 0.12 + 0.78 * (x.n / heat.max) : 0;
                      return <td key={c} className={x ? 'sl-click' : ''} onClick={x ? () => show(`${r} × ${c}`, () => x.list.map(pi), `Proposals (latest version, ${scopeName}) with Industry = ${r} and Development Category = ${c}.`) : undefined} style={x ? { background: `rgba(0,128,140,${a})`, color: a > 0.5 ? '#fff' : '#0D1B35' } : undefined}
                        title={x ? `${r} · ${c}\n${x.n} ${Us} · ${x.won} won · ${x.lost} lost${x.value ? ` · ${L(x.value)}` : ''}` : ''}>
                        {x ? <>{x.n}{x.rate != null && <i className={`sl-dot ${x.rate >= 50 ? 'hi' : x.rate >= 30 ? 'mid' : 'lo'}`} />}</> : ''}</td>; })}
                    <td className="tot">{heat.rowTot(r)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="s-band"><span className="s-band-tag ec">Solutioning Team</span><span className="s-band-txt">Revisions and IP reuse · {scopeName}</span></div>
      <div className="cg c1">
        <div className="card flex-card"><h3>Process Health</h3><div className="cs">Where the time goes and how often proposals are revised</div>
          <div className="sl-stats">
            <div className="sl-click" onClick={() => show('Revised proposals', () => team.revisedIds.map(id => latestById.get(id)).filter(Boolean).map(p => ({ ...pi(p), right: `${team.versionsById.get(p.id)} versions` })), 'Number of versions (V1, V2 …) per proposal ID; listed: proposals with more than one version.')}><span>Avg versions</span><b>{team.avgVersions ? team.avgVersions.toFixed(1) : '—'}</b></div>
            <div className="sl-click" onClick={() => show('Revised proposals', () => team.revisedIds.map(id => latestById.get(id)).filter(Boolean).map(p => ({ ...pi(p), right: `${team.versionsById.get(p.id)} versions` })), 'Proposals with a V2 or later ÷ all proposals in scope.')}><span>Proposals revised</span><b>{team.revisedPct != null ? `${team.revisedPct}%` : '—'}</b></div>
          </div>
          <div className="sl-sub">Versions per proposal</div>
          <div className="sl-vbars">
            {['V1 only', 'V2', 'V3+'].map((lb, i) => { const tot = team.vDist.reduce((t, v) => t + v, 0) || 1; return (
              <div key={lb}><span>{lb}</span><span className="sl-vtrack"><i className={`v${i}`} style={{ width: `${(team.vDist[i] / tot) * 100}%` }} /></span><b>{team.vDist[i]}</b></div>); })}
          </div>
          <div className="sl-sub">Value change V1 → final version</div>
          <div className={`sl-change ${team.valueChange == null ? '' : team.valueChange < 0 ? 'down' : 'up'}`}>
            {team.valueChange == null ? 'No revised proposals with values on both versions' : <><b>{team.valueChange >= 0 ? '+' : ''}{Math.round(team.valueChange * 100)}%</b> average across {team.changeN} revised proposal{team.changeN === 1 ? '' : 's'}</>}
          </div>
        </div>
      </div>

      <div className="cg c32">
        <div className="card flex-card"><h3>IP Library — Most-used Solution Topics</h3><div className="cs">Topics proposed most often · clients reached and win rate · {scopeName}</div>
          {ip.top.length === 0 ? <div className="erd-empty">No solution topics recorded</div> : (
            <div className="s-scroll" style={{ maxHeight: 420 }}>
              {ip.top.map((g, i) => { const max = ip.top[0].scopeIds.size || 1, rate = pct(g.won.size, g.scopeIds.size); return (
                <div key={g.label} className="sl-ip sl-click" onClick={() => show(`Solution topic: ${g.label}`, () => [...g.scopeIds].map(id => latestById.get(id)).filter(Boolean).map(pi), `Proposals (${scopeName}) with a solution item named "${g.label}". Reused = the topic appears in more than one proposal at any date.`)}>
                  <span className="sc-rank" style={i < 3 ? { background: NV, color: '#fff' } : undefined}>{i + 1}</span>
                  <span className="sl-ip-lb" title={g.label}>{g.label}{g.ids.size > 1 && <em className="sl-reuse">reused</em>}</span>
                  <span className="sl-ip-track"><i style={{ width: `${(g.scopeIds.size / max) * 100}%` }} /></span>
                  <span className="sl-num r">{g.scopeIds.size} prop.</span>
                  <span className="sl-num r">{g.clients.size} client{g.clients.size === 1 ? '' : 's'}</span>
                  <span className="r"><b className={`sl-rate ${rate == null ? '' : rate >= 50 ? 'hi' : rate >= 30 ? 'mid' : 'lo'}`}>{rate != null ? `${rate}%` : '—'}</b></span>
                </div>); })}
            </div>
          )}
        </div>
        <div className="card flex-card fr-card"><h3>Open Pipeline Age</h3><div className="cs">{age.n} {Us} In Process (latest version, any date){age.undated ? ` · ${age.undated} undated` : ''}</div>
          <div className="fr-tiles" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {age.bands.map(b => <div key={b.lb} className={`fr-tile sl-click ${b.c}`} onClick={() => show(`Open ${Us} · ${b.lb}`, () => b.list.map(p => ({ ...pi(p), right: `${p.age} days` })), 'In Process proposals (latest version), age = days since the proposal date.')}><div className="fr-tile-lb">{b.lb}</div><div className="fr-tile-vl">{b.n}</div><div className="fr-tile-sb">{b.v ? L(b.v) : 'no value'}</div></div>)}
          </div>
          <div className="sl-sub">Oldest open {Us}</div>
          <div className="s-scroll" style={{ maxHeight: 220 }}>
            {age.oldest.map(p => (
              <div key={p.key} className="sl-old sl-click" onClick={() => show(`${p.client || p.id} · ${p.id}`, [{ ...pi(p), right: `${p.age} days` }], 'Open for this many days since the proposal date. Double-tap the row to edit it in the BD Tracker.')}><div><b>{p.client || p.id}</b><span>{p.topic || '—'} · {p.id}</span></div><em className={p.age > 90 ? 'lo' : p.age > 60 ? 'mid' : ''}>{p.age}d</em></div>
            ))}
            {age.oldest.length === 0 && <div className="erd-empty">No dated open {Us}</div>}
          </div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Data Gaps — {scopeName}</h3><div className="cs">{UC} (latest version) missing a field the charts above rely on · fill these in the Solution Tracker to sharpen every view</div>
          <div className="sl-gaps">
            {gaps.map(g => (
              <div key={g.lb} className={`sl-gap sl-click ${g.pct >= 30 ? 'lo' : g.pct >= 10 ? 'mid' : 'hi'}`} onClick={() => show(`Missing ${g.lb}`, () => g.list.map(pi), `Proposals (latest version, ${scopeName}) with no ${g.lb}. Double-tap one to fill it in.`)}>
                <div className="sl-gap-top"><span>{g.lb}</span><b>{g.n}</b></div>
                <div className="sl-gap-track"><i style={{ width: `${g.pct}%` }} /></div>
                <div className="sl-gap-sb">{g.pct}% of {scoped.length} {Us}{g.lb === 'Solution Value' && naCount ? ` · ${naCount} marked NA (no value, not a gap)` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {drill && <KpiListModal title={drill.title} items={drill.items} how={drill.how} onClose={() => setDrill(null)} />}
    </div>
  );
}
