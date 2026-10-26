/**
 * Solutioning dashboard — same charts and layout as the standalone EuRadicle Dashboard HTML report.
 *
 *   FY 2026-27 onward  → live from the Solution Tracker
 *   FY 2025-26         → fixed numbers from Dashboard Report Data (12 Oct 2026), see dashboardBaseline.js
 *
 * Live definitions
 *   Proposal       one proposal line = Proposal ID + version, same as the BD Tracker page (a revision counts again,
 *                  in its own month, with its own value)
 *   Opportunity    one BD S No (a row without a BD S No counts by its Proposal ID) — used for Industry
 *   Value          Solution Value → BD Proposal Value (first one filled); "12,50,000", "12.5 L", "1.2 Cr" all work
 *   Proposal date  Date of Discussion → BD Month → Date of Submission to Client → by Sol team → Solution Month
 *   Status         BD Status Won / Closed / Confirmed → Closed · Lost / Dropped / Rejected → Lost · else In Process
 */
import { useMemo } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, TL, GD, GN, RD, PU, bOpts, dlNum, dlInr, dlStack, dlStackInr, dlH, dlInrH, fmtInr, fmtShort, inrAxis, heightFor,
  CURRENT_FY, fyStartOf, fyLong, fyTiny, pad2, clean, keyOf,
} from './erdCharts.jsx';
import { buildProposalLines, monthSlot, uniqueProposals } from './proposalData.js';
import { LIVE_FROM_FY, SOL_BASELINE } from '../config/dashboardBaseline.js';

