/**
 * SolutioningDashboard — Solutioning view of the Dashboard, built from the
 * Solution Tracker (proposals) and the BD Tracker (opportunities).
 *
 * Definitions used everywhere on this page
 *   Proposal      one Proposal ID in the Solution Tracker (several versions of the same
 *                 Proposal ID count once; the latest version supplies its value / status)
 *   Opportunity   one BD S No (a Solution Tracker row with no BD S No counts by its Proposal ID);
 *                 BD Tracker rows that have no proposal yet are added too
 *   Value         Solution Value → BD Proposal Value → BD Tracker Commercials (first one filled)
 *                 "12,50,000", "12.5 L", "1.2 Cr" are all understood
 *   Proposal date Date of Submission to Client → by Sol team → Date of Discussion →
 *                 Solution Month → BD Month (first one filled); it decides the FY and the month
 *   FY            Indian financial year, April → March
 *   Pipeline      BD Status Won / Closed / Confirmed → Closed · Lost / Dropped / Rejected → Lost ·
 *                 anything else → In Process
 *   Industry      "Industry" column of the Solution Tracker, else of the linked BD Tracker row,
 *                 else src/config/clientIndustry.js, else "Not recorded"
 */
import { useMemo, useState } from 'react';
import CLIENT_INDUSTRY from '../config/clientIndustry.js';
import {
  C, pad2, fyStartOf, fyLabel, CURRENT_FY, clean, fmtNum, niceMax, MONTHS,
  useTooltip, Card, DataTable, Empty, ColumnChart,
} from './OperationsDashboard.jsx';

/* ─── Palette ─── */
const M = {
  count: C.delivered,          // blue   — number of proposals / opportunities
  value: C.virtual,            // violet — ₹ value (always its own scale, never a 2nd axis)
};
// Status palette (reserved; always shown with icon + label)
const PIPE = [
  { key: 'closed',  label: 'Closed',     icon: '✓', color: '#0ca30c' },
  { key: 'process', label: 'In Process', icon: '⏳', color: '#fab219' },
  { key: 'lost',    label: 'Lost',       icon: '✕', color: '#d03b3b' },
];
const NR = 'Not recorded';

/* ─── Parsing helpers ─── */
const MONTH_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Excel serial / ISO / dd-mm-yyyy / "Sep 2026" / "Sep-26" → YYYY-MM-DD ('' if not a date). */
function toISODate(v, refYear) {
  const s = clean(v);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) {
    if (n > 25000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    return '';
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);            // dd/mm/yyyy (Indian order)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[2] >= 1 && +m[2] <= 12) return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
  }
  m = s.match(/([A-Za-z]{3,})[\s'’,-]*(\d{2,4})?/);                   // "September 2026", "Sep-26", "Sep"
  if (m) {
    const mon = MONTH_IDX[m[1].slice(0, 3).toLowerCase()];
    if (mon) {
      let y = m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : null;
      if (!y && refYear) y = refYear;
      if (y) return `${y}-${pad2(mon)}-01`;
    }
  }
  return '';
}

/** "₹12,50,000" | "12.5 L" | "12.5 lakhs" | "1.2 Cr" | 1250000 → rupees (0 if blank). */
function toRupees(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v > 0 ? v : 0;
  const s = clean(v).toLowerCase().replace(/,/g, '');
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (!(n > 0)) return 0;
  if (/\bcr|crore/.test(s)) return n * 1e7;
  if (/\bl\b|lakh|lac|\dl/.test(s)) return n * 1e5;
  if (/\bk\b|\dk/.test(s)) return n * 1e3;
  return n;
}

const fmtINR = v => {
  if (!v) return '₹0';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};
const fmtPct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const versionNo = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(n) ? 0 : n; };

function pipelineOf(bdStatus, solStatus) {
  const s = clean(bdStatus).toLowerCase();
  if (/won|closed|confirm|converted/.test(s)) return 'closed';
  if (/lost|drop|reject|declin|cancel/.test(s)) return 'lost';
  if (!s && /reject/i.test(clean(solStatus))) return 'lost';
  return 'process';
}

function customizationOf(programType) {
  const s = clean(programType);
  if (!s) return NR;
  if (/new/i.test(s)) return 'New Creation';
  if (/custom/i.test(s)) return 'Customized';
  if (/standard/i.test(s)) return 'Standard';
  return s;
}

