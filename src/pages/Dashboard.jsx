import { useState, useEffect, useMemo, useRef } from 'react';
import KPICard from '../components/KPICard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { getAllEngagementsResilient, peekAllEngagements, peekList, onListChange, getOpsChecklist, getSolutionTracker } from '../services/api.js';
import { clScore } from './OpsChecklist.jsx';                         // same readiness score as the Ops Checklist page
import { buildProposalLines, uniqueProposals } from '../components/proposalData.js';   // same proposal rule as the BD Tracker
import { refreshToday } from '../components/erdCharts.jsx';
import OpsLiveDashboard from '../components/OpsLiveDashboard.jsx';
import SolLiveDashboard from '../components/SolLiveDashboard.jsx';
import SalesLiveDashboard from '../components/SalesLiveDashboard.jsx';
import FinanceLiveDashboard from '../components/FinanceLiveDashboard.jsx';

// Department dashboards (add more tabs here as departments are added)
const DASH_TABS = [
  { key: 'overview',   label: '📋 Overview' },
  { key: 'operations', label: '⚙️ Operations' },
  { key: 'solutioning', label: '💡 Solutioning' },
  { key: 'sales',       label: '📈 Sales' },
  { key: 'finance',     label: '💰 Finance' },
];
const TAB_KEY = 'ercrm.dashboard.tab';
const readTab = () => { try { return localStorage.getItem(TAB_KEY) || 'overview'; } catch { return 'overview'; } };

const fmt = n => n ? '₹' + (n / 100000).toFixed(1) + 'L' : '₹0';
// Local date (toISOString() is UTC, which is still "yesterday" in India before 5:30 am); read on every render
const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const isUpcomingStatus = s => /^(scheduled|tentative|re-?schedule)$/i.test(String(s ?? '').trim());   // same as the Operations tab
const isDeliveredStatus = s => /^delivered$/i.test(String(s ?? '').trim());
const REFRESH_EVERY_MS = 5 * 60 * 1000;   // background refresh while the Dashboard is open and visible
const REFRESH_MIN_GAP_MS = 2 * 60 * 1000; // on returning to the tab, refresh if the data is older than this

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

