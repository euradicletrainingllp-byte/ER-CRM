/**
 * Admin Panel → Departments tab.
 * Create departments and assign people (one or many departments per person).
 * Every change saves straight to Admin Panel.xlsx through the Admin CRUD flow.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building, Plus, Search, Trash2, Star, RefreshCw, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { isAdminCrudReady } from '../../services/adminApi';
import {
  fetchDepartments, nextId, createDepartment, updateDepartment, deleteDepartment,
  addMember, setMemberPrimary, removeMember,
} from '../../services/departmentsApi';

const initials = n => String(n || '?').split(/[\s.@]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

export default function DepartmentsTab({ users }) {
  const [depts, setDepts] = useState([]);
  const [members, setMembers] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState(null);                 // { ok, text }
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [draft, setDraft] = useState(null);             // editable copy of selected dept

  const ready = isAdminCrudReady();

  const load = async () => {
    if (!ready) return;
    setLoading(true); setMsg(null);
    try {
      const r = await fetchDepartments();
      setDepts(r.departments); setMembers(r.members);
      setSel(s => (r.departments.some(d => d.id === s) ? s : r.departments[0]?.id || null));
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dept = depts.find(d => d.id === sel) || null;
  useEffect(() => { setDraft(dept ? { ...dept } : null); }, [sel, depts]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Optimistic change: apply locally, run the save, roll back on failure. */
  const run = async (apply, save, rollback, okText) => {
    apply(); setBusy(b => b + 1);
    try { await save(); if (okText) setMsg({ ok: true, text: okText }); }
    catch (e) { rollback(); setMsg({ ok: false, text: `Not saved — ${e.message}` }); }
    finally { setBusy(b => b - 1); }
  };

  const countOf = id => members.filter(m => m.deptId === id).length;
  const userName = email => users.find(u => u.email === email)?.name || email.split('@')[0];
  const deptsOfUser = email => members.filter(m => m.email === email);
  const unassigned = users.filter(u => !members.some(m => m.email === u.email));

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return depts.filter(d => !q || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  }, [depts, search]);

  const addDept = () => {
    const name = newName.trim();
    if (!name) return;
    if (depts.some(d => d.name.toLowerCase() === name.toLowerCase())) { setMsg({ ok: false, text: `"${name}" already exists.` }); return; }
    const d = { id: nextId('DEP', depts.map(x => x.id), 2), name, description: '', head: '', active: true };
    run(() => { setDepts(x => [...x, d]); setSel(d.id); setNewName(''); setAdding(false); },
      () => createDepartment(d), () => setDepts(x => x.filter(y => y.id !== d.id)), `Department "${name}" added.`);
  };

  const saveDraft = () => {
    if (!draft || !dept) return;
    const next = { ...draft, name: draft.name.trim() || dept.name };
    if (JSON.stringify(next) === JSON.stringify(dept)) return;
    run(() => setDepts(x => x.map(y => (y.id === next.id ? next : y))), () => updateDepartment(next),
      () => setDepts(x => x.map(y => (y.id === dept.id ? dept : y))), 'Department saved.');
  };

  const removeDept = () => {
    if (!dept) return;
    const mine = members.filter(m => m.deptId === dept.id);
    if (!window.confirm(`Delete "${dept.name}"${mine.length ? ` and remove its ${mine.length} member link(s)` : ''}? This cannot be undone.`)) return;
    const snapD = depts, snapM = members;
    run(() => { setDepts(x => x.filter(y => y.id !== dept.id)); setMembers(x => x.filter(m => m.deptId !== dept.id)); setSel(null); },
      async () => { for (const m of mine) await removeMember(m.id); await deleteDepartment(dept.id); },
      () => { setDepts(snapD); setMembers(snapM); }, 'Department deleted.');
  };

  const toggleMember = u => {
    const existing = members.find(m => m.email === u.email && m.deptId === dept.id);
    if (existing) {
      run(() => setMembers(x => x.filter(m => m.id !== existing.id)), () => removeMember(existing.id),
        () => setMembers(x => [...x, existing]));
      return;
    }
    const m = { id: nextId('DM', members.map(x => x.id), 3), email: u.email, name: u.name, deptId: dept.id,
      primary: deptsOfUser(u.email).length === 0, addedOn: new Date().toISOString().slice(0, 10) };
    run(() => setMembers(x => [...x, m]), () => addMember(m, dept.name), () => setMembers(x => x.filter(y => y.id !== m.id)));
  };

  const makePrimary = u => {
    const mine = deptsOfUser(u.email);
    const target = mine.find(m => m.deptId === dept.id);
    if (!target || target.primary) return;
    const others = mine.filter(m => m.primary);
    run(() => setMembers(x => x.map(m => (m.email !== u.email ? m : { ...m, primary: m.id === target.id }))),
      async () => { for (const o of others) await setMemberPrimary(o.id, false); await setMemberPrimary(target.id, true); },
      () => setMembers(x => x.map(m => (m.email !== u.email ? m : { ...m, primary: mine.find(y => y.id === m.id)?.primary }))),
      `${userName(u.email)}'s primary department: ${dept.name}.`);
  };

  if (!ready) {
    return (
      <div className="ad-banner warn"><AlertTriangle size={16} /><div>
        <b>Departments need the Admin CRUD flow.</b> Paste its URL into <code>ADMIN_CRUD</code> in <code>src/config/powerAutomate.js</code>,
        and add <code>DepartmentTable</code> and <code>DeptMemberTable</code> to Admin Panel.xlsx.
      </div></div>
    );
  }

  return (
    <div>
      <div className="ad-dp-bar">
        <span className="ad-muted">{depts.length} departments · {members.length} assignments · {unassigned.length} people without a department</span>
        <span className="ad-dp-bar-r">
          {busy > 0 && <span className="ad-status saving"><RefreshCw size={12} className="ad-spin" />Saving…</span>}
          <button type="button" className="btn btn-outline btn-sm ad-ib" onClick={load} disabled={loading || busy > 0}>
            <RefreshCw size={13} className={loading ? 'ad-spin' : ''} />Reload
          </button>
        </span>
      </div>
      {msg && (
        <div className={`ad-banner sm ${msg.ok ? 'ok' : 'bad'}`}>
          {msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<div>{msg.text}</div>
          <button type="button" className="ad-x" onClick={() => setMsg(null)}><X size={14} /></button>
        </div>
      )}

      <div className="ad-people">
        <aside className="ad-list">
          <div className="ad-list-tools">
            <div className="ad-search"><Search size={14} /><input placeholder="Search departments" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <button type="button" className="btn btn-primary btn-sm ad-ib" onClick={() => setAdding(a => !a)}><Plus size={13} />Add</button>
          </div>
          {adding && (
            <div className="ad-add">
              <input className="form-input" placeholder="Department name *" value={newName} autoFocus
                onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDept()} />
              <div className="ad-add-btns">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(false)}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={addDept} disabled={!newName.trim()}>Add department</button>
              </div>
            </div>
          )}
          <div className="ad-list-items">
            {loading && !depts.length && <div className="ad-muted" style={{ padding: 10 }}>Loading…</div>}
            {!loading && !list.length && <div className="ad-muted" style={{ padding: 10 }}>No departments yet.</div>}
            {list.map(d => (
              <button key={d.id} type="button" className={`ad-person${d.id === sel ? ' sel' : ''}${d.active ? '' : ' ad-dp-off'}`} onClick={() => setSel(d.id)}>
                <span className="ad-av"><Building size={15} /></span>
                <span className="ad-person-main">
                  <b>{d.name}</b>
                  <em>{d.id} · {countOf(d.id)} {countOf(d.id) === 1 ? 'person' : 'people'}{d.active ? '' : ' · inactive'}</em>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="ad-editor">
          {!dept || !draft ? <div className="ad-muted">Select or add a department.</div> : (
            <>
              <div className="ad-ed-head">
                <span className="ad-av lg"><Building size={20} /></span>
                <div className="ad-ed-name">
                  <input className="ad-name-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} onBlur={saveDraft} />
                  <span>{dept.id} · {countOf(dept.id)} members</span>
                </div>
                <button type="button" className="btn btn-outline btn-sm ad-ib ad-danger" onClick={removeDept} disabled={busy > 0}><Trash2 size={13} />Delete</button>
              </div>

              <div className="ad-dp-fields">
                <label>Description
                  <input className="form-input" value={draft.description} placeholder="What this department covers"
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} onBlur={saveDraft} />
                </label>
                <label>Head
                  <select className="form-input" value={draft.head} onChange={e => { const head = e.target.value; setDraft(d => ({ ...d, head })); }} onBlur={saveDraft}>
                    <option value="">— None —</option>
                    {users.map(u => <option key={u.email} value={u.email}>{u.name} ({u.email})</option>)}
                  </select>
                </label>
                <label className="ad-dp-check">
                  <input type="checkbox" checked={draft.active} onChange={e => { const active = e.target.checked; setDraft(d => ({ ...d, active })); }} onBlur={saveDraft} />
                  Active
                </label>
              </div>

              <div className="ad-dp-sub">Members <span className="ad-muted">Tick to add or remove. ★ = primary department (one per person).</span></div>
              <div className="ad-dp-members">
                {users.map(u => {
                  const mine = deptsOfUser(u.email);
                  const link = mine.find(m => m.deptId === dept.id);
                  const others = mine.filter(m => m.deptId !== dept.id).map(m => depts.find(d => d.id === m.deptId)?.name || m.deptId);
                  return (
                    <div key={u.email} className={`ad-dp-row${link ? ' on' : ''}`}>
                      <label className="ad-dp-who">
                        <input type="checkbox" checked={!!link} onChange={() => toggleMember(u)} />
                        <span className="ad-av">{initials(u.name)}</span>
                        <span className="ad-person-main"><b>{u.name}</b><em>{u.email}</em></span>
                      </label>
                      <span className="ad-dp-also">{others.length ? `Also: ${others.join(', ')}` : ''}</span>
                      {link && (
                        <button type="button" className={`ad-dp-star${link.primary ? ' on' : ''}`} title={link.primary ? 'Primary department' : 'Make primary'}
                          onClick={() => makePrimary(u)}><Star size={14} /></button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
