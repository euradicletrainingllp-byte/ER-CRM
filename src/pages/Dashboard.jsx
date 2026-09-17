import { useState, useEffect, useMemo } from 'react';
import KPICard from '../components/KPICard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { getEngagements, getOpsChecklist, getBDTracker } from '../services/api.js';

const fmt = n => n ? '₹' + (n / 100000).toFixed(1) + 'L' : '₹0';
const today = new Date().toISOString().slice(0, 10);

// Convert Excel serial number OR YYYY-MM-DD string → YYYY-MM-DD (for comparisons)
const toISO = d => {
  if (!d) return '';
  const num = Number(d);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  }
  return String(d);
};

// Format date for display as DD/MM/YY
const fmtDt = d => {
  if (!d) return '—';
  const iso = toISO(d);
  if (!iso) return String(d);
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y.slice(2)}`;
};

// Parse a date (serial or string) into { day, month, year } for the mini date card
const parseDateParts = d => {
  const iso = toISO(d);
  if (!iso) return { day: '?', mon: '?', year: '?' };
  const [y, m, day] = iso.split('-');
  return { day, mon: m, year: y };
};

const COLORS = ['#1a3a5c','#2563eb','#16a34a','#7c3aed','#e8760a','#dc2626','#0891b2','#84cc16'];

function clScore(cl) {
  if (!cl) return 0;
  const keys = Object.values(cl);
  const done = keys.filter(v => v === 'Yes' || v === 'NA').length;
  return Math.round((done / keys.length) * 100);
}

export default function Dashboard({ onRefreshed }) {
  const [engData,  setEngData]  = useState([]);
  const [opsData,  setOpsData]  = useState([]);
  const [bdData,   setBdData]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [errors,   setErrors]   = useState({});

  const load = async () => {
    setLoading(true);
    setErrors({});
    const errs = {};

    await Promise.allSettled([
      getEngagements().then(setEngData).catch(e => { errs.eng = e; setEngData([]); }),
      getOpsChecklist().then(setOpsData).catch(e => { errs.ops = e; setOpsData([]); }),
      getBDTracker().then(setBdData).catch(e => { errs.bd = e; setBdData([]); }),
    ]);

    setErrors(errs);
    setLoading(false);
    onRefreshed?.(new Date().toLocaleTimeString());
  };

  useEffect(() => { load(); }, []);

  const upcoming = useMemo(() =>
    engData.filter(e => toISO(e.startDate) >= today && e.status !== 'Cancelled')
           .sort((a,b) => toISO(a.startDate).localeCompare(toISO(b.startDate)))
           .slice(0, 6)
  , [engData]);

  const byCompany = useMemo(() => {
    const m = {};
    engData.forEach(e => { m[e.company] = (m[e.company] || 0) + 1; });
    return Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 8);
  }, [engData]);

  const byStatus = useMemo(() => {
    const m = {};
    engData.forEach(e => { m[e.status] = (m[e.status] || 0) + 1; });
    return Object.entries(m).sort((a,b) => b[1]-a[1]);
  }, [engData]);

  const revenue    = useMemo(() => engData.filter(e => e.status === 'Delivered').reduce((s,e)=>s+e.price,0), [engData]);
  const scheduled  = engData.filter(e => e.status === 'Scheduled').length;
  const tentative  = engData.filter(e => e.status === 'Tentative').length;
  const maxCount   = byCompany[0]?.[1] || 1;
  const monthMon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (loading) return <LoadingState message="Loading CRM data from OneDrive Excel…" />;

  return (
    <div>
      {/* KPIs */}
      <div className="kpi-grid">
        <KPICard label="Total Engagements" value={engData.length} sub="All time from Excel" icon="📋" variant="accent" />
        <KPICard label="Revenue — Delivered" value={fmt(revenue)} sub={`${engData.filter(e=>e.status==='Delivered').length} delivered sessions`} icon="💰" variant="green" />
        <KPICard label="Scheduled Sessions" value={scheduled} sub={`${tentative} tentative`} icon="🗓" variant="blue" />
        <KPICard label="BD Prospects" value={bdData.length} sub="In BD Tracker" icon="🎯" variant="purple" />
      </div>

      {Object.keys(errors).length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13 }}>
          ⚠️ Some data could not be loaded — check your Power Automate URLs in <code>src/config/powerAutomate.js</code>.
          {Object.entries(errors).map(([k,e]) => (
            <div key={k} style={{ color: 'var(--red)', marginTop: 4 }}>• {k}: {e.message}</div>
          ))}
        </div>
      )}

      <div className="grid-2">
        {/* Upcoming */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📅 Upcoming Engagements</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{upcoming.length} sessions</span>
          </div>
          <div style={{ padding: 0 }}>
            {upcoming.length === 0
              ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>No upcoming sessions found</div>
              : upcoming.map((e, i) => {
                  const { day, mon } = parseDateParts(e.startDate);
                  return (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ textAlign: 'center', minWidth: 46, background: '#f8fafc', borderRadius: 8, padding: '6px 4px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>{day}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{monthMon[parseInt(mon)-1]}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.topic}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {e.company} · {e.location} · {e.consultant1 || '—'}
                        </div>
                      </div>
                      <StatusBadge value={e.status} />
                    </div>
                  );
                })}
          </div>
        </div>

        {/* Bar chart */}
        <div className="card">
          <div className="card-header"><span className="card-title">🏢 Sessions by Client</span></div>
          <div className="card-body">
            {byCompany.length === 0
              ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No data</div>
              : (
                <div className="bar-chart">
                  {byCompany.map(([co, count], i) => (
                    <div className="bar-row" key={i}>
                      <div className="bar-label" title={co}>{co}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(count/maxCount)*100}%`, background: COLORS[i%COLORS.length] }}>
                          <span>{count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Status Breakdown */}
        <div className="card">
          <div className="card-header"><span className="card-title">📊 Engagement Status Breakdown</span></div>
          <div style={{ padding: '8px 20px' }}>
            {byStatus.map(([status, count], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                <StatusBadge value={status} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 120, background: '#f0f2f7', borderRadius: 4, height: 6 }}>
                    <div style={{ width: `${(count/engData.length)*100}%`, height: '100%', borderRadius: 4, background: 'var(--primary)' }} />
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--primary)', minWidth: 28, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ops readiness */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">✔ Ops Checklist Readiness</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{opsData.length} sessions</span>
          </div>
          <div style={{ padding: 0 }}>
            {opsData.slice(0, 7).map((e, i) => {
              const score = clScore(e.checklist);
              const color = score === 100 ? 'var(--green)' : score > 60 ? 'var(--accent)' : 'var(--red)';
              return (
                <div key={i} style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }} title={e.topic}>{e.topic}</div>
                    <span style={{ fontWeight: 800, fontSize: 13, color }}>{score}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div className="progress-wrap">
                        <div className="progress-fill" style={{ width: score + '%', background: color }} />
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{e.company} · {fmtDt(e.startDate)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
