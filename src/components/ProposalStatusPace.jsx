/**
 * Monthly Status & Pace — shared by the Sales (proposals) and Solutioning (solution items) dashboards. 19 Nov 2026.
 *
 * Each unit counts ONCE, in its own month, by its status (count + full value):
 *   Proposals       latest version of each Proposal ID. A single-version Lost proposal = Lost (count + value).
 *                   Replaced versions (V1 → V2) are not counted again.
 *   Solution items  unique Proposal ID + Solution Topic (highest version that carries it). Status = its proposal's
 *                   latest status; a topic dropped in a later version = Lost.
 * Commercial loss (revised) — value chart only, never Lost: units of a multi-version proposal whose latest version
 *   is Won, valued at first version sent − won version (V1 10,000 → V2 won 8,000 = 2,000), in the won version's month.
 * Use proposalPace() / itemPace() to build { records, revised }.
 */
import { useMemo } from 'react';
import { ChartBox, GN, RD, GD, TL, bOpts, dlStack, dlStackInr, fmtInr, fmtShort, inrAxis, CURRENT_FY, fyLong, fyTiny, todayISO, clean } from './erdCharts.jsx';
import { monthSlot } from './proposalData.js';
import { LIVE_FROM_FY, SOL_BASELINE } from '../config/dashboardBaseline.js';

