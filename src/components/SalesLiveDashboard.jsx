/**
 * Sales dashboard — same charts and layout as the Sales tab of the standalone EuRadicle Dashboard HTML report.
 *
 * Sources
 *   Proposals, funnel, pipeline, order booked     → BD Tracker (BD lines of the Solution Tracker), live
 *     counted like the BD Tracker page: every proposal line (V1, V2 …) in its own month, count and value
 *     alike; order book and pipeline list use the latest version only (see proposalData.js)
 *   Monthly / quarterly revenue, targets achieved  → Engagement Calendar "Price (INR)", live, by session start month
 *   Clients engaged per FY                         → Engagement Calendar, live from FY 2026-27
 *   Earlier years (quarterly revenue, client list) → fixed, Dashboard Report Data (12 Oct 2026)
 *
 * Revenue counts every session that is not Cancelled / Lost / Dropped / Postponed / On hold
 * (the Excel did the same — e.g. its Q3 figure includes scheduled November sessions).
 * The Monthly Revenue chart splits that into Delivered and Scheduled.
 */
import { useMemo, useState, useEffect } from 'react';
import {
  ChartBox, Kpi, SourceNote, NV, TL, GD, GN, PU, RD, bOpts, dlInr, dlStack, dlStackInr, dlInrH, fmtInr, fmtShort, inrAxis, heightFor,
  CURRENT_FY, fyStartOf, fyLong, fyTiny, todayISO, clean, keyOf,
} from './erdCharts.jsx';
import { buildProposalLines, monthSlot, uniqueProposals } from './proposalData.js';
import KpiListModal, { egItem, propItem, inrS } from './KpiListModal.jsx';
import { getPOs, peekPOs, poConfigured, poUsage, poStatus } from '../services/poApi.js';
import SalesClients from './SalesClients.jsx';

import { LIVE_FROM_FY, SALES_QUARTERLY_REVENUE, SALES_TARGETS, SALES_CLIENT_ENGAGEMENT, SALES_NEW_CLIENTS } from '../config/dashboardBaseline.js';

