/**
 * Shared pickers — Client, Contact (POC), Consultant, Team member, Vendor, Proposal — plus the two quick-add forms.
 * Every tracker still stores plain text; a picker only helps fill the field and keeps the Client Directory in step.
 * Rules: typing works as before (free text, "Not in directory" chip); related fields are filled ONLY when the person
 * picks a suggestion, and never with an empty value. Quick-add only ADDS a Client Directory row.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { useNavigate } from 'react-router-dom';
import EntityPicker from './EntityPicker.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { usePermissionsContext } from '../../context/PermissionsContext.jsx';
import {
  getDirectory, onDirectoryChange, ensureDirectory, findClient, suggestClients, nearDuplicates, contactsOf, findContact,
  findConsultant, quickAddClient, quickAddContact, nameKey, isNotAClient,
} from '../../services/directoryCache.js';
import { CONSULTANT_EXTRAS } from '../../config/clientAliases.js';
import { INDUSTRIES, CLIENT_TYPES } from '../../config/clientOptions.js';
import '../../styles/pickers.css';

const txt = v => String(v ?? '').trim();
const has = (s, q) => nameKey(s).includes(nameKey(q));

/** Live snapshot of the lookup lists; starts loading anything missing. */
export function useDirectory() {
  const [d, setD] = useState(getDirectory);
  useEffect(() => { const off = onDirectoryChange(setD); ensureDirectory(); setD(getDirectory()); return off; }, []);
  return d;
}
/** Team names (Admin Panel people) — sorted, unique. */
export function useTeamNames(extra = []) {
  const { permissions } = usePermissionsContext();
  return useMemo(() => [...new Set([...Object.values(permissions || {}).map(p => txt(p?.name)), ...extra.map(txt)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)), [permissions, extra.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}
function useMe() {
  const { accounts } = useMsal();
  return accounts[0]?.name || accounts[0]?.username || '';
}

/* ─── Client ─── */
export function ClientPicker({ value, onChange, onPick, allowAdd = true, placeholder = 'Type to search clients…', ...rest }) {
  const d = useDirectory();
  const { isAdmin, canCreate } = usePermissions();
  const [adding, setAdding] = useState(null);
  const canAdd = allowAdd && (isAdmin || canCreate('clients')) && !d.failed.clients && d.ready.clients;
  const filter = q => suggestClients(q, 30, d).map(c => ({
    key: c.clientId || c.name, value: c.name, item: c,
    label: c.name, sub: [c.industry, c.clientType, c.hqCity].filter(Boolean).join(' · ') || c.legalName,
  }));
  const known = !!findClient(value, d) || isNotAClient(value);
  return (
    <>
      <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} placeholder={placeholder}
        matched={d.ready.clients ? known : undefined}
        onAdd={canAdd ? t => setAdding(t) : undefined} addLabel={t => `Add “${t}” as a new client`} {...rest} />
      {adding !== null && (
        <QuickAddClientModal initialName={adding} onClose={() => setAdding(null)}
          onSaved={c => { setAdding(null); onChange?.(c.name); onPick?.(c); }} />
      )}
    </>
  );
}

/* ─── Contact (POC) of one client ─── */
export function ContactPicker({ client, value, onChange, onPick, allowAdd = true, multiple = false, placeholder, ...rest }) {
  const d = useDirectory();
  const { isAdmin, canCreate } = usePermissions();
  const [adding, setAdding] = useState(null);
  const c = findClient(client, d);
  const list = contactsOf(c, d);
  const canAdd = allowAdd && !!c && (isAdmin || canCreate('clients'));
  const filter = q => list.filter(p => !q || has(p.fullName, q) || has(p.email, q) || has(p.designation, q)).map(p => ({
    key: p.contactId || p.fullName, value: p.fullName, item: p, label: p.fullName,
    sub: [p.designation, p.email, /yes/i.test(p.primary) ? 'Primary' : '', /former|left/i.test(p.status) ? p.status : ''].filter(Boolean).join(' · '),
  }));
  const last = multiple ? txt(String(value ?? '').split(/\s*[;\n]\s*/).filter(Boolean).pop()) : txt(value);
  const matched = c && d.ready.clients ? (!last || !!findContact(c, { name: last }, d)) : undefined;
  return (
    <>
      <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} multiple={multiple}
        placeholder={placeholder || (c ? `Contacts at ${c.name}…` : 'Contact name')}
        emptyText={c ? (list.length ? '' : `No contacts saved for ${c.name} yet`) : (txt(client) ? '' : 'Pick the client first to see its contacts')}
        matched={matched} onAdd={canAdd ? t => setAdding(t) : undefined} addLabel={t => `Add “${t}” as a contact at ${c?.name}`} {...rest} />
      {adding !== null && c && (
        <QuickAddContactModal client={c} initialName={adding} onClose={() => setAdding(null)}
          onSaved={p => {
            setAdding(null);
            if (multiple) { const keep = String(value ?? '').split(/\s*[;\n]\s*/).slice(0, -1).map(txt).filter(Boolean); onChange?.([...keep, p.fullName].join('; ')); }
            else onChange?.(p.fullName);
            onPick?.(p);
          }} />
      )}
    </>
  );
}

/* ─── Consultant (no quick-add: a consultant needs a full profile) ─── */
export function ConsultantPicker({ value, onChange, onPick, multiple = false, includeTeam = true, placeholder = 'Consultant…', ...rest }) {
  const d = useDirectory();
  const team = useTeamNames();
  const navigate = useNavigate();
  const extras = useMemo(() => [...(includeTeam ? team : []), ...CONSULTANT_EXTRAS], [team, includeTeam]);
  const filter = q => {
    const cons = d.consultants.filter(c => !q || has(c.fullName, q) || has(c.city, q) || has(c.badges, q)).map(c => ({
      key: c.consultantId || c.fullName, value: c.fullName, item: c, label: c.fullName,
      sub: [c.designation, c.city, c.status && !/active/i.test(c.status) ? c.status : ''].filter(Boolean).join(' · '),
    }));
    const ex = extras.filter(n => (!q || has(n, q)) && !cons.some(c => nameKey(c.value) === nameKey(n)))
      .map(n => ({ key: 'x:' + n, value: n, label: n, sub: CONSULTANT_EXTRAS.includes(n) ? 'Placeholder' : 'EuRadicle team' }));
    return [...cons, ...ex];
  };
  const last = multiple ? txt(String(value ?? '').split(/\s*[;\n]\s*/).filter(Boolean).pop()) : txt(value);
  const matched = d.ready.consultants ? (!last || !!findConsultant(last, d) || extras.some(n => nameKey(n) === nameKey(last))) : undefined;
  return (
    <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} multiple={multiple} placeholder={placeholder}
      matched={matched} chipText="Not in Consultant Directory"
      footer={<button type="button" className="ep-link" onClick={() => navigate('/consultants')}>Open Consultant Directory ↗</button>} {...rest} />
  );
}

