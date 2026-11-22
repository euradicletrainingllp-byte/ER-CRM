/**
 * Ops Checklist v2 — programs (EngagementTable) × steps (OpsTaskTable) from the Step Library.
 * Rules: src/services/opsV2Engine.js · Data: src/services/opsV2Api.js · Emails: src/services/opsV2Notify.js
 * The old Ops Checklist page (/ops) stays until v2 is live.
 */
import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import KPICard from '../components/KPICard.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { getAuditUser } from '../services/auditLogger.js';
import { getAllEngagementsCached } from '../services/api.js';
import { fetchDepartments } from '../services/departmentsApi.js';
import { opsList, opsCreate, opsUpdate, opsDelete, isOpsV2Ready } from '../services/opsV2Api.js';
import {
  STATUSES, CHECKLIST_STATUSES, WAITING_ON, normStep, buildTimeline, datePatches, summarise, engagementFromEC,
  generateTasks, nextOpenAfter, ownersForDept, nextNumberId, seqBetween, splitEmails, joinEmails, todayISO, toISO, addDays, daysBetween,
  fmtTat, tatLabel, isValidTat, resolveOwners, stepColumns, stepPatch, STEP_SYNC_FIELDS, taskPatchFromStep, diffRow, listValues, stepFits, taskFromStep, isDone,
} from '../services/opsV2Engine.js';
import { notifyChecklistCreated, notifyStepDone } from '../services/opsV2Notify.js';
import { programsFrom, setOpsPrograms } from '../services/opsV2Data.js';
import OwnerChips, { DeptChips } from '../components/ops/OwnerChips.jsx';
import StepLibrary from '../components/ops/StepLibrary.jsx';
import '../styles/opsV2.css';

const s = v => String(v ?? '').trim();
const fmtD = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const keyOf = e => s(e['EC Index']);
// ListTable is optional until it is created in Excel: tried once per page load (no retry), then skipped.
let listsProbe = null;
const loadLists = () => (listsProbe ||= opsList('lists', { retries: 0 }).catch(() => null));
const STATUS_CLS = { 'Not Started': 'gray', 'In Progress': 'info', Waiting: 'yellow', Blocked: 'red', Done: 'green', NA: 'gray' };

async function pool(items, fn, n = 4) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = e instanceof Error ? e : new Error(String(e)); } }
  }));
  return out;
}

function DueCell({ t, today }) {
  if (!t.applicable) return <span className="ov2-muted">—</span>;
  if (t.done) return <span>{fmtD(t.due)}</span>;
  const d = daysBetween(today, t.due);
  return (
    <span className={t.overdue ? 'ov2-due late' : d <= 2 ? 'ov2-due soon' : 'ov2-due'}>
      {fmtD(t.due)}<small>{t.overdue ? ` · ${-d}d late` : d === 0 ? ' · today' : ` · in ${d}d`}</small>
      {t.shortLead && <span className="ov2-flag" title="Was already due when the checklist was opened">short lead</span>}
    </span>
  );
}

function OwnersEditor({ row, departments, members, onSave, disabled }) {
  return <OwnerChips emails={splitEmails(row['Owner Emails'])} departments={departments} members={members} disabled={disabled}
    emptyText={`No owner — add a member to the ${row['Owner Dept'] || 'department'} in Admin Panel`}
    onChange={(list, nameOf) => onSave({ 'Owner Emails': joinEmails(list), 'Owner Names': list.map(nameOf).join('; ') })} />;
}