const MONTHS = ['April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const CL = '#A61B1B';   // commercial loss — dark red (Lost is RD)
const CL_LABEL = 'Commercial loss (revised)';
const stOf = ds => (/won/i.test(ds) ? 'closed' : /revised|commercial/i.test(ds) ? 'revised' : /lost/i.test(ds) ? 'lost' : 'process');
// Stacked labels only where the segment is tall enough to hold them — thin segments (e.g. a small commercial loss) stay unlabelled, shown on hover
// Segment height in pixels from the y scale (bar elements are still animating when labels are decided)
const segPx = ctx => { const sc = ctx.chart.scales.y, v = Number(ctx.dataset.data[ctx.dataIndex]) || 0; return sc ? Math.abs(sc.getPixelForValue(0) - sc.getPixelForValue(v)) : 99; };
const fitLabel = dl => ({ ...dl, display: ctx => Number(ctx.dataset.data[ctx.dataIndex]) > 0 && segPx(ctx) >= 16 });
// Thin segments: label beside the bar, joined to the segment by a short leader line (labels spaced so they never overlap)
const sideLabels = fmt => ({
  id: 'sideLabels',
  afterDatasetsDraw(chart) {
    const sc = chart.scales.y, c = chart.ctx; if (!sc) return;
    const n = chart.data.labels.length;
    for (let i = 0; i < n; i++) {
      const items = [];
      chart.data.datasets.forEach((ds, di) => {
        if (ds.type === 'line' || !chart.isDatasetVisible(di)) return;
        const v = Number(ds.data[i]) || 0, el = chart.getDatasetMeta(di).data[i];
        if (!v || !el || Math.abs(sc.getPixelForValue(0) - sc.getPixelForValue(v)) >= 16) return;
        const { x, y, base, width } = el.getProps(['x', 'y', 'base', 'width'], true);
        items.push({ cy: (y + base) / 2, x, w: width, text: fmt(v), color: ds.backgroundColor });
      });
      if (!items.length) continue;
      items.sort((a, b) => b.cy - a.cy);                       // bottom segment first
      const left = i === n - 1, gap = 15;
      let prev = Infinity;
      items.forEach(it => { it.ly = Math.min(it.cy, prev - gap); prev = it.ly; });
      c.save();
      c.font = '700 11px Inter, system-ui, sans-serif'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      items.forEach(it => {
        const dir = left ? -1 : 1, x0 = it.x + dir * (it.w / 2), x1 = x0 + dir * 8, x2 = x1 + dir * 6;
        c.strokeStyle = it.color; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(x0, it.cy); c.lineTo(x1, it.ly); c.lineTo(x2, it.ly); c.stroke();
        c.textAlign = left ? 'right' : 'left';
        c.lineWidth = 3; c.strokeStyle = '#fff'; c.strokeText(it.text, x2 + dir * 2, it.ly);
        c.fillStyle = it.color === GD ? '#B7791F' : it.color; c.fillText(it.text, x2 + dir * 2, it.ly);
      });
      c.restore();
    }
  },
});
const wonLower = (a, b) => `Won at lower price (V${a} → V${b})`;

/** Proposals: lines from buildProposalLines (.value set); fullKey = 'bdFull' | 'solFull'. */
export function proposalPace(lines, fullKey = 'bdFull') {
  const all = lines || [], first = new Map();
  all.forEach(p => { const f = first.get(p.id); if (!f || p.version < f.version) first.set(p.id, p); });
  const records = all.filter(p => p.isLatest);
  const revised = records.filter(p => p.versionCount > 1 && p.pipeline === 'closed').map(p => {
    // Compare on the dashboard's own value; when either version lacks it (older lines without a per-version BD value),
    // fall back to the other value source so every month is covered.
    const v1 = first.get(p.id), keys = [fullKey, fullKey === 'bdFull' ? 'solFull' : 'bdFull'];
    const k = keys.find(x => Number(v1?.[x]) > 0 && Number(p[x]) > 0);
    const loss = k ? Math.max(0, Number(v1[k]) - Number(p[k])) : 0;
    return loss > 0 ? { ...p, value: loss, bdValue: loss, solValue: loss, quotedValue: loss, status: wonLower(v1.version, p.version) } : null;
  }).filter(Boolean);
  return { records, revised };
}

/** Solution items: rawItems (every version's item rows) and items (unique, highest version carrying the topic). */
export function itemPace(rawItems, items) {
  const tk = it => `${it.id}|${clean(it.topic).toLowerCase().replace(/\s+/g, ' ')}`;
  // First version that carries each topic, and that version's row values in order (a topic can sit on 2+ rows)
  const firstV = new Map(), firstVals = new Map();
  (rawItems || []).forEach(it => { const k = tk(it); if (!firstV.has(k) || it.version < firstV.get(k)) firstV.set(k, it.version); });
  (rawItems || []).forEach(it => { const k = tk(it); if (it.version === firstV.get(k)) { if (!firstVals.has(k)) firstVals.set(k, []); firstVals.get(k).push(it.value || 0); } });
  const records = (items || []).map(it => (it.isLatest ? it : { ...it, pipeline: 'lost', status: `Dropped in a later version (last in V${it.version})` }));
  // Won items whose topic was first sent in an earlier version: pair rows in order (1st with 1st …);
  // if the row count changed, the whole topic's drop (first total − won total) goes on its first row.
  const wonRows = new Map();
  (items || []).filter(it => it.isLatest && it.pipeline === 'closed' && firstV.get(tk(it)) < it.version)
    .forEach(it => { const k = tk(it); if (!wonRows.has(k)) wonRows.set(k, []); wonRows.get(k).push(it); });
  const revised = [];
  wonRows.forEach((list, k) => {
    const fv = firstVals.get(k) || [], sum = a => a.reduce((t, v) => t + v, 0);
    const losses = fv.length === list.length ? list.map((it, i) => fv[i] - (it.value || 0))
      : list.map((it, i) => (i === 0 ? sum(fv) - sum(list.map(x => x.value || 0)) : 0));
    list.forEach((it, i) => { if (losses[i] > 0) revised.push({ ...it, value: losses[i], solValue: losses[i], status: wonLower(firstV.get(k), it.version) }); });
  });
  return { records, revised };
}

export default function ProposalStatusPace({ records, revised, unit = 'prop', valueName = 'BD Proposal Value', itemOf }) {
  const isItem = unit === 'item', Us = isItem ? 'solution items' : 'proposals';
  const title = isItem ? 'Monthly Solution Items Status & Pace' : 'Monthly Proposal Status & Pace';
  const live = useMemo(() => (records || []).filter(p => p.fy >= LIVE_FROM_FY), [records]);
  const cur = useMemo(() => live.filter(p => p.fy === CURRENT_FY), [live]);
  const rev = useMemo(() => (revised || []).filter(p => p.fy === CURRENT_FY), [revised]);
  const nowIdx = (+todayISO.slice(5, 7) + 8) % 12;

  const rows = useMemo(() => {
    const r = MONTHS.map(month => ({ month, n: 0, wonC: 0, lostC: 0, ipC: 0, revC: 0, wonV: 0, lostV: 0, ipV: 0, revV: 0 }));
    rev.forEach(p => { const x = r[monthSlot(p)]; x.revC++; x.revV += p.value; });
    cur.forEach(p => {
      const x = r[monthSlot(p)]; x.n++;
      if (p.pipeline === 'closed') { x.wonC++; x.wonV += p.value; }
      else if (p.pipeline === 'lost') { x.lostC++; x.lostV += p.value; }
      else { x.ipC++; x.ipV += p.value; }
    });
    return r.filter((x, i) => x.n > 0 || x.revC > 0 || i <= nowIdx);
  }, [cur, rev, nowIdx]);

  const pace = useMemo(() => {
    const prevFy = CURRENT_FY - 1, prevL = live.filter(p => p.fy === prevFy);
    const prev = Array(12).fill(0); let fromReport = false;
    if (prevL.length) prevL.forEach(p => { prev[monthSlot(p)] += 1; });
    else if (!isItem && SOL_BASELINE[prevFy]?.monthly) { SOL_BASELINE[prevFy].monthly.forEach((v, i) => { prev[i] = v; }); fromReport = true; }
    const c = Array(12).fill(0); cur.forEach(p => { c[monthSlot(p)] += 1; });
    const cum = a => a.reduce((o, v, i) => { o.push((o[i - 1] || 0) + v); return o; }, []);
    return { cur: cum(c), prev: cum(prev), prevName: `${fyTiny(prevFy)}${fromReport ? ' (report)' : ''}`, any: prev.some(Boolean) };
  }, [live, cur, isItem]);

  const cfgs = useMemo(() => ['count', 'value'].map(m => {
    const ds = [
      { label: 'Won', data: rows.map(r => (m === 'count' ? r.wonC : r.wonV)), backgroundColor: GN, borderRadius: 3 },
      { label: 'Lost', data: rows.map(r => (m === 'count' ? r.lostC : r.lostV)), backgroundColor: RD, borderRadius: 3 },
      { label: 'In Process', data: rows.map(r => (m === 'count' ? r.ipC : r.ipV)), backgroundColor: GD, borderRadius: 3 },
    ];
    if (m === 'value') ds.push({ label: CL_LABEL, data: rows.map(r => r.revV || null), backgroundColor: CL, borderRadius: 3, minBarLength: 6 });   // small losses stay visible
    const base = m === 'value' ? inrAxis(bOpts(true, false), 'y') : bOpts(true, false);
    const cfg = { type: 'bar', data: { labels: rows.map(r => r.month), datasets: ds }, plugins: [sideLabels(m === 'count' ? v => String(v) : v => fmtShort(v))],
      options: { ...base, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top' }, datalabels: fitLabel(m === 'count' ? dlStack() : dlStackInr()),
        tooltip: { filter: i => Number(i.raw) > 0, callbacks: {
          label: ctx => `${ctx.dataset.label}: ${m === 'count' || ctx.dataset.type === 'line' ? ctx.raw : fmtInr(ctx.raw)}`,
          footer: items => { const r = rows[items[0]?.dataIndex]; return m === 'count' && r?.revC ? `${r.revC} ${Us} won at a lower revised price` : ''; },
        } } } } };
    if (m !== 'count') return { m, cfg };
    const idx = rows.map(r => MONTHS.indexOf(r.month)), last = idx.length - 1;
    const ln = (label, data, color, dash) => ({ type: 'line', label, data, yAxisID: 'y1', borderColor: color, backgroundColor: color, borderWidth: dash ? 2 : 2.5, borderDash: dash ? [6, 4] : undefined,
      pointRadius: dash ? 0 : 3, tension: 0.25, cubicInterpolationMode: 'monotone', order: 0,
      datalabels: { display: x => x.dataIndex === last, align: 'top', color, font: { size: 11, weight: '800' } } });
    ds.push(ln(`${fyTiny(CURRENT_FY)} running total`, idx.map(i => pace.cur[i]), TL));
    if (pace.any) ds.push(ln(`${pace.prevName} running total`, idx.map(i => pace.prev[i]), '#94A3B8', true));
    const o = cfg.options;
    return { m, cfg: { ...cfg, options: { ...o, scales: { ...o.scales,
      y1: { position: 'right', beginAtZero: true, stacked: false, grid: { display: false }, ticks: { precision: 0 }, title: { display: true, text: 'running total', font: { size: 11 } } } } } } };
  }), [rows, pace, Us]);

  const listFor = (lb, ds) => {
    const st = stOf(ds);
    return (st === 'revised' ? rev : cur.filter(p => p.pipeline === st)).filter(p => MONTHS[monthSlot(p)] === lb)
      .sort((a, b) => b.value - a.value).map(itemOf);
  };
  const how = m => (m === 'count'
    ? (isItem
      ? 'Unique solution items (Proposal ID + Solution Topic, once across versions) of this FY in that month, by status: Won / Lost / In Process = status of the latest version that carries the item; an item dropped in a later version = Lost. Running total = April up to that month.'
      : 'Unique proposals of this FY in that month — latest version of each Proposal ID, by BD Status: Won / Closed / Confirmed = Won; Lost / Dropped / Rejected = Lost (a single-version lost proposal counts as Lost); else In Process. Revised versions are not counted again. Running total = April up to that month.')
    : `${valueName} by status. ${CL_LABEL} = only when a revised proposal was Won: first version sent − won version (V1 10,000 → V2 won at 8,000 = 2,000), in the won month — shown on its own, never as Lost.`);
  const revTotal = rev.length;

  return (
    <div className="card"><h3>{title} — {fyLong(CURRENT_FY)}</h3>
      <div className="cs">Won vs Lost vs In-Process per month — Count and Value · each of the {Us} counted once{revTotal ? ` · ${revTotal} won at a lower revised price` : ''} · lines = running total, this FY vs last FY · dark red = commercial loss on revised {Us} that were won</div>
      <div className="cv-pair">
        {cfgs.map(c => (
          <div className="cv-col" key={c.m}><div className="cv-col-title">{c.m === 'count' ? '📊 Count' : '₹ Value'}</div>
            <ChartBox config={c.cfg} title={title} how={how(c.m)} listFor={listFor} className="ch-wrap tall" /></div>
        ))}
      </div>
    </div>
  );
}
