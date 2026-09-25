/**
 * OperationsDashboard — Operations view of the Dashboard, built from the
 * Engagement Calendar (one row = one session; a "project" = one EG ID).
 *
 * Definitions used everywhere on this page
 *   FY            Indian financial year, April → March  (Apr 2026 – Mar 2027 = "FY 26-27")
 *   Delivered     Status = Delivered
 *   Upcoming      Status Scheduled / Tentative / Re-Schedule with a start date from today onward
 *   Project       unique EG ID  (switch "Count by" to Sessions to count calendar rows instead)
 *   Days          the "Day" column (a session run by two consultants counts for each of them)
 *   Delivery mode Location VILT / Virtual / Online → Virtual; a real place → In-Person;
 *                 blank or #VALUE! → Not recorded
 *   Feedback      the "Feedback" column when it is a score between 0 and 5 (0 / blank = none)
 */
import { useMemo, useState } from 'react';

/* ─── Palette (validated: slots 1-2 and 3/7 of the reference categorical theme) ─── */
const C = {
  delivered: '#2a78d6',   // blue
  upcoming:  '#eb6834',   // orange
  inPerson:  '#1baf7a',   // aqua  (below 3:1 on white → always value-labelled + table view)
  virtual:   '#4a3aa7',   // violet
  unknown:   '#b8b6ae',   // neutral gray — "Not recorded", not a data series colour
  single:    '#2a78d6',
  grid:      '#e1e0d9',
  axis:      '#898781',
};
// Sequential blue ramp (light → dark) for the heat tables
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];

/* ─── Helpers ─── */
const pad2 = n => String(n).padStart(2, '0');
const todayISO = (() => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; })();
const fyStartOf = iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; };
const fyLabel = start => `FY ${pad2(start % 100)}-${pad2((start + 1) % 100)}`;
const CURRENT_FY = fyStartOf(todayISO);
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const NOT_A_PERSON = /^(euradicle|er pmo team|tbd|na|n\/a|-|—)$/i;
const UPCOMING_STATUS = /^(scheduled|tentative|re-?schedule)$/i;

const isDelivered = e => /^delivered$/i.test(clean(e.status));
const isUpcoming  = e => UPCOMING_STATUS.test(clean(e.status)) && e.startDate >= todayISO;
const daysOf      = e => (Number(e.day) > 0 ? Number(e.day) : 0);
const consultantsOf = e => [...new Set([e.consultant1, e.consultant2, e.consultant3]
  .map(clean).filter(n => n && !NOT_A_PERSON.test(n)))];
