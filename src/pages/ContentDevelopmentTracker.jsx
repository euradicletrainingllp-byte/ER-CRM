import { useState, useEffect, useMemo } from 'react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { peekList, getContentDevTracker, addContentDevRow, updateContentDevRow, deleteContentDevRow } from '../services/api.js';
import { syncCDTWithEC } from '../services/syncWithEC.js';
import { usePermissions } from '../hooks/usePermissions.js';
import SyncScopeModal from '../components/SyncScopeModal.jsx';
import { DeleteButton } from '../components/ActionButtons.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDt = d => {
  if (!d) return '—';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return s;
    return `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${String(dt.getUTCFullYear()).slice(2)}`;
  }
  const p = s.split('-');
  if (p.length === 3 && p[0].length === 4) return `${p[2]}/${p[1]}/${p[0].slice(2)}`;
  return s;
};

const toInputDate = d => {
  if (!d) return '';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0, 10);
  return '';
};

const EMPTY_FORM = { client:'', startDate:'', evRequired:'', poc:'', completionDate:'', pmRequired:'', topic:'' };

// ─── Add Modal ────────────────────────────────────────────────────────────────
function AddModal({ onSave, onClose, saving }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = { className:'form-input', style:{ width:'100%', marginBottom:10 } };
  const YesNoBtn = ({ field }) => (
    <div style={{ display:'flex', gap:8, marginBottom:10 }}>
      {['Yes','No'].map(opt => {
        const active = form[field] === opt;
        return (
          <button key={opt} type="button" onClick={() => set(field, active ? '' : opt)} style={{
            flex:1, padding:'7px 0', borderRadius:6,
            border:`2px solid ${active ? (opt==='Yes'?'#16a34a':'#dc2626') : 'var(--border)'}`,
            background: active ? (opt==='Yes'?'#dcfce7':'#fee2e2') : '#fff',
            color: active ? (opt==='Yes'?'#166534':'#991b1b') : 'var(--muted)',
            fontWeight: active ? 700 : 400, cursor:'pointer', fontSize:13,
          }}>{opt}</button>
        );
      })}
    </div>
  );
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:12, padding:28, width:520, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.22)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ margin:0, fontSize:16, color:'var(--primary)' }}>➕ Add Entry</h3>
          <button className="btn btn-outline btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 16px' }}>
          <div style={{ gridColumn:'1 / -1' }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>Client *</label>
            <input {...inp} value={form.client} onChange={e => set('client', e.target.value)} placeholder="Client / company name" />
          </div>
          <div style={{ gridColumn:'1 / -1' }}>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>Program Topic</label>
            <input {...inp} value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="Topic" />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>Start Date</label>
            <input {...inp} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>POC</label>
            <input {...inp} value={form.poc} onChange={e => set('poc', e.target.value)} placeholder="Point of contact" />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>PM Required</label>
            <YesNoBtn field="pmRequired" />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>EV Required</label>
            <YesNoBtn field="evRequired" />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>Completion Date</label>
            <input {...inp} type="date" value={form.completionDate} onChange={e => set('completionDate', e.target.value)} />
          </div>
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={saving || !form.client.trim()}>
            {saving ? 'Saving…' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ row, onConfirm, onClose, saving }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'#fff', borderRadius:12, padding:28, width:380, boxShadow:'0 8px 40px rgba(0,0,0,0.22)' }}>
        <h3 style={{ margin:'0 0 12px', fontSize:16, color:'var(--red)' }}>🗑 Delete Entry?</h3>
        <div style={{ background:'#fff7ed', border:'1px solid #fbbf24', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13 }}>
          <strong>{row.client}</strong>
          <div style={{ color:'var(--muted)', fontSize:12, marginTop:4 }}>Start: {fmtDt(row.startDate)}</div>
        </div>
        <p style={{ margin:'0 0 20px', fontSize:13, color:'var(--red)' }}>This cannot be undone.</p>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn" style={{ background:'var(--red)', color:'#fff', border:'none' }} onClick={onConfirm} disabled={saving}>
            {saving ? 'Deleting…' : 'Yes, Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline editable field ────────────────────────────────────────────────────
function EditField({ label, value, field, type='text', row, onSave, canEdit }) {
  const [editing, setEditing] = useState(false);
  const displayVal = type === 'date' ? fmtDt(value) : (value || '—');

  const commit = raw => {
    const next = (raw ?? '').trim();
    setEditing(false);
    if (next !== String(value || '').trim()) onSave(row, { [field]: next });
  };

  return (
    <div>
      <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.3px' }}>{label}</div>
      {editing ? (
        <input
          autoFocus
          type={type}
          defaultValue={type==='date' ? toInputDate(value) : (value||'')}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if(e.key==='Enter') e.target.blur(); if(e.key==='Escape') setEditing(false); }}
          style={{ width:'100%', fontSize:13, padding:'5px 8px', border:'1px solid var(--accent)', borderRadius:6, outline:'none', boxSizing:'border-box' }}
        />
      ) : (
        <div
          onClick={() => canEdit && setEditing(true)}
          title={canEdit ? 'Click to edit' : ''}
          style={{
            fontSize:13, fontWeight:500, padding:'5px 8px',
            border:`1px ${canEdit ? 'dashed' : 'solid'} ${canEdit ? 'transparent' : 'var(--border)'}`,
            borderRadius:6, cursor:canEdit?'pointer':'default',
            background: canEdit ? 'transparent' : '#f8fafc',
            color: value ? 'inherit' : 'var(--muted)',
            transition:'border-color 0.15s, background 0.15s',
            minHeight:32, display:'flex', alignItems:'center',
          }}
          onMouseEnter={e => { if(canEdit){ e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.background='#f0f7ff'; }}}
          onMouseLeave={e => { e.currentTarget.style.borderColor='transparent'; e.currentTarget.style.background='transparent'; }}
        >
          {displayVal}
        </div>
      )}
    </div>
  );
}