const MONTHS = ['April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const monthIdx = iso => (+iso.slice(5, 7) + 8) % 12;          // Apr = 0 … Mar = 11
const NOT_REVENUE = /cancel|lost|drop|postpon|hold/i;
const isDelivered = e => /^delivered$/i.test(clean(e.status));

/** Client name → comparison key ("DBS Bank" = "DBS", "AirIndia" = "Air India", "SocGen" = "Societe Generale"). */
const ALIAS = { socgen: 'societegenerale', amli: 'axismaxlife', zscalar: 'zscaler', vendanta: 'vedanta' };
function clientKey(name) {
  let k = keyOf(name).replace(/\b(bank|insurance|ltd|limited|pvt|private|india|group|inc|llp|co)\b/g, '').replace(/[^a-z0-9]/g, '');
  return ALIAS[k] || k;
}
const tokens = s => keyOf(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length > 2);
function topicMatch(a, b) {
  const ta = tokens(a), tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return false;
  return ta.filter(w => tb.has(w)).length / Math.min(ta.length, tb.size) >= 0.5;
}

export default function SalesLiveDashboard({ solutions, engagements, refreshing }) {
  const curQ = Math.floor(monthIdx(todayISO) / 3);              // 0 = Q1 (Apr–Jun) — read each render
  // Proposal lines (each version counts, in its own month) — same logic as the BD Tracker page
  // Value = BD Proposal Value only (same as the BD Tracker — no fallback to Solution Values)
  const allLines = useMemo(() => buildProposalLines(solutions).map(p => ({ ...p, value: p.bdValue })), [solutions]);
  const proposals = useMemo(() => allLines.filter(p => p.fy >= LIVE_FROM_FY), [allLines]);
  const curProps = useMemo(() => proposals.filter(p => p.fy === CURRENT_FY), [proposals]);
  const [drill, setDrill] = useState(null);
  const show = (title, items, how) => setDrill({ title, items, how });
  const stOf = ds => (/won/i.test(ds) ? 'closed' : /lost/i.test(ds) ? 'lost' : 'process');
  const qOf = e => Math.floor(monthIdx(e.startDate) / 3);

  // Engagement Calendar sessions that count as revenue
  const sessions = useMemo(() => (engagements || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || '') && !NOT_REVENUE.test(clean(e.status)))
    .map(e => ({ ...e, fy: fyStartOf(e.startDate), price: Number(e.price) || 0 })), [engagements]);

  /* ── Proposal status by month (current FY) ── */
  const propStatus = useMemo(() => {
    const rows = MONTHS.map(month => ({ month, n: 0, wonC: 0, lostC: 0, ipC: 0, wonV: 0, lostV: 0, ipV: 0, wonCl: new Set(), ipCl: new Set() }));
    curProps.forEach(p => {
      const r = rows[monthSlot(p)];
      r.n++;
      if (p.pipeline === 'closed') { r.wonC++; r.wonV += p.value; if (p.client) r.wonCl.add(p.client); }
      else if (p.pipeline === 'lost') { r.lostC++; r.lostV += p.value; }
      else { r.ipC++; r.ipV += p.value; if (p.client) r.ipCl.add(p.client); }
    });
    const nowIdx = monthIdx(todayISO);
    return rows.filter((r, i) => r.n > 0 || i <= nowIdx);
  }, [curProps]);
  const tot = useMemo(() => propStatus.reduce((t, r) => ({
    n: t.n + r.n, wonC: t.wonC + r.wonC, lostC: t.lostC + r.lostC, ipC: t.ipC + r.ipC, wonV: t.wonV + r.wonV, lostV: t.lostV + r.lostV, ipV: t.ipV + r.ipV,
  }), { n: 0, wonC: 0, lostC: 0, ipC: 0, wonV: 0, lostV: 0, ipV: 0 }), [propStatus]);

  /* ── Revenue from the Engagement Calendar ── */
  const revenue = useMemo(() => {
    const byFy = {};
    sessions.forEach(e => {
      if (!byFy[e.fy]) byFy[e.fy] = { months: MONTHS.map(() => ({ delivered: 0, scheduled: 0, clients: new Map() })) };
      const m = byFy[e.fy].months[monthIdx(e.startDate)];
      if (isDelivered(e)) m.delivered += e.price; else m.scheduled += e.price;
      const c = clean(e.company);
      if (c && e.price) m.clients.set(c, (m.clients.get(c) || 0) + e.price);
    });
    return byFy;
  }, [sessions]);
  const curMonths = revenue[CURRENT_FY]?.months || MONTHS.map(() => ({ delivered: 0, scheduled: 0, clients: new Map() }));
  const quarterOf = fy => {
    if (fy < LIVE_FROM_FY) return SALES_QUARTERLY_REVENUE[fy] || null;
    const ms = revenue[fy]?.months; if (!ms) return [0, 0, 0, 0];
    return [0, 1, 2, 3].map(q => ms.slice(q * 3, q * 3 + 3).reduce((s, m) => s + m.delivered + m.scheduled, 0));
  };
  const monthRows = useMemo(() => MONTHS.map((month, i) => ({ month, ...curMonths[i], total: curMonths[i].delivered + curMonths[i].scheduled }))
    .filter((r, i) => r.total > 0 || i <= monthIdx(todayISO)), [curMonths]);

  /* ── Targets vs achieved (current FY) ── */
  const targets = useMemo(() => {
    const t = SALES_TARGETS[CURRENT_FY] || [null, null, null, null];
    const ach = quarterOf(CURRENT_FY);
    return [0, 1, 2, 3].map(q => ({ q: `Q${q + 1}`, target: t[q], achieved: ach[q], pct: t[q] ? (ach[q] / t[q]) * 100 : 0, live: q === curQ }))
      .filter(r => r.target || r.achieved);
  }, [revenue]);   // eslint-disable-line react-hooks/exhaustive-deps
  const curTarget = targets.find(t => t.live);
  const fyTarget = (SALES_TARGETS[CURRENT_FY] || []).reduce((t, v) => t + (v || 0), 0);
  const fyAchieved = quarterOf(CURRENT_FY).reduce((t, v) => t + v, 0);

  /* ── Order book from the PO Tracker: PO value vs linked Engagement Calendar sessions (Index) ── */
  const [pos, setPos] = useState(() => peekPOs() || []);
  useEffect(() => { if (poConfigured()) getPOs().then(setPos).catch(() => {}); }, []);
  const poBook = useMemo(() => pos.filter(po => Number(po.value) > 0).map(po => {
    const u = poUsage(po, engagements || []), st = poStatus(po, u);
    const delivered = u.rows.filter(isDelivered).reduce((t, e) => t + (Number(e.price) || 0), 0);
    return { po, st, u, booked: Number(po.value), delivered, confirmed: u.used, balance: u.balance };
  }).filter(r => r.st !== 'Closed').sort((a, b) => b.balance - a.balance || b.booked - a.booked), [pos, engagements]);
  /* Fallback when no POs are recorded: Won proposals (BD Tracker) vs Engagement Calendar sessions */
  const orderBookWon = useMemo(() => {
    const won = proposals.filter(p => p.isLatest && p.pipeline === 'closed');
    const rows = won.map(p => ({ p, booked: p.value, delivered: 0, confirmed: 0, curFy: p.fy === CURRENT_FY }));
    sessions.forEach(e => {
      const link = clean(e.proposalLink);
      let row = link ? rows.find(r => r.p.link && r.p.link === link) : null;
      if (!row) {
        const ck = clientKey(e.company);
        const sameClient = rows.filter(r => ck && (clientKey(r.p.client) === ck || clientKey(r.p.client).includes(ck) || ck.includes(clientKey(r.p.client))));
        row = sameClient.find(r => topicMatch(r.p.topic, e.topic)) || (sameClient.length === 1 && !clean(sameClient[0].p.topic) ? sameClient[0] : null);
      }
      if (!row) return;
      row.confirmed += e.price;
      if (isDelivered(e)) row.delivered += e.price;
      if (e.fy === CURRENT_FY) row.curFy = true;
    });
    return rows.filter(r => r.curFy && r.booked > 0)
      .map(r => ({ ...r, balance: r.booked - r.confirmed }))
      .sort((a, b) => b.booked - a.booked);
  }, [proposals, sessions]);
  const usePo = true;   // PO Tracker only — no fallback to proposals
  const orderBook = poBook; void orderBookWon;
  const ob = orderBook.reduce((t, r) => ({ booked: t.booked + r.booked, delivered: t.delivered + r.delivered, confirmed: t.confirmed + r.confirmed, balance: t.balance + r.balance }),
    { booked: 0, delivered: 0, confirmed: 0, balance: 0 });

  /* ── Expected major pipeline: every open (In Process) proposal in the BD Tracker, latest version, any date ── */
  const pipelineAll = useMemo(() => allLines.filter(p => p.isLatest && p.pipeline === 'process')
    .sort((a, b) => (b.value || 0) - (a.value || 0)), [allLines]);
  const pipeline = useMemo(() => pipelineAll.filter(p => p.value > 0), [pipelineAll]);
  const pipeNoValue = useMemo(() => pipelineAll.filter(p => !(p.value > 0)), [pipelineAll]);

  /* ── Client engagement by FY ── */
  const clientYears = useMemo(() => {
    const seen = new Set();
    const out = SALES_CLIENT_ENGAGEMENT.map(r => {
      r.clients.forEach(c => seen.add(clientKey(c)));
      return { fy: r.fy, newC: SALES_NEW_CLIENTS[r.fy] ?? 0, total: r.clients.length, names: r.clients, live: false };
    });
    for (let y = LIVE_FROM_FY; y <= CURRENT_FY; y++) {
      const names = new Map();
      sessions.filter(e => e.fy === y).forEach(e => { const c = clean(e.company); const k = clientKey(c); if (k && !names.has(k)) names.set(k, c); });
      const newKeys = [...names.keys()].filter(k => !seen.has(k));
      const newNames = new Set(newKeys.map(k => names.get(k)));
      names.forEach((_, k) => seen.add(k));
      out.push({ fy: y, newC: newKeys.length, total: names.size, names: [...names.values()].sort((a, b) => a.localeCompare(b)), newNames, live: true });
    }
    return { rows: out, unique: seen.size };
  }, [sessions]);
  const ceTot = clientYears.rows.reduce((t, r) => ({ newC: t.newC + r.newC, total: t.total + r.total }), { newC: 0, total: 0 });

  /* ── Chart configs ── */
  const propCfgs = useMemo(() => ['count', 'value'].map(m => ({ m, cfg: { type: 'bar',
    data: { labels: propStatus.map(r => r.month), datasets: [
      { label: 'Won', data: propStatus.map(r => (m === 'count' ? r.wonC : r.wonV)), backgroundColor: GN, borderRadius: 3 },
      { label: 'Lost', data: propStatus.map(r => (m === 'count' ? r.lostC : r.lostV)), backgroundColor: RD, borderRadius: 3 },
      { label: 'In Process', data: propStatus.map(r => (m === 'count' ? r.ipC : r.ipV)), backgroundColor: GD, borderRadius: 3 },
    ] },
    options: { ...(m === 'value' ? inrAxis(bOpts(true, false), 'y') : bOpts(true, false)), plugins: { legend: { position: 'top' }, datalabels: m === 'count' ? dlStack() : dlStackInr(),
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${m === 'count' ? ctx.raw : fmtInr(ctx.raw)}` } } } },
  } })), [propStatus]);

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

  const qrevCfg = useMemo(() => {
    const fys = [];
    for (let y = Math.min(...Object.keys(SALES_QUARTERLY_REVENUE).map(Number)); y <= CURRENT_FY; y++) fys.push(y);
    const qColors = ['#94A3B8', NV, TL, GD, GN, PU];
    return { type: 'bar', data: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], datasets: fys.map((y, i) => {
      const d = quarterOf(y) || [0, 0, 0, 0];
      const shown = y === CURRENT_FY ? d.map((v, q) => (q <= curQ || v ? v : null)) : d;
      return { label: `${fyLong(y)} (${fmtInr(d.reduce((s, v) => s + v, 0))})`, data: shown, backgroundColor: qColors[i % qColors.length], borderRadius: 3 };
    }) }, options: { ...inrAxis(bOpts(false, false), 'y'), layout: { padding: { top: 56 } },
      plugins: { legend: { position: 'bottom' }, datalabels: { ...dlInr(), rotation: -90, align: 'end', anchor: 'end', font: { size: 11, weight: '600' }, formatter: v => (v > 0 ? fmtShort(v) : '') },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label.split(' (')[0]}: ${fmtInr(ctx.raw)}` } } } } };
  }, [revenue]);   // eslint-disable-line react-hooks/exhaustive-deps

  const monthlyCfg = useMemo(() => ({ type: 'bar', data: { labels: monthRows.map(r => r.month), datasets: [
    { label: 'Delivered', data: monthRows.map(r => r.delivered), backgroundColor: TL, borderRadius: 4, stack: 'r' },
    { label: 'Scheduled', data: monthRows.map(r => r.scheduled), backgroundColor: 'rgba(0,128,140,0.35)', borderRadius: 4, stack: 'r' },
  ] }, options: { ...inrAxis(bOpts(true, false), 'y'), layout: { padding: { top: 24 } },
    plugins: { legend: { position: 'top' }, datalabels: { ...dlInr(), display: ctx => ctx.datasetIndex === 1 && monthRows[ctx.dataIndex].total > 0,
      formatter: (v, ctx) => fmtInr(monthRows[ctx.dataIndex].total) },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtInr(ctx.raw)}`, footer: items => `Total: ${fmtInr(monthRows[items[0].dataIndex].total)}` } } } },
  }), [monthRows]);

  const pipeCfg = useMemo(() => {
    const opts = { ...inrAxis(bOpts(false, true), 'x'), indexAxis: 'y', layout: { padding: { right: 80 } },
      plugins: { legend: { display: false }, datalabels: dlInrH(), tooltip: { callbacks: {
        title: items => { const p = pipeline[items[0].dataIndex]; return `${p.client || p.id} · ${p.id}`; },
        label: ctx => `${pipeline[ctx.dataIndex].topic || '—'}: ${fmtInr(ctx.raw)}` } } } };
    opts.scales.y = { ...opts.scales.y, ticks: { font: { size: 11 }, autoSkip: false } };
    return { type: 'bar', data: {
      labels: pipeline.map(p => (p.topic ? [p.client || p.id, p.topic.length > 34 ? p.topic.substring(0, 32) + '..' : p.topic] : (p.client || p.id))),
      datasets: [{ label: 'Approx. Value (Rs.)', data: pipeline.map(p => p.value), backgroundColor: pipeline.map((p, i) => (i < 3 ? NV : TL)), borderRadius: 4, maxBarThickness: 26 }],
    }, options: opts };
  }, [pipeline]);

  const targetCfg = useMemo(() => ({ type: 'bar', data: {
    labels: targets.map(t => (t.pct > 0 ? `${t.q} (${t.pct.toFixed(1)}%)` : t.q)),
    datasets: [
      { label: 'Target (Rs.)', data: targets.map(t => t.target || 0), backgroundColor: 'rgba(0,128,140,0.15)', borderColor: TL, borderWidth: 2, borderRadius: 4 },
      { label: 'Achieved (Rs.)', data: targets.map(t => t.achieved), backgroundColor: GN, borderRadius: 4 },
    ] }, options: { ...inrAxis(bOpts(false, false), 'y'), layout: { padding: { top: 24 } }, plugins: { legend: { position: 'bottom' }, datalabels: { ...dlInr(), formatter: v => (v > 0 ? fmtShort(v) : '') } } } }), [targets]);

  const sumT = targets.reduce((s, t) => s + (t.target || 0), 0), sumA = targets.reduce((s, t) => s + t.achieved, 0);
  const curName = fyLong(CURRENT_FY);
  const monthTotal = monthRows.reduce((s, r) => s + r.total, 0);
  const fyCell = y => `FY ${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;

  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Sales</h2><p>Proposal funnel, order book &amp; revenue tracking</p></div>
      <SourceNote live={`proposals from the BD Tracker · revenue and clients from the Engagement Calendar (${fyLong(LIVE_FROM_FY)} onward)`}
                  fixed="earlier quarterly revenue, targets and client history from Dashboard Report Data (12 Oct 2026)" />

      {/* ═══════════ 1 · BD TRACKER ═══════════ */}
      <div className="s-band"><span className="s-band-tag bd">BD Tracker</span><span className="s-band-txt">Proposals, funnel &amp; open pipeline</span></div>
      <div className="kg g5">
        <Kpi tone="tl" label="Total Proposals (YTD)" list={() => curProps.map(p => propItem(p))} value={tot.n} sub={`${uniqueProposals(curProps)} unique proposals${tot.n > uniqueProposals(curProps) ? ` · ${tot.n - uniqueProposals(curProps)} revisions` : ''}`} how="Proposal lines (Proposal ID + version) dated in this FY — month from Date of Discussion, else BD Month, else submission dates; each revision counts again." />
        <Kpi tone="gn" label="Won Value (YTD)" list={() => curProps.filter(p => /won/i.test(p.status)).map(p => propItem(p))} value={fmtInr(tot.wonV)} sub={`${tot.wonC} proposals won`} tag="Closed" tagTone="up" how="Sum of BD Proposal Value of this FY's lines with BD Status = Won (BD value only — Solution values not used)." />
        <Kpi tone="gd" label="In-Process Value" list={() => curProps.filter(p => /in.?process/i.test(p.status)).map(p => propItem(p))} value={fmtInr(tot.ipV)} sub={`${tot.ipC} proposals active`} tag="In negotiation" how="Sum of BD Proposal Value of this FY's lines still In Process in the BD Tracker." />
        <Kpi tone="nv" label={`${curTarget?.q || `Q${curQ + 1}`} Target Achieved`} list={() => sessions.filter(e => e.fy === CURRENT_FY && Math.floor(((+e.startDate.slice(5, 7) + 8) % 12) / 3) === curQ).map(e => egItem(e))} value={curTarget?.target ? `${curTarget.pct.toFixed(1)}%` : '--'}
             sub={curTarget?.target ? `of ${fmtInr(curTarget.target)} ${curTarget.q} target` : 'no target set for this quarter'} how="Engagement Calendar Price (INR) of sessions starting this quarter (cancelled / lost / on hold excluded) ÷ the quarter's revenue target." />
        <Kpi tone="pu" label={`${fyTiny(CURRENT_FY)} Target Achieved`} list={() => sessions.filter(e => e.fy === CURRENT_FY).map(e => egItem(e))} value={fyTarget ? `${((fyAchieved / fyTarget) * 100).toFixed(1)}%` : '--'}
             sub={fyTarget ? `${fmtInr(fyAchieved)} of ${fmtInr(fyTarget)} FY target` : 'no target set for this FY'} how="Engagement Calendar Price (INR) of this FY's sessions (cancelled / lost / on hold excluded) ÷ the FY revenue target (sum of the four quarterly targets)." />
      </div>

      <div className="cg c1">
        <div className="card"><h3>Monthly Proposal Status — {curName}</h3><div className="cs">Won vs Lost vs In-Process, stacked per month — Count and Value</div>
          <div className="cv-pair">
            {propCfgs.map(c => (
              <div className="cv-col" key={c.m}><div className="cv-col-title">{c.m === 'count' ? '📊 Count' : '₹ Value'}</div><ChartBox config={c.cfg} title="Proposal status" how="Proposal lines (ID + version) of this FY in that month, by BD Status: Won / Closed / Confirmed = Won; Lost / Dropped / Rejected (or replaced by a later version) = Lost; else In Process. Value = BD Proposal Value." listFor={(lb, ds) => curProps.filter(p => MONTHS[monthSlot(p)] === lb && p.pipeline === stOf(ds)).sort((a, b) => b.value - a.value).map(p => propItem(p))} className="ch-wrap tall" /></div>
            ))}
          </div>
        </div>
      </div>

      <div className="cg c12">
        <div className="card flex-card"><h3>Proposal Funnel (YTD)</h3><div className="cs">Won vs Lost vs In-Process by value</div>
          {tot.wonV + tot.lostV + tot.ipV > 0 ? <ChartBox config={funnelCfg} title="Proposal funnel" how="BD Proposal Value of this FY's proposal lines by status." listFor={lb => curProps.filter(p => p.pipeline === stOf(lb)).sort((a, b) => b.value - a.value).map(p => propItem(p))} className="ch-wrap s-fill" /> : <div className="erd-empty">No proposal values in {curName} yet</div>}
        </div>
        <div className="card flex-card"><h3>Expected Major Pipeline</h3>
          <div className="cs">All {pipelineAll.length} proposals In Process in the BD Tracker (latest version) · {fmtInr(pipeline.reduce((s, p) => s + p.value, 0))} open value{pipeNoValue.length ? ` · ${pipeNoValue.length} without a value` : ''}</div>
          {pipeline.length
            ? <div className="s-scroll" style={{ maxHeight: 420 }}><ChartBox config={pipeCfg} title="Open pipeline" how="Latest version of every proposal still In Process in the BD Tracker, by BD Proposal Value." listFor={(lb, ds, v) => pipeline.filter(p => p.value === v).map(p => propItem(p))} height={heightFor(pipeline.length, 34, 240)} /></div>
            : <div className="erd-empty">No open proposals with a value</div>}
          {pipeNoValue.length > 0 && (
            <div className="s-scroll" style={{ maxHeight: 150, marginTop: 10 }}>
              <table className="mt compact">
                <thead><tr><th>No BD value yet</th><th>Particulars</th><th className="nr">P.ID</th></tr></thead>
                <tbody>{pipeNoValue.map(p => <tr key={p.key}><td style={{ fontWeight: 600 }}>{p.client || '—'}</td><td style={{ fontSize: 12 }}>{p.topic || '—'}</td><td className="nr">{p.id}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ 2 · ENGAGEMENT CALENDAR ═══════════ */}
      <div className="s-band"><span className="s-band-tag ec">Engagement Calendar</span><span className="s-band-txt">Revenue (Price INR, by session start month), targets &amp; order book</span></div>

      <div className="cg c11">
        <div className="card"><h3>Monthly Revenue — {curName}</h3><div className="cs">Delivered vs scheduled, Price (INR) by session start month</div><ChartBox config={monthlyCfg} title="Monthly revenue" how="Price (INR) of this FY's Engagement Calendar sessions by start month; Delivered = Status Delivered, Scheduled = every other status except Cancelled / Lost / Dropped / Postponed / On hold." listFor={(lb, ds) => sessions.filter(e => e.fy === CURRENT_FY && MONTHS[monthIdx(e.startDate)] === lb && (/deliver/i.test(ds) ? isDelivered(e) : !isDelivered(e))).map(e => egItem(e))} className="ch-wrap tall" /></div>
        <div className="card"><h3>Quarterly Revenue Comparison</h3><div className="cs">Q1–Q4 across financial years</div><ChartBox config={qrevCfg} title="Quarterly revenue" how="Live years: Price (INR) of Engagement Calendar sessions starting in that quarter (cancelled / lost / on hold excluded). FY 2024-25 and 2025-26 are fixed report figures with no records to list." listFor={(lb, ds) => { const fy = +(String(ds).match(/(20\d{2})/) || [])[1]; const q = +String(lb).slice(1) - 1; return fy >= LIVE_FROM_FY ? sessions.filter(e => e.fy === fy && qOf(e) === q).map(e => egItem(e)) : []; }} className="ch-wrap tall" /></div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Quarterly Targets vs Achieved</h3><div className="cs">{curName} quarter-by-quarter tracking</div><ChartBox config={targetCfg} title="Quarterly target" how="Achieved = Price (INR) of this FY's sessions starting in the quarter (cancelled / lost / on hold excluded) against the quarterly revenue target." listFor={lb => { const q = +String(lb).slice(1, 2) - 1; return sessions.filter(e => e.fy === CURRENT_FY && qOf(e) === q).map(e => egItem(e)); }} className="ch-wrap tall" /></div>
        <div className="card flex-card"><h3>{curName} — Quarterly Targets</h3><div className="cs">Target vs achieved revenue by quarter (achieved = Engagement Calendar revenue)</div>
          <div className="s-scroll" style={{ maxHeight: 340 }}><table className="mt">
            <thead><tr><th>Quarter</th><th className="nr">Target (Rs.)</th><th className="nr">Achieved (Rs.)</th><th className="nr">% Achieved</th></tr></thead>
            <tbody>
              {targets.map(t => (
                <tr key={t.q} className={`sl-click${t.live ? ' cur' : ''}`} onClick={() => show(`${t.q} sessions`, () => sessions.filter(e => e.fy === CURRENT_FY && qOf(e) === +t.q.slice(1) - 1).map(e => egItem(e)), 'Engagement Calendar sessions starting in this quarter that count as revenue.')}><td style={{ fontWeight: 600 }}>{t.q}{t.live && <span style={{ fontSize: 11, color: TL, fontWeight: 700 }}> (current)</span>}</td>
                  <td className="nr">{t.target ? fmtInr(t.target) : '—'}</td><td className="nr">{fmtInr(t.achieved)}</td><td className="nr">{t.target ? `${t.pct.toFixed(2)}%` : '—'}</td></tr>
              ))}
              <tr className="tot"><td>Total (YTD)</td><td className="nr">{fmtInr(sumT)}</td><td className="nr">{fmtInr(sumA)}</td><td className="nr">{sumT ? ((sumA / sumT) * 100).toFixed(2) : '0.00'}%</td></tr>
            </tbody>
          </table></div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Order Book — Active Programs</h3><div className="cs">PO Tracker: PO value vs linked Engagement Calendar sessions — delivered, confirmed by dates, balance</div>
          <div className="s-scroll" style={{ maxHeight: 360 }}><table className="mt compact">
            <thead><tr><th>Client</th><th>{usePo ? 'PO / Scope' : 'Program'}</th><th className="nr">{usePo ? 'PO Value' : 'Booked'}</th><th className="nr">Delivered</th><th className="nr">Confirmed by Dates</th><th className="nr">Balance</th></tr></thead>
            <tbody>
              {orderBook.length === 0 && <tr><td colSpan={6} className="erd-empty">{poConfigured() ? 'No POs recorded yet — add them in the PO Tracker' : 'PO Tracker not connected yet (PO_CRUD flow URL missing)'}</td></tr>}
              {orderBook.map(r => (
                <tr key={usePo ? r.po.poId : r.p.id} className="sl-click" onClick={() => usePo && show(`PO ${r.po.poNumber || r.po.poId} · ${r.po.client}`, () => r.u.rows.map(e => egItem(e)), 'Engagement Calendar sessions linked to this PO by Index. Confirmed = their Price (cancelled / lost excluded); Balance = PO value − confirmed.')}>{usePo
                  ? <><td>{r.po.client}</td><td style={{ fontSize: 12 }}><b>{r.po.poNumber || r.po.poId}</b> · {r.st}<div style={{ opacity: 0.75 }}>{r.po.scope || `${r.u.ids.length} engagement(s)`}</div></td></>
                  : <><td>{r.p.client || r.p.id}</td><td style={{ fontSize: 12, opacity: 0.75 }}>{r.p.topic}</td></>}
                  <td className="nr">{fmtInr(r.booked)}</td><td className="nr">{fmtInr(r.delivered)}</td><td className="nr">{fmtInr(r.confirmed)}</td>
                  <td className="nr" style={{ color: r.balance > 500000 ? GD : undefined }}>{r.balance < 0 ? '-' : ''}{fmtInr(r.balance)}</td></tr>
              ))}
              {orderBook.length > 0 && <tr className="tot"><td colSpan={2}>Total</td><td className="nr">{fmtInr(ob.booked)}</td><td className="nr">{fmtInr(ob.delivered)}</td><td className="nr">{fmtInr(ob.confirmed)}</td><td className="nr">{ob.balance < 0 ? '-' : ''}{fmtInr(ob.balance)}</td></tr>}
            </tbody>
          </table></div>
          <div className="mt-note">{usePo ? 'Engagements are linked to a PO by their Index in the PO Tracker. Confirmed = Price of linked sessions (cancelled / lost excluded); Balance = PO value − confirmed. Closed POs hidden.' : 'Sessions are matched to a proposal by Proposal Link, otherwise by client name + program topic.'}</div>
        </div>
      </div>

      {/* ═══════════ 3 · CLIENTS ═══════════ */}
      <div className="s-band"><span className="s-band-tag cl">Clients</span><span className="s-band-txt">Who drives revenue and how the client base grows · Engagement Calendar (FY 2026-27 onward) + baseline report</span></div>
      <SalesClients sessions={sessions} clientYears={clientYears} clientKey={clientKey} />
      {drill && <KpiListModal title={drill.title} items={drill.items} how={drill.how} onClose={() => setDrill(null)} />}
    </div>
  );
}
