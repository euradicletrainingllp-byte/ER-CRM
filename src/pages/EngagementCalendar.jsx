import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { getEngagements, addEngagementRow, updateEngagementRow, deleteEngagementRow } from '../services/api.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import { useExcelFilters, ExcelFilterButtons } from '../components/ExcelFilter.jsx';

/* ─── Date helpers ──────────────────────────────────────────────────────── */
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const excelToDate = serial => {
  // Excel serial → JS UTC date (accounts for Excel's 1900 leap-year bug)
  return new Date(Math.round((Number(serial) - 25569) * 86400 * 1000));
};

const fmtDt = d => {
  if (!d || d === '—') return '—';
  const s = String(d).trim();
  const num = Number(s);

  // Excel serial number (Power Automate returns raw integers for date cells)
  if (!isNaN(num) && num > 25000) {
    const dt = excelToDate(num);
    if (isNaN(dt)) return s;
    return `${DAYS[dt.getUTCDay()]}, ${String(dt.getUTCDate()).padStart(2,'0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  }

  // YYYY-MM-DD string
  const p = s.split('-');
  if (p.length === 3 && p[0].length === 4) {
    const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
    if (isNaN(dt)) return s;
    return `${DAYS[dt.getUTCDay()]}, ${String(dt.getUTCDate()).padStart(2,'0')} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  }

  return s;
};
const fmtINR = n => (n && n > 0) ? '₹' + Number(n).toLocaleString('en-IN') : '—';
const fmt    = n => (n && n > 0) ? '₹' + (n / 100000).toFixed(1) + 'L' : '₹0';

const STATUS_COLORS = {
  Delivered:      { bg: '#d1fae5', color: '#065f46' },
  Scheduled:      { bg: '#dbeafe', color: '#1e40af' },
  Tentative:      { bg: '#fef3c7', color: '#854d0e' },
  Cancelled:      { bg: '#fee2e2', color: '#991b1b' },
  Postponed:      { bg: '#ede9fe', color: '#5b21b6' },
  'Re-Schedule':  { bg: '#ffedd5', color: '#9a3412' },
};

/* ─── EG ID auto-generator ───────────────────────────────────────────────────
   Finds the largest numeric suffix across all existing EG IDs and increments.
   e.g. ["EG.ID 423", "EG.ID 425"] → "EG.ID 426"                            */
function generateNextEgId(existingIds) {
  if (!existingIds || existingIds.length === 0) return 'EG.ID 001';
  const pairs = existingIds
    .map(id => { const m = String(id).match(/^(.*?)(\d+)$/); return m ? [m[1], m[2]] : null; })
    .filter(Boolean);
  if (pairs.length === 0) return 'EG.ID 001';
  pairs.sort((a, b) => parseInt(a[1], 10) - parseInt(b[1], 10));
  const [prefix, digits] = pairs[pairs.length - 1];
  const next = String(parseInt(digits, 10) + 1).padStart(digits.length, '0');
  return prefix + next;
}

/* ─── Add / Edit Engagement Modal ──────────────────────────────────────── */
// Fields synced from Ops Checklist → Finance — read-only in the Engagement Calendar form
const OPS_MANAGED_FIELDS = ['invoice', 'payment', 'receivedDate'];

