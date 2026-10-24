/**
 * ADMIN PANEL — user access control
 * ==================================
 * Only the admin (permissions.js → ADMIN_EMAIL) can open it.
 *
 * Permission model: Create / Read / Update / Delete per page per user, stored in the
 * Admin Panel workbook → PermissionsTable (one row per user, 4 columns per page).
 * The panel shows them as access levels — No access · View · Edit · Full — with the
 * individual C R U D switches still available.
 *
 * Changes are kept as a draft and saved together ("Save changes"), then read back from
 * Excel to confirm every column was really written — a missing PermissionsTable column or
 * an unmapped column in the "Save Permissions" flow shows up as a warning instead of
 * silently losing access.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck, Search, UserPlus, Users, Save, Undo2, CheckCircle2, AlertTriangle, LayoutDashboard, Compass, Magnet, Target,
  Lightbulb, Building2, CalendarDays, ClipboardCheck, BookOpen, ListChecks, UserCheck, Wallet, Receipt, Copy, Trash2, Grid3x3,
  Settings2, Info, RefreshCw, X, Lock,
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions.js';
import { ADMIN_EMAIL } from '../config/permissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import { PAGE_PREFIX, PERMISSION_COLUMNS, seenPermissionColumns } from '../services/permissionsApi.js';
import '../styles/leadsVendors.css';
import '../styles/admin.css';

/* ─── Pages, grouped the way the team works ─── */
const GROUPS = [
  { id: 'overview', label: 'Overview', pages: [
    { key: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard, desc: 'Business KPIs across the trackers' },
    { key: 'founder', label: "Founder's Desk", Icon: Compass, desc: 'Whole-business view incl. money. Also needs Dashboard + Finance view', viewOnly: true, needs: ['dashboard', 'finance'] },
  ] },
  { id: 'sales', label: 'Sales & clients', pages: [
    { key: 'leads', label: 'Lead Tracker', Icon: Magnet, desc: 'Incoming leads, sources, follow-ups' },
    { key: 'bd', label: 'BD Tracker', Icon: Target, desc: 'Proposals, status, Won / Lost' },
    { key: 'solution', label: 'Solution Tracker', Icon: Lightbulb, desc: 'Solution lines per proposal' },
    { key: 'clients', label: 'Client Directory', Icon: Building2, desc: 'Accounts, contacts, programs, actions. Amounts need Finance view' },
  ] },
  { id: 'delivery', label: 'Delivery & operations', pages: [
    { key: 'engagement', label: 'Engagement Calendar', Icon: CalendarDays, desc: 'Sessions, consultants, dates (also ER Calendar)' },
    { key: 'ops', label: 'Ops Checklist', Icon: ClipboardCheck, desc: 'Pre / post delivery checklist per session' },
    { key: 'content-dev', label: 'Content Dev Tracker', Icon: BookOpen, desc: 'Content, pre-work and post-work deadlines' },
    { key: 'tasks', label: 'Project Management', Icon: ListChecks, desc: 'Internal projects and tasks. Assignees can always update their own tasks' },
    { key: 'consultants', label: 'Consultant Directory', Icon: UserCheck, desc: 'Profiles and contracts. Rates need Finance view' },
  ] },
  { id: 'finance', label: 'Finance', pages: [
    { key: 'finance', label: 'Finance Tracker', Icon: Wallet, desc: 'Invoices and payments. View also unlocks amounts in Clients, Consultants and Founder\'s Desk' },
    { key: 'vendors', label: 'Vendor Services', Icon: Receipt, desc: 'Vendor costs, client billing, vendor payments' },
  ] },
];
const PAGES = GROUPS.flatMap(g => g.pages);
const PAGE = Object.fromEntries(PAGES.map(p => [p.key, p]));

