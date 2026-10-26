/**
 * CLIENT DIRECTORY
 * ================
 * One place for every client organisation: profile, relationship, contract,
 * commercials & billing, delivery preferences — plus its contacts, program / PO
 * history, follow-up actions and an interaction log.
 *
 * Layout: a card grid of clients → a full account profile page per client
 * (hero, key numbers, engagement history, actions, interaction log, stakeholder
 * map, commercials, contract, ways of working, data completeness).
 *
 * Excel: Client_Directory.xlsx → ClientTable, ContactTable, ProgramTable, ActionTable,
 * InteractionTable — all through ONE flow (CLIENTS_CRUD, switch on "table").
 * Keys: Client ID (CL-001), Contact ID (CT-0001), Program Record ID (AP-001),
 * Action ID (AC-0001), Interaction ID (INT-0001).
 *
 * Commercial & billing fields are shown only to admins and people with Finance view access.
 */
import { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  Building2, MapPin, Users, Briefcase, Phone, Mail, Linkedin, CalendarClock, FileText, Wallet, ShieldCheck, Star,
  ChevronLeft, ChevronRight, Plus, MessageSquare, Target, Globe, Factory, Pencil, Trash2, ArrowLeft, Handshake,
  Gauge, Layers, Lightbulb, Settings2, LayoutGrid, List, AlertTriangle, CheckCircle2, ExternalLink, UserCheck, FolderOpen,
} from 'lucide-react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import ExportButton from '../components/ExportButton.jsx';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import {
  TABLES, CLIENT_MONEY_KEYS, PROGRAM_MONEY_KEYS, emptyRecord, nextId, clientsConfigured,
  getClientDirectory, peekClientDirectory, addRecord, updateRecord, deleteRecord, daysFromToday, isOpenAction,
} from '../services/clientsApi.js';
import { pendingItems, missingFields, CLIENT_RULES } from '../config/pendingFields.js';
import * as O from '../config/clientOptions.js';
import '../styles/leadsVendors.css';
import '../styles/clients.css';