/* ─── Team member (Admin Panel people) ─── */
export function TeamPicker({ value, onChange, onPick, multiple = false, extra = [], placeholder = 'Team member…', ...rest }) {
  const team = useTeamNames(extra);
  const filter = q => team.filter(n => !q || has(n, q)).map(n => ({ key: n, value: n, label: n }));
  const last = multiple ? txt(String(value ?? '').split(/\s*[;\n]\s*/).filter(Boolean).pop()) : txt(value);
  const matched = team.length ? (!last || team.some(n => nameKey(n) === nameKey(last))) : undefined;
  return <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} multiple={multiple} placeholder={placeholder}
    matched={matched} chipText="Not in team list" {...rest} />;
}

/* ─── Vendor (suggestions from past Vendor Name values) ─── */
export function VendorPicker({ value, onChange, onPick, placeholder = 'Vendor name…', ...rest }) {
  const d = useDirectory();
  const filter = q => d.vendors.filter(v => !q || has(v.name, q)).map(v => ({
    key: v.name, value: v.name, item: v, label: v.name,
    sub: [v.categories.slice(0, 2).join(', '), `${v.uses} service${v.uses === 1 ? '' : 's'}`, v.contact].filter(Boolean).join(' · '),
  }));
  return <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} placeholder={placeholder} {...rest} />;
}