export default function Dashboard({ onRefreshed }) {
  // Show the last loaded data straight away; fresh data replaces it when it arrives
  const [engData,  setEngData]  = useState(() => peekAllEngagements() || []);
  const [opsData,  setOpsData]  = useState(() => peekList('ops') || []);
  const [solData,  setSolData]  = useState(() => peekList('solution'));   // null until first load
  const [loading,  setLoading]  = useState(() => !peekAllEngagements());
  const [refreshing, setRefreshing] = useState(false);
  const [errors,   setErrors]   = useState({});
  const [notes,    setNotes]    = useState([]);           // non-fatal notices (e.g. loaded in windows)
  const [loadedAt, setLoadedAt] = useState(null);
  const [dayKey,   setDayKey]   = useState(localToday);   // changes at midnight → tabs redraw for the new day
  const [tab, setTabState] = useState(readTab);
  const setTab = t => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const busy = useRef(false);
  const lastLoad = useRef(0);
  const today = localToday();

  const load = async () => {
    if (busy.current) return;            // one refresh at a time
    busy.current = true;
    if (!peekAllEngagements()) setLoading(true);
    setRefreshing(true);
    const errs = {}, note = [];

    await Promise.allSettled([
      getAllEngagementsResilient({ force: true }).then(({ rows, fallback }) => {
        setEngData(rows);
        if (fallback) note.push('The full Engagement Calendar read did not finish, so it was loaded in 3-month windows (previous, current and next financial year). Older years show the last saved copy.');
      }).catch(e => { errs.eng = e; }),
      getOpsChecklist().then(setOpsData).catch(e => { errs.ops = e; }),
      getSolutionTracker().then(setSolData).catch(e => { errs.solution = e; setSolData(d => d || []); }),
    ]);

    setErrors(errs);
    setNotes(note);
    setLoading(false);
    setRefreshing(false);
    busy.current = false;
    lastLoad.current = Date.now();
    if (Object.keys(errs).length < 3) setLoadedAt(new Date().toLocaleTimeString());
    onRefreshed?.(new Date().toLocaleTimeString());
  };

  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the Dashboard up to date without a page reload:
  //  • a save anywhere in the CRM (Engagement Calendar, Ops / BD sync) → show the patched copy now, re-read shortly after
  //  • tracker lists re-read by another page → pick up that copy
  //  • every 5 minutes while visible, and when returning to the tab with data older than 2 minutes
  //  • at midnight → move "today", the current FY and the upcoming lists to the new day
  useEffect(() => {
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 2500); };
    const onEc = () => { const p = peekAllEngagements(); if (p) setEngData(p); soon(); };
    const offList = onListChange(name => {
      if (name === 'ops') { const p = peekList('ops'); if (p) setOpsData(p); }
      if (name === 'solution') { const p = peekList('solution'); if (p) setSolData(p); }
    });
    const checkDay = () => { if (refreshToday()) setDayKey(localToday()); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      checkDay();
      if (Date.now() - lastLoad.current > REFRESH_MIN_GAP_MS) load();
    };
    const tick = setInterval(() => {
      checkDay();
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current >= REFRESH_EVERY_MS) load();
    }, 60 * 1000);
    window.addEventListener('ercrm:ec-changed', onEc);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearTimeout(timer); clearInterval(tick); offList();
      window.removeEventListener('ercrm:ec-changed', onEc);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Upcoming = Scheduled / Tentative / Re-schedule from today onward (same rule as the Operations tab)
  const upcoming = useMemo(() =>
    engData.filter(e => toISO(e.startDate) >= today && isUpcomingStatus(e.status))
           .sort((a,b) => toISO(a.startDate).localeCompare(toISO(b.startDate)))
           .slice(0, 6)
  , [engData, today]);

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

  const delivered  = useMemo(() => engData.filter(e => isDeliveredStatus(e.status)), [engData]);
  const revenue    = useMemo(() => delivered.reduce((s,e)=>s+(Number(e.price)||0),0), [delivered]);
  const scheduled  = engData.filter(e => /^scheduled$/i.test(String(e.status ?? '').trim())).length;
  const tentative  = engData.filter(e => /^tentative$/i.test(String(e.status ?? '').trim())).length;
  const maxCount   = byCompany[0]?.[1] || 1;
  // BD Tracker page = BD view of the combined Solution Tracker (SOLUTION_CRUD flow).
  // Counted with the same proposal-line rule as the BD Tracker cards and the Sales / Solutioning tabs.
  const bdLines = useMemo(() => buildProposalLines(solData || []), [solData]);
  const bdCount = useMemo(() => uniqueProposals(bdLines), [bdLines]);

  // Ops readiness: sessions still to run (ongoing or upcoming, not cancelled / delivered), soonest first;
  // when there are none, the most recent sessions. Score = Ops Checklist page score.
  const opsReady = useMemo(() => {
    const live = opsData.filter(e => !/cancel/i.test(String(e.status ?? '')) && !isDeliveredStatus(e.status));
    const ahead = live.filter(e => (toISO(e.endDate) || toISO(e.startDate)) >= today)
      .sort((a, b) => toISO(a.startDate).localeCompare(toISO(b.startDate)));
    const list = ahead.length ? ahead : [...opsData].sort((a, b) => toISO(b.startDate).localeCompare(toISO(a.startDate)));
    return { rows: list.slice(0, 7), ahead: ahead.length };
  }, [opsData, today]);
  const errorList = Object.entries(errors);
  const monthMon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div>
      {/* Department tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {DASH_TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'none', border: 'none',
              borderBottom: tab === t.key ? '3px solid var(--primary)' : '3px solid transparent',
              color: tab === t.key ? 'var(--primary)' : 'var(--muted)', marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
        {refreshing && !loading
          ? <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>⟳ Updating from Excel…</span>
          : loadedAt && <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }} title="Refreshes by itself every 5 minutes, after saves, and when you come back to this tab">Updated {loadedAt}</span>}
      </div>

      {/* Load problems — shown on every tab, so no tab shows old figures without saying so */}
      {!loading && errorList.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 13 }}>
          ⚠️ Some data could not be refreshed — the figures below use the last loaded copy for:
          {errorList.map(([k, e]) => (
            <div key={k} style={{ color: 'var(--red)', marginTop: 4 }}>
              • {{ eng: 'Engagement Calendar (Overview, Operations, Sales, Finance)', ops: 'Ops Checklist (Overview readiness)', solution: 'Solution / BD Tracker (Solutioning, Sales, BD Prospects)' }[k] || k}: {e?.message || String(e)}
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>↻ Try again</button>
          </div>
        </div>
      )}
      {!loading && notes.map((n, i) => (
        <div key={i} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5, color: '#1e3a8a' }}>ℹ️ {n}</div>
      ))}
      <div key={dayKey}>

      {tab === 'finance' ? (
        loading ? (
          <LoadingState message="Loading Engagement Calendar finance data…" />
        ) : (
          <FinanceLiveDashboard engagements={engData} refreshing={refreshing} />
        )
      ) : tab === 'sales' ? (
        !solData || loading ? (
          <LoadingState message="Loading BD Tracker and Engagement Calendar…" />
        ) : (
          <SalesLiveDashboard solutions={solData} engagements={engData} refreshing={refreshing} />
        )
      ) : tab === 'solutioning' ? (
        !solData ? (
          <LoadingState message="Loading Solution Tracker and BD Tracker…" />
        ) : (
          <SolLiveDashboard solutions={solData} refreshing={refreshing} />
        )
      ) : loading ? (
        <LoadingState message="Loading CRM data from OneDrive Excel…" />
      ) : tab === 'operations' ? (
        <OpsLiveDashboard engagements={engData} refreshing={refreshing} />
      ) : (
      <>
      {/* KPIs */}
      <div className="kpi-grid">
        <KPICard label="Total Engagements" value={engData.length} sub="All time from Excel" icon="📋" variant="accent" how="Count of every Engagement Calendar row with a company — all years, all statuses." />
        <KPICard label="Revenue — Delivered" value={fmt(revenue)} sub={`${delivered.length} delivered sessions`} icon="💰" variant="green" how="Sum of Price (INR) of rows with Status = Delivered, all years; GST and travel excluded." />
        <KPICard label="Scheduled Sessions" value={scheduled} sub={`${tentative} tentative`} icon="🗓" variant="blue" how="Rows with Status = Scheduled (any date); the sub-line counts Status = Tentative." />
        <KPICard label="BD Prospects" value={solData ? bdCount : '…'} sub={solData ? `Unique proposals in BD Tracker${bdLines.length > bdCount ? ` · ${bdLines.length} incl. revisions` : ''}` : 'Loading BD Tracker…'} icon="🎯" variant="purple" how="Unique Proposal IDs in the BD Tracker; revisions (V2, V3 …) of the same proposal count once." />
      </div>

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
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{opsReady.ahead ? `${opsReady.ahead} upcoming / ongoing` : 'No upcoming sessions — latest shown'} · {opsData.length} total</span>
          </div>
          <div style={{ padding: 0 }}>
            {opsReady.rows.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>No sessions in the Ops Checklist</div>}
            {opsReady.rows.map((e, i) => {
              const score = clScore(e);
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
      </>
      )}
      </div>
    </div>
  );
}
