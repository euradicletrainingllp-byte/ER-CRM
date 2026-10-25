/**
 * ENGAGEMENT CALENDAR — "Calendar" view (month grid)
 * ===================================================
 * Pure display: EngagementCalendar.jsx passes the rows it already loaded (same range,
 * same filters), so switching List ⇄ Calendar never loads anything again.
 * One grid per month in the selected range; each grid is as tall as the screen allows.
 */
import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { LinkButton } from '../components/LinkButton.jsx';

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
function SessionModal({ eng, onClose, onEdit }) {
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
              ...(eng.proposalLink ? [['Proposal', <LinkButton url={eng.proposalLink} label="Open proposal" compact />]] : []),
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
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {eng.price > 0 && (
                <span style={{ fontSize:14, fontWeight:800, color:'#059669' }}>
                  &#x20b9;{Number(eng.price).toLocaleString('en-IN')}
                </span>
              )}
              {onEdit && <button className="btn btn-outline btn-sm" onClick={() => { onClose(); onEdit(eng); }}>✎ Edit</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Engagement Bar ─────────────────────────────────────────────────────── */
// One fixed-height line per session so the month always fits on screen:
// light client fill + status-coloured left border; diagonal texture = continuation day.
const BAR_H = 18, BAR_GAP = 2;
function EngBar({ eng, ymd, onSelect }) {
  const pal         = getClientPalette(eng);
  const statusColor = getStatusColor(eng);
  const start  = parseDate(eng.startDate);
  const end    = parseDate(eng.endDate) || start;
  const isStart  = start && toYMD(start) === ymd;
  const isEnd    = end   && toYMD(end)   === ymd;
  const isSingle = isStart && isEnd;
  const isMiddle = !isStart && !isEnd;
  const weekStart = new Date(ymd + 'T12:00:00Z').getUTCDay() === 0;
  const showText = isStart || weekStart;            // repeat the title on a new week row
  const br = isSingle ? 4 : isStart ? '4px 0 0 4px' : isEnd ? '0 4px 4px 0' : 0;
  const bgImage = isMiddle || (!isStart && !showText)
    ? 'repeating-linear-gradient(-55deg,transparent 0px,transparent 5px,rgba(0,0,0,0.07) 5px,rgba(0,0,0,0.07) 7px)'
    : undefined;

  return (
    <div
      onClick={() => onSelect(eng)}
      title={`${eng.topic || '—'} — ${eng.company} [${eng.status}]${eng.offering ? ' · ' + eng.offering : ''}`}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.93)'; }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)'; }}
      style={{
        height: BAR_H, marginBottom: BAR_GAP, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 4, padding: '0 5px 0 4px', overflow: 'hidden',
        background: pal.bg, backgroundImage: bgImage, borderLeft: `4px solid ${statusColor}`, borderRadius: br,
        color: pal.text, cursor: 'pointer', userSelect: 'none', transition: 'filter 0.15s',
        fontSize: 10.5, lineHeight: `${BAR_H}px`, whiteSpace: 'nowrap',
      }}
    >
      {showText && <>
        <b style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' }}>{eng.topic || '—'}</b>
        <span style={{ opacity: 0.75, fontWeight: 600, overflow: 'hidden', textOverflow: 'clip', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '38%', flexShrink: 0 }}>· {eng.company}</span>
      </>}
    </div>
  );
}

