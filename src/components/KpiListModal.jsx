import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/* Click-through list for dashboard KPI cards and chart points.
   items: [{ name, sub, right, badge }] — or a function returning that array (built only when opened). */
export const inrS = v => { v = Number(v) || 0; const a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e7 ? `₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `₹${(a / 1e5).toFixed(2)} L` : `₹${Math.round(a).toLocaleString('en-IN')}`); };
const c = v => String(v ?? '').trim();
const fmtD = d => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : c(d) || 'Dates TBD');

/** Engagement Calendar row → list item */
export const egItem = (e, right) => ({
  name: c(e.topic) || c(e.programName) || '(No program name)',
  sub: [c(e.company), fmtD(e.startDate) + (e.endDate && e.endDate !== e.startDate ? ` – ${fmtD(e.endDate)}` : ''), c(e.consultant || e.leadConsultant || e.trainer), e.sno ? `S No ${e.sno}` : ''].filter(Boolean).join(' · '),
  right: right !== undefined ? right : (Number(e.price) ? inrS(e.price) : ''),
  badge: c(e.status),
});
/** Proposal line (proposalData) → list item; val = 'bd' | 'sol' */
export const propItem = (p, val = 'bd') => ({
  name: `${c(p.client) || '(No client)'} — ${c(p.topic) || '(No topic)'}`,
  sub: [`P.ID ${p.id} V${p.version}`, p.date ? fmtD(p.date) : 'No date', p.replaced ? 'replaced version' : ''].filter(Boolean).join(' · '),
  right: inrS(val === 'sol' ? p.solValue : p.bdValue),
  badge: c(p.status),
});

const BADGE = s => /won|deliver|received|paid/i.test(s) ? ['#0AC44B', '#F0FFF4'] : /lost|cancel|overdue|reject/i.test(s) ? ['#E98272', '#FFF5F5']
  : /process|raised|partly|schedul/i.test(s) ? ['#AA78A6', '#f6eff6'] : /tentative|pending|await|re-?sched/i.test(s) ? ['#D0A616', '#FFFBEA'] : ['#6B7280', '#F2F2F2'];

export default function KpiListModal({ title, sub, items, onClose }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => (typeof items === 'function' ? items() : items) || [], [items]);
  const shown = useMemo(() => { const k = q.trim().toLowerCase(); return k ? list.filter(i => `${i.name} ${i.sub} ${i.badge}`.toLowerCase().includes(k)) : list; }, [list, q]);
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(40,39,44,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title}
        style={{ background: '#fff', borderRadius: 16, width: 600, maxWidth: '100%', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(45,48,71,0.15)', textAlign: 'left' }}>
        <div style={{ padding: '20px 20px 12px' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#2D3047' }}>{title}</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{list.length} item{list.length === 1 ? '' : 's'}{sub ? ` · ${sub}` : ''}</div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search engagement, client, proposal…" autoFocus
            style={{ marginTop: 12, width: '100%', height: 44, border: '1px solid #D1D5DB', borderRadius: 8, padding: '0 12px', fontSize: 14, boxSizing: 'border-box', outlineColor: '#AA78A6' }} />
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '60vh', borderTop: '1px solid #E5E7EB' }}>
          {shown.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>Nothing to list</div>}
          {shown.map((i, n) => { const [fg, bg] = BADGE(i.badge || ''); return (
            <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #F2F2F2' }}>
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
