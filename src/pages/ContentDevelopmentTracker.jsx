import { useState, useEffect } from 'react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { getContentDevTracker, addContentDevRow, updateContentDevRow, deleteContentDevRow } from '../services/api.js';
import { usePermissions } from '../hooks/usePermissions.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDt = d => {
  if (!d) return '—';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return s;
    const day = String(dt.getUTCDate()).padStart(2, '0');
    const mon = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const yr  = String(dt.getUTCFullYear()).slice(2);
    return `${day}/${mon}/${yr}`;
  }
  const p = s.split('-');
  if (p.length === 3 && p[0].length === 4) return `${p[2]}/${p[1]}/${p[0].slice(2)}`;
  return s;
};

const EMPTY_FORM = {
  client: '', startDate: '', endDate: '', programType: '',
  evRequired: '', poc: '', dueDate: '', completionDate: '', pmRequired: '',
};

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────
function AddEditModal({ initial, onSave, onClose, saving }) {
  const isEdit = !!initial?.sno;
  const [form, setForm] = useState(isEdit ? {
    client:         initial.client         || '',
    startDate:      initial.startDate      || '',
    endDate:        initial.endDate        || '',
    programType:    initial.programType    || '',
    evRequired:     initial.evRequired     || '',
    poc:            initial.poc            || '',
    dueDate:        initial.dueDate        || '',
    completionDate: initial.completionDate || '',
    pmRequired:     initial.pmRequired     || '',
  } : { ...EMPTY_FORM });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const inp = { className: 'form-input', style: { width: '100%', marginBottom: 10 } };
  const yesNoOpts = ['', 'Yes', 'No', 'NA'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--primary)' }}>
            {isEdit ? '✏️ Edit Solutioning Entry' : '➕ Add Solutioning Entry'}
          </h3>
          <button className="btn btn-outline btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Client *</label>
            <input {...inp} value={form.client} onChange={e => set('client', e.target.value)} placeholder="Client / company name" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Program Start Date</label>
            <input {...inp} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>End Date</label>
            <input {...inp} type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Program Type</label>
            <input {...inp} value={form.programType} onChange={e => set('programType', e.target.value)} placeholder="e.g. Leadership, Sales" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>POC</label>
            <input {...inp} value={form.poc} onChange={e => set('poc', e.target.value)} placeholder="Point of contact" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>EV Required</label>
            <select {...inp} value={form.evRequired} onChange={e => set('evRequired', e.target.value)}>
              {yesNoOpts.map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>PM Required</label>
            <select {...inp} value={form.pmRequired} onChange={e => set('pmRequired', e.target.value)}>
              {yesNoOpts.map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Due Date</label>
            <input {...inp} type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Completion Date</label>
            <input {...inp} type="date" value={form.completionDate} onChange={e => set('completionDate', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={saving || !form.client.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Update Entry' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ row, onConfirm, onClose, saving }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.22)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--red)' }}>🗑 Delete Entry?</h3>
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <strong>{row.client}</strong>
          {row.programType && <> — {row.programType}</>}
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>Start: {fmtDt(row.startDate)}</div>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--red)' }}>This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn"
            style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? 'Deleting…' : 'Yes, Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Status badge for completion ──────────────────────────────────────────────
function CompletionBadge({ completionDate }) {
  if (completionDate && completionDate !== '—') {
    return <span className="badge" style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>✓ Completed</span>;
  }
  return <span className="badge" style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }}>⏳ Pending</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ContentDevelopmentTracker({ onRefreshed }) {
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [typeF,     setTypeF]     = useState('All');
  const [statusF,   setStatusF]   = useState('All');
  const [toast,     setToast]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [showAdd,   setShowAdd]   = useState(false);
  const [editRow,   setEditRow]   = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);

  const { canEdit } = usePermissions();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await getContentDevTracker();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch(e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Unique program types for filter
  const programTypes = ['All', ...Array.from(new Set(data.map(r => r.programType).filter(Boolean))).sort()];

  const filtered = data.filter(r => {
    const q = search.toLowerCase();
    const matchQ = !q || r.client.toLowerCase().includes(q) || r.programType.toLowerCase().includes(q) || r.poc.toLowerCase().includes(q);
    const matchT = typeF === 'All' || r.programType === typeF;
    const isCompleted = !!(r.completionDate && r.completionDate !== '—');
    const matchS = statusF === 'All' || (statusF === 'Completed' && isCompleted) || (statusF === 'Pending' && !isCompleted);
    return matchQ && matchT && matchS;
  }).sort((a, b) => Number(a.sno) - Number(b.sno));

  const completed = data.filter(r => r.completionDate && r.completionDate !== '—').length;
  const pending   = data.length - completed;

  // ── CRUD handlers ──
  const handleAdd = async form => {
    setSaving(true);
    try {
      await addContentDevRow(form);
      showToast('✓ Entry added');
      setShowAdd(false);
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleEdit = async form => {
    if (!editRow) return;
    setSaving(true);
    try {
      await updateContentDevRow(editRow.sno, form);
      showToast('✓ Entry updated');
      setEditRow(null);
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    setSaving(true);
    try {
      await deleteContentDevRow(deleteRow.sno);
      showToast('✓ Entry deleted');
      setDeleteRow(null);
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState message="Loading Content Dev Tracker from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, background: 'var(--primary)', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 999, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {/* Modals */}
      {showAdd   && <AddEditModal initial={null}    onSave={handleAdd}    onClose={() => setShowAdd(false)}   saving={saving} />}
      {editRow   && <AddEditModal initial={editRow}  onSave={handleEdit}   onClose={() => setEditRow(null)}    saving={saving} />}
      {deleteRow && <DeleteConfirmModal row={deleteRow} onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={saving} />}

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card accent"><div className="kpi-label">Total Entries</div><div className="kpi-value">{data.length}</div></div>
        <div className="kpi-card green"><div className="kpi-label">Completed</div><div className="kpi-value">{completed}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Pending</div><div className="kpi-value">{pending}</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Program Types</div><div className="kpi-value">{programTypes.length - 1}</div></div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          style={{ width: 220 }}
          placeholder="🔍 Client, program type, POC…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="form-input" value={typeF} onChange={e => setTypeF(e.target.value)}>
          {programTypes.map(t => <option key={t}>{t}</option>)}
        </select>
        <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
          {['All', 'Completed', 'Pending'].map(s => <option key={s}>{s}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load}>↺ Refresh</button>
        {canEdit('content-dev') && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Entry</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
          {filtered.length} of {data.length} entries
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                {['#', 'Client', 'Program Type', 'Start Date', 'End Date', 'POC', 'EV Req.', 'PM Req.', 'Due Date', 'Completion Date', 'Status', canEdit('content-dev') ? 'Actions' : null]
                  .filter(Boolean)
                  .map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canEdit('content-dev') ? 12 : 11} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                    No entries found
                  </td>
                </tr>
              ) : filtered.map((r, i) => (
                <tr
                  key={r.sno}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: i % 2 === 0 ? '#fff' : '#fafbfc',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}
                >
                  <td style={{ padding: '10px 14px', color: 'var(--muted)', fontSize: 12, fontFamily: 'monospace' }}>{r.sno}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.client}>{r.client}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {r.programType
                      ? <span className="badge badge-blue">{r.programType}</span>
                      : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDt(r.startDate)}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDt(r.endDate)}</td>
                  <td style={{ padding: '10px 14px' }}>{r.poc || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <span style={{ fontWeight: 600, color: r.evRequired === 'Yes' ? 'var(--green)' : r.evRequired === 'No' ? 'var(--red)' : 'var(--muted)' }}>
                      {r.evRequired || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <span style={{ fontWeight: 600, color: r.pmRequired === 'Yes' ? 'var(--green)' : r.pmRequired === 'No' ? 'var(--red)' : 'var(--muted)' }}>
                      {r.pmRequired || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDt(r.dueDate)}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{fmtDt(r.completionDate)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <CompletionBadge completionDate={r.completionDate} />
                  </td>
                  {canEdit('content-dev') && (
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ padding: '3px 9px', fontSize: 11 }}
                          onClick={() => setEditRow(r)}
                          title="Edit entry"
                        >✏</button>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '3px 9px', fontSize: 11, background: '#fee2e2', color: 'var(--red)', border: '1px solid #fca5a5' }}
                          onClick={() => setDeleteRow(r)}
                          title="Delete entry"
                        >🗑</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