const deliveryMode = e => {
  const raw = clean(e.locationRaw ?? e.location);
  if (!raw || raw === '#VALUE!') return 'unknown';
  return /vilt|virtual|online|zoom|teams|webinar/i.test(raw) ? 'virtual' : 'inPerson';
};
const feedbackOf = e => { const n = Number(clean(e.feedback)); return n > 0 && n <= 5 ? n : null; };
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString('en-IN');
const niceMax = v => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  // steps divisible by 4 so the quarter gridlines land on round numbers
  return [1, 1.2, 1.6, 2, 2.4, 4, 8, 10].map(m => m * p).find(m => m >= v) || v;
};
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = iso => (iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');

/** Counts either unique EG IDs (projects) or rows (sessions). */
function makeCounter(countBy) {
  const sets = new Map();
  return {
    add(key, e) {
      if (!sets.has(key)) sets.set(key, countBy === 'projects' ? new Set() : []);
      const s = sets.get(key);
      if (countBy === 'projects') s.add(clean(e.egId) || `row-${e.sno}`); else s.push(1);
    },
    get(key) { const s = sets.get(key); return s ? (countBy === 'projects' ? s.size : s.length) : 0; },
  };
}

/* ─── Tooltip (one per dashboard) ─── */
function useTooltip() {
  const [tip, setTip] = useState(null);
  const show = (evt, title, rows) => setTip({ x: evt.clientX, y: evt.clientY, title, rows });
  const hide = () => setTip(null);
  const node = tip && (
    <div role="tooltip" style={{
      position: 'fixed', left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14, zIndex: 1200,
      background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.12)', fontSize: 12, pointerEvents: 'none', minWidth: 150, maxWidth: 230,
    }}>
      <div style={{ fontWeight: 700, color: 'var(--text-body)', marginBottom: 4 }}>{tip.title}</div>
      {tip.rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          {r.color && <span style={{ width: 12, height: 3, borderRadius: 2, background: r.color, flexShrink: 0 }} />}
          <strong style={{ color: '#0b0b0b' }}>{r.value}</strong>
          <span style={{ color: 'var(--muted)' }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
  return { show, hide, node };
}

/* ─── Card with chart / table toggle ─── */
function Card({ title, metric, legend, children, table, wide }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="card" style={{ gridColumn: wide ? '1 / -1' : undefined, display: 'flex', flexDirection: 'column' }}>
      <div className="card-header" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div className="card-title">{title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{metric}</div>
        </div>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                onClick={() => setAsTable(t => !t)} aria-pressed={asTable}>
          {asTable ? '📊 Chart' : '⊞ Table'}
        </button>
      </div>
      {legend && !asTable && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '10px 20px 0' }}>
          {legend.map(l => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-body)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />{l.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ padding: '14px 20px 18px', flex: 1 }}>
        {asTable ? table : children}
      </div>
    </div>
  );
}

function DataTable({ columns, rows, empty = 'No data' }) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div style={{ overflowX: 'auto', maxHeight: 360 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>{columns.map((c, i) => (
            <th key={c} style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontWeight: 700, position: 'sticky', top: 0, background: '#fff' }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((v, i) => (
              <td key={i} style={{ textAlign: i ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-body)' }}>{v}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Empty = ({ text }) => (
  <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{text}</div>
);

/* ─── Column chart (vertical bars; one or more series side by side) ─── */
function ColumnChart({ categories, series, tip, height = 200, empty = 'No delivered engagements yet', valueFmt = fmtNum }) {
  // at least 4 so small counts get whole-number gridlines
  const max = niceMax(Math.max(4, ...categories.flatMap(c => series.map(s => c.values[s.key] || 0))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f * 100) / 100);
  if (!categories.length) return <Empty text={empty} />;
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* y axis */}
      <div style={{ position: 'relative', width: 28, height, flexShrink: 0 }}>
        {ticks.map(t => (
          <span key={t} style={{ position: 'absolute', right: 0, bottom: `calc(${(t / max) * 100}% - 7px)`, fontSize: 10, color: C.axis }}>{fmtNum(t)}</span>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: 'relative', height, borderBottom: `1px solid ${C.axis}` }}>
          {ticks.slice(1).map(t => (
            <div key={t} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(t / max) * 100}%`, borderTop: `1px solid ${C.grid}` }} />
          ))}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '0 4px' }}>
            {categories.map(c => (
              <div key={c.label} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}
                   onMouseMove={e => tip.show(e, c.label, series.map(s => ({ label: s.label, value: valueFmt(c.values[s.key] || 0), color: s.color })))}
                   onMouseLeave={tip.hide}>
                {series.map(s => {
                  const v = c.values[s.key] || 0;
                  return (
                    <div key={s.key} style={{ flex: 1, maxWidth: 34, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-body)', marginBottom: 2 }}>{v ? valueFmt(v) : ''}</span>
                      <div style={{ width: '100%', height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: s.color, borderRadius: '4px 4px 0 0' }} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '4px 4px 0' }}>
          {categories.map(c => (
            <div key={c.label} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {c.label}{c.note && <div style={{ fontSize: 9 }}>{c.note}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Horizontal bars (stacked series) ─── */
function HBars({ rows, series, tip, max: fixedMax, valueFmt = fmtNum, empty, maxRows = 12 }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <Empty text={empty} />;
  const shown = showAll ? rows : rows.slice(0, maxRows);
  const max = fixedMax || niceMax(Math.max(...rows.map(r => series.reduce((s, x) => s + (r.values[x.key] || 0), 0))));
  return (
    <div>
      {shown.map(r => {
        const total = series.reduce((s, x) => s + (r.values[x.key] || 0), 0);
        return (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 34%) 1fr 52px', alignItems: 'center', gap: 8, padding: '4px 0' }}
               onMouseMove={e => tip.show(e, r.label, [
                 ...series.map(s => ({ label: s.label, value: valueFmt(r.values[s.key] || 0), color: s.color })),
                 ...(series.length > 1 ? [{ label: 'Total', value: valueFmt(total) }] : []),
                 ...(r.extra || []),
               ])}
               onMouseLeave={tip.hide}>
            <span title={r.label} style={{ fontSize: 12, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            <div style={{ display: 'flex', height: 14, background: '#f4f4f1', borderRadius: 4, overflow: 'hidden' }}>
              {series.map((s, i) => {
                const v = r.values[s.key] || 0;
                if (!v) return null;
                const last = series.slice(i + 1).every(x => !(r.values[x.key] > 0));
                return (
                  <div key={s.key} style={{
                    width: `${(v / max) * 100}%`, background: s.color,
                    borderRight: last ? 'none' : '2px solid #fff',
                    borderRadius: last ? '0 4px 4px 0' : 0,
                  }} />
                );
              })}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', textAlign: 'right' }}>{valueFmt(total)}</span>
          </div>
        );
      })}
      {rows.length > maxRows && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show top ' + maxRows : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/* ─── Heat table (rows × FY columns, sequential blue) ─── */
function HeatTable({ rows, columns, tip, unit, empty, maxRows = 15 }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <Empty text={empty} />;
  const max = Math.max(1, ...rows.flatMap(r => columns.map(c => r.values[c] || 0)));
  const shown = showAll ? rows : rows.slice(0, maxRows);
  const cell = v => {
    if (!v) return { background: 'transparent', color: C.axis };
    const i = Math.min(SEQ.length - 1, Math.max(0, Math.round((v / max) * (SEQ.length - 1))));
    return { background: SEQ[i], color: i >= 7 ? '#fff' : '#0b0b0b' };
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--muted)', fontWeight: 700 }} />
            {columns.map(c => <th key={c} style={{ padding: '4px 6px', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c}</th>)}
            <th style={{ padding: '4px 6px', color: 'var(--muted)', fontWeight: 700 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.label}>
              <td title={r.label} style={{ padding: '4px 6px', color: 'var(--text-body)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</td>
              {columns.map(c => {
                const v = r.values[c] || 0;
                return (
                  <td key={c} style={{ ...cell(v), textAlign: 'center', padding: '5px 6px', borderRadius: 4, fontWeight: 600, minWidth: 54 }}
                      onMouseMove={e => tip.show(e, `${r.label} · ${c}`, [{ label: unit, value: fmtNum(v) }])}
                      onMouseLeave={tip.hide}>
                    {v ? fmtNum(v) : '·'}
                  </td>
                );
              })}
              <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 800, color: 'var(--text-body)' }}>{fmtNum(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show top ' + maxRows : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/* ─── Page ─── */
export default function OperationsDashboard({ engagements, refreshing }) {
  const tip = useTooltip();
  const [countBy, setCountBy] = useState('projects');   // 'projects' (unique EG ID) | 'sessions' (rows)
  const [fy, setFy] = useState(CURRENT_FY);
  const unitWord = countBy === 'projects' ? 'projects' : 'sessions';

  // Only rows with a usable start date
  const rows = useMemo(() => engagements
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.startDate || ''))
    .map(e => ({ ...e, fy: fyStartOf(e.startDate) })), [engagements]);

  // Every FY from the first engagement up to the latest one (years with no data show as 0)
  const fyList = useMemo(() => {
    const years = rows.map(r => r.fy);
    const first = Math.min(CURRENT_FY, ...years);
    const last  = Math.max(CURRENT_FY, ...years);
    const out = [];
    for (let y = first; y <= last; y++) out.push(y);
    return out;
  }, [rows]);

  /* 1 · Project trend by FY + 2 · Delivery mode */
  const { trend, mode } = useMemo(() => {
    const delivered = makeCounter(countBy);
    const byMode = { inPerson: makeCounter(countBy), virtual: makeCounter(countBy), unknown: makeCounter(countBy) };
    rows.filter(isDelivered).forEach(e => {
      delivered.add(e.fy, e);
      byMode[deliveryMode(e)].add(e.fy, e);
    });
    const firstFy = fyList[0];
    const fys = fyList.filter(f => f >= firstFy && f <= CURRENT_FY);
    return {
      trend: fys.map(f => ({ label: fyLabel(f), note: f === CURRENT_FY ? 'to date' : '', values: { delivered: delivered.get(f) } })),
      mode: fys.map(f => ({ label: fyLabel(f), note: f === CURRENT_FY ? 'to date' : '', values: {
        inPerson: byMode.inPerson.get(f), virtual: byMode.virtual.get(f), unknown: byMode.unknown.get(f),
      } })),
    };
  }, [rows, fyList, countBy]);

  /* Selected-FY slices */
  const fyRows = useMemo(() => rows.filter(r => r.fy === fy), [rows, fy]);

  /* 3 · Top consultants (selected FY) */
  const consultants = useMemo(() => {
    const m = new Map();
    fyRows.forEach(e => {
      const kind = isDelivered(e) ? 'delivered' : isUpcoming(e) ? 'upcoming' : null;
      if (!kind) return;
      consultantsOf(e).forEach(name => {
        if (!m.has(name)) m.set(name, { delivered: 0, upcoming: 0 });
        m.get(name)[kind] += daysOf(e);
      });
    });
    return [...m.entries()]
      .map(([label, v]) => ({ label, values: v, total: v.delivered + v.upcoming }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [fyRows]);

  /* 4 · Client status (selected FY) */
  const clients = useMemo(() => {
    const del = makeCounter(countBy), up = makeCounter(countBy);
    const names = new Set();
    fyRows.forEach(e => {
      const name = clean(e.company);
      if (!name) return;
      if (isDelivered(e)) { del.add(name, e); names.add(name); }
      else if (isUpcoming(e)) { up.add(name, e); names.add(name); }
    });
    return [...names]
      .map(label => ({ label, values: { delivered: del.get(label), upcoming: up.get(label) } }))
      .map(r => ({ ...r, total: r.values.delivered + r.values.upcoming }))
      .sort((a, b) => b.total - a.total);
  }, [fyRows, countBy]);

  /* 5 · Recent program feedback (latest programs that have a score) */
  const feedback = useMemo(() => {
    const m = new Map();
    rows.forEach(e => {
      const score = feedbackOf(e);
      if (score == null) return;
      const key = clean(e.topic) || '(No topic)';
      if (!m.has(key)) m.set(key, { sum: 0, n: 0, latest: '', clients: new Set() });
      const g = m.get(key);
      g.sum += score; g.n += 1; g.clients.add(clean(e.company));
      if (e.startDate > g.latest) g.latest = e.startDate;
    });
    return [...m.entries()]
      .map(([label, g]) => ({
        label, latest: g.latest, avg: g.sum / g.n, n: g.n,
        values: { score: Math.round((g.sum / g.n) * 100) / 100 },
        extra: [{ label: 'sessions scored', value: String(g.n) }, { label: 'latest', value: fmtDate(g.latest) }],
        clients: [...g.clients].filter(Boolean).join(', '),
      }))
      .sort((a, b) => b.latest.localeCompare(a.latest))
      .slice(0, 10);
  }, [rows]);

  /* 6 · Consultant days – previous years   7 · Client status – historical */
  const pastFys = useMemo(() => fyList.filter(f => f < CURRENT_FY), [fyList]);
  const pastCols = pastFys.map(fyLabel);
  const consultantHistory = useMemo(() => {
    const m = new Map();
    rows.filter(e => e.fy < CURRENT_FY && isDelivered(e)).forEach(e => {
      consultantsOf(e).forEach(name => {
        if (!m.has(name)) m.set(name, {});
        const v = m.get(name); const col = fyLabel(e.fy);
        v[col] = (v[col] || 0) + daysOf(e);
      });
    });
    return [...m.entries()]
      .map(([label, values]) => ({ label, values, total: Object.values(values).reduce((s, x) => s + x, 0) }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [rows]);
  const clientHistory = useMemo(() => {
    const counters = new Map();
    rows.filter(isDelivered).forEach(e => {
      const name = clean(e.company); if (!name) return;
      if (!counters.has(name)) counters.set(name, makeCounter(countBy));
      counters.get(name).add(fyLabel(e.fy), e);
    });
    const cols = fyList.filter(f => f <= CURRENT_FY).map(fyLabel);
    return {
      cols,
      rows: [...counters.entries()]
        .map(([label, c]) => {
          const values = Object.fromEntries(cols.map(col => [col, c.get(col)]));
          return { label, values, total: Object.values(values).reduce((s, x) => s + x, 0) };
        })
        .filter(r => r.total > 0)
        .sort((a, b) => b.total - a.total),
    };
  }, [rows, fyList, countBy]);

  /* KPIs for the selected FY */
  const kpi = useMemo(() => {
    const del = makeCounter(countBy), up = makeCounter(countBy);
    let days = 0, fbSum = 0, fbN = 0;
    fyRows.forEach(e => {
      if (isDelivered(e)) { del.add('x', e); days += daysOf(e); }
      else if (isUpcoming(e)) { up.add('x', e); days += daysOf(e); }
      const f = feedbackOf(e); if (f != null && isDelivered(e)) { fbSum += f; fbN++; }
    });
    return { delivered: del.get('x'), upcoming: up.get('x'), days, feedback: fbN ? fbSum / fbN : null, fbN };
  }, [fyRows, countBy]);

  const fyName = fyLabel(fy);
  const legendDU = [{ label: 'Delivered', color: C.delivered }, { label: 'Upcoming', color: C.upcoming }];
  const seriesDU = [{ key: 'delivered', label: 'Delivered', color: C.delivered }, { key: 'upcoming', label: 'Upcoming', color: C.upcoming }];
  const seriesMode = [
    { key: 'inPerson', label: 'In-Person', color: C.inPerson },
    { key: 'virtual',  label: 'Virtual',   color: C.virtual },
    { key: 'unknown',  label: 'Not recorded', color: C.unknown },
  ];
  const unknownTotal = mode.reduce((s, m) => s + (m.values.unknown || 0), 0);

  return (
    <div style={{ opacity: refreshing ? 0.85 : 1, transition: 'opacity 0.2s' }}>
      {/* Filters — one row, scope everything below */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Financial year</label>
        <select className="form-input" style={{ width: 160, padding: '5px 8px', fontSize: 13 }} value={fy} onChange={e => setFy(Number(e.target.value))}>
          {[...fyList].reverse().map(f => <option key={f} value={f}>{fyLabel(f)}{f === CURRENT_FY ? ' (current)' : ''}</option>)}
        </select>
        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginLeft: 8 }}>Count by</label>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[['projects', 'Projects (EG ID)'], ['sessions', 'Sessions']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setCountBy(k)} aria-pressed={countBy === k} style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: countBy === k ? 'var(--primary)' : '#fff', color: countBy === k ? '#fff' : 'var(--text-body)',
            }}>{l}</button>
          ))}
        </div>
        {refreshing && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>⟳ Updating…</span>}
      </div>

      {/* KPI tiles — selected FY */}
      <div className="kpi-grid">
        <div className="kpi-card blue"><div className="kpi-label">Delivered · {fyName}</div><div className="kpi-value">{kpi.delivered}</div><div className="kpi-sub">{unitWord}</div></div>
        <div className="kpi-card accent"><div className="kpi-label">Upcoming · {fyName}</div><div className="kpi-value">{kpi.upcoming}</div><div className="kpi-sub">{unitWord} scheduled / tentative</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Consultant days · {fyName}</div><div className="kpi-value">{fmtNum(kpi.days)}</div><div className="kpi-sub">delivered + upcoming</div></div>
        <div className="kpi-card green"><div className="kpi-label">Avg feedback · {fyName}</div><div className="kpi-value">{kpi.feedback != null ? kpi.feedback.toFixed(2) : '—'}</div><div className="kpi-sub">{kpi.fbN ? `out of 5 · ${kpi.fbN} scored sessions` : 'no scores recorded yet'}</div></div>
      </div>

      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <Card title="Project Trend by FY" metric={`Total ${unitWord} delivered per financial year`}
              table={<DataTable columns={['Financial year', `Delivered ${unitWord}`]} rows={trend.map(t => [t.label + (t.note ? ' (to date)' : ''), t.values.delivered])} />}>
          <ColumnChart categories={trend} series={[{ key: 'delivered', label: `${unitWord} delivered`, color: C.single }]} tip={tip} />
        </Card>

        <Card title="Delivery Mode" metric={`In-Person vs Virtual ${unitWord} delivered per FY`}
              legend={seriesMode.filter(s => s.key !== 'unknown' || unknownTotal > 0)}
              table={<DataTable columns={['Financial year', 'In-Person', 'Virtual', 'Not recorded']} rows={mode.map(m => [m.label, m.values.inPerson, m.values.virtual, m.values.unknown])} />}>
          <ColumnChart categories={mode} series={seriesMode.filter(s => s.key !== 'unknown' || unknownTotal > 0)} tip={tip} />
          {unknownTotal > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
              "Not recorded" = Location is blank or shows #VALUE! in Excel (convert the Location column to text to fix).
            </div>
          )}
        </Card>

        <Card title={`Top Consultants – ${fyName}`} metric="Days Delivered + Days Upcoming = Total Consultant Days" legend={legendDU}
              table={<DataTable columns={['Consultant', 'Days delivered', 'Days upcoming', 'Total days']} rows={consultants.map(c => [c.label, fmtNum(c.values.delivered), fmtNum(c.values.upcoming), fmtNum(c.total)])} empty={`No consultant days in ${fyName}`} />}>
          <HBars rows={consultants} series={seriesDU} tip={tip} empty={`No consultant days in ${fyName}`} maxRows={10} />
        </Card>

        <Card title={`${fyName} Client Status`} metric={`Delivered + Upcoming ${unitWord} per client`} legend={legendDU}
              table={<DataTable columns={['Client', 'Delivered', 'Upcoming', 'Total']} rows={clients.map(c => [c.label, c.values.delivered, c.values.upcoming, c.total])} empty={`No engagements in ${fyName}`} />}>
          <HBars rows={clients} series={seriesDU} tip={tip} empty={`No engagements in ${fyName}`} maxRows={10} />
        </Card>

        <Card title="Recent Program Feedback" metric="Average feedback score out of 5 — latest 10 programs with a score" wide
              table={<DataTable columns={['Program', 'Avg score / 5', 'Sessions scored', 'Latest session', 'Clients']} rows={feedback.map(f => [f.label, f.avg.toFixed(2), f.n, fmtDate(f.latest), f.clients])} empty="No feedback scores recorded yet" />}>
          <HBars rows={feedback} series={[{ key: 'score', label: 'avg score / 5', color: C.single }]} tip={tip} max={5}
                 valueFmt={v => Number(v).toFixed(2)} empty="No feedback scores recorded yet" maxRows={10} />
        </Card>

        <Card title="Consultant Days – Previous Years" metric="Consultant delivery days by FY (delivered only)" wide
              table={<DataTable columns={['Consultant', ...pastCols, 'Total']} rows={consultantHistory.map(r => [r.label, ...pastCols.map(c => fmtNum(r.values[c] || 0)), fmtNum(r.total)])} empty="No previous-year deliveries" />}>
          <HeatTable rows={consultantHistory} columns={pastCols} tip={tip} unit="days delivered" empty="No previous-year deliveries" />
        </Card>

        <Card title="Client Status – Historical by FY" metric={`${unitWord[0].toUpperCase() + unitWord.slice(1)} delivered per client by FY`} wide
              table={<DataTable columns={['Client', ...clientHistory.cols, 'Total']} rows={clientHistory.rows.map(r => [r.label, ...clientHistory.cols.map(c => r.values[c] || 0), r.total])} empty="No deliveries yet" />}>
          <HeatTable rows={clientHistory.rows} columns={clientHistory.cols} tip={tip} unit={`${unitWord} delivered`} empty="No deliveries yet" />
        </Card>
      </div>

      {tip.node}
    </div>
  );
}

// Shared building blocks for the other department dashboards
export { C, SEQ, pad2, todayISO, fyStartOf, fyLabel, CURRENT_FY, clean, fmtNum, niceMax, MONTHS, useTooltip, Card, DataTable, Empty, ColumnChart, HBars, HeatTable };
