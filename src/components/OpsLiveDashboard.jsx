/**
 * Operations dashboard — rebuilt 7 Nov 2026 as an operations-intelligence view:
 *   KPIs (vs last FY same date) · insight alerts · next-30-day readiness · monthly rhythm · day heatmap ·
 *   consultant load · client portfolio · mode / service / feedback mix · History (FY trend, YoY, feedback log, collapsed).
 *
 *   FY 2026-27 onward  → live from the Engagement Calendar
 *   Earlier years      → fixed numbers from Dashboard Report Data (12 Oct 2026), see dashboardBaseline.js
 *
 * Live definitions
 *   Delivered   Status = Delivered
 *   Upcoming    Status Scheduled / Tentative / Re-Schedule with a start date from today onward
 *   Project     unique EG ID ("Count by → Sessions" counts calendar rows instead)
 *   Days        the "Day" column, credited to every consultant on the session
 *   Mode        Location VILT / Virtual / Online → Virtual, any other place → In-Person
 *   Feedback    "Feedback" column when it is a score between 0 and 5
 */
import { useMemo, useState } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, TL, GD, GN, PU, RD, bOpts, dlNum, dlH, fmtNum, heightFor,
  CURRENT_FY, fyStartOf, fyShort, fyLong, todayISO, clean, keyOf,
} from './erdCharts.jsx';
import { LIVE_FROM_FY, OPS_FY, OPS_CONSULTANT_PREV, OPS_CLIENT_PREV, OPS_FEEDBACK } from '../config/dashboardBaseline.js';

const NOT_A_PERSON = /^(euradicle|er pmo team|tbd|na|n\/a|-|—)$/i;
const isDelivered = e => /^delivered$/i.test(clean(e.status));
const hasDate = e => /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || '');
const isCancelled = e => /cancel|lost|drop|postpon|hold/i.test(clean(e.status));
// Dates TBD: a row with an Index / S No that is not delivered or cancelled is an upcoming engagement
const isUpcoming  = e => (hasDate(e)
  ? /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status)) && e.startDate >= todayISO
  : !isDelivered(e) && !isCancelled(e));