// ─── Yes/No pill (inline toggle) ─────────────────────────────────────────────
function YesNoPill({ label, value, field, row, onSave, canEdit }) {
  const cycle = () => {
    if (!canEdit) return;
    const next = value==='Yes' ? 'No' : value==='No' ? '' : 'Yes';
    onSave(row, { [field]: next });
  };
  const color  = value==='Yes' ? '#16a34a' : value==='No' ? '#dc2626' : 'var(--muted)';
  const bg     = value==='Yes' ? '#dcfce7'  : value==='No' ? '#fee2e2'  : '#f3f4f6';
  const border = value==='Yes' ? '#86efac'  : value==='No' ? '#fca5a5'  : '#e5e7eb';
  return (
    <div>
      <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.3px' }}>{label}</div>
      <div
        onClick={cycle}
        title={canEdit ? 'Click to toggle' : ''}
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          padding:'5px 20px', borderRadius:20,
          border:`1px solid ${border}`, background:bg, color,
          fontWeight:600, fontSize:13,
          cursor:canEdit?'pointer':'default',
          userSelect:'none', transition:'all 0.15s', minWidth:64, minHeight:32,
        }}
      >
        {value || '—'}
      </div>
      {canEdit && <div style={{ fontSize:10, color:'#9ca3af', marginTop:3 }}>click to toggle</div>}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ row, canEdit, onUpdate, onDelete, saving }) {
  const isCompleted = !!(row.completionDate && row.completionDate !== '—');
  return (
    <div className="card" style={{ height:'100%', display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div className="card-header" style={{ flexShrink:0, flexWrap:'wrap', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16, fontWeight:800, color:'var(--primary)' }}>{row.client}</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            #{row.sno}
            {row.startDate && <> · 📅 {fmtDt(row.startDate)}</>}
            {row.poc && <> · <strong>POC:</strong> {row.poc}</>}
          </div>
          {row.topic && (
            <div style={{ marginTop:6, fontSize:12, color:'#4f46e5', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:6, padding:'3px 10px', display:'inline-block' }}>
              {row.topic}
            </div>
          )}
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <span style={{
            padding:'4px 14px', borderRadius:20, fontWeight:700, fontSize:12,
            background: isCompleted ? '#dcfce7' : '#fef9c3',
            color: isCompleted ? '#166534' : '#854d0e',
            border: `1px solid ${isCompleted ? '#86efac' : '#fde047'}`,
          }}>
            {isCompleted ? '✓ Completed' : '⏳ Pending'}
          </span>
          {canEdit && (
            <DeleteButton title="Delete Entry" style={{ marginTop:4 }} onClick={() => onDelete(row)} />
          )}
        </div>
      </div>

      {/* Fields grid */}
      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

          {/* Client — full width */}
          <div style={{ gridColumn:'1 / -1' }}>
            <EditField label="Client" value={row.client} field="client" row={row} onSave={onUpdate} canEdit={canEdit} />
          </div>

          {/* Topic — full width */}
          <div style={{ gridColumn:'1 / -1' }}>
            <EditField label="Program Topic" value={row.topic} field="topic" row={row} onSave={onUpdate} canEdit={canEdit} />
          </div>

          <EditField label="Start Date" value={row.startDate} field="startDate" type="date" row={row} onSave={onUpdate} canEdit={canEdit} />
          <EditField label="POC" value={row.poc} field="poc" row={row} onSave={onUpdate} canEdit={canEdit} />

          {/* PM Required BEFORE EV Required */}
          <YesNoPill label="PM Required" value={row.pmRequired} field="pmRequired" row={row} onSave={onUpdate} canEdit={canEdit} />
          <YesNoPill label="EV Required" value={row.evRequired} field="evRequired" row={row} onSave={onUpdate} canEdit={canEdit} />

          {/* Due Date — read only */}
          <div>
            <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.3px' }}>Due Date <span style={{ fontWeight:400, fontSize:10 }}>(auto-calculated)</span></div>
            <div style={{ fontSize:13, fontWeight:500, padding:'5px 8px', border:'1px solid var(--border)', borderRadius:6, background:'#f8fafc', color:'var(--muted)', minHeight:32, display:'flex', alignItems:'center' }}>
              {fmtDt(row.dueDate)}
            </div>
          </div>

          <EditField label="Completion Date" value={row.completionDate} field="completionDate" type="date" row={row} onSave={onUpdate} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ContentDevelopmentTracker({ onRefreshed }) {
  const [data,      setData]      = useState(() => peekList('cdt') || []);
  const [loading,   setLoading]   = useState(() => !peekList('cdt'));   // full loader only on the very first visit
  const [refreshing, setRefreshing] = useState(false);                  // quiet background refresh
  const [scopeOpen, setScopeOpen] = useState(false);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [statusF,   setStatusF]   = useState('All');
  const [selected,  setSelected]  = useState(null);
  const [toast,     setToast]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [syncProg,  setSyncProg]  = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);

  const { canEdit } = usePermissions();
  const editable = canEdit('content-dev');

  // Show the last loaded rows straight away, then fetch fresh rows in the background
  const load = async () => {
    const saved = peekList('cdt');
    if (saved) { setData(d => (d.length ? d : saved)); setLoading(false); }
    else setLoading(true);
    setRefreshing(true); setError(null);
    try {
      const rows = await getContentDevTracker();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch(e) {
      if (saved) showToast('⚠ Could not refresh from Excel — showing the last saved copy.');
      else setError(e);
    }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const filtered = useMemo(() =>
    data.filter(r => {
      const q = search.toLowerCase();
      const matchQ = !q || r.client.toLowerCase().includes(q) || (r.poc||'').toLowerCase().includes(q) || (r.topic||'').toLowerCase().includes(q);
      const isCompleted = !!(r.completionDate && r.completionDate !== '—');
      const matchS = statusF==='All' || (statusF==='Completed' && isCompleted) || (statusF==='Pending' && !isCompleted);
      return matchQ && matchS;
    }).sort((a,b) => Number(a.sno)-Number(b.sno)),
  [data, search, statusF]);

  // keep selected in sync when data reloads
  const sel = selected != null ? data.find(d => d.sno === selected) : null;

  const handleUpdate = async (row, changes) => {
    try {
      await updateContentDevRow(row.sno, { ...row, ...changes });
      setData(prev => prev.map(r => r.sno===row.sno ? { ...r, ...changes } : r));
      showToast('✓ Saved');
    } catch(e) { showToast('❌ ' + e.message); }
  };

  const handleAdd = async form => {
    setSaving(true);
    try { await addContentDevRow(form); showToast('✓ Entry added'); setShowAdd(false); await load(); }
    catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteRow) return; setSaving(true);
    try {
      await deleteContentDevRow(deleteRow.sno);
      if (selected === deleteRow.sno) setSelected(null);
      showToast('✓ Entry deleted'); setDeleteRow(null); await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleSyncWithEC = async (scope = 'recent') => {
    setSyncing(true); setSyncProg({ done:0, total:0 });
    try {
      const { updated, added, errors } = await syncCDTWithEC(p => setSyncProg(p), scope);
      const errPart = errors.length ? ` · ${errors.length} error${errors.length>1?'s':''}` : '';
      showToast(`✓ Synced: ${updated} updated, ${added} added${errPart}`);
      await new Promise(r => setTimeout(r, 1500));
      await load();
    } catch(e) { showToast('❌ Sync failed: ' + e.message); }
    finally { setSyncing(false); setSyncProg(null); }
  };

  const completed = data.filter(r => r.completionDate && r.completionDate !== '—').length;
  const pending   = data.length - completed;

  if (loading) return <LoadingState message="Loading Content Dev Tracker from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 68px)', overflow:'hidden' }}>
      {toast && (
        <div style={{ position:'fixed', top:70, right:24, background:'var(--primary)', color:'#fff', padding:'10px 20px', borderRadius:8, zIndex:999, fontSize:13, fontWeight:600, boxShadow:'0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {showAdd   && <AddModal onSave={handleAdd} onClose={() => setShowAdd(false)} saving={saving} />}
      {deleteRow && <DeleteConfirmModal row={deleteRow} onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={saving} />}
      {scopeOpen && <SyncScopeModal target="Content Dev Tracker" onClose={() => setScopeOpen(false)} onConfirm={scope => { setScopeOpen(false); handleSyncWithEC(scope); }} />}

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:16, flexShrink:0 }}>
        <div className="kpi-card accent"><div className="kpi-label">Total Entries</div><div className="kpi-value">{data.length}</div></div>
        <div className="kpi-card green"><div className="kpi-label">Completed</div><div className="kpi-value">{completed}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Pending</div><div className="kpi-value">{pending}</div></div>
        <div className="kpi-card purple"><div className="kpi-label">This Month</div><div className="kpi-value">
          {data.filter(r => { if(!r.startDate) return false; const d=new Date(r.startDate); return d.getMonth()===new Date().getMonth()&&d.getFullYear()===new Date().getFullYear(); }).length}
        </div></div>
      </div>

      {/* Two-column layout */}
      <div className="grid-sidebar" style={{ flex:1, overflow:'hidden', minHeight:0 }}>

        {/* LEFT — entry list */}
        <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
          <div className="filter-bar" style={{ flexShrink:0 }}>
            <input className="form-input wide" placeholder="🔍 Client, topic, POC…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
              {['All','Completed','Pending'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={syncing || refreshing} title={refreshing ? 'Refreshing from Excel…' : 'Refresh'}>{refreshing ? '⟳' : '↺'}</button>
            <button className="btn btn-outline btn-sm" onClick={() => setScopeOpen(true)} disabled={syncing||saving}
              style={{ color:syncing?'var(--muted)':'var(--accent)', borderColor:'var(--accent)' }}>
              {syncing ? (syncProg?.total>0 ? `⏳ ${syncProg.done}/${syncProg.total}` : '⏳ Syncing…') : '🔄 Sync with EC'}
            </button>
            {editable && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)} disabled={syncing}>+ Add</button>}
          </div>

          <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div className="card-header" style={{ flexShrink:0 }}>
              <span className="card-title">📋 Entries</span>
              <span style={{ fontSize:12, color:'var(--muted)' }}>{filtered.length} of {data.length}</span>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {filtered.length === 0
                ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>No entries found</div>
                : filtered.map((r, i) => {
                    const isCompleted = !!(r.completionDate && r.completionDate !== '—');
                    const isSel = selected === r.sno;
                    return (
                      <div key={r.sno ?? i}
                        onClick={() => setSelected(isSel ? null : r.sno)}
                        style={{
                          padding:'10px 14px', borderBottom:'1px solid var(--border)',
                          cursor:'pointer',
                          background: isSel ? '#f0f7ff' : 'transparent',
                          borderLeft: isSel ? '3px solid var(--accent)' : '3px solid transparent',
                          transition:'background 0.1s',
                        }}
                      >
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', background:'var(--border)', borderRadius:4, padding:'1px 6px', flexShrink:0 }}>#{r.sno}</span>
                              <span style={{ fontWeight:700, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.client}</span>
                            </div>
                            {r.topic && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.topic}</div>}
                          </div>
                          <span style={{
                            flexShrink:0, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                            background: isCompleted ? '#dcfce7' : '#fef9c3',
                            color: isCompleted ? '#166534' : '#854d0e',
                            border: `1px solid ${isCompleted ? '#86efac' : '#fde047'}`,
                          }}>
                            {isCompleted ? '✓' : '⏳'}
                          </span>
                        </div>
                        <div style={{ display:'flex', gap:10, marginTop:5, fontSize:11, color:'var(--muted)' }}>
                          {r.startDate && <span>📅 {fmtDt(r.startDate)}</span>}
                          {r.poc && <span>👤 {r.poc}</span>}
                          {r.pmRequired && <span style={{ color:r.pmRequired==='Yes'?'#16a34a':'#dc2626' }}>PM:{r.pmRequired}</span>}
                          {r.evRequired && <span style={{ color:r.evRequired==='Yes'?'#16a34a':'#dc2626' }}>EV:{r.evRequired}</span>}
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </div>

        {/* RIGHT — detail panel */}
        <div style={{ height:'100%', overflowY:'auto' }}>
          {sel
            ? <DetailPanel row={sel} canEdit={editable} onUpdate={handleUpdate} onDelete={setDeleteRow} saving={saving} />
            : (
              <div className="card" style={{ textAlign:'center', padding:'60px 20px', color:'var(--muted)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
                <div style={{ fontWeight:600, marginBottom:6 }}>Select an entry</div>
                <div style={{ fontSize:13 }}>Click any entry on the left to view and edit its details</div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