const OPS = [
  { key: 'create', short: 'C', label: 'Create' }, { key: 'read', short: 'R', label: 'Read' },
  { key: 'update', short: 'U', label: 'Update' }, { key: 'delete', short: 'D', label: 'Delete' },
];
const LEVELS = [['none', 'No access'], ['view', 'View'], ['edit', 'Edit'], ['full', 'Full']];
const LEVEL_CRUD = {
  none: { create: false, read: false, update: false, delete: false },
  view: { create: false, read: true, update: false, delete: false },
  edit: { create: true, read: true, update: true, delete: false },
  full: { create: true, read: true, update: true, delete: true },
};
const levelOf = c => {
  const k = ['create', 'read', 'update', 'delete'].map(o => (c?.[o] ? 1 : 0)).join('');
  return { '0000': 'none', '0100': 'view', '1110': 'edit', '1111': 'full' }[k] || 'custom';
};

/* ─── Role presets (page → level). Applying one replaces that person's access. ─── */
const ROLES = [
  { id: 'leadership', label: 'Leadership', desc: 'View everything, incl. Founder\'s Desk',
    map: Object.fromEntries(PAGES.map(p => [p.key, 'view'])) },
  { id: 'sales', label: 'Sales / BD', desc: 'Leads, BD, Solution, Clients',
    map: { dashboard: 'view', leads: 'full', bd: 'full', solution: 'full', clients: 'full', engagement: 'view', consultants: 'view', tasks: 'edit' } },
  { id: 'ops', label: 'Operations', desc: 'Calendar, Ops, Projects, Consultants',
    map: { dashboard: 'view', engagement: 'full', ops: 'full', tasks: 'full', consultants: 'full', 'content-dev': 'edit', vendors: 'edit', clients: 'view', bd: 'view' } },
  { id: 'content', label: 'Content', desc: 'Content Dev, Projects',
    map: { dashboard: 'view', 'content-dev': 'full', tasks: 'edit', engagement: 'view', ops: 'view', consultants: 'view' } },
  { id: 'finance', label: 'Finance', desc: 'Finance, Vendors, view money everywhere',
    map: { dashboard: 'view', finance: 'full', vendors: 'full', engagement: 'view', clients: 'view', bd: 'view', ops: 'view', founder: 'view' } },
  { id: 'none', label: 'No access', desc: 'Remove all access', map: {} },
];
const roleCrud = role => Object.fromEntries(PAGES.map(p => [p.key, { ...LEVEL_CRUD[role.map[p.key] || 'none'] }]));

/* ─── Helpers ─── */
const emptyCrud = () => Object.fromEntries(PAGES.map(p => [p.key, { ...LEVEL_CRUD.none }]));
const admin = ADMIN_EMAIL.toLowerCase();
const initials = s => String(s || '?').split(/[\s.@]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
function permsToUsers(perms) {
  return Object.entries(perms || {}).map(([email, cfg]) => ({
    email: email.toLowerCase(), name: cfg.name || email.split('@')[0],
    crud: Object.fromEntries(PAGES.map(p => [p.key, { ...LEVEL_CRUD.none, ...(cfg.crud?.[p.key] || {}) }])),
  })).sort((a, b) => (b.email === admin) - (a.email === admin) || a.name.localeCompare(b.name));
}
const usersToPerms = users => Object.fromEntries(users.map(u => [u.email, { name: u.name, crud: u.crud }]));
const sig = u => JSON.stringify([u.name, PAGES.map(p => OPS.map(o => (u.crud[p.key]?.[o.key] ? 1 : 0)).join(''))]);
const summary = u => {
  const lv = PAGES.map(p => levelOf(u.crud[p.key]));
  return { full: lv.filter(x => x === 'full').length, edit: lv.filter(x => x === 'edit' || x === 'custom').length, view: lv.filter(x => x === 'view').length,
    any: lv.some(x => x !== 'none') };
};
/** Pages whose rules are broken: founder without its prerequisites. */
function warningsFor(u) {
  const w = [];
  if (u.crud.founder?.read) {
    const miss = PAGE.founder.needs.filter(k => !u.crud[k]?.read);
    if (miss.length) w.push(`Founder's Desk also needs View on ${miss.map(k => PAGE[k].label).join(' and ')} — it stays hidden until then.`);
  }
  return w;
}

/* ─── Small parts ─── */
function LevelSeg({ value, onChange, viewOnly, disabled }) {
  const opts = viewOnly ? LEVELS.filter(([k]) => k === 'none' || k === 'view') : LEVELS;
  return (
    <div className="ad-seg" role="radiogroup">
      {opts.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled}
          className={`${value === k ? 'on' : ''} lv-${k}`} onClick={() => onChange(k)}>{l}</button>
      ))}
      {value === 'custom' && <span className="ad-custom" title="A mix that is not one of the standard levels">Custom</span>}
    </div>
  );
}
function CrudBits({ crud, onToggle, disabled, viewOnly }) {
  return (
    <div className="ad-bits">
      {OPS.map(o => {
        const off = viewOnly && o.key !== 'read';
        return (
          <button key={o.key} type="button" className={`ad-bit${crud?.[o.key] ? ' on' : ''}`} disabled={disabled || off}
            title={off ? `${o.label}: not used on this page` : `${o.label}: ${crud?.[o.key] ? 'on' : 'off'}`} onClick={() => onToggle(o.key)}>{o.short}</button>
        );
      })}
    </div>
  );
}
const Badge = ({ level }) => <span className={`ad-badge lv-${level}`}>{level === 'none' ? '—' : level === 'custom' ? 'Custom' : LEVELS.find(l => l[0] === level)[1]}</span>;

