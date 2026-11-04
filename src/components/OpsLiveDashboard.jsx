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
const hasDate = e => /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || '');
const isCancelled = e => /cancel|lost|drop|postpon|hold/i.test(clean(e.status));
// Dates TBD: a row with an Index / S No that is not delivered or cancelled is an upcoming engagement
const isUpcoming  = e => (hasDate(e)
  ? /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status)) && e.startDate >= todayISO
  : !isDelivered(e) && !isCancelled(e));
const daysOf = e => (Number(e.day) > 0 ? Number(e.day) : 0);
import { egItem, propItem } from './KpiListModal.jsx';
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
  // Every EC row with a date, or with an Index / S No and dates TBD (counted in the current FY)
  const all = useMemo(() => (engagements || [])
    .filter(e => hasDate(e) || ((clean(e.engagementKey) || clean(e.sno)) && (clean(e.company) || clean(e.topic))))
    .map(e => ({ ...e, fy: hasDate(e) ? fyStartOf(e.startDate) : CURRENT_FY })), [engagements]);
  const live = useMemo(() => all.filter(e => e.fy >= LIVE_FROM_FY), [all]);
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
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const fbRows = useMemo(() => {
    const rows = all.filter(e => hasDate(e) && (feedbackOf(e) != null || (isDelivered(e) && e.startDate >= weekAgo && e.startDate <= todayISO)))
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
  // Sessions already over but still Scheduled / Tentative / Re-schedule: counted neither as delivered
  // nor as upcoming until their Status is updated in the Engagement Calendar.
  const staleStatus = live.filter(e => /^(scheduled|tentative|re-?schedule)$/i.test(clean(e.status))
    && hasDate(e) && (/^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') ? e.endDate : e.startDate) < todayISO);

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
        <Kpi tone="tl" label={`FY ${fyShort(CURRENT_FY).slice(2)} Delivered`} list={() => live.filter(e => e.fy === CURRENT_FY && isDelivered(e)).map(e => egItem(e))} value={curRow.total} sub={`${unit} completed this FY`} how={`Engagement Calendar rows with Status = Delivered and a start date in this FY, counted once per ${countBy === 'sessions' ? 'session (row)' : 'project (EG ID)'}.`} />
        <Kpi tone="gd" label={`FY ${fyShort(CURRENT_FY).slice(2)} Upcoming`} list={() => live.filter(e => e.fy === CURRENT_FY && isUpcoming(e)).sort((a, b) => String(a.startDate || '9').localeCompare(String(b.startDate || '9'))).map(e => egItem(e))} value={curRow.upcoming} sub={`${unit} in pipeline`} how={`Status Scheduled / Tentative / Re-schedule with a start date from today onward in this FY, counted once per ${countBy === 'sessions' ? 'session (row)' : 'project (EG ID)'}.`} />
        <Kpi tone="gn" label="Best Year (Delivered)" list={() => all.filter(e => e.fy === best.fy && isDelivered(e)).map(e => egItem(e))} value={best.total} sub={`FY ${fyShort(best.fy)}`} tag="▲ Record" tagTone="up" how="Highest Delivered count of any FY — earlier years from the Dashboard Report Data, live years from the Engagement Calendar." />
        <Kpi tone="nv" label="Key Account" list={keyAccount ? () => all.filter(e => e.fy === CURRENT_FY && isUpcoming(e) && keyOf(e.company) === keyOf(keyAccount.label)).map(e => egItem(e)) : undefined} value={keyAccount && keyAccount.upcoming > 0 ? keyAccount.label : '--'}
             sub={keyAccount && keyAccount.upcoming > 0 ? `${keyAccount.upcoming} upcoming ${unit.toLowerCase()}` : 'Largest upcoming pipeline'} tag="Top Client" how="Client with the most upcoming (Scheduled / Tentative / Re-schedule, today onward) projects or sessions." />
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
          <div className="cs">Overall average <b>{fbRows.avg ? fbRows.avg.toFixed(2) : 'N/A'}</b> / 5 across {fbRows.n} scored sessions · {fbRows.week} delivered in the last 7 days (top) · scroll for earlier programs</div>
          <div className="tbl-x" style={{ marginTop: 12, maxHeight: 340, overflowY: 'auto' }}>
            <table className="mt">
              <thead style={{ position: 'sticky', top: 0, background: '#F8F9FB', zIndex: 1 }}><tr><th>Program</th><th>Client</th><th className="nr">Delivered</th><th className="nr">Feedback (out of 5)</th></tr></thead>
              <tbody>
                {fbRows.list.length === 0 && <tr><td colSpan={4} className="erd-empty">No feedback yet</td></tr>}
                {fbRows.list.map(f => (
                  <tr key={f.key + f.date} style={f.date >= weekAgo ? { background: '#f3eef7' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{f.label}</td><td>{f.client || '—'}</td><td className="nr">{f.date ? fmtDate(f.date) : '—'}</td>
                    <td className="nr" style={{ fontWeight: 600, color: f.score == null ? '#6B7280' : f.score >= 4.5 ? '#0AC44B' : f.score >= 4 ? '#2D3047' : '#E98272' }}>{f.score == null ? 'Awaited' : f.score.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="cg c11">
        <div className="card"><h3>Consultant Days — Year on Year</h3><div className="cs">Delivered days per FY (current FY includes upcoming) · top 15 · from the Engagement Calendar</div>
          {compare.cons.rows.length ? <ChartBox config={compare.cons.cfg} height={heightFor(compare.cons.rows.length, 44, 300)} /> : <div className="erd-empty">No consultant data</div>}
        </div>
        <div className="card"><h3>Client Status — Year on Year</h3><div className="cs">Projects delivered per FY (current FY includes upcoming) · top 15 · from the Engagement Calendar</div>
          {compare.cli.rows.length ? <ChartBox config={compare.cli.cfg} height={heightFor(compare.cli.rows.length, 44, 300)} /> : <div className="erd-empty">No client data</div>}
        </div>
      </div>
    </div>
  );
}