/* ─── Proposal ID (BD / Solution Tracker) ─── */
export function ProposalPicker({ value, onChange, onPick, client, placeholder = 'Proposal ID…', ...rest }) {
  const d = useDirectory();
  const ck = nameKey(client);
  const filter = q => d.proposals
    .filter(p => !q || has(p.id, q) || has(p.client, q) || has(p.topic, q))
    .sort((a, b) => (ck ? (nameKey(b.client) === ck) - (nameKey(a.client) === ck) : 0))
    .map(p => ({ key: p.id, value: p.id, item: p, label: `${p.id}${p.version ? ` · V${String(p.version).replace(/^v/i, '')}` : ''}`,
      sub: [p.client, p.topic, p.status].filter(Boolean).join(' · ') }));
  const matched = d.ready.proposals ? (!txt(value) || d.proposals.some(p => p.id === txt(value))) : undefined;
  return <EntityPicker value={value} onChange={onChange} onPick={onPick} filter={filter} placeholder={placeholder}
    matched={matched} chipText="Not in BD Tracker" {...rest} />;
}

/* ─── Quick-add forms (480px modal, drawn on <body> so the form underneath keeps its data) ─── */
function Modal({ title, children, onClose }) {
  const stop = e => e.stopPropagation();
  return createPortal(
    <div className="modal-overlay ep-modal-overlay" onClick={e => { e.stopPropagation(); onClose(); }} onMouseDown={stop} onKeyDown={stop}>
      <div className="modal-box ep-modal" onClick={stop} role="dialog" aria-label={title}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>, document.body);
}