function AccessDenied() {
  return (
    <div className="ad-denied"><Lock size={36} /><b>Admin only</b><span>This page is restricted to the system administrator.</span></div>
  );
}

/* ─── Page ─── */
export default function AdminPage() {
  const { isAdmin } = usePermissions();
  const { permissions, updatePermissions, reloadPermissions, loading } = usePermissionsContext();

  const [users, setUsers] = useState(() => permsToUsers(permissions));
  const [base, setBase] = useState(() => permsToUsers(permissions));       // last saved state
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('people');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);                              // { ok, text, issues? }
  const [adding, setAdding] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'none' });
  const [addErr, setAddErr] = useState('');
  const [reloading, setReloading] = useState(false);

  const baseSig = useMemo(() => new Map(base.map(u => [u.email, sig(u)])), [base]);
  const changed = useMemo(() => {
    const now = new Set(users.map(u => u.email));
    const edited = users.filter(u => baseSig.get(u.email) !== sig(u)).map(u => u.email);
    const removed = base.filter(u => !now.has(u.email)).map(u => u.email);
    return { edited: new Set(edited), removed, count: edited.length + removed.length };
  }, [users, base, baseSig]);
  const dirty = changed.count > 0;

  // Fresh permissions from Excel → reset the editor (unless there are unsaved edits)
  useEffect(() => {
    if (loading || dirty) return;
    const u = permsToUsers(permissions); setUsers(u); setBase(u);
  }, [loading, permissions]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected && users.length) setSelected((users.find(u => u.email !== admin) || users[0]).email);
  }, [users, selected]);
  useEffect(() => {
    if (!dirty) return;
    const h = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (!isAdmin) return <AccessDenied />;

  /* ── Excel column check ── */
  const seen = seenPermissionColumns();
  const missingCols = seen ? PERMISSION_COLUMNS.filter(c => !seen.has(c)) : [];
  const missingPages = [...new Set(missingCols.filter(c => !['Email', 'Name'].includes(c))
    .map(c => Object.entries(PAGE_PREFIX).find(([, pre]) => c.startsWith(pre) && /^(Create|Read|Update|Delete)$/.test(c.slice(pre.length)))?.[0])
    .filter(Boolean))];

  /* ── Mutators (draft only) ── */
  const patch = (email, fn) => { setResult(null); setUsers(us => us.map(u => (u.email === email ? fn(u) : u))); };
  const setLevel = (email, page, level) => patch(email, u => ({ ...u, crud: { ...u.crud, [page]: { ...LEVEL_CRUD[level] } } }));
  const toggleBit = (email, page, op) => patch(email, u => {
    const c = { ...u.crud[page], [op]: !u.crud[page][op] };
    if (op !== 'read' && c[op]) c.read = true;                                   // C / U / D need Read
    if (op === 'read' && !c.read) { c.create = false; c.update = false; c.delete = false; }   // no Read → nothing
    return { ...u, crud: { ...u.crud, [page]: c } };
  });
  const applyRole = (email, role) => patch(email, u => ({ ...u, crud: roleCrud(role) }));
  const cycle = (email, page) => {
    const u = users.find(x => x.email === email); const lv = levelOf(u.crud[page]);
    const seq = PAGE[page].viewOnly ? ['none', 'view'] : ['none', 'view', 'edit', 'full'];
    const next = seq[(seq.indexOf(lv) + 1) % seq.length] || 'none';
    setLevel(email, page, next);
  };
  const removeUser = email => {
    const u = users.find(x => x.email === email);
    if (!window.confirm(`Remove ${u.name} (${u.email})? They lose access to every page once saved.`)) return;
    setUsers(us => us.filter(x => x.email !== email)); setSelected(null); setResult(null);
  };
  const addUser = () => {
    setAddErr('');
    const em = newUser.email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setAddErr('Enter a valid email address.'); return; }
    if (users.some(u => u.email === em)) { setAddErr('This person is already in the list.'); return; }
    const role = ROLES.find(r => r.id === newUser.role) || ROLES.at(-1);
    const u = { email: em, name: newUser.name.trim() || em.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, m => m.toUpperCase()), crud: roleCrud(role) };
    setUsers(us => [...us, u]); setSelected(em); setAdding(false); setNewUser({ email: '', name: '', role: 'none' }); setResult(null);
  };
  const discard = () => { setUsers(base); setResult(null); if (!base.some(u => u.email === selected)) setSelected(null); };

  /* ── Save + verify ── */
  const save = async () => {
    setSaving(true); setResult(null);
    const intended = users;
    const r = await updatePermissions(usersToPerms(intended));
    if (r && r.ok === false) {
      setSaving(false);
      setResult({ ok: false, text: `Not saved: ${r.error?.message || 'the Save Permissions flow failed'}. Your changes are still here — try again.` });
      return;
    }
    // Read back from Excel and compare every switch
    let issues = [];
    try {
      const fresh = permsToUsers(await reloadPermissions());
      const byEmail = new Map(fresh.map(u => [u.email, u]));
      const cols = new Set();
      intended.forEach(u => {
        const f = byEmail.get(u.email);
        if (!f) { issues.push(`${u.name} was not found in PermissionsTable after saving`); return; }
        PAGES.forEach(p => OPS.forEach(o => {
          if (!!u.crud[p.key][o.key] !== !!f.crud[p.key][o.key]) cols.add(`${PAGE_PREFIX[p.key]}${o.label}`);
        }));
      });
      if (cols.size) issues.push(`These columns did not keep their values: ${[...cols].join(', ')}. Add them to PermissionsTable and map them in the "Save Permissions" flow (Excel setup tab).`);
      setBase(fresh); setUsers(fresh);
    } catch {
      setBase(intended);
      issues = ['Saved, but could not read PermissionsTable back to confirm. Use "Reload from Excel" to check.'];
    }
    setSaving(false);
    setResult(issues.length ? { ok: false, text: 'Saved with problems', issues } : { ok: true, text: `Saved and confirmed in Excel · ${new Date().toLocaleTimeString()}` });
  };
  const reload = async () => {
    if (dirty && !window.confirm('Discard unsaved changes and reload from Excel?')) return;
    setReloading(true);
    try { const u = permsToUsers(await reloadPermissions()); setUsers(u); setBase(u); setResult(null); }
    catch (e) { setResult({ ok: false, text: `Could not reload: ${e.message}` }); }
    finally { setReloading(false); }
  };

  const others = users.filter(u => u.email !== admin);
  const withAccess = others.filter(u => summary(u).any).length;
  const q = search.trim().toLowerCase();
  const listed = users.filter(u => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
  const sel = users.find(u => u.email === selected);
  const copy = (text, label) => { try { navigator.clipboard.writeText(text); setResult({ ok: true, text: `${label} copied` }); } catch { /* ignore */ } };

  return (
    <div className="ad-page">
      {/* header */}
      <div className="ad-head">
        <div className="ad-head-l">
          <span className="ad-head-icon"><ShieldCheck size={20} /></span>
          <div>
            <h1>User Access Control</h1>
            <p>Who can see and change each tracker. Changes are saved together to the Admin Panel workbook (PermissionsTable).</p>
          </div>
        </div>
        <div className="ad-head-r">
          {saving ? <span className="ad-status saving"><RefreshCw size={13} className="ad-spin" />Saving and checking…</span>
            : dirty ? <span className="ad-status dirty">{changed.count} unsaved change{changed.count === 1 ? '' : 's'}</span>
              : <span className="ad-status ok"><CheckCircle2 size={13} />All saved</span>}
          <button type="button" className="btn btn-outline btn-sm ad-ib" onClick={reload} disabled={saving || reloading} title="Reload from Excel"><RefreshCw size={13} className={reloading ? 'ad-spin' : ''} />Reload</button>
          <button type="button" className="btn btn-outline btn-sm ad-ib" onClick={discard} disabled={!dirty || saving}><Undo2 size={13} />Discard</button>
          <button type="button" className="btn btn-cta btn-sm ad-ib" onClick={save} disabled={!dirty || saving}><Save size={13} />Save changes</button>
        </div>
      </div>

      {result && (
        <div className={`ad-banner ${result.ok ? 'ok' : 'bad'}`}>
          {result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <div><b>{result.text}</b>{result.issues?.map((x, i) => <div key={i}>{x}</div>)}</div>
          <button type="button" className="ad-x" onClick={() => setResult(null)} aria-label="Close"><X size={14} /></button>
        </div>
      )}
      {missingPages.length > 0 && (
        <div className="ad-banner warn">
          <AlertTriangle size={16} />
          <div><b>PermissionsTable is missing {missingCols.length} column{missingCols.length === 1 ? '' : 's'}</b>
            <div>Access to {missingPages.map(k => PAGE[k]?.label || k).join(', ')} cannot be saved until they are added.</div></div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setTab('setup')}>Fix in Excel setup</button>
        </div>
      )}

      {/* stats */}
      <div className="ad-stats">
        <div><span>People</span><b>{others.length}</b></div>
        <div><span>With access</span><b className="ok">{withAccess}</b></div>
        <div><span>No access yet</span><b className={others.length - withAccess ? 'bad' : ''}>{others.length - withAccess}</b></div>
        <div><span>Pages controlled</span><b>{PAGES.length}</b></div>
      </div>

      <div className="lv-tabs ad-tabs">
        {[['people', 'By person', Users], ['matrix', 'Access matrix', Grid3x3], ['setup', 'Excel setup', Settings2]].map(([k, l, I]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={13} />{l}</button>
        ))}
      </div>

      {/* ── By person ── */}
      {tab === 'people' && (
        <div className="ad-people">
          <aside className="ad-list">
            <div className="ad-list-tools">
              <div className="ad-search"><Search size={14} /><input placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)} /></div>
              <button type="button" className="btn btn-primary btn-sm ad-ib" onClick={() => { setAdding(a => !a); setAddErr(''); }}><UserPlus size={13} />Add</button>
            </div>
            {adding && (
              <div className="ad-add">
                <input className="form-input" placeholder="Email address *" value={newUser.email} onChange={e => setNewUser(n => ({ ...n, email: e.target.value }))} autoFocus />
                <input className="form-input" placeholder="Display name" value={newUser.name} onChange={e => setNewUser(n => ({ ...n, name: e.target.value }))} />
                <select className="form-input" value={newUser.role} onChange={e => setNewUser(n => ({ ...n, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r.id} value={r.id}>Start as: {r.label}</option>)}
                </select>
                {addErr && <div className="lv-req">{addErr}</div>}
                <div className="ad-add-btns">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={addUser}>Add person</button>
                </div>
              </div>
            )}
            <div className="ad-list-items">
              {listed.map(u => {
                const sm = summary(u); const isAdm = u.email === admin;
                return (
                  <button key={u.email} type="button" className={`ad-person${selected === u.email ? ' sel' : ''}`} onClick={() => setSelected(u.email)}>
                    <span className={`ad-av${isAdm ? ' admin' : ''}`}>{initials(u.name)}</span>
                    <span className="ad-person-main">
                      <b>{u.name}{changed.edited.has(u.email) && <i className="ad-dot" title="Unsaved changes" />}</b>
                      <em>{u.email}</em>
                      <span className="ad-person-sum">
                        {isAdm ? <span className="ad-badge lv-full">Admin · everything</span> : !sm.any ? <span className="ad-badge lv-none">No access</span> : <>
                          {sm.full > 0 && <span className="ad-badge lv-full">{sm.full} full</span>}
                          {sm.edit > 0 && <span className="ad-badge lv-edit">{sm.edit} edit</span>}
                          {sm.view > 0 && <span className="ad-badge lv-view">{sm.view} view</span>}
                        </>}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!listed.length && <div className="lv-empty">No one matches.</div>}
              {changed.removed.length > 0 && <div className="ad-removed">{changed.removed.length} removed — save to apply</div>}
            </div>
          </aside>

          <section className="ad-editor">
            {!sel ? <div className="lv-empty">Select a person.</div> : (() => {
              const isAdm = sel.email === admin;
              const warns = isAdm ? [] : warningsFor(sel);
              return (
                <>
                  <div className="ad-ed-head">
                    <span className={`ad-av lg${isAdm ? ' admin' : ''}`}>{initials(sel.name)}</span>
                    <div className="ad-ed-name">
                      {isAdm ? <b>{sel.name}</b> : <input className="ad-name-input" value={sel.name} onChange={e => patch(sel.email, u => ({ ...u, name: e.target.value }))} title="Display name — used for owners and email notifications" />}
                      <span>{sel.email}</span>
                    </div>
                    {!isAdm && <button type="button" className="btn btn-outline btn-sm ad-ib ad-danger" onClick={() => removeUser(sel.email)}><Trash2 size={13} />Remove</button>}
                  </div>

                  {isAdm ? (
                    <div className="ad-banner info"><Info size={16} /><div><b>Administrator</b><div>Always has full access to every page and this panel. Set in src/config/permissions.js (ADMIN_EMAIL).</div></div></div>
                  ) : <>
                    <div className="ad-roles">
                      <span>Apply a role</span>
                      {ROLES.map(r => (
                        <button key={r.id} type="button" className="ad-role" title={r.desc} onClick={() => applyRole(sel.email, r)}>{r.label}</button>
                      ))}
                    </div>
                    {warns.map((w, i) => <div key={i} className="ad-banner warn sm"><AlertTriangle size={14} /><div>{w}</div></div>)}
                  </>}

                  {GROUPS.map(g => (
                    <div key={g.id} className="ad-group">
                      <div className="ad-group-label">{g.label}</div>
                      {g.pages.map(p => {
                        const c = isAdm ? LEVEL_CRUD.full : sel.crud[p.key];
                        const lv = levelOf(c);
                        const miss = missingPages.includes(p.key);
                        return (
                          <div key={p.key} className={`ad-row${lv === 'none' ? ' off' : ''}`}>
                            <span className="ad-row-icon"><p.Icon size={16} /></span>
                            <div className="ad-row-main">
                              <b>{p.label}{miss && <span className="ad-miss" title="Columns missing in PermissionsTable — cannot be saved yet">not in Excel</span>}</b>
                              <span>{p.desc}</span>
                            </div>
                            <LevelSeg value={lv} viewOnly={p.viewOnly} disabled={isAdm} onChange={l => setLevel(sel.email, p.key, l)} />
                            <CrudBits crud={c} viewOnly={p.viewOnly} disabled={isAdm} onToggle={op => toggleBit(sel.email, p.key, op)} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div className="ad-legend">
                    <span><b>View</b> = Read</span><span><b>Edit</b> = Create + Read + Update</span><span><b>Full</b> = all four, incl. Delete</span>
                    <span>C / U / D switch Read on automatically; Read off removes everything.</span>
                  </div>
                </>
              );
            })()}
          </section>
        </div>
      )}

      {/* ── Matrix ── */}
      {tab === 'matrix' && (
        <div className="ad-matrix-wrap card">
          <div className="ad-matrix-note">Click a cell to step through <Badge level="none" /> → <Badge level="view" /> → <Badge level="edit" /> → <Badge level="full" />. Use “By person” for individual C R U D switches.</div>
          <div className="ad-matrix-scroll">
            <table className="ad-matrix">
              <thead>
                <tr><th className="ad-sticky" rowSpan={2}>Person</th>{GROUPS.map(g => <th key={g.id} colSpan={g.pages.length} className="ad-gh">{g.label}</th>)}</tr>
                <tr>{PAGES.map(p => <th key={p.key} title={p.desc}><p.Icon size={13} /><span>{p.label}</span></th>)}</tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isAdm = u.email === admin;
                  return (
                    <tr key={u.email} className={changed.edited.has(u.email) ? 'dirty' : ''}>
                      <td className="ad-sticky"><button type="button" className="ad-mx-person" onClick={() => { setSelected(u.email); setTab('people'); }}>
                        <span className={`ad-av sm${isAdm ? ' admin' : ''}`}>{initials(u.name)}</span><span><b>{u.name}</b><em>{u.email}</em></span></button></td>
                      {PAGES.map(p => {
                        const lv = isAdm ? 'full' : levelOf(u.crud[p.key]);
                        return (
                          <td key={p.key}>
                            <button type="button" className="ad-cell" disabled={isAdm} title={`${u.name} · ${p.label}: ${lv}`} onClick={() => cycle(u.email, p.key)}><Badge level={lv} /></button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Excel setup ── */}
      {tab === 'setup' && (
        <div className="ad-setup">
          <div className="card ad-setup-card">
            <div className="ad-setup-title">PermissionsTable columns <span>{PERMISSION_COLUMNS.length} columns · Admin Panel.xlsx</span></div>
            <p>Every person is one row. Each page has four columns (Create, Read, Update, Delete) holding <code>true</code> / <code>false</code>.
              {seen ? ` ${PERMISSION_COLUMNS.length - missingCols.length} of ${PERMISSION_COLUMNS.length} found in the last load.` : ' Column check runs after permissions load from Excel.'}</p>
            <div className="ad-setup-btns">
              <button type="button" className="btn btn-outline btn-sm ad-ib" onClick={() => copy(PERMISSION_COLUMNS.join('\t'), 'Header row')}><Copy size={13} />Copy header row (paste into Excel)</button>
              {missingCols.length > 0 && <button type="button" className="btn btn-outline btn-sm ad-ib" onClick={() => copy(missingCols.join('\t'), 'Missing columns')}><Copy size={13} />Copy {missingCols.length} missing</button>}
            </div>
            <div className="ad-cols">
              <div className="ad-col-group">
                <b><Users size={12} />Person</b>
                {['Email', 'Name'].map(c => <span key={c} className={`ad-col${seen && !seen.has(c) ? ' miss' : seen ? ' ok' : ''}`}>{c}</span>)}
              </div>
              {PAGES.map(p => (
                <div key={p.key} className="ad-col-group">
                  <b><p.Icon size={12} />{p.label}</b>
                  {OPS.map(o => { const c = `${PAGE_PREFIX[p.key]}${o.label}`; return <span key={c} className={`ad-col${seen && !seen.has(c) ? ' miss' : seen ? ' ok' : ''}`}>{c}</span>; })}
                </div>
              ))}
            </div>
          </div>
          <div className="card ad-setup-card">
            <div className="ad-setup-title">Power Automate</div>
            <ol className="ad-steps">
              <li><b>Excel:</b> add any missing columns to <code>PermissionsTable</code> (red above). Fill existing rows with <code>false</code>.</li>
              <li><b>Get Permissions flow:</b> no change — it returns every column of the table.</li>
              <li><b>Save Permissions flow:</b> inside “Apply to each”, the <i>Add a row into a table</i> step must write every column. Easiest: switch its row input to an expression and use <code>items('Apply_to_each')</code> — new pages then save without touching the flow again. Otherwise map each new column by hand.</li>
              <li><b>Check:</b> change one switch here → <i>Save changes</i>. The panel reads PermissionsTable back and lists any column that did not keep its value.</li>
            </ol>
            <div className="ad-muted">Flow URLs live in <code>src/services/permissionsApi.js</code>. Founder's Desk needs View on Dashboard and Finance as well; Finance view also shows amounts in the Client and Consultant directories.</div>
          </div>
        </div>
      )}
    </div>
  );
}
