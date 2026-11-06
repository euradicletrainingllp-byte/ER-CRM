/**
 * Client Directory → Clean-up (admin only)
 * =========================================
 * Lists names already typed in the trackers that do not match the master lists:
 *   1. client names not in the Client Directory   → "Add as client" (adds one row)
 *                                                   → "Fix spelling everywhere" (edits tracker rows — switch, OFF by default)
 *   2. BD Client POCs not in the client's contacts → "Add contact" (adds one row)
 *   3. Engagement Calendar consultants not in the Consultant Directory → listed only (no quick-add)
 * "Fix spelling everywhere" reads every tracker fresh, shows every row it will change (old → new),
 * needs "CONFIRM" typed, then changes ONLY the client-name field of those rows, one row at a time,
 * through each tracker's normal update path. It never writes an empty value.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMsal } from '@azure/msal-react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions.js';
import {
  getAllEngagementsCached, getOpsChecklist, getContentDevTracker, getSolutionTracker,
  updateEngagementRow, updateOpsRow, _callFlow as callFlow,
} from '../services/api.js';
import { runForIndex } from '../services/syncWithEC.js';
import { getLeads, getVendorServices } from '../services/leadsVendorsApi.js';
import { getPOs, poConfigured } from '../services/poApi.js';
import FLOW_URLS from '../config/powerAutomate.js';
import {
  useDirectory, QuickAddContactModal,
} from './pickers/index.jsx';
import {
  findClient, nearDuplicates, nameKey, isNotAClient, findContact, findConsultant, quickAddClient, ensureDirectory,
} from '../services/directoryCache.js';
import { CONSULTANT_EXTRAS } from '../config/clientAliases.js';
import '../styles/pickers.css';

const txt = v => String(v ?? '').trim();

/* Client-name fields per tracker: how to read them, label rows, and change ONE field.
   Each fix sends only the row key + that one column. Columns left out of an update reach the flow as null,
   and "Update a row" leaves those cells unchanged — so no other cell of the row can be blanked or altered. */
const need = (v, what) => { const k = txt(v); if (!k) throw new Error(`row has no ${what}`); return k; };
const SOURCES = [
  { id: 'ec', label: 'Engagement Calendar', field: 'Company', on: () => true,
    load: async () => getAllEngagementsCached({ force: true }), get: r => r.company,
    rowLabel: r => `Index ${r.engagementKey || '—'} · ${r.egId || ''} · ${r.topic || ''}`,
    fix: (r, name) => { const key = need(r.engagementKey, 'Index'); return runForIndex(key, () => updateEngagementRow(r.egId, r.sno, { company: name }, key)); } },
  { id: 'bd', label: 'BD / Solution Tracker', field: 'Client Name', on: () => !!FLOW_URLS.SOLUTION_CRUD,
    load: () => getSolutionTracker(), get: r => r.clientName,
    rowLabel: r => `${r.proposalId} ${r.proposalVersion || ''} · row ${r.sno}${r.solutionTopic ? ` · ${r.solutionTopic}` : ''}`,
    fix: (r, name) => callFlow('SOLUTION_CRUD', { action: 'update', sno: need(r.sno, 'S No'), 'Client Name': name }) },
  { id: 'ops', label: 'Ops Checklist', field: 'Company', on: () => !!FLOW_URLS.OPS_CHECKLIST_CRUD,
    load: () => getOpsChecklist(), get: r => r.company,
    rowLabel: r => `Index ${r.engagementKey || '—'} · ${r.topic || ''}`,
    fix: (r, name) => updateOpsRow(r.sno, { company: name }, need(r.engagementKey, 'Index')) },
  { id: 'cdt', label: 'Content Development', field: 'Client', on: () => !!FLOW_URLS.CONTENT_DEV_CRUD,
    load: () => getContentDevTracker(), get: r => r.client,
    rowLabel: r => `Index ${r.engagementKey || '—'} · ${r.topic || ''}`,
    fix: (r, name) => { const key = need(r.engagementKey, 'Index'); return callFlow('CONTENT_DEV_CRUD', { action: 'update', sno: key, Index: key, Client: name }); } },
  { id: 'leads', label: 'Lead Tracker', field: 'Company', on: () => !!FLOW_URLS.LEADS_CRUD,
    load: () => getLeads(), get: r => r.company,
    rowLabel: r => `${r.leadId} · ${r.status || ''}`,
    fix: (r, name) => callFlow('LEADS_CRUD', { action: 'update', sno: need(r.leadId, 'Lead ID'), Company: name }) },
  { id: 'vendors', label: 'Vendor Services', field: 'Client', on: () => !!FLOW_URLS.VENDOR_CRUD,
    load: () => getVendorServices(), get: r => r.client,
    rowLabel: r => `${r.serviceId} · ${r.vendorName || ''}`,
    fix: (r, name) => callFlow('VENDOR_CRUD', { action: 'update', sno: need(r.serviceId, 'Service ID'), Client: name }) },
  { id: 'po', label: 'PO Tracker', field: 'Client', on: () => poConfigured(),
    load: () => getPOs(), get: r => r.client,
    rowLabel: r => `${r.poId} · ${r.poNumber || ''}`,
    fix: (r, name) => callFlow('PO_CRUD', { action: 'update', sno: need(r.poId, 'PO ID'), Client: name }) },
];

