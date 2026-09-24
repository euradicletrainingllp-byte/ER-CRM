import { useState, useEffect, useMemo } from 'react';
import { getEngagements } from '../services/api.js';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { useExcelFilters, ExcelFilterButtons, FILTER_COLUMNS } from '../components/ExcelFilter.jsx';

// Year / Month are handled by the calendar's own month navigation
const ER_FILTER_COLUMNS = FILTER_COLUMNS.filter(c => c.key !== 'year' && c.key !== 'month');

/* ─── Color system ───────────────────────────────────────────────────────── */
// Light pastel bg + dark text = readable bars + visible status border
const CLIENT_PALETTE = [
  { bg:'#dbeafe', text:'#1e3a8a', accent:'#2563eb' },  // blue
  { bg:'#d1fae5', text:'#064e3b', accent:'#059669' },  // green
  { bg:'#fce7f3', text:'#831843', accent:'#db2777' },  // pink
  { bg:'#ede9fe', text:'#4c1d95', accent:'#7c3aed' },  // purple
  { bg:'#cffafe', text:'#0c4a6e', accent:'#0891b2' },  // cyan
  { bg:'#fef3c7', text:'#78350f', accent:'#d97706' },  // amber
  { bg:'#fee2e2', text:'#7f1d1d', accent:'#dc2626' },  // red
  { bg:'#ccfbf1', text:'#134e4a', accent:'#0f766e' },  // teal
  { bg:'#e0e7ff', text:'#312e81', accent:'#4338ca' },  // indigo
  { bg:'#ffedd5', text:'#7c2d12', accent:'#c2410c' },  // orange
  { bg:'#dcfce7', text:'#14532d', accent:'#16a34a' },  // emerald
  { bg:'#f3e8ff', text:'#581c87', accent:'#9333ea' },  // violet
  { bg:'#e0f2fe', text:'#0c4a6e', accent:'#0284c7' },  // sky
  { bg:'#fef9c3', text:'#713f12', accent:'#ca8a04' },  // yellow
  { bg:'#fdf4ff', text:'#701a75', accent:'#a21caf' },  // fuchsia
];

// Left-border stripe = status (clearly visible against light bar bg)
const STATUS_COLORS = {
  Delivered:     '#10b981',
  Scheduled:     '#3b82f6',
  Tentative:     '#f59e0b',
  Cancelled:     '#ef4444',
  Postponed:     '#8b5cf6',
  'Re-Schedule': '#f97316',
};

const STATUS_BG = {
  Delivered:     '#d1fae5',
  Scheduled:     '#dbeafe',
  Tentative:     '#fef3c7',
  Cancelled:     '#fee2e2',
  Postponed:     '#ede9fe',
  'Re-Schedule': '#ffedd5',
};

