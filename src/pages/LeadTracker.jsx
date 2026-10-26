/**
 * LEAD TRACKER
 * ============
 * Every lead from every direction in one list: where it came from (source + detail),
 * who shared it, who owns it, its status, and a timeline of every action taken on it —
 * several people can act on one lead, each action keeps its own status and comment.
 * Excel: Lead_Tracker.xlsx → LeadTable (flow LEADS_CRUD). Key: Lead ID (LD-0001…).
 */
import { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useNavigate } from 'react-router-dom';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import ExportButton from '../components/ExportButton.jsx';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import { peekList } from '../services/api.js';
import { getLeads, addLead, updateLead, deleteLead, nextLeadId } from '../services/leadsVendorsApi.js';
import { pendingItems, LEAD_RULES } from '../config/pendingFields.js';
import {
  LEAD_SOURCES, LEAD_STATUSES, LEAD_CLOSED, LEAD_PRIORITIES, LEAD_ACTION_TYPES, LEAD_FOLLOWUP_DEFAULT_DAYS, leadIsOpen,
} from '../config/leadVendorOptions.js';
import '../styles/leadsVendors.css';

/* ─── Helpers ─── */
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysFrom = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(todayIso() + 'T00:00:00Z')) / 86400000);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { if (!iso) return '—'; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? iso : `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
const fmtAt = at => { if (!at) return ''; const d = new Date(at); return isNaN(d) ? at : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const inr = v => (Number(v) ? '₹ ' + Number(v).toLocaleString('en-IN') : '—');
const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const STATUS_TONE = {
  'New': 'lv-st-new', 'Contacted': 'lv-st-prog', 'In discussion': 'lv-st-prog', 'Proposal requested': 'lv-st-prog',
  'Converted to BD': 'lv-st-won', 'On hold': 'lv-st-hold', 'Not interested': 'lv-st-lost', 'Lost / Closed': 'lv-st-lost',
};
const StatusPill = ({ value }) => <span className={`lv-pill ${STATUS_TONE[value] || 'lv-st-hold'}`}>{value || '—'}</span>;
const PriorityDot = ({ value }) => value ? <span className={`lv-prio lv-prio-${norm(value)}`} title={`${value} lead`}>{value}</span> : null;

function followInfo(l) {
  if (!leadIsOpen(l)) return null;
  if (!l.nextFollowUp) return { text: 'No follow-up set', cls: 'lv-due-none' };
  const d = daysFrom(l.nextFollowUp);
  if (d < 0) return { text: `Follow-up ${-d}d overdue`, cls: 'lv-due-bad' };
  if (d === 0) return { text: 'Follow-up today', cls: 'lv-due-warn' };
  if (d <= 3) return { text: `Follow-up in ${d}d`, cls: 'lv-due-warn' };
  return { text: `Follow-up ${fmtD(l.nextFollowUp)}`, cls: 'lv-due-ok' };
}

/** Select that keeps an old value typed in Excel visible */
function Select({ value, options, onChange, blank = '— select —' }) {
  return (
    <select className="form-input" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (old value)</option>}
    </select>
  );
}
const Field = ({ label, full, children }) => (
  <div className={`form-field${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
);

/* ─── Add / Edit lead ─── */
const EMPTY = {
  leadId: '', dateReceived: '', source: '', sourceDetail: '', sharedBy: '', company: '', contactName: '', designation: '',
  email: '', phone: '', requirement: '', programInterest: '', owner: '', status: 'New', priority: 'Warm', nextFollowUp: '',
  estValue: '', proposalId: '', actions: [], comments: '', createdBy: '',
};

function LeadModal({ initial, onSave, onClose, saving, names, me }) {
  const isEdit = !!initial;
  const [f, setF] = useState(() => (isEdit ? { ...EMPTY, ...initial } : { ...EMPTY, dateReceived: todayIso(), owner: me, createdBy: me }));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const valid = f.company.trim() && f.source;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? `Edit Lead · ${f.leadId}` : 'Add Lead'}</div>
        <datalist id="lv-names">{names.map(n => <option key={n} value={n} />)}</datalist>

        <div className="lv-form-section">Where it came from</div>
        <div className="form-grid">
          <Field label="Lead Source *"><Select value={f.source} options={LEAD_SOURCES} onChange={v => set('source', v)} /></Field>
          <Field label="Source Detail"><input className="form-input" value={f.sourceDetail} onChange={e => set('sourceDetail', e.target.value)} placeholder="Event name, referring client, post link…" /></Field>
          <Field label="Shared By"><input className="form-input" list="lv-names" value={f.sharedBy} onChange={e => set('sharedBy', e.target.value)} placeholder="Who passed this lead on" /></Field>
          <Field label="Date Received"><input className="form-input" type="date" value={f.dateReceived} onChange={e => set('dateReceived', e.target.value)} /></Field>
        </div>

        <div className="lv-form-section">Who</div>
        <div className="form-grid">
          <Field label="Company *"><input className="form-input" value={f.company} onChange={e => set('company', e.target.value)} /></Field>
          <Field label="Contact Person"><input className="form-input" value={f.contactName} onChange={e => set('contactName', e.target.value)} /></Field>
          <Field label="Designation"><input className="form-input" value={f.designation} onChange={e => set('designation', e.target.value)} /></Field>
          <Field label="Email"><input className="form-input" type="email" value={f.email} onChange={e => set('email', e.target.value.trim())} /></Field>
          <Field label="Phone"><input className="form-input" value={f.phone} onChange={e => set('phone', e.target.value)} /></Field>
          <Field label="Estimated Value (₹)"><input className="form-input" inputMode="decimal" value={f.estValue} onChange={e => set('estValue', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
          <Field label="Requirement" full><textarea className="form-input" rows={2} value={f.requirement} onChange={e => set('requirement', e.target.value)} placeholder="What the client is looking for" /></Field>
          <Field label="Program Interest"><input className="form-input" value={f.programInterest} onChange={e => set('programInterest', e.target.value)} placeholder="e.g. Leadership, Negotiation" /></Field>
        </div>

        <div className="lv-form-section">Ownership &amp; status</div>
        <div className="form-grid">
          <Field label="Lead Owner"><input className="form-input" list="lv-names" value={f.owner} onChange={e => set('owner', e.target.value)} /></Field>
          <Field label="Status"><Select value={f.status} options={LEAD_STATUSES} onChange={v => set('status', v)} blank="— status —" /></Field>
          <Field label="Priority"><Select value={f.priority} options={LEAD_PRIORITIES} onChange={v => set('priority', v)} /></Field>
          <Field label="Next Follow-up"><input className="form-input" type="date" value={f.nextFollowUp} onChange={e => set('nextFollowUp', e.target.value)} /></Field>
          <Field label="Comments" full><textarea className="form-input" rows={2} value={f.comments} onChange={e => set('comments', e.target.value)} /></Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-cta" disabled={!valid || saving} onClick={() => onSave(f)}>{saving ? 'Saving…' : isEdit ? 'Update Lead' : 'Save Lead'}</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {!valid && <span className="lv-req">* Company and Lead Source are required</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Log an action ─── */
function ActionForm({ lead, names, me, onSave, saving }) {
  const blank = () => ({ by: me, type: 'Call', status: lead.status || 'Contacted', comment: '', next: addDays(todayIso(), LEAD_FOLLOWUP_DEFAULT_DAYS) });
  const [a, setA] = useState(blank);
  const [open, setOpen] = useState(false);
  useEffect(() => { setA(blank()); setOpen(false); }, [lead.leadId]);
  const set = (k, v) => setA(x => ({ ...x, [k]: v }));
  const closing = LEAD_CLOSED.includes(a.status);
  if (!open) return <button type="button" className="btn btn-primary btn-sm" data-pf="lv-log-action" onClick={() => setOpen(true)}>+ Log action</button>;
  return (
    <div className="lv-action-form" data-pf="lv-log-action">
      <div className="lv-af-grid">
        <label>Actioned by<input className="form-input" list="lv-names" value={a.by} onChange={e => set('by', e.target.value)} /></label>
        <label>Action<Select value={a.type} options={LEAD_ACTION_TYPES} onChange={v => set('type', v)} /></label>
        <label>Status after<Select value={a.status} options={LEAD_STATUSES} onChange={v => set('status', v)} /></label>
        <label>Next follow-up<input className="form-input" type="date" value={closing ? '' : a.next} disabled={closing} onChange={e => set('next', e.target.value)} /></label>
        <label className="lv-af-full">Comment<textarea autoFocus className="form-input" rows={2} value={a.comment} onChange={e => set('comment', e.target.value)} placeholder="What happened, what was agreed" /></label>
      </div>
      <div className="lv-af-btns">
        <button className="btn btn-cta btn-sm" disabled={saving || !a.by.trim() || !a.comment.trim()}
          onClick={() => onSave({ id: newId(), at: new Date().toISOString(), ...a, next: closing ? '' : a.next })}>{saving ? 'Saving…' : 'Save action'}</button>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        {(!a.by.trim() || !a.comment.trim()) && <span className="lv-req">Who and a comment are required</span>}
      </div>
    </div>
  );
}

/* ─── Detail panel ─── */
function LeadPanel({ lead, canEdit, names, me, onEdit, onDelete, onLogAction, onRemoveAction, onAddToBd, saving }) {
  const actions = [...(lead.actions || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const people = [...new Set(actions.map(a => a.by).filter(Boolean))];
  const fi = followInfo(lead);
  const Info = ({ k, label, children }) => <div data-pf={k}><dt>{label}</dt><dd>{children || '—'}</dd></div>;
  return (
    <div className="card lv-panel">
      <div className="card-header lv-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lv-panel-title">{lead.company || '(no company)'} <PriorityDot value={lead.priority} /></div>
          <div className="lv-muted">{lead.leadId} · received {fmtD(lead.dateReceived)}{lead.contactName ? ` · ${lead.contactName}` : ''}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill value={lead.status} />
            {fi && <span className={`lv-due ${fi.cls}`}>{fi.text}</span>}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <EditButton onClick={onEdit} title="Edit lead" />
            {onDelete && <DeleteButton onClick={onDelete} title="Delete lead" iconOnly />}
          </div>
        )}
      </div>
      <div className="lv-panel-body">
        <div className="lv-sub">Origin</div>
        <dl className="lv-info">
          <Info k="source" label="Lead source">{lead.source}</Info>
          <Info k="sourceDetail" label="Source detail">{lead.sourceDetail}</Info>
          <Info k="sharedBy" label="Shared by">{lead.sharedBy}</Info>
          <Info k="dateReceived" label="Date received">{lead.dateReceived && fmtD(lead.dateReceived)}</Info>
        </dl>
        <div className="lv-sub">Contact &amp; need</div>
        <dl className="lv-info">
          <Info k="contactName" label="Contact person">{[lead.contactName, lead.designation].filter(Boolean).join(' · ')}</Info>
          <Info k="email" label="Email">{lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}</Info>
          <Info k="phone" label="Phone">{lead.phone}</Info>
          <Info k="estValue" label="Estimated value">{lead.estValue !== '' && inr(lead.estValue)}</Info>
          <div className="lv-info-full" data-pf="requirement"><dt>Requirement</dt><dd>{lead.requirement || '—'}</dd></div>
          <Info k="programInterest" label="Program interest">{lead.programInterest}</Info>
          <Info k="owner" label="Lead owner">{lead.owner}</Info>
          {(onAddToBd || lead.proposalId) && (
            <div className="lv-info-full">
              {lead.proposalId
                ? <span className="lv-muted">✓ In BD Tracker as <b>{lead.proposalId}</b></span>
                : <button type="button" className="btn btn-primary btn-sm" onClick={onAddToBd}
                    title="Open the BD Tracker's Add form with this lead's details. The Proposal ID is created automatically and saved back to this lead.">
                    ➕ Add to BD Tracker
                  </button>}
            </div>
          )}
          <Info k="createdBy" label="Added by">{lead.createdBy}</Info>
          {lead.comments && <div className="lv-info-full"><dt>Comments</dt><dd>{lead.comments}</dd></div>}
        </dl>

        <div className="lv-sub lv-sub-row">
          <span>Actions · {actions.length}{people.length ? ` by ${people.join(', ')}` : ''}</span>
          {canEdit && <ActionForm lead={lead} names={names} me={me} onSave={onLogAction} saving={saving} />}
        </div>
        {!actions.length ? <div className="lv-empty">No actions logged yet. Use “Log action” after every call, email or meeting.</div> : (
          <ol className="lv-timeline">
            {actions.map(a => (
              <li key={a.id}>
                <div className="lv-tl-head">
                  <b>{a.by || 'Someone'}</b> <span className="lv-tl-type">{a.type}</span>
                  {a.status && <StatusPill value={a.status} />}
                  <span className="lv-muted">{fmtAt(a.at)}</span>
                  {canEdit && <button type="button" className="lv-x" title="Remove this action" onClick={() => onRemoveAction(a)}>✕</button>}
                </div>
                {a.comment && <div className="lv-tl-comment">{a.comment}</div>}
                {a.next && <div className="lv-muted">Next follow-up: {fmtD(a.next)}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ─── Insights: where leads come from, who shares them ─── */
function Insights({ leads }) {
  const table = key => {
    const m = new Map();
    leads.forEach(l => {
      const k = (l[key] || '').trim() || '(not set)';
      const r = m.get(k) || { k, n: 0, open: 0, won: 0, lost: 0, value: 0 };
      r.n++; r.value += Number(l.estValue) || 0;
      if (l.status === 'Converted to BD') r.won++; else if (leadIsOpen(l)) r.open++; else r.lost++;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.n - a.n);
  };
  const T = ({ title, rows }) => (
    <div className="lv-ins-block">
      <div className="lv-sub">{title}</div>
      <table className="lv-table">
        <thead><tr><th></th><th>Leads</th><th>Open</th><th>Converted</th><th>Conv. %</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.k}><td>{r.k}</td><td>{r.n}</td><td>{r.open}</td><td>{r.won}</td><td>{r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) + '%' : '—'}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <div className="lv-insights">
      <T title="By source" rows={table('source')} />
      <T title="By who shared it" rows={table('sharedBy')} />
      <T title="By lead owner" rows={table('owner')} />
    </div>
  );
}

/* ─── Page ─── */
export default function LeadTracker({ onRefreshed }) {
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const { permissions } = usePermissionsContext();
  const { canEdit, canCreate, canDelete } = usePermissions();
  const navigate = useNavigate();
  // Open the BD Tracker's Add form pre-filled from a lead; the BD Tracker saves the new
  // Proposal ID back to the lead (status "Converted to BD") after the BD line is created.
  const addToBd = lead => navigate('/bd-tracker', { state: { fromLead: {
    leadId: lead.leadId, company: lead.company, contactName: lead.contactName, designation: lead.designation,
    email: lead.email, phone: lead.phone, programInterest: lead.programInterest, requirement: lead.requirement,
    estValue: lead.estValue, comments: lead.comments,
  } } });
  const editable = canEdit('leads');

  const [data, setData] = useState(() => peekList('leads') || []);
  const [loading, setLoading] = useState(() => !peekList('leads'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState('Open');
  const [sourceF, setSourceF] = useState('All');
  const [ownerF, setOwnerF] = useState('All');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);           // null | 'add' | lead
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = m => { setToast(m); setTimeout(() => setToast(''), String(m).startsWith('❌') ? 9000 : 3000); };
  const load = async () => {
    if (!peekList('leads')) setLoading(true);
    setRefreshing(true); setError(null);
    try { setData(await getLeads()); onRefreshed?.(new Date().toLocaleTimeString()); }
    catch (e) { if (peekList('leads')) showToast('⚠ Could not refresh from Excel — showing the last saved copy.'); else setError(e); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const names = useMemo(() => [...new Set([
    ...Object.values(permissions || {}).map(p => p?.name).filter(Boolean),
    ...data.flatMap(l => [l.owner, l.sharedBy, ...(l.actions || []).map(a => a.by)]).filter(Boolean),
  ])].sort(), [permissions, data]);
  const owners = useMemo(() => [...new Set(data.map(l => l.owner).filter(Boolean))].sort(), [data]);
  const sources = useMemo(() => [...new Set([...LEAD_SOURCES, ...data.map(l => l.source).filter(Boolean)])], [data]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return data.filter(l => {
      const mQ = !q || [l.leadId, l.company, l.contactName, l.requirement, l.programInterest, l.sharedBy, l.owner, l.sourceDetail].some(v => norm(v).includes(q));
      const mS = statusF === 'All' || (statusF === 'Open' ? leadIsOpen(l) : l.status === statusF);
      return mQ && mS && (sourceF === 'All' || l.source === sourceF) && (ownerF === 'All' || l.owner === ownerF);
    }).sort((a, b) => String(b.leadId).localeCompare(String(a.leadId), undefined, { numeric: true }));
  }, [data, search, statusF, sourceF, ownerF]);

  const sel = selected ? data.find(l => l.leadId === selected) : null;
  const t = todayIso();
  // KPIs follow search, source and owner. The status filter is left out of the cards because the
  // cards are a status breakdown (with the default "Open" filter, Converted would always read 0).
  const kpiBase = useMemo(() => {
    const q = norm(search);
    return data.filter(l => (!q || [l.leadId, l.company, l.contactName, l.requirement, l.programInterest, l.sharedBy, l.owner, l.sourceDetail].some(v => norm(v).includes(q)))
      && (sourceF === 'All' || l.source === sourceF) && (ownerF === 'All' || l.owner === ownerF));
  }, [data, search, sourceF, ownerF]);
  const open = kpiBase.filter(leadIsOpen);
  const overdue = open.filter(l => l.nextFollowUp && l.nextFollowUp < t).length;
  const converted = kpiBase.filter(l => l.status === 'Converted to BD').length;
  const decided = kpiBase.filter(l => !leadIsOpen(l)).length;

  /* writes */
  const save = async (lead, isNew) => {
    setSaving(true);
    try {
      if (isNew) {
        const row = { ...lead, leadId: nextLeadId(data), createdBy: lead.createdBy || me };
        await addLead(row);
        setData(d => [row, ...d]); setSelected(row.leadId); showToast(`✓ Lead ${row.leadId} added`);
      } else {
        await updateLead(lead);
        setData(d => d.map(l => (l.leadId === lead.leadId ? lead : l))); showToast('✓ Lead updated');
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const logAction = async a => {
    const next = { ...sel, actions: [...(sel.actions || []), a], status: a.status || sel.status, nextFollowUp: a.next || (LEAD_CLOSED.includes(a.status) ? '' : sel.nextFollowUp) };
    await save(next, false);
  };
  const removeAction = async a => {
    if (!window.confirm(`Remove ${a.by || 'this'}'s ${a.type} action?`)) return;
    await save({ ...sel, actions: (sel.actions || []).filter(x => x.id !== a.id) }, false);
  };
  const remove = async () => {
    if (!window.confirm(`Delete lead ${sel.leadId} · ${sel.company}? This cannot be undone.`)) return;
    setSaving(true);
    try { await deleteLead(sel.leadId); setData(d => d.filter(l => l.leadId !== sel.leadId)); setSelected(null); showToast('✓ Lead deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  /* Reminders popup */
  const pendingBar = useMemo(() => pendingItems(filtered, LEAD_RULES, l => ({ id: l.leadId, serial: l.leadId.replace(/^LD-0*/, ''), title: l.company || '(no company)', subtitle: [l.source, l.owner].filter(Boolean).join(' · ') })), [filtered]);
  const dueBar = useMemo(() => filtered.filter(l => leadIsOpen(l) && l.nextFollowUp).map(l => ({
    id: l.leadId, serial: l.leadId.replace(/^LD-0*/, ''), title: l.company || '(no company)', subtitle: [l.status, l.owner].filter(Boolean).join(' · '),
    tasks: [{ key: 'followup', label: 'Follow up', due: l.nextFollowUp }], row: l,
  })), [filtered]);
  const openPending = (it, f) => { setSelected(it.row.leadId); setModal(it.row); revealField(f.key, f.label); };
  const openDue = it => { setSelected(it.row.leadId); setView('list'); revealField('lv-log-action', ''); };

  if (loading) return <LoadingState message="Loading Lead Tracker from Excel…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="tracker-page">
      {toast && <div className="lv-toast">{toast}</div>}
      {modal && <LeadModal initial={modal === 'add' ? null : modal} names={names} me={me} saving={saving} onClose={() => setModal(null)} onSave={f => save(f, modal === 'add')} />}

      <div className="kpi-compact">
        <div className="kpi-card accent"><div className="kpi-label">Open leads</div><div className="kpi-value">{open.length}</div><div className="kpi-sub">of {kpiBase.length}{kpiBase.length !== data.length ? ` filtered · ${data.length} total` : ' total'}</div></div>
        <div className="kpi-card"><div className="kpi-label">Follow-ups overdue</div><div className="kpi-value" style={{ color: overdue ? 'var(--error)' : undefined }}>{overdue}</div><div className="kpi-sub">{open.filter(l => !l.nextFollowUp).length} with no follow-up date</div></div>
        <div className="kpi-card green"><div className="kpi-label">Converted to BD</div><div className="kpi-value">{converted}</div><div className="kpi-sub">{decided ? Math.round((converted / decided) * 100) : 0}% of closed leads</div></div>
        <div className="kpi-card purple"><div className="kpi-label">New this month</div><div className="kpi-value">{kpiBase.filter(l => String(l.dateReceived).slice(0, 7) === t.slice(0, 7)).length}</div><div className="kpi-sub">{open.filter(l => l.status === 'New').length} not contacted yet</div></div>
      </div>

      <div className="filter-bar lv-filters" style={{ flexShrink: 0 }}>
        <div className="lv-tabs">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>Leads</button>
          <button className={view === 'insights' ? 'on' : ''} onClick={() => setView('insights')}>Sources &amp; sharers</button>
        </div>
        <input className="form-input wide" placeholder="🔍 Company, contact, requirement, shared by…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
          {['Open', 'All', ...LEAD_STATUSES].map(s => <option key={s} value={s}>{s === 'Open' ? 'Open leads' : s === 'All' ? 'All statuses' : s}</option>)}
        </select>
        <select className="form-input" value={sourceF} onChange={e => setSourceF(e.target.value)}>
          <option value="All">All sources</option>{sources.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-input" value={ownerF} onChange={e => setOwnerF(e.target.value)}>
          <option value="All">All owners</option>{owners.map(s => <option key={s}>{s}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>{refreshing ? '⟳' : '↺'}</button>
        <ExportButton page="leads" filename="Lead Tracker" sheetName="Leads" rows={() => filtered}
          columns={[['Lead ID', 'leadId'], ['Date Received', 'dateReceived'], ['Lead Source', 'source'], ['Source Detail', 'sourceDetail'], ['Shared By', 'sharedBy'],
            ['Company', 'company'], ['Contact Person', 'contactName'], ['Designation', 'designation'], ['Email', 'email'], ['Phone', 'phone'], ['Requirement', 'requirement'],
            ['Program Interest', 'programInterest'], ['Lead Owner', 'owner'], ['Status', 'status'], ['Priority', 'priority'], ['Next Follow-up', 'nextFollowUp'],
            ['Estimated Value', 'estValue'], ['BD Proposal ID', 'proposalId']].map(([label, key]) => ({ label, key }))
            .concat([{ label: 'Actions', get: l => (l.actions || []).map(a => `${fmtAt(a.at)} · ${a.by} · ${a.type} · ${a.status}: ${a.comment}`).join('\n') }, { label: 'Comments', key: 'comments' }])} />
        {canCreate('leads') && <button className="btn btn-primary btn-sm" onClick={() => setModal('add')}>+ Add Lead</button>}
      </div>

      {view === 'insights' ? <div className="tracker-scroll"><Insights leads={filtered} /></div> : (
        <div className="grid-sidebar" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', marginBottom: 0 }}>
            <div className="card-header" style={{ flexShrink: 0 }}>
              <span className="card-title">Leads</span>
              <span className="lv-muted">{filtered.length} of {data.length}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!filtered.length ? <div className="lv-empty" style={{ margin: 16 }}>No leads match these filters{data.length ? '' : ' — add the first one with “+ Add Lead”'}.</div>
                : filtered.map(l => {
                  const fi = followInfo(l); const isSel = selected === l.leadId;
                  return (
                    <div key={l.leadId} className={`lv-row${isSel ? ' sel' : ''}`} onClick={() => setSelected(isSel ? null : l.leadId)}>
                      <div className="lv-row-top">
                        <span className="lv-id">{l.leadId}</span>
                        <span className="lv-row-name">{l.company || '(no company)'}</span>
                        <PriorityDot value={l.priority} />
                        <span style={{ marginLeft: 'auto' }}><StatusPill value={l.status} /></span>
                      </div>
                      <div className="lv-row-sub">{[l.source, l.sharedBy && `via ${l.sharedBy}`, l.owner && `owner ${l.owner}`].filter(Boolean).join(' · ') || '—'}</div>
                      <div className="lv-row-meta">
                        {fi && <span className={`lv-due ${fi.cls}`}>{fi.text}</span>}
                        <span>{(l.actions || []).length} action{(l.actions || []).length === 1 ? '' : 's'}</span>
                        {l.dateReceived && <span>received {fmtD(l.dateReceived)}</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div style={{ height: '100%', overflowY: 'auto' }}>
            {sel ? <LeadPanel lead={sel} canEdit={editable} names={names} me={me} saving={saving}
              onEdit={() => setModal(sel)} onDelete={canDelete('leads') ? remove : undefined}
              onLogAction={logAction} onRemoveAction={removeAction}
              onAddToBd={canCreate('bd') && !sel.proposalId ? () => addToBd(sel) : undefined} />
              : <div className="card lv-placeholder"><div className="lv-big">👈</div><b>Select a lead</b><div className="lv-muted">See where it came from, who shared it and every action taken</div></div>}
          </div>
        </div>
      )}

      <PendingFieldsBar items={pendingBar} dueItems={dueBar} onPick={openPending} onPickDue={openDue} canEdit={editable} noun="lead" />
    </div>
  );
}