/* ─── Calendar Day Cell ──────────────────────────────────────────────────── */
function DayCell({ date, current, engagements, today, maxShow, onSelectEng, onMore }) {
  const ymd       = toYMD(date);
  const isToday   = ymd === today;
  const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  // When everything does not fit, keep one line for "+N more"
  const fitAll    = engagements.length <= maxShow;
  const shown     = fitAll ? engagements : engagements.slice(0, Math.max(0, maxShow - 1));
  const extra     = engagements.length - shown.length;

  return (
    <div style={{
      minHeight: 0, minWidth: 0, overflow: 'hidden', padding: '3px 4px 2px',
      background: isToday ? '#f5f9ff' : !current ? '#f9fafb' : isWeekend ? '#fdfdfe' : '#fff',
      borderRight: '1px solid #eef1f5', borderBottom: '1px solid #eef1f5', boxSizing: 'border-box',
    }}>
      <div style={{ height: 20, marginBottom: 2, display: 'flex', alignItems: 'center' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: '50%', fontSize: 11,
          fontWeight: isToday ? 800 : current ? 600 : 400,
          color: isToday ? '#fff' : current ? '#1a3a5c' : '#c8d3dd',
          background: isToday ? '#2563eb' : 'transparent',
        }}>{date.getUTCDate()}</span>
      </div>
      {shown.map((eng, i) => (
        <EngBar key={`${eng.egId || i}-${i}`} eng={eng} ymd={ymd} onSelect={onSelectEng} />
      ))}
      {extra > 0 && (
        <button type="button" onClick={() => onMore(ymd, engagements)} style={{
          height: BAR_H, border: 'none', background: '#eef2f7', borderRadius: 4, width: '100%', textAlign: 'left',
          fontSize: 10.5, color: '#334155', fontWeight: 700, padding: '0 6px', cursor: 'pointer', fontFamily: 'inherit',
        }}>+{extra} more</button>
      )}
    </div>
  );
}