const industryFromConfig = client => {
  const c = clean(client).toLowerCase();
  if (!c) return '';
  for (const [name, industry] of Object.entries(CLIENT_INDUSTRY)) {
    if (c.includes(name.toLowerCase())) return industry;
  }
  return '';
};

/* ─── Count + value bars: two small bar columns per row, each on its own scale ─── */
function CountValueBars({ rows, tip, countWord, empty, maxRows = 10 }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <Empty text={empty} />;
  const shown = showAll ? rows : rows.slice(0, maxRows);
  const maxC = niceMax(Math.max(1, ...rows.map(r => r.count)));
  const maxV = Math.max(1, ...rows.map(r => r.value));
  const totC = rows.reduce((s, r) => s + r.count, 0);
  const totV = rows.reduce((s, r) => s + r.value, 0);
  const bar = (v, max, color) => (
    <div style={{ height: 12, background: '#f4f4f1', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${(v / max) * 100}%`, minWidth: v ? 2 : 0, height: '100%', background: color, borderRadius: '0 4px 4px 0' }} />
    </div>
  );
  const grid = 'minmax(110px, 30%) 1fr 34px 1fr 72px';
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, fontSize: 11, fontWeight: 700, color: 'var(--muted)', paddingBottom: 4 }}>
        <span />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: M.count }} />{countWord}</span>
        <span />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: M.value }} />Value (₹)</span>
        <span />
      </div>
      {shown.map(r => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', gap: 8, padding: '4px 0' }}
             onMouseMove={e => tip.show(e, r.label, [
               { label: `${countWord.toLowerCase()} (${fmtPct(r.count, totC)})`, value: fmtNum(r.count), color: M.count },
               { label: `value (${fmtPct(r.value, totV)})`, value: fmtINR(r.value), color: M.value },
               ...(r.count ? [{ label: 'avg value', value: fmtINR(r.value / r.count) }] : []),
             ])}
             onMouseLeave={tip.hide}>
          <span title={r.label} style={{ fontSize: 12, color: r.label === NR ? 'var(--muted)' : 'var(--text-body)', fontStyle: r.label === NR ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
          {bar(r.count, maxC, M.count)}
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', textAlign: 'right' }}>{fmtNum(r.count)}</span>
          {bar(r.value, maxV, M.value)}
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtINR(r.value)}</span>
        </div>
      ))}
      {rows.length > maxRows && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show top ' + maxRows : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

const mixTable = (rows, first, countWord) => {
  const totC = rows.reduce((s, r) => s + r.count, 0);
  const totV = rows.reduce((s, r) => s + r.value, 0);
  return (
    <DataTable columns={[first, countWord, '% of count', 'Value', '% of value']}
      rows={rows.map(r => [r.label, r.count, fmtPct(r.count, totC), fmtINR(r.value), fmtPct(r.value, totV)])} />
  );
};

/** Group items by keyOf(item) → [{label, count, value}] sorted by count, then value. */
function mix(items, keyOf) {
  const m = new Map();
  items.forEach(it => {
    const k = clean(keyOf(it)) || NR;
    if (!m.has(k)) m.set(k, { label: k, count: 0, value: 0 });
    const g = m.get(k); g.count += 1; g.value += it.value;
  });
  return [...m.values()].sort((a, b) =>
    (a.label === NR) - (b.label === NR) || b.count - a.count || b.value - a.value);
}

/* ─── Page ─── */
export default function SolutioningDashboard({ solutions, bd, refreshing }) {
  const tip = useTooltip();
  const [fy, setFy] = useState(CURRENT_FY);      // number, or 'all'

  const bdBySno = useMemo(() => {
    const m = new Map();
    (bd || []).forEach(r => m.set(clean(r.sno), r));
    return m;
  }, [bd]);

  /* One entry per Proposal ID (latest version wins) */
  const proposals = useMemo(() => {
    const byId = new Map();
    (solutions || []).forEach((r, i) => {
      const id = clean(r.proposalId);
      if (!id) return;
      const prev = byId.get(id);
      if (!prev || versionNo(r.proposalVersion) > versionNo(prev.proposalVersion)
          || (versionNo(r.proposalVersion) === versionNo(prev.proposalVersion) && i > prev._i)) {
        byId.set(id, { ...r, _i: i });
      }
    });
    return [...byId.values()].map(r => {
      const bdRow = bdBySno.get(clean(r.bdSNo));
      const refYear = +(toISODate(r.dateOfDiscussion) || toISODate(r.submissionToClient) || '').slice(0, 4) || null;
      const date = toISODate(r.submissionToClient) || toISODate(r.submissionBySolTeam) || toISODate(r.dateOfDiscussion)
                || toISODate(r.solutionMonth, refYear) || toISODate(r.bdMonth, refYear);
      const client = clean(r.clientName) || clean(bdRow?.client);
      return {
        id: clean(r.proposalId),
        oppKey: clean(r.bdSNo) ? `bd-${clean(r.bdSNo)}` : `p-${clean(r.proposalId)}`,
        client,
        date,
        fy: date ? fyStartOf(date) : null,
        value: toRupees(r.solutionValue) || toRupees(r.bdProposalValue) || toRupees(bdRow?.commercials),
        pipeline: pipelineOf(r.bdStatus, r.status),
        industry: clean(r.industry) || clean(bdRow?.industry) || industryFromConfig(client),
        developmentCategory: r.developmentCategory,
        engagementType: r.engagementType,
        lineOfService: r.lineOfService,
        typeOfService: r.typeOfService,
        customization: customizationOf(r.programType),
      };
    });
  }, [solutions, bdBySno]);

  /* Opportunities: proposals grouped by BD S No + BD Tracker rows that have no proposal yet */
  const opportunities = useMemo(() => {
    const m = new Map();
    proposals.forEach(p => {
      const o = m.get(p.oppKey);
      if (!o) m.set(p.oppKey, { key: p.oppKey, industry: p.industry, value: p.value, fy: p.fy, client: p.client });
      else {
        o.value = Math.max(o.value, p.value);
        if (!o.industry) o.industry = p.industry;
        if (p.fy != null && (o.fy == null || p.fy > o.fy)) o.fy = p.fy;
      }
    });
    (bd || []).forEach(r => {
      const key = `bd-${clean(r.sno)}`;
      if (m.has(key) || !clean(r.client)) return;
      m.set(key, {
        key, client: clean(r.client), fy: null,
        industry: clean(r.industry) || industryFromConfig(r.client),
        value: toRupees(r.commercials),
      });
    });
    return [...m.values()];
  }, [proposals, bd]);

  const fyList = useMemo(() => {
    const years = proposals.map(p => p.fy).filter(f => f != null);
    const first = Math.min(CURRENT_FY, ...years);
    const last  = Math.max(CURRENT_FY, ...years);
    const out = [];
    for (let y = first; y <= last; y++) out.push(y);
    return out;
  }, [proposals]);

  const inFy = x => fy === 'all' || x.fy === fy;
  const fyName = fy === 'all' ? 'All years' : fyLabel(fy);
  const fyP = useMemo(() => proposals.filter(inFy), [proposals, fy]);
  const fyO = useMemo(() => opportunities.filter(inFy), [opportunities, fy]);
  const undated = proposals.filter(p => p.fy == null).length;

  const devMix      = useMemo(() => mix(fyP, p => p.developmentCategory), [fyP]);
  const industryMix = useMemo(() => mix(fyO, o => o.industry), [fyO]);
  const engMix      = useMemo(() => mix(fyP, p => p.engagementType), [fyP]);
  const losMix      = useMemo(() => mix(fyP, p => p.lineOfService), [fyP]);
  const tosMix      = useMemo(() => mix(fyP, p => p.typeOfService), [fyP]);
  const custMix     = useMemo(() => mix(fyP, p => p.customization), [fyP]);

  /* Monthly trend: Apr → Mar of the selected FY (or the last 12 months for "All years") */
  const monthly = useMemo(() => {
    let months;
    if (fy === 'all') {
      const t = new Date(); const out = [];
      for (let k = 11; k >= 0; k--) {
        const d = new Date(t.getFullYear(), t.getMonth() - k, 1);
        out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
      }
      months = out;
    } else {
      months = Array.from({ length: 12 }, (_, k) => {
        const m = ((3 + k) % 12) + 1; const y = m >= 4 ? fy : fy + 1;
        return `${y}-${pad2(m)}`;
      });
    }
    const cnt = Object.fromEntries(months.map(m => [m, 0]));
    const val = Object.fromEntries(months.map(m => [m, 0]));
    proposals.forEach(p => {
      const ym = p.date.slice(0, 7);
      if (ym in cnt) { cnt[ym] += 1; val[ym] += p.value; }
    });
    return months.map(ym => ({
      label: `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(2, 4)}`,
      values: { count: cnt[ym] }, value: val[ym],
    }));
  }, [proposals, fy]);

  /* FY pipeline summary */
  const pipe = useMemo(() => {
    const out = Object.fromEntries(PIPE.map(s => [s.key, { count: 0, value: 0 }]));
    fyP.forEach(p => { out[p.pipeline].count += 1; out[p.pipeline].value += p.value; });
    return out;
  }, [fyP]);
  const pipeTotal = { count: fyP.length, value: fyP.reduce((s, p) => s + p.value, 0) };
  const pipeByFy = useMemo(() => fyList.map(f => {
    const ps = proposals.filter(p => p.fy === f);
    const c = k => ps.filter(p => p.pipeline === k).length;
    return { f, total: ps.length, closed: c('closed'), process: c('process'), lost: c('lost') };
  }), [proposals, fyList]);

  const decided = pipe.closed.count + pipe.lost.count;
  const winRate = decided ? pipe.closed.count / decided : null;
  const industryNR = industryMix.find(r => r.label === NR);

  if (!proposals.length && !opportunities.length) {
    return <Empty text="No Solution Tracker or BD Tracker rows yet." />;
  }

  return (
    <div style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity 0.2s' }}>
      {/* Filters — one row, scope everything below */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Financial year</label>
        <select className="form-input" style={{ width: 160, padding: '5px 8px', fontSize: 13 }} value={fy}
                onChange={e => setFy(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All years</option>
          {[...fyList].reverse().map(f => <option key={f} value={f}>{fyLabel(f)}{f === CURRENT_FY ? ' (current)' : ''}</option>)}
        </select>
        {undated > 0 && fy !== 'all' && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{undated} proposal{undated > 1 ? 's have' : ' has'} no date and appear{undated > 1 ? '' : 's'} only under "All years"</span>
        )}
        {refreshing && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>⟳ Updating…</span>}
      </div>

      {/* KPI tiles */}
      <div className="kpi-grid">
        <div className="kpi-card blue"><div className="kpi-label">Proposals · {fyName}</div><div className="kpi-value">{pipeTotal.count}</div><div className="kpi-sub">unique Proposal IDs</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Proposal value · {fyName}</div><div className="kpi-value">{fmtINR(pipeTotal.value)}</div><div className="kpi-sub">{pipeTotal.count ? `avg ${fmtINR(pipeTotal.value / pipeTotal.count)} per proposal` : 'no proposals'}</div></div>
        <div className="kpi-card green"><div className="kpi-label">Closed · {fyName}</div><div className="kpi-value">{fmtINR(pipe.closed.value)}</div><div className="kpi-sub">{pipe.closed.count} won · win rate {winRate != null ? `${Math.round(winRate * 100)}%` : '—'}</div></div>
        <div className="kpi-card accent"><div className="kpi-label">In Process · {fyName}</div><div className="kpi-value">{fmtINR(pipe.process.value)}</div><div className="kpi-sub">{pipe.process.count} open proposals</div></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        {/* 8 · FY pipeline summary (first: it is the headline) */}
        <Card title={`FY Pipeline Summary – ${fyName}`} metric="Closed vs Lost vs In Process — share of proposals and of value" wide
              table={<DataTable columns={['Financial year', 'Proposals', 'Closed', 'In Process', 'Lost', 'Closed %', 'Lost %', 'In Process %']}
                       rows={pipeByFy.slice().reverse().map(r => [fyLabel(r.f), r.total, r.closed, r.process, r.lost, fmtPct(r.closed, r.total), fmtPct(r.lost, r.total), fmtPct(r.process, r.total)])} />}>
          {!pipeTotal.count ? <Empty text={`No proposals in ${fyName}`} /> : (
            <div>
              {[['count', 'Proposals', v => fmtNum(v)], ['value', 'Value', fmtINR]].map(([k, lbl, f]) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 90px', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{lbl}</span>
                  <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', background: '#f4f4f1' }}>
                    {PIPE.map((s, i) => {
                      const v = pipe[s.key][k]; if (!v) return null;
                      const pct = (v / (pipeTotal[k] || 1)) * 100;
                      const last = PIPE.slice(i + 1).every(x => !pipe[x.key][k]);
                      return (
                        <div key={s.key} style={{ width: `${pct}%`, background: s.color, borderRight: last ? 'none' : '2px solid #fff' }}
                             onMouseMove={e => tip.show(e, `${s.icon} ${s.label}`, [{ label: lbl.toLowerCase(), value: f(v), color: s.color }, { label: 'of total', value: `${Math.round(pct)}%` }])}
                             onMouseLeave={tip.hide} />
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', textAlign: 'right' }}>{f(pipeTotal[k])}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 6 }}>
                {PIPE.map(s => (
                  <div key={s.key} style={{ border: '1px solid var(--border)', borderLeft: `4px solid ${s.color}`, borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)' }}>{s.icon} {s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-body)', marginTop: 2 }}>{fmtPct(pipe[s.key].count, pipeTotal.count)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pipe[s.key].count} proposals · {fmtINR(pipe[s.key].value)} ({fmtPct(pipe[s.key].value, pipeTotal.value)} of value)</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title="Development Category Mix" metric={`Proposal count + proposal value by development category · ${fyName}`}
              table={mixTable(devMix, 'Development category', 'Proposals')}>
          <CountValueBars rows={devMix} tip={tip} countWord="Proposals" empty={`No proposals in ${fyName}`} />
        </Card>

        <Card title="Industry Traction" metric={`Opportunity count + opportunity value by industry · ${fyName}`}
              table={mixTable(industryMix, 'Industry', 'Opportunities')}>
          <CountValueBars rows={industryMix} tip={tip} countWord="Opportunities" empty={`No opportunities in ${fyName}`} />
          {industryNR && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              "Not recorded" = no Industry filled in. Add an <strong>Industry</strong> column to the Solution Tracker Excel table,
              or map clients to industries in <code>src/config/clientIndustry.js</code>.
            </div>
          )}
        </Card>

        <Card title="Monthly Proposal Trend" metric={`Number of proposals submitted each month · ${fy === 'all' ? 'last 12 months' : fyName}`} wide
              table={<DataTable columns={['Month', 'Proposals', 'Value']} rows={monthly.map(m => [m.label, m.values.count, fmtINR(m.value)])} />}>
          <ColumnChart categories={monthly.map(m => ({ ...m, note: '' }))} series={[{ key: 'count', label: 'proposals', color: M.count }]}
                       tip={{ show: (e, title) => { const m = monthly.find(x => x.label === title); tip.show(e, title, [{ label: 'proposals', value: fmtNum(m?.values.count || 0), color: M.count }, { label: 'value', value: fmtINR(m?.value || 0) }]); }, hide: tip.hide }}
                       empty="No proposals yet" />
        </Card>

        <Card title="Type of Engagement" metric={`Standalone vs Journey — count + value · ${fyName}`}
              table={mixTable(engMix, 'Engagement type', 'Proposals')}>
          <CountValueBars rows={engMix} tip={tip} countWord="Proposals" empty={`No proposals in ${fyName}`} />
        </Card>

        <Card title="Customization Mix" metric={`Customized vs Standard vs New Creation — count + value · ${fyName}`}
              table={mixTable(custMix, 'Customization', 'Proposals')}>
          <CountValueBars rows={custMix} tip={tip} countWord="Proposals" empty={`No proposals in ${fyName}`} />
        </Card>

        <Card title="Line of Service Mix" metric={`Proposal count + value by service line · ${fyName}`}
              table={mixTable(losMix, 'Line of service', 'Proposals')}>
          <CountValueBars rows={losMix} tip={tip} countWord="Proposals" empty={`No proposals in ${fyName}`} />
        </Card>

        <Card title="Type of Service Mix" metric={`Proposal count + value by service type · ${fyName}`}
              table={mixTable(tosMix, 'Type of service', 'Proposals')}>
          <CountValueBars rows={tosMix} tip={tip} countWord="Proposals" empty={`No proposals in ${fyName}`} />
        </Card>
      </div>

      {tip.node}
    </div>
  );
}