function AddEditEngagementModal({ initial, prefill, onSave, onClose, saving, engagements }) {
  const isEdit = !!initial;

  // ── EG ID logic (add mode only) ──────────────────────────────────────────
  const existingEgIds = isEdit
    ? []
    : [...new Set((engagements || []).map(e => e.egId).filter(Boolean))];
  const nextEgId = isEdit ? '' : generateNextEgId(existingEgIds);

  const [form, setForm] = useState(() => {
    if (isEdit) {
      return {
        egId:           initial.egId           || '',
        company:        initial.company        || '',
        startDate:      initial.startDate      || '',
        endDate:        initial.endDate        || '',
        topic:          initial.topic          || '',
        sector:         initial.sector         || '',
        serviceType:    initial.serviceType    || '',
        offering:       initial.offering       || '',
        day:            String(initial.day     || 1),
        location:       initial.location       || 'VILT',
        consultant1:    initial.consultant1    || '',
        consultant2:    initial.consultant2    || '',
        status:         initial.status         || 'Scheduled',
        contract:       initial.contract       || '',
        poStatus:       initial.poStatus       || '',
        invoice:        initial.invoice        || '',
        price:          initial.price          || '',
        travelExpenses: initial.travelExpenses || '',
        gst:            initial.gst            || '',
        payment:        initial.payment        || '',
        amountReceived: initial.amountReceived || '',
        receivedDate:   initial.receivedDate   || '',
        comments:       initial.comments       || '',
        feedback:       initial.feedback       || '',
        nps:            initial.nps            || '',
      };
    }
    // Add mode — use prefill values from Solution Tracker if provided
    return {
      egId:           nextEgId,
      company:        prefill?.company     || '',
      startDate:      '',
      endDate:        '',
      topic:          prefill?.topic       || '',
      sector:         prefill?.sector      || '',
      serviceType:    prefill?.serviceType || '',
      offering:       '',
      day:            '1',
      location:       'VILT',
      consultant1:    '',
      consultant2:    '',
      status:         'Scheduled',
      contract:       '',
      poStatus:       '',
      invoice:        '',
      price:          prefill?.price || '',
      travelExpenses: '',
      gst:            '',
      payment:        '',
      amountReceived: '',
      receivedDate:   '',
      comments:       '',
      feedback:       '',
      nps:            '',
    };
  });

  // Tracks which option is selected in the EG ID dropdown (add mode only)
  const [egSelect, setEgSelect] = useState('__new__');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? '✏️ Edit Engagement' : '📅 Add Engagement'}</div>
        <div className="form-grid">

          {/* ── EG ID — smart dropdown in add mode, plain text in edit ── */}
          {isEdit ? (
            <div className="form-field">
              <label className="form-label">EG ID</label>
              <input className="form-input" value={form.egId} onChange={e => set('egId', e.target.value)} />
            </div>
          ) : (
            <div className="form-field">
              <label className="form-label">EG ID *</label>
              <select
                className="form-input"
                value={egSelect}
                onChange={e => {
                  const val = e.target.value;
                  setEgSelect(val);
                  if (val === '__new__') {
                    // Reset to a blank form with the new auto-generated EG ID
                    setForm({
                      egId: nextEgId, company: '', startDate: '', endDate: '', topic: '',
                      sector: '', serviceType: '', offering: '', day: '1', location: 'VILT',
                      consultant1: '', consultant2: '', status: 'Scheduled',
                      contract: '', poStatus: '', invoice: '', price: '',
                      travelExpenses: '', gst: '', payment: '', amountReceived: '',
                      receivedDate: '', comments: '', feedback: '', nps: '',
                    });
                  } else {
                    // Find the most-recent row with this EG ID and pre-fill all fields
                    const match = (engagements || []).find(e => e.egId === val);
                    if (match) {
                      setForm({
                        egId:           val,
                        company:        match.company        || '',
                        startDate:      '',                        // dates differ per session — user fills in
                        endDate:        '',
                        topic:          match.topic          || '',
                        sector:         match.sector         || '',
                        serviceType:    match.serviceType    || '',
                        offering:       match.offering       || '',
                        day:            String(match.day     || 1),
                        location:       match.location       || 'VILT',
                        consultant1:    match.consultant1    || '',
                        consultant2:    match.consultant2    || '',
                        status:         'Scheduled',
                        contract:       match.contract       || '',
                        poStatus:       match.poStatus       || '',
                        invoice:        '',
                        price:          match.price          || '',
                        travelExpenses: '',
                        gst:            '',
                        payment:        '',   // managed per session in Ops Checklist
                        amountReceived: '',
                        receivedDate:   '',
                        comments:       match.comments       || '',
                        feedback:       match.feedback       || '',
                        nps:            match.nps            || '',
                      });
                    } else {
                      set('egId', val);
                    }
                  }
                }}
              >
                <option value="__new__">➕ New EG ID — {nextEgId}</option>
                {existingEgIds.map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              {egSelect !== '__new__' && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#e8760a' }}>
                  Adding another entry to existing engagement <strong>{form.egId}</strong>
                </p>
              )}
            </div>
          )}

          {/* ── All other fields ── */}
          {[
            ['Client / Company',                'company'],
            ['Start Date',                      'startDate',       '', 'date'],
            ['End Date',                        'endDate',         '', 'date'],
            ['Topic / Program',                 'topic',           'full'],
            ['Sector',                          'sector'],
            ['Service Type',                    'serviceType'],
            ['Offering',                        'offering'],
            ['No. of Days',                     'day',             '', 'number'],
            ['Location (VILT / City)',          'location'],
            ['Lead Consultant',                 'consultant1'],
            ['Co-Consultant',                   'consultant2'],
            ['Contract Type',                   'contract'],
            ['Contract Status',                 'poStatus'],
            ['Invoice Date',                    'invoice',         '', 'date'],
            ['Price (₹)',                       'price',           '', 'number'],
            ['Travel, Stay & Misc. Exp. (₹)',  'travelExpenses',  '', 'number'],
            ['GST (₹)',                         'gst',             '', 'number'],
            ['Payment Status',                  'payment'],
            ['Amount Received',                 'amountReceived'],
            ['Received Date',                   'receivedDate',    '', 'date'],
            ['Comments',                        'comments',        'full'],
            ['Feedback',                        'feedback',        'full'],
            ['NPS',                             'nps'],
          ].map(([label, key, span, type]) => {
            // Finance fields are owned by Ops Checklist → Finance tab (synced here automatically)
            const locked = OPS_MANAGED_FIELDS.includes(key);
            return (
              <div className={`form-field ${span || ''}`} key={key}>
                <label className="form-label">{label}{locked && ' 🔒'}</label>
                <input
                  type={type || 'text'}
                  className="form-input"
                  value={form[key] ?? ''}
                  onChange={locked ? undefined : e => set(key, e.target.value)}
                  readOnly={locked}
                  disabled={locked}
                  title={locked ? 'Updated from Ops Checklist → Finance' : undefined}
                  style={locked ? { background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' } : undefined}
                />
                {locked && (
                  <span style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Edit in Ops Checklist → Finance</span>
                )}
              </div>
            );
          })}

          <div className="form-field">
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
              {['Scheduled', 'Tentative', 'Delivered', 'Cancelled', 'Postponed', 'Re-Schedule'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.egId || !form.company || !form.topic || saving}>
            {saving ? '⏳ Saving…' : isEdit ? '✓ Update Engagement' : '✓ Save Engagement'}
          </button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
        {(!form.egId || !form.company || !form.topic) && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>
            * EG ID, Company and Topic are required
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Delete Confirm Modal ──────────────────────────────────────────────── */
function DeleteEngagementModal({ eng, onConfirm, onClose, saving }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: '#dc2626' }}>🗑 Delete Engagement?</div>
        <div style={{ background: '#fff7ed', border: '1px solid #fbbf24', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <strong>{eng.company}</strong> — {eng.topic}
          <div style={{ color: '#64748b', marginTop: 4, fontSize: 12 }}>{eng.egId} · {fmtDt(eng.startDate)}</div>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#dc2626' }}>This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn"
            style={{ background: '#dc2626', color: '#fff', border: 'none' }}
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

/* ─── Engagement Card (accordion) ───────────────────────────────────────── */
function EngagementCard({ eng, onEdit, onDelete, canEditEng }) {
  const [open, setOpen] = useState(false);
  const sc = STATUS_COLORS[eng.status] || { bg: '#f1f5f9', color: '#475569' };

  const startFmt = fmtDt(eng.startDate);
  const endFmt   = (eng.endDate && eng.endDate !== eng.startDate) ? fmtDt(eng.endDate) : '—';

  const details = [
    ['Sector',           eng.sector      || '—'],
    ['Service Type',     eng.serviceType || '—'],
    ['Offering',         eng.offering    || '—'],
    ['No. of Days',      eng.day         || '—'],
    ['Location / Mode',  eng.location    || '—'],
    ['Consultant 1',     eng.consultant1 || '—'],
    ['Consultant 2',     eng.consultant2 || '—'],
    ['Contract Type',    eng.contract    || '—'],
    ['Contract Status',  eng.poStatus    || '—'],
    ['Invoice Date',     eng.invoice ? fmtDt(eng.invoice) : '—'],
    ['Price (₹)',        eng.price > 0 ? fmtINR(eng.price) : '—'],
    ['Travel & Misc. (₹)', eng.travelExpenses > 0 ? fmtINR(eng.travelExpenses) : (eng.travelExpenses === 0 && eng.price > 0 ? '₹0' : '—')],
    ['GST (₹)',          eng.gst > 0 ? fmtINR(eng.gst) : (eng.gst === 0 && eng.price > 0 ? '₹0' : '—')],
    ['Payment Status',   eng.payment        || '—'],
    ['Amt Received',     eng.amountReceived || '—'],
    ['Received Date',    eng.receivedDate   || '—'],
    ['Comments',         eng.comments       || '—'],
    ['Feedback',         eng.feedback       || '—'],
    ['NPS',              eng.nps            || '—'],
  ];

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderLeft: `4px solid ${sc.color}`,
      borderRadius: 9,
      marginBottom: 7,
      overflow: 'hidden',
      boxShadow: open ? '0 3px 14px rgba(0,0,0,0.07)' : '0 1px 3px rgba(0,0,0,0.04)',
      transition: 'box-shadow 0.18s',
    }}>
      {/* ── Header row ── */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'grid',
          gridTemplateColumns: '100px 58px 1fr 190px 190px 108px 22px',
          alignItems: 'center',
          gap: '0 10px',
          padding: '11px 16px 11px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          background: open ? '#f8faff' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {/* EG.ID */}
        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {eng.egId}
        </div>

        {/* S.No */}
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
          {eng.sno}
        </div>

        {/* Company + Topic */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1a3a5c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {eng.company}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {eng.topic}
          </div>
        </div>

        {/* Start Date */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a3a5c', whiteSpace: 'nowrap' }}>
          {startFmt}
        </div>

        {/* End Date */}
        <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
          {endFmt}
        </div>

        {/* Status */}
        <div>
          <span style={{
            display: 'inline-block',
            background: sc.bg, color: sc.color,
            fontSize: 11, fontWeight: 700,
            padding: '3px 9px', borderRadius: 20,
            whiteSpace: 'nowrap',
          }}>
            {eng.status || '—'}
          </span>
        </div>

        {/* Chevron */}
        <div style={{
          fontSize: 14, color: '#94a3b8', textAlign: 'center',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }}>▾</div>
      </div>

      {/* ── Expanded detail panel ── */}
      {open && (
        <div style={{
          borderTop: '1px solid #e8edf4',
          padding: '16px 20px',
          background: '#f8fafc',
          animation: 'egSlide 0.16s ease',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '12px 24px',
          }}>
            {details.map(([lbl, val]) => (
              <div key={lbl}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
                  {lbl}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a5c' }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {eng.price > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#d1fae5', color: '#065f46', fontWeight: 700, fontSize: 13, padding: '5px 14px', borderRadius: 7 }}>
                💰 Revenue: {fmtINR(eng.price)}
              </div>
            )}
            {canEditEng && (
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <EditButton
                  title="Edit Engagement"
                  onClick={e => { e.stopPropagation(); onEdit(eng); }}
                />
                <DeleteButton
                  title="Delete Engagement"
                  onClick={e => { e.stopPropagation(); onDelete(eng); }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function EngagementCalendar({ onRefreshed }) {
  const location = useLocation();

  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [showAdd,     setShowAdd]     = useState(false);
  const [addPrefill,  setAddPrefill]  = useState(null);
  const [editRow,     setEditRow]     = useState(null);
  const [deleteRow,   setDeleteRow]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState('');

  const { canEdit } = usePermissions();

  // Open the Add modal pre-filled when navigated from Solution Tracker
  useEffect(() => {
    if (location.state?.prefill) {
      setAddPrefill(location.state.prefill);
      setShowAdd(true);
      // Clear the navigation state so a browser refresh doesn't re-open the modal
      window.history.replaceState({}, '', location.pathname);
    }
  }, []);

  // Excel-style filters (per column, with value counts, blanks and sort)
  const filterState = useExcelFilters(data);
  const { filtered } = filterState;
  const totalRev = filtered.reduce((s, e) => s + (e.price || 0), 0);

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

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleAdd = async (form) => {
    setSaving(true);
    try {
      await addEngagementRow({
        ...form,
        day:            Number(form.day)            || 1,
        price:          Number(form.price)          || 0,
        travelExpenses: Number(form.travelExpenses) || 0,
        gst:            Number(form.gst)            || 0,
      });
      setShowAdd(false);
      showToast('✓ Engagement added to Excel!');
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleEdit = async (form) => {
    if (!editRow) return;
    setSaving(true);
    try {
      // Use exact Excel column names for fields with spaces/special chars
      await updateEngagementRow(editRow.egId, editRow.sno, {
        'EG ID':                           form.egId           || '',
        company:                           form.company        || '',
        'Start Date':                      form.startDate      || '',
        'End Date':                        form.endDate        || '',
        topic:                             form.topic          || '',
        sector:                            form.sector         || '',
        'Service Type':                    form.serviceType    || '',
        offering:                          form.offering       || '',
        day:                               Number(form.day)    || 1,
        location:                          form.location       || '',
        'Consultant - 1':                  form.consultant1    || '',
        'Consultant - 2':                  form.consultant2    || '',
        status:                            form.status         || '',
        contract:                          form.contract       || '',
        'PO Status':                       form.poStatus       || '',
        invoice:                           form.invoice        || '',
        'Price (INR)':                     Number(form.price)  || 0,
        'Travel, Stay and Misc Expenses':  Number(form.travelExpenses) || 0,
        gst:                               Number(form.gst)    || 0,
        payment:                           form.payment        || '',
        'Amount Received':                 form.amountReceived || '',
        'Received Date':                   form.receivedDate   || '',
        comments:                          form.comments       || '',
        feedback:                          form.feedback       || '',
        nps:                               form.nps            || '',
      });
      setEditRow(null);
      showToast('✓ Engagement updated!');
      // Small delay before reload — Excel Online has ~1-2s lag between a PA write
      // and the change being visible on the next read. Without this, load() fetches
      // stale data and the update appears to not have reflected.
      await new Promise(res => setTimeout(res, 1500));
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteRow) return;
    setSaving(true);
    try {
      await deleteEngagementRow(deleteRow.egId, deleteRow.sno);
      setDeleteRow(null);
      showToast('✓ Engagement deleted!');
      await load();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState message="Loading Engagement Calendar from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div>
      <style>{`
        @keyframes egSlide {
          from { opacity: 0; transform: translateY(-5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, background: '#1a3a5c', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 999, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}>
          {toast}
        </div>
      )}

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <div className="kpi-card accent">
          <div className="kpi-label">Filtered Sessions</div>
          <div className="kpi-value">{filtered.length}</div>
          <div className="kpi-sub">of {data.length} total</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Filtered Revenue</div>
          <div className="kpi-value">{fmt(totalRev)}</div>
          <div className="kpi-sub">{fmtINR(totalRev)}</div>
        </div>
        <div className="kpi-card blue">
          <div className="kpi-label">Unique Clients</div>
          <div className="kpi-value">{[...new Set(filtered.map(e => e.company))].length}</div>
        </div>
        <div className="kpi-card purple">
          <div className="kpi-label">Delivered</div>
          <div className="kpi-value">{filtered.filter(e => e.status === 'Delivered').length}</div>
        </div>
      </div>

      {/* ── Excel-style Filter Bar ── */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '12px 16px', marginBottom: 14,
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginRight: 4 }}>
          🔽 Filter by:
        </span>

        <ExcelFilterButtons state={filterState} />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={load}>↺ Refresh</button>
          {canEdit('engagement') && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Engagement</button>
          )}
        </div>
      </div>

      {/* ── Column header labels ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '100px 58px 1fr 190px 190px 108px 22px',
        gap: '0 10px',
        padding: '5px 20px 5px 18px',
        marginBottom: 5,
      }}>
        {['EG.ID', 'S.No', 'Company / Topic', 'Start Date', 'End Date', 'Status', ''].map((h, i) => (
          <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.7 }}>
            {h}
          </div>
        ))}
      </div>

      {/* ── Scrollable card list ── */}
      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 340px)', paddingRight: 2 }}>
        {filtered.length === 0
          ? (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '52px 0', textAlign: 'center', color: '#64748b', fontSize: 14 }}>
              No engagements match the current filters
            </div>
          )
          : filtered.map((eng, i) => (
            <EngagementCard
              key={`${eng.egId}-${i}`}
              eng={eng}
              canEditEng={canEdit('engagement')}
              onEdit={setEditRow}
              onDelete={setDeleteRow}
            />
          ))
        }

        {filtered.length > 0 && (
          <div style={{ textAlign: 'center', padding: '14px 0', fontSize: 12, color: '#94a3b8' }}>
            Showing all {filtered.length} engagement{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {showAdd   && <AddEditEngagementModal initial={null} prefill={addPrefill} onSave={handleAdd}  onClose={() => { setShowAdd(false); setAddPrefill(null); }} saving={saving} engagements={data} />}
      {editRow   && <AddEditEngagementModal initial={editRow} onSave={handleEdit} onClose={() => setEditRow(null)}    saving={saving} engagements={data} />}
      {deleteRow && <DeleteEngagementModal  eng={deleteRow}   onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={saving} />}
    </div>
  );
}