const daysOf = e => (Number(e.day) > 0 ? Number(e.day) : 0);
import KpiListModal, { egItem } from './KpiListModal.jsx';
const consultantsOf = e => [...new Set([e.consultant1, e.consultant2, e.consultant3].map(clean).filter(n => n && !NOT_A_PERSON.test(n)))];
const modeOf = e => {
  const raw = clean(e.locationRaw ?? e.location);
  if (!raw || raw === '#VALUE!') return 'unknown';
  return /vilt|virtual|online|zoom|teams|webinar/i.test(raw) ? 'virtual' : 'inPerson';
};
const feedbackOf = e => { const n = Number(clean(e.feedback)); return n > 0 && n <= 5 ? n : null; };
// Feedback = N/A → feedback not required: left out of averages and of awaited / missing counts
const fbNA = e => /^(n\s*\/?\s*a|not\s*(required|applicable))$/i.test(clean(e.feedback));
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = iso => (iso ? `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');

/** Counts unique EG IDs (projects) or rows (sessions) per key. */
function counter(countBy) {
  const m = new Map();
  return {
    add(k, e) {
      if (!m.has(k)) m.set(k, countBy === 'projects' ? new Set() : { size: 0, add() { this.size++; } });
      m.get(k).add(clean(e.egId) || `row-${e.sno}`);
    },
    get: k => m.get(k)?.size || 0,
  };
}

/** Horizontal one-colour bar charts, one per year, sharing the same x-axis. */
function MiniYearCharts({ blocks, palette, unit, titleOf }) {
  const configs = useMemo(() => {
    const sorted = blocks.map(b => b.data.slice().sort((a, c) => c[1] - a[1]));
    const max = Math.max(0, ...sorted.flat().map(d => d[1]));
    const axisMax = max > 0 ? Math.ceil(max * 1.12) : 1;
    return blocks.map((b, i) => {
      const opts = { ...bOpts(false, true), indexAxis: 'y', plugins: { legend: { display: false }, datalabels: dlH() } };
      opts.scales = { ...opts.scales, x: { ...opts.scales.x, min: 0, max: axisMax }, y: { ...opts.scales.y, ticks: { font: { size: 12 }, autoSkip: false } } };
      const total = sorted[i].reduce((s, d) => s + d[1], 0);
      return {
        title: titleOf(b, total, sorted[i].length),
        height: heightFor(sorted[i].length, 24),
        cfg: { type: 'bar', options: opts, data: {
          labels: sorted[i].map(d => d[0]),
          datasets: [{ label: unit, data: sorted[i].map(d => d[1]), backgroundColor: palette[i % palette.length], borderRadius: 3 }],
        } },
      };
    });
  }, [blocks, palette, unit, titleOf]);
  return (
    <div className="mini-chart-grid" style={{ gridTemplateColumns: `repeat(${Math.max(blocks.length, 1)},1fr)` }}>
      {configs.map(c => (
        <div className="mini-chart-col" key={c.title}>
          <div className="mini-chart-title">{c.title}</div>
          <ChartBox config={c.cfg} className="ch-wrap tall" height={c.height} />
        </div>
      ))}
    </div>
  );
}

const PREV_DAYS_PALETTE = [TL, GD, NV, PU, GN, RD];
const PREV_CLIENT_PALETTE = [NV, TL, GD, PU, GN, RD];
const titleDays = (b, tot) => `${b.label} · ${fmtNum(Math.round(tot * 100) / 100)} days`;
const titleClients = (b, tot, n) => `${b.label} · ${tot} projects, ${n} clients`;

/* FY picker: the whole tab follows the selected FY (default = the current FY). The inner component is
   remounted per FY so every memo is rebuilt. A closed FY is shown as at its last day (31 Mar). */
export default function OpsLiveDashboard(props) {
  const [viewFy, setViewFy] = useState(CURRENT_FY);
  const [countBy, setCountBy] = useState('projects');
  const fy = Math.min(viewFy, CURRENT_FY);
  return <OpsLiveInner key={`${fy}|${todayISO}`} {...props} viewFy={fy} setViewFy={setViewFy} realFy={CURRENT_FY} realToday={todayISO} countBy={countBy} setCountBy={setCountBy} />;
}

function OpsLiveInner({ engagements, refreshing, viewFy, setViewFy, realFy, realToday, countBy, setCountBy }) {
  const CURRENT_FY = viewFy, pastFy = viewFy < realFy, todayISO = pastFy ? `${viewFy + 1}-03-31` : realToday;
  const unit = countBy === 'projects' ? 'Projects' : 'Sessions';

  // Live rows: usable start date and FY from LIVE_FROM_FY onward
  // Every EC row with a date, or with an Index / S No and dates TBD (counted in the current FY)
  const all = useMemo(() => (engagements || [])
    .filter(e => hasDate(e) || ((clean(e.engagementKey) || clean(e.sno)) && (clean(e.company) || clean(e.topic))))
    .map(e => ({ ...e, fy: hasDate(e) ? fyStartOf(e.startDate) : realFy })), [engagements]);
  const live = useMemo(() => (pastFy ? all : all.filter(e => e.fy >= LIVE_FROM_FY)), [all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useMemo(() => live.filter(e => e.fy === CURRENT_FY), [live]);

  /* Financial Year table: fixed years + live years */
  const fyData = useMemo(() => {
    const del = counter(countBy), up = counter(countBy), ip = counter(countBy), vi = counter(countBy);
    all.forEach(e => {
      if (isDelivered(e)) {
        del.add(e.fy, e);
        const m = modeOf(e);
        if (m === 'inPerson') ip.add(e.fy, e); else if (m === 'virtual') vi.add(e.fy, e);
      } else if (isUpcoming(e)) up.add(e.fy, e);
    });
    const liveRows = [];
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) {
      liveRows.push({ fy: y, inPerson: ip.get(y), virtual: vi.get(y), total: del.get(y), upcoming: up.get(y), live: true });
    }
    const early = OPS_FY.map(b => (del.get(b.fy) > 0 ? { fy: b.fy, inPerson: ip.get(b.fy), virtual: vi.get(b.fy), total: del.get(b.fy), upcoming: 0, live: true } : b));
    return [...early, ...liveRows];
  }, [all, countBy]);

  /* Year-on-year comparison: consultant days / client projects per FY (EC first, baseline when EC has no delivered rows that year) */
  const compare = useMemo(() => {
    const years = [...new Set([...OPS_FY.map(b => b.fy), CURRENT_FY - 2, CURRENT_FY - 1, CURRENT_FY])].filter(y => y >= CURRENT_FY - 3).sort();
    const build = (pick, baseline) => {
      const m = new Map(), from = new Map();
      const put = (name, y, v) => { const k = keyOf(name); if (!m.has(k)) m.set(k, { label: name, v: {} }); const x = m.get(k).v; x[y] = (x[y] || 0) + v; };
      all.forEach(e => { if (years.includes(e.fy) && (isDelivered(e) || (e.fy === CURRENT_FY && isUpcoming(e)))) { from.set(e.fy, true); pick(e).forEach(([n, v]) => put(n, e.fy, v)); } });
      baseline.forEach(b => { const y = Number(String(b.label).match(/\d{4}/)?.[0]); if (years.includes(y) && !from.get(y)) b.data.forEach(([n, v]) => put(n, y, v)); });
      const rows = [...m.values()].map(r => ({ ...r, tot: years.reduce((t, y) => t + (r.v[y] || 0), 0) })).sort((a, b) => b.tot - a.tot).slice(0, 15);
      const pal = [PU, TL, NV, GD];
      return { rows, cfg: { type: 'bar', data: { labels: rows.map(r => r.label), datasets: years.map((y, i) => ({
          label: fyShort(y) + (y === CURRENT_FY ? ' (incl. upcoming)' : ''), data: rows.map(r => Math.round((r.v[y] || 0) * 100) / 100),
          backgroundColor: y === CURRENT_FY ? GD : pal[i % pal.length], borderRadius: 3 })) },
        options: { ...bOpts(false, false), indexAxis: 'y', plugins: { legend: { position: 'top' }, datalabels: { display: false } } } } };
    };
    const seen = new Set();
    return {
      cons: build(e => consultantsOf(e).map(n => [n, daysOf(e)]), OPS_CONSULTANT_PREV),
      cli: build(e => { const n = clean(e.company), id = clean(e.egId) || `row-${e.sno}`; if (!n || seen.has(id + n)) return []; seen.add(id + n); return [[n, 1]]; }, OPS_CLIENT_PREV),
    };
  }, [all]);

  /* Client status — current FY */
  const clients = useMemo(() => {
    const del = counter(countBy), up = counter(countBy), names = new Map();
    cur.forEach(e => {
      const name = clean(e.company); if (!name) return;
      const k = keyOf(name);
      if (isDelivered(e)) { del.add(k, e); names.set(k, names.get(k) || name); }
      else if (isUpcoming(e)) { up.add(k, e); names.set(k, names.get(k) || name); }
    });
    return [...names.entries()].map(([k, label]) => ({ label, delivered: del.get(k), upcoming: up.get(k) }))
      .sort((a, b) => (b.delivered + b.upcoming) - (a.delivered + a.upcoming));
  }, [cur, countBy]);

  /* Consultant days — current FY */
  const trainers = useMemo(() => {
    const m = new Map();
    cur.forEach(e => {
      const kind = isDelivered(e) ? 'dd' : isUpcoming(e) ? 'du' : null;
      if (!kind) return;
      consultantsOf(e).forEach(n => {
        const k = keyOf(n);
        if (!m.has(k)) m.set(k, { label: n, dd: 0, du: 0 });
        m.get(k)[kind] += daysOf(e);
      });
    });
    return [...m.values()].filter(t => t.dd + t.du > 0).sort((a, b) => (b.dd + b.du) - (a.dd + a.du));
  }, [cur]);

  /* Feedback — fixed list from Excel + live scores per program */
  const weekAgo = new Date((pastFy ? Date.parse(`${todayISO}T00:00:00Z`) : Date.now()) - 7 * 864e5).toISOString().slice(0, 10);
  const fbRows = useMemo(() => {
    const rows = all.filter(e => hasDate(e) && (feedbackOf(e) != null || (isDelivered(e) && !fbNA(e) && e.startDate >= weekAgo && e.startDate <= todayISO)))
      .map(e => ({ key: `${e.engagementKey || e.sno}`, label: clean(e.topic) || '(No topic)', client: clean(e.company), date: e.endDate && hasDate({ startDate: e.endDate }) ? e.endDate : e.startDate, score: feedbackOf(e) }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const scored = rows.filter(r => r.score != null);
    const base = scored.length ? [] : OPS_FEEDBACK.map(([label, score]) => ({ key: 'b-' + label, label, client: '', date: '', score }));
    const list = [...rows, ...base], sc = list.filter(r => r.score != null);
    return { list, avg: sc.length ? sc.reduce((t, r) => t + r.score, 0) / sc.length : 0, n: sc.length, week: rows.filter(r => r.date >= weekAgo).length };
  }, [all, weekAgo]);
  const feedback = useMemo(() => {
    const m = new Map();
    OPS_FEEDBACK.forEach(([label, score]) => m.set(keyOf(label), { label, score, n: null, latest: '' }));
    const g = new Map();
    live.forEach(e => {
      const s = feedbackOf(e); if (s == null) return;
      const label = clean(e.topic) || '(No topic)';
      const k = keyOf(label);
      if (!g.has(k)) g.set(k, { label, sum: 0, n: 0, latest: '' });
      const x = g.get(k); x.sum += s; x.n++; if (e.startDate > x.latest) x.latest = e.startDate;
    });
    g.forEach((x, k) => m.set(k, { label: x.label, score: Math.round((x.sum / x.n) * 100) / 100, n: x.n, latest: x.latest }));
    return [...m.values()].sort((a, b) => b.score - a.score);
  }, [live]);

  /* KPIs */
  const curRow = fyData[fyData.length - 1];
  const best = fyData.reduce((b, r) => (r.total > b.total ? r : b), fyData[0]);
  const keyAccount = clients.slice().sort((a, b) => b.upcoming - a.upcoming)[0];

  /* Chart configs */
  const trendCfg = useMemo(() => {
    const sets = [{ label: 'Total Delivered', data: fyData.map(r => r.total), backgroundColor: fyData.map((r, i) => (i === fyData.length - 1 ? GD : TL)), borderRadius: 5 }];
    if (fyData.some(r => r.upcoming > 0)) sets.push({ label: 'Upcoming', data: fyData.map(r => r.upcoming), backgroundColor: PU, borderRadius: 5 });
    return { type: 'bar', data: { labels: fyData.map(r => fyShort(r.fy)), datasets: sets },
      options: { ...bOpts(false, false), layout: { padding: { top: 16 } }, plugins: { legend: { position: 'top' }, datalabels: dlNum() } } };
  }, [fyData]);

  const modeCfg = useMemo(() => ({ type: 'bar',
    data: { labels: fyData.map(r => fyShort(r.fy)), datasets: [
      { label: 'In-Person', data: fyData.map(r => r.inPerson), backgroundColor: NV, borderRadius: 4 },
      { label: 'Virtual', data: fyData.map(r => r.virtual), backgroundColor: TL, borderRadius: 4 },
    ] },
    options: { ...bOpts(false, false), layout: { padding: { top: 16 } }, plugins: { legend: { position: 'top' }, datalabels: dlNum() } },
  }), [fyData]);

  const clientsCfg = useMemo(() => ({ type: 'bar',
    data: { labels: clients.map(c => c.label), datasets: [
      { label: 'Delivered', data: clients.map(c => c.delivered), backgroundColor: NV, borderRadius: 4 },
      { label: 'Upcoming', data: clients.map(c => c.upcoming), backgroundColor: GD, borderRadius: 4 },
    ] },
    options: { ...bOpts(false, false), indexAxis: 'y', plugins: { legend: { position: 'top' }, datalabels: dlH() } },
  }), [clients]);

  const fbCfg = useMemo(() => ({ type: 'bar',
    data: { labels: feedback.map(f => f.label), datasets: [{ label: 'Feedback Score', data: feedback.map(f => f.score),
      backgroundColor: feedback.map(f => (f.score >= 4.5 ? GN : f.score >= 4 ? TL : f.score >= 3 ? GD : RD)), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', layout: { padding: { right: 44 } },
      plugins: { legend: { display: false }, datalabels: { display: true, anchor: 'end', align: 'right', formatter: v => (v > 0 ? v.toFixed(2) : 'N/A'),
        font: { size: 13, weight: '600' }, color: '#374151', clamp: true, padding: { left: 4 } } },
      scales: { x: { min: 0, max: 5, grid: { color: '#EDF0F5' }, ticks: { font: { size: 12 } } }, y: { grid: { display: false }, ticks: { font: { size: 12 }, autoSkip: false } } } },
  }), [feedback]);

  const fbAvg = feedback.length ? feedback.reduce((s, f) => s + f.score, 0) / feedback.length : 0;
  const sDD = trainers.reduce((s, t) => s + t.dd, 0), sDU = trainers.reduce((s, t) => s + t.du, 0);
  const curName = fyLong(CURRENT_FY);
  const r2 = n => fmtNum(Math.round(n * 100) / 100);
  const r2n = n => Math.round(n * 100) / 100;
  // Sessions already over but still Scheduled / Tentative / Re-schedule: counted neither as delivered
  // nor as upcoming until their Status is updated in the Engagement Calendar.
  const staleStatus = live.filter(e => /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status))
    && hasDate(e) && (/^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') ? e.endDate : e.startDate) < todayISO);

  /* ═══════════ Operations intelligence (7 Nov 2026) ═══════════ */
  const [drill, setDrill] = useState(null);
  const show = (title, items, how) => setDrill({ title, items, how });
  const [hist, setHist] = useState(false);
  const addD = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const endOf = e => (hasDate({ startDate: e.endDate }) && e.endDate >= e.startDate ? e.endDate : e.startDate);
  const in30 = addD(todayISO, 30), in7 = addD(todayISO, 7), ago90 = addD(todayISO, -90), ago60 = addD(todayISO, -60);
  const lyToday = `${+todayISO.slice(0, 4) - 1}${todayISO.slice(4)}`;
  const byDate = (a, b) => String(a.startDate || '9').localeCompare(String(b.startDate || '9'));
  const egList = l => l.slice().sort(byDate).map(e => egItem(e));
  const uniq = (l, by = countBy) => (by === 'projects' ? new Set(l.map(e => clean(e.egId) || `row-${e.sno}`)).size : l.length);

  const ops = useMemo(() => {
    const curDel = cur.filter(isDelivered), curUp = cur.filter(isUpcoming);
    const prevDated = all.filter(e => e.fy === CURRENT_FY - 1 && hasDate(e));
    const prevSame = prevDated.filter(e => isDelivered(e) && e.startDate <= lyToday);
    const next30 = live.filter(e => hasDate(e) && !isCancelled(e) && !isDelivered(e) && e.startDate >= todayISO && e.startDate <= in30).sort(byDate);
    const days = l => l.reduce((t, e) => t + daysOf(e), 0);
    const pax = curDel.reduce((t, e) => t + (Number(e.pax) || 0), 0);
    const scoredCur = curDel.filter(e => feedbackOf(e) != null);
    const awaited = curDel.filter(e => feedbackOf(e) == null && !fbNA(e) && hasDate(e) && endOf(e) <= todayISO);
    const cons = new Map(); [...curDel, ...curUp].forEach(e => consultantsOf(e).forEach(n => { const k = keyOf(n); if (!cons.has(k)) cons.set(k, { label: n, d: 0, list: [] }); const c = cons.get(k); c.d += daysOf(e); c.list.push(e); }));
    return { curDel, curUp, prevDated, prevSame, next30, days, pax, scoredCur, awaited, cons: [...cons.values()].sort((a, b) => b.d - a.d) };
  }, [cur, all, live, countBy]);   // eslint-disable-line react-hooks/exhaustive-deps

  const delYtd = uniq(ops.curDel), prevYtd = uniq(ops.prevSame);
  const delta = ops.prevDated.length && prevYtd ? Math.round(((delYtd - prevYtd) / prevYtd) * 100) : null;
  const avgLoad = ops.cons.length ? ops.cons.reduce((t, c) => t + c.d, 0) / ops.cons.length : 0;
  const clientsServed = new Set(ops.curDel.map(e => keyOf(e.company)).filter(Boolean)).size;

  /* Readiness: flags on the next 30 days */
  const ready = useMemo(() => ops.next30.map(e => {
    const f = [], soon = e.startDate <= in7;
    if (!consultantsOf(e).length) f.push(['No consultant', 'r']);
    if (modeOf(e) === 'unknown') f.push(['No location / mode', soon ? 'r' : 'a']);
    if (/tentative/i.test(clean(e.status))) f.push(['Tentative', soon ? 'r' : 'a']);
    if (!(Number(e.price) > 0)) f.push(['No price', 'a']);
    if (!clean(e.egId)) f.push(['No EG ID', 'a']);
    return { e, f, lvl: f.some(x => x[1] === 'r') ? 'r' : f.length ? 'a' : 'g', soon };
  }), [ops.next30]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* Week view: scheduled today → 7 days, delivered in the last 7 days */
  const wkUp = ready.filter(x => x.e.startDate <= in7);
  const wkDone = useMemo(() => live.filter(e => hasDate(e) && isDelivered(e) && e.startDate >= weekAgo && e.startDate <= todayISO)
    .sort((a, b) => b.startDate.localeCompare(a.startDate)), [live]);   // eslint-disable-line react-hooks/exhaustive-deps
  const readyCount = { r: ready.filter(x => x.lvl === 'r').length, a: ready.filter(x => x.lvl === 'a').length, g: ready.filter(x => x.lvl === 'g').length };

  /* Insights — plain-language alerts worked out from the calendar */
  const insights = useMemo(() => {
    const out = [];
    if (staleStatus.length) out.push({ t: 'r', h: `${staleStatus.length} session${staleStatus.length === 1 ? '' : 's'} ended but still marked Scheduled / Tentative`, s: 'Not counted as delivered until the Status is updated', list: () => egList(staleStatus) });
    if (ready.length && readyCount.r) out.push({ t: 'r', h: `${readyCount.r} of the next ${ready.length} sessions are not ready`, s: 'Missing consultant, location or still tentative inside 7 days', list: () => egList(ready.filter(x => x.lvl === 'r').map(x => x.e)) });
    const load = new Map(); ops.next30.forEach(e => consultantsOf(e).forEach(n => { const k = keyOf(n); if (!load.has(k)) load.set(k, { n, d: 0, l: [] }); const x = load.get(k); x.d += daysOf(e); x.l.push(e); }));
    const ld = [...load.values()].sort((a, b) => b.d - a.d), la = ld.length ? ld.reduce((t, x) => t + x.d, 0) / ld.length : 0;
    if (ld[0] && ld[0].d >= 5 && ld[0].d >= la * 1.5) out.push({ t: 'a', h: `${ld[0].n} carries ${r2(ld[0].d)} days in the next 30`, s: `Team average ${r2(la)} days · check for back-to-back travel and fatigue`, list: () => egList(ld[0].l) });
    const last = new Map(), next = new Set();
    live.forEach(e => { const k = keyOf(e.company); if (!k || !hasDate(e)) return; if (isDelivered(e)) { const o = last.get(k); if (!o || e.startDate > o.d) last.set(k, { d: e.startDate, n: clean(e.company), e }); } else if (isUpcoming(e)) next.add(k); });
    const quiet = [...last.entries()].filter(([k, v]) => v.d < ago90 && !next.has(k)).map(([, v]) => v).sort((a, b) => b.d.localeCompare(a.d));
    if (quiet.length) out.push({ t: 'a', h: `${quiet.length} client${quiet.length === 1 ? ' has' : 's have'} gone quiet`, s: `No session in 90 days and none booked · ${quiet.slice(0, 3).map(q => q.n).join(', ')}${quiet.length > 3 ? '…' : ''}`, list: () => quiet.map(q => ({ ...egItem(q.e), right: `last ${fmtDate(q.d)}` })) });
    const aw = ops.awaited.filter(e => endOf(e) >= ago60);
    if (aw.length) out.push({ t: 'a', h: `${aw.length} delivered session${aw.length === 1 ? '' : 's'} awaiting feedback`, s: 'Delivered in the last 60 days with no score in the Feedback column', list: () => egList(aw) });
    const low = feedback.filter(f => f.n && f.score < 4);
    if (low.length) out.push({ t: 'r', h: `Feedback below 4.0 on ${low.length} program${low.length === 1 ? '' : 's'}`, s: low.slice(0, 3).map(f => `${f.label} ${f.score.toFixed(2)}`).join(' · '), list: () => egList(live.filter(e => low.some(f => keyOf(f.label) === keyOf(clean(e.topic) || '(No topic)')) && feedbackOf(e) != null)) });
    if (delta != null) out.push({ t: delta >= 0 ? 'g' : 'a', h: `Delivery ${delta >= 0 ? 'ahead of' : 'behind'} last year by ${Math.abs(delta)}%`, s: `${delYtd} vs ${prevYtd} ${unit.toLowerCase()} by this date in ${fyShort(CURRENT_FY - 1)}`, list: () => egList(ops.curDel) });
    const wk = new Map(); live.forEach(e => { if (!hasDate(e) || isCancelled(e) || isDelivered(e) || e.startDate < todayISO || e.startDate > addD(todayISO, 56)) return; const d = new Date(`${e.startDate}T00:00:00Z`); const m = addD(e.startDate, -((d.getUTCDay() + 6) % 7)); if (!wk.has(m)) wk.set(m, []); wk.get(m).push(e); });
    const busy = [...wk.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (busy && busy[1].length >= 3) out.push({ t: 'n', h: `Busiest week ahead: w/c ${fmtDate(busy[0])}`, s: `${busy[1].length} sessions across ${new Set(busy[1].map(e => keyOf(e.company))).size} clients`, list: () => egList(busy[1]) });
    return out.slice(0, 6);
  }, [staleStatus, ready, readyCount.r, ops, live, feedback, delta, delYtd, prevYtd, unit]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══ 3-year history (7 Nov 2026) — projections removed for now; proj keeps only the monthly history it builds ═══
     (former) Seasonal projection  = Delivered YTD ÷ YTD share, where YTD share = average share of each of the last 3 FYs'
                            delivered volume that had happened by today's date (falls back to days elapsed ÷ 365).
     Booking floor        = Delivered YTD + already booked.   Projected FY = max(seasonal, floor).
     Unbooked remainder   = spread over the remaining months by the last 3 FYs' month pattern.
     Per consultant / client: max(delivered + booked, delivered ÷ YTD share).                                    */
  const MONTHS_FY = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const slotOf = iso => (+iso.slice(5, 7) + 8) % 12;
  const Y3 = [CURRENT_FY - 3, CURRENT_FY - 2, CURRENT_FY - 1];
  const HIST_C = ['#CBD5E1', '#94A3B8', '#475569'];
  const sum = a => a.reduce((t, v) => t + v, 0);
  const delOf = y => all.filter(e => e.fy === y && hasDate(e) && isDelivered(e));
  const proj = useMemo(() => {
    const nowI = slotOf(todayISO), fyS = new Date(`${CURRENT_FY}-04-01T00:00:00Z`), now = new Date(`${todayISO}T00:00:00Z`);
    const frac = +todayISO.slice(8, 10) / new Date(+todayISO.slice(0, 4), +todayISO.slice(5, 7), 0).getDate();
    const monthly = l => MONTHS_FY.map((_, i) => uniq(l.filter(e => hasDate(e) && slotOf(e.startDate) === i)));
    const hist = Y3.map(y => { const m = monthly(delOf(y)); return { fy: y, m, tot: sum(m), days: delOf(y).reduce((t, e) => t + daysOf(e), 0) }; });
    const used = hist.filter(h => h.tot > 0);
    const shareOf = m => (sum(m.slice(0, nowI)) + m[nowI] * frac) / sum(m);
    const share = Math.min(1, Math.max(0.05, used.length ? sum(used.map(h => shareOf(h.m))) / used.length : (now - fyS) / (365 * 864e5)));
    const dM = monthly(ops.curDel), uM = monthly(ops.curUp), dYtd = sum(dM), booked = uniq(ops.curUp);
    const seasonal = dYtd / share, floor = dYtd + booked, projected = Math.round(Math.max(seasonal, floor));
    const w = MONTHS_FY.map((_, i) => (i < nowI ? 0 : used.length ? sum(used.map(h => (h.m[i] * (i === nowI ? 1 - frac : 1)) / Math.max(1, sum(h.m.slice(nowI))))) / used.length : 1));
    const wT = sum(w) || 1, gap = Math.max(0, projected - dYtd);
    const pM = MONTHS_FY.map((_, i) => (i < nowI ? 0 : Math.max(0, Math.round((gap * w[i]) / wT - uM[i]))));
    const ly = hist[2], cagrBase = used.length >= 2 ? used : null;
    const cagr = cagrBase ? Math.pow(cagrBase[cagrBase.length - 1].tot / cagrBase[0].tot, 1 / (cagrBase[cagrBase.length - 1].fy - cagrBase[0].fy)) - 1 : null;
    const dDays = ops.days(ops.curDel), uDays = ops.days(ops.curUp);
    const shares = used.map(h => ({ fy: h.fy, done: sum(h.m.slice(0, nowI)) + h.m[nowI] * frac, tot: h.tot }));
    return { share, seasonal, floor, projected, dM, uM, pM, hist, ly, cagr, shares, w, wT, gap, dYtd, booked, dDays, uDays, nowI, frac, cagrBase, vsLy: ly.tot ? Math.round(((projected - ly.tot) / ly.tot) * 100) : null,
      days: Math.round(Math.max(dDays / share, dDays + uDays) * 10) / 10, histYears: used.length };
  }, [all, ops, countBy]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* Delivery rhythm: this FY delivered + booked + projected, last 3 FYs as lines */
  const rhythm = useMemo(() => {
    const sets = [
      { label: 'Delivered', data: proj.dM, backgroundColor: NV, borderRadius: 3, stack: 's', order: 2 },
      { label: 'Booked', data: proj.uM, backgroundColor: GD, borderRadius: 3, stack: 's', order: 2 },
      ...proj.hist.filter(h => h.tot > 0).map(h => ({ type: 'line', label: fyShort(h.fy), data: h.m, borderColor: HIST_C[Y3.indexOf(h.fy)], backgroundColor: HIST_C[Y3.indexOf(h.fy)],
        borderDash: h.fy === CURRENT_FY - 1 ? undefined : [5, 4], borderWidth: h.fy === CURRENT_FY - 1 ? 2.5 : 1.75, pointRadius: 2, tension: 0.3, order: 1, stack: `fy${h.fy}`, datalabels: { display: false } })),
    ];
    return { type: 'bar', data: { labels: MONTHS_FY, datasets: sets },
      options: { ...bOpts(true, false), layout: { padding: { top: 18 } }, plugins: { legend: { position: 'top', labels: { boxWidth: 12 } }, datalabels: { display: c => c.dataset.type !== 'line' && c.dataset.data[c.dataIndex] > 0, color: '#fff', font: { size: 10, weight: '700' } } } } };
  }, [proj]);

  /* Calendar heatmap: this FY + previous 2 FYs, one below the other */
  const heats = useMemo(() => [CURRENT_FY, CURRENT_FY - 1, CURRENT_FY - 2].map(fy => {
    const fyS = `${fy}-04-01`, fyE = `${fy + 1}-03-31`;
    const d0 = new Date(`${fyS}T00:00:00Z`), start = addD(fyS, -((d0.getUTCDay() + 6) % 7));
    const m = new Map();
    all.forEach(e => { if (e.fy !== fy || !hasDate(e) || isCancelled(e)) return; let d = e.startDate; const end = endOf(e); for (let i = 0; i < 14 && d <= end; i++, d = addD(d, 1)) { if (!m.has(d)) m.set(d, []); m.get(d).push(e); } });
    const cells = []; let d = start;
    while (d <= fyE) { cells.push({ d, l: m.get(d) || [], out: d < fyS }); d = addD(d, 1); }
    const labels = [];
    cells.forEach((c, i) => { if (c.d.slice(8) === '01' && !c.out) labels.push({ w: Math.floor(i / 7), t: MON[+c.d.slice(5, 7) - 1] }); });
    return { fy, cells, weeks: Math.ceil(cells.length / 7), labels, busy: cells.filter(c => c.l.length).length };
  }), [all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const heatWeeks = Math.max(...heats.map(h => h.weeks));
  const heatLvl = n => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);

  /* Consultant load: ranked list — previous 2 FYs as numbers, this FY as one bar (delivered + booked) */
  const load = useMemo(() => {
    const prevDays = y => { const m = new Map(); delOf(y).forEach(e => consultantsOf(e).forEach(n => m.set(keyOf(n), (m.get(keyOf(n)) || 0) + daysOf(e)))); return m; };
    const p1 = prevDays(CURRENT_FY - 1), p2 = prevDays(CURRENT_FY - 2);
    const avg = trainers.length ? trainers.reduce((t, x) => t + x.dd + x.du, 0) / trainers.length : 0;
    const rows = trainers.slice(0, 12).map(t => { const k = keyOf(t.label), tot = t.dd + t.du, ly = p1.get(k) || 0;
      return { k, label: t.label, dd: t.dd, du: t.du, tot, ly, ly2: p2.get(k) || 0, warn: tot >= avg * 1.5 && tot >= 5, trend: ly ? Math.round(((tot - ly) / ly) * 100) : null }; });
    return { avg, rows, max: Math.max(1, avg, ...rows.map(r => r.tot)) };
  }, [trainers, all]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Client portfolio — this FY + last 2 FYs + projection */
  const portfolio = useMemo(() => {
    const prevN = y => { const m = new Map(); delOf(y).forEach(e => { const k = keyOf(e.company); if (k) m.set(k, (m.get(k) || 0) + 1); }); return m; };
    const p1 = prevN(CURRENT_FY - 1), p2 = prevN(CURRENT_FY - 2);
    const m = new Map();
    cur.forEach(e => { if (isCancelled(e)) return; const n = clean(e.company), k = keyOf(n); if (!k) return;
      if (!m.has(k)) m.set(k, { k, name: n, list: [], del: 0, up: 0, days: 0, pax: 0, fb: [], next: '', months: Array(12).fill(0) });
      const c = m.get(k); c.list.push(e); c.days += daysOf(e); c.pax += Number(e.pax) || 0;
      if (isDelivered(e)) { c.del += 1; const f = feedbackOf(e); if (f != null) c.fb.push(f); }
      else if (isUpcoming(e)) { c.up += 1; if (hasDate(e) && (!c.next || e.startDate < c.next)) c.next = e.startDate; }
      if (hasDate(e)) c.months[slotOf(e.startDate)] += 1; });
    return [...m.values()].map(c => { const ly = p1.get(c.k) || 0, tot = c.del + c.up;
      return { ...c, ly, ly2: p2.get(c.k) || 0, tot, trend: ly ? Math.round(((tot - ly) / ly) * 100) : null, fbAvg: c.fb.length ? c.fb.reduce((t, x) => t + x, 0) / c.fb.length : null }; })
      .sort((a, b) => b.tot - a.tot || b.days - a.days);
  }, [cur, all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const showPax = portfolio.some(c => c.pax > 0);
  const [pfSort, setPfSort] = useState('tot');
  const [pfPick, setPfPick] = useState('');
  const pf = useMemo(() => {
    const day = d => new Date(`${d}T00:00:00Z`);
    const rows = portfolio.map(c => {
      const st = !c.ly && !c.ly2 ? 'new' : !c.ly ? 'back' : c.tot > c.ly ? 'grow' : c.tot === c.ly ? 'flat' : c.up ? 'decl' : 'risk';
      const x = c.ly ? c.tot / c.ly : null;
      return { ...c, st, growth: x == null ? null : x >= 2 ? `${Math.round(x * 10) / 10}×` : `${x >= 1 ? '+' : '−'}${Math.abs(Math.round((x - 1) * 100))}%`,
        inDays: c.next ? Math.round((day(c.next) - day(todayISO)) / 864e5) : null };
    });
    const totAll = rows.reduce((t, c) => t + c.tot, 0), top3 = rows.slice(0, 3);
    const is = { grow: c => c.st === 'grow', decl: c => c.st === 'decl' || c.st === 'risk', nobook: c => !c.up, new: c => c.st === 'new' };
    const n = k => rows.filter(is[k]).length;
    return { rows, is, max: Math.max(1, ...rows.map(c => c.tot)), top3, top3Pct: totAll ? Math.round((top3.reduce((t, c) => t + c.tot, 0) / totAll) * 100) : 0,
      n: { grow: n('grow'), decl: n('decl'), nobook: n('nobook'), new: n('new'), risk: rows.filter(c => c.st === 'risk').length, nobookLy: rows.filter(c => !c.up && c.ly).length } };
  }, [portfolio]);
  const pfRows = useMemo(() => {
    const l = pfPick ? pf.rows.filter(pf.is[pfPick]) : pf.rows.slice(), nul = v => (v == null ? 1 : 0);
    if (pfSort === 'drop') l.sort((a, b) => nul(a.trend) - nul(b.trend) || a.trend - b.trend);
    else if (pfSort === 'nobook') l.sort((a, b) => (a.up ? 1 : 0) - (b.up ? 1 : 0) || b.ly - a.ly);
    else if (pfSort === 'fb') l.sort((a, b) => nul(a.fbAvg) - nul(b.fbAvg) || b.fbAvg - a.fbAvg);
    return l;
  }, [pf, pfSort, pfPick]);
  const PF_TAG = { new: ['nw', 'New'], back: ['nw', 'Returning'], grow: ['up', 'Growing'], flat: ['st', 'Steady'], decl: ['dn', 'Declining'], risk: ['rk', 'At risk'] };
  const Yr3 = ({ c }) => { const v = [c.ly2, c.ly, c.tot], mx = Math.max(1, ...v), col = [HIST_C[1], HIST_C[2], NV]; return (
    <svg width="72" height="34" viewBox="0 0 72 34" role="img" aria-label={v.join(' / ')}><title>{`${fyShort(CURRENT_FY - 2)}: ${v[0]} · ${fyShort(CURRENT_FY - 1)}: ${v[1]} · ${fyShort(CURRENT_FY)}: ${v[2]}`}</title>
      {v.map((x, i) => { const h = x ? Math.max(2, (x / mx) * 20) : 1; return <g key={i}><rect x={i * 25} y={33 - h} width="20" height={h} rx="2" fill={col[i]} opacity={x ? 1 : 0.25} /><text x={i * 25 + 10} y={33 - h - 3} textAnchor="middle" fontSize="9" fontWeight="700" fill={x ? '#374151' : '#9CA3AF'}>{x || '–'}</text></g>; })}</svg>); };

  /* Mix by FY — last 3 FYs + this FY (delivered + booked) */
  const mixYears = [...Y3, CURRENT_FY];
  const mixRows = y => (y === CURRENT_FY ? [...ops.curDel, ...ops.curUp] : delOf(y));
  const mixCfg = useMemo(() => {
    const rows = mixYears.map(y => { const l = mixRows(y), ip = l.filter(e => modeOf(e) === 'inPerson').length, vi = l.filter(e => modeOf(e) === 'virtual').length; return { y, n: l.length, ip, vi, un: l.length - ip - vi }; }).filter(r => r.n);
    const pc = (v, n) => (n ? Math.round((v / n) * 1000) / 10 : 0);
    const ds = (label, k, c) => ({ label, data: rows.map(r => pc(r[k], r.n)), raw: rows.map(r => r[k]), backgroundColor: c, borderRadius: 3, stack: 'm' });
    return { rows, cfg: { type: 'bar', data: { labels: rows.map(r => fyShort(r.y) + (r.y === CURRENT_FY ? ' YTD' : '')), datasets: [ds('In-Person', 'ip', NV), ds('Virtual', 'vi', TL), ...(rows.some(r => r.un) ? [ds('Not recorded', 'un', '#CBD5E1')] : [])] },
      options: { ...bOpts(true, false), scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, max: 100, ticks: { callback: v => `${v}%` }, grid: { color: '#EDF0F5' } } },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw}% (${c.dataset.raw[c.dataIndex]})` } },
          datalabels: { display: c => c.dataset.data[c.dataIndex] >= 8, color: '#fff', font: { size: 10, weight: '700' }, formatter: v => `${Math.round(v)}%` } } } } };
  }, [ops, all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fyAvg = y => { const l = (y === CURRENT_FY ? cur : all.filter(e => e.fy === y)).filter(e => feedbackOf(e) != null); return l.length ? l.reduce((t, e) => t + feedbackOf(e), 0) / l.length : null; };

  /* Program quality — only the signal: score, trend, spread, best / at-risk programs, low-score flags */
  const quality = useMemo(() => {
    const sc = cur.filter(e => feedbackOf(e) != null), avgOf = l => (l.length ? l.reduce((t, e) => t + feedbackOf(e), 0) / l.length : null);
    const prev = avgOf(all.filter(e => e.fy === CURRENT_FY - 1 && feedbackOf(e) != null));
    const BANDS = [['4.8 – 5', 4.8, 5.01, 'g'], ['4.5 – 4.7', 4.5, 4.8, 'g'], ['4 – 4.4', 4, 4.5, 't'], ['3 – 3.9', 3, 4, 'a'], ['Below 3', 0, 3, 'r']]
      .map(([lb, a, b, c]) => { const l = sc.filter(e => feedbackOf(e) >= a && feedbackOf(e) < b); return { lb, c, l, n: l.length }; });
    const g = new Map(); sc.forEach(e => { const lb = clean(e.topic) || '(No topic)', k = keyOf(lb); if (!g.has(k)) g.set(k, { lb, l: [] }); g.get(k).l.push(e); });
    const progs = [...g.values()].map(x => ({ ...x, avg: avgOf(x.l) }));
    return { sc, avg: avgOf(sc), prev, bands: BANDS, max: Math.max(1, ...BANDS.map(b => b.n)), hi: sc.length ? Math.round((sc.filter(e => feedbackOf(e) >= 4.5).length / sc.length) * 100) : null,
      top: progs.filter(x => x.avg >= 4.5).sort((a, b) => b.avg - a.avg || b.l.length - a.l.length).slice(0, 3),
      risk: progs.filter(x => x.avg < 4).sort((a, b) => a.avg - b.avg).slice(0, 3),
      flags: sc.filter(e => feedbackOf(e) < 4).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).slice(0, 4) };
  }, [cur, all]);   // eslint-disable-line react-hooks/exhaustive-deps
  const qTone = v => (v == null ? '' : v >= 4.5 ? 'g' : v >= 4 ? 't' : v >= 3 ? 'a' : 'r');

  const Spark = ({ v }) => { const mx = Math.max(1, ...v); return (
    <svg width="96" height="18" viewBox="0 0 96 18" aria-hidden="true">{v.map((x, i) => <rect key={i} x={i * 8} y={18 - (x / mx) * 16 - 1} width="6" height={(x / mx) * 16 + 1} rx="1" fill={i <= slotOf(todayISO) ? NV : GD} opacity={x ? 1 : 0.18} />)}</svg>); };

  return (
    <div className="erd ops" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Operations</h2><p>Delivery readiness, capacity, client activity &amp; quality — {curName}</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward from the Engagement Calendar`} fixed="earlier years (History section) from Dashboard Report Data (12 Oct 2026)" />

      <div className="erd-bar">
        <label>Count by</label>
        <div className="erd-seg">
          {[['projects', 'Projects (EG ID)'], ['sessions', 'Sessions']].map(([k, l]) => (
            <button key={k} type="button" className={countBy === k ? 'on' : ''} aria-pressed={countBy === k} onClick={() => setCountBy(k)}>{l}</button>
          ))}
        </div>
        <label>Financial year</label>
        <div className="erd-seg">
          {[realFy - 2, realFy - 1, realFy].map(y => (
            <button key={y} type="button" className={viewFy === y ? 'on' : ''} aria-pressed={viewFy === y} onClick={() => setViewFy(y)}>{fyShort(y)}{y === realFy ? ' · current' : ''}</button>
          ))}
        </div>
        {refreshing && <span style={{ fontSize: 13, color: '#00808C', fontWeight: 700 }}>⟳ Updating…</span>}
      </div>
      {pastFy && <div className="op-fy-note">Viewing <b>{fyLong(viewFy)}</b> as a closed year (as at 31 Mar {viewFy + 1}). "This FY" on every card means {fyShort(viewFy)}; comparisons use the FYs before it. <button type="button" onClick={() => setViewFy(realFy)}>Back to {fyShort(realFy)}</button></div>}

      <div className="kg g6">
        <Kpi tone="nv" label={`Delivered · ${fyShort(CURRENT_FY)}`} list={() => egList(ops.curDel)} value={delYtd}
          sub={delta != null ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs ${prevYtd} by this date last FY` : `${unit.toLowerCase()} completed this FY`} tag={delta != null ? (delta >= 0 ? 'Ahead' : 'Behind') : undefined} tagTone={delta >= 0 ? 'up' : 'bad'}
          how={`Status = Delivered, start date in this FY, counted once per ${countBy === 'projects' ? 'EG ID' : 'calendar row'}; compared with last FY's delivered rows up to the same date.`} />
        <Kpi tone="tl" label="Training Days" list={() => egList(ops.curDel)} value={r2(ops.days(ops.curDel))} sub={`${r2(ops.days(ops.curUp))} days booked ahead`} how="Sum of the Day column of this FY's delivered sessions (once per session, not per consultant)." />
        <Kpi tone="gn" label={ops.pax ? 'Participants Trained' : 'Clients Served'} list={() => egList(ops.curDel)} value={ops.pax ? fmtNum(ops.pax) : clientsServed} sub={ops.pax ? `${clientsServed} clients served` : 'with a delivered session this FY'} how={ops.pax ? 'Sum of No of Participants on delivered sessions this FY.' : 'Distinct companies with a delivered session this FY (No of Participants is not filled in the calendar).'} />
        <Kpi tone="gd" label="Next 30 Days" list={() => egList(ops.next30)} value={ops.next30.length} sub={`${ops.next30.filter(e => e.startDate <= in7).length} this week · ${r2(ops.days(ops.next30))} days`} tag={readyCount.r ? `${readyCount.r} not ready` : undefined} tagTone="bad" how="Sessions starting today → 30 days ahead that are not cancelled / delivered." />
        <Kpi tone="pu" label="Feedback Avg" list={() => egList(ops.scoredCur)} value={ops.scoredCur.length ? (ops.scoredCur.reduce((t, e) => t + feedbackOf(e), 0) / ops.scoredCur.length).toFixed(2) : '--'} sub={`${ops.scoredCur.length} scored · ${ops.awaited.length} awaited`} how="Average Feedback (0–5) of this FY's delivered sessions; awaited = delivered with no score yet. Feedback = N/A means not required — excluded from both." />
        <Kpi tone="rd" label="Consultant Load" list={() => ops.cons.map(c => ({ name: c.label, sub: `${c.list.length} sessions`, right: `${r2(c.d)} days` }))} value={ops.cons.length} sub={ops.cons.length ? `avg ${r2(avgLoad)} days · top ${ops.cons[0].label} ${r2(ops.cons[0].d)}` : 'no consultants this FY'} how="Consultants with delivered or booked days this FY; days credited to every consultant on the session." />
      </div>

      {insights.length > 0 && (
        <div className="op-ins">
          {insights.map((x, i) => (
            <button key={i} type="button" className={`op-in ${x.t}`} onClick={() => show(x.h, x.list, x.s)}>
              <span className="op-in-dot" /><span className="op-in-tx"><b>{x.h}</b><em>{x.s}</em></span>
            </button>
          ))}
        </div>
      )}

      <div className="cg c11">
        <div className="card"><div className="sl-head"><div><h3>Scheduled — Upcoming Week</h3><div className="cs">{wkUp.length} sessions · today → {fmtDate(in7)} · tap a row for details</div></div>
          <div className="op-rc"><span className="r">{wkUp.filter(x => x.lvl === 'r').length} not ready</span><span className="a">{wkUp.filter(x => x.lvl === 'a').length} check</span><span className="g">{wkUp.filter(x => x.lvl === 'g').length} ready</span></div></div>
          {wkUp.length === 0 ? <div className="erd-empty">Nothing scheduled in the next 7 days</div> : (
            <div className="tbl-x" style={{ maxHeight: 360, overflowY: 'auto', marginTop: 10 }}>
              <table className="mt op-rt">
                <thead><tr><th></th><th>Date</th><th>Client</th><th>Program</th><th>Consultants</th><th>Mode</th><th className="nr">Days</th><th>Flags</th></tr></thead>
                <tbody>{wkUp.map(({ e, f, lvl }, i) => (
                  <tr key={(e.engagementKey || e.sno || '') + '-' + i} className="sl-click" onClick={() => show(`${clean(e.company)} · ${fmtDate(e.startDate)}`, [egItem(e)], f.length ? `Flags: ${f.map(x => x[0]).join(', ')}` : 'Ready — consultant, location and status in place.')}>
                    <td><span className={`op-lv ${lvl}`} /></td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(e.startDate)}{endOf(e) !== e.startDate ? ` – ${+endOf(e).slice(8)}` : ''}</td>
                    <td style={{ fontWeight: 600 }}>{clean(e.company) || '—'}</td><td>{clean(e.topic) || '—'}</td>
                    <td>{consultantsOf(e).join(', ') || <span className="op-miss">—</span>}</td>
                    <td>{{ inPerson: 'In-Person', virtual: 'Virtual', unknown: '—' }[modeOf(e)]}</td>
                    <td className="nr">{r2(daysOf(e))}</td>
                    <td>{f.length ? f.map(x => <span key={x[0]} className={`op-fl ${x[1]}`}>{x[0]}</span>) : <span className="op-fl g">Ready</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card"><div className="sl-head"><div><h3>Delivered — Last Week</h3><div className="cs">{wkDone.length} sessions · {fmtDate(weekAgo)} → today · {r2(ops.days(wkDone))} days · tap a row for details</div></div></div>
          {wkDone.length === 0 ? <div className="erd-empty">No sessions delivered in the last 7 days</div> : (
            <div className="tbl-x" style={{ maxHeight: 360, overflowY: 'auto', marginTop: 10 }}>
              <table className="mt op-rt">
                <thead><tr><th>Date</th><th>Client</th><th>Program</th><th>Consultants</th><th>Mode</th><th className="nr">Days</th><th className="nr">Feedback</th></tr></thead>
                <tbody>{wkDone.map((e, i) => (
                  <tr key={(e.engagementKey || e.sno || '') + '-' + i} className="sl-click" onClick={() => show(`${clean(e.company)} · ${fmtDate(e.startDate)}`, [egItem(e)], 'Delivered in the last 7 days.')}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDate(e.startDate)}{endOf(e) !== e.startDate ? ` – ${+endOf(e).slice(8)}` : ''}</td>
                    <td style={{ fontWeight: 600 }}>{clean(e.company) || '—'}</td><td>{clean(e.topic) || '—'}</td>
                    <td>{consultantsOf(e).join(', ') || '—'}</td>
                    <td>{{ inPerson: 'In-Person', virtual: 'Virtual', unknown: '—' }[modeOf(e)]}</td>
                    <td className="nr">{r2(daysOf(e))}</td>
                    <td className="nr">{feedbackOf(e) != null ? feedbackOf(e) : fbNA(e) ? 'N/A' : <span className="op-miss">awaited</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Delivery Rhythm — last 3 FYs vs {fyShort(CURRENT_FY)}</h3><div className="cs">{unit} per month · bars = this FY delivered and booked · lines = previous FYs delivered</div>
          <ChartBox config={rhythm} className="ch-wrap tall" title="Delivery rhythm" how="Delivered = Status Delivered, Booked = Scheduled / Tentative / Re-schedule from today. Lines = previous FYs' delivered sessions by start month."
            listFor={(lb, ds) => { const i = MONTHS_FY.indexOf(lb); const y = /^\d{4}/.test(ds) ? Y3.find(v => fyShort(v) === ds) : null;
              const pool = y ? delOf(y) : /^deliv/i.test(ds) ? ops.curDel : /^book/i.test(ds) ? ops.curUp : []; return egList(pool.filter(e => hasDate(e) && slotOf(e.startDate) === i)); }} /></div>
        <div className="card"><div className="sl-head"><div><h3>Program Quality — {curName}</h3><div className="cs">{quality.sc.length} scored sessions · {ops.awaited.length} awaiting a score · only what needs attention is flagged</div></div>
          {ops.awaited.length > 0 && <button type="button" className="op-fl a sl-click" style={{ border: 0, font: 'inherit', fontSize: 12 }} onClick={() => show('Awaiting feedback', egList(ops.awaited), 'Delivered this FY with no score in the Feedback column.')}>{ops.awaited.length} awaiting feedback</button>}</div>
          {quality.avg == null ? <div className="erd-empty">No feedback scores this FY yet</div> : (
            <div className="op-q h2">
              <div className="op-q-score">
                <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#EEF1F5" strokeWidth="12" />
                  <circle cx="60" cy="60" r="50" fill="none" className={`op-q-ring ${qTone(quality.avg)}`} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(quality.avg / 5) * 314} 314`} transform="rotate(-90 60 60)" /></svg>
                <div className="op-q-num"><b>{quality.avg.toFixed(2)}</b><span>out of 5</span></div>
                <div className="op-q-sub">{quality.prev != null && <span className={quality.avg >= quality.prev ? 'up' : 'dn'}>{quality.avg >= quality.prev ? '▲' : '▼'} {Math.abs(quality.avg - quality.prev).toFixed(2)} vs {fyShort(CURRENT_FY - 1)}</span>}
                  {quality.hi != null && <span>{quality.hi}% scored 4.5+</span>}</div>
                <div className="op-q-yrs">{[CURRENT_FY - 3, CURRENT_FY - 2, CURRENT_FY - 1].map(y => { const a = fyAvg(y); return a == null ? null : <span key={y} className={qTone(a)}>{fyShort(y)} <b>{a.toFixed(2)}</b></span>; })}</div>
              </div>
              <div className="op-q-dist">
                <div className="sl-sub">Score spread</div>
                {quality.bands.map(b => (
                  <div key={b.lb} className={`op-q-band${b.n ? ' sl-click' : ''}`} onClick={b.n ? () => show(`Feedback ${b.lb}`, egList(b.l), 'Delivered sessions this FY with a score in this band.') : undefined}>
                    <span className="op-q-lb">{b.lb}</span><span className="op-q-tr"><i className={b.c} style={{ width: `${(b.n / quality.max) * 100}%` }} /></span><span className="op-q-n">{b.n}</span>
                  </div>))}
              </div>
              <div className="op-q-lists">
                <div className="sl-sub">Needs attention</div>
                {quality.risk.length === 0 ? <div className="op-q-ok">✓ No program averaging below 4.0</div> : quality.risk.map(x => (
                  <div key={x.lb} className="op-q-row r sl-click" onClick={() => show(x.lb, egList(x.l), 'Scored sessions of this program this FY.')}><span>{x.lb}</span><b>{x.avg.toFixed(2)}</b><em>{x.l.length}×</em></div>))}
                {quality.flags.length > 0 && <div className="op-q-flags">{quality.flags.map((e, i) => (
                  <span key={i} className="op-fl r sl-click" onClick={() => show(`${clean(e.company)} · ${clean(e.topic)}`, [egItem(e)], 'Session scored below 4.0.')}>{clean(e.company)} · {feedbackOf(e).toFixed(1)}</span>))}</div>}
                <div className="sl-sub" style={{ marginTop: 12 }}>Top performers</div>
                {quality.top.length === 0 ? <div className="op-q-ok muted">No program averaging 4.5+ yet</div> : quality.top.map(x => (
                  <div key={x.lb} className="op-q-row g sl-click" onClick={() => show(x.lb, egList(x.l), 'Scored sessions of this program this FY.')}><span>{x.lb}</span><b>{x.avg.toFixed(2)}</b><em>{x.l.length}×</em></div>))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Session Calendar — {fyShort(CURRENT_FY - 2)} → {fyShort(CURRENT_FY)}</h3><div className="cs">Each square = a day · shade = sessions running · this FY on top, previous two FYs below · tap a day</div>
          <div className="op-hm-wrap">
            {heats.map(h => (
              <div className="op-hm-yr" key={h.fy}>
                <div className="op-hm-fy"><b>{fyShort(h.fy)}</b><span>{h.busy} active days</span></div>
                <div>
                  <div className="op-hm-m" style={{ gridTemplateColumns: `repeat(${heatWeeks}, 1fr)` }}>{h.labels.map(x => <span key={x.t + x.w} style={{ gridColumn: x.w + 1 }}>{x.t}</span>)}</div>
                  <div className="op-hm" style={{ gridTemplateColumns: `repeat(${heatWeeks}, 1fr)` }}>
                    {h.cells.map(c => <i key={c.d} className={`l${c.out ? 'x' : heatLvl(c.l.length)}${c.d === todayISO ? ' now' : ''}${c.l.length ? ' sl-click' : ''}`} title={c.out ? '' : `${fmtDate(c.d)} · ${c.l.length} session${c.l.length === 1 ? '' : 's'}`}
                      onClick={c.l.length ? () => show(`Sessions on ${fmtDate(c.d)}`, egList(c.l), 'Sessions running on this day (start → end date).') : undefined} />)}
                  </div>
                </div>
              </div>))}
            <div className="op-hm-lg">Less {[0, 1, 2, 3, 4].map(n => <i key={n} className={`l${n}`} />)} More <span>· outlined = today</span></div>
          </div>
        </div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Consultant Load — {fyShort(CURRENT_FY - 2)} → {fyShort(CURRENT_FY)}</h3><div className="cs">Days per consultant · top {load.rows.length} this FY · avg {r2(load.avg)} days · ⚠ = 1.5× average · tap a row for sessions</div>
          {load.rows.length === 0 ? <div className="erd-empty">No consultant days yet</div> : (
            <div className="op-ld-list">
              <div className="op-ld op-ld-hd"><span>Consultant</span><span className="r">{fyShort(CURRENT_FY - 2)}</span><span className="r">{fyShort(CURRENT_FY - 1)}</span><span>{fyShort(CURRENT_FY)} · delivered + booked</span><span className="r">Total</span></div>
              {load.rows.map(r => (
                <div key={r.k} className="op-ld sl-click" onClick={() => show(`${r.label} · ${fyShort(CURRENT_FY)}`, egList([...ops.curDel, ...ops.curUp].filter(e => consultantsOf(e).some(c => keyOf(c) === r.k))), 'This FY\'s delivered and booked sessions for the consultant. Day column credited to every consultant on the session.')}>
                  <span className="op-ld-nm" title={r.label}>{r.warn && <b className="op-ld-w">⚠</b>}{r.label}</span>
                  <span className="r op-dim">{r.ly2 ? r2(r.ly2) : '—'}</span><span className="r op-dim">{r.ly ? r2(r.ly) : '—'}</span>
                  <span className="op-ld-track"><span className="op-ld-fill">
                    {r.dd > 0 && <i style={{ width: `${(r.dd / load.max) * 100}%`, background: NV }} title={`${r2(r.dd)} days delivered`}>{r.dd / load.max >= 0.08 ? r2(r.dd) : ''}</i>}
                    {r.du > 0 && <i style={{ width: `${(r.du / load.max) * 100}%`, background: GD }} title={`${r2(r.du)} days booked`}>{r.du / load.max >= 0.08 ? r2(r.du) : ''}</i>}</span>
                    <u style={{ left: `${(load.avg / load.max) * 100}%` }} title={`Average ${r2(load.avg)} days`} /></span>
                  <span className="r op-ld-tot">{r2(r.tot)}{r.trend != null ? <span className={`op-tr ${r.trend >= 0 ? 'up' : 'dn'}`}>{r.trend >= 0 ? '▲' : '▼'}{Math.abs(r.trend)}%</span> : !r.ly2 && <span className="op-tr nw">new</span>}</span>
                </div>))}
              <div className="op-ld-lg"><i style={{ background: NV }} />Delivered <i style={{ background: GD }} />Booked <u />Average · ▲▼ vs {fyShort(CURRENT_FY - 1)}</div>
            </div>)}
        </div>
        <div className="card flex-card"><h3>Delivery Mode — by FY</h3><div className="cs">% In-Person vs Virtual · last 3 FYs delivered · this FY delivered + booked</div>
          {mixCfg.rows.length ? <ChartBox config={mixCfg.cfg} className="ch-wrap s-fill" title="Delivery mode" how="Location VILT / Virtual / Online → Virtual, any other place → In-Person. Bars show % of the year's sessions; tooltip shows the count."
            listFor={(lb, ds) => { const y = mixYears.find(v => String(lb).startsWith(fyShort(v))); const k = { 'In-Person': 'inPerson', Virtual: 'virtual', 'Not recorded': 'unknown' }[ds]; return y ? egList(mixRows(y).filter(e => modeOf(e) === k)) : []; }} /> : <div className="erd-empty">No sessions yet</div>}
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><div className="sl-head"><div><h3>Client Portfolio — 3-year view</h3><div className="cs">{portfolio.length} active clients · sessions per FY · this FY = done + booked, compared with the full last FY · tap a tile to filter, a row for sessions</div></div>
          <div className="erd-seg">{[['tot', 'Most sessions'], ['drop', 'Biggest drop'], ['nobook', 'Nothing booked'], ['fb', 'Best feedback']].map(([k, lb]) => <button key={k} type="button" className={pfSort === k ? 'on' : ''} onClick={() => setPfSort(k)}>{lb}</button>)}</div></div>
          {portfolio.length === 0 ? <div className="erd-empty">No clients yet</div> : (<>
            <div className="op-pf-tiles">
              <div className="op-pf-tile"><span>Top 3 clients</span><b>{pf.top3Pct}%</b><em>of this FY's sessions · {pf.top3.map(c => c.name).join(', ')}</em></div>
              {[['grow', 'Growing', pf.n.grow, `${pf.n.decl} declining vs ${fyShort(CURRENT_FY - 1)}`], ['decl', 'Declining', pf.n.decl, `${pf.n.risk} at risk — nothing booked`],
                ['nobook', 'Nothing booked', pf.n.nobook, `${pf.n.nobookLy} had sessions last FY`], ['new', 'New this FY', pf.n.new, 'no sessions in the last 2 FYs']].map(([k, lb, n, sub]) => (
                <button key={k} type="button" className={`op-pf-tile sl-click${pfPick === k ? ' on' : ''}`} onClick={() => setPfPick(pfPick === k ? '' : k)}><span>{lb}</span><b className={k === 'grow' ? 'g' : k === 'new' ? '' : n ? 'r' : ''}>{n}</b><em>{sub}</em></button>))}
            </div>
            <div className="tbl-x"><div className="op-pf-list">
              <div className="op-pf op-pf-hd"><span>Client</span><span title="Sessions per FY">{[2, 1, 0].map(d => `FY${String(CURRENT_FY - d).slice(2)}`).join(' · ')}</span><span>This FY · done + booked</span><span className="r">vs last FY</span><span className="r">Feedback</span><span>Next session</span><span className="op-pf-mh">{MONTHS_FY.map((m, i) => <i key={i}>{m[0]}</i>)}</span></div>
              {pfRows.length === 0 ? <div className="erd-empty">No clients in this filter</div> : pfRows.map(c => (
                <div key={c.name} className="op-pf sl-click" onClick={() => show(`${c.name} · ${fyShort(CURRENT_FY)}`, egList(c.list), 'This FY\'s sessions for the client (cancelled / on hold excluded).')}>
                  <span className="op-pf-nm"><b title={c.name}>{c.name}</b><span className={`op-tr ${PF_TAG[c.st][0]}`}>{PF_TAG[c.st][1]}</span></span>
                  <span><Yr3 c={c} /></span>
                  <span className="op-pf-fy"><span className="op-pf-bar"><span className="op-ld-track"><span className="op-ld-fill">
                    {c.del > 0 && <i style={{ width: `${(c.del / pf.max) * 100}%`, background: NV }} title={`${c.del} done`}>{c.del / pf.max >= 0.07 ? c.del : ''}</i>}
                    {c.up > 0 && <i style={{ width: `${(c.up / pf.max) * 100}%`, background: GD }} title={`${c.up} booked`}>{c.up / pf.max >= 0.07 ? c.up : ''}</i>}</span></span><b>{c.tot}</b></span>
                    <em>{c.del} done · {c.up} booked · {r2(c.days)} days{showPax && c.pax ? ` · ${c.pax} pax` : ''}</em></span>
                  <span className={`r op-pf-gr ${c.st === 'grow' ? 'g' : c.st === 'decl' || c.st === 'risk' ? 'r' : ''}`}>{c.growth || '—'}</span>
                  <span className="r">{c.fbAvg != null ? <span className={`op-fl ${c.fbAvg >= 4.5 ? 'g' : c.fbAvg >= 4 ? 'n' : 'r'}`}>{c.fbAvg.toFixed(2)}</span> : c.del ? <span className="op-fl m">awaited</span> : <span className="op-dim">—</span>}</span>
                  <span className="op-pf-nx">{c.next ? <><b>{fmtDate(c.next)}</b><em>{c.inDays <= 0 ? 'today' : c.inDays === 1 ? 'tomorrow' : `in ${c.inDays} days`}</em></> : c.ly ? <span className="op-fl r">none booked</span> : <span className="op-dim">none booked</span>}</span>
                  <span><Spark v={c.months} /></span>
                </div>))}
            </div></div>
          </>)}
        </div>
      </div>

      <div className="card op-hist">
        <button type="button" className="op-hist-h" onClick={() => setHist(h => !h)} aria-expanded={hist}><span>History &amp; year-on-year</span><em>{hist ? 'Hide' : 'Show'} FY trend, delivery mode by FY, consultant and client year-on-year</em><b>{hist ? '−' : '+'}</b></button>
        {hist && (<>
          <div className="cg c11">
            <div className="card"><h3>Project Trend by FY</h3><div className="cs">Total delivered and upcoming per financial year</div><ChartBox config={trendCfg} /></div>
            <div className="card"><h3>Delivery Mode by FY</h3><div className="cs">In-Person vs Virtual</div><ChartBox config={modeCfg} /></div>
          </div>
          <div className="cg c11">
            <div className="card"><h3>Consultant Days — Year on Year</h3><div className="cs">Delivered days per FY (current FY includes upcoming) · top 15</div>
              {compare.cons.rows.length ? <ChartBox config={compare.cons.cfg} height={heightFor(compare.cons.rows.length, 44, 300)} /> : <div className="erd-empty">No consultant data</div>}</div>
            <div className="card"><h3>Client Status — Year on Year</h3><div className="cs">Projects delivered per FY (current FY includes upcoming) · top 15</div>
              {compare.cli.rows.length ? <ChartBox config={compare.cli.cfg} height={heightFor(compare.cli.rows.length, 44, 300)} /> : <div className="erd-empty">No client data</div>}</div>
          </div>
        </>)}
      </div>
      {drill && <KpiListModal title={drill.title} items={drill.items} how={drill.how} onClose={() => setDrill(null)} />}
    </div>
  );
}
