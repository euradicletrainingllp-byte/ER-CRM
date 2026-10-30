/**
 * Solutioning dashboard — same charts and layout as the standalone EuRadicle Dashboard HTML report.
 *
 *   FY 2026-27 onward  → live from the Solution Tracker
 *   FY 2025-26         → fixed numbers from Dashboard Report Data (26 Oct 2026), see dashboardBaseline.js
 *   (the Excel's FY 2026-27 figures are not used — the current year is always live)
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
  const solCur = useMemo(() => {
    const cur = proposals.filter(p => p.fy === CURRENT_FY);
    return { n: cur.reduce((s, p) => s + (p.solCount || 0), 0), v: cur.reduce((s, p) => s + (p.solValue || 0), 0), lines: cur.filter(p => p.solCount > 0).length };
  }, [proposals]);
  const engTotal = mixes.engagementType.reduce((s, r) => s + r.curCount, 0);
  const journey = mixes.engagementType.find(r => /journey/i.test(r.label)) || { curCount: 0 };
  const topInd = mixes.industry.filter(r => r.label !== NR).sort((a, b) => b.curCount - a.curCount)[0];
  const custTotal = mixes.customization.reduce((s, r) => s + r.curCount, 0);
  const custRow = mixes.customization.find(r => /customiz/i.test(r.label)) || { curCount: 0 };

  /* FY pipeline summary */
  const summary = useMemo(() => Object.keys(yearData).map(Number).sort((a, b) => a - b)
    .map(y => ({ y, ...yearData[y].summary })), [yearData]);
  const summCfg = useMemo(() => ({ type: 'bar', data: { labels: summary.map(s => fyTiny(s.y)), datasets: [
    { label: 'Closed', data: summary.map(s => s.closed), backgroundColor: GN, borderRadius: 3 },
    { label: 'Lost', data: summary.map(s => s.lost), backgroundColor: RD, borderRadius: 3 },
    { label: 'In Process', data: summary.map(s => s.process), backgroundColor: GD, borderRadius: 3 },
  ] }, options: { ...bOpts(true, false), plugins: { legend: { position: 'top' }, datalabels: dlStack() } } }), [summary]);
  const pct = (a, t) => (t ? ((a / t) * 100).toFixed(2) : '0.00') + '%';

  const curTiny = fyTiny(CURRENT_FY).slice(3);
  const vs = `${prevLabel} vs ${curLabel}`;

  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Solutioning</h2><p>Proposals, development categories &amp; engagement mix — count and value shown side by side</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward from the Solution Tracker`} fixed="FY 2025-26 from Dashboard Report Data (26 Oct 2026)" />

      <div className="kg g5">
        <Kpi tone="tl" label={`FY ${curTiny} Total Proposals`} value={Cd.summary?.total ?? 0} sub={Cd.summary ? `${Cd.summary.unique} unique proposals${Cd.summary.total > Cd.summary.unique ? ` · ${Cd.summary.total - Cd.summary.unique} revisions` : ''}` : 'Submitted this financial year'} how="Proposal lines (Proposal ID + version) dated in this FY in the Solution Tracker; each revision counts again." />
        <Kpi tone="pu" label={`FY ${curTiny} Solutions`} value={solCur.n} sub={`${fmtShort(solCur.v)} solution value · ${solCur.lines} proposals with solutions`} how="Solution items (Solution Tracker rows with a Solution Topic) on this FY's proposal lines; each revision's items count again. Value = Solution Values." />
        <Kpi tone="gn" label="Journey Engagements" value={journey.curCount} sub={engTotal > 0 ? `${Math.round((journey.curCount / engTotal) * 100)}% of ${engTotal} total` : '--'} tag="Demand shift" tagTone="up" how="This FY's proposals whose Engagement Type is a learning journey ÷ all proposals with an Engagement Type." />
        <Kpi tone="gd" label="Top Industry" value={topInd?.curCount ? topInd.label : '--'} sub={topInd?.curCount ? `${topInd.curCount} opportunities this FY` : 'most active sector'} how="Industry with the most opportunities this FY (one per proposal — revisions merged; blank industry ignored)." />
        <Kpi tone="nv" label="Customization Rate" value={`${custTotal ? Math.round((custRow.curCount / custTotal) * 100) : 0}%`} sub={`${custRow.curCount} of ${custTotal} proposals`} tag="Fully custom" how="Proposals with Program Type = Customized ÷ proposals with a Program Type filled, this FY." />
      </div>

      <SolPair title="Development Category Mix" sub={`${vs} — Count and Value`} rows={mixes.developmentCategory} prevLabel={prevLabel} curLabel={curLabel} trunc={24} />
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
    </div>
  );
}
