import { useState, useEffect, useMemo } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { peekList, getOpsChecklist, addOpsRow, updateOpsRow, deleteOpsRow } from '../services/api.js';
import { syncOpsWithEC, syncOpsFinanceToEC, OPS_FINANCE_TO_EC } from '../services/syncWithEC.js';
import { usePermissions } from '../hooks/usePermissions.js';
import SyncScopeModal from '../components/SyncScopeModal.jsx';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const addDays = (dateStr, n) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const fmtDate = d => {
  if (!d) return '—';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return s;
    return `${String(dt.getUTCDate()).padStart(2,'0')}/${String(dt.getUTCMonth()+1).padStart(2,'0')}/${String(dt.getUTCFullYear()).slice(2)}`;
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
    const [y,m,day] = s.split('-');
    return `${day}/${m}/${y.slice(2)}`;
  }
  return s;
};

const toInputDate = d => {
  if (!d) return '';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  }
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0, 10);
  return '';
};

const dueDateColor = (dueDate) => {
  if (!dueDate) return 'var(--muted)';
  const due = new Date(dueDate);
  const now = new Date();
  const diff = (due - now) / 86400000;
  if (diff < 0) return 'var(--red)';
  if (diff <= 3) return '#f59e0b';
  return 'var(--green)';
};

const dueDateLabel = (dueDate) => {
  if (!dueDate) return '';
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.round((due - now) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff <= 3) return `Due in ${diff}d`;
  return '';
};

// ─── TAT definitions ─────────────────────────────────────────────────────────
const CL_ITEMS = [
  { key:'calendarBlock',     label:'Facilitator Calendar Block',         pocKey:'calendarBlockPoc',      doneKey:'calendarBlockDone',      commentKey:'calendarBlockComment',      tatFn:(s,e)=>addDays(e,-14) },
  { key:'travelDetails',     label:'Travel Details Finalised',           pocKey:'travelDetailsPoc',      doneKey:'travelDetailsDone',      commentKey:'travelDetailsComment',      tatFn:(s,e)=>addDays(s,-10) },
  { key:'welcomeEmail',      label:'Welcome Email + Pre-Work',           pocKey:'welcomeEmailPoc',       doneKey:'welcomeEmailDone',       commentKey:'welcomeEmailComment',       tatFn:(s,e)=>addDays(e,-7)  },
  { key:'preWork',           label:'Pre-Work Details',                   pocKey:'preWorkPoc',            doneKey:'preWorkDone',            commentKey:'preWorkComment',            tatFn:(s,e)=>addDays(s,-5)  },
  { key:'evAndPm',           label:'EV & PM Shared with Consultant',     pocKey:'evAndPmPoc',            doneKey:'evAndPmDone',            commentKey:'evAndPmComment',            tatFn:(s,e)=>addDays(s,-15) },
  { key:'bootcamp',          label:'Bootcamp Finalised',                 pocKey:'bootcampPoc',           doneKey:'bootcampDone',           commentKey:'bootcampComment',           tatFn:(s,e)=>addDays(e,-12) },
  { key:'teachback',         label:'Teachback Finalised',                pocKey:'teachbackPoc',          doneKey:'teachbackDone',          commentKey:'teachbackComment',          tatFn:(s,e)=>addDays(s,-7)  },
  { key:'electronicVisuals', label:'Electronic Visuals + QR',            pocKey:'electronicVisualsPoc',  doneKey:'electronicVisualsDone',  commentKey:'electronicVisualsComment',  tatFn:(s,e)=>e              },
  { key:'participantManual', label:'Participant Manual',                  pocKey:'participantManualPoc',  doneKey:'participantManualDone',  commentKey:'participantManualComment',  tatFn:(s,e)=>addDays(e,-1)  },
  { key:'materialPrinting',  label:'Material Printing Required',         pocKey:'materialPrintingPoc',   doneKey:'materialPrintingDone',   commentKey:'materialPrintingComment',   tatFn:()=>null              },
  { key:'materialOrdering',  label:'Material Ordering & Delivery Status',pocKey:'materialOrderingPoc',   doneKey:'materialOrderingDone',   commentKey:'materialOrderingComment',   tatFn:()=>null              },
  { key:'materialConversion',label:'Material Conversion to Editable Form',pocKey:'materialConversionPoc',doneKey:'materialConversionDone', commentKey:'materialConversionComment', tatFn:()=>null              },
  { key:'attendanceSheet',   label:'Attendance Sheet & Photos',          pocKey:'attendanceSheetPoc',    doneKey:'attendanceSheetDone',    commentKey:'attendanceSheetComment',    tatFn:(s,e)=>addDays(e,1)   },
  { key:'feedbackReport',    label:'Feedback Report',                    pocKey:'feedbackReportPoc',     doneKey:'feedbackReportDone',     commentKey:'feedbackReportComment',     tatFn:(s,e)=>addDays(e,1)   },
  { key:'impactReport',      label:'Impact Report',                      pocKey:'impactReportPoc',       doneKey:'impactReportDone',       commentKey:'impactReportComment',       tatFn:()=>null              },
  { key:'socialMedia',       label:'Social Media Post',                  pocKey:'socialMediaPoc',        doneKey:'socialMediaDone',        commentKey:'socialMediaComment',        tatFn:(s,e)=>addDays(e,1)   },
];

