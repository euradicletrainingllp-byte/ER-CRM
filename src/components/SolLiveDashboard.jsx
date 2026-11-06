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
 *   Proposal line  Proposal ID + version (proposalData.js). Pace / mix count every line, as the Excel did.
 *   Proposal       latest version of a Proposal ID — used for win rate, deal value, heatmap, pipeline.
 *   Status         BD Status Won / Closed / Confirmed → won · Lost / Dropped / Rejected → lost · else open
 *   Value          Solution Value (same as the Solution Tracker)
 *   Turnaround     Date of Discussion → Date of Submission to Client (else by Sol team), first version
 *   On time        submitted on or before the Client Expected date
 *   IP reuse       solution items whose Solution Topic is used in 2+ proposals
 */
import { useMemo, useState } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, TL, GD, GN, RD, PU, CURRENT_FY, fyLong, fyTiny, todayISO, clean, keyOf,
} from './erdCharts.jsx';
import { buildProposalLines, monthSlot, toISODate, versionNo } from './proposalData.js';
import KpiListModal, { solItem } from './KpiListModal.jsx';
import { LIVE_FROM_FY, SOL_BASELINE } from '../config/dashboardBaseline.js';

const NR = 'Not recorded';
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const MIX_COLORS = [NV, TL, GD, PU, GN, RD, '#3B82F6', '#C026D3', '#94A3B8'];
const L = v => { const n = Number(v) || 0; return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const slot = iso => (+iso.slice(5, 7) + 8) % 12;
const label = v => clean(v) || NR;

const DIMS = [
  ['developmentCategory', 'Development Category'], ['lineOfService', 'Line of Service'], ['typeOfService', 'Type of Service'],
  ['industry', 'Industry'], ['engagementType', 'Engagement Type'], ['customization', 'Program Type'],
];
const MIX_DIMS = DIMS.filter(([k]) => k !== 'industry');

function Tabs({ value, options, onChange }) {
  return <div className="sl-tabs">{options.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

export default function SolLiveDashboard({ solutions, refreshing }) {
  const [unit, setUnit] = useState('item');           // 'item' = unique solution items · 'prop' = proposals (latest version / lines)
  const [scope, setScope] = useState('fy');          // 'fy' = this FY (YTD) · 'all' = every proposal in the tracker
  const [winDim, setWinDim] = useState('developmentCategory');
  const [mixDim, setMixDim] = useState('developmentCategory');
  const [mixBy, setMixBy] = useState('count');
  const [drill, setDrill] = useState(null);           // { title, items, how } — tap any figure to list its proposals
  const show = (title, items, how) => setDrill({ title, items, how });
  const prevFy = CURRENT_FY - 1;
  const nowSlot = slot(todayISO);
  const monthFrac = +todayISO.slice(8, 10) / new Date(+todayISO.slice(0, 4), +todayISO.slice(5, 7), 0).getDate();

  /* ── Data ── */
  const lines = useMemo(() => buildProposalLines(solutions || []).map(p => ({ ...p, value: p.solValue || 0 })), [solutions]);
  const latest = useMemo(() => lines.filter(l => l.isLatest), [lines]);
  // Solution items: one per Solution Topic row; dims + value from the row, date / FY / status from its proposal line
  const rawItems = useMemo(() => [...lines.flatMap(l => (l.itemRows || []).map((r, i) => ({ ...l, key: `${l.key}|${i}`, isSolItem: true, programTopic: l.topic, topic: clean(r.solutionTopic),
    developmentCategory: clean(r.developmentCategory) || l.developmentCategory, lineOfService: clean(r.lineOfService) || l.lineOfService,
    typeOfService: clean(r.typeOfService) || l.typeOfService, engagementType: clean(r.engagementType) || l.engagementType,
    value: Number(String(r.solutionValue ?? '').replace(/[^0-9.]/g, '')) || 0 })))
], [lines]);
  // Unique solutions: a topic repeated in a later version (V2, V3 …) of the same Proposal ID counts once — only the
  // highest version that carries it is kept. Rows inside one version are never merged (two items may share a topic).
  const items = useMemo(() => {
    const tk = it => `${it.id}|${it.topic.toLowerCase().replace(/\s+/g, ' ')}`;
    const top = new Map(); rawItems.forEach(it => { const k = tk(it); if (!(top.get(k) >= it.version)) top.set(k, it.version); });
    return rawItems.filter(it => it.version === top.get(tk(it)));
  }, [rawItems]);
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
  const prevName = `${fyTiny(prevFy)}${prevBase ? ' (report, full year)' : prevLive.length ? '' : ' (no tracker data)'}`;

  /* ── Pace: proposal lines per month, this FY vs last FY ── */
  const pace = useMemo(() => {
    const cur = Array(12).fill(0);
    base.filter(l => l.fy === CURRENT_FY).forEach(l => { cur[monthSlot(l)] += 1; });
    let prev = Array(12).fill(0);
    if (prevBase) prev = prevBase.monthly.slice();
    else prevLive.forEach(l => { prev[monthSlot(l)] += 1; });
    const cum = a => a.reduce((o, v, i) => { o.push((o[i - 1] || 0) + v); return o; }, []);
    const curCum = cum(cur).map((v, i) => (i <= nowSlot ? v : null));
    const prevCum = cum(prev);
    const prevSame = prev.slice(0, nowSlot).reduce((t, v) => t + v, 0) + prev[nowSlot] * monthFrac;
    const curYtd = cur.slice(0, nowSlot + 1).reduce((t, v) => t + v, 0);
    return { cur, prev, curCum, prevCum, prevSame: Math.round(prevSame), curYtd };
  }, [base, prevBase, prevLive, nowSlot, monthFrac]);

  const paceCfg = useMemo(() => ({ type: 'bar',
    data: { labels: MONTHS, datasets: [
      { type: 'line', label: `${fyTiny(CURRENT_FY)} running total`, data: pace.curCum, borderColor: TL, backgroundColor: TL, borderWidth: 3, pointRadius: 3, tension: 0.25, cubicInterpolationMode: 'monotone', yAxisID: 'y1', order: 0, spanGaps: false,
        datalabels: { display: c => c.dataIndex === nowSlot, align: 'top', color: TL, font: { size: 12, weight: '800' } } },
      { type: 'line', label: `${prevName} running total`, data: pace.prevCum, borderColor: '#94A3B8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.25, cubicInterpolationMode: 'monotone', yAxisID: 'y1', order: 0,
        datalabels: { display: c => c.dataIndex === nowSlot || c.dataIndex === 11, align: 'top', color: '#64748B', font: { size: 11, weight: '700' } } },
      { label: `${fyTiny(CURRENT_FY)} per month`, data: pace.cur.map((v, i) => (i <= nowSlot ? v : null)), backgroundColor: 'rgba(0,128,140,.22)', borderRadius: 4, yAxisID: 'y', order: 1, maxBarThickness: 34,
        datalabels: { display: c => c.dataset.data[c.dataIndex] > 0, anchor: 'end', align: 'end', color: '#0F5F66', font: { size: 11, weight: '700' } } },
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22 } }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: { x: { grid: { display: false } }, y: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'per month', font: { size: 11 } }, ticks: { precision: 0 } },
        y1: { position: 'left', beginAtZero: true, grid: { color: '#EDF0F5' }, title: { display: true, text: 'running total', font: { size: 11 } }, ticks: { precision: 0 } } } },
  }), [pace, nowSlot, prevName]);

  /* ── Status helpers on latest-version proposals ── */
  const stat = list => {
    const won = list.filter(p => p.pipeline === 'closed'), lost = list.filter(p => p.pipeline === 'lost'), open = list.filter(p => p.pipeline === 'process');
    const valued = list.filter(p => p.value > 0), wonValued = won.filter(p => p.value > 0);
    return { n: list.length, won: won.length, lost: lost.length, open: open.length, rate: pct(won.length, won.length + lost.length),
      value: valued.reduce((t, p) => t + p.value, 0), avg: valued.length ? valued.reduce((t, p) => t + p.value, 0) / valued.length : 0,
      wonAvg: wonValued.length ? wonValued.reduce((t, p) => t + p.value, 0) / wonValued.length : 0 };
  };
  const all = useMemo(() => stat(scoped), [scoped]);   // eslint-disable-line react-hooks/exhaustive-deps
  const baseRate = prevBase ? pct(prevBase.summary.closed, prevBase.summary.closed + prevBase.summary.lost) : null;

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

  const teamCfg = useMemo(() => ({ type: 'bar',
    data: { labels: MONTHS, datasets: [
      { type: 'line', label: 'On time %', data: team.mOn, borderColor: GN, backgroundColor: GN, borderWidth: 2.5, pointRadius: 3, yAxisID: 'y1', spanGaps: true, tension: 0.25, order: 0,
        datalabels: { display: c => c.dataset.data[c.dataIndex] != null, align: 'top', color: '#14804A', font: { size: 10.5, weight: '700' }, formatter: v => `${v}%` } },
      { label: 'Avg turnaround (days)', data: team.mAvg, backgroundColor: PU, borderRadius: 4, yAxisID: 'y', order: 1, maxBarThickness: 30,
        datalabels: { display: c => c.dataset.data[c.dataIndex] != null, anchor: 'end', align: 'end', color: '#5B3FA0', font: { size: 11, weight: '700' } } },
    ] },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#EDF0F5' }, title: { display: true, text: 'days', font: { size: 11 } } },
        y1: { position: 'right', min: 0, max: 110, grid: { display: false }, ticks: { callback: v => (v <= 100 ? `${v}%` : '') } } } },
  }), [team]);

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

  /* ── Portfolio mix (% share): last FY vs this FY — paired bars per category ── */
  const mix = useMemo(() => {
    const metric = mixBy === 'count' ? 1 : 2;
    const curLines = base.filter(l => l.fy === CURRENT_FY);
    const cur = new Map(), prev = new Map();
    const add = (m, lb, c, v) => { const k = keyOf(lb); const g = m.get(k) || [lb, 0, 0]; g[1] += c; g[2] += v; m.set(k, g); };
    curLines.forEach(l => add(cur, label(l[mixDim]), 1, l.value));
    if (prevBase) (prevBase[mixDim] || []).forEach(([lb, c, v]) => add(prev, clean(lb) || NR, c, v));
    else prevLive.forEach(l => add(prev, label(l[mixDim]), 1, l.value));
    const totP = [...prev.values()].reduce((t, g) => t + g[metric], 0), totC = [...cur.values()].reduce((t, g) => t + g[metric], 0);
    const sh = (m, tot, k) => (tot ? ((m.get(k)?.[metric] || 0) / tot) * 100 : 0);
    const all = [...new Set([...prev.keys(), ...cur.keys()])].map(k => ({ k, lb: (cur.get(k) || prev.get(k))[0], p: sh(prev, totP, k), c: sh(cur, totC, k),
      raw: cur.get(k)?.[metric] || 0, inPrev: prev.has(k) && (prev.get(k)[metric] || 0) > 0 }));
    const named = all.filter(x => x.lb !== NR).sort((a, b) => b.c - a.c || b.p - a.p);
    const main = named.slice(0, 8), rest = [...named.slice(8), ...all.filter(x => x.lb === NR)];
    const rows = main.map(x => ({ ...x, d: x.c - x.p, isNew: !x.inPrev && x.c > 0 }));
    if (rest.length) {
      const sum = f => rest.reduce((t, x) => t + x[f], 0);
      rows.push({ k: '__rest', lb: rest.length === 1 && rest[0].lb === NR ? NR : 'Others / not recorded', p: sum('p'), c: sum('c'), raw: sum('raw'), d: sum('c') - sum('p'), rest: true, keys: new Set(rest.map(x => x.k)) });
    }
    const movers = rows.filter(r => !r.rest && r.inPrev);
    const gain = movers.slice().sort((a, b) => b.d - a.d)[0], drop = movers.slice().sort((a, b) => a.d - b.d)[0];
    return { max: Math.max(1, ...rows.flatMap(r => [r.p, r.c])), rows, totP, totC, gain: gain && gain.d >= 1 ? gain : null, drop: drop && drop.d <= -1 ? drop : null,
      list: r => curLines.filter(l => { const k = keyOf(label(l[mixDim])); return r.rest ? r.keys.has(k) : k === r.k; }) };
  }, [base, prevBase, prevLive, mixDim, mixBy]);
  const fmtMix = v => (mixBy === 'count' ? `${v} ${v === 1 ? Us.slice(0, -1) : Us}` : L(v));
  const pts = d => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)} pts`;

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
    ['Solution Value', p => (p.value > 0 ? 'x' : '')], ['Proposal date', p => (p.undated ? '' : 'x')],
  ].map(([lb, f]) => { const miss = scoped.filter(p => !clean(f(p))); return { lb, n: miss.length, pct: pct(miss.length, scoped.length) || 0, list: miss }; })
    .sort((a, b) => b.n - a.n), [scoped]);

  const paceDelta = pace.prevSame ? Math.round(((pace.curYtd - pace.prevSame) / pace.prevSame) * 100) : null;

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
        <span className="sl-note">Pace and mix always compare {fyTiny(prevFy)} with {fyTiny(CURRENT_FY)}</span>
      </div>

      <div className="kg g6">
        <Kpi tone="tl" label={`${isItem ? 'Solution Items' : 'Proposals'} YTD`} list={() => base.filter(l => l.fy === CURRENT_FY).map(p => pi(p))} value={pace.curYtd}
          sub={isItem ? `${rawItems.filter(l => l.fy === CURRENT_FY).length} rows in tracker · ${rawItems.filter(l => l.fy === CURRENT_FY).length - items.filter(l => l.fy === CURRENT_FY).length} repeated in later versions${paceDelta != null ? ` · ${paceDelta >= 0 ? '▲' : '▼'} ${Math.abs(paceDelta)}% vs ${fyTiny(prevFy)}` : ''}` : paceDelta != null ? `${paceDelta >= 0 ? '▲' : '▼'} ${Math.abs(paceDelta)}% vs ${pace.prevSame} by this date in ${fyTiny(prevFy)}` : 'no last-year pace yet'} tag={paceDelta != null ? (paceDelta >= 0 ? 'Ahead' : 'Behind') : undefined} tagTone={paceDelta >= 0 ? 'up' : 'bad'}
          how={`${isItem ? 'Unique solutions (Proposal ID + Solution Topic, counted once across versions)' : 'Proposal lines (ID + version)'} dated April → today, against last FY up to the same day.`} />
        <Kpi tone="gn" label={`Win Rate · ${scope === 'all' ? 'all' : 'YTD'}`} list={() => scoped.filter(p => p.pipeline === 'closed').map(p => pi(p))} value={all.rate != null ? `${all.rate}%` : '--'}
          sub={`${all.won} won · ${all.lost} lost · ${all.open} open${baseRate != null && scope === 'fy' ? ` · ${fyTiny(prevFy)}: ${baseRate}%` : ''}`} how={`Won ÷ (won + lost) ${Us}, latest proposal version only — open and replaced versions excluded.`} />
        <Kpi tone="nv" label={isItem ? 'Avg Item Value' : 'Avg Proposal Value'} list={() => scoped.filter(p => p.value > 0).sort((a, b) => b.value - a.value).map(p => pi(p))} value={all.avg ? L(all.avg) : '--'}
          sub={all.wonAvg ? `won deals avg ${L(all.wonAvg)}` : `${scoped.filter(p => p.value > 0).length} valued ${Us}`} how={`Average Solution Value per ${Us.slice(0, -1)} (latest version) that has a value.`} />
        <Kpi tone="pu" label="Avg Turnaround" list={() => team.list.filter(x => x.tat != null).sort((a, b) => b.tat - a.tat).map(x => ({ ...pi(x.line), right: `${x.tat} days`, badge: x.onTime == null ? '' : x.onTime ? 'On time' : 'Late (overdue)' }))} value={team.avgTat != null ? `${Math.round(team.avgTat)} days` : '--'}
          sub={team.onTimePct != null ? `${team.onTimePct}% on time (${team.timedN} with a client date)` : `${team.tatN} proposals timed`} how="Date of Discussion → first submission to the client (else by the Sol team). On time = on or before Client Expected date." />
        <Kpi tone="gd" label="IP Reuse" list={() => [...ip.reusedBy.entries()].map(([id, tps]) => latestById.get(id) && ({ ...pi(latestById.get(id)), sub: `Reused topics: ${tps.join(', ')}` })).filter(Boolean)} value={ip.reusePct != null ? `${ip.reusePct}%` : '--'}
          sub={`${ip.reused} of ${ip.distinct} solution topics used in 2+ proposals`} how="Share of solution items whose Solution Topic appears in more than one proposal (any date) — higher = more reuse of existing IP." />
        <Kpi tone="rd" label="Journey Share" list={() => scoped.filter(p => /journey/i.test(p.engagementType)).map(p => pi(p))} value={journey.pct != null ? `${journey.pct}%` : '--'}
          sub={`${journey.n} of ${journey.of} ${Us}${journey.base != null && scope === 'fy' ? ` · ${fyTiny(prevFy)}: ${journey.base}%` : ''}`} how={`${UC} whose Engagement Type is a learning journey ÷ ${Us} with an Engagement Type.`} />
      </div>

      <div className="cg c1">
        <div className="card"><h3>{isItem ? 'Solution Item' : 'Proposal'} Pace — {fyTiny(CURRENT_FY)} vs {prevName}</h3>
          <div className="cs">Running total of {Us}, month by month · bars = {Us} each month this FY</div>
          <ChartBox config={paceCfg} className="ch-wrap tall" title="Pace" how={`${isItem ? 'Unique solutions (Proposal ID + Solution Topic, once across versions)' : 'Proposal lines (ID + version)'} by month of Date of Discussion (else BD Month / submission dates). Running total = April up to that month.${prevBase ? ` ${fyTiny(prevFy)} comes from the fixed report, so it has no records to list.` : ''}`}
            listFor={(lb, ds) => { const mi = MONTHS.indexOf(lb); const pool = ds.startsWith(fyTiny(prevFy)) ? prevLive : base.filter(l => l.fy === CURRENT_FY); return pool.filter(l => (/running/.test(ds) ? monthSlot(l) <= mi : monthSlot(l) === mi)).map(pi); }} />
        </div>
      </div>

      <div className="s-band"><span className="s-band-tag bd">Win Analysis</span><span className="s-band-txt">What we win, where the value is · {scopeName} · {Us}, latest version of each proposal</span></div>
      <div className="cg c1">
        <div className="card"><div className="sl-head"><div><h3>What We Win</h3><div className="cs">{UC} by status, win rate and average value</div></div><Tabs value={winDim} options={DIMS} onChange={setWinDim} /></div>
          {winRows.length === 0 ? <div className="erd-empty">No {Us} in {scopeName}</div> : (
            <div className="s-scroll" style={{ maxHeight: 440 }}>
              <div className="sl-win sl-win-hd"><span>{DIMS.find(d => d[0] === winDim)[1]}</span><span>Proposals · won / open / lost</span><span className="r">Win rate</span><span className="r">Avg value</span><span className="r">Total value</span></div>
              {winRows.map(r => (
                <div key={r.label} className={`sl-win sl-click${r.label === NR ? ' notrec' : ''}`} onClick={() => show(`${DIMS.find(d => d[0] === winDim)[1]}: ${r.label}`, () => r.list.slice().sort((a, b) => b.value - a.value).map(pi), `Latest version of each proposal in ${scopeName} with this ${DIMS.find(d => d[0] === winDim)[1]}. Win rate = won ÷ (won + lost); average value = Solution Value of proposals that have one.`)}>
                  <span className="sl-win-lb" title={r.label}>{r.label}</span>
                  <span className="sl-win-bar"><span className="sl-win-track" style={{ width: `${(r.n / winMax) * 100}%` }}>
                    {r.won > 0 && <i className="won" style={{ flexGrow: r.won }} title={`${r.won} won`}>{r.won}</i>}
                    {r.open > 0 && <i className="open" style={{ flexGrow: r.open }} title={`${r.open} open`}>{r.open}</i>}
                    {r.lost > 0 && <i className="lost" style={{ flexGrow: r.lost }} title={`${r.lost} lost`}>{r.lost}</i>}
                  </span><em>{r.n}</em></span>
                  <span className="r"><b className={`sl-rate ${r.rate == null ? '' : r.rate >= 50 ? 'hi' : r.rate >= 30 ? 'mid' : 'lo'}`}>{r.rate != null ? `${r.rate}%` : '—'}</b></span>
                  <span className="r sl-num">{r.avg ? L(r.avg) : '—'}</span>
                  <span className="r sl-num">{r.value ? L(r.value) : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <div className="fr-legend"><span><i style={{ background: GN }} />Won</span><span><i style={{ background: GD }} />Open</span><span><i style={{ background: RD }} />Lost</span><span className="sl-note">Win rate = won ÷ (won + lost)</span></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><div className="sl-head"><div><h3>Portfolio Mix</h3>
          <div className="cs">% share of {Us} {mixBy === 'value' ? '(by Solution Value) ' : ''}— last FY vs this FY so far, so a full year and a part year compare fairly · {mixBy === 'count' ? `${mix.totP} vs ${mix.totC} ${Us}` : `${L(mix.totP)} vs ${L(mix.totC)}`}</div>
          <div className="pm-movers">
            {mix.gain && <span className="pm-chip up">Biggest gain: <b>{mix.gain.lb}</b> {pts(mix.gain.d)}</span>}
            {mix.drop && <span className="pm-chip down">Biggest drop: <b>{mix.drop.lb}</b> {pts(mix.drop.d)}</span>}
          </div></div>
          <div className="sl-head-r"><Tabs value={mixBy} options={[['count', 'By count'], ['value', 'By value']]} onChange={setMixBy} /></div></div>
          <Tabs value={mixDim} options={MIX_DIMS} onChange={setMixDim} />
          {mix.rows.length === 0 ? <div className="erd-empty">No {Us} yet</div> : (
            <div className="s-scroll" style={{ maxHeight: 460 }}>
              {mix.rows.map(r => (
                <div key={r.k} className={`pm-row sl-click${r.rest ? ' rest' : ''}`}
                  onClick={() => show(`${MIX_DIMS.find(d => d[0] === mixDim)[1]}: ${r.lb} · ${fyTiny(CURRENT_FY)}`, () => mix.list(r).sort((a, b) => b.value - a.value).map(pi),
                    `Share = ${mixBy === 'count' ? Us : 'Solution Value'} in this ${MIX_DIMS.find(d => d[0] === mixDim)[1]} ÷ all, per year. ${fyTiny(prevFy)}${prevBase ? ' is the fixed full-year report (no records to list)' : ' is from the tracker'}; the list shows this FY's proposals.`)}>
                  <div className="pm-lb" title={r.lb}>{r.lb}<em>{fmtMix(r.raw)} this FY</em></div>
                  <div className="pm-bars">
                    <div className="pm-bar prev"><span style={{ width: `${Math.max((r.p / mix.max) * 88, r.p > 0 ? 0.8 : 0)}%` }} /><b>{r.p.toFixed(r.p < 10 ? 1 : 0)}%</b></div>
                    <div className="pm-bar cur"><span style={{ width: `${Math.max((r.c / mix.max) * 88, r.c > 0 ? 0.8 : 0)}%` }} /><b>{r.c.toFixed(r.c < 10 ? 1 : 0)}%</b></div>
                  </div>
                  <div className="pm-d">{r.isNew ? <span className="pm-chip new">new</span>
                    : Math.abs(r.d) < 0.5 ? <span className="pm-chip flat">± 0</span>
                    : <span className={`pm-chip ${r.d > 0 ? 'up' : 'down'}`}>{r.d > 0 ? '▲' : '▼'} {pts(r.d)}</span>}</div>
                </div>
              ))}
            </div>
          )}
          <div className="fr-legend"><span><i style={{ background: '#94A3B8' }} />{prevName}</span><span><i style={{ background: TL }} />{fyTiny(CURRENT_FY)} YTD</span><span className="sl-note">Tap a row to list this FY's proposals</span></div>
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

      <div className="s-band"><span className="s-band-tag ec">Solutioning Team</span><span className="s-band-txt">Turnaround, revisions and IP reuse · {scopeName}</span></div>
      <div className="cg c32">
        <div className="card"><h3>Turnaround &amp; On-time Submission</h3><div className="cs">Average days from discussion to submission, by discussion month · line = % submitted by the client's expected date</div>
          {team.tatN || team.timedN ? <ChartBox config={teamCfg} className="ch-wrap tall" title="Turnaround" how="Days from Date of Discussion to the first submission to the client (else by the Sol team), by discussion month. On time = submitted on or before the Client Expected date."
            listFor={lb => { const mi = MONTHS.indexOf(lb); return team.list.filter(x => x.disc && slot(x.disc) === mi && (scope === 'all' || x.line.fy === CURRENT_FY)).map(x => ({ ...pi(x.line), right: x.tat != null ? `${x.tat} days` : '—', badge: x.onTime == null ? '' : x.onTime ? 'On time' : 'Late (overdue)' })); }} /> : <div className="erd-empty">No proposals with both a discussion and a submission date yet</div>}
        </div>
        <div className="card flex-card"><h3>Process Health</h3><div className="cs">Where the time goes and how often proposals are revised</div>
          <div className="sl-stats">
            <div className="sl-click" onClick={() => show('Discussion → Sol team', () => team.list.filter(x => x.solTat != null).sort((a, b) => b.solTat - a.solTat).map(x => ({ ...pi(x.line), right: `${x.solTat} days` })), 'Days from Date of Discussion to Date of Submission by Sol team (first version).')}><span>Discussion → Sol team</span><b>{team.avgSol != null ? `${Math.round(team.avgSol)} d` : '—'}</b></div>
            <div className="sl-click" onClick={() => show('Sol team → Client', () => team.list.filter(x => x.clTat != null).sort((a, b) => b.clTat - a.clTat).map(x => ({ ...pi(x.line), right: `${x.clTat} days` })), 'Days from Date of Submission by Sol team to Date of Submission to Client (first version).')}><span>Sol team → Client</span><b>{team.avgCl != null ? `${Math.round(team.avgCl)} d` : '—'}</b></div>
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
              {ip.top.map((g, i) => { const max = ip.top[0].scopeIds.size || 1, rate = pct(g.won.size, g.won.size + g.lost.size); return (
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
                <div className="sl-gap-sb">{g.pct}% of {scoped.length} {Us}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {drill && <KpiListModal title={drill.title} items={drill.items} how={drill.how} onClose={() => setDrill(null)} />}
    </div>
  );
}
