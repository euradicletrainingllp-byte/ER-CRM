import { useState, useEffect, useMemo } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { getBDTracker, addBDRow, updateBDRow, deleteBDRow, renumberBDRows } from '../services/api.js';
import { usePermissions } from '../hooks/usePermissions.js';

const STAGES = ['Prospect','Cold Calling','Proposal Sent','In Negotiation','Confirmed','Won','Lost'];
const fmtINR = n => n ? '₹' + Number(n).toLocaleString('en-IN') : '—';

const EMPTY_FORM = {
  client: '', concern: '', contact: '', topic: '',
  status: 'Prospect', duration: '', statusDetail: '',
  commercials: '', comments: '', serviceType: '',
  proposalLink1: '', modules: '',
  proposalLink2: '', modules3: '',
  proposalLink3: '', modules4: '',
};

// ─── Add / Edit Modal ────────────────────────────────────────────────────────
function AddEditModal({ initial, onSave, onClose, saving }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(isEdit ? {
    client:        initial.client        || '',
    concern:       initial.concern       || '',
    contact:       initial.contact       || '',
    topic:         initial.topic         || '',
    status:        initial.status        || 'Prospect',
    duration:      initial.duration      || '',
    statusDetail:  initial.statusDetail  || '',
    commercials:   initial.commercials   || '',
    comments:      initial.comments      || '',
    serviceType:   initial.serviceType   || '',
    proposalLink1: initial.proposalLink1 || '',
    modules:       initial.modules       || '',
    proposalLink2: initial.proposalLink2 || '',
    modules3:      initial.modules3      || '',
    proposalLink3: initial.proposalLink3 || '',
    modules4:      initial.modules4      || '',
  } : { ...EMPTY_FORM });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? '✏️ Edit BD Lead' : '➕ Add New BD Lead'}</div>
        <div className="form-grid">
          {[
            ['Client / Company',  'client'],
            ['Concern Person',    'concern'],
            ['Contact Number',    'contact'],
            ['Topic / Program',   'topic',          'full'],
            ['Duration / Dates',  'duration'],
            ['Status Detail',     'statusDetail'],
            ['Comments',          'comments'],
            ['Service Type',      'serviceType'],
            ['Proposal Link 1',   'proposalLink1',  'full'],
            ['Modules (Proposal 1)', 'modules',     'full'],
            ['Proposal Link 2',   'proposalLink2',  'full'],
            ['Modules (Proposal 2)', 'modules3',    'full'],
            ['Proposal Link 3',   'proposalLink3',  'full'],
            ['Modules (Proposal 3)', 'modules4',    'full'],
          ].map(([label, key, span]) => (
            <div className={`form-field ${span || ''}`} key={key}>
              <label className="form-label">{label}</label>
              <input className="form-input" value={form[key]} onChange={e => set(key, e.target.value)} />
            </div>
          ))}
          <div className="form-field">
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Commercials (₹)</label>
            <input type="number" className="form-input" value={form.commercials} onChange={e => set('commercials', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.client || saving}>
            {saving ? '⏳ Saving…' : isEdit ? '✓ Update Lead' : '✓ Save Lead'}
          </button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ────────────────────────────────────────────────────
function DeleteConfirmModal({ row, onConfirm, onClose, saving }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: 'var(--red)' }}>🗑 Delete BD Lead?</div>
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <strong>{row.client}</strong>
          {row.topic && <> — {row.topic}</>}
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>Status: {row.status}</div>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--red)' }}>This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn"
            style={{ background: 'var(--red)', color: '#fff', border: 'none' }}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? 'Deleting…' : 'Yes, Delete'}
          </button>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function BDPipeline({ onRefreshed }) {
  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [stageF,    setStageF]    = useState('All');
  const [showAdd,   setShowAdd]   = useState(false);
  const [editRow,   setEditRow]   = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const { canEdit } = usePermissions();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await getBDTracker();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => data.filter(r => {
    const q = search.toLowerCase();
    const matchQ = !q || r.client.toLowerCase().includes(q) || r.topic.toLowerCase().includes(q) || r.status.toLowerCase().includes(q);
    const matchS = stageF === 'All' || r.status === stageF;
    return matchQ && matchS;
  }), [data, search, stageF]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Add ──
  const handleAdd = async form => {
    setSaving(true);
    try {
      await addBDRow(form);
      setShowAdd(false);
      showToast('✓ Lead added to Excel successfully!');
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  // ── Edit ──
  const handleEdit = async form => {
    if (!editRow) return;
    setSaving(true);
    try {
      await updateBDRow(editRow.sno, {
        'Client':           form.client,
        'Concern Person':   form.concern,
        'Contact Number':   form.contact,
        'Topic':            form.topic,
        'Status':           form.status,
        'Duration / Dates': form.duration,
        'Status2':          form.statusDetail || '',
        'Commercials':      form.commercials || '',
        'Comments':         form.comments,
        'Service Type':     form.serviceType,
        'Proposal Link 1':  form.proposalLink1 || '',
        'Modules':          form.modules || '',
        'Proposal Link 2':  form.proposalLink2 || '',
        'Modules3':         form.modules3 || '',
        'Proposal Link 3':  form.proposalLink3 || '',
        'Modules4':         form.modules4 || '',
      });
      setEditRow(null);
      showToast('✓ Lead updated successfully!');
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  // ── Delete ──
  const handleDelete = async () => {
    if (!deleteRow) return;
    setSaving(true);
    try {
      const deletedSno = deleteRow.sno;
      await deleteBDRow(deletedSno);
      // Renumber all rows that had S.No > deleted row, so Excel stays sequential
      await renumberBDRows(deletedSno, data);
      setDeleteRow(null);
      showToast('✓ Lead deleted and S.No updated!');
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState message="Loading BD Tracker from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, background: 'var(--primary)', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 999, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {/* Modals */}
      {showAdd   && <AddEditModal initial={null}     onSave={handleAdd}    onClose={() => setShowAdd(false)}   saving={saving} />}
      {editRow   && <AddEditModal initial={editRow}  onSave={handleEdit}   onClose={() => setEditRow(null)}    saving={saving} />}
      {deleteRow && <DeleteConfirmModal row={deleteRow} onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={saving} />}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[
          ['Total Leads',     data.length,                                         'accent'],
          ['Confirmed',       data.filter(r => r.status === 'Confirmed').length,   'blue'  ],
          ['Proposals Sent',  data.filter(r => r.status === 'Proposal Sent').length,'purple'],
          ['Won',             data.filter(r => r.status === 'Won').length,         'green' ],
        ].map(([label, val, v]) => (
          <div key={label} className={`kpi-card ${v}`}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{val}</div>
          </div>
        ))}
      </div>

      <div className="filter-bar">
        <input className="form-input wide" placeholder="🔍 Search client, topic, status…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input" value={stageF} onChange={e => setStageF(e.target.value)}>
          <option>All</option>
          {STAGES.map(s => <option key={s}>{s}</option>)}
        </select>
        <button className="btn btn-outline" onClick={() => { setSearch(''); setStageF('All'); }}>Reset</button>
        {canEdit('bd') && (
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Lead</button>
        )}
        <button className="btn btn-outline btn-sm" onClick={load} style={{ marginLeft: 'auto' }}>↺ Refresh from Excel</button>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">🎯 BD Pipeline — Live from Excel</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} of {data.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Client / Company</th>
                <th>Concern Person</th>
                <th>Contact</th>
                <th>Topic / Program</th>
                <th>Status</th>
                <th>Duration / Dates</th>
                <th>Deal Detail</th>
                <th>Commercials</th>
                <th>Comments</th>
                <th>Service Type</th>
                <th>Proposal Links</th>
                {canEdit('bd') && <th style={{ textAlign: 'center' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={canEdit('bd') ? 13 : 12} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>No records match your filter</td></tr>
                : filtered.map((r, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--muted)' }}>{r.sno || i + 1}</td>
                    <td><strong>{r.client}</strong></td>
                    <td>{r.concern || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.contact || '—'}</td>
                    <td className="td-ellipsis" title={r.topic}>{r.topic}</td>
                    <td><StatusBadge value={r.status} /></td>
                    <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.duration || '—'}</td>
                    <td><StatusBadge value={r.statusDetail} /></td>
                    <td style={{ fontWeight: 600, color: r.commercials ? 'var(--green)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {r.commercials ? fmtINR(r.commercials) : '—'}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{r.comments || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{r.serviceType || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {[
                        r.proposalLink1 && { url: r.proposalLink1, label: 'P1', mod: r.modules },
                        r.proposalLink2 && { url: r.proposalLink2, label: 'P2', mod: r.modules3 },
                        r.proposalLink3 && { url: r.proposalLink3, label: 'P3', mod: r.modules4 },
                      ].filter(Boolean).map(({ url, label, mod }) => (
                        <div key={label} style={{ marginBottom: 2 }}>
                          <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>{label}</a>
                          {mod && <span style={{ color: 'var(--muted)', marginLeft: 4 }} title={mod}>— {mod.length > 30 ? mod.slice(0, 30) + '…' : mod}</span>}
                        </div>
                      ))}
                      {!r.proposalLink1 && !r.proposalLink2 && !r.proposalLink3 && <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    {canEdit('bd') && (
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            onClick={() => setEditRow(r)}
                            title="Edit"
                          >✏</button>
                          <button
                            className="btn btn-sm"
                            style={{ padding: '3px 8px', fontSize: 11, background: '#fee2e2', color: 'var(--red)', border: '1px solid #fca5a5' }}
                            onClick={() => setDeleteRow(r)}
                            title="Delete"
                          >🗑</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
