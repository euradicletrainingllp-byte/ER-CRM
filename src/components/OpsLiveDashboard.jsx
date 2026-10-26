/**
 * Operations dashboard — same charts and layout as the standalone EuRadicle Dashboard HTML report.
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
const isUpcoming  = e => /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status)) && e.startDate >= todayISO;
const daysOf = e => (Number(e.day) > 0 ? Number(e.day) : 0);
const consultantsOf = e => [...new Set([e.consultant1, e.consultant2, e.consultant3].map(clean).filter(n => n && !NOT_A_PERSON.test(n)))];
const modeOf = e => {
  const raw = clean(e.locationRaw ?? e.location);
  if (!raw || raw === '#VALUE!') return 'unknown';
  return /vilt|virtual|online|zoom|teams|webinar/i.test(raw) ? 'virtual' : 'inPerson';
};
const feedbackOf = e => { const n = Number(clean(e.feedback)); return n > 0 && n <= 5 ? n : null; };
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

export default function OpsLiveDashboard({ engagements, refreshing }) {
  const [countBy, setCountBy] = useState('projects');
  const unit = countBy === 'projects' ? 'Projects' : 'Sessions';

  // Live rows: usable start date and FY from LIVE_FROM_FY onward
  const live = useMemo(() => (engagements || [])
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || ''))
    .map(e => ({ ...e, fy: fyStartOf(e.startDate) }))
    .filter(e => e.fy >= LIVE_FROM_FY), [engagements]);
  const cur = useMemo(() => live.filter(e => e.fy === CURRENT_FY), [live]);

  /* Financial Year table: fixed years + live years */
  const fyData = useMemo(() => {
    const del = counter(countBy), up = counter(countBy), ip = counter(countBy), vi = counter(countBy);
    live.forEach(e => {
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
    return [...OPS_FY, ...liveRows];
  }, [live, countBy]);

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
  // Sessions already over but still Scheduled / Tentative / Re-schedule: counted neither as delivered
  // nor as upcoming until their Status is updated in the Engagement Calendar.
  const staleStatus = live.filter(e => /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status))
    && (/^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') ? e.endDate : e.startDate) < todayISO);

  return (
    <div className="erd" style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity .2s' }}>
      <div className="pg-hdr"><h2>Operations</h2><p>Project delivery, client pipeline &amp; consultant engagement</p></div>
      <SourceNote live={`${fyLong(LIVE_FROM_FY)} onward from the Engagement Calendar`} fixed="earlier years from Dashboard Report Data (12 Oct 2026)" />
      {staleStatus.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 8, padding: '8px 14px', margin: '0 0 12px', fontSize: 13 }}
          title={staleStatus.slice(0, 15).map(e => `${clean(e.company)} · ${clean(e.topic)} · ${e.startDate} · ${clean(e.status)}`).join('\n')}>
          ⚠ {staleStatus.length} session{staleStatus.length === 1 ? ' has' : 's have'} already ended but {staleStatus.length === 1 ? 'is' : 'are'} still marked Scheduled / Tentative — {staleStatus.length === 1 ? 'it is' : 'they are'} not counted as Delivered or Upcoming until the Status is updated in the Engagement Calendar.
        </div>
      )}

      <div className="erd-bar">
        <label>Count live years by</label>
        <div className="erd-seg">
          {[['projects', 'Projects (EG ID)'], ['sessions', 'Sessions']].map(([k, l]) => (
            <button key={k} type="button" className={countBy === k ? 'on' : ''} aria-pressed={countBy === k} onClick={() => setCountBy(k)}>{l}</button>
          ))}
        </div>
        {refreshing && <span style={{ fontSize: 13, color: '#00808C', fontWeight: 700 }}>⟳ Updating…</span>}
      </div>

      <div className="kg g4">
        <Kpi tone="tl" label={`FY ${fyShort(CURRENT_FY).slice(2)} Delivered`} value={curRow.total} sub={`${unit} completed this FY`} />
        <Kpi tone="gd" label={`FY ${fyShort(CURRENT_FY).slice(2)} Upcoming`} value={curRow.upcoming} sub={`${unit} in pipeline`} />
        <Kpi tone="gn" label="Best Year (Delivered)" value={best.total} sub={`FY ${fyShort(best.fy)}`} tag="▲ Record" tagTone="up" />
        <Kpi tone="nv" label="Key Account" value={keyAccount && keyAccount.upcoming > 0 ? keyAccount.label : '--'}
             sub={keyAccount && keyAccount.upcoming > 0 ? `${keyAccount.upcoming} upcoming ${unit.toLowerCase()}` : 'Largest upcoming pipeline'} tag="Top Client" />
      </div>

      <div className="cg c11">
        <div className="card"><h3>Project Trend by FY</h3><div className="cs">Total delivered and upcoming projects per financial year</div><ChartBox config={trendCfg} /></div>
        <div className="card"><h3>Delivery Mode</h3><div className="cs">In-Person vs Virtual by financial year</div><ChartBox config={modeCfg} /></div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Top Consultants — {curName}</h3><div className="cs">Days delivered and upcoming</div>
          <table className="mt">
            <thead><tr><th>Trainer</th><th className="nr">Delivered (Days)</th><th className="nr">Upcoming (Days)</th><th className="nr">Total Days</th></tr></thead>
            <tbody>
              {trainers.length === 0 && <tr><td colSpan={4} className="erd-empty">No consultant days in {curName} yet</td></tr>}
              {trainers.map(t => (
                <tr key={t.label}><td>{t.label}</td><td className="nr">{r2(t.dd)}</td><td className="nr">{r2(t.du)}</td><td className="nr">{r2(t.dd + t.du)}</td></tr>
              ))}
              {trainers.length > 0 && <tr className="tot"><td>Total</td><td className="nr">{r2(sDD)}</td><td className="nr">{r2(sDU)}</td><td className="nr">{r2(sDD + sDU)}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card flex-card"><h3>{curName} — Client Status</h3><div className="cs">Delivered vs upcoming per client</div>
          {clients.length ? <ChartBox config={clientsCfg} height={heightFor(clients.length, 26, 260)} />
                          : <div className="erd-empty">No engagements in {curName} yet</div>}
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Recent Program Feedback</h3>
          <div className="cs">Post-program feedback scores (out of 5) — {feedback.length} programs, average {fbAvg.toFixed(2)}</div>
          <ChartBox config={fbCfg} height={heightFor(feedback.length, 30)} />
          <div className="tbl-x" style={{ marginTop: 12 }}>
            <table className="mt">
              <thead><tr><th>Program Name</th><th className="nr">Feedback Score (Out of 5)</th><th className="nr">Sessions Scored</th><th className="nr">Latest Session</th></tr></thead>
              <tbody>{feedback.map(f => (
                <tr key={f.label}><td style={{ fontWeight: 600 }}>{f.label}</td><td className="nr">{f.score.toFixed(2)}</td>
                  <td className="nr">{f.n ?? '—'}</td><td className="nr">{f.latest ? fmtDate(f.latest) : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Consultant Days — Previous Years</h3><div className="cs">Previous financial years, by trainer — one chart per year</div>
          <MiniYearCharts blocks={OPS_CONSULTANT_PREV} palette={PREV_DAYS_PALETTE} unit="Days" titleOf={titleDays} />
        </div>
      </div>

      <div className="cg c1">
        <div className="card"><h3>Client Status — Historical by FY</h3><div className="cs">Projects delivered per client — one chart per year</div>
          <MiniYearCharts blocks={OPS_CLIENT_PREV} palette={PREV_CLIENT_PALETTE} unit="Projects" titleOf={titleClients} />
        </div>
      </div>
    </div>
  );
}