async function loadAll() {
  const on = SOURCES.filter(s => s.on());
  const res = await Promise.allSettled(on.map(s => s.load()));
  const out = {}, failed = [];
  on.forEach((s, i) => {
    if (res[i].status === 'fulfilled') out[s.id] = Array.isArray(res[i].value) ? res[i].value : [];
    else failed.push(`${s.label}: ${res[i].reason?.message || res[i].reason}`);
  });
  return { rows: out, failed };
}

function Switch({ on, onChange, label }) {
  return (
    <label className="dc-switch">
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} />
      <span className="dc-knob" aria-hidden="true" />{label}
    </label>
  );
}

export default function DirectoryCleanup() {
  const { isAdmin } = usePermissions();
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const navigate = useNavigate();
  const d = useDirectory();
  const [data, setData] = useState(null);       // { rows: {ec:[], …}, failed: [] }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fixOn, setFixOn] = useState(false);    // "Fix spelling everywhere" switch — OFF every time the page opens
  const [target, setTarget] = useState({});     // typed name key → chosen directory client name
  const [fix, setFix] = useState(null);         // { from, to } while the preview is open
  const [contactFor, setContactFor] = useState(null);
  const [msg, setMsg] = useState('');

  const scan = async () => {
    setBusy(true); setErr('');
    try { await ensureDirectory(); setData(await loadAll()); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (isAdmin) scan(); }, [isAdmin]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 1 · client names not in the directory */
  const unmatched = useMemo(() => {
    if (!data || !d.ready.clients) return [];
    const map = new Map();
    for (const s of SOURCES) for (const r of data.rows[s.id] || []) {
      const n = txt(s.get(r)); if (!n || isNotAClient(n)) continue;
      const k = nameKey(n); if (!k) continue;
      const hit = findClient(n, d);                       // spelling variant / case difference of a directory name
      if (hit && (hit.name === n || (txt(hit.legalName) && k === nameKey(hit.legalName)))) continue;   // exact name or legal entity
      const cur = map.get(k) || { name: n, key: k, where: {}, total: 0, match: hit?.name || '', exactish: !!hit };
      cur.where[s.label] = (cur.where[s.label] || 0) + 1; cur.total++;
      map.set(k, cur);
    }
    return [...map.values()].map(u => ({ ...u, suggestions: u.match ? [u.match] : nearDuplicates(u.name, d).map(c => c.name) }))
      .sort((a, b) => (b.match ? 1 : 0) - (a.match ? 1 : 0) || b.total - a.total || a.name.localeCompare(b.name));
  }, [data, d]);

  /* 2 · BD POCs not in the client's contacts */
  const pocs = useMemo(() => {
    if (!data || !d.ready.clients) return [];
    const map = new Map();
    for (const r of data.rows.bd || []) {
      const poc = txt(r.clientPoc); if (!poc) continue;
      const c = findClient(r.clientName, d);
      if (c && findContact(c, { name: poc, email: r.clientPocEmail }, d)) continue;
      const k = `${nameKey(r.clientName)}|${nameKey(poc)}`;
      const cur = map.get(k) || { client: txt(r.clientName), dirClient: c, poc, email: '', phone: '', designation: '', ids: new Set() };
      cur.email ||= txt(r.clientPocEmail); cur.phone ||= txt(r.contactNumber); cur.designation ||= txt(r.clientPocDesignation);
      cur.ids.add(r.proposalId); map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => a.client.localeCompare(b.client) || a.poc.localeCompare(b.poc));
  }, [data, d]);

  /* 3 · EC consultants not in the Consultant Directory */
  const cons = useMemo(() => {
    if (!data || !d.ready.consultants) return [];
    const extras = new Set(CONSULTANT_EXTRAS.map(nameKey));
    const map = new Map();
    for (const r of data.rows.ec || []) for (const n of [r.consultant1, r.consultant2].map(txt).filter(Boolean)) {
      if (findConsultant(n, d) || extras.has(nameKey(n))) continue;
      const k = nameKey(n); const cur = map.get(k) || { name: n, total: 0 };
      cur.total++; map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [data, d]);

  if (!isAdmin) return <div className="card" style={{ padding: 20 }}>Clean-up is available to the CRM admin only.</div>;

  const addClient = async u => {
    setMsg('');
    try { const { client, created } = await quickAddClient({ name: u.name, note: 'Added from Clean-up (name already used in the trackers)' }, me);
      setMsg(created ? `✓ ${client.name} added to the Client Directory (${client.clientId})` : `${client.name} is already in the directory`); }
    catch (e) { setMsg('❌ ' + (e.message || e)); }
  };

  return (
    <div className="tracker-scroll"><div className="card dc-card">
      <div className="dc-head">
        <div>
          <div className="dc-title">Names that don't match the directories</div>
          <div className="dc-sub">Only adds rows unless “Fix spelling everywhere” is switched on. Each fix shows every row first and needs CONFIRM.</div>
        </div>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={scan}>{busy ? 'Reading trackers…' : '↻ Re-check'}</button>
      </div>
      {err && <div className="ep-err">❌ {err}</div>}
      {data?.failed?.length > 0 && <div className="ep-warn">Could not read: {data.failed.join(' · ')}. Those trackers are left out.</div>}
      {msg && <div className={msg.startsWith('❌') ? 'ep-err' : 'dc-ok'}>{msg}</div>}

      <div className="dc-sec">
        <div className="dc-sec-head">
          <h4>1 · Client names not in the Client Directory <span className="dc-count">{unmatched.length}</span></h4>
          <Switch on={fixOn} onChange={setFixOn} label="Fix spelling everywhere" />
        </div>
        {fixOn && <div className="ep-warn">Switch is on: “Fix…” edits existing tracker rows (client name only). Excel version history can restore a file if needed.</div>}
        {!busy && data && !unmatched.length && <div className="dc-empty">Every client name matches the directory.</div>}
        {unmatched.length > 0 && (
          <div className="table-wrap"><table className="lv-table dc-table">
            <thead><tr><th>Name as typed</th><th>Used in</th><th>Directory name</th><th /></tr></thead>
            <tbody>{unmatched.map(u => {
              const to = target[u.key] ?? u.match ?? '';
              return (
                <tr key={u.key}>
                  <td><b>{u.name}</b>{u.match ? <div className="dc-hint">spelling variant of {u.match}</div>
                    : u.suggestions.length > 0 && <div className="dc-hint">looks like {u.suggestions.join(', ')}</div>}</td>
                  <td className="dc-where">{Object.entries(u.where).map(([w, n]) => `${w} ${n}`).join(' · ')}</td>
                  <td>
                    <select className="form-input dc-sel" value={to} onChange={e => setTarget(t => ({ ...t, [u.key]: e.target.value }))}>
                      <option value="">— not in directory —</option>
                      {[...new Set([...u.suggestions, ...d.clients.map(c => c.name)])].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                  <td className="dc-acts">
                    {!to && <button className="btn btn-outline btn-sm" onClick={() => addClient(u)}>Add as client</button>}
                    {fixOn && to && to !== u.name && (
                      <button className="btn btn-sm dc-fix" onClick={() => setFix({ from: u.name, key: u.key, to })}>Fix spelling → {to}</button>)}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      <div className="dc-sec">
        <h4>2 · BD Client POCs not in the client's contacts <span className="dc-count">{pocs.length}</span></h4>
        {pocs.length > 0 && (
          <div className="table-wrap"><table className="lv-table dc-table">
            <thead><tr><th>Client</th><th>POC</th><th>Email · phone · designation</th><th>Proposals</th><th /></tr></thead>
            <tbody>{pocs.map(p => (
              <tr key={p.client + p.poc}>
                <td>{p.client}{!p.dirClient && <div className="dc-hint">client not in directory</div>}</td>
                <td><b>{p.poc}</b></td>
                <td className="dc-where">{[p.email, p.phone, p.designation].filter(Boolean).join(' · ') || '—'}</td>
                <td className="dc-where">{[...p.ids].join(', ')}</td>
                <td className="dc-acts">{p.dirClient && <button className="btn btn-outline btn-sm" onClick={() => setContactFor(p)}>Add contact</button>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <div className="dc-sec">
        <h4>3 · Engagement Calendar consultants not in the Consultant Directory <span className="dc-count">{cons.length}</span></h4>
        <div className="dc-sub">Short names, team members or placeholders. Add full profiles in the Consultant Directory, or correct the name in the Engagement Calendar.</div>
        {cons.length > 0 && <div className="dc-chips">{cons.map(c => <span key={c.name} className="dc-chip">{c.name} <em>{c.total}</em></span>)}</div>}
        <button className="ep-link" onClick={() => navigate('/consultants')}>Open Consultant Directory ↗</button>
      </div>

      {fix && <FixModal fix={fix} onClose={done => { setFix(null); if (done) scan(); }} />}
      {contactFor && (
        <QuickAddContactModal client={contactFor.dirClient} initialName={contactFor.poc}
          initial={{ email: contactFor.email, mobile: contactFor.phone, designation: contactFor.designation }}
          onClose={() => setContactFor(null)}
          onSaved={c => { setContactFor(null); setMsg(`✓ ${c.fullName} saved to ${contactFor.dirClient.name}'s contacts${c.contactId ? ` (${c.contactId})` : ''}`); }} />
      )}
    </div></div>
  );
}

/* Preview every row → typed CONFIRM → change one field per row, one row at a time. */
function FixModal({ fix, onClose }) {
  const [plan, setPlan] = useState(null);       // [{ src, row, label, old }]
  const [failed, setFailed] = useState([]);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState({});         // index → 'ok' | error text
  const [err, setErr] = useState('');
  const to = txt(fix.to);

  useEffect(() => {
    (async () => {
      try {
        const { rows, failed: f } = await loadAll();   // fresh read of every tracker
        const list = [];
        for (const s of SOURCES) for (const r of rows[s.id] || []) {
          const v = txt(s.get(r));
          if (v && nameKey(v) === fix.key && v !== to) list.push({ src: s, row: r, label: s.rowLabel(r), old: v });
        }
        setPlan(list); setFailed(f);
      } catch (e) { setErr(e.message || String(e)); }
    })();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (typed !== 'CONFIRM' || !to) return;
    setRunning(true);
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      try { await p.src.fix(p.row, to); setDone(x => ({ ...x, [i]: 'ok' })); }
      catch (e) { setDone(x => ({ ...x, [i]: e.message || String(e) })); }
    }
    setRunning(false);
  };
  const finished = plan && Object.keys(done).length === plan.length && plan.length > 0;
  const okCount = Object.values(done).filter(v => v === 'ok').length;

  return createPortal(
    <div className="modal-overlay ep-modal-overlay" onClick={e => { e.stopPropagation(); if (!running) onClose(finished); }}>
      <div className="modal-box dc-fixbox" onClick={e => e.stopPropagation()} role="dialog">
        <div className="modal-title">Fix spelling everywhere: “{fix.from}” → “{to}”</div>
        {err && <div className="ep-err">❌ {err}</div>}
        {!plan && !err && <div className="dc-sub">Reading every tracker fresh from Excel…</div>}
        {failed.length > 0 && <div className="ep-warn">Could not read: {failed.join(' · ')}. Rows there are not changed.</div>}
        {plan && !plan.length && <div className="dc-empty">No rows hold “{fix.from}” any more.</div>}
        {plan && plan.length > 0 && <>
          <div className="dc-sub">These {plan.length} row{plan.length === 1 ? '' : 's'} will change. Only the client-name field is changed; nothing else in the row is touched.</div>
          <div className="table-wrap dc-plan"><table className="lv-table dc-table">
            <thead><tr><th>Tracker</th><th>Row</th><th>Field</th><th>Now</th><th>Becomes</th><th /></tr></thead>
            <tbody>{plan.map((p, i) => (
              <tr key={i}>
                <td>{p.src.label}</td><td className="dc-where">{p.label}</td><td>{p.src.field}</td>
                <td><s>{p.old}</s></td><td><b>{to}</b></td>
                <td>{done[i] === 'ok' ? '✓' : done[i] ? <span className="ep-err" title={done[i]}>❌ {done[i]}</span> : ''}</td>
              </tr>))}</tbody>
          </table></div>
          {!finished && <>
            <label className="form-label" style={{ display: 'block', marginTop: 12 }}>Type CONFIRM to change these rows</label>
            <input className="form-input dc-confirm" value={typed} onChange={e => setTyped(e.target.value)} placeholder="CONFIRM" disabled={running} autoComplete="off" />
          </>}
          {finished && <div className={okCount === plan.length ? 'dc-ok' : 'ep-err'}>{okCount} of {plan.length} rows changed.{okCount < plan.length ? ' Rows marked ❌ were left as they were.' : ''}</div>}
        </>}
        <div className="ep-actions" style={{ marginTop: 14 }}>
          {plan && plan.length > 0 && !finished && (
            <button className="btn btn-cta" disabled={running || typed !== 'CONFIRM' || !to} onClick={run}>{running ? `Changing… ${Object.keys(done).length}/${plan.length}` : `Change ${plan.length} row${plan.length === 1 ? '' : 's'}`}</button>
          )}
          <button className="btn btn-outline" disabled={running} onClick={() => onClose(finished)}>{finished ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    </div>, document.body);
}
