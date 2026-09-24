import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorState } from '../components/LoadingState.jsx';
import {
  getEngagementsForRange, getAllEngagementsCached, buildMonthRange,
  peekEngagementsForRange, prefetchEngagementsForRange, patchEngagementCaches,
  addEngagementRow, updateEngagementRow, deleteEngagementRow,
} from '../services/api.js';
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
function EngagementCard({ eng, onEdit, onDelete, canEditEng, highlight = false }) {
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
      boxShadow: highlight
        ? '0 0 0 2px #e8760a, 0 4px 16px rgba(232,118,10,0.25)'
        : (open ? '0 3px 14px rgba(0,0,0,0.07)' : '0 1px 3px rgba(0,0,0,0.04)'),
      opacity: eng.pending ? 0.75 : 1,
      transition: 'box-shadow 0.18s, opacity 0.2s',
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
          {highlight && (
            <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 800, color: '#fff', background: '#e8760a', borderRadius: 20, padding: '2px 8px' }}>
              ⏭ Next up
            </span>
          )}
          {eng.pending && (
            <span style={{ display: 'inline-block', marginTop: 4, marginLeft: highlight ? 6 : 0, fontSize: 10, fontWeight: 700, color: '#1e40af', background: '#dbeafe', borderRadius: 20, padding: '2px 8px' }}>
              ⟳ Saving to Excel…
            </span>
          )}
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
            {canEditEng && !eng.pending && (
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

/* ─── Date-range helpers (page level) ───────────────────────────────────── */
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
const addMonths = (ym, delta) => {
  const d = new Date(ym.year, ym.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};
// Start month so that the current month sits in the middle of an N-month range
// (3 → prev, current, next; 1 → current only; 12 → 5 before … 6 after)
const defaultStart = span => {
  const t = new Date();
  return addMonths({ year: t.getFullYear(), month: t.getMonth() }, -Math.floor((span - 1) / 2));
};
const SPAN_OPTIONS = [1, 2, 3, 4, 6, 12];
const MIN_YEAR = 2022;
const MAX_SPAN = 24;
const rowKey = e => `${e.egId}|${e.sno}`;

/* ─── Range navigator (Months / Year view) ──────────────────────────────── */
function RangeNav({ viewMode, span, win, loading, containsToday, onMode, onSpan, onShift, onToday, onJumpMonth, onJumpYear, onChipClick }) {
  const [customOpen, setCustomOpen] = useState(!SPAN_OPTIONS.includes(span));
  const [draft, setDraft] = useState(String(span));
  useEffect(() => { setDraft(String(span)); }, [span]);

  const applyDraft = () => {
    const n = Math.max(1, Math.min(MAX_SPAN, parseInt(draft, 10) || 1));
    setDraft(String(n));
    if (n !== span) onSpan(n);
  };

  const first = win.months[0];
  const last  = win.months[win.months.length - 1];
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = Math.max(thisYear + 2, first.year); y >= Math.min(MIN_YEAR, first.year); y--) years.push(y);
  const currentKey = todayISO().slice(0, 7);

  const unit = viewMode === 'year' ? 'year' : (span === 1 ? 'month' : `${span} months`);
  const seg = active => ({
    padding: '5px 14px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
    background: active ? '#1a3a5c' : 'transparent', color: active ? '#fff' : '#475569',
  });
  const lbl = { fontSize: 12, fontWeight: 700, color: '#64748b' };
  const ctl = w => ({ width: w, padding: '4px 8px', fontSize: 12 });

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
      padding: '10px 16px', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={lbl}>📅 View:</span>
        <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden' }}>
          <button type="button" style={seg(viewMode === 'months')} onClick={() => onMode('months')} disabled={loading}>Months</button>
          <button type="button" style={seg(viewMode === 'year')}   onClick={() => onMode('year')}   disabled={loading}>Year</button>
        </div>

        {viewMode === 'months' ? (
          <>
            <span style={lbl}>Show</span>
            <select
              className="form-input"
              style={ctl(120)}
              value={customOpen ? 'custom' : String(span)}
              disabled={loading}
              onChange={e => {
                const v = e.target.value;
                if (v === 'custom') { setCustomOpen(true); return; }
                setCustomOpen(false);
                onSpan(Number(v));
              }}
            >
              {SPAN_OPTIONS.map(n => <option key={n} value={n}>{n} month{n > 1 ? 's' : ''}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {customOpen && (
              <input
                type="number" min={1} max={MAX_SPAN}
                className="form-input" style={ctl(72)}
                value={draft}
                title={`Number of months (1–${MAX_SPAN}) — press Enter to apply`}
                disabled={loading}
                onChange={e => setDraft(e.target.value)}
                onBlur={applyDraft}
                onKeyDown={e => { if (e.key === 'Enter') applyDraft(); }}
              />
            )}
            <span style={lbl}>From</span>
            <input
              type="month" className="form-input" style={ctl(150)}
              value={first.key}
              disabled={loading}
              onChange={e => { if (e.target.value) onJumpMonth(e.target.value); }}
            />
          </>
        ) : (
          <>
            <span style={lbl}>Year</span>
            <select
              className="form-input" style={ctl(100)}
              value={first.year}
              disabled={loading}
              onChange={e => onJumpYear(Number(e.target.value))}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => onShift(-1)} disabled={loading}>
            ◀ Previous {unit}
          </button>
          <button className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={onToday} disabled={loading}
                  title="Go to the current period and scroll to the next upcoming delivery">
            ● Today
          </button>
          <button className="btn btn-outline btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => onShift(1)} disabled={loading}>
            Next {unit} ▶
          </button>
        </div>
      </div>

      {/* Month chips — click to jump to that month in the list */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...lbl, fontWeight: 600, marginRight: 4 }}>
          {first.key === last.key ? first.label : `${first.label} – ${last.label}`}
          {win.months.length > 1 && ` · ${win.months.length} months`}
          {!containsToday && ' · (current month not in view)'}
        </span>
        {win.months.map(m => {
          const isNow = m.key === currentKey;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onChipClick(m.key)}
              title={`Jump to ${m.label}`}
              style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: isNow ? '1px solid #1a3a5c' : '1px solid transparent',
                background: isNow ? '#1a3a5c' : '#f1f5f9',
                color: isNow ? '#fff' : '#475569',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Loading skeleton (only when a period has never been loaded) ───────── */
function SkeletonCards({ count = 6 }) {
  return Array.from({ length: count }).map((_, i) => (
    <div key={i} className="ec-skel" style={{ height: 58, borderRadius: 9, marginBottom: 7, border: '1px solid #e2e8f0' }} />
  ));
}

// Form values → row shape used by the page (form keys already match row keys)
const rowFromForm = form => ({
  ...form,
  day:            Number(form.day)            || 1,
  price:          Number(form.price)          || 0,
  travelExpenses: Number(form.travelExpenses) || 0,
  gst:            Number(form.gst)            || 0,
});

// Form values → Excel column names expected by the Power Automate flow
const formToExcel = form => ({
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

/* ─── Main Page ─────────────────────────────────────────────────────────── */
export default function EngagementCalendar({ onRefreshed }) {
  const location = useLocation();

  // View: 'months' (N months starting at `start`) or 'year' (Jan–Dec of start.year)
  const [viewMode, setViewMode] = useState('months');
  const [span,     setSpan]     = useState(3);
  const [start,    setStart]    = useState(() => defaultStart(3));
  const win = useMemo(
    () => (viewMode === 'year'
      ? buildMonthRange(start.year, 0, 12)
      : buildMonthRange(start.year, start.month, span)),
    [viewMode, span, start],
  );
  const today = todayISO();
  const containsToday = today >= win.from && today <= win.to;
  const rangeLabel = win.months.length === 1
    ? win.months[0].label
    : `${win.months[0].label} – ${win.months[win.months.length - 1].label}`;

  // Show the saved copy (if any) on the very first render — no blank screen
  const [data, setData] = useState(() => peekEngagementsForRange(win.from, win.to) || []);
  const [rangeLoading, setRangeLoading] = useState(() => !peekEngagementsForRange(win.from, win.to));
  const [syncing,     setSyncing]     = useState(false);   // background refresh in progress
  const [error,       setError]       = useState(null);
  const [showAdd,     setShowAdd]     = useState(false);
  const [addPrefill,  setAddPrefill]  = useState(null);
  const [allRows,     setAllRows]     = useState(null);    // full list, loaded only for the Add form
  const [preparingAdd, setPreparingAdd] = useState(false);
  const [editRow,     setEditRow]     = useState(null);
  const [deleteRow,   setDeleteRow]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState('');
  const [scrollNonce, setScrollNonce] = useState(0);       // bump to re-run auto-scroll

  const { canEdit } = usePermissions();
  const requestId    = useRef(0);
  const cardRefs     = useRef({});
  const monthRefs    = useRef({});
  const scrolledFor  = useRef('');
  const toastTimer   = useRef(null);
  const revalTimer   = useRef(null);
  const loadRef      = useRef(null);

  const showToast = msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  };
  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(revalTimer.current); }, []);

  // Add form needs EVERY EG ID (to generate the next one), not just the visible
  // range — load the full list only at that moment (cached for 2 minutes).
  const openAdd = async (prefill = null) => {
    setAddPrefill(prefill);
    setPreparingAdd(true);
    try {
      setAllRows(await getAllEngagementsCached());
    } catch {
      setAllRows(null);
      showToast('⚠ Could not load all EG IDs — suggested EG ID is based on the visible months only. Please verify it.');
    } finally {
      setPreparingAdd(false);
      setShowAdd(true);
    }
  };

  // Open the Add modal pre-filled when navigated from Solution Tracker
  useEffect(() => {
    if (location.state?.prefill) {
      openAdd(location.state.prefill);
      // Clear the navigation state so a browser refresh doesn't re-open the modal
      window.history.replaceState({}, '', location.pathname);
    }
  }, []);

  /**
   * Stale-while-revalidate load:
   *  1. show the saved copy of this range immediately (if one exists)
   *  2. fetch a fresh copy in the background and swap it in quietly
   * keepCurrent: keep what is on screen (used by Refresh and after saves)
   */
  const load = useCallback(async ({ force = false, keepCurrent = false } = {}) => {
    const id = ++requestId.current;
    let hasData = keepCurrent;
    if (!keepCurrent) {
      const cached = peekEngagementsForRange(win.from, win.to);
      if (cached) { setData(cached); setRangeLoading(false); hasData = true; }
      else        { setData([]);     setRangeLoading(true); }
    }
    setSyncing(true); setError(null);
    try {
      const rows = await getEngagementsForRange(win.from, win.to, { force });
      if (id !== requestId.current) return;
      setData(rows);
      setRangeLoading(false);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) {
      if (id !== requestId.current) return;
      if (hasData) showToast('⚠ Could not refresh from Excel — showing the last saved copy.');
      else { setError(e); setRangeLoading(false); }
    } finally {
      if (id === requestId.current) setSyncing(false);
    }
  }, [win.from, win.to, onRefreshed]);
  loadRef.current = load;

  // Quiet refresh a moment after a write (Excel Online needs ~1-2s to reflect it)
  const revalidateSoon = () => {
    clearTimeout(revalTimer.current);
    revalTimer.current = setTimeout(() => loadRef.current?.({ force: true, keepCurrent: true }), 2500);
  };

  // Reload whenever the range changes (saved ranges appear instantly)
  useEffect(() => { load(); }, [win.from, win.to]);

  // Preload the previous and next period so Previous / Next feel instant
  useEffect(() => {
    if (syncing || rangeLoading || error) return;
    const t = setTimeout(() => {
      const n    = viewMode === 'year' ? 12 : span;
      const base = viewMode === 'year' ? { year: start.year, month: 0 } : start;
      [-n, n].forEach(d => {
        const s = addMonths(base, d);
        const r = buildMonthRange(s.year, s.month, n);
        prefetchEngagementsForRange(r.from, r.to);
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [syncing, rangeLoading, error, win.from, win.to]);

  /* ── Range controls ── */
  const changeMode = mode => {
    if (mode === viewMode) return;
    const nowYear = new Date().getFullYear();
    if (mode === 'year') {
      setStart({ year: containsToday ? nowYear : start.year, month: 0 });
    } else {
      setStart(start.year === nowYear ? defaultStart(span) : { year: start.year, month: 0 });
    }
    setViewMode(mode);
  };
  const changeSpan = n => {
    setSpan(n);
    if (containsToday) setStart(defaultStart(n));   // keep the current month centred
  };
  const shift = dir => setStart(s => (viewMode === 'year'
    ? { year: s.year + dir, month: 0 }
    : addMonths(s, dir * span)));
  const goToday = () => {
    setStart(viewMode === 'year' ? { year: new Date().getFullYear(), month: 0 } : defaultStart(span));
    setScrollNonce(n => n + 1);
  };
  const jumpMonth = ym => {
    const [y, m] = ym.split('-').map(Number);
    if (y && m) setStart({ year: y, month: m - 1 });
  };
  const jumpYear = y => setStart({ year: y, month: 0 });
  const scrollToMonth = key => {
    monthRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Undated rows are shown only when the range includes today, so they are not lost
  const windowRows = useMemo(
    () => data.filter(e => (e.undated ? containsToday : true)),
    [data, containsToday],
  );

  // Excel-style filters (per column, with value counts, blanks and sort)
  const filterState = useExcelFilters(windowRows);
  const { filtered } = filterState;
  const totalRev = filtered.reduce((s, e) => s + (e.price || 0), 0);

  // Group the filtered rows by month (keeps the filter/sort order inside a group)
  const groups = useMemo(() => {
    const byKey = new Map(win.months.map(m => [m.key, { ...m, rows: [] }]));
    const undated = { key: 'undated', label: 'No start date', rows: [] };
    filtered.forEach(e => {
      if (!e.startDate) { undated.rows.push(e); return; }
      // An engagement that started before the range is shown in the first month
      const k = (e.startDate < win.from ? win.from : e.startDate).slice(0, 7);
      (byKey.get(k) || byKey.get(win.months[0].key)).rows.push(e);
    });
    const list = [...byKey.values()];
    if (undated.rows.length) list.push(undated);
    return list;
  }, [filtered, win]);

  // Next upcoming (or ongoing) delivery — only when the current month is in view
  const nextUpKey = useMemo(() => {
    if (!containsToday) return null;
    let best = null;
    filtered.forEach(e => {
      if (!e.startDate) return;
      if (/cancel/i.test(e.status || '')) return;
      const end = e.endDate && e.endDate >= e.startDate ? e.endDate : e.startDate;
      if (end < today) return;                       // already finished
      if (!best || e.startDate < best.startDate) best = e;
    });
    return best ? rowKey(best) : null;
  }, [filtered, containsToday, today]);

  // Auto-scroll the next upcoming delivery to the middle of the screen
  // (once per range, and again whenever "Today" / "Next up" is clicked)
  useEffect(() => {
    if (rangeLoading || !nextUpKey) return;
    const token = `${win.from}|${win.to}|${scrollNonce}`;
    if (scrolledFor.current === token) return;
    const el = cardRefs.current[nextUpKey];
    if (!el) return;
    scrolledFor.current = token;
    const raf = requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => cancelAnimationFrame(raf);
  }, [rangeLoading, nextUpKey, win.from, win.to, scrollNonce]);

  /* ── Writes ── */

  // Add: needs Excel to assign the S No, so the modal waits for the save —
  // then the new row appears straight away and is confirmed by a quiet refresh.
  const handleAdd = async (form) => {
    setSaving(true);
    try {
      await addEngagementRow(rowFromForm(form));
      setShowAdd(false);
      setAddPrefill(null);
      setAllRows(null);
      const row = { ...rowFromForm(form), sno: '—', pending: true };
      if (!row.startDate || (row.startDate <= win.to && (row.endDate || row.startDate) >= win.from)) {
        setData(d => [...d, row]);
      }
      showToast('✓ Engagement added to Excel!');
      revalidateSoon();
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  // Edit: optimistic — the card updates instantly, Excel is written in the
  // background, and the change is rolled back if the save fails.
  const handleEdit = async (form) => {
    if (!editRow) return;
    const original = editRow;
    const oldKey   = rowKey(original);
    const updated  = { ...original, ...rowFromForm(form) };
    const newKey   = rowKey(updated);
    setEditRow(null);
    setData(d => d.map(r => (rowKey(r) === oldKey ? { ...updated, pending: true } : r)));
    try {
      await updateEngagementRow(original.egId, original.sno, formToExcel(form));
      setData(d => d.map(r => (rowKey(r) === newKey ? { ...r, pending: false } : r)));
      patchEngagementCaches(rows => rows.map(r => (rowKey(r) === oldKey ? { ...r, ...rowFromForm(form) } : r)));
      showToast('✓ Engagement updated!');
      revalidateSoon();
    } catch (e) {
      setData(d => d.map(r => (rowKey(r) === newKey ? original : r)));
      showToast('❌ Update failed — changes reverted. ' + e.message);
    }
  };

  // Delete: optimistic — the card disappears instantly and comes back if it fails.
  const handleDelete = async () => {
    if (!deleteRow) return;
    const victim   = deleteRow;
    const vKey     = rowKey(victim);
    const snapshot = data;
    setDeleteRow(null);
    setData(d => d.filter(r => rowKey(r) !== vKey));
    try {
      await deleteEngagementRow(victim.egId, victim.sno);
      patchEngagementCaches(rows => rows.filter(r => rowKey(r) !== vKey));
      setAllRows(null);
      showToast('✓ Engagement deleted!');
      revalidateSoon();
    } catch (e) {
      setData(prev => (prev.some(r => rowKey(r) === vKey) ? prev : snapshot));
      showToast('❌ Delete failed — engagement restored. ' + e.message);
    }
  };

  const currentKey = today.slice(0, 7);

  return (
    <div>
      <style>{`
        @keyframes egSlide {
          from { opacity: 0; transform: translateY(-5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ec-skel {
          background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%);
          background-size: 400% 100%;
          animation: ecShimmer 1.4s ease infinite;
        }
        @keyframes ecShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        .ec-syncbar { position: relative; height: 3px; overflow: hidden; border-radius: 2px; margin-bottom: 4px; }
        .ec-syncbar.on::after {
          content: ''; position: absolute; top: 0; left: -40%; width: 40%; height: 100%;
          background: #e8760a; border-radius: 2px; animation: ecSlideBar 1.1s ease-in-out infinite;
        }
        @keyframes ecSlideBar { 0% { left: -40%; } 100% { left: 100%; } }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, background: '#1a3a5c', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 999, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.18)', maxWidth: 420 }}>
          {toast}
        </div>
      )}

      {/* ── Range navigator: Months (1–24) or Year — never blocked while loading ── */}
      <RangeNav
        viewMode={viewMode}
        span={span}
        win={win}
        loading={false}
        containsToday={containsToday}
        onMode={changeMode}
        onSpan={changeSpan}
        onShift={shift}
        onToday={goToday}
        onJumpMonth={jumpMonth}
        onJumpYear={jumpYear}
        onChipClick={scrollToMonth}
      />

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <div className="kpi-card accent">
          <div className="kpi-label">Filtered Sessions</div>
          <div className="kpi-value">{rangeLoading ? '…' : filtered.length}</div>
          <div className="kpi-sub">of {windowRows.length} in {rangeLabel}</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Filtered Revenue</div>
          <div className="kpi-value">{rangeLoading ? '…' : fmt(totalRev)}</div>
          <div className="kpi-sub">{fmtINR(totalRev)}</div>
        </div>
        <div className="kpi-card blue">
          <div className="kpi-label">Unique Clients</div>
          <div className="kpi-value">{rangeLoading ? '…' : [...new Set(filtered.map(e => e.company))].length}</div>
        </div>
        <div className="kpi-card purple">
          <div className="kpi-label">Delivered</div>
          <div className="kpi-value">{rangeLoading ? '…' : filtered.filter(e => e.status === 'Delivered').length}</div>
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

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {syncing && !rangeLoading && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#e8760a' }}>⟳ Syncing with Excel…</span>
          )}
          {nextUpKey && (
            <button className="btn btn-outline btn-sm" onClick={() => setScrollNonce(n => n + 1)} title="Scroll to the next upcoming delivery">
              ⏭ Next up
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => load({ force: true, keepCurrent: !rangeLoading })} disabled={syncing}>
            ↺ Refresh
          </button>
          {canEdit('engagement') && (
            <button className="btn btn-primary btn-sm" onClick={() => openAdd()} disabled={preparingAdd}>
              {preparingAdd ? '⏳ Preparing…' : '+ Add Engagement'}
            </button>
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

      {/* Thin progress bar instead of covering the page */}
      <div className={`ec-syncbar${syncing ? ' on' : ''}`} />

      {/* ── Scrollable card list, grouped by month ── */}
      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 440px)', minHeight: 260, paddingRight: 2 }}>
        {error ? (
          <ErrorState error={error} onRetry={() => load({ force: true })} />
        ) : rangeLoading ? (
          <SkeletonCards />
        ) : filtered.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '52px 0', textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            {windowRows.length === 0
              ? `No engagements in ${rangeLabel}`
              : 'No engagements match the current filters'}
          </div>
        ) : (
          groups.map(g => (
            <div key={g.key} ref={el => { if (el) monthRefs.current[g.key] = el; }} style={{ marginBottom: 10, scrollMarginTop: 8 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, fontWeight: 800, color: '#1a3a5c',
                textTransform: 'uppercase', letterSpacing: 0.6,
                padding: '8px 4px 6px',
              }}>
                {g.label}
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 20, padding: '1px 8px' }}>
                  {g.rows.length}
                </span>
                {g.key === currentKey && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#1a3a5c', borderRadius: 20, padding: '1px 8px', textTransform: 'none', letterSpacing: 0 }}>
                    Current month
                  </span>
                )}
              </div>
              {g.rows.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 6px 8px' }}>No engagements this month</div>
              ) : g.rows.map((eng, i) => (
                <div
                  key={`${rowKey(eng)}-${i}`}
                  ref={el => { if (el) cardRefs.current[rowKey(eng)] = el; }}
                >
                  <EngagementCard
                    eng={eng}
                    highlight={rowKey(eng) === nextUpKey}
                    canEditEng={canEdit('engagement')}
                    onEdit={setEditRow}
                    onDelete={setDeleteRow}
                  />
                </div>
              ))}
            </div>
          ))
        )}

        {!error && !rangeLoading && filtered.length > 0 && (
          <div style={{ textAlign: 'center', padding: '14px 0', fontSize: 12, color: '#94a3b8' }}>
            Showing {filtered.length} engagement{filtered.length !== 1 ? 's' : ''} for {rangeLabel}.
            Use “Previous / Next” or change the view to see other periods.
          </div>
        )}
      </div>

      {showAdd   && <AddEditEngagementModal initial={null} prefill={addPrefill} onSave={handleAdd}  onClose={() => { setShowAdd(false); setAddPrefill(null); }} saving={saving} engagements={allRows || data} />}
      {editRow   && <AddEditEngagementModal initial={editRow} onSave={handleEdit} onClose={() => setEditRow(null)}    saving={false} engagements={data} />}
      {deleteRow && <DeleteEngagementModal  eng={deleteRow}   onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={false} />}
    </div>
  );
}