function AddStepRow({ after, departments, onCancel, onAdd, saving }) {
  const [f, setF] = useState({ step: '', dept: s(after.row['Owner Dept']) || 'Operations', tat: '1' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <tr className="ov2-addform">
      <td colSpan={9}>
        <div className="ov2-addform-in">
          <input className="form-input wide" autoFocus placeholder={`New step after “${after.row.Step}”`} value={f.step} onChange={e => set('step', e.target.value)} />
          <DeptChips value={f.dept} departments={departments} onChange={v => set('dept', v)} />
          <label className="ov2-muted" title='"2" = 2 days before start, "+2" = 2 days after'>TAT <input className="form-input ov2-num" value={f.tat} onChange={e => set('tat', e.target.value)} placeholder="2 / +2" /> {isValidTat(f.tat) ? tatLabel(f.tat, after.anchor) : 'e.g. 2 or +2'}</label>
          <button className="btn btn-cta btn-sm" disabled={!f.step.trim() || !isValidTat(f.tat) || saving} onClick={() => onAdd(f)}>{saving ? 'Adding…' : 'Add step'}</button>
          <button className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function NewChecklistModal({ existing, onClose, onCreate, busy }) {
  const [ec, setEc] = useState(null); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  useEffect(() => { getAllEngagementsCached().then(setEc).catch(e => setErr(e.message || 'Could not read the Engagement Calendar')); }, []);
  const from = addDays(todayISO(), -7);
  const list = useMemo(() => (ec || [])
    .filter(e => s(e.engagementKey) && !existing.has(s(e.engagementKey)) && toISO(e.startDate) >= from)
    .filter(e => !q || `${e.company} ${e.topic} ${e.egId}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => toISO(a.startDate).localeCompare(toISO(b.startDate))).slice(0, 80), [ec, q, existing, from]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box ov2-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Open a checklist from the Engagement Calendar</div>
        <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <div className="ov2-modal-list">
          {err ? <div className="ov2-empty">{err}</div> : !ec ? <div className="ov2-empty">Loading engagements…</div>
            : !list.length ? <div className="ov2-empty">No upcoming engagements without a checklist.</div>
            : list.map(e => (
              <button key={e.engagementKey} type="button" className="ov2-ec" disabled={busy} onClick={() => onCreate(e)}>
                <b>{e.company}</b><span>{e.topic}</span>
                <small>{fmtD(toISO(e.startDate))} · {e.locationRaw || e.location || '—'} · {e.offering || e.serviceType || '—'} · {e.egId}</small>
              </button>
            ))}
        </div>
        <div className="ov2-modal-foot">{busy && <span className="ov2-muted">{busy}</span>}<button className="btn btn-outline btn-sm" onClick={onClose} disabled={!!busy}>Close</button></div>
      </div>
    </div>
  );
}

export default function OpsChecklistV2({ onRefreshed }) {
  const { canCreate, canUpdate, canDelete, email: myEmail } = usePermissions();
  const canEdit = canUpdate('ops');
  const [data, setData] = useState(null);          // { steps, engagements, tasks, departments, members }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('programs');
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('Active');
  const [expanded, setExpanded] = useState('');
  const [adding, setAdding] = useState('');        // TaskID the new step goes after
  const [busy, setBusy] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState('');
  const [propagate, setPropagate] = useState(false);
  const tasksRef = useRef([]);
  const today = todayISO();
  const actor = () => { const u = getAuditUser(); return { email: u.email || myEmail, name: u.name || '' }; };

  async function load() {
    setLoading(true); setError(null);
    try {
      const [steps, engagements, tasks, dm] = await Promise.all([opsList('steps'), opsList('engagements'), opsList('tasks'), fetchDepartments()]);
      tasksRef.current = tasks;
      const listRows = await loadLists();                            // null until ListTable exists
      setOpsPrograms(programsFrom(steps, engagements, tasks));   // Dashboard / Founder's Desk / 360 copy
      setData({ stepRows: steps, steps: steps.map(normStep).filter(x => x.id), engagements: engagements.filter(keyOf), tasks,
        departments: dm.departments, members: dm.members, listRows });
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { if (isOpsV2Ready()) load(); else setLoading(false); }, []);

  const stepsById = useMemo(() => Object.fromEntries((data?.steps || []).map(x => [x.id, x])), [data?.steps]);
  const lists = useMemo(() => {
    const st = data?.steps || []; const lr = data?.listRows;
    const uniq = a => [...new Set(a.filter(Boolean))];
    return {
      phases: listValues(lr, 'Phase', uniq(st.map(x => x.phase)).sort()),
      modes: listValues(lr, 'Mode', ['In-person', 'Virtual']),
      offerings: listValues(lr, 'Offering', uniq(st.map(x => x.offering).filter(x => x !== 'All')).concat(['Learning Journey', 'Workshop', 'Coaching']).filter((v, i, a) => a.indexOf(v) === i)),
      waitingOn: listValues(lr, 'Waiting On', WAITING_ON),
    };
  }, [data?.steps, data?.listRows]);
  const engByKey = useMemo(() => Object.fromEntries((data?.engagements || []).map(e => [keyOf(e), e])), [data?.engagements]);
  const timelines = useMemo(() => {
    const by = {};
    for (const t of data?.tasks || []) (by[s(t['EC Index'])] ||= []).push(t);
    return Object.fromEntries(Object.entries(engByKey).map(([k, e]) => [k, buildTimeline(by[k] || [], e, stepsById, today)]));
  }, [data?.tasks, engByKey, stepsById, today]);
  const sums = useMemo(() => Object.fromEntries(Object.entries(timelines).map(([k, tl]) => [k, summarise(tl, engByKey[k], today)])), [timelines, engByKey, today]);

  const programs = useMemo(() => (data?.engagements || [])
    .filter(e => statusF === 'All' || (statusF === 'Active' ? !['Closed', 'Delivered'].includes(s(e['Checklist Status'])) : s(e['Checklist Status']) === statusF))
    .filter(e => !q || `${e.Company} ${e.Topic} ${e['EG.ID']}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => toISO(a['Start Date']).localeCompare(toISO(b['Start Date']))), [data?.engagements, statusF, q]);
  useEffect(() => { if (programs.length && !programs.some(p => keyOf(p) === sel)) setSel(keyOf(programs[0])); }, [programs, sel]);

  const mine = useMemo(() => Object.entries(timelines).flatMap(([k, tl]) => tl
    .filter(t => t.applicable && !t.done && splitEmails(t.row['Owner Emails']).includes(myEmail))
    .map(t => ({ ...t, eng: engByKey[k] })))
    .sort((a, b) => (b.overdue - a.overdue) || a.due.localeCompare(b.due)), [timelines, engByKey, myEmail]);

  const kpi = useMemo(() => {
    const scope = tab === 'my' ? mine : Object.values(timelines).flat().filter(t => t.applicable && !t.done);
    const active = (data?.engagements || []).filter(e => !['Closed', 'Delivered'].includes(s(e['Checklist Status'])));
    return {
      programs: active.length, open: scope.length, overdue: scope.filter(t => t.overdue).length,
      week: scope.filter(t => t.due >= today && t.due <= addDays(today, 7)).length,
      atRisk: active.filter(e => sums[keyOf(e)]?.atRisk),
    };
  }, [tab, mine, timelines, data?.engagements, sums, today]);

  // ── Writes ──────────────────────────────────────────────────────────────────
  const commitTasks = next => { tasksRef.current = next; setData(d => ({ ...d, tasks: next })); };

  /** Recalculate dates for one program, keep them in state and save the changed ones. */
  async function syncDates(ecIndex, byId = stepsById) {
    const eng = engByKey[ecIndex] || data.engagements.find(e => keyOf(e) === ecIndex);
    const tl = buildTimeline(tasksRef.current.filter(t => s(t['EC Index']) === ecIndex), eng, byId, today);
    const patches = datePatches(tl);
    if (patches.length) {
      const map = Object.fromEntries(patches.map(p => [p.id, p.patch]));
      commitTasks(tasksRef.current.map(t => (map[s(t.TaskID)] ? { ...t, ...map[s(t.TaskID)] } : t)));
      const res = await pool(patches, p => opsUpdate('tasks', p.id, p.patch));
      if (res.some(r => r instanceof Error)) setMsg('Some due dates could not be saved — press ↺ and try again.');
    }
    return buildTimeline(tasksRef.current.filter(t => s(t['EC Index']) === ecIndex), eng, byId, today);
  }

  async function patchTask(row, patch, { doneNotify = false } = {}) {
    const id = s(row.TaskID); const before = tasksRef.current;
    const full = { ...patch, 'Updated On': today };
    commitTasks(before.map(t => (s(t.TaskID) === id ? { ...t, ...full } : t)));
    try {
      await opsUpdate('tasks', id, full);
      const ecIndex = s(row['EC Index']);
      const tl = (('Status' in patch) || ('Applicable' in patch) || ('Completed On' in patch) || ('TAT (days)' in patch)) ? await syncDates(ecIndex) : null;
      if (doneNotify && tl) {
        const nxt = nextOpenAfter(tl, id);
        notifyStepDone(engByKey[ecIndex], { ...row, ...full }, nxt?.row, actor());
      }
    } catch (e) { commitTasks(before); setMsg(`Not saved: ${e.message || e}`); }
  }

  function setStatus(row, status) {
    const patch = { Status: status };
    if (status === 'Done') patch['Completed On'] = toISO(row['Completed On']) || today;
    else if (s(row.Status) === 'Done') patch['Completed On'] = '';
    if (status === 'In Progress' && !toISO(row['Started On'])) patch['Started On'] = today;
    if (status === 'NA') patch.Applicable = 'NA';
    else if (s(row.Applicable) === 'NA') patch.Applicable = 'Yes';
    patchTask(row, patch, { doneNotify: status === 'Done' && s(row.Status) !== 'Done' });
  }
  const toggleNA = row => patchTask(row, s(row.Applicable) === 'NA' || s(row.Status) === 'NA'
    ? { Applicable: 'Yes', Status: 'Not Started' } : { Applicable: 'NA', Status: 'NA', 'Completed On': '' });

  async function addStep(after, nextT, f) {
    const eng = engByKey[s(after.row['EC Index'])];
    const owners = ownersForDept(f.dept, data.departments, data.members);
    const all = tasksRef.current;
    const row = {
      TaskID: nextNumberId('T', all.map(t => t.TaskID)), 'EG.ID': s(eng['EG.ID']), 'EC Index': keyOf(eng), Company: s(eng.Company),
      'Program Start': toISO(eng['Start Date']), StepID: nextNumberId('CUS', all.map(t => t.StepID), 3),
      Seq: seqBetween(after.row.Seq, nextT?.row.Seq), Phase: s(after.row.Phase), Step: f.step.trim(), 'Owner Dept': f.dept,
      'Owner Emails': joinEmails(owners.map(o => o.email)), 'Owner Names': owners.map(o => o.name).join('; '),
      Applicable: 'Yes', Status: 'Not Started', 'Planned Start': '', 'Due Date': '', 'TAT (days)': fmtTat(f.tat),
      'Reminder Count': 0, Escalated: 'No', 'Custom Step': 'Yes', 'Added By': actor().email, 'Updated On': today,
    };
    setBusy('Adding step…');
    try {
      await opsCreate('tasks', row);
      commitTasks([...all, row]);
      await syncDates(keyOf(eng));
      notifyChecklistCreated(eng, [tasksRef.current.find(t => t.TaskID === row.TaskID)], actor());
      setAdding('');
    } catch (e) { setMsg(`Step not added: ${e.message || e}`); } finally { setBusy(''); }
  }

  async function removeCustom(row) {
    if (!window.confirm(`Delete custom step “${row.Step}”? This cannot be undone.`)) return;
    const before = tasksRef.current;
    commitTasks(before.filter(t => t.TaskID !== row.TaskID));
    try { await opsDelete('tasks', row.TaskID); await syncDates(s(row['EC Index'])); }
    catch (e) { commitTasks(before); setMsg(`Not deleted: ${e.message || e}`); }
  }

  async function createChecklist(ec) {
    const a = actor();
    const eng = engagementFromEC(ec, { actorEmail: a.email, today });
    const rows = generateTasks({ steps: data.steps, eng, departments: data.departments, members: data.members, existingTaskIds: tasksRef.current.map(t => t.TaskID), actorEmail: a.email, today });
    try {
      setBusy('Saving program…');
      await opsCreate('engagements', eng);
      setData(d => ({ ...d, engagements: [...d.engagements, eng] }));
      setBusy(`Creating ${rows.length} steps…`);
      const res = await pool(rows, r => opsCreate('tasks', r));
      const ok = rows.filter((_, i) => !(res[i] instanceof Error));
      commitTasks([...tasksRef.current, ...ok]);
      const sent = notifyChecklistCreated(eng, ok, a);
      setMsg(`${eng.Company}: ${ok.length} steps created${ok.length < rows.length ? `, ${rows.length - ok.length} failed — press ↺ to check` : ''} · ${sent} owner${sent === 1 ? '' : 's'} notified.`);
      setSel(keyOf(eng)); setTab('programs'); setShowNew(false); setStatusF('Active'); setQ('');
    } catch (e) { setMsg(`Checklist not created: ${e.message || e}`); } finally { setBusy(''); }
  }

  async function setChecklistStatus(eng, v) {
    const k = keyOf(eng);
    setData(d => ({ ...d, engagements: d.engagements.map(e => (keyOf(e) === k ? { ...e, 'Checklist Status': v } : e)) }));
    try { await opsUpdate('engagements', k, { 'Checklist Status': v }); } catch (e) { setMsg(`Not saved: ${e.message || e}`); load(); }
  }

  // Saved due dates follow the current rule: after a load, store any that differ (active programs only).
  const datesChecked = useRef(false);
  useEffect(() => {
    if (!data || datesChecked.current || !canEdit) return;
    datesChecked.current = true;
    (async () => { for (const k of openKeys()) await syncDates(k); })().catch(() => {});
  }, [data]);

  // ── Step Library / Lists ────────────────────────────────────────────────────
  const openKeys = () => new Set(data.engagements.filter(e => !['Closed', 'Delivered'].includes(s(e['Checklist Status']))).map(keyOf));
  const setStepRows = rows => setData(d => ({ ...d, stepRows: rows, steps: rows.map(normStep).filter(x => x.id) }));
  const byIdOf = rows => Object.fromEntries(rows.map(normStep).filter(x => x.id).map(x => [x.id, x]));

  /** Copy a library step to its not-done tasks in active programs, then recalculate those timelines. */
  async function pushStepToOpen(st, byId) {
    const open = openKeys();
    const patch = taskPatchFromStep(st, resolveOwners(st, data.departments, data.members));
    const changes = tasksRef.current.filter(t => s(t.StepID) === st.id && open.has(s(t['EC Index'])) && !isDone(t))
      .map(t => ({ t, patch: diffRow(t, patch) })).filter(c => Object.keys(c.patch).length);
    if (!changes.length) return setMsg(`${st.id} saved · no open checklist steps to update.`);
    const map = Object.fromEntries(changes.map(c => [s(c.t.TaskID), c.patch]));
    commitTasks(tasksRef.current.map(t => (map[s(t.TaskID)] ? { ...t, ...map[s(t.TaskID)] } : t)));
    const res = await pool(changes, c => opsUpdate('tasks', s(c.t.TaskID), { ...c.patch, 'Updated On': today }));
    const progs = [...new Set(changes.map(c => s(c.t['EC Index'])))];
    for (const k of progs) await syncDates(k, byId);
    const failed = res.filter(r => r instanceof Error).length;
    setMsg(`${st.id} saved · ${changes.length - failed} open step${changes.length === 1 ? '' : 's'} updated in ${progs.length} program${progs.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed — press ↺` : ''}.`);
  }

  /** Add a new library step to every active program it fits. */
  async function addStepToOpen(st, byId) {
    const a = actor(); const targets = data.engagements.filter(e => openKeys().has(keyOf(e)) && stepFits(st, e));
    const ids = tasksRef.current.map(t => t.TaskID); const made = [];
    for (const eng of targets) {
      const TaskID = nextNumberId('T', ids); ids.push(TaskID);
      const row = taskFromStep(st, eng, { departments: data.departments, members: data.members, taskId: TaskID, actorEmail: a.email, today });
      try { await opsCreate('tasks', row); made.push(row); commitTasks([...tasksRef.current, row]); await syncDates(keyOf(eng), byId); notifyChecklistCreated(eng, [tasksRef.current.find(t => t.TaskID === TaskID)], a); }
      catch { /* counted below */ }
    }
    setMsg(`${st.id} added · ${made.length} of ${targets.length} active program${targets.length === 1 ? '' : 's'} updated.`);
  }

  async function saveLibraryStep(st, fields) {
    const patch = stepPatch(fields, stepColumns(data.stepRows[0]));
    if (!Object.keys(patch).length) return true;
    const before = data.stepRows;
    const rows = before.map(r => (s(r.StepID) === st.id ? { ...r, ...patch } : r));
    setStepRows(rows);
    setBusy('Saving step…');
    try {
      await opsUpdate('steps', st.id, patch);
      if (propagate && STEP_SYNC_FIELDS.some(k => k in fields)) {
        const byId = byIdOf(rows); await pushStepToOpen(byId[st.id], byId);
      } else if (propagate && 'anchor' in fields) {
        const byId = byIdOf(rows); for (const k of openKeys()) await syncDates(k, byId);
      }
      return true;
    } catch (e) { setStepRows(before); setMsg(`Step not saved: ${e.message || e}`); return false; } finally { setBusy(''); }
  }

  async function addLibraryStep(draft) {
    const st = { ...draft, id: nextNumberId('OPS', data.steps.map(x => x.id), 3), step: s(draft.step) };
    const row = stepPatch(st, stepColumns(data.stepRows[0]));
    setBusy('Adding step…');
    try {
      await opsCreate('steps', row);
      const rows = [...data.stepRows, row]; setStepRows(rows);
      if (propagate && st.active) await addStepToOpen(normStep(row), byIdOf(rows));
      else setMsg(`${st.id} added to the Step Library · used by new checklists.`);
      return true;
    } catch (e) { setMsg(`Step not added: ${e.message || e}`); return false; } finally { setBusy(''); }
  }

  async function saveListValue(row, patch) {
    const before = data.listRows;
    setData(d => ({ ...d, listRows: d.listRows.map(r => (r.ListID === row.ListID ? { ...r, ...patch } : r)) }));
    try { await opsUpdate('lists', row.ListID, patch); } catch (e) { setData(d => ({ ...d, listRows: before })); setMsg(`List not saved: ${e.message || e}`); }
  }
  async function addListValue(list, value) {
    const rows = data.listRows;
    const same = rows.filter(r => s(r.List).toLowerCase() === list.toLowerCase());
    if (same.some(r => s(r.Value).toLowerCase() === value.toLowerCase())) return setMsg(`“${value}” is already in ${list}.`);
    const row = { ListID: nextNumberId('LST', rows.map(r => r.ListID), 3), List: list, Value: value, Order: Math.max(0, ...same.map(r => Number(r.Order) || 0)) + 1, Active: 'Yes' };
    try { await opsCreate('lists', row); setData(d => ({ ...d, listRows: [...d.listRows, row] })); } catch (e) { setMsg(`Not added: ${e.message || e}`); }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!isOpsV2Ready()) return <div className="page-content"><div className="ov2-empty">OPS_V2_CRUD flow URL is not set in src/config/powerAutomate.js.</div></div>;
  if (loading && !data) return <LoadingState message="Loading Ops Checklist v2…" />;
  if (error && !data) return <ErrorState error={error} onRetry={load} />;

  const eng = engByKey[sel];
  const tl = timelines[sel] || [];
  const sum = sums[sel];

  return (
    <div className="tracker-page ov2">
      <div className="ov2-head">
        <div>
          <div className="page-title">Ops Checklist <span className="ov2-v2">v2</span></div>
          <div className="ov2-muted">TAT from program start: 2 = 2 days before · +2 = 2 days after · 0 = on the day</div>
        </div>
        <div className="ov2-tabs">
          <button className={tab === 'programs' ? 'on' : ''} onClick={() => setTab('programs')}>Programs</button>
          <button className={tab === 'my' ? 'on' : ''} onClick={() => setTab('my')}>My tasks <span>{mine.length}</span></button>
          {canEdit && <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Step Library</button>}
        </div>
        <div className="ov2-head-act">
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading ? '⟳' : '↺'}</button>
          {canCreate('ops') && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>+ New checklist</button>}
        </div>
      </div>

      <div className="kpi-compact ov2-kpis">
        <KPICard label="Programs in preparation" value={kpi.programs} icon="📋" />
        <KPICard label={tab === 'my' ? 'My open steps' : 'Open steps'} value={kpi.open} icon="🧩" />
        <KPICard label="Overdue" value={kpi.overdue} icon="⏰" variant={kpi.overdue ? 'ov2-kpi-alert' : ''} />
        <KPICard label="Due in 7 days" value={kpi.week} icon="📆" />
        <KPICard label="At-risk programs" value={kpi.atRisk.length} icon="⚠️" sub="Prep step overdue before start"
          list={kpi.atRisk.map(e => ({ name: e.Company, sub: `${s(e.Topic)} · starts ${fmtD(toISO(e['Start Date']))} · ${sums[keyOf(e)]?.overdue || 0} overdue` }))} />
      </div>

      {msg && <div className="ov2-msg" onClick={() => setMsg('')}>{msg} <span>×</span></div>}

      {tab === 'library' ? (
        <StepLibrary steps={data.steps} departments={data.departments} members={data.members} lists={lists} listRows={data.listRows}
          canEdit={canEdit} propagate={propagate} setPropagate={setPropagate} busy={busy}
          onSaveStep={saveLibraryStep} onAddStep={addLibraryStep} onSaveList={saveListValue} onAddList={addListValue} />
      ) : tab === 'my' ? (
        <div className="card ov2-card">
          <div className="card-header"><span className="card-title">My tasks</span><span className="ov2-muted">{mine.length} open · {myEmail}</span></div>
          <div className="table-wrap">
            <table className="ov2-table">
              <thead><tr><th>Program</th><th>Step</th><th>Phase</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {!mine.length && <tr><td colSpan={6} className="ov2-empty">No open steps assigned to you.</td></tr>}
                {mine.map(t => (
                  <tr key={t.row.TaskID} className={t.overdue ? 'late' : ''}>
                    <td><button className="ov2-link" onClick={() => { setSel(keyOf(t.eng)); setTab('programs'); setStatusF('All'); }}>{t.eng.Company}</button><div className="ov2-muted">starts {fmtD(toISO(t.eng['Start Date']))}</div></td>
                    <td>{t.row.Step}</td><td className="ov2-muted">{t.row.Phase}</td>
                    <td><DueCell t={t} today={today} /></td>
                    <td>{canEdit ? <select className={`form-input ov2-status ${STATUS_CLS[s(t.row.Status)] || ''}`} value={s(t.row.Status)} onChange={e => setStatus(t.row, e.target.value)}>{STATUSES.map(x => <option key={x}>{x}</option>)}</select> : s(t.row.Status)}</td>
                    <td>{canEdit && <button className="btn btn-cta btn-sm" onClick={() => setStatus(t.row, 'Done')}>Mark done</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="ov2-grid">
          <div className="card ov2-card ov2-list">
            <div className="ov2-list-filters">
              <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID" value={q} onChange={e => setQ(e.target.value)} />
              <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
                {['Active', 'All', ...CHECKLIST_STATUSES].map(x => <option key={x} value={x}>{x === 'Active' ? 'Active checklists' : x === 'All' ? 'All checklists' : x}</option>)}
              </select>
            </div>
            <div className="ov2-list-body">
              {!programs.length && <div className="ov2-empty">No checklists{data.engagements.length ? ' match' : ' yet — open one with “+ New checklist”'}.</div>}
              {programs.map(p => {
                const k = keyOf(p); const m = sums[k] || {};
                return (
                  <button key={k} type="button" className={`ov2-prog${k === sel ? ' sel' : ''}`} onClick={() => { setSel(k); setExpanded(''); setAdding(''); }}>
                    <div className="ov2-prog-top"><b>{p.Company}</b><span>{fmtD(toISO(p['Start Date']))}</span></div>
                    <div className="ov2-prog-sub">{s(p.Topic) || '—'}</div>
                    <div className="ov2-bar"><i style={{ width: `${m.progress || 0}%` }} /></div>
                    <div className="ov2-prog-meta">
                      <span>{m.done || 0}/{m.applicable || 0} done</span>
                      {!!m.overdue && <span className="badge badge-red">{m.overdue} overdue</span>}
                      {m.atRisk && <span className="badge badge-orange">At risk</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card ov2-card ov2-detail">
            {!eng ? <div className="ov2-empty">Select a program.</div> : <>
              <div className="ov2-detail-head">
                <div>
                  <div className="card-title">{eng.Company} <span className="ov2-muted">· {s(eng['EG.ID'])}</span></div>
                  <div className="ov2-muted">{s(eng.Topic)} · {fmtD(toISO(eng['Start Date']))}{toISO(eng['End Date']) && toISO(eng['End Date']) !== toISO(eng['Start Date']) ? ` – ${fmtD(toISO(eng['End Date']))}` : ''} · {s(eng.Mode) || s(eng.Location)} · {s(eng.Offering) || '—'}</div>
                </div>
                <div className="ov2-detail-act">
                  {sum?.atRisk && <span className="badge badge-orange" title="A pre-program step is overdue">At risk · {sum.overdue} overdue</span>}
                  <span className="ov2-muted">{sum?.progress || 0}% · next due {fmtD(sum?.nextDue)}</span>
                  {canEdit ? <select className="form-input ov2-mini" value={s(eng['Checklist Status']) || 'Not Started'} onChange={e => setChecklistStatus(eng, e.target.value)}>{CHECKLIST_STATUSES.map(x => <option key={x}>{x}</option>)}</select>
                    : <span className="badge badge-gray">{s(eng['Checklist Status'])}</span>}
                </div>
              </div>
              <div className="table-wrap ov2-tl">
                <table className="ov2-table">
                  <thead><tr><th title="Applies to this program">Applies</th><th>#</th><th>Step</th><th>Owners</th><th>TAT</th><th>Start</th><th>Due</th><th>Status</th><th>Done on</th></tr></thead>
                  <tbody>
                    {!tl.length && <tr><td colSpan={9} className="ov2-empty">No steps for this program.</td></tr>}
                    {tl.map((t, i) => {
                      const r = t.row; const id = s(r.TaskID); const newPhase = i === 0 || s(tl[i - 1].row.Phase) !== s(r.Phase);
                      const nextT = tl[i + 1];
                      return (
                        <Fragment key={id}>
                          {newPhase && <tr className="ov2-phase"><td colSpan={9}>{s(r.Phase) || '—'}</td></tr>}
                          <tr className={`ov2-row${t.applicable ? '' : ' na'}${t.overdue ? ' late' : ''}${expanded === id ? ' open' : ''}`}>
                            <td><label className="ov2-switch" title={t.applicable ? 'Mark NA (removes its TAT)' : 'Make applicable'}>
                              <input type="checkbox" checked={t.applicable} disabled={!canEdit} onChange={() => toggleNA(r)} /><span /></label></td>
                            <td className="ov2-muted">{s(r.Seq)}</td>
                            <td className="ov2-step" onClick={() => setExpanded(expanded === id ? '' : id)}>
                              {r.Step}{s(r['Custom Step']) === 'Yes' && <span className="ov2-tag">custom</span>}
                              <div className="ov2-muted">{s(r['Owner Dept'])}{s(r['Waiting On']) && ` · waiting on ${s(r['Waiting On'])}`}</div>
                            </td>
                            <td className="ov2-own">{s(r['Owner Names']) || <span className="ov2-muted">—</span>}</td>
                            <td title={tatLabel(t.tat, t.anchor)}>{t.applicable ? t.tat : <s className="ov2-muted">{t.tat}</s>}</td>
                            <td className="ov2-muted">{fmtD(t.plannedStart)}</td>
                            <td><DueCell t={t} today={today} /></td>
                            <td>{canEdit && t.applicable
                              ? <select className={`form-input ov2-status ${STATUS_CLS[s(r.Status)] || ''}`} value={s(r.Status) || 'Not Started'} onChange={e => setStatus(r, e.target.value)}>{STATUSES.filter(x => x !== 'NA').map(x => <option key={x}>{x}</option>)}</select>
                              : <span className={`badge badge-${STATUS_CLS[s(r.Status)] || 'gray'}`}>{s(r.Status) || '—'}</span>}</td>
                            <td>{t.done ? <span className={t.delay ? 'ov2-due late' : ''}>{fmtD(t.completed)}{t.delay ? <small> · +{t.delay}d</small> : ''}</span> : <span className="ov2-muted">—</span>}</td>
                          </tr>
                          {expanded === id && (
                            <tr className="ov2-more"><td colSpan={9}>
                              <div className="ov2-more-grid">
                                <div>
                                  {t.step?.what && <p><b>What to do:</b> {t.step.what}</p>}
                                  {t.step?.doneWhen && <p><b>Done when:</b> {t.step.doneWhen}</p>}
                                  <div className="ov2-lbl">Owners</div>
                                  <OwnersEditor row={r} departments={data.departments} members={data.members} disabled={!canEdit} onSave={p => patchTask(r, p)} />
                                </div>
                                <div className="ov2-fields">
                                  <label>Waiting on<select className="form-input" disabled={!canEdit} value={s(r['Waiting On'])} onChange={e => patchTask(r, { 'Waiting On': e.target.value })}><option value="">—</option>{lists.waitingOn.map(x => <option key={x}>{x}</option>)}</select></label>
                                  <label title='"2" = 2 days before, "+2" = 2 days after'>TAT ({tatLabel(t.tat, t.anchor)})<input className="form-input" disabled={!canEdit} defaultValue={t.tat} onBlur={e => { const v = e.target.value; if (!isValidTat(v)) { e.target.value = t.tat; setMsg('TAT must be a whole number like 2 or +2.'); return; } if (fmtTat(v) !== t.tat) patchTask(r, { 'TAT (days)': fmtTat(v) }); }} /></label>
                                  {t.done && <label>Completed on<input className="form-input" type="date" disabled={!canEdit} defaultValue={t.completed} onBlur={e => e.target.value && e.target.value !== t.completed && patchTask(r, { 'Completed On': e.target.value })} /></label>}
                                  {s(r.Status) === 'Blocked' && <label>Blocked reason<input className="form-input" disabled={!canEdit} defaultValue={s(r['Blocked Reason'])} onBlur={e => e.target.value !== s(r['Blocked Reason']) && patchTask(r, { 'Blocked Reason': e.target.value })} /></label>}
                                  <label>Evidence link<input className="form-input" disabled={!canEdit} defaultValue={s(r['Evidence Link'])} placeholder="https://…" onBlur={e => e.target.value !== s(r['Evidence Link']) && patchTask(r, { 'Evidence Link': e.target.value })} /></label>
                                  <label className="wide">Comments<textarea className="form-input" rows={2} disabled={!canEdit} defaultValue={s(r.Comments)} onBlur={e => e.target.value !== s(r.Comments) && patchTask(r, { Comments: e.target.value })} /></label>
                                  {s(r['Custom Step']) === 'Yes' && canDelete('ops') && <button className="btn btn-danger btn-sm" onClick={() => removeCustom(r)}>Delete custom step</button>}
                                </div>
                              </div>
                            </td></tr>
                          )}
                          {canCreate('ops') && (adding === id
                            ? <AddStepRow after={t} departments={data.departments} saving={!!busy} onCancel={() => setAdding('')} onAdd={f => addStep(t, nextT, f)} />
                            : <tr className="ov2-insert"><td colSpan={9}><button type="button" onClick={() => setAdding(id)}>+ Add step here</button></td></tr>)}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>}
          </div>
        </div>
      )}

      {showNew && <NewChecklistModal existing={new Set(Object.keys(engByKey))} busy={busy} onClose={() => !busy && setShowNew(false)} onCreate={createChecklist} />}
    </div>
  );
}