/* ─── Helpers ─── */
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const addDays = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); if (isNaN(d)) return ''; d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? iso : `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const s = v => String(v ?? '').trim();
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const inr = v => (v === '' || v == null || !Number(v) ? '' : `₹ ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
/** ₹ 10.86 L / ₹ 1.2 Cr — compact for tiles */
const inrShort = v => {
  const n = num(v); if (!n) return '₹ 0';
  if (n >= 1e7) return `₹ ${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 1e5) return `₹ ${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹ ${n.toLocaleString('en-IN')}`;
};
const idNum = id => Number(String(id || '').replace(/\D/g, '')) || 1e9;
const monogram = name => {
  const w = s(name).replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?')[0]).toUpperCase();
};
const initials = n => s(n).split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('') || '?';
const TYPE_CLS = { Existing: 'lv-st-won', Prospect: 'lv-st-prog', Dormant: 'lv-st-hold', Lost: 'lv-st-lost' };
const PROG_CLS = { Delivered: 'lv-st-won', Closed: 'lv-st-new', 'In delivery': 'lv-st-prog', 'PO / SOW received': 'lv-st-prog', 'On hold': 'lv-st-hold', Lost: 'lv-st-lost' };
const KIND_NOUN = { clients: 'client', contacts: 'contact', programs: 'program', actions: 'action', interactions: 'interaction' };
const CHILD_KINDS = ['contacts', 'programs', 'actions', 'interactions'];
const noKids = () => ({ contacts: [], programs: [], actions: [], interactions: [] });
const isFormer = p => ['Former contact', 'Left organisation'].includes(p.status);
const ROLE_GROUPS = [
  ['Leadership & sponsors', ['Leadership / Sponsor']],
  ['Business & L&D', ['Business POC', 'Commercial POC', 'L&D / HR']],
  ['Procurement & finance', ['Procurement', 'Finance / Invoice']],
  ['Delivery & admin', ['Delivery / Admin']],
];

function dueChip(iso) {
  const d = daysFromToday(iso);
  if (d === '') return null;
  const cls = d < 0 ? 'lv-due-bad' : d <= 7 ? 'lv-due-warn' : 'lv-due-none';
  const text = d < 0 ? `${-d}d overdue` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : d <= 7 ? `In ${d} days` : `Due ${fmtD(iso)}`;
  return <span className={`lv-due ${cls}`}>{text}</span>;
}
const Health = ({ value, label }) => (value
  ? <span className={`cl-health-tag cl-h-${value.toLowerCase()}`}><i />{label ? `${value} health` : value}</span>
  : null);

/* ─── Form schemas (one per table) ───
 * type: text | area | select | date | num | url | email | person   ·  money: hidden without Finance access */
const F = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });
const FORMS = {
  clients: [
    { section: 'Identity', fields: [
      F('name', 'Client Name *'), F('legalName', 'Legal / Billing Entity Name'), F('parentGroup', 'Parent Group'),
      F('businessUnit', 'Business Unit / Division'), F('clientType', 'Client Type *', 'select', { options: O.CLIENT_TYPES }),
      F('tier', 'Account Tier', 'select', { options: O.ACCOUNT_TIERS })] },
    { section: 'Organisation profile', fields: [
      F('industry', 'Industry', 'select', { options: O.INDUSTRIES }), F('subIndustry', 'Sub-Industry / Segment'),
      F('orgType', 'Organisation Type', 'select', { options: O.ORG_TYPES }), F('employeeSize', 'Employee Size', 'select', { options: O.EMPLOYEE_SIZES }),
      F('hqCity', 'HQ City'), F('geography', 'Geography', 'select', { options: O.GEOGRAPHIES }),
      F('locations', 'Delivery Locations'), F('countries', 'Countries Covered'), F('website', 'Website', 'url'), F('linkedin', 'LinkedIn Page', 'url'),
      F('context', 'Company Context', 'area', { full: true, ph: 'Footprint, growth, hiring plans, strategy' })] },
    { section: 'Relationship', fields: [
      F('owner', 'EuRadicle Account Owner', 'person'), F('secondaryOwner', 'Secondary Owner', 'person'),
      F('relStatus', 'Relationship Status', 'select', { options: O.REL_STATUS }), F('health', 'Relationship Health', 'select', { options: O.HEALTH }),
      F('clientSince', 'Client Since (Year)', 'num'), F('lastEngagement', 'Last Engagement Date', 'date'),
      F('howAcquired', 'How Acquired', 'select', { options: O.LEAD_SOURCES }), F('potential', 'Potential Revenue (₹)', 'num', { money: true }),
      F('needs', 'Key Business Needs', 'area', { full: true }), F('delivered', 'Programs Delivered', 'area', { full: true }),
      F('activePrograms', 'Active Programs', 'area', { full: true }), F('opportunities', 'Open Opportunities', 'area', { full: true })] },
    { section: 'Contract', fields: [
      F('contractBasis', 'Contract Basis', 'select', { options: O.CONTRACT_BASIS }), F('contractStatus', 'Contract / SOW Status', 'select', { options: O.CONTRACT_STATUS }),
      F('nda', 'NDA Signed', 'select', { options: O.YES_NO }), F('contractStart', 'Contract Start Date', 'date'), F('contractEnd', 'Contract End Date', 'date'),
      F('vendorReg', 'Vendor Registration', 'select', { options: O.VENDOR_REG }), F('contractLink', 'Contract / SOW Link', 'url', { full: true })] },
    { section: 'Commercial & billing', money: true, fields: [
      F('dayRate', 'Standard Day Rate (₹)', 'num'), F('tsPolicy', 'T&S Policy', 'select', { options: O.TS_POLICY }),
      F('payDays', 'Payment Terms (Days)', 'num'), F('payBasis', 'Payment Terms Basis', 'select', { options: O.PAY_BASIS }),
      F('poRequired', 'PO Required', 'select', { options: O.PO_REQUIRED }), F('portal', 'Invoice Portal', 'select', { options: O.PORTALS }),
      F('invoiceContact', 'Invoice Contact'), F('gstin', 'GSTIN'), F('payStatus', 'Payment Status', 'select', { options: O.PAY_STATUS }),
      F('outstanding', 'Outstanding Amount (₹)', 'num'), F('outstandingAsOf', 'Outstanding As Of', 'date'),
      F('commercialNotes', 'Commercial Notes', 'area', { full: true, ph: 'Per-batch fees, half-day rates, increases' }),
      F('tsNotes', 'T&S Notes', 'area', { full: true }), F('invoiceNotes', 'Invoice Process Notes', 'area', { full: true }),
      F('billingAddress', 'Billing Address', 'area', { full: true })] },
    { section: 'Delivery preferences', fields: [
      F('deliveryMode', 'Preferred Delivery Mode', 'select', { options: O.DELIVERY_MODES }), F('platform', 'Preferred Platform', 'select', { options: O.PLATFORMS }),
      F('feedbackThreshold', 'Feedback Threshold'), F('feedbackProcess', 'Feedback Process', 'area', { full: true }),
      F('facilitatorPrefs', 'Facilitator Preferences', 'area', { full: true }), F('branding', 'Branding & Compliance Notes', 'area', { full: true }),
      F('playbook', 'Operating Playbook', 'area', { full: true, rows: 4, ph: 'How to work with this client' })] },
    { section: 'Follow-up & admin', fields: [
      F('lastInteraction', 'Last Interaction Date', 'date'), F('nextFollowUp', 'Next Follow-up Date', 'date'), F('folderLink', 'Account Folder Link', 'url'),
      F('nextAction', 'Next Action', 'text', { full: true }), F('comments', 'Overall Comments', 'area', { full: true }),
      F('dataNotes', 'Data Source / Verification Notes', 'area', { full: true })] },
  ],
  contacts: [{ section: 'Contact', fields: [
    F('fullName', 'Full Name *'), F('designation', 'Designation'), F('role', 'Role in Account', 'select', { options: O.CONTACT_ROLES }),
    F('department', 'Department / Function'), F('reportsTo', 'Reports To'), F('decisionRole', 'Decision Role', 'select', { options: O.DECISION_ROLES }),
    F('email', 'Email', 'email'), F('mobile', 'Mobile'), F('altPhone', 'Alternate Phone'), F('location', 'Location'), F('linkedin', 'LinkedIn', 'url'),
    F('primary', 'Primary Contact', 'select', { options: O.YES_NO }), F('status', 'Contact Status', 'select', { options: O.CONTACT_STATUS }),
    F('strength', 'Relationship Strength', 'select', { options: O.REL_STRENGTH }), F('lastContacted', 'Last Contacted', 'date'),
    F('notes', 'Responsibilities / Working Notes', 'area', { full: true }),
    F('portalNote', 'Portal Access Note', 'text', { full: true, ph: 'Who holds the portal login — never the password' })] }],
  programs: [{ section: 'Program', fields: [
    F('program', 'Program Name *', 'text', { full: true }), F('type', 'Program Type', 'select', { options: O.PROGRAM_TYPES }),
    F('audience', 'Audience / Level'), F('fy', 'Financial Year', 'text', { ph: 'FY27' }), F('status', 'Status *', 'select', { options: O.PROGRAM_STATUS }),
    F('batchesContracted', 'Batches Contracted', 'num'), F('batchesDelivered', 'Batches Delivered', 'num'), F('participants', 'Participants Covered', 'num'),
    F('feedback', 'Avg Feedback', 'num'), F('facilitators', 'Facilitators / Coaches'), F('clientOwner', 'Client Owner'),
    F('erOwner', 'EuRadicle Owner', 'person'), F('proposalId', 'BD Proposal ID'), F('nextMilestone', 'Next Milestone', 'text', { full: true }),
    F('notes', 'Key Notes', 'area', { full: true })] },
  { section: 'Commercials', money: true, fields: [
    F('feeBasis', 'Fee Basis', 'select', { options: O.FEE_BASIS }), F('feeRate', 'Fee Rate (₹)', 'num'), F('poValue', 'PO Value (₹)', 'num'),
    F('poRef', 'PO / SOW Reference'), F('tsTerms', 'T&S Terms', 'text', { full: true })] }],
  actions: [{ section: 'Action', fields: [
    F('action', 'Action *', 'text', { full: true }), F('erOwner', 'EuRadicle Owner', 'person'), F('ownerContact', 'With (client contact / owner)'),
    F('due', 'Due Date', 'date'), F('timing', 'Timing Note', 'text', { ph: 'e.g. Before next invoice' }),
    F('status', 'Status', 'select', { options: O.ACTION_STATUS }), F('priority', 'Priority', 'select', { options: O.PRIORITIES }),
    F('context', 'Context', 'area', { full: true })] }],
  interactions: [{ section: 'Interaction', fields: [
    F('date', 'Date *', 'date'), F('type', 'Interaction Type', 'select', { options: O.INTERACTION_TYPES }), F('erAttendees', 'EuRadicle Attendees'),
    F('clientAttendees', 'Client Attendees'), F('summary', 'Summary *', 'area', { full: true }), F('outcome', 'Outcome / Decisions', 'area', { full: true }),
    F('nextStep', 'Next Step'), F('nextFollowUp', 'Next Follow-up Date', 'date')] }],
};
const REQUIRED = { clients: ['name', 'clientType'], contacts: ['fullName'], programs: ['program', 'status'], actions: ['action'], interactions: ['date', 'summary'] };
const labelOf = (kind, k) => (FORMS[kind].flatMap(x => x.fields).find(x => x.k === k)?.label || k).replace(' *', '');

function Select({ value, options, onChange }) {
  return (
    <select className="form-input" value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">— select —</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value !== '' && value != null && !options.includes(String(value)) && <option value={value}>{value} (old value)</option>}
    </select>
  );
}

/* ─── Generic add / edit modal ─── */
function RecordModal({ kind, initial, defaults, title, onSave, onClose, saving, showMoney, clientNames }) {
  const isEdit = !!initial;
  const [f, setF] = useState(() => ({ ...emptyRecord(kind), ...(isEdit ? initial : defaults) }));
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v };
    if (kind === 'actions' && k === 'status') n.closedOn = v === 'Done' ? (x.closedOn || todayIso()) : '';
    return n;
  });
  const sections = FORMS[kind].filter(sec => showMoney || !sec.money);
  const missing = REQUIRED[kind].filter(k => !s(f[k]));
  const dupName = kind === 'clients' && s(f.name) && clientNames.some(([id, n]) => norm(n) === norm(f.name) && id !== f.clientId);
  const input = fd => {
    const v = f[fd.k] ?? '';
    switch (fd.type) {
      case 'select': return <Select value={v} options={fd.options} onChange={x => set(fd.k, x)} />;
      case 'date':   return <input className="form-input" type="date" value={v || ''} onChange={e => set(fd.k, e.target.value)} />;
      case 'num':    return <input className="form-input" inputMode="decimal" value={v} onChange={e => set(fd.k, e.target.value.replace(/[^0-9.]/g, ''))} />;
      case 'area':   return <textarea className="form-input" rows={fd.rows || 2} value={v} placeholder={fd.ph || ''} onChange={e => set(fd.k, e.target.value)} />;
      case 'person': return <input className="form-input" list="cl-names" value={v} onChange={e => set(fd.k, e.target.value)} />;
      default:       return <input className="form-input" type={fd.type === 'email' ? 'email' : 'text'} value={v}
        placeholder={fd.ph || (fd.type === 'url' ? 'https://…' : '')} onChange={e => set(fd.k, e.target.value)} />;
    }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: kind === 'clients' ? 880 : 720 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {sections.map(sec => (
          <div key={sec.section}>
            <div className="lv-form-section">{sec.section}</div>
            <div className="form-grid lv-grid-4">
              {sec.fields.filter(fd => showMoney || !fd.money).map(fd => (
                <div key={fd.k} className={`form-field${fd.full ? ' full' : ''}`} data-pf={fd.k}>
                  <label className="form-label">{fd.label}</label>{input(fd)}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-cta" disabled={!!missing.length || saving || dupName} onClick={() => onSave(f)}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save'}</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {!!missing.length && <span className="lv-req">* Required: {missing.map(k => labelOf(kind, k)).join(', ')}</span>}
          {dupName && <span className="lv-req">A client with this name already exists</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Small building blocks ─── */
const IconBtn = ({ icon: I, title, onClick, danger, disabled }) => (
  <button type="button" className={`cl-icon-btn${danger ? ' danger' : ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}><I size={15} /></button>
);
function Panel({ icon: I, title, count, action, children, className = '', id }) {
  return (
    <section className={`cl-panel ${className}`} id={id}>
      <header className="cl-panel-head">
        <span className="cl-panel-title"><I size={16} />{title}{count != null && <span className="cl-count">{count}</span>}</span>
        {action}
      </header>
      <div className="cl-panel-body">{children}</div>
    </section>
  );
}
const Fact = ({ label, children, wide }) => (
  <div className={`cl-fact${wide ? ' wide' : ''}`}><span>{label}</span><b>{children === '' || children == null || children === false ? '—' : children}</b></div>
);
const Progress = ({ value, max, tone = 'mauve' }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="cl-bar"><i className={`t-${tone}`} style={{ width: `${pct}%` }} /></div>;
};
const Note = ({ icon: I, title, text }) => (s(text) ? <div className="cl-note"><I size={15} /><div><b>{title}</b><p>{text}</p></div></div> : null);
const Ext = ({ url, label }) => (s(url) ? <a className="cl-ext" href={/^https?:/i.test(url) ? url : `https://${url}`} target="_blank" rel="noreferrer">{label}<ExternalLink size={12} /></a> : null);

/* ─── Directory card ─── */
function ClientCard({ c, kids, showMoney, onOpen }) {
  const open = kids.actions.filter(isOpenAction);
  const over = open.filter(a => a.due && daysFromToday(a.due) < 0).length;
  const active = kids.programs.filter(p => ['In delivery', 'PO / SOW received', 'In negotiation'].includes(p.status)).length;
  return (
    <button type="button" className={`cl-card${c.tier === 'Strategic' ? ' strategic' : ''}`} onClick={onOpen}>
      <div className="cl-card-head">
        <span className="cl-mono">{monogram(c.name)}</span>
        <div className="cl-card-title">
          <b>{c.name}</b>
          <span>{[c.industry, c.hqCity].filter(Boolean).join(' · ') || <i>Industry not set</i>}</span>
        </div>
        <span className="cl-card-id">{c.clientId}</span>
      </div>
      <div className="cl-card-tags">
        {c.clientType ? <span className={`lv-pill ${TYPE_CLS[c.clientType] || 'lv-st-new'}`}>{c.clientType}</span> : <span className="lv-pill lv-st-new">Type not set</span>}
        {c.tier && <span className="cl-tier"><Star size={11} />{c.tier}</span>}
        <Health value={c.health} />
        {c.relStatus && c.relStatus !== 'To confirm' && <span className="cl-tag-soft">{c.relStatus}</span>}
      </div>
      <div className="cl-card-stats">
        <span title="Contacts"><Users size={13} />{kids.contacts.filter(p => !isFormer(p)).length}<em>contacts</em></span>
        <span title="Programs"><Layers size={13} />{kids.programs.length}<em>{active ? `programs · ${active} live` : 'programs'}</em></span>
        <span title="Open actions" className={over ? 'bad' : ''}><Target size={13} />{open.length}<em>{over ? `open · ${over} late` : 'open'}</em></span>
      </div>
      <div className="cl-card-foot">
        <span className="cl-owner">{c.owner ? <><span className="cl-av sm">{initials(c.owner)}</span>{c.owner}</> : <i>No owner</i>}</span>
        {showMoney && num(c.outstanding) > 0 ? <span className="lv-due lv-due-warn">{inrShort(c.outstanding)} due</span>
          : c.nextFollowUp ? dueChip(c.nextFollowUp) : null}
      </div>
    </button>
  );
}

/* ─── Account profile ─── */
function ClientProfile({ c, kids, rules, showMoney, perm, saving, nav, onBack, onEdit, onDelete, onAdd, onEditKid, onDeleteKid, onToggleAction, onFix }) {
  const contacts = [...kids.contacts].sort((a, b) => (b.primary === 'Yes') - (a.primary === 'Yes'));
  const current = contacts.filter(p => !isFormer(p)), former = contacts.filter(isFormer);
  const programs = [...kids.programs].sort((a, b) => String(b.fy).localeCompare(String(a.fy)));
  const openActs = kids.actions.filter(a => isOpenAction(a) || a.status === 'Recurring')
    .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const doneActs = kids.actions.filter(a => a.status === 'Done').sort((a, b) => String(b.closedOn).localeCompare(String(a.closedOn)));
  const overdue = openActs.filter(a => isOpenAction(a) && a.due && daysFromToday(a.due) < 0).length;
  const logs = [...kids.interactions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const primary = current.find(p => p.primary === 'Yes');
  const lastTouch = [c.lastInteraction, logs[0]?.date].filter(Boolean).sort().pop() || '';

  const bc = programs.reduce((t, p) => t + num(p.batchesContracted), 0);
  const bd = programs.reduce((t, p) => t + num(p.batchesDelivered), 0);
  const pax = programs.reduce((t, p) => t + num(p.participants), 0);
  const poTotal = programs.reduce((t, p) => t + num(p.poValue), 0);
  const live = programs.filter(p => ['In delivery', 'PO / SOW received', 'In negotiation'].includes(p.status)).length;

  // data completeness (same rules as the Reminders popup)
  const applicable = rules.fields.filter(f => !f.when || f.when(c));
  const missing = missingFields(c, rules);
  const pct = applicable.length ? Math.round(((applicable.length - missing.length) / applicable.length) * 100) : 100;
  const gaps = [...missing, ...(current.length ? [] : [{ key: '_contacts', label: 'Contacts' }])];

  // contract time-line
  const cs = c.contractStart && Date.parse(c.contractStart), ce = c.contractEnd && Date.parse(c.contractEnd);
  const elapsed = cs && ce && ce > cs ? Math.min(100, Math.max(0, Math.round(((Date.now() - cs) / (ce - cs)) * 100))) : null;
  const daysLeft = c.contractEnd ? daysFromToday(c.contractEnd) : '';

  const facts = [
    [Factory, c.industry && `${c.industry}${c.subIndustry ? ` · ${c.subIndustry}` : ''}`],
    [MapPin, c.locations && (!c.hqCity || norm(c.locations).includes(norm(c.hqCity))) ? c.locations : [c.hqCity, c.locations].filter(Boolean).join(' — ')],
    [Building2, [c.orgType, c.employeeSize && `${c.employeeSize} employees`].filter(Boolean).join(' · ')],
    [Globe, [c.geography, c.countries].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v);

  const stats = [
    { label: 'Programs', value: programs.length, sub: live ? `${live} live now` : 'none live' },
    { label: 'Batches delivered', value: bc ? `${bd}/${bc}` : bd || '—', sub: bc ? <Progress value={bd} max={bc} /> : 'not recorded' },
    { label: 'Participants', value: pax ? pax.toLocaleString('en-IN') : '—', sub: 'covered so far' },
    { label: 'Open actions', value: openActs.length, sub: overdue ? <span className="bad">{overdue} overdue</span> : 'none overdue', tone: overdue ? 'bad' : '' },
    showMoney
      ? { label: 'Outstanding', value: num(c.outstanding) ? inrShort(c.outstanding) : '₹ 0', sub: c.payStatus || (c.outstandingAsOf ? `as of ${fmtD(c.outstandingAsOf)}` : 'no dues recorded'), tone: num(c.outstanding) ? 'warn' : '' }
      : { label: 'Contacts', value: current.length, sub: primary ? `primary: ${primary.fullName}` : 'no primary set' },
    { label: 'Last interaction', value: lastTouch ? fmtD(lastTouch) : '—', sub: lastTouch ? (daysFromToday(lastTouch) === 0 ? 'today' : `${-daysFromToday(lastTouch)} days ago`) : 'log calls & meetings' },
  ];

  const kidBtns = (kind, rec) => (
    <span className="cl-row-btns">
      {perm.update && <IconBtn icon={Pencil} title="Edit" onClick={() => onEditKid(kind, rec)} />}
      {perm.delete && <IconBtn icon={Trash2} title="Delete" danger onClick={() => onDeleteKid(kind, rec)} />}
    </span>
  );
  const addBtn = (kind, label) => perm.create && (
    <button className="btn btn-outline btn-sm cl-add" onClick={() => onAdd(kind)} disabled={saving}><Plus size={13} />{label}</button>
  );

  const PersonCard = ({ p }) => (
    <div className={`cl-person${isFormer(p) ? ' faded' : ''}`} data-pf={`ct-${p.contactId}`}>
      <span className={`cl-av${p.primary === 'Yes' ? ' primary' : ''}`}>{initials(p.fullName)}</span>
      <div className="cl-person-main">
        <div className="cl-person-name">
          <b>{p.fullName}</b>{p.primary === 'Yes' && <span className="cl-primary">Primary</span>}
          {p.status && p.status !== 'Active' && <span className="lv-pill lv-st-hold">{p.status}</span>}
        </div>
        <div className="cl-person-sub">{[p.designation, p.decisionRole].filter(Boolean).join(' · ') || p.role}</div>
        {p.notes && <div className="cl-person-note">{p.notes}</div>}
        <div className="cl-person-links">
          {p.mobile && <a href={`tel:${p.mobile.replace(/\s/g, '')}`}><Phone size={12} />{p.mobile}</a>}
          {p.email && <a href={`mailto:${p.email}`}><Mail size={12} />{p.email}</a>}
          {p.linkedin && <Ext url={p.linkedin} label="LinkedIn" />}
          {p.reportsTo && <span>→ reports to {p.reportsTo}</span>}
        </div>
      </div>
      {kidBtns('contacts', p)}
    </div>
  );

  return (
    <div className="cl-profile">
      {/* nav */}
      <div className="cl-nav">
        <button className="btn btn-outline btn-sm cl-add" onClick={onBack}><ArrowLeft size={14} />All clients</button>
        <span className="lv-muted">{nav.pos}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm cl-add" disabled={!nav.prev} onClick={nav.goPrev}><ChevronLeft size={14} />{nav.prev?.name || 'Previous'}</button>
        <button className="btn btn-outline btn-sm cl-add" disabled={!nav.next} onClick={nav.goNext}>{nav.next?.name || 'Next'}<ChevronRight size={14} /></button>
      </div>

      {/* hero */}
      <header className="cl-hero">
        <div className="cl-hero-top">
          <span className="cl-mono xl">{monogram(c.name)}</span>
          <div className="cl-hero-main">
            <div className="cl-hero-id">{c.clientId}{c.parentGroup && c.parentGroup !== c.name ? ` · ${c.parentGroup}` : ''}{c.businessUnit ? ` · ${c.businessUnit}` : ''}</div>
            <h1>{c.name}</h1>
            {c.legalName && <div className="cl-hero-legal">{c.legalName}</div>}
            <div className="cl-hero-tags">
              {c.clientType && <span className={`lv-pill ${TYPE_CLS[c.clientType] || 'lv-st-new'}`}>{c.clientType}</span>}
              {c.tier && <span className="cl-tier dark"><Star size={11} />{c.tier} account</span>}
              {c.relStatus && <span className="cl-tag-ghost">{c.relStatus}</span>}
              <Health value={c.health} label />
              {c.clientSince && <span className="cl-tag-ghost">Client since {c.clientSince}</span>}
            </div>
          </div>
          <div className="cl-hero-side">
            <div className="cl-owner-card">
              <span className="cl-av lg">{c.owner ? initials(c.owner) : '?'}</span>
              <div><span>Account owner</span><b>{c.owner || 'Not assigned'}</b>{c.secondaryOwner && <em>+ {c.secondaryOwner}</em>}</div>
            </div>
            <div className="cl-hero-actions">
              {perm.update && <button className="btn btn-sm cl-hero-btn" onClick={onEdit}><Pencil size={13} />Edit</button>}
              {perm.create && <button className="btn btn-sm cl-hero-btn" onClick={() => onAdd('interactions')}><MessageSquare size={13} />Log interaction</button>}
              {perm.delete && <IconBtn icon={Trash2} title="Delete client" danger onClick={onDelete} />}
            </div>
          </div>
        </div>
        {!!facts.length && <div className="cl-hero-facts">{facts.map(([I, v], i) => <span key={i}><I size={14} />{v}</span>)}
          <span className="cl-hero-links"><Ext url={c.website} label="Website" /><Ext url={c.linkedin} label="LinkedIn" /><Ext url={c.folderLink} label="Account folder" /></span>
        </div>}
      </header>

      {/* key numbers */}
      <div className="cl-stats">
        {stats.map(st => (
          <div key={st.label} className={`cl-stat${st.tone ? ` ${st.tone}` : ''}`}>
            <span>{st.label}</span><b>{st.value}</b><div className="cl-stat-sub">{st.sub}</div>
          </div>
        ))}
      </div>

      {pct < 60 && (
        <div className="cl-setup">
          <Gauge size={18} />
          <div><b>This profile is {pct}% complete.</b> Fill the key details so everyone sees the same picture of this account:</div>
          <div className="cl-gaps">{gaps.map(g => (
            <button key={g.key} type="button" className="cl-gap" disabled={!perm.update}
              onClick={() => (g.key === '_contacts' ? onAdd('contacts') : onFix(g))}>+ {g.label.replace(' *', '')}</button>
          ))}</div>
        </div>
      )}

      <div className="cl-cols">
        {/* ── main column ── */}
        <div className="cl-col">
          {(c.nextFollowUp || c.nextAction) && (
            <div className={`cl-next${daysFromToday(c.nextFollowUp) < 0 ? ' late' : ''}`}>
              <CalendarClock size={20} />
              <div><span>Next step</span><b>{c.nextAction || 'Follow up'}</b></div>
              <div className="cl-next-when">{c.nextFollowUp ? <>{fmtD(c.nextFollowUp)} {dueChip(c.nextFollowUp)}</> : <i>no date</i>}</div>
            </div>
          )}

          <Panel icon={Layers} title="Engagement history" count={programs.length} action={addBtn('programs', 'Program')}>
            {!programs.length ? <div className="lv-empty">No programs recorded yet.</div> : (
              <div className="cl-programs">
                {programs.map(p => {
                  const pc = num(p.batchesContracted), pd = num(p.batchesDelivered);
                  return (
                    <div key={p.programId} className="cl-program">
                      <div className="cl-program-fy">{p.fy || '—'}</div>
                      <div className="cl-program-main">
                        <div className="cl-program-top">
                          <b>{p.program}</b>
                          {p.status && <span className={`lv-pill ${PROG_CLS[p.status] || 'lv-st-new'}`}>{p.status}</span>}
                          {kidBtns('programs', p)}
                        </div>
                        <div className="cl-program-sub">{[p.type, p.audience, p.facilitators && `Facilitators: ${p.facilitators}`].filter(Boolean).join(' · ')}</div>
                        {(pc > 0 || pd > 0) && (
                          <div className="cl-program-progress">
                            <Progress value={pd} max={pc || pd} tone={pc && pd >= pc ? 'green' : 'mauve'} />
                            <span>{pd} of {pc || '?'} batches</span>
                          </div>
                        )}
                        <div className="cl-program-meta">
                          {p.participants !== '' && <span><Users size={12} />{num(p.participants).toLocaleString('en-IN')} participants</span>}
                          {p.feedback !== '' && <span><Star size={12} />{p.feedback} feedback</span>}
                          {showMoney && p.feeRate !== '' && <span><Wallet size={12} />{inr(p.feeRate)} {p.feeBasis ? p.feeBasis.toLowerCase() : ''}</span>}
                          {showMoney && p.poValue !== '' && <span className="strong">PO {inrShort(p.poValue)}</span>}
                          {p.proposalId && <span>BD {p.proposalId}</span>}
                        </div>
                        {p.nextMilestone && <div className="cl-program-next"><ChevronRight size={13} />{p.nextMilestone}</div>}
                        {p.notes && <div className="cl-program-notes">{p.notes}</div>}
                      </div>
                    </div>
                  );
                })}
                {showMoney && poTotal > 0 && <div className="cl-programs-total">Total PO value recorded <b>{inr(poTotal)}</b></div>}
              </div>
            )}
          </Panel>

          <Panel icon={Target} title="Open actions" count={openActs.length} action={addBtn('actions', 'Action')} id="cl-actions">
            {!openActs.length ? <div className="lv-empty">Nothing open.</div> : (
              <div className="cl-actions">
                {openActs.map(a => (
                  <div key={a.actionId} className={`cl-action p-${s(a.priority).toLowerCase() || 'none'}`} data-pf={`act-${a.actionId}`}>
                    {perm.update && isOpenAction(a)
                      ? <input type="checkbox" title="Mark done" disabled={saving} onChange={() => onToggleAction(a)} />
                      : <span className="cl-recur" title="Recurring">↻</span>}
                    <div className="cl-action-main">
                      <b>{a.action}</b>
                      <div className="cl-action-meta">
                        {a.due ? dueChip(a.due) : a.timing && <span className="lv-due lv-due-none">{a.timing}</span>}
                        {a.status === 'In progress' && <span>In progress</span>}
                        {a.ownerContact && <span>with {a.ownerContact}</span>}
                        {a.erOwner && <span>owner {a.erOwner}</span>}
                      </div>
                      {a.context && <div className="cl-action-ctx">{a.context}</div>}
                    </div>
                    {kidBtns('actions', a)}
                  </div>
                ))}
              </div>
            )}
            {!!doneActs.length && (
              <details className="cl-done-list">
                <summary>{doneActs.length} completed</summary>
                {doneActs.map(a => (
                  <div key={a.actionId} className="cl-done-row">
                    {perm.update && <input type="checkbox" checked title="Re-open" disabled={saving} onChange={() => onToggleAction(a)} />}
                    <span>{a.action}</span><em>{a.closedOn && fmtD(a.closedOn)}</em>{kidBtns('actions', a)}
                  </div>
                ))}
              </details>
            )}
          </Panel>

          <Panel icon={MessageSquare} title="Interaction log" count={logs.length} action={addBtn('interactions', 'Log')}>
            {!logs.length ? <div className="lv-empty">No interactions logged yet — log calls, meetings and key emails to build the account history.</div> : (
              <ul className="lv-timeline cl-timeline">{logs.map(it => (
                <li key={it.interactionId}>
                  <div className="lv-tl-head"><b>{fmtD(it.date)}</b>{it.type && <span className="lv-tl-type">{it.type}</span>}
                    <span className="lv-muted">{[it.erAttendees, it.clientAttendees && `with ${it.clientAttendees}`].filter(Boolean).join(' ')}</span>
                    {kidBtns('interactions', it)}</div>
                  <div className="lv-tl-comment">{it.summary}</div>
                  {it.outcome && <div className="lv-tl-comment"><b>Outcome:</b> {it.outcome}</div>}
                  {(it.nextStep || it.nextFollowUp) && <div className="lv-muted">Next: {[it.nextStep, it.nextFollowUp && `by ${fmtD(it.nextFollowUp)}`].filter(Boolean).join(' ')}</div>}
                </li>))}</ul>
            )}
          </Panel>

          {(c.needs || c.context || c.opportunities || c.delivered || c.activePrograms || c.comments) && (
            <Panel icon={Lightbulb} title="Account context">
              <div className="cl-notes">
                <Note icon={Target} title="Key business needs" text={c.needs} />
                <Note icon={Handshake} title="Open opportunities" text={c.opportunities} />
                <Note icon={Layers} title="Active programs" text={c.activePrograms} />
                <Note icon={CheckCircle2} title="Programs delivered" text={c.delivered} />
                <Note icon={Building2} title="Company context" text={c.context} />
                <Note icon={FileText} title="Overall comments" text={c.comments} />
              </div>
            </Panel>
          )}
        </div>

        {/* ── side column ── */}
        <div className="cl-col side">
          <Panel icon={Users} title="Stakeholder map" count={current.length} action={addBtn('contacts', 'Contact')}>
            {!contacts.length ? <div className="lv-empty">No contacts yet.</div> : (
              <div className="cl-people">
                {ROLE_GROUPS.map(([g, roles]) => {
                  const list = current.filter(p => roles.includes(p.role));
                  return list.length ? <div key={g} className="cl-people-group"><div className="cl-group-label">{g}</div>{list.map(p => <PersonCard key={p.contactId} p={p} />)}</div> : null;
                })}
                {(() => {
                  const known = ROLE_GROUPS.flatMap(([, r]) => r);
                  const rest = current.filter(p => !known.includes(p.role));
                  return rest.length ? <div className="cl-people-group"><div className="cl-group-label">Other contacts</div>{rest.map(p => <PersonCard key={p.contactId} p={p} />)}</div> : null;
                })()}
                {!!former.length && (
                  <details className="cl-done-list"><summary>{former.length} former contact{former.length === 1 ? '' : 's'}</summary>
                    {former.map(p => <PersonCard key={p.contactId} p={p} />)}</details>
                )}
              </div>
            )}
          </Panel>

          {showMoney && (
            <Panel icon={Wallet} title="Commercials & billing">
              <div className={`cl-money${num(c.outstanding) ? ' due' : ''}`}>
                <span>Outstanding</span><b>{inr(c.outstanding) || '₹ 0'}</b>
                <em>{[c.payStatus, c.outstandingAsOf && `as of ${fmtD(c.outstandingAsOf)}`].filter(Boolean).join(' · ') || 'no dues recorded'}</em>
              </div>
              <div className="cl-facts">
                <Fact label="Day rate">{inr(c.dayRate)}</Fact>
                <Fact label="Payment terms">{c.payDays !== '' ? `${c.payDays} days${c.payBasis ? ` ${c.payBasis.toLowerCase()}` : ''}` : ''}</Fact>
                <Fact label="T&S policy">{c.tsPolicy}</Fact>
                <Fact label="PO required">{c.poRequired}</Fact>
                <Fact label="Invoice portal">{c.portal}</Fact>
                <Fact label="Invoice to">{c.invoiceContact}</Fact>
                {c.potential !== '' && <Fact label="Potential revenue">{inr(c.potential)}</Fact>}
                {c.gstin && <Fact label="GSTIN">{c.gstin}</Fact>}
              </div>
              <Note icon={FileText} title="Commercial notes" text={c.commercialNotes} />
              <Note icon={Briefcase} title="Travel & stay" text={c.tsNotes} />
              <Note icon={FileText} title="Invoice process" text={c.invoiceNotes} />
              <Note icon={MapPin} title="Billing address" text={c.billingAddress} />
            </Panel>
          )}

          <Panel icon={ShieldCheck} title="Contract">
            <div className="cl-facts">
              <Fact label="Basis">{c.contractBasis}</Fact>
              <Fact label="Status">{c.contractStatus}</Fact>
              <Fact label="NDA">{c.nda}</Fact>
              <Fact label="Vendor registration">{c.vendorReg}</Fact>
            </div>
            {(c.contractStart || c.contractEnd) && (
              <div className="cl-contract-line">
                <div className="cl-contract-dates"><span>{fmtD(c.contractStart) || '?'}</span><span>{fmtD(c.contractEnd) || '?'}</span></div>
                {elapsed != null && <Progress value={elapsed} max={100} tone={daysLeft !== '' && daysLeft <= O.CONTRACT_WARN_DAYS ? 'warn' : 'navy'} />}
                {daysLeft !== '' && <div className={`cl-contract-left${daysLeft < 0 ? ' bad' : daysLeft <= O.CONTRACT_WARN_DAYS ? ' warn' : ''}`}>
                  {daysLeft < 0 ? `Ended ${-daysLeft} days ago` : `${daysLeft} days left`}</div>}
              </div>
            )}
            {c.contractLink && <div style={{ marginTop: 8 }}><Ext url={c.contractLink} label="Open contract / SOW" /></div>}
          </Panel>

          <Panel icon={Settings2} title="How to work with them">
            <div className="cl-facts">
              <Fact label="Delivery mode">{c.deliveryMode}</Fact>
              <Fact label="Platform">{c.platform}</Fact>
              {c.feedbackThreshold && <Fact label="Feedback bar">{c.feedbackThreshold}</Fact>}
            </div>
            <Note icon={Settings2} title="Operating playbook" text={c.playbook} />
            <Note icon={UserCheck} title="Facilitator preferences" text={c.facilitatorPrefs} />
            <Note icon={Star} title="Feedback process" text={c.feedbackProcess} />
            <Note icon={AlertTriangle} title="Branding & compliance" text={c.branding} />
            {!c.playbook && !c.facilitatorPrefs && !c.feedbackProcess && !c.branding && !c.deliveryMode && !c.platform &&
              <div className="lv-empty">No delivery preferences captured yet.</div>}
          </Panel>

          <Panel icon={Gauge} title="Data completeness">
            <div className="cl-complete">
              <div className="cl-ring" style={{ '--p': pct }}><b>{pct}%</b></div>
              <div>
                <b>{gaps.length ? `${gaps.length} key detail${gaps.length === 1 ? '' : 's'} missing` : 'All key details captured'}</b>
                <div className="cl-gaps">{gaps.map(g => (
                  <button key={g.key} type="button" className="cl-gap" disabled={!perm.update}
                    onClick={() => (g.key === '_contacts' ? onAdd('contacts') : onFix(g))}>{g.label.replace(' *', '')}</button>
                ))}</div>
              </div>
            </div>
            {c.dataNotes && <Note icon={FolderOpen} title="Source / verification notes" text={c.dataNotes} />}
            {(c.updatedOn || c.createdOn) && <div className="cl-audit">Updated {fmtD(c.updatedOn) || '—'}{c.updatedBy ? ` by ${c.updatedBy}` : ''} · created {fmtD(c.createdOn) || '—'}</div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
const VIEWS = [['clients', 'Clients'], ['contacts', 'Contacts'], ['actions', 'Actions'], ['programs', 'Programs']];
const EMPTY_DATA = { clients: [], contacts: [], programs: [], actions: [], interactions: [] };
const SORTS = [['id', 'Client ID'], ['name', 'Name A–Z'], ['dues', 'Highest dues'], ['actions', 'Most open actions'], ['followup', 'Next follow-up']];

export default function ClientDirectory({ onRefreshed }) {
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const { permissions } = usePermissionsContext();
  const { isAdmin, canAccess, canEdit, canCreate, canDelete } = usePermissions();
  const perm = { create: canCreate('clients'), update: canEdit('clients'), delete: canDelete('clients') };
  const showMoney = isAdmin || canAccess('finance');

  const [data, setData] = useState(() => peekClientDirectory() || EMPTY_DATA);
  const [loading, setLoading] = useState(() => !peekClientDirectory() && clientsConfigured());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('clients');
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('ercrm.clients.layout') || 'grid'; } catch { return 'grid'; } });
  const [sortBy, setSortBy] = useState('id');
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState('all');
  const [industryF, setIndustryF] = useState('All');
  const [statusF, setStatusF] = useState('All');
  const [ownerF, setOwnerF] = useState('All');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);          // { kind, rec?, defaults? }
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = m => { setToast(m); setTimeout(() => setToast(''), /^[❌⚠]/.test(String(m)) ? 9000 : 3000); };
  const load = async () => {
    if (!clientsConfigured()) { setLoading(false); return; }
    if (!peekClientDirectory()) setLoading(true);
    setRefreshing(true); setError(null);
    try {
      const d = await getClientDirectory();
      setData(d); onRefreshed?.(new Date().toLocaleTimeString());
      if (d.warnings?.length) showToast('⚠ Some tables could not load: ' + d.warnings.join(' | '));
    } catch (e) { if (peekClientDirectory()) showToast('⚠ Could not refresh from Excel — showing the last saved copy.'); else setError(e); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { try { localStorage.setItem('ercrm.clients.layout', layout); } catch { /* ignore */ } }, [layout]);
  useEffect(() => { try { document.querySelector('.cl-scroll')?.scrollTo(0, 0); } catch { /* ignore */ } }, [selected, view]);

  const names = useMemo(() => [...new Set([...Object.values(permissions || {}).map(p => p?.name), ...data.clients.map(c => c.owner)].filter(Boolean))].sort(), [permissions, data.clients]);
  const owners = useMemo(() => [...new Set(data.clients.map(c => c.owner).filter(Boolean))].sort(), [data.clients]);
  const industries = useMemo(() => [...new Set(data.clients.map(c => c.industry).filter(Boolean))].sort(), [data.clients]);
  const clientNames = useMemo(() => data.clients.map(c => [c.clientId, c.name]), [data.clients]);

  /** Children of a client: matched by Client ID, falling back to Client Name for rows typed in Excel. */
  const kidsOf = useMemo(() => {
    const idx = {};
    const byName = Object.fromEntries(data.clients.map(c => [norm(c.name), c.clientId]));
    for (const k of CHILD_KINDS) {
      for (const r of data[k]) {
        const id = r.clientId || byName[norm(r.clientName)];
        if (!id) continue;
        (idx[id] ||= noKids())[k].push(r);
      }
    }
    return id => idx[id] || noKids();
  }, [data]);

  const quickTests = {
    all: () => true,
    existing: c => c.clientType === 'Existing', prospect: c => c.clientType === 'Prospect', dormant: c => ['Dormant', 'Lost'].includes(c.clientType),
    untyped: c => !c.clientType || c.clientType === 'To confirm', dues: c => num(c.outstanding) > 0, noowner: c => !c.owner,
  };
  const QUICK = [['all', 'All'], ['existing', 'Existing'], ['prospect', 'Prospects'], ['dormant', 'Dormant / Lost'], ['untyped', 'Type not set'],
    ...(showMoney ? [['dues', 'With dues']] : []), ['noowner', 'No owner']];

  const filtered = useMemo(() => {
    const openCount = c => kidsOf(c.clientId).actions.filter(isOpenAction).length;
    const sorter = {
      id: (a, b) => idNum(a.clientId) - idNum(b.clientId),
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      dues: (a, b) => num(b.outstanding) - num(a.outstanding) || idNum(a.clientId) - idNum(b.clientId),
      actions: (a, b) => openCount(b) - openCount(a) || idNum(a.clientId) - idNum(b.clientId),
      followup: (a, b) => String(a.nextFollowUp || '9999').localeCompare(String(b.nextFollowUp || '9999')),
    }[sortBy] || ((a, b) => idNum(a.clientId) - idNum(b.clientId));
    return data.clients.filter(c => baseMatch(c) && (quickTests[quick] || quickTests.all)(c)).sort(sorter);
  }, [data.clients, search, industryF, statusF, ownerF, quick, sortBy, kidsOf]);

  // Search / industry / status / owner (everything except the quick type tabs). Used by the list
  // above and by the KPI cards, so the cards follow the same filters.
  function baseMatch(c) {
    const q = norm(search);
    let mQ = true;
    if (q) {
      const kids = kidsOf(c.clientId);
      const hay = [c.clientId, c.name, c.legalName, c.parentGroup, c.businessUnit, c.industry, c.subIndustry, c.hqCity, c.locations, c.owner,
        c.delivered, c.activePrograms, c.opportunities, ...kids.contacts.map(p => p.fullName), ...kids.programs.map(p => p.program)].map(norm).join(' | ');
      mQ = q.split(' ').every(w => hay.includes(w));
    }
    return mQ
      && (industryF === 'All' || c.industry === industryF)
      && (statusF === 'All' || c.relStatus === statusF)
      && (ownerF === 'All' || c.owner === ownerF);
  }

  const sel = selected ? data.clients.find(c => c.clientId === selected) : null;

  /* ─── Writes ─── */
  const keepHidden = (kind, rec) => {
    if (showMoney) return rec;
    const keys = kind === 'clients' ? CLIENT_MONEY_KEYS : kind === 'programs' ? PROGRAM_MONEY_KEYS : [];
    const prev = data[kind].find(x => x[TABLES[kind].idKey] === rec[TABLES[kind].idKey]) || {};
    return { ...rec, ...Object.fromEntries(keys.map(k => [k, prev[k] ?? ''])) };
  };
  const putLocal = (kind, rec, isNew) => setData(d => ({ ...d, [kind]: isNew ? [rec, ...d[kind]]
    : d[kind].map(x => (x[TABLES[kind].idKey] === rec[TABLES[kind].idKey] ? rec : x)) }));

  /** Logging an interaction moves the client's Last Interaction / Next Follow-up forward. */
  const bumpClient = async (clientId, it) => {
    const c = data.clients.find(x => x.clientId === clientId); if (!c) return;
    const ch = {};
    if (it.date && (!c.lastInteraction || it.date > c.lastInteraction)) ch.lastInteraction = it.date;
    if (it.nextFollowUp && it.nextFollowUp !== c.nextFollowUp) { ch.nextFollowUp = it.nextFollowUp; if (it.nextStep) ch.nextAction = it.nextStep; }
    if (!Object.keys(ch).length) return;
    const row = { ...c, ...ch, updatedBy: me, updatedOn: todayIso() };
    await updateRecord('clients', row); putLocal('clients', row, false);
  };

  const save = async (kind, rec, isNew) => {
    const t = TABLES[kind];
    setSaving(true);
    try {
      if (isNew) {
        const row = { ...rec, [t.idKey]: nextId(kind, data[kind]) };
        if (kind === 'clients') Object.assign(row, { createdBy: me, createdOn: todayIso(), updatedBy: me, updatedOn: todayIso() });
        if (kind === 'contacts') Object.assign(row, { createdBy: me, updatedOn: todayIso() });
        if (kind === 'programs') row.updatedOn = todayIso();
        if (kind === 'actions') row.createdOn = todayIso();
        if (kind === 'interactions') row.loggedBy = me;
        await addRecord(kind, row);
        putLocal(kind, row, true);
        if (kind === 'clients') setSelected(row.clientId);
        if (kind === 'interactions') await bumpClient(row.clientId, row);
        showToast(`✓ ${KIND_NOUN[kind][0].toUpperCase()}${KIND_NOUN[kind].slice(1)} added (${row[t.idKey]})`);
      } else {
        let row = keepHidden(kind, rec);
        if (kind === 'clients') row = { ...row, updatedBy: me, updatedOn: todayIso() };
        if (kind === 'contacts' || kind === 'programs') row = { ...row, updatedOn: todayIso() };
        const prev = data[kind].find(x => x[t.idKey] === row[t.idKey]);
        await updateRecord(kind, row);
        putLocal(kind, row, false);
        // Renamed client → keep Client Name in step on its contacts / programs / actions / interactions
        if (kind === 'clients' && prev && s(prev.name) !== s(row.name)) {
          const kids = kidsOf(row.clientId); let n = 0;
          for (const k of CHILD_KINDS) for (const r of kids[k]) {
            const upd = { ...r, clientId: row.clientId, clientName: row.name };
            await updateRecord(k, upd); putLocal(k, upd, false); n++;
          }
          showToast(n ? `✓ Client renamed — ${n} linked record${n === 1 ? '' : 's'} updated` : '✓ Saved');
        } else showToast('✓ Saved');
        if (kind === 'interactions') await bumpClient(row.clientId, row);
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  const removeKid = async (kind, rec) => {
    const t = TABLES[kind];
    const label = rec.fullName || rec.program || rec.action || rec.summary || rec[t.idKey];
    if (!window.confirm(`Delete ${KIND_NOUN[kind]} ${rec[t.idKey]} · ${String(label).slice(0, 80)}? This cannot be undone.`)) return;
    setSaving(true);
    try { await deleteRecord(kind, rec[t.idKey]); setData(d => ({ ...d, [kind]: d[kind].filter(x => x[t.idKey] !== rec[t.idKey]) })); showToast('✓ Deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const removeClient = async () => {
    const k = kidsOf(sel.clientId);
    const n = CHILD_KINDS.reduce((t, x) => t + k[x].length, 0);
    if (n) { window.alert(`${sel.name} still has ${n} linked record(s) (contacts, programs, actions, interactions). Delete those first — or set Client Type to "Lost" / "Dormant" to keep the history.`); return; }
    if (!window.confirm(`Delete ${sel.clientId} · ${sel.name}? This cannot be undone.`)) return;
    setSaving(true);
    try { await deleteRecord('clients', sel.clientId); setData(d => ({ ...d, clients: d.clients.filter(c => c.clientId !== sel.clientId) })); setSelected(null); showToast('✓ Client deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const toggleAction = a => save('actions', { ...a, status: a.status === 'Done' ? 'Open' : 'Done', closedOn: a.status === 'Done' ? '' : todayIso() }, false);

  const openAdd = (kind, client = sel) => {
    const link = client ? { clientId: client.clientId, clientName: client.name } : {};
    const defaults = {
      clients: { clientType: 'Prospect', relStatus: 'In discussion', owner: me, geography: 'India' },
      contacts: { ...link, status: 'Active', primary: 'No' },
      programs: { ...link, status: 'Pipeline', erOwner: me },
      actions: { ...link, status: 'Open', priority: 'Medium', erOwner: me },
      interactions: { ...link, date: todayIso(), erAttendees: me },
    }[kind];
    setModal({ kind, defaults });
  };

  /* ─── Reminders popup ─── */
  const rules = useMemo(() => (showMoney ? CLIENT_RULES : { ...CLIENT_RULES, fields: CLIENT_RULES.fields.filter(f => !f.money) }), [showMoney]);
  const pendingBar = useMemo(() => pendingItems(filtered, rules, c => ({
    id: c.clientId, serial: c.clientId.replace(/^CL-0*/, ''), title: c.name, subtitle: [c.clientType, c.industry].filter(Boolean).join(' · '),
  })), [filtered, rules]);
  const dueBar = useMemo(() => filtered.map(c => {
    const tasks = [];
    if (c.nextFollowUp) tasks.push({ key: 'nextFollowUp', label: c.nextAction ? `Follow up: ${c.nextAction.slice(0, 40)}` : 'Follow up', due: c.nextFollowUp });
    if (c.contractEnd && !['Expired', 'Not required'].includes(c.contractStatus)) tasks.push({ key: 'contractEnd', label: 'Renew contract', due: addDays(c.contractEnd, -O.CONTRACT_WARN_DAYS) });
    kidsOf(c.clientId).actions.filter(a => isOpenAction(a) && a.due).forEach(a => tasks.push({ key: `act-${a.actionId}`, label: a.action.slice(0, 48), due: a.due }));
    return tasks.length ? { id: c.clientId, serial: c.clientId.replace(/^CL-0*/, ''), title: c.name, subtitle: c.owner ? `owner ${c.owner}` : '', tasks, row: c } : null;
  }).filter(Boolean), [filtered, kidsOf]);
  const fixField = (c, f) => { setModal({ kind: 'clients', rec: c }); setTimeout(() => revealField(f.key, f.label), 60); };
  const openPending = (it, f) => { setView('clients'); setSelected(it.row.clientId); fixField(it.row, f); };
  const openDue = (it, t) => {
    setView('clients'); setSelected(it.row.clientId);
    if (t?.key) setTimeout(() => revealField(t.key, ''), 120);
  };

  if (!clientsConfigured()) return (
    <div className="card lv-placeholder" style={{ margin: 20 }}>
      <div className="lv-big">🏢</div><b>Client Directory is not connected yet</b>
      <div className="lv-muted">Upload Client_Directory.xlsx, create the “CRM Clients CRUD” flow and paste its URL into src/config/powerAutomate.js → CLIENTS_CRUD.</div>
    </div>
  );
  if (loading) return <LoadingState message="Loading Client Directory from Excel…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  /* KPIs — follow search / industry / status / owner. The quick type tabs are not applied to the
     cards (the cards and tab counts are that breakdown). Contacts and actions count for the shown clients. */
  const kpiClients = data.clients.filter(baseMatch);
  const isFilteredKpi = kpiClients.length !== data.clients.length;
  const kpiKids = isFilteredKpi ? kpiClients.map(c => kidsOf(c.clientId)) : null;
  const kpiActions = isFilteredKpi ? kpiKids.flatMap(k => k.actions) : data.actions;
  const kpiContacts = isFilteredKpi ? kpiKids.flatMap(k => k.contacts) : data.contacts;
  const openActs = kpiActions.filter(isOpenAction);
  const overdueActs = openActs.filter(a => a.due && daysFromToday(a.due) < 0);
  const outstanding = kpiClients.reduce((t, c) => t + num(c.outstanding), 0);
  const quickCount = Object.fromEntries(QUICK.map(([k]) => [k, kpiClients.filter(quickTests[k]).length]));

  const clientCols = Object.entries(TABLES.clients.cols).filter(([k]) => showMoney || !CLIENT_MONEY_KEYS.includes(k)).map(([key, label]) => ({ label, key }));
  const colsOf = kind => Object.entries(TABLES[kind].cols).filter(([k]) => showMoney || kind !== 'programs' || !PROGRAM_MONEY_KEYS.includes(k)).map(([key, label]) => ({ label, key }));
  const goClient = r => {
    const id = r.clientId || data.clients.find(c => norm(c.name) === norm(r.clientName))?.clientId;
    if (!id) return;
    setView('clients'); setSelected(id);
  };
  const q = norm(search);
  const matchQ = r => !q || q.split(' ').every(w => Object.values(r).map(norm).join(' | ').includes(w));
  const viewLabel = VIEWS.find(v => v[0] === view)[1];

  const modalTitle = m => {
    const noun = KIND_NOUN[m.kind]; const who = m.rec?.clientName || m.defaults?.clientName || '';
    const verb = m.rec ? 'Edit' : m.kind === 'interactions' ? 'Log' : 'Add';
    return `${verb} ${noun}${m.rec ? ` · ${m.rec[TABLES[m.kind].idKey]}` : ''}${who ? ` — ${who}` : ''}`;
  };

  // profile navigation (within the current filter + sort)
  const pos = sel ? filtered.findIndex(c => c.clientId === sel.clientId) : -1;
  const nav = {
    pos: pos >= 0 ? `${pos + 1} of ${filtered.length}` : '',
    prev: pos > 0 ? filtered[pos - 1] : null, next: pos >= 0 && pos < filtered.length - 1 ? filtered[pos + 1] : null,
  };
  nav.goPrev = () => nav.prev && setSelected(nav.prev.clientId);
  nav.goNext = () => nav.next && setSelected(nav.next.clientId);

  return (
    <div className="tracker-page">
      {toast && <div className="lv-toast">{toast}</div>}
      <datalist id="cl-names">{names.map(n => <option key={n} value={n} />)}</datalist>
      {modal && <RecordModal kind={modal.kind} initial={modal.rec} defaults={modal.defaults} title={modalTitle(modal)} showMoney={showMoney}
        clientNames={clientNames} saving={saving} onClose={() => setModal(null)} onSave={r => save(modal.kind, r, !modal.rec)} />}

      {!(view === 'clients' && sel) && <>
        <div className="kpi-compact">
          <div className="kpi-card"><div className="kpi-label">Existing clients</div><div className="kpi-value">{quickCount.existing}</div><div className="kpi-sub">{isFilteredKpi ? `${kpiClients.length} filtered · ` : ''}{data.clients.length} in the directory · {quickCount.prospect} prospects</div></div>
          <div className="kpi-card"><div className="kpi-label">Active relationships</div><div className="kpi-value">{kpiClients.filter(c => c.relStatus === 'Active').length}</div><div className="kpi-sub">{kpiClients.filter(c => c.health === 'Red').length} at risk (red)</div></div>
          {showMoney
            ? <div className="kpi-card"><div className="kpi-label">Outstanding</div><div className="kpi-value">{inrShort(outstanding)}</div><div className="kpi-sub">{quickCount.dues} clients with dues</div></div>
            : <div className="kpi-card"><div className="kpi-label">Contacts</div><div className="kpi-value">{kpiContacts.length}</div><div className="kpi-sub">{isFilteredKpi ? 'across the filtered clients' : 'across all clients'}</div></div>}
          <div className="kpi-card accent"><div className="kpi-label">Open actions</div><div className="kpi-value" style={{ color: overdueActs.length ? 'var(--error)' : undefined }}>{openActs.length}</div><div className="kpi-sub">{overdueActs.length} overdue</div></div>
        </div>

        <div className="filter-bar lv-filters" style={{ flexShrink: 0 }}>
          <div className="lv-tabs">{VIEWS.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
          <input className="form-input wide" placeholder="🔍 Client, contact, program, city…" value={search} onChange={e => setSearch(e.target.value)} />
          {view === 'clients' && <>
            <select className="form-input" value={industryF} onChange={e => setIndustryF(e.target.value)}>
              <option value="All">All industries</option>{industries.map(i => <option key={i}>{i}</option>)}
            </select>
            <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="All">All relationship status</option>{O.REL_STATUS.map(i => <option key={i}>{i}</option>)}
            </select>
            <select className="form-input" value={ownerF} onChange={e => setOwnerF(e.target.value)}>
              <option value="All">All owners</option>{owners.map(i => <option key={i}>{i}</option>)}
            </select>
            <select className="form-input" value={sortBy} onChange={e => setSortBy(e.target.value)} title="Sort">
              {SORTS.filter(([k]) => showMoney || k !== 'dues').map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
            </select>
            <div className="lv-tabs cl-layout">
              <button className={layout === 'grid' ? 'on' : ''} title="Cards" onClick={() => setLayout('grid')}><LayoutGrid size={14} /></button>
              <button className={layout === 'list' ? 'on' : ''} title="Table" onClick={() => setLayout('list')}><List size={14} /></button>
            </div>
          </>}
          <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>{refreshing ? '⟳' : '↺'}</button>
          {view === 'clients'
            ? <ExportButton page="clients" filename="Client Directory" sheetName="Clients" rows={() => filtered} columns={clientCols} />
            : <ExportButton page="clients" filename={`Client ${viewLabel}`} sheetName={viewLabel} rows={() => data[view].filter(matchQ)} columns={colsOf(view)} />}
          {perm.create && view === 'clients' && <button className="btn btn-primary btn-sm" onClick={() => openAdd('clients', null)}>+ Add Client</button>}
        </div>

        {view === 'clients' && <div className="lv-quickfilters">
          {QUICK.map(([k, l]) => <button key={k} className={`lv-qf${quick === k ? ' on' : ''}`} onClick={() => setQuick(k)}>{l} <b>{quickCount[k]}</b></button>)}
        </div>}
      </>}

      {view === 'clients' && (
        <div className="tracker-scroll cl-scroll">
          {sel ? (
            <ClientProfile c={sel} kids={kidsOf(sel.clientId)} rules={rules} showMoney={showMoney} perm={perm} saving={saving} nav={nav}
              onBack={() => setSelected(null)} onEdit={() => setModal({ kind: 'clients', rec: sel })} onDelete={removeClient}
              onAdd={k => openAdd(k)} onEditKid={(kind, rec) => setModal({ kind, rec })} onDeleteKid={removeKid}
              onToggleAction={toggleAction} onFix={f => fixField(sel, f)} />
          ) : !filtered.length ? (
            <div className="lv-empty" style={{ margin: 16 }}>No clients match these filters.</div>
          ) : layout === 'grid' ? (
            <div className="cl-grid">
              {filtered.map(c => <ClientCard key={c.clientId} c={c} kids={kidsOf(c.clientId)} showMoney={showMoney} onOpen={() => setSelected(c.clientId)} />)}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, marginBottom: 80 }}><div className="table-wrap">
              <table className="lv-table cl-table"><thead><tr><th>ID</th><th>Client</th><th>Type</th><th>Industry</th><th>Status</th><th>Health</th><th>Owner</th>
                <th>Contacts</th><th>Programs</th><th>Open actions</th>{showMoney && <th>Outstanding</th>}<th>Next follow-up</th></tr></thead>
                <tbody>{filtered.map(c => {
                  const k = kidsOf(c.clientId); const open = k.actions.filter(isOpenAction);
                  return (
                    <tr key={c.clientId} onClick={() => setSelected(c.clientId)}>
                      <td><span className="lv-id">{c.clientId}</span></td>
                      <td><div className="cl-cell-name"><span className="cl-mono sm">{monogram(c.name)}</span><b>{c.name}</b>{c.tier === 'Strategic' && <Star size={12} className="cl-star-ic" />}</div></td>
                      <td>{c.clientType ? <span className={`lv-pill ${TYPE_CLS[c.clientType] || 'lv-st-new'}`}>{c.clientType}</span> : '—'}</td>
                      <td>{c.industry || '—'}</td><td>{c.relStatus || '—'}</td><td><Health value={c.health} /></td><td>{c.owner || '—'}</td>
                      <td>{k.contacts.filter(p => !isFormer(p)).length}</td><td>{k.programs.length}</td>
                      <td className={open.some(a => a.due && daysFromToday(a.due) < 0) ? 'lv-warn-t' : ''}>{open.length}</td>
                      {showMoney && <td>{inr(c.outstanding) || '—'}</td>}
                      <td>{c.nextFollowUp ? dueChip(c.nextFollowUp) : '—'}</td>
                    </tr>
                  );
                })}</tbody></table></div></div>
          )}
        </div>
      )}

      {view === 'contacts' && <div className="tracker-scroll"><div className="card" style={{ padding: 16 }}><div className="table-wrap">
        <table className="lv-table cl-table"><thead><tr><th>Client</th><th>Name</th><th>Designation</th><th>Role</th><th>Mobile</th><th>Email</th><th>Primary</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>{data.contacts.filter(matchQ).sort((a, b) => String(a.clientName).localeCompare(String(b.clientName))).map(p => (
            <tr key={p.contactId} onClick={() => goClient(p)}>
              <td><b>{p.clientName}</b></td><td>{p.fullName}</td><td>{p.designation || '—'}</td><td>{p.role || '—'}</td>
              <td>{p.mobile || '—'}</td><td>{p.email || '—'}</td><td>{p.primary === 'Yes' ? '★' : ''}</td><td>{p.status || '—'}</td>
              <td className="lv-muted" style={{ maxWidth: 320 }}>{p.notes}</td>
            </tr>))}</tbody></table></div></div></div>}

      {view === 'actions' && <div className="tracker-scroll"><div className="card" style={{ padding: 16 }}><div className="table-wrap">
        <table className="lv-table cl-table"><thead><tr><th></th><th>Client</th><th>Action</th><th>Owner</th><th>With</th><th>Due</th><th>Status</th><th>Priority</th><th>Context</th></tr></thead>
          <tbody>{data.actions.filter(a => isOpenAction(a) || a.status === 'Recurring').filter(matchQ)
            .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'))).map(a => (
            <tr key={a.actionId}>
              <td onClick={e => e.stopPropagation()}>{perm.update && isOpenAction(a) && <input type="checkbox" title="Mark done" disabled={saving} onChange={() => toggleAction(a)} />}</td>
              <td onClick={() => goClient(a)}><b>{a.clientName}</b></td>
              <td>{a.action}</td><td>{a.erOwner || '—'}</td><td>{a.ownerContact || '—'}</td>
              <td>{a.due ? dueChip(a.due) : <span className="lv-muted">{a.timing || '—'}</span>}</td><td>{a.status || 'Open'}</td><td>{a.priority}</td>
              <td className="lv-muted" style={{ maxWidth: 300 }}>{a.context}</td>
            </tr>))}</tbody></table></div></div></div>}

      {view === 'programs' && <div className="tracker-scroll"><div className="card" style={{ padding: 16 }}><div className="table-wrap">
        <table className="lv-table cl-table"><thead><tr><th>Client</th><th>Program</th><th>FY</th><th>Status</th><th>Batches</th><th>Participants</th>
          {showMoney && <><th>Fee</th><th>PO value</th></>}<th>Feedback</th><th>Next milestone</th></tr></thead>
          <tbody>{data.programs.filter(matchQ).sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)) || String(b.fy).localeCompare(String(a.fy))).map(p => (
            <tr key={p.programId} onClick={() => goClient(p)}>
              <td><b>{p.clientName}</b></td><td>{p.program}</td><td>{p.fy}</td>
              <td><span className={`lv-pill ${PROG_CLS[p.status] || 'lv-st-new'}`}>{p.status || '—'}</span></td>
              <td>{p.batchesContracted !== '' || p.batchesDelivered !== '' ? `${p.batchesDelivered || 0} / ${p.batchesContracted || '?'}` : '—'}</td>
              <td>{p.participants || '—'}</td>
              {showMoney && <><td>{inr(p.feeRate) || '—'}</td><td>{inr(p.poValue) || '—'}</td></>}
              <td>{p.feedback || '—'}</td><td className="lv-muted" style={{ maxWidth: 280 }}>{p.nextMilestone}</td>
            </tr>))}</tbody></table></div></div></div>}

      <PendingFieldsBar items={pendingBar} dueItems={dueBar} onPick={openPending} onPickDue={openDue} canEdit={perm.update} noun="client" />
    </div>
  );
}