const clScore = (row) => {
  const vals = CL_ITEMS.map(it => row[it.key]);
  const done = vals.filter(v => v === 'Yes' || v === 'NA').length;
  return Math.round((done / CL_ITEMS.length) * 100);
};

const EMPTY_FORM = {
  egId:'', company:'', clientSpoc:'', startDate:'', endDate:'',
  topic:'', sector:'', serviceType:'', offering:'', internalPoc:'',
  contractType:'', contractStatus:'', paxListReceived:'',
  noOfParticipants:'', day:'', programType:'', location:'',
  consultant1:'', consultant2:'', consultant3:'', status:'Scheduled',
};

// ─── Add / Edit Modal ────────────────────────────────────────────────────────
function AddEditModal({ initial, onSave, onClose, saving }) {
  const isEdit = !!initial?.sno;
  const [form, setForm] = useState(isEdit ? {
    egId:             initial.egId             || '',
    company:          initial.company          || '',
    clientSpoc:       initial.clientSpoc       || '',
    startDate:        toInputDate(initial.startDate) || '',
    endDate:          toInputDate(initial.endDate)   || '',
    topic:            initial.topic            || '',
    sector:           initial.sector           || '',
    serviceType:      initial.serviceType      || '',
    offering:         initial.offering         || '',
    internalPoc:      initial.internalPoc      || '',
    contractType:     initial.contractType     || '',
    contractStatus:   initial.contractStatus   || '',
    paxListReceived:  initial.paxListReceived  || '',
    noOfParticipants: initial.noOfParticipants || '',
    day:              initial.day              || '',
    programType:      initial.programType      || '',
    location:         initial.location         || '',
    consultant1:      initial.consultant1      || '',
    consultant2:      initial.consultant2      || '',
    consultant3:      initial.consultant3      || '',
    status:           initial.status           || 'Scheduled',
  } : { ...EMPTY_FORM });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = { className: 'form-input' };
  const Row = ({ label, children }) => (
    <div className="form-field"><label className="form-label">{label}</label>{children}</div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? '✏️ Edit Session' : '➕ Add New Session'}</div>
        <div className="form-grid">
          <Row label="EG.ID"><input {...inp} value={form.egId} onChange={e => set('egId', e.target.value)} placeholder="EG.ID 001" /></Row>
          <Row label="Company *"><input {...inp} value={form.company} onChange={e => set('company', e.target.value)} /></Row>
          <Row label="Client SPOC"><input {...inp} value={form.clientSpoc} onChange={e => set('clientSpoc', e.target.value)} /></Row>
          <Row label="Internal POC"><input {...inp} value={form.internalPoc} onChange={e => set('internalPoc', e.target.value)} /></Row>
          <Row label="Engagement Start Date"><input {...inp} type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /></Row>
          <Row label="Engagement End Date"><input {...inp} type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} /></Row>
          <div className="form-field full"><label className="form-label">Topic / Program</label><input {...inp} value={form.topic} onChange={e => set('topic', e.target.value)} /></div>
          <Row label="Sector"><input {...inp} value={form.sector} onChange={e => set('sector', e.target.value)} /></Row>
          <Row label="Service Type"><input {...inp} value={form.serviceType} onChange={e => set('serviceType', e.target.value)} /></Row>
          <Row label="Offering"><input {...inp} value={form.offering} onChange={e => set('offering', e.target.value)} /></Row>
          <Row label="Program Type">
            <select {...inp} value={form.programType} onChange={e => set('programType', e.target.value)}>
              {['','ILT','VILT','Blended','Hybrid','Other'].map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </Row>
          <Row label="Location"><input {...inp} value={form.location} onChange={e => set('location', e.target.value)} /></Row>
          <Row label="No. of Participants"><input {...inp} type="number" min="0" value={form.noOfParticipants} onChange={e => set('noOfParticipants', e.target.value)} /></Row>
          <Row label="Day(s)"><input {...inp} type="number" min="0" step="0.25" value={form.day} onChange={e => set('day', e.target.value)} /></Row>
          <Row label="Consultant 1"><input {...inp} value={form.consultant1} onChange={e => set('consultant1', e.target.value)} /></Row>
          <Row label="Consultant 2"><input {...inp} value={form.consultant2} onChange={e => set('consultant2', e.target.value)} /></Row>
          <Row label="Consultant 3"><input {...inp} value={form.consultant3} onChange={e => set('consultant3', e.target.value)} /></Row>
          <Row label="Contract Type">
            <select {...inp} value={form.contractType} onChange={e => set('contractType', e.target.value)}>
              {['','PO','MSA','LOI','Other'].map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </Row>
          <Row label="Contract Status">
            <select {...inp} value={form.contractStatus} onChange={e => set('contractStatus', e.target.value)}>
              {['','Received','Pending','NA'].map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </Row>
          <Row label="Pax List Received">
            <select {...inp} value={form.paxListReceived} onChange={e => set('paxListReceived', e.target.value)}>
              {['','Yes','No','NA'].map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
            </select>
          </Row>
          <Row label="Status">
            <select {...inp} value={form.status} onChange={e => set('status', e.target.value)}>
              {['Scheduled','Delivered','Tentative','Cancelled'].map(s => <option key={s}>{s}</option>)}
            </select>
          </Row>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.company || saving}>
            {saving ? '⏳ Saving…' : isEdit ? '✓ Update Session' : '✓ Save Session'}
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
        <div className="modal-title" style={{ color:'var(--red)' }}>🗑 Delete Session?</div>
        <div style={{ background:'#fff7ed', border:'1px solid #fbbf24', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13 }}>
          <strong>{row.company}</strong>{row.topic && <> — {row.topic}</>}
          <div style={{ color:'var(--muted)', fontSize:12, marginTop:4 }}>{row.egId} · {fmtDate(row.startDate)}</div>
        </div>
        <p style={{ margin:'0 0 20px', fontSize:13, color:'var(--red)' }}>This cannot be undone.</p>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn" style={{ background:'var(--red)', color:'#fff', border:'none' }} onClick={onConfirm} disabled={saving}>
            {saving ? 'Deleting…' : 'Yes, Delete'}
          </button>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Comment Cell ─────────────────────────────────────────────────────
function CommentCell({ value, commentKey, row, canEdit, onUpdate, saving }) {
  const [editing, setEditing] = useState(false);
  if (!canEdit && !value) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {editing ? (
        <textarea
          autoFocus
          defaultValue={value}
          rows={2}
          onBlur={e => { onUpdate(row, { [commentKey]: e.target.value }); setEditing(false); }}
          style={{
            width: '100%', fontSize: 10, padding: '3px 6px',
            border: '1px solid var(--accent)', borderRadius: 4, resize: 'vertical',
            fontFamily: 'inherit', lineHeight: 1.4,
          }}
        />
      ) : (
        <div
          onClick={() => canEdit && setEditing(true)}
          style={{
            fontSize: 10, color: value ? '#6b7280' : 'var(--muted)',
            fontStyle: value ? 'italic' : 'normal',
            cursor: canEdit ? 'pointer' : 'default',
            background: value ? '#f9fafb' : 'transparent',
            borderRadius: 4, padding: value ? '2px 6px' : '1px 4px',
            border: value ? '1px solid #e5e7eb' : '1px dashed transparent',
            lineHeight: 1.4, minHeight: 18,
            transition: 'border-color 0.15s',
          }}
          title={canEdit ? 'Click to edit comment' : ''}
        >
          {value || (canEdit ? <span style={{ color:'#d1d5db' }}>+ add comment</span> : null)}
        </div>
      )}
    </div>
  );
}

// ─── Checklist Detail Panel ──────────────────────────────────────────────────
function ChecklistPanel({ row, canEdit, onUpdate, saving }) {
  const [tab, setTab] = useState('checklist');
  const [editingPoc, setEditingPoc]   = useState(null);
  const [editingDone, setEditingDone] = useState(null);
  // Item waiting for a completion date before 'Yes' is saved
  const [pendingYes, setPendingYes]   = useState(null);
  const [invForm, setInvForm] = useState({
    invoiceGenerated:  row.invoiceGenerated  || '',
    invoicePoc:        row.invoicePoc        || '',
    invoiceActualDate: toInputDate(row.invoiceActualDate) || '',
    invoiceComment:    row.invoiceComment    || '',
    paymentReceived:   row.paymentReceived   || '',
    paymentActualDate: toInputDate(row.paymentActualDate) || '',
  });

  const startDate = toInputDate(row.startDate);
  const endDate   = toInputDate(row.endDate);
  const score     = clScore(row);
  const scoreColor = score === 100 ? 'var(--green)' : score > 60 ? 'var(--accent)' : 'var(--red)';
  const invDue = addDays(endDate, 1);
  const payDue = row.invoiceActualDate ? addDays(toInputDate(row.invoiceActualDate), 30) : null;

  return (
    <div className="card" style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div className="card-header" style={{ flexShrink:0, flexWrap:'wrap', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div className="card-title" style={{ fontSize:15 }}>{row.company}</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            {row.egId} · {fmtDate(row.startDate)}{row.endDate && row.endDate !== row.startDate ? ` → ${fmtDate(row.endDate)}` : ''}
            {row.internalPoc && <> · <strong>POC:</strong> {row.internalPoc}</>}
          </div>
          <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:5 }}>
            <StatusBadge value={row.status} />
            {row.sector && <span className="badge badge-gray">{row.sector}</span>}
            {row.programType && <span className="badge badge-blue">{row.programType}</span>}
            {row.noOfParticipants > 0 && <span className="badge badge-purple">👥 {row.noOfParticipants} pax</span>}
            {row.consultant1 && <span className="badge badge-gray">👤 {row.consultant1}</span>}
            {row.consultant2 && <span className="badge badge-gray">👤 {row.consultant2}</span>}
            {row.consultant3 && <span className="badge badge-gray">👤 {row.consultant3}</span>}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <div style={{ fontSize:22, fontWeight:800, color:scoreColor }}>{score}%</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>complete</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding:'0 16px 12px', flexShrink:0 }}>
        <div className="progress-wrap">
          <div className="progress-fill" style={{ width:score+'%', background:scoreColor }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0, padding:'0 16px' }}>
        {[['checklist','✅ Checklist'],['details','📋 Session Info'],['finance','💰 Finance']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{
            border:'none', background:'none', padding:'8px 14px', cursor:'pointer',
            fontSize:12, fontWeight: tab===t ? 700 : 500,
            color: tab===t ? 'var(--primary)' : 'var(--muted)',
            borderBottom: tab===t ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom:-1,
          }}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflowY:'auto', padding:16 }}>

        {/* ── Checklist Tab ── */}
        {tab === 'checklist' && (
          <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ color:'var(--muted)', textAlign:'left', borderBottom:'2px solid var(--border)' }}>
                <th style={{ padding:'4px 6px 8px 0', width:22 }}>#</th>
                <th style={{ padding:'4px 6px 8px 0' }}>Task &amp; Comments</th>
                <th style={{ padding:'4px 6px 8px 0', width:70 }}>Status</th>
                <th style={{ padding:'4px 6px 8px 0', width:72 }}>POC</th>
                <th style={{ padding:'4px 6px 8px 0', width:62 }}>Due</th>
                <th style={{ padding:'4px 6px 8px 0', width:76 }}>Done Date</th>
              </tr>
            </thead>
            <tbody>
              {CL_ITEMS.map((item, idx) => {
                const status  = row[item.key]       ?? '';
                const poc     = row[item.pocKey]    ?? '';
                const done    = row[item.doneKey]   ?? '';
                const comment = row[item.commentKey]?? '';
                const due     = item.tatFn(startDate, endDate);
                const isDone  = status === 'Yes' || status === 'NA';
                const dColor  = isDone ? 'var(--muted)' : dueDateColor(due);
                const dLabel  = isDone ? '' : dueDateLabel(due);

                return (
                  <tr key={item.key} style={{
                    borderBottom:'1px solid var(--border)',
                    background: status==='Yes' ? '#f0fdf4' : status==='NA' ? '#f9fafb' : 'transparent',
                  }}>
                    <td style={{ padding:'8px 6px 6px 0', color:'var(--muted)', verticalAlign:'top' }}>{idx+1}</td>

                    {/* Task name + comment below */}
                    <td style={{ padding:'8px 6px 6px 0', verticalAlign:'top' }}>
                      <div style={{
                        fontWeight:500,
                        color: status==='Yes' ? 'var(--muted)' : 'inherit',
                        textDecoration: status==='Yes' ? 'line-through' : 'none',
                      }}>
                        {item.label}
                      </div>
                      {dLabel && <div style={{ fontSize:10, color:dColor, fontWeight:600, marginTop:1 }}>{dLabel}</div>}
                      <CommentCell
                        value={comment}
                        commentKey={item.commentKey}
                        row={row}
                        canEdit={canEdit}
                        onUpdate={onUpdate}
                        saving={saving}
                      />
                    </td>

                    {/* Status */}
                    <td style={{ padding:'8px 6px 6px 0', verticalAlign:'top' }}>
                      {canEdit ? (
                        <select
                          value={pendingYes === item.key ? 'Yes' : status}
                          onChange={e => {
                            const v = e.target.value;
                            // 'Yes' is only stored together with a completion date
                            if (v === 'Yes' && !toInputDate(done)) {
                              setPendingYes(item.key);
                              setEditingDone(null);
                              return;
                            }
                            setPendingYes(p => (p === item.key ? null : p));
                            onUpdate(row, { [item.key]: v });
                          }}
                          disabled={saving}
                          style={{
                            fontSize:11, padding:'2px 4px', borderRadius:4, border:'1px solid var(--border)',
                            color: status==='Yes'?'var(--green)':status==='NA'?'var(--muted)':status==='No'?'var(--red)':'var(--accent)',
                            background:'white', cursor:'pointer',
                          }}
                        >
                          <option value="">Pending</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                          <option value="NA">NA</option>
                        </select>
                      ) : (
                        <span style={{ color:status==='Yes'?'var(--green)':status==='NA'?'var(--muted)':status==='No'?'var(--red)':'var(--accent)', fontWeight:600 }}>
                          {status || 'Pending'}
                        </span>
                      )}
                    </td>

                    {/* POC */}
                    <td style={{ padding:'8px 6px 6px 0', verticalAlign:'top' }}>
                      {editingPoc?.key === item.key ? (
                        <input
                          autoFocus
                          defaultValue={poc}
                          onBlur={e => { onUpdate(row, { [item.pocKey]: e.target.value }); setEditingPoc(null); }}
                          onKeyDown={e => e.key==='Enter' && e.target.blur()}
                          style={{ width:66, fontSize:11, padding:'2px 4px', border:'1px solid var(--accent)', borderRadius:4 }}
                        />
                      ) : (
                        <span
                          style={{ color:poc?'var(--primary)':'var(--muted)', cursor:canEdit?'pointer':'default', fontSize:11 }}
                          onClick={() => canEdit && setEditingPoc({ key:item.key })}
                          title={canEdit ? 'Click to edit POC' : ''}
                        >
                          {poc || (canEdit ? '+ POC' : '—')}
                        </span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td style={{ padding:'8px 6px 6px 0', verticalAlign:'top' }}>
                      <span style={{ color:dColor, fontWeight:dLabel?700:400, fontSize:11 }}>
                        {fmtDate(due)}
                      </span>
                    </td>

                    {/* Done Date */}
                    <td style={{ padding:'8px 6px 6px 0', verticalAlign:'top' }}>
                      {pendingYes === item.key ? (
                        <div>
                          <input
                            autoFocus type="date" required
                            onChange={e => {
                              const d = e.target.value;
                              if (!d) return;
                              onUpdate(row, { [item.key]: 'Yes', [item.doneKey]: d });
                              setPendingYes(null);
                            }}
                            onBlur={e => { if (!e.target.value) setPendingYes(null); }}
                            style={{ width:110, fontSize:11, padding:'2px 4px', border:'1.5px solid var(--red)', borderRadius:4 }}
                          />
                          <div style={{ fontSize:10, color:'var(--red)', fontWeight:600, marginTop:2 }}>Date required for Yes</div>
                        </div>
                      ) : editingDone?.key === item.key ? (
                        <input
                          autoFocus type="date"
                          defaultValue={toInputDate(done)}
                          onBlur={e => {
                            const d = e.target.value;
                            // Clearing the date of a 'Yes' item → status goes back to Pending
                            if (!d && status === 'Yes') onUpdate(row, { [item.doneKey]: '', [item.key]: '' });
                            else if (d !== toInputDate(done)) onUpdate(row, { [item.doneKey]: d });
                            setEditingDone(null);
                          }}
                          style={{ width:110, fontSize:11, padding:'2px 4px', border:'1px solid var(--accent)', borderRadius:4 }}
                        />
                      ) : (
                        <span
                          style={{ color:done?'var(--green)':'var(--muted)', cursor:canEdit?'pointer':'default', fontSize:11 }}
                          onClick={() => canEdit && setEditingDone({ key:item.key })}
                          title={canEdit ? 'Click to set completion date' : ''}
                        >
                          {done ? fmtDate(done) : (canEdit ? '+ Date' : '—')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ── Session Info Tab ── */}
        {tab === 'details' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 24px', fontSize:13 }}>
            {[
              ['EG.ID', row.egId], ['Company', row.company], ['Client SPOC', row.clientSpoc],
              ['Internal POC', row.internalPoc], ['Start Date', fmtDate(row.startDate)], ['End Date', fmtDate(row.endDate)],
              ['Topic', row.topic], ['Sector', row.sector], ['Service Type', row.serviceType],
              ['Offering', row.offering], ['Program Type', row.programType], ['Location', row.location],
              ['Day(s)', row.day], ['No. of Participants', row.noOfParticipants],
              ['Consultant 1', row.consultant1], ['Consultant 2', row.consultant2], ['Consultant 3', row.consultant3],
              ['Contract Type', row.contractType], ['Contract Status', row.contractStatus],
              ['Pax List Received', row.paxListReceived], ['Status', row.status],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>{label}</div>
                <div style={{ fontWeight:500 }}>{val || '—'}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Finance Tab ── */}
        {tab === 'finance' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px 24px', fontSize:13 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Invoice Status</div>
              {canEdit ? (
                <select className="form-input" style={{ fontSize:12 }} value={invForm.invoiceGenerated}
                  onChange={e => { const v=e.target.value; setInvForm(f=>({...f,invoiceGenerated:v})); onUpdate(row,{invoiceGenerated:v}); }}>
                  {['','Raised','Not Raised'].map(v => <option key={v} value={v}>{v||'— select —'}</option>)}
                  {/* keep an older value (e.g. Yes/No/NA) visible until it is changed */}
                  {invForm.invoiceGenerated && !['Raised','Not Raised'].includes(invForm.invoiceGenerated) && (
                    <option value={invForm.invoiceGenerated}>{invForm.invoiceGenerated} (old value)</option>
                  )}
                </select>
              ) : <div style={{ fontWeight:500 }}>{row.invoiceGenerated||'—'}</div>}
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Invoice POC</div>
              {canEdit ? (
                <input className="form-input" style={{ fontSize:12 }} value={invForm.invoicePoc}
                  onChange={e => setInvForm(f=>({...f,invoicePoc:e.target.value}))}
                  onBlur={e => onUpdate(row,{invoicePoc:e.target.value})} />
              ) : <div style={{ fontWeight:500 }}>{row.invoicePoc||'—'}</div>}
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Invoice Due Date (TAT)</div>
              <div style={{ fontWeight:500, color:dueDateColor(invDue) }}>{fmtDate(invDue)}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Actual Invoice Date</div>
              {canEdit ? (
                <input type="date" className="form-input" style={{ fontSize:12 }} value={invForm.invoiceActualDate}
                  onChange={e => setInvForm(f=>({...f,invoiceActualDate:e.target.value}))}
                  onBlur={e => onUpdate(row,{invoiceActualDate:e.target.value})} />
              ) : <div style={{ fontWeight:500 }}>{fmtDate(row.invoiceActualDate)||'—'}</div>}
            </div>
            <div style={{ gridColumn:'1 / -1' }}>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Invoice Comments</div>
              {canEdit ? (
                <textarea className="form-input" style={{ fontSize:12, resize:'vertical', minHeight:48 }}
                  value={invForm.invoiceComment}
                  onChange={e => setInvForm(f=>({...f,invoiceComment:e.target.value}))}
                  onBlur={e => onUpdate(row,{invoiceComment:e.target.value})}
                  placeholder="Add invoice notes…"
                />
              ) : <div style={{ fontWeight:500, fontStyle:row.invoiceComment?'italic':'normal', color:row.invoiceComment?'inherit':'var(--muted)' }}>{row.invoiceComment||'—'}</div>}
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Payment Due Date (TAT)</div>
              <div style={{ fontWeight:500, color:dueDateColor(payDue) }}>{fmtDate(payDue)||'Set invoice date first'}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Payment Received</div>
              {canEdit ? (
                <select className="form-input" style={{ fontSize:12 }} value={invForm.paymentReceived}
                  onChange={e => { const v=e.target.value; setInvForm(f=>({...f,paymentReceived:v})); onUpdate(row,{paymentReceived:v}); }}>
                  {['','Yes','No','NA'].map(v => <option key={v} value={v}>{v||'— select —'}</option>)}
                </select>
              ) : <div style={{ fontWeight:500 }}>{row.paymentReceived||'—'}</div>}
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, marginBottom:2 }}>Actual Payout Date</div>
              {canEdit ? (
                <input type="date" className="form-input" style={{ fontSize:12 }} value={invForm.paymentActualDate}
                  onChange={e => setInvForm(f=>({...f,paymentActualDate:e.target.value}))}
                  onBlur={e => onUpdate(row,{paymentActualDate:e.target.value})} />
              ) : <div style={{ fontWeight:500 }}>{fmtDate(row.paymentActualDate)||'—'}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function OpsChecklist({ onRefreshed }) {
  const [data,      setData]      = useState(() => peekList('ops') || []);
  const [loading,   setLoading]   = useState(() => !peekList('ops'));   // full loader only on the very first visit
  const [refreshing, setRefreshing] = useState(false);                  // quiet background refresh
  const [scopeOpen, setScopeOpen] = useState(false);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [statusF,   setStatusF]   = useState('All');
  const [selected,  setSelected]  = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [editRow,   setEditRow]   = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [syncing,   setSyncing]   = useState(false);
  const [syncProg,  setSyncProg]  = useState(null); // { done, total }
  const [toast,     setToast]     = useState('');

  const { canEdit } = usePermissions();

  // Show the last loaded rows straight away, then fetch fresh rows in the background
  const load = async () => {
    const saved = peekList('ops');
    if (saved) { setData(d => (d.length ? d : saved)); setLoading(false); }
    else setLoading(true);
    setRefreshing(true); setError(null);
    try {
      const rows = await getOpsChecklist();
      setData(rows);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch(e) {
      if (saved) showToast('⚠ Could not refresh from Excel — showing the last saved copy.');
      else setError(e);
    }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() =>
    data.filter(r => {
      const q = search.toLowerCase();
      const mQ = !q || r.company.toLowerCase().includes(q) || r.topic.toLowerCase().includes(q) || r.egId.toLowerCase().includes(q);
      const mS = statusF === 'All' || r.status === statusF;
      return mQ && mS;
    }).sort((a,b) => (Number(a.sno)||0) - (Number(b.sno)||0)),
    [data, search, statusF]
  );

  const sel = selected != null ? data.find(d => d.sno === selected) : null;
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleUpdate = async (row, changes) => {
    setSaving(true);
    try {
      await updateOpsRow(row.sno, changes);
      setData(prev => prev.map(r => r.sno === row.sno ? { ...r, ...changes } : r));

      // Finance fields → keep Engagement Calendar in sync (only when a value actually changed)
      const financeChanged = Object.keys(changes).some(k =>
        k in OPS_FINANCE_TO_EC && String(changes[k] ?? '') !== String(row[k] ?? '')
      );
      if (financeChanged) {
        try {
          const res = await syncOpsFinanceToEC(row.sno, changes, row);
          showToast(res.synced ? '✓ Saved · Engagement Calendar updated' : `✓ Saved · ⚠ EC not updated: ${res.reason}`);
        } catch (err) {
          showToast('✓ Saved · ⚠ Engagement Calendar sync failed: ' + err.message);
        }
      } else {
        showToast('✓ Saved');
      }
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleAdd = async form => {
    setSaving(true);
    try {
      await addOpsRow(form);
      setShowAdd(false);
      showToast('✓ Session added');
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleEdit = async form => {
    setSaving(true);
    try {
      await updateOpsRow(editRow.sno, form);
      setEditRow(null);
      showToast('✓ Session updated');
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await deleteOpsRow(deleteRow.sno);
      if (selected === deleteRow.sno) setSelected(null);
      setDeleteRow(null);
      showToast('✓ Session deleted');
      await load();
    } catch(e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const handleSyncWithEC = async (scope = 'recent') => {
    setSyncing(true);
    setSyncProg({ done: 0, total: 0 });
    try {
      const { updated, added, errors } = await syncOpsWithEC(p => setSyncProg(p), scope);
      const errPart = errors.length ? ` · ${errors.length} error${errors.length > 1 ? 's' : ''}` : '';
      showToast(`✓ Synced: ${updated} updated, ${added} added${errPart}`);
      // Wait briefly for Excel Online to settle, then reload
      await new Promise(r => setTimeout(r, 1500));
      await load();
    } catch(e) {
      showToast('❌ Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
      setSyncProg(null);
    }
  };

  if (loading) return <LoadingState message="Loading Ops Checklist from OneDrive…" />;
  if (error)   return <ErrorState error={error} onRetry={load} />;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 68px)', overflow:'hidden' }}>
      {toast && (
        <div style={{ position:'fixed', top:70, right:24, background:'var(--primary)', color:'#fff', padding:'10px 20px', borderRadius:8, zIndex:999, fontSize:13, fontWeight:600, boxShadow:'0 4px 12px rgba(0,0,0,0.15)' }}>
          {toast}
        </div>
      )}

      {showAdd   && <AddEditModal initial={null}    onSave={handleAdd}  onClose={() => setShowAdd(false)} saving={saving} />}
      {editRow   && <AddEditModal initial={editRow} onSave={handleEdit} onClose={() => setEditRow(null)}  saving={saving} />}
      {deleteRow && <DeleteConfirmModal row={deleteRow} onConfirm={handleDelete} onClose={() => setDeleteRow(null)} saving={saving} />}
      {scopeOpen && <SyncScopeModal target="Ops Checklist" onClose={() => setScopeOpen(false)} onConfirm={scope => { setScopeOpen(false); handleSyncWithEC(scope); }} />}

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:16, flexShrink:0 }}>
        <div className="kpi-card accent"><div className="kpi-label">Total Sessions</div><div className="kpi-value">{data.length}</div></div>
        <div className="kpi-card green"><div className="kpi-label">100% Ready</div><div className="kpi-value">{data.filter(r=>clScore(r)===100).length}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">In Progress</div><div className="kpi-value">{data.filter(r=>{const s=clScore(r);return s>0&&s<100;}).length}</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Delivered</div><div className="kpi-value">{data.filter(r=>r.status==='Delivered').length}</div></div>
      </div>

      {/* Two-column layout */}
      <div className="grid-sidebar" style={{ flex:1, overflow:'hidden', minHeight:0 }}>

        {/* LEFT — session list */}
        <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
          <div className="filter-bar" style={{ flexShrink:0 }}>
            <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
              {['All','Scheduled','Delivered','Tentative','Cancelled'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={load} disabled={syncing || refreshing} title={refreshing ? 'Refreshing from Excel…' : 'Refresh'}>{refreshing ? '⟳' : '↺'}</button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setScopeOpen(true)}
              disabled={syncing || saving}
              title="Pull matching rows from Engagement Calendar and update / add them here"
              style={{ color: syncing ? 'var(--muted)' : 'var(--accent)', borderColor: 'var(--accent)' }}
            >
              {syncing
                ? syncProg?.total > 0
                  ? `⏳ ${syncProg.done}/${syncProg.total}`
                  : '⏳ Syncing…'
                : '🔄 Sync with EC'}
            </button>
            {canEdit('ops') && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)} disabled={syncing}>+ Add</button>}
          </div>

          <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div className="card-header" style={{ flexShrink:0 }}>
              <span className="card-title">⚙️ Sessions</span>
              <span style={{ fontSize:12, color:'var(--muted)' }}>{filtered.length} of {data.length}</span>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {filtered.length === 0
                ? <div style={{ padding:32, textAlign:'center', color:'var(--muted)' }}>No sessions found</div>
                : filtered.map((r, i) => {
                    const score = clScore(r);
                    const color = score===100?'var(--green)':score>60?'var(--accent)':'var(--red)';
                    const isSel = selected === r.sno;
                    return (
                      <div key={i} onClick={() => setSelected(isSel ? null : r.sno)} style={{
                        padding:'10px 14px', borderBottom:'1px solid var(--border)',
                        cursor:'pointer', background:isSel?'#f0f7ff':'transparent',
                        borderLeft:isSel?'3px solid var(--accent)':'3px solid transparent',
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ fontSize:11, fontWeight:700, color:'var(--muted)', background:'var(--border)', borderRadius:4, padding:'1px 6px', flexShrink:0 }}>#{r.sno}</span><span style={{ fontWeight:700, fontSize:13 }}>{r.company}</span></div>
                            <div style={{ fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={r.topic}>{r.topic}</div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:14, fontWeight:800, color, lineHeight:1 }}>{score}%</div>
                              <div style={{ marginTop:2 }}><StatusBadge value={r.status} /></div>
                            </div>
                            {canEdit('ops') && (
                              <div style={{ display:'flex', flexDirection:'column', gap:3 }} onClick={ev => ev.stopPropagation()}>
                                <EditButton iconOnly title="Edit Session" onClick={() => setEditRow(r)} />
                                <DeleteButton iconOnly title="Delete Session" onClick={() => setDeleteRow(r)} />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="progress-wrap" style={{ margin:'6px 0 4px' }}>
                          <div className="progress-fill" style={{ width:score+'%', background:color }} />
                        </div>
                        <div style={{ display:'flex', gap:10, fontSize:11, color:'var(--muted)' }}>
                          <span>📅 {fmtDate(r.startDate)}</span>
                          {r.consultant1 && <span>👤 {r.consultant1}</span>}
                          {r.egId && <span style={{ fontFamily:'monospace' }}>{r.egId}</span>}
                          {r.noOfParticipants > 0 && <span>👥 {r.noOfParticipants}</span>}
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
            ? <ChecklistPanel row={sel} canEdit={canEdit('ops')} onUpdate={handleUpdate} saving={saving} />
            : (
              <div className="card" style={{ textAlign:'center', padding:'60px 20px', color:'var(--muted)' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>👈</div>
                <div style={{ fontWeight:600, color:'var(--primary)', marginBottom:4 }}>Select a session</div>
                <div style={{ fontSize:13 }}>Click any session on the left to view its checklist, due dates, and finance details</div>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}