const NR = 'Not recorded';
const EMPTY = {};
const MONTH_LABELS = ['Apr', 'May', 'June', 'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/** Group live items into [label, count, value]. */
function groupMix(items, pick) {
  const m = new Map();
  items.forEach(it => {
    const label = clean(pick(it)) || NR;
    const k = keyOf(label);
    if (!m.has(k)) m.set(k, [label, 0, 0]);
    const g = m.get(k); g[1] += 1; g[2] += it.value;
  });
  return [...m.values()];
}

/** Merge previous-FY and current-FY mixes by label (case / spacing ignored). */
function mergeMix(prev, cur) {
  const m = new Map();
  const put = (rows, c, v) => (rows || []).forEach(([label, count, value]) => {
    const k = keyOf(label);
    if (!m.has(k)) m.set(k, { label: clean(label), prevCount: 0, prevVal: 0, curCount: 0, curVal: 0 });
    const r = m.get(k); r[c] += count; r[v] += value;
  });
  put(prev, 'prevCount', 'prevVal');
  put(cur, 'curCount', 'curVal');
  return [...m.values()];
}

/** Count chart + Value chart side by side (renderSolPair in the HTML report). */
function SolPair({ title, sub, rows, prevLabel, curLabel, horiz, trunc, small }) {
  const charts = useMemo(() => ['count', 'value'].map(metric => {
    const pick = r => (metric === 'count' ? r.curCount : r.curVal);
    const pickPrev = r => (metric === 'count' ? r.prevCount : r.prevVal);
    const arr = rows.slice().sort((a, b) => (pick(b) - pick(a)) || (pickPrev(b) - pickPrev(a)) || (a.label === NR) - (b.label === NR));
    const labels = arr.map(r => (trunc && r.label.length > trunc ? r.label.substring(0, trunc - 2) + '..' : r.label));
    const dl = metric === 'count' ? (horiz ? dlH() : dlNum()) : (horiz ? dlInrH() : { ...dlInr(), rotation: -90, formatter: v => (v > 0 ? fmtShort(v) : '') });
    const opts = { ...bOpts(false, horiz), layout: { padding: { top: horiz ? 0 : (metric === 'value' ? 56 : 18), right: horiz ? 80 : 0 } },
      plugins: { legend: { position: 'top' }, datalabels: dl, tooltip: { callbacks: {
        title: items => arr[items[0].dataIndex].label,
        label: ctx => `${ctx.dataset.label}: ${metric === 'count' ? ctx.raw : fmtInr(ctx.raw)}`,
      } } } };
    const axis = horiz ? 'y' : 'x';
    opts.scales[axis] = { ...opts.scales[axis], ticks: { font: { size: 12 }, autoSkip: false, maxRotation: horiz ? 0 : 40, minRotation: 0 } };
    if (horiz) opts.indexAxis = 'y';
    if (metric === 'value') inrAxis(opts, horiz ? 'x' : 'y');
    const height = horiz ? heightFor(arr.length, 30) : arr.length > 5 ? Math.max(300, arr.length * 44) : undefined;
    return { metric, height, cfg: { type: 'bar', options: opts, data: { labels, datasets: [
      { label: prevLabel, data: arr.map(pickPrev), backgroundColor: NV, borderRadius: 3 },
      { label: curLabel, data: arr.map(pick), backgroundColor: TL, borderRadius: 3 },
    ] } } };
  }), [rows, prevLabel, curLabel, horiz, trunc]);

  return (
    <div className="cg c1">
      <div className="card">
        <h3>{title}</h3><div className="cs">{sub}</div>
        <div className="cv-pair">
          {charts.map(c => (
            <div className="cv-col" key={c.metric}>
              <div className="cv-col-title">{c.metric === 'count' ? '📊 Count' : '₹ Value'}</div>
              {horiz
                ? <div className="ch-wrap-scroll"><ChartBox config={c.cfg} height={c.height} /></div>
                : <ChartBox config={c.cfg} className={small ? 'ch-wrap sm' : 'ch-wrap'} height={c.height} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SolLiveDashboard({ solutions, refreshing }) {
  /* Live proposals — one per Proposal ID, latest version wins */
  // A proposal has several rows in the Solution Tracker (the BD line + one per solution item).
  // Use the latest version, and for every field take the first row of that version that has it filled.
  // Value = Solution Values only (same as the Solution Tracker — no BD Proposal Value)
  const allProposals = useMemo(() => buildProposalLines(solutions).map(p => ({ ...p, value: p.solValue })), [solutions]);
  const proposals = useMemo(() => allProposals.filter(p => p.fy >= LIVE_FROM_FY), [allProposals]);

  /* Live data check — explains empty charts */
  const check = useMemo(() => {
    const cur = proposals.filter(p => p.fy === CURRENT_FY);
    const miss = k => cur.filter(p => !clean(p[k])).length;
    return {
      total: allProposals.length, unique: uniqueProposals(allProposals), cur: cur.length, curUnique: uniqueProposals(cur), undated: allProposals.filter(p => p.undated).length,
      byFy: Object.entries(allProposals.reduce((m, p) => { m[p.fy] = (m[p.fy] || 0) + 1; return m; }, {})).sort((a, b) => b[0] - a[0]),
      missing: [['Industry', miss('industry')], ['Development Category', miss('developmentCategory')], ['Engagement Type', miss('engagementType')],
        ['Line of Service', miss('lineOfService')], ['Type of Service', miss('typeOfService')], ['Program Type', miss('customization')], ['Value', cur.filter(p => !p.value).length]]
        .filter(([, n]) => n > 0),
    };
  }, [allProposals, proposals]);

  /* Month-wise proposal status — current FY (Sales section of the HTML report) */
  const propStatus = useMemo(() => {
    const cur = proposals.filter(p => p.fy === CURRENT_FY);
    const rows = MONTH_LABELS.map(month => ({ month, n: 0, wonC: 0, lostC: 0, ipC: 0, wonV: 0, lostV: 0, ipV: 0, wonCl: new Set(), ipCl: new Set() }));
    cur.forEach(p => {
      const r = rows[monthSlot(p)];
      r.n++;
      if (p.pipeline === 'closed') { r.wonC++; r.wonV += p.value; if (p.client) r.wonCl.add(p.client); }
      else if (p.pipeline === 'lost') { r.lostC++; r.lostV += p.value; }
      else { r.ipC++; r.ipV += p.value; if (p.client) r.ipCl.add(p.client); }
    });
    const curIdx = (new Date().getMonth() + 1 + 8) % 12;
    return rows.filter((r, i) => r.n > 0 || i <= curIdx);
  }, [proposals]);

  /* Figures for one FY: fixed baseline before LIVE_FROM_FY, live after */
  const yearData = useMemo(() => {
    const out = {};
    Object.entries(SOL_BASELINE).forEach(([y, d]) => { out[y] = d; });
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) {
      const ps = proposals.filter(p => p.fy === y);
      const opps = new Map();
      ps.forEach(p => {
        const o = opps.get(p.oppKey);
        if (!o) opps.set(p.oppKey, { industry: p.industry, value: p.value });
        else { o.value = Math.max(o.value, p.value); if (!o.industry) o.industry = p.industry; }
      });
      const monthly = Array(12).fill(0);
      ps.forEach(p => { monthly[monthSlot(p)] += 1; });
      out[y] = {
        summary: { total: ps.length, unique: uniqueProposals(ps), closed: ps.filter(p => p.pipeline === 'closed').length,
          lost: ps.filter(p => p.pipeline === 'lost').length, process: ps.filter(p => p.pipeline === 'process').length },
        industry: groupMix([...opps.values()], o => o.industry),
        lineOfService: groupMix(ps, p => p.lineOfService),
        typeOfService: groupMix(ps, p => p.typeOfService),
        developmentCategory: groupMix(ps, p => p.developmentCategory),
        engagementType: groupMix(ps, p => p.engagementType),
        customization: groupMix(ps, p => p.customization),
        monthly,
      };
    }
    return out;
  }, [proposals]);

  const prevFy = CURRENT_FY - 1;
  const P = yearData[prevFy] || EMPTY, Cd = yearData[CURRENT_FY] || EMPTY;
  const prevLabel = fyLong(prevFy), curLabel = fyLong(CURRENT_FY);
  const mixes = useMemo(() => Object.fromEntries(
    ['industry', 'lineOfService', 'typeOfService', 'developmentCategory', 'engagementType', 'customization']
      .map(k => [k, mergeMix(P[k], Cd[k])])), [P, Cd]);

  /* KPIs */
  const engTotal = mixes.engagementType.reduce((s, r) => s + r.curCount, 0);
  const journey = mixes.engagementType.find(r => /journey/i.test(r.label)) || { curCount: 0 };
  const topInd = mixes.industry.filter(r => r.label !== NR).sort((a, b) => b.curCount - a.curCount)[0];
  const custTotal = mixes.customization.reduce((s, r) => s + r.curCount, 0);
  const custRow = mixes.customization.find(r => /customiz/i.test(r.label)) || { curCount: 0 };

  /* Monthly trend: previous FY (bars + dashed line) vs current FY (bars + line), future months blank */
  const trendCfg = useMemo(() => {
    const prev = P.monthly || Array(12).fill(0);
    const now = new Date(); const curIdx = (now.getMonth() + 1 + 8) % 12;
    const cur = (Cd.monthly || Array(12).fill(0)).map((v, i) => (i <= curIdx ? v : null));
    const sum = a => a.reduce((s, v) => s + (v || 0), 0);
    return { type: 'bar', data: { labels: MONTH_LABELS, datasets: [
      { type: 'bar', label: `${prevLabel} (total ${sum(prev)})`, data: prev, backgroundColor: 'rgba(27,42,74,0.55)', borderColor: NV, borderWidth: 1, borderRadius: 3, order: 4, datalabels: { display: false } },
      { type: 'bar', label: `${curLabel} (total ${sum(cur)})`, data: cur, backgroundColor: 'rgba(0,128,140,0.55)', borderColor: TL, borderWidth: 1, borderRadius: 3, order: 3, datalabels: { display: false } },
      { type: 'line', label: `${prevLabel} trend`, data: prev, borderColor: NV, borderWidth: 2.5, borderDash: [5, 4], fill: false, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: NV, spanGaps: false, order: 2,
        datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'start', align: 'bottom', formatter: v => (v > 0 ? v : ''), font: { size: 11, weight: '700' }, color: NV, padding: 2 } },
      { type: 'line', label: `${curLabel} trend`, data: cur, borderColor: TL, borderWidth: 2.5, fill: false, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: TL, spanGaps: false, order: 1,
        datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, anchor: 'end', align: 'top', formatter: v => (v > 0 ? v : ''), font: { size: 11, weight: '700' }, color: TL, padding: 2 } },
    ] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 14 } },
      plugins: { legend: { position: 'top' }, datalabels: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 12 } } }, y: { beginAtZero: true, grid: { color: '#EDF0F5' }, ticks: { font: { size: 12 } } } } } };
  }, [P, Cd, prevLabel, curLabel]);

  /* FY pipeline summary */
  const summary = useMemo(() => Object.keys(yearData).map(Number).sort((a, b) => a - b)
    .map(y => ({ y, ...yearData[y].summary })), [yearData]);
  const summCfg = useMemo(() => ({ type: 'bar', data: { labels: summary.map(s => fyTiny(s.y)), datasets: [
    { label: 'Closed', data: summary.map(s => s.closed), backgroundColor: GN, borderRadius: 3 },
    { label: 'Lost', data: summary.map(s => s.lost), backgroundColor: RD, borderRadius: 3 },
    { label: 'In Process', data: summary.map(s => s.process), backgroundColor: GD, borderRadius: 3 },
  ] }, options: { ...bOpts(true, false), plugins: { legend: { position: 'top' }, datalabels: dlStack() } } }), [summary]);
  const pct = (a, t) => (t ? ((a / t) * 100).toFixed(2) : '0.00') + '%';

  /* Industry Breakdown — side table (current FY) */
  const indCur = useMemo(() => mixes.industry.filter(r => r.curCount > 0)
    .sort((a, b) => b.curCount - a.curCount || b.curVal - a.curVal), [mixes]);
  const indCfg = useMemo(() => ({ type: 'bar',
    data: { labels: indCur.map(r => r.label), datasets: [{ label: 'Count', data: indCur.map(r => r.curCount), backgroundColor: PU, borderRadius: 3 }] },
    options: { ...bOpts(false, true), indexAxis: 'y', plugins: { legend: { display: false }, datalabels: dlH(),
      tooltip: { callbacks: { afterLabel: ctx => `Value: ${fmtInr(indCur[ctx.dataIndex].curVal)}` } } } },
  }), [indCur]);

  /* Monthly Proposal Status — stacked count + value */
  const propCfgs = useMemo(() => ['count', 'value'].map(m => ({ m, cfg: { type: 'bar',
    data: { labels: propStatus.map(r => r.month), datasets: [
      { label: 'Won', data: propStatus.map(r => (m === 'count' ? r.wonC : r.wonV)), backgroundColor: GN, borderRadius: 3 },
      { label: 'Lost', data: propStatus.map(r => (m === 'count' ? r.lostC : r.lostV)), backgroundColor: RD, borderRadius: 3 },
      { label: 'In Process', data: propStatus.map(r => (m === 'count' ? r.ipC : r.ipV)), backgroundColor: GD, borderRadius: 3 },
    ] },
    options: { ...(m === 'value' ? inrAxis(bOpts(true, false), 'y') : bOpts(true, false)), plugins: { legend: { position: 'top' }, datalabels: m === 'count' ? dlStack() : dlStackInr(),
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${m === 'count' ? ctx.raw : fmtInr(ctx.raw)}` } } } },
  } })), [propStatus]);

  /* Proposal Funnel (YTD) — doughnut by value */
  const tot = useMemo(() => propStatus.reduce((t, r) => ({
    n: t.n + r.n, wonC: t.wonC + r.wonC, lostC: t.lostC + r.lostC, ipC: t.ipC + r.ipC,
    wonV: t.wonV + r.wonV, lostV: t.lostV + r.lostV, ipV: t.ipV + r.ipV,
  }), { n: 0, wonC: 0, lostC: 0, ipC: 0, wonV: 0, lostV: 0, ipV: 0 }), [propStatus]);
  const funnelCfg = useMemo(() => {
    const colors = [GN, RD, GD];
    const pc = (v, all) => (all > 0 ? ((v / all) * 100).toFixed(1) : '0.0');
    return { type: 'doughnut',
      data: { labels: ['Won', 'Lost', 'In Process'], datasets: [{ data: [tot.wonV, tot.lostV, tot.ipV], backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '52%', layout: { padding: { top: 28, bottom: 52, left: 40, right: 40 } },
        plugins: {
          legend: { position: 'top', labels: { padding: 12, font: { size: 12 }, generateLabels: chart => {
            const ds = chart.data.datasets[0]; const all = ds.data.reduce((a, b) => a + b, 0);
            return chart.data.labels.map((label, i) => ({ text: `${label} — ${pc(ds.data[i], all)}%`, fillStyle: ds.backgroundColor[i], strokeStyle: ds.backgroundColor[i], lineWidth: 0, index: i }));
          } } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtInr(ctx.raw)}` } },
          datalabels: { display: true, anchor: 'end', align: 'end', offset: 10, clamp: false, color: ctx => colors[ctx.dataIndex], font: { size: 13, weight: '700' },
            formatter: (v, ctx) => { const all = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0); return v > 0 ? [fmtInr(v), `(${pc(v, all)}%)`] : ''; } },
        } } };
  }, [tot]);

  const curTiny = fyTiny(CURRENT_FY).slice(3);
  const vs = `${prevLabel} vs ${curLabel}`;

  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Solutioning</h2><p>Proposals, industry traction &amp; engagement mix — count and value shown side by side</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward from the Solution Tracker`} fixed="FY 2025-26 from Dashboard Report Data (12 Oct 2026)" />

      <div className="kg g4">
        <Kpi tone="tl" label={`FY ${curTiny} Total Proposals`} value={Cd.summary?.total ?? 0} sub={Cd.summary ? `${Cd.summary.unique} unique proposals${Cd.summary.total > Cd.summary.unique ? ` · ${Cd.summary.total - Cd.summary.unique} revisions` : ''}` : 'Submitted this financial year'} />
        <Kpi tone="gn" label="Journey Engagements" value={journey.curCount} sub={engTotal > 0 ? `${Math.round((journey.curCount / engTotal) * 100)}% of ${engTotal} total` : '--'} tag="Demand shift" tagTone="up" />
        <Kpi tone="gd" label="Top Industry" value={topInd?.curCount ? topInd.label : '--'} sub={topInd?.curCount ? `${topInd.curCount} opportunities this FY` : 'most active sector'} />
        <Kpi tone="nv" label="Customization Rate" value={`${custTotal ? Math.round((custRow.curCount / custTotal) * 100) : 0}%`} sub={`${custRow.curCount} of ${custTotal} proposals`} tag="Fully custom" />
      </div>

      <SolPair title="Development Category Mix" sub={`${vs} — Count and Value`} rows={mixes.developmentCategory} prevLabel={prevLabel} curLabel={curLabel} trunc={24} />
      <SolPair title="Industry Traction" sub={`Opportunities by sector — ${vs} — Count and Value`} rows={mixes.industry} prevLabel={prevLabel} curLabel={curLabel} horiz />

      <div className="cg c1">
        <div className="card"><h3>Industry Breakdown — Side Table</h3>
          <div className="cs">{curLabel} opportunities by industry from the Solution Tracker · Total: {indCur.reduce((s, r) => s + r.curCount, 0)} / {fmtInr(indCur.reduce((s, r) => s + r.curVal, 0))}</div>
          {indCur.length ? (
            <div className="cv-pair">
              <div className="cv-col"><ChartBox config={indCfg} height={heightFor(indCur.length, 26)} /></div>
              <div className="cv-col"><div style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table className="mt">
                  <thead><tr><th>Industry</th><th className="nr">Count</th><th className="nr">Value (Rs.)</th></tr></thead>
                  <tbody>
                    {indCur.map(r => <tr key={r.label}><td style={{ fontWeight: 600 }}>{r.label}</td><td className="nr">{r.curCount}</td><td className="nr" style={{ whiteSpace: 'nowrap' }}>{fmtInr(r.curVal)}</td></tr>)}
                    <tr className="tot"><td>Total</td><td className="nr">{indCur.reduce((s, r) => s + r.curCount, 0)}</td><td className="nr">{fmtInr(indCur.reduce((s, r) => s + r.curVal, 0))}</td></tr>
                  </tbody>
                </table>
              </div></div>
            </div>
          ) : <div className="erd-empty">No {curLabel} opportunities in the Solution Tracker yet</div>}
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Monthly Proposal Trend</h3><div className="cs">New proposals submitted per month — {prevLabel} vs {curLabel}</div><ChartBox config={trendCfg} /></div>
      </div>

      <SolPair title="Type of Engagement" sub={`Standalone vs Journey — ${vs} — Count and Value`} rows={mixes.engagementType} prevLabel={prevLabel} curLabel={curLabel} small />
      <SolPair title="Line of Service Mix" sub={`${vs} by service line — Count and Value`} rows={mixes.lineOfService} prevLabel={prevLabel} curLabel={curLabel} />
      <SolPair title="Type of Service Mix" sub={`${vs} by service type — Count and Value`} rows={mixes.typeOfService} prevLabel={prevLabel} curLabel={curLabel} trunc={24} />
      <SolPair title="Customization Mix" sub="Customized vs Standard vs New Creation — by FY — Count and Value" rows={mixes.customization} prevLabel={prevLabel} curLabel={curLabel} small />

      <div className="cg c1">
        <div className="card"><h3>FY Pipeline Summary</h3><div className="cs">Closed vs Lost vs In Process comparison</div>
          <ChartBox config={summCfg} className="ch-wrap xs" />
          <table className="mt" style={{ marginTop: 10 }}>
            <thead><tr><th>FY</th><th className="nr">Total</th><th className="nr">Closed</th><th className="nr">Lost</th><th className="nr">In Process</th><th className="nr">Closed %</th><th className="nr">Lost %</th><th className="nr">In Process %</th></tr></thead>
            <tbody>{summary.map(s => (
              <tr key={s.y}><td>{fyTiny(s.y)}</td><td className="nr">{s.total}</td><td className="nr">{s.closed}</td><td className="nr">{s.lost}</td><td className="nr">{s.process}</td>
                <td className="nr">{pct(s.closed, s.total)}</td><td className="nr">{pct(s.lost, s.total)}</td><td className="nr">{pct(s.process, s.total)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Proposal Status — {curLabel}</h3><div className="cs">Month-wise proposal breakdown with client names</div>
          <div className="tbl-x"><table className="mt">
            <thead><tr><th>Month</th><th className="nr">No. of Proposals</th><th className="nr">Won (Count)</th><th className="nr">Lost (Count)</th><th className="nr">In Process (Count)</th>
              <th className="nr">Won Value (Rs.)</th><th className="nr">Lost Value (Rs.)</th><th className="nr">In Process Value (Rs.)</th><th>Won Clients</th><th>In Process Clients</th></tr></thead>
            <tbody>
              {propStatus.map(r => (
                <tr key={r.month}><td style={{ fontWeight: 600 }}>{r.month}</td><td className="nr">{r.n}</td>
                  <td className="nr" style={{ color: GN }}>{r.wonC}</td><td className="nr" style={{ color: RD }}>{r.lostC}</td><td className="nr" style={{ color: GD }}>{r.ipC}</td>
                  <td className="nr">{fmtInr(r.wonV)}</td><td className="nr">{fmtInr(r.lostV)}</td><td className="nr">{fmtInr(r.ipV)}</td>
                  <td style={{ fontSize: 12 }}>{[...r.wonCl].join(', ')}</td><td style={{ fontSize: 12 }}>{[...r.ipCl].join(', ')}</td></tr>
              ))}
              <tr className="tot"><td>Total</td><td className="nr">{tot.n}</td><td className="nr" style={{ color: GN }}>{tot.wonC}</td><td className="nr" style={{ color: RD }}>{tot.lostC}</td><td className="nr" style={{ color: GD }}>{tot.ipC}</td>
                <td className="nr">{fmtInr(tot.wonV)}</td><td className="nr">{fmtInr(tot.lostV)}</td><td className="nr">{fmtInr(tot.ipV)}</td><td /><td /></tr>
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Monthly Proposal Status — {curLabel}</h3><div className="cs">Won vs Lost vs In-Process, stacked per month — Count and Value</div>
          <div className="cv-pair">
            {propCfgs.map(c => (
              <div className="cv-col" key={c.m}><div className="cv-col-title">{c.m === 'count' ? '📊 Count' : '₹ Value'}</div><ChartBox config={c.cfg} /></div>
            ))}
          </div>
        </div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Proposal Funnel (YTD)</h3><div className="cs">Won vs Lost vs In-Process by value</div>
          {tot.wonV + tot.lostV + tot.ipV > 0 ? <ChartBox config={funnelCfg} /> : <div className="erd-empty">No proposal values recorded in {curLabel} yet</div>}
        </div>
        <div className="card"><h3>Live Data Check — Solution Tracker</h3><div className="cs">How the Solution Tracker rows are counted — month = Date of Discussion, else BD Month (same as the BD Tracker page)</div>
          <table className="mt">
            <tbody>
              <tr><td>Proposal lines in the Solution Tracker (each version counts, as on the BD Tracker)</td><td className="nr">{check.total}</td></tr>
              <tr><td>Unique Proposal IDs</td><td className="nr">{check.unique}</td></tr>
              <tr><td>Counted in {curLabel} (lines · unique)</td><td className="nr">{check.cur} · {check.curUnique}</td></tr>
              <tr><td>No date at all — counted in {curLabel} (fill Date of Discussion)</td><td className="nr" style={{ color: check.undated ? RD : undefined }}>{check.undated}</td></tr>
              {check.byFy.map(([y, n]) => (
                <tr key={y}><td>Proposals dated in {fyLong(+y)}{+y < LIVE_FROM_FY ? ' (shown in the fixed Excel figures instead)' : ''}</td><td className="nr">{n}</td></tr>
              ))}
              {check.missing.map(([k, n]) => (
                <tr key={k}><td>{curLabel} proposals with blank <strong>{k}</strong> (shown as "Not recorded")</td><td className="nr" style={{ color: RD }}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