/* ─── All sessions of one day ────────────────────────────────────────────── */
function DayModal({ ymd, list, onPick, onClose }) {
  const d = new Date(ymd + 'T12:00:00Z');
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.2)', width: 420, maxWidth: '94vw', maxHeight: '80vh', overflow: 'auto', zIndex: 1001, padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <b style={{ fontSize: 15, color: '#1a3a5c', flex: 1 }}>{DAY_NAMES[d.getUTCDay()]}, {d.getUTCDate()} {MONTH_NAMES[d.getUTCMonth()]} {d.getUTCFullYear()}</b>
          <span style={{ fontSize: 12, color: '#64748b', marginRight: 10 }}>{list.length} sessions</span>
          <button onClick={onClose} style={{ border: 'none', background: '#f1f5f9', borderRadius: 6, width: 26, height: 26, cursor: 'pointer' }}>&#x2715;</button>
        </div>
        {list.map((eng, i) => {
          const pal = getClientPalette(eng);
          return (
            <div key={i} onClick={() => onPick(eng)} style={{ background: pal.bg, borderLeft: `4px solid ${getStatusColor(eng)}`, color: pal.text,
              borderRadius: 6, padding: '6px 10px', marginBottom: 6, cursor: 'pointer' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{eng.topic || '—'}</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>{eng.company} · {eng.status}{eng.consultant1 ? ` · ${eng.consultant1}` : ''}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── One month ────────────────────────────────────────────────────────── */
const sameDayOrder = (a, b) => String(a.startDate).localeCompare(String(b.startDate)) || String(a.company).localeCompare(String(b.company));
const inMonth = (eng, year, month) => {
  const start = parseDate(eng.startDate); const end = parseDate(eng.endDate) || start;
  if (!start) return false;
  return toYMD(start) <= toYMD(new Date(Date.UTC(year, month + 1, 0))) && toYMD(end) >= toYMD(new Date(Date.UTC(year, month, 1)));
};

function MonthGrid({ year, month, rows, today, height, isCurrent, onSelect, onMore }) {
  const [rowH, setRowH] = useState(100);
  const bodyRef = useRef(null);
  const days = useMemo(() => {
    const all = buildMonthGrid(year, month);
    const weeks = Math.ceil((all.findLastIndex(d => d.current) + 1) / 7);
    return all.slice(0, weeks * 7);
  }, [year, month]);
  const weeks = days.length / 7;
  useLayoutEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const measure = () => setRowH(el.clientHeight / weeks);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);
  const maxShow = Math.max(1, Math.floor((rowH - 5 - 22) / (BAR_H + BAR_GAP)));

  const monthRows = useMemo(() => rows.filter(e => inMonth(e, year, month)), [rows, year, month]);
  const dayEngMap = useMemo(() => {
    const map = {};
    days.forEach(({ date }) => {
      const ymd = toYMD(date);
      map[ymd] = monthRows.filter(eng => {
        const start = parseDate(eng.startDate); const end = parseDate(eng.endDate) || start;
        return ymd >= toYMD(start) && ymd <= toYMD(end);
      }).sort(sameDayOrder);
    });
    return map;
  }, [days, monthRows]);
  const count = st => monthRows.filter(e => e.status === st).length;

  return (
    <div style={{ height, minHeight: 440, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#1a3a5c', marginRight: 4 }}>{MONTH_NAMES[month]} {year}</span>
        {isCurrent && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#1a3a5c', borderRadius: 20, padding: '1px 8px' }}>Current month</span>}
        {[['Sessions', monthRows.length, '#1a3a5c'], ['Delivered', count('Delivered'), STATUS_COLORS.Delivered],
          ['Scheduled', count('Scheduled'), STATUS_COLORS.Scheduled], ['Tentative', count('Tentative'), STATUS_COLORS.Tentative]].map(([l, v, c]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, background: '#fff', border: '1px solid #e2e8f0',
            borderLeft: `3px solid ${c}`, borderRadius: 6, padding: '1px 8px', fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            <b style={{ fontSize: 12.5, color: '#1a3a5c', fontWeight: 800 }}>{v}</b>{l}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }} title="Bar fill = client · left border = status · diagonal lines = multi-day continuation">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>
              <span style={{ width: 4, height: 11, borderRadius: 1, background: color, display: 'inline-block' }} />{status}
            </span>
          ))}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12,
        border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '2px solid #e2e8f0', flexShrink: 0 }}>
          {DAY_NAMES.map((d, i) => (
            <div key={d} style={{ padding: '6px 0', textAlign: 'center', fontSize: 11, fontWeight: 800, color: (i === 0 || i === 6) ? '#ef4444' : '#64748b',
              textTransform: 'uppercase', letterSpacing: 0.7, background: '#f8fafc' }}>{d}</div>
          ))}
        </div>
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {days.map(({ date, current }, idx) => (
            <DayCell key={idx} date={date} current={current} engagements={dayEngMap[toYMD(date)] || []}
              today={today} maxShow={maxShow} onSelectEng={onSelect} onMore={onMore} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Calendar view (all months of the selected range) ──────────────────── */
/**
 * props
 *   months    [{ key:'2026-10', year, month (0-11), label }]  — EngagementCalendar's range
 *   rows      engagements already loaded and filtered by EngagementCalendar
 *   undated   number of filtered rows with no start date (not placeable on a grid)
 *   onEdit    optional (eng) → open the Edit form
 *   monthRef  optional (key, el) → lets the range chips scroll to a month
 */
export default function CalendarView({ months, rows, undated = 0, onEdit, monthRef }) {
  const [selected, setSelected] = useState(null);
  const [dayList, setDayList] = useState(null);
  const [avail, setAvail] = useState(600);
  const rootRef = useRef(null);
  const today = toYMD(new Date());
  const currentKey = today.slice(0, 7);

  // Each month gets the full height of the scroll area, so one month fits the screen
  useLayoutEffect(() => {
    const scroller = rootRef.current?.parentElement; if (!scroller) return;
    const measure = () => setAvail(scroller.clientHeight);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  const gap = 14;
  const height = months.length > 1 ? avail - 4 : avail - 2;

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap }}>
      {selected && <SessionModal eng={selected} onClose={() => setSelected(null)} onEdit={onEdit} />}
      {dayList && <DayModal ymd={dayList.ymd} list={dayList.list} onClose={() => setDayList(null)} onPick={e => { setDayList(null); setSelected(e); }} />}
      {months.map(m => (
        <div key={m.key} ref={el => { if (el) monthRef?.(m.key, el); }} style={{ scrollMarginTop: 4 }}>
          <MonthGrid year={m.year} month={m.month} rows={rows} today={today} height={height} isCurrent={m.key === currentKey}
            onSelect={setSelected} onMore={(ymd, list) => setDayList({ ymd, list })} />
        </div>
      ))}
      {undated > 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', paddingBottom: 8 }}>
          {undated} engagement{undated === 1 ? '' : 's'} with no start date — see the List view.
        </div>
      )}
    </div>
  );
}
