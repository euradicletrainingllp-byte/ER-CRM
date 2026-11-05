import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { downloadXlsx } from '../utils/exportExcel.js';
import { logEvent } from '../services/auditLogger.js';

/* Click-through list for dashboard KPI cards and chart points.
   items: [{ name, sub, right, badge }] — or a function returning that array (built only when opened). */
export const inrS = v => { v = Number(v) || 0; const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${Math.round(a).toLocaleString('en-IN')}`); };
const c = v => String(v ?? '').trim();
const fmtD = d => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : c(d) || 'Dates TBD');

/** Engagement Calendar row → list item */
export const egItem = (e, right, target) => ({
  name: c(e.topic) || c(e.programName) || '(No program name)',
  sub: [c(e.company), fmtD(e.startDate) + (e.endDate && e.endDate !== e.startDate ? ` – ${fmtD(e.endDate)}` : ''), c(e.consultant || e.leadConsultant || e.trainer), e.sno ? `S No ${e.sno}` : ''].filter(Boolean).join(' · '),
  right: right !== undefined ? right : (Number(e.price) ? inrS(e.price) : ''),
  badge: c(e.status),
  go: target === 'finance' ? { path: '/finance', state: { openFin: c(e.engagementKey) } } : { path: '/engagement', state: { editEc: e } },
  x: { 'S No': e.sno, Index: e.engagementKey, 'EG ID': e.egId, Client: c(e.company), Program: c(e.topic), 'Start Date': c(e.startDate), 'End Date': c(e.endDate),
       Consultants: [e.consultant1, e.consultant2, e.consultant3].map(c).filter(Boolean).join(', '), Location: c(e.locationRaw ?? e.location), Status: c(e.status),
       'Price (INR)': Number(e.price) || '', 'Invoice Date': c(e.invoice), 'Payment Status': c(e.payment), 'Amount Received': c(e.amountReceived), Feedback: c(e.feedback),
       ...(right !== undefined ? { 'Amount (this list)': right } : {}) },
});
/** Proposal line (proposalData) → list item; val = 'bd' | 'sol' */
export const propItem = (p, val = 'bd') => ({
  name: `${c(p.client) || '(No client)'} — ${c(p.topic) || '(No topic)'}`,
  sub: [`P.ID ${p.id} V${p.version}`, p.date ? fmtD(p.date) : 'No date', p.replaced ? 'replaced version' : ''].filter(Boolean).join(' · '),
  right: inrS(val === 'sol' ? p.solValue : p.bdValue),
  badge: c(p.status),
  go: { path: '/bd-tracker', state: { editBd: { id: p.id, version: p.version } } },
  x: { 'Proposal ID': p.id, Version: `V${p.version}`, Client: c(p.client), Topic: c(p.topic), Date: c(p.date), 'BD Status': c(p.status), 'Replaced version': p.replaced ? 'Yes' : '',
       'BD Value': p.bdValue || 0, 'Solution Value': p.solValue || 0, 'Solution Topics': (p.solTopics || []).join(', '), Industry: c(p.industry), 'Engagement Type': c(p.engagementType) },
});

const BADGE = s => /won|deliver|received|paid/i.test(s) ? ['#0AC44B', '#F0FFF4'] : /lost|cancel|overdue|reject/i.test(s) ? ['#E98272', '#FFF5F5']
  : /process|raised|partly|schedul/i.test(s) ? ['#AA78A6', '#f6eff6'] : /tentative|pending|await|re-?sched/i.test(s) ? ['#D0A616', '#FFFBEA'] : ['#6B7280', '#F2F2F2'];

export default function KpiListModal({ title, sub, items, onClose, how }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const [sel, setSel] = useState(null);
  const lastTap = useRef({ n: null, t: 0 });
  const openItem = i => { if (!i?.go) return; onClose(); nav(i.go.path, { state: i.go.state }); };
  // Mouse double-click or two taps within 400 ms (phones) opens the record for editing
  const tap = (i, n) => { const now = Date.now(); if (lastTap.current.n === n && now - lastTap.current.t < 400) { lastTap.current = { n: null, t: 0 }; openItem(i); return; } lastTap.current = { n, t: now }; setSel(n); };
  const download = () => {
    const rows = shown.map(i => i.x || { Name: i.name, Details: i.sub || '', Status: i.badge || '', Value: i.right ?? '' });
    if (!rows.length) return;
    const keys = [...new Set(rows.flatMap(Object.keys))];
    downloadXlsx({ filename: String(title).replace(/[\\/:*?"<>|]/g, '-').slice(0, 80), sheetName: 'List', columns: keys.map(k => ({ label: k, get: r => r[k] ?? '' })), rows });
    try { logEvent({ Category: 'DATA', Action: 'EXPORT', Module: 'dashboard', RecordLabel: `${title} (${rows.length} rows)` }); } catch { /* ignore */ }
  };
  const list = useMemo(() => (typeof items === 'function' ? items() : items) || [], [items]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return k ? list.filter(i => `${i.name} ${i.sub} ${i.badge}`.toLowerCase().includes(k)) : list; }, [list, q]);
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(40,39,44,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title}
        style={{ background: '#fff', borderRadius: 16, width: 600, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(45,48,71,0.15)', textAlign: 'left' }}>
        <div style={{ padding: '20px 20px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 18, fontWeight: 600, color: '#2D3047' }}>{title}</div>
            <button onClick={download} disabled={!shown.length} title="Download this list as Excel"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: '1px solid #2D3047', borderRadius: 8, background: '#fff', color: '#2D3047', fontSize: 12, fontWeight: 600, cursor: shown.length ? 'pointer' : 'default', opacity: shown.length ? 1 : 0.5, whiteSpace: 'nowrap' }}>
              <Download size={16} strokeWidth={1.75} /> Excel
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{list.length} item{list.length === 1 ? '' : 's'}{sub ? ` · ${sub}` : ''}{list.some(i => i.go) ? ' · double-tap a row to edit it' : ''}</div>
          {how && <div style={{ marginTop: 10, background: '#F4F7FA', border: '1px solid #E5E9F0', borderLeft: '3px solid #00808C', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#374151', lineHeight: 1.45 }}><b style={{ color: '#0D1B35' }}>How this is calculated: </b>{how}</div>}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search engagement, client, proposal…" autoFocus
            style={{ marginTop: 12, width: '100%', height: 44, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 12px', fontSize: 14, boxSizing: 'border-box', outlineColor: '#AA78A6' }} />
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '60vh', borderTop: '1px solid #E5E7EB' }}>
          {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Nothing to list</div>}
          {shown.map((i, n) => { const [fg, bg] = BADGE(i.badge || ''); return (
            <div key={n} onClick={i.go ? () => tap(i, n) : undefined} onDoubleClick={i.go ? () => openItem(i) : undefined} title={i.go ? 'Double-tap to edit' : undefined}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #F2F2F2', cursor: i.go ? 'pointer' : 'default', userSelect: 'none', background: sel === n ? '#F4F7FA' : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#2D3047' }}>{i.name}</div>
                {i.sub && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{i.sub}</div>}
              </div>
              {i.badge && <span style={{ fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}>{i.badge}</span>}
              {i.right !== '' && i.right != null && <div style={{ fontSize: 13, fontWeight: 600, color: '#2D3047', whiteSpace: 'nowrap' }}>{i.right}</div>}
            </div>); })}
        </div>
        <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#2D3047', color: '#fff', border: 0, borderRadius: 8, height: 36, padding: '0 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ── Chart drill-down: a dashboard tab provides its records; a tapped bar/point lists the matching ones ── */
export const DrillContext = createContext(null);
export const useDrill = () => useContext(DrillContext);
const MON = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];
const fyOfDate = d => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 4 ? y : y - 1; };
const fyOfText = t => { const m = String(t).match(/(?:20)?(\d{2})\s*[-–/]\s*(\d{2})\b/); return m ? 2000 + +m[1] : (String(t).match(/\b(20\d{2})\b/) ? +RegExp.$1 : null); };
const STATUS = [[/won|closed/i, /won/i], [/lost/i, /lost/i], [/in.?process|open|active|pipeline/i, /in.?process/i], [/deliver/i, /deliver/i],
  [/upcoming|scheduled/i, /schedul|tentative|re-?sched/i], [/tentative/i, /tentative/i], [/cancel/i, /cancel/i]];
const key = s => c(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Records matching a tapped chart point: FY (label or series), month, quarter, status word, or a name (client / consultant / industry / type). */
export function drillItems(ctx, label, ds) {
  if (!ctx) return null;
  const both = `${label} ${ds}`;
  const fy = fyOfText(label) ?? fyOfText(ds);
  const mi = MON.indexOf(c(label).slice(0, 3).toLowerCase());
  const q = (both.match(/\bQ([1-4])\b/) || [])[1];
  const st = STATUS.find(([t]) => t.test(both));
  const mode = /in.?person/i.test(both) ? 'in' : /virtual|online/i.test(both) ? 'vi' : null;
  const lk = key(label);
  const named = lk && mi < 0 && !q && fy == null && !st && !mode;   // label is a name
  const dateOf = r => (r.__p ? r.date : (ctx.dateKey === 'invoice' ? r.invoice : r.startDate)) || '';
  const test = r => {
    const d = String(dateOf(r)).slice(0, 10), ok = /^\d{4}-\d{2}-\d{2}$/.test(d);
    if (fy != null && !(ok ? fyOfDate(d) === fy : r.__p && r.fy === fy)) return false;
    if (mi >= 0 && !(ok && (+d.slice(5, 7) + 8) % 12 === mi)) return false;
    if (q && !(ok && Math.floor(((+d.slice(5, 7) + 8) % 12) / 3) === q - 1)) return false;
    if (st && !st[1].test(c(r.status))) return false;
    if (mode && !(mode === 'vi' ? /virtual|online|teams|zoom/i : /^(?!.*(virtual|online|teams|zoom)).+/i).test(c(r.locationRaw ?? r.location))) return false;
    if (named) {
      const f = r.__p ? [r.client, r.industry, r.engagementType, r.topic, r.developmentCategory, r.lineOfService, r.typeOfService, r.customization]
                      : [r.company, r.consultant1, r.consultant2, r.consultant3, r.topic];
      if (!f.some(v => { const k = key(v); return k && (k === lk || k.startsWith(lk) || lk.startsWith(k)); })) return false;
    }
    return true;
  };
  const eg = (ctx.engagements || []).filter(r => r && (c(r.company) || c(r.topic))).filter(test).map(e => egItem(e));
  const pr = (ctx.proposals || []).map(p => ({ ...p, __p: 1 })).filter(test).map(p => propItem(p, ctx.val));
  const out = ctx.prefer === 'prop' ? [...pr, ...eg] : [...eg, ...pr];
  return out.length ? out : null;
}