const MONTH_NAMES = ['January','February','March','April','May','June','July',
                     'August','September','October','November','December'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function clientHash(s) {
  let h = 5381;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getClientPalette(eng) {
  return CLIENT_PALETTE[clientHash(eng.company || '') % CLIENT_PALETTE.length];
}

function getStatusColor(eng) {
  return STATUS_COLORS[eng.status] || '#64748b';
}

/* ─── Date helpers ───────────────────────────────────────────────────────── */
function parseDate(s) {
  if (!s || s === '—') return null;
  const str = String(s).trim();
  const p = str.split('-');
  if (p.length === 3 && p[0].length === 4)
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
  const n = Number(str);
  if (!isNaN(n) && n > 25000)
    return new Date(Math.round((n - 25569) * 86400 * 1000));
  return null;
}

function toYMD(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function buildMonthGrid(year, month) {
  const firstDay    = new Date(Date.UTC(year, month, 1));
  const lastDay     = new Date(Date.UTC(year, month + 1, 0));
  const startOffset = firstDay.getUTCDay();
  const days = [];
  for (let i = startOffset - 1; i >= 0; i--)
    days.push({ date: new Date(Date.UTC(year, month, -i)), current: false });
  for (let i = 1; i <= lastDay.getUTCDate(); i++)
    days.push({ date: new Date(Date.UTC(year, month, i)), current: true });
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++)
    days.push({ date: new Date(Date.UTC(year, month + 1, i)), current: false });
  return days;
}

function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return s || '—';
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

/* ─── Session Detail Modal ───────────────────────────────────────────────── */
function SessionModal({ eng, onClose }) {
  const pal         = getClientPalette(eng);
  const statusColor = getStatusColor(eng);
  const statusBg    = STATUS_BG[eng.status] || '#f1f5f9';
  const consultants = [eng.consultant1, eng.consultant2, eng.consultant3].filter(Boolean);

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.38)', zIndex:1000 }} />
      <div style={{
        position:'fixed', top:'50%', left:'50%',
        transform:'translate(-50%,-50%)',
        background:'#fff', borderRadius:14,
        boxShadow:'0 28px 72px rgba(0,0,0,0.22)',
        width:420, maxWidth:'94vw',
        zIndex:1001, overflow:'hidden',
      }}>
        {/* Modal header: accent color (dark tone) for strong header */}
        <div style={{ background: pal.accent, padding:'16px 20px 14px', position:'relative' }}>
          <button onClick={onClose} style={{
            position:'absolute', top:10, right:12,
            background:'rgba(255,255,255,0.25)', border:'none', borderRadius:6,
            fontSize:16, cursor:'pointer', color:'#fff',
            width:26, height:26, display:'flex', alignItems:'center', justifyContent:'center',
          }}>&#x2715;</button>
          <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.65)',
                        textTransform:'uppercase', letterSpacing:0.8 }}>
            {eng.egId || 'Engagement'}
          </div>
          <div style={{ fontSize:17, fontWeight:800, color:'#fff', marginTop:4, lineHeight:'22px' }}>
            {eng.topic || '—'}
          </div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.85)', marginTop:3, fontStyle:'italic' }}>
            {eng.company}
          </div>
          {/* Status + Offering tags */}
          <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
            <span style={{
              background: statusBg, color: statusColor,
              border: `1.5px solid ${statusColor}`,
              borderRadius:20, padding:'2px 10px',
              fontSize:11, fontWeight:800,
            }}>{eng.status}</span>
            {eng.offering && (
              <span style={{
                background:'rgba(255,255,255,0.9)', color: pal.accent,
                border:'1.5px solid rgba(255,255,255,0.6)',
                borderRadius:20, padding:'2px 10px',
                fontSize:11, fontWeight:700,
              }}>{eng.offering}</span>
            )}
            {eng.serviceType && (
              <span style={{
                background:'rgba(255,255,255,0.2)', color:'#fff',
                border:'1px solid rgba(255,255,255,0.4)',
                borderRadius:20, padding:'2px 10px',
                fontSize:11, fontWeight:600,
              }}>{eng.serviceType}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:'16px 20px 20px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 24px', marginBottom:16 }}>
            {[
              ['Start Date',  fmtDate(eng.startDate)],
              ['End Date',    fmtDate(eng.endDate)],
              ['Duration',    eng.day ? `${eng.day} day${eng.day != 1 ? 's' : ''}` : '—'],
              ['Location',    eng.location || '—'],
              ['Sector',      eng.sector || '—'],
              ['Contract Status', eng.poStatus || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
                              textTransform:'uppercase', letterSpacing:0.5, marginBottom:2 }}>{lbl}</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1a3a5c' }}>{val}</div>
              </div>
            ))}
          </div>

          {consultants.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
                            textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Consultants</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {consultants.map((c, i) => (
                  <span key={i} style={{ background: pal.bg, color: pal.text,
                    borderRadius:12, padding:'3px 10px', fontSize:11, fontWeight:700,
                    border:`1px solid ${pal.accent}44` }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        paddingTop:12, borderTop:'1px solid #f1f5f9' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:12, height:12, borderRadius:3,
                            background: pal.accent, border:`2px solid ${pal.bg}` }} />
              <span style={{ fontSize:12, color:'#64748b', fontWeight:600 }}>{eng.company}</span>
            </div>
            {eng.price > 0 && (
              <span style={{ fontSize:14, fontWeight:800, color:'#059669' }}>
                &#x20b9;{Number(eng.price).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Engagement Bar ─────────────────────────────────────────────────────── */
// Light pastel bg  → readable dark text
// Thick left border → status color clearly visible against light bg
// Diagonal texture on middle days → multi-day continuation cue
function EngBar({ eng, ymd, onSelect }) {
  const pal         = getClientPalette(eng);
  const statusColor = getStatusColor(eng);
  const start  = parseDate(eng.startDate);
  const end    = parseDate(eng.endDate) || start;
  const isStart  = start && toYMD(start) === ymd;
  const isEnd    = end   && toYMD(end)   === ymd;
  const isSingle = isStart && isEnd;
  const isMiddle = !isStart && !isEnd;

  const br = isSingle ? 4 : isStart ? '4px 0 0 4px' : isEnd ? '0 4px 4px 0' : 0;

  // Subtle dark diagonal on light bg — clearly signals continuation
  const bgImage = isMiddle
    ? `repeating-linear-gradient(-55deg,transparent 0px,transparent 5px,rgba(0,0,0,0.07) 5px,rgba(0,0,0,0.07) 7px)`
    : undefined;

  return (
    <div
      onClick={() => onSelect(eng)}
      title={`${eng.topic} — ${eng.company} [${eng.status}]`}
      onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.93)'}
      onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
      style={{
        background: pal.bg,
        backgroundImage: bgImage,
        borderLeft: `4px solid ${statusColor}`,
        color: pal.text,
        padding: isStart ? '2px 5px 3px 4px' : '0 4px',
        marginBottom: 2,
        borderRadius: br,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'filter 0.15s',
        minHeight: isStart ? 30 : 13,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {isStart && (
        <>
          <div style={{ fontSize:10, fontWeight:800, whiteSpace:'nowrap',
                        overflow:'hidden', textOverflow:'ellipsis', lineHeight:'15px' }}>
            {eng.topic || '—'}
          </div>
          <div style={{ fontSize:9, fontWeight:600, opacity:0.8, whiteSpace:'nowrap',
                        overflow:'hidden', textOverflow:'ellipsis', lineHeight:'12px' }}>
            {eng.company}
          </div>
          {eng.offering && (
            <div style={{
              fontSize:8, fontWeight:700, whiteSpace:'nowrap',
              overflow:'hidden', textOverflow:'ellipsis',
              lineHeight:'11px', marginTop:1,
              background: pal.accent + '22',
              color: pal.accent,
              borderRadius:2, padding:'0 3px',
              display:'inline-block', maxWidth:'100%',
            }}>
              {eng.offering}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Calendar Day Cell ──────────────────────────────────────────────────── */
function DayCell({ date, current, engagements, today, onSelectEng }) {
  const ymd       = toYMD(date);
  const isToday   = ymd === today;
  const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const MAX_SHOW  = 3;
  const visible   = engagements.slice(0, MAX_SHOW);
  const extra     = engagements.length - MAX_SHOW;

  return (
    <div style={{
      minHeight: 110,
      padding: '6px 4px 4px',
      background: !current ? '#f9fafb' : isWeekend ? '#fefefe' : '#fff',
      borderRight: '1px solid #f1f5f9',
      borderBottom: '1px solid #f1f5f9',
      boxSizing: 'border-box',
    }}>
      <div style={{ marginBottom: 4 }}>
        <span style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:22, height:22, borderRadius:'50%', fontSize:11,
          fontWeight: isToday ? 800 : current ? 600 : 400,
          color: isToday ? '#fff' : current ? '#1a3a5c' : '#c8d3dd',
          background: isToday ? '#2563eb' : 'transparent',
        }}>
          {date.getUTCDate()}
        </span>
      </div>
      {visible.map((eng, i) => (
        <EngBar key={`${eng.egId || i}-${i}`} eng={eng} ymd={ymd} onSelect={onSelectEng} />
      ))}
      {extra > 0 && (
        <div style={{ fontSize:10, color:'#64748b', fontWeight:700, paddingLeft:4 }}>
          +{extra} more
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function ERCalendar({ onRefreshed }) {
  const now = new Date();
  const [year,     setYear]     = useState(now.getUTCFullYear());
  const [month,    setMonth]    = useState(now.getUTCMonth());
  const [data,     setData]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await getEngagements();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Excel-style filters — calendar only shows engagements that pass them
  const filterState = useExcelFilters(data, ER_FILTER_COLUMNS);
  const shown = filterState.filtered;

  const days  = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const today = toYMD(now);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y-1); setMonth(11); }
    else setMonth(m => m-1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y+1); setMonth(0); }
    else setMonth(m => m+1);
  };
  const goToday = () => { setYear(now.getUTCFullYear()); setMonth(now.getUTCMonth()); };

  const dayEngMap = useMemo(() => {
    const map = {};
    days.forEach(({ date }) => {
      const ymd = toYMD(date);
      map[ymd] = shown.filter(eng => {
        const start = parseDate(eng.startDate);
        const end   = parseDate(eng.endDate) || start;
        if (!start) return false;
        return ymd >= toYMD(start) && ymd <= toYMD(end);
      });
    });
    return map;
  }, [days, shown]);

  const thisMonthEngs = useMemo(() => {
    return shown.filter(eng => {
      const start = parseDate(eng.startDate);
      const end   = parseDate(eng.endDate) || start;
      if (!start) return false;
      const monthStart = toYMD(new Date(Date.UTC(year, month, 1)));
      const monthEnd   = toYMD(new Date(Date.UTC(year, month + 1, 0)));
      return toYMD(start) <= monthEnd && toYMD(end) >= monthStart;
    });
  }, [shown, year, month]);

  // Dynamic client legend for this month only
  const clientsThisMonth = useMemo(() => {
    const seen = new Map();
    thisMonthEngs.forEach(eng => {
      if (!seen.has(eng.company)) seen.set(eng.company, getClientPalette(eng));
    });
    return [...seen.entries()];
  }, [thisMonthEngs]);

  if (loading) return <LoadingState message="Loading ER Calendar from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      {selected && <SessionModal eng={selected} onClose={() => setSelected(null)} />}

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:18 }}>
        {[
          { label:'Sessions This Month', value:thisMonthEngs.length, sub:'engagements' },
          { label:'Delivered',  value:thisMonthEngs.filter(e=>e.status==='Delivered').length,  sub:'completed' },
          { label:'Scheduled',  value:thisMonthEngs.filter(e=>e.status==='Scheduled').length,  sub:'confirmed' },
          { label:'Tentative',  value:thisMonthEngs.filter(e=>e.status==='Tentative').length,  sub:'pending' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="kpi-card accent" style={{ padding:'14px 18px' }}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, flexWrap:'wrap' }}>
        {['‹','›'].map((ch, i) => (
          <button key={ch} onClick={i===0 ? prevMonth : nextMonth} style={{
            width:34, height:34, borderRadius:8, border:'1px solid #e2e8f0',
            background:'#fff', cursor:'pointer', fontSize:18, display:'flex',
            alignItems:'center', justifyContent:'center', color:'#1a3a5c', fontWeight:700,
          }}>{ch}</button>
        ))}
        <div style={{ flex:1 }}>
          <span style={{ fontSize:20, fontWeight:800, color:'#1a3a5c' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <span style={{ fontSize:12, color:'#94a3b8', marginLeft:10 }}>
            {thisMonthEngs.length} session{thisMonthEngs.length!==1?'s':''} · click a bar for details
          </span>
        </div>
        <button onClick={goToday} style={{
          padding:'5px 14px', borderRadius:8, border:'1px solid #2563eb',
          background:'#eff6ff', color:'#2563eb', fontWeight:700, fontSize:12, cursor:'pointer',
        }}>Today</button>
        <button className="btn btn-outline btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      {/* Excel-style Filter Bar */}
      <div style={{
        background:'#fff', border:'1px solid #e2e8f0', borderRadius:10,
        padding:'12px 16px', marginBottom:14,
        display:'flex', flexWrap:'wrap', gap:8, alignItems:'center',
      }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#64748b', marginRight:4 }}>🔽 Filter by:</span>
        <ExcelFilterButtons state={filterState} sortable={false} />
        {filterState.activeFilters > 0 && (
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>
            Showing <strong>{shown.length}</strong> of {data.length} engagements
          </span>
        )}
      </div>

      {/* Legends */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
        {/* Status → left border color */}
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
                         textTransform:'uppercase', letterSpacing:0.6, minWidth:68 }}>Status</span>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} style={{ display:'flex', alignItems:'center', gap:5,
                                       fontSize:11, color:'#475569', fontWeight:600 }}>
              <span style={{ width:4, height:14, borderRadius:1,
                             background:color, display:'inline-block', flexShrink:0 }} />
              {status}
            </div>
          ))}
        </div>
        {/* Clients → bar background for this month */}
        {clientsThisMonth.length > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, fontWeight:700, color:'#94a3b8',
                           textTransform:'uppercase', letterSpacing:0.6, minWidth:68 }}>Clients</span>
            {clientsThisMonth.map(([company, pal]) => (
              <div key={company} style={{ display:'flex', alignItems:'center', gap:5,
                                          fontSize:11, color:pal.text, fontWeight:700 }}>
                <span style={{ width:14, height:14, borderRadius:3,
                               background:pal.bg, border:`2px solid ${pal.accent}`,
                               display:'inline-block', flexShrink:0 }} />
                {company}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calendar */}
      <div style={{
        background:'#fff', borderRadius:12, border:'1px solid #e2e8f0',
        overflow:'hidden', boxShadow:'0 2px 10px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)',
                      borderBottom:'2px solid #e2e8f0' }}>
          {DAY_NAMES.map((d, i) => (
            <div key={d} style={{
              padding:'10px 0', textAlign:'center', fontSize:11, fontWeight:800,
              color:(i===0||i===6)?'#ef4444':'#64748b',
              textTransform:'uppercase', letterSpacing:0.7, background:'#f8fafc',
            }}>{d}</div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
          {days.map(({ date, current }, idx) => (
            <DayCell
              key={idx} date={date} current={current}
              engagements={dayEngMap[toYMD(date)] || []}
              today={today} onSelectEng={setSelected}
            />
          ))}
        </div>
      </div>

      <div style={{ textAlign:'center', marginTop:10, fontSize:11, color:'#94a3b8' }}>
        Bar fill = client · Left border = status · Diagonal lines = multi-day continuation · {data.length} total engagements
      </div>
    </div>
  );
}