export function QuickAddClientModal({ initialName = '', onSaved, onClose, note }) {
  const me = useMe();
  const d = useDirectory();
  const [f, setF] = useState({ name: initialName, industry: '', clientType: 'Prospect', hqCity: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const dupes = useMemo(() => nearDuplicates(f.name, d), [f.name, d]);
  const exact = findClient(f.name, d);
  const save = async () => {
    setBusy(true); setErr('');
    try { const { client } = await quickAddClient({ ...f, note }, me); onSaved(client); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="New client" onClose={onClose}>
      <div className="form-grid ep-grid">
        <div className="form-field full"><label className="form-label">Client name *</label>
          <input className="form-input" autoFocus value={f.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-field"><label className="form-label">Industry</label>
          <select className="form-input" value={f.industry} onChange={e => set('industry', e.target.value)}>
            <option value="">— select —</option>{INDUSTRIES.map(o => <option key={o}>{o}</option>)}</select></div>
        <div className="form-field"><label className="form-label">Client type</label>
          <select className="form-input" value={f.clientType} onChange={e => set('clientType', e.target.value)}>
            {CLIENT_TYPES.map(o => <option key={o}>{o}</option>)}</select></div>
        <div className="form-field full"><label className="form-label">HQ city</label>
          <input className="form-input" value={f.hqCity} onChange={e => set('hqCity', e.target.value)} /></div>
      </div>
      {(exact || dupes.length > 0) && (
        <div className="ep-warn">
          {exact ? <>“{f.name}” is already in the directory as <b>{exact.name}</b>.</> : <>Did you mean one of these?</>}
          <div className="ep-warn-list">
            {(exact ? [exact] : dupes).map(c => (
              <button type="button" key={c.clientId || c.name} className="ep-use" onClick={() => onSaved(c)}>Use {c.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="ep-note">Adds one new row to the Client Directory with the next Client ID. Other details can be filled in later on the client's profile.</div>
      {err && <div className="ep-err">❌ {err}</div>}
      <div className="ep-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !txt(f.name) || !!exact} onClick={save}>{busy ? 'Saving…' : 'Save client'}</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

export function QuickAddContactModal({ client, initialName = '', initial = {}, onSaved, onClose }) {
  const me = useMe();
  const [f, setF] = useState({ fullName: initialName, designation: '', email: '', mobile: '', primary: '', ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr('');
    try { const { contact } = await quickAddContact({ client, ...f }, me); onSaved(contact); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`New contact · ${client.name}`} onClose={onClose}>
      <div className="form-grid ep-grid">
        <div className="form-field full"><label className="form-label">Full name *</label>
          <input className="form-input" autoFocus value={f.fullName} onChange={e => set('fullName', e.target.value)} /></div>
        <div className="form-field"><label className="form-label">Designation</label>
          <input className="form-input" value={f.designation} onChange={e => set('designation', e.target.value)} /></div>
        <div className="form-field"><label className="form-label">Email</label>
          <input className="form-input" type="email" value={f.email} onChange={e => set('email', e.target.value.trim())} /></div>
        <div className="form-field"><label className="form-label">Phone</label>
          <input className="form-input" value={f.mobile} onChange={e => set('mobile', e.target.value)} /></div>
        <div className="form-field"><label className="form-label">Primary contact</label>
          <select className="form-input" value={f.primary} onChange={e => set('primary', e.target.value)}>
            <option value="">—</option><option>Yes</option><option>No</option></select></div>
      </div>
      <div className="ep-note">Adds one new row to the Client Directory's contacts, under {client.name}.</div>
      {err && <div className="ep-err">❌ {err}</div>}
      <div className="ep-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !txt(f.fullName)} onClick={save}>{busy ? 'Saving…' : 'Save contact'}</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/**
 * "Save to <client>'s contacts" tick-box for a POC typed by hand. Shows only when the client is in the directory
 * and no saved contact has that email (or name). The parent calls saveTypedContact() after its own save.
 */
export function SaveContactTick({ client, name, email, checked, onChange }) {
  const d = useDirectory();
  const c = findClient(client, d);
  const { isAdmin, canCreate } = usePermissions();
  if (!c || !txt(name) || !(isAdmin || canCreate('clients'))) return null;
  if (findContact(c, { name, email }, d)) return null;
  return (
    <label className="ep-tick"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      Save “{txt(name)}” to {c.name}'s contacts</label>
  );
}
/** True when SaveContactTick would show for these values. */
export function needsContactSave(client, name, email) {
  const c = findClient(client);
  return !!(c && txt(name) && !findContact(c, { name, email }));
}
/** Adds a typed POC to the directory (after the tracker row is saved). Never throws — returns a short message. */
export async function saveTypedContact({ client, fullName, designation, email, mobile }, by) {
  try {
    const { created, contact } = await quickAddContact({ client, fullName, designation, email, mobile }, by);
    return created ? `Contact ${contact.contactId} added to the Client Directory` : '';
  } catch (e) { return `Contact not added to the Client Directory: ${e.message || e}`; }
}
/** Adds a client by name only (Lead tick-box, lead moved to BD). Never throws — returns { client, msg }. */
export async function ensureClientInDirectory(name, by, extra = {}) {
  const n = txt(name);
  if (!n || isNotAClient(n)) return { client: null, msg: '' };
  const hit = findClient(n);
  if (hit) return { client: hit, msg: '' };
  try {
    const { client, created } = await quickAddClient({ name: n, ...extra }, by);
    return { client, msg: created ? `${client.name} added to the Client Directory (${client.clientId})` : '' };
  } catch (e) { return { client: null, msg: `Client not added to the Client Directory: ${e.message || e}` }; }
}
