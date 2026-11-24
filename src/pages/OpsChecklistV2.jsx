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
import { engMode } from '../services/opsV2Engine.js';
import { fetchDepartments } from '../services/departmentsApi.js';
import { opsList, opsCreate, opsUpdate, opsDelete, isOpsV2Ready, opsListOptional, duplicateKeys } from '../services/opsV2Api.js';
import {
  STATUSES, CHECKLIST_STATUSES, WAITING_ON, normStep, buildTimeline, datePatches, summarise, engagementFromEC,
  generateTasks, nextOpenAfter, ownersForDept, nextNumberId, seqBetween, splitEmails, joinEmails, todayISO, toISO, addDays, daysBetween,
  fmtTat, tatLabel, isValidTat, resolveOwners, stepColumns, stepPatch, STEP_SYNC_FIELDS, taskPatchFromStep, diffRow, listValues, stepFits, taskFromStep, isDone,
} from '../services/opsV2Engine.js';
import { notifyChecklistCreated, notifyStepDone, notifyItinerary } from '../services/opsV2Notify.js';
import TravelDesk from '../components/ops/TravelDesk.jsx';
import { tripsForProgram, vendorRowsForTrip, vendorRowForStep, travelStepsToComplete } from '../services/opsV2Travel.js';
import { getVendorServices, addVendorService, nextServiceId } from '../services/leadsVendorsApi.js';
import { updateECFinanceAmounts } from '../services/syncWithEC.js';
import { programsFrom, setOpsPrograms } from '../services/opsV2Data.js';
import OwnerChips, { DeptChips } from '../components/ops/OwnerChips.jsx';
import StepLibrary from '../components/ops/StepLibrary.jsx';
import OpsOverview from '../components/ops/OpsOverview.jsx';
import { planEcSync, autoFillNewTasks } from '../services/opsEcSync.js';
import { useLocation } from 'react-router-dom';
import { getTasks, peekTasks, cacheTasks, addTask, nextTaskId, nextProjectId, tasksConfigured } from '../services/tasksApi.js';
import { useTaskUser, groupProjects, norm } from '../components/tasksShared.jsx';
import '../styles/opsV2.css';

const s = v => String(v ?? '').trim();
const fmtD = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const keyOf = e => s(e['EC Index']);
const loadLists = ({ force = false } = {}) => opsListOptional('lists', { force });   // null until ListTable exists
// Ops steps already sent to the Task Tracker carry "[OPS:<TaskID>]" in Remarks
const todoIdsFrom = rows => new Set((rows || []).flatMap(r => [...String(r.remarks || '').matchAll(/\[OPS:([^\]]+)\]/g)].map(m => m[1])));
const initialsOf = n => String(n || '').split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const ownerList = r => s(r['Owner Names']).split(/[,;]/).map(x => x.trim()).filter(Boolean);
/** One pill per program: TAT missed (red) › At risk (amber) › On track (green). */
const progPill = m => (m?.tatMissed ? { cls: 'late', text: `TAT missed · ${m.maxLate}d` }
  : m?.atRisk ? { cls: 'risk', text: 'At risk' } : { cls: 'ok', text: m?.open ? 'On track' : 'Done' });
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
      {t.shortLead && <span className="ov2-flag" title="Was already due when the checklist was opened">!</span>}
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
      <td colSpan={7}>
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
  const [scopeAll, setScopeAll] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState({});
  const [ecIssues, setEcIssues] = useState({});       // EC Index → wrong / missing EC link (from the EC sync)      // `${EC Index}|${phase}` → open/closed (user toggled)       // My tasks overview: my steps / all programs
  const [todoIds, setTodoIds] = useState(() => todoIdsFrom(peekTasks() || []));
  const taskUser = useTaskUser();
  const { search } = useLocation();
  const tasksRef = useRef([]);
  const tripsRef = useRef([]);
  const today = todayISO();
  const actor = () => { const u = getAuditUser(); return { email: u.email || myEmail, name: u.name || '' }; };

  async function load() {
    setLoading(true); setError(null);
    try {
      const [steps, engagements, tasks, dm] = await Promise.all([opsList('steps'), opsList('engagements'), opsList('tasks'), fetchDepartments()]);
      tasksRef.current = tasks;
      taskDupNotice(tasks);
      const [listRows, travel] = await Promise.all([loadLists().catch(() => null), opsListOptional('travel').catch(e => { setMsg(`Travel Desk not loaded: ${e.message || e}`); return []; })]);   // null until the tables exist
      travelNotice(travel);
      tripsRef.current = travel || [];
      setOpsPrograms(programsFrom(steps, engagements, tasks));   // Dashboard / Founder's Desk / 360 copy
      setData({ stepRows: steps, steps: steps.map(normStep).filter(x => x.id), engagements: engagements.filter(keyOf), tasks,
        departments: dm.departments, members: dm.members, listRows, travel });
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) { setError(e); } finally { setLoading(false); }
  }
  useEffect(() => { if (isOpsV2Ready()) load(); else setLoading(false); }, []);
  useEffect(() => { if (tasksConfigured()) getTasks().then(r => setTodoIds(todoIdsFrom(r))).catch(() => {}); }, []);
  useEffect(() => { if (search.includes('alert=tat')) { setTab('programs'); setStatusF('TAT missed'); } }, [search]);

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
    .filter(e => statusF === 'All' || (statusF === 'TAT missed' ? !['Closed', 'Delivered'].includes(s(e['Checklist Status'])) && sums[keyOf(e)]?.tatMissed
      : statusF === 'Active' ? !['Closed', 'Delivered'].includes(s(e['Checklist Status'])) : s(e['Checklist Status']) === statusF))
    .filter(e => !q || `${e.Company} ${e.Topic} ${e['EG.ID']}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => toISO(a['Start Date']).localeCompare(toISO(b['Start Date']))), [data?.engagements, statusF, q, sums]);
  useEffect(() => { if (programs.length && !programs.some(p => keyOf(p) === sel)) setSel(keyOf(programs[0])); }, [programs, sel]);

  const mine = useMemo(() => Object.entries(timelines).flatMap(([k, tl]) => tl
    .filter(t => t.applicable && !t.done && splitEmails(t.row['Owner Emails']).includes(myEmail))
    .map(t => ({ ...t, eng: engByKey[k] })))
    .sort((a, b) => (b.overdue - a.overdue) || a.due.localeCompare(b.due)), [timelines, engByKey, myEmail]);

  const kpi = useMemo(() => {
    const scope = tab === 'my' && !scopeAll ? mine : Object.values(timelines).flat().filter(t => t.applicable && !t.done);
    const active = (data?.engagements || []).filter(e => !['Closed', 'Delivered'].includes(s(e['Checklist Status'])));
    return {
      programs: active.length, open: scope.length, overdue: scope.filter(t => t.overdue).length,
      week: scope.filter(t => t.due >= today && t.due <= addDays(today, 7)).length,
      atRisk: active.filter(e => sums[keyOf(e)]?.atRisk),
      tat: active.filter(e => sums[keyOf(e)]?.tatMissed).sort((a, b) => (sums[keyOf(b)]?.maxLate || 0) - (sums[keyOf(a)]?.maxLate || 0)),
    };
  }, [tab, scopeAll, mine, timelines, data?.engagements, sums, today]);

  // ── Writes ──────────────────────────────────────────────────────────────────
  const commitTasks = next => { tasksRef.current = next; setData(d => ({ ...d, tasks: next })); };

  /** Recalculate dates for one program, keep them in state and save the changed ones. */
  async function syncDates(ecIndex, byId = stepsById, engOverride = null) {
    const eng = engOverride || engByKey[ecIndex] || data.engagements.find(e => keyOf(e) === ecIndex);
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

  /** Open steps → Task Tracker: one project per program (reused), one task per step, never twice. */
  async function addToTodo(list) {
    if (!tasksConfigured()) { setMsg('Task Tracker is not set up (TASKS_CRUD flow missing).'); return; }
    setBusy('todo');
    try {
      const rows = [...await getTasks()];
      const have = todoIdsFrom(rows);
      let added = 0; let projName = '';
      for (const t of list) {
        const id = s(t.row.TaskID);
        if (have.has(id)) continue;
        const eng = engByKey[s(t.row['EC Index'])] || {};
        const name = [s(eng.Company), s(eng.Topic)].filter(Boolean).join(' · ');
        const proj = groupProjects(rows).find(p => norm(p.projectName) === norm(name) && norm(p.client) === norm(eng.Company));
        const owner = s(t.row['Owner Names']).split(/[,;]/).map(x => x.trim()).filter(Boolean)[0] || taskUser.pickName;
        const row = {
          taskId: nextTaskId(rows),
          projectId: proj?.projectId || nextProjectId(rows), projectName: proj?.projectName || name, projectType: proj?.projectType || 'Client Engagement',
          client: proj?.client || s(eng.Company), projectOwner: proj?.projectOwner || s(eng['Internal POC']) || taskUser.pickName,
          projectDue: proj?.projectDue || toISO(eng['Start Date']), team: 'Operations',
          title: s(t.row.Step), description: `Ops Checklist step (${s(t.row.Phase) || '—'}) · ${s(eng['EG.ID'])}`,
          assignedTo: owner, assignedBy: taskUser.pickName, assignedDate: today, dueDate: t.due,
          priority: t.overdue ? 'High' : 'Medium', status: 'To do', waitingOn: '', completedDate: '', outputLink: '', updates: [],
          remarks: `[OPS:${id}]`, createdBy: taskUser.pickName,
        };
        await addTask(row);
        rows.push(row); have.add(id); added++; projName = row.projectName;
      }
      cacheTasks(rows); setTodoIds(new Set(have));
      setMsg(added ? `✓ ${added} step${added > 1 ? 's' : ''} added to To-Do · project “${projName}”` : 'Already in To-Do.');
    } catch (e) { setMsg(`Not added to To-Do: ${e.message || e}`); } finally { setBusy(''); }
  }
  const todoEligible = t => t.applicable && !t.done && t.due && t.due <= addDays(today, 7);

  function setStatus(row, status) {
    const patch = { Status: status };
    if (status === 'Done') patch['Completed On'] = toISO(row['Completed On']) || today;
    else if (s(row.Status) === 'Done') patch['Completed On'] = '';
    if (status === 'In Progress' && !toISO(row['Started On'])) patch['Started On'] = today;
    if (status === 'NA') patch.Applicable = 'NA';
    else if (s(row.Applicable) === 'NA') patch.Applicable = 'Yes';
    return patchTask(row, patch, { doneNotify: status === 'Done' && s(row.Status) !== 'Done' });
  }
  const toggleNA = row => patchTask(row, s(row.Applicable) === 'NA' || s(row.Status) === 'NA'
    ? { Applicable: 'Yes', Status: 'Not Started' } : { Applicable: 'NA', Status: 'NA', 'Completed On': '' });

  async function addStep(after, nextT, f) {
    const eng = engByKey[s(after.row['EC Index'])];
    const owners = ownersForDept(f.dept, data.departments, data.members);
    const all = tasksRef.current;
    let ids;
    try { ids = await liveTaskIds(); } catch (e) { setMsg(`Step not added — OpsTaskTable could not be read: ${e.message || e}`); return; }
    const row = {
      TaskID: nextNumberId('T', ids), 'EG.ID': s(eng['EG.ID']), 'EC Index': keyOf(eng), Company: s(eng.Company),
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
    let ids;
    try { ids = await liveTaskIds(); } catch (e) { setMsg(`Checklist not created — OpsTaskTable could not be read: ${e.message || e}`); return; }
    const rows = autoFillNewTasks(generateTasks({ steps: data.steps, eng, departments: data.departments, members: data.members, existingTaskIds: ids, actorEmail: a.email, today }), ec, today);
    try {
      setBusy('Saving program…');
      await opsCreate('engagements', eng);
      setData(d => ({ ...d, engagements: [...d.engagements, eng] }));
      setBusy(`Creating ${rows.length} steps…`);
      const res = await pool(rows, r => opsCreate('tasks', r));
      const ok = rows.filter((_, i) => !(res[i] instanceof Error));
      commitTasks([...tasksRef.current, ...ok]);
      const sent = notifyChecklistCreated(eng, ok, a);
      let tripsMade = 0;
      if (data.travel) {                                   // Travel Desk: one trip per consultant (in-person)
        const tr = tripsForProgram(eng, { existing: tripsRef.current, existingIds: tripsRef.current.map(t => t.TripID), actorEmail: a.email, today });
        const tres = await pool(tr, r => opsCreate('travel', r));
        const tok = tr.filter((_, i) => !(tres[i] instanceof Error)); tripsMade = tok.length;
        if (tok.length) commitTrips([...tripsRef.current, ...tok]);
      }
      setMsg(`${eng.Company}: ${ok.length} steps created${ok.length < rows.length ? `, ${rows.length - ok.length} failed — press ↺ to check` : ''} · ${sent} owner${sent === 1 ? '' : 's'} notified${tripsMade ? ` · ${tripsMade} trip(s) added to the Travel Desk` : ''}.`);
      setSel(keyOf(eng)); setTab('programs'); setShowNew(false); setStatusF('Active'); setQ('');
    } catch (e) { setMsg(`Checklist not created: ${e.message || e}`); } finally { setBusy(''); }
  }

  /**
   * Engagement Calendar → checklist sync (rules: services/opsEcSync.js).
   * Program fields + checklist status, due dates after date changes, auto-filled steps.
   * Wrong / missing EC links are listed, never synced. auto = silent run after the page loads.
   */
  async function syncFromEc({ auto = false } = {}) {
    if (!canEdit || !data) return;
    if (!auto) setBusy('Syncing from the Engagement Calendar…');
    try {
      const ecRows = await getAllEngagementsCached({ force: !auto });
      const plan = planEcSync({ engagements: data.engagements, tasks: tasksRef.current, ecRows, dupTaskIds: duplicateKeys('tasks', tasksRef.current), today });
      let progs = 0, fields = 0, filled = 0, failed = 0;
      for (const p of plan.programs) {
        const engNow = { ...p.eng, ...p.patch };
        if (Object.keys(p.patch).length) {
          const full = { ...p.patch, 'Synced From EC On': today };
          try {
            await opsUpdate('engagements', p.k, full);
            setData(d => ({ ...d, engagements: d.engagements.map(e => (keyOf(e) === p.k ? { ...e, ...full } : e)) }));
            progs++; fields += p.changes.length;
          } catch { failed++; }
        }
        if (p.fills.length) {
          const res = await pool(p.fills, f => opsUpdate('tasks', f.id, { ...f.patch, 'Updated On': today }));
          const ok = Object.fromEntries(p.fills.filter((_, i) => !(res[i] instanceof Error)).map(f => [f.id, f.patch]));
          filled += Object.keys(ok).length; failed += p.fills.length - Object.keys(ok).length;
          commitTasks(tasksRef.current.map(x => (ok[s(x.TaskID)] ? { ...x, ...ok[s(x.TaskID)], 'Updated On': today } : x)));
        }
        if (p.datesChanged || p.fills.length) await syncDates(p.k, stepsById, engNow);
      }
      const issues = Object.fromEntries([...plan.mismatches, ...plan.missing].map(x => [x.k, x]));
      setEcIssues(issues);
      const bad = Object.values(issues);
      const parts = [];
      if (progs) parts.push(`${progs} program${progs > 1 ? 's' : ''} updated (${fields} field${fields > 1 ? 's' : ''})`);
      if (filled) parts.push(`${filled} step${filled > 1 ? 's' : ''} auto-completed`);
      if (failed) parts.push(`${failed} save${failed > 1 ? 's' : ''} failed — press ⇅ again`);
      if (bad.length) parts.push(`${bad.length} checklist${bad.length > 1 ? 's' : ''} linked to the wrong EC row: ${bad.slice(0, 4).map(x => `${x.k} (${x.eng.Company})${x.suggest ? ` → EC ${x.suggest}` : ''}`).join(', ')}${bad.length > 4 ? ', …' : ''} — not synced until the EC Index is corrected`);
      if (parts.length) setMsg(`EC sync: ${parts.join(' · ')}.`);
      else if (!auto) setMsg('EC sync: everything already matches the Engagement Calendar.');
      if (progs || filled) setOpsPrograms(programsFrom(data.stepRows, data.engagements.map(e => { const p = plan.programs.find(x => x.k === keyOf(e)); return p ? { ...e, ...p.patch } : e; }), tasksRef.current));
    } catch (e) { setMsg(`EC sync failed: ${e.message || e}`); }
    finally { if (!auto) setBusy(''); }
  }
  const ecSynced = useRef(false);
  useEffect(() => {
    if (!data || ecSynced.current || !canEdit) return;
    ecSynced.current = true;
    syncFromEc({ auto: true });
  }, [data]);

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

  // ── Vendor requests + Travel Desk ───────────────────────────────────────────
  /** Warn when the trips shown are a saved copy (flow failed) or Excel has duplicate TripIDs. */
  function travelNotice(rows) {
    if (!rows) return;
    const dup = duplicateKeys('travel', rows);
    if (rows.stale) setMsg(`Travel Desk: the flow did not answer (${rows.stale.slice(0, 120)}) — showing the last saved copy. Adding trips is paused until it loads.`);
    else if (dup.length) setMsg(`Travel Desk: TripID used more than once in Excel (${dup.join(', ')}) — rename the duplicates in TravelTable, otherwise delete/edit of those trips fails.`);
  }
  /** Fresh TravelTable read before creating trips → IDs never collide. Throws when the read fails. */
  async function freshTrips() {
    const rows = await opsListOptional('travel', { force: true });
    if (!rows || rows.stale) throw new Error('TravelTable could not be read just now — try again in a minute');
    tripsRef.current = rows; setData(d => ({ ...d, travel: rows }));
    return rows;
  }
  /** TaskIDs from a fresh OpsTaskTable read (+ this session's) → new IDs never repeat another user's. */
  async function liveTaskIds() {
    const rows = await opsList('tasks');
    return [...new Set([...rows.map(r => s(r.TaskID)), ...tasksRef.current.map(r => s(r.TaskID))].filter(Boolean))];
  }
  /** Warn when Excel holds the same TaskID twice and suggest free IDs for the extra rows. */
  function taskDupNotice(rows) {
    const dup = duplicateKeys('tasks', rows);
    if (!dup.length) return;
    const ids = rows.map(r => s(r.TaskID)); const fix = [];
    for (const d of dup) for (let n = ids.filter(x => x === d).length - 1; n > 0; n--) { const nid = nextNumberId('T', ids); ids.push(nid); fix.push(`${d} → ${nid}`); }
    console.warn('[Ops] Duplicate TaskIDs in OpsTaskTable — rename the later row of each to:'); console.table(fix.map(f => { const [from, to] = f.split(' → '); return { duplicate: from, renameTo: to }; }));
    setMsg(`Ops tasks: ${dup.length} TaskIDs are used on more than one row in OpsTaskTable (${dup.slice(0, 4).join(', ')}${dup.length > 4 ? ', …' : ''}). Edits to those steps may hit the wrong row — the rename list is in the browser console (F12).`);
  }
  const commitTrips = next => { tripsRef.current = next; setData(d => ({ ...d, travel: next })); };
  const idsOf = v => s(v).split(/[;,]/).map(x => x.trim()).filter(Boolean);
  /** Next Vendor Service IDs from a fresh read, so two people never get the same ID. */
  async function vendorIdMaker() {
    const ids = (await getVendorServices()).map(r => r.serviceId);
    return () => { const id = nextServiceId(ids.map(serviceId => ({ serviceId }))); ids.push(id); return id; };
  }

  async function raiseVendorRequest(t) {
    if (!canCreate('vendors')) return setMsg('Creating vendor rows needs Create access to Vendor Services (Admin Panel).');
    const eng = engByKey[s(t.row['EC Index'])];
    setBusy('Creating vendor request…');
    try {
      const next = await vendorIdMaker();
      const v = vendorRowForStep(t.step, t.row, eng, { serviceId: next(), actorEmail: actor().email, due: t.due });
      await addVendorService(v);
      const linked = tasksRef.current.some(x => 'Vendor Service IDs' in x);
      if (linked) await patchTask(t.row, { 'Vendor Service IDs': [...idsOf(t.row['Vendor Service IDs']), v.serviceId].join('; ') });
      setMsg(`${v.serviceId} created in Vendor Services (${v.category}) — add the vendor, quantity and rate there.${linked ? '' : ' (Add the "Vendor Service IDs" column to OpsTaskTable to keep this link on the step.)'}`);
    } catch (e) { setMsg(`Vendor request not created: ${e.message || e}`); } finally { setBusy(''); }
  }

  async function saveTrip(trip, patch) {
    const id = s(trip.TripID); const before = tripsRef.current;
    const full = { ...patch, 'Updated On': today };
    commitTrips(before.map(t => (s(t.TripID) === id ? { ...t, ...full } : t)));
    try { await opsUpdate('travel', id, full); return true; }
    catch (e) { commitTrips(before); setMsg(`Trip not saved: ${e.message || e}`); return false; }
  }
  async function addTripsFromConsultants(k) {
    const eng = engByKey[k];
    let have;
    try { have = await freshTrips(); } catch (e) { return setMsg(`Trips not added: ${e.message}`); }
    const rows = tripsForProgram(eng, { existing: have, existingIds: have.map(t => t.TripID), actorEmail: actor().email, today });
    if (!rows.length) return setMsg(engMode(eng) !== 'In-person' ? `${eng.Company} is virtual — no travel needed.` : 'Every consultant already has a trip (or the program has no consultants in the Engagement Calendar). Use “+ Blank trip”.');
    setBusy('Adding trips…');
    const res = await pool(rows, r => opsCreate('travel', r));
    const ok = rows.filter((_, i) => !(res[i] instanceof Error));
    commitTrips([...tripsRef.current, ...ok]);
    setBusy(''); setMsg(`${ok.length} trip(s) added for ${eng.Company}${ok.length < rows.length ? ` · ${rows.length - ok.length} failed` : ''}.`);
  }
  async function addBlankTrip(k) {
    const eng = engByKey[k];
    try { await freshTrips(); } catch (e) { return setMsg(`Trip not added: ${e.message}`); }
    const row = {
      TripID: nextNumberId('TR', tripsRef.current.map(t => t.TripID), 4), 'EC Index': k, 'EG.ID': s(eng['EG.ID']), Company: s(eng.Company), Program: s(eng.Topic),
      'Program Start': toISO(eng['Start Date']), 'Program End': toISO(eng['End Date']) || toISO(eng['Start Date']), Location: s(eng.Location),
      'To City': s(eng.Location), 'Traveller Role': 'Other', 'Travel Mode': 'Flight', 'Billable to Client': 'Billable to client', 'Booking Status': 'Requested',
      'Created By': actor().email, 'Updated On': today,
    };
    setBusy('Adding trip…');
    try { await opsCreate('travel', row); commitTrips([...tripsRef.current, row]); setMsg(`${row.TripID} added — open it to fill in the traveller.`); }
    catch (e) { setMsg(`Trip not added: ${e.message || e}`); } finally { setBusy(''); }
  }
  async function deleteTrip(trip) {
    if (!window.confirm(`Delete trip ${trip.TripID} (${trip.Traveller || 'no traveller'})? This cannot be undone. Vendor rows already created stay in Vendor Services.`)) return false;
    const before = tripsRef.current;
    commitTrips(before.filter(t => t.TripID !== trip.TripID));
    try { await opsDelete('travel', trip.TripID); return true; } catch (e) { commitTrips(before); setMsg(`Not deleted: ${e.message || e}`); return false; }
  }
  async function raiseTripVendors(trip) {
    if (!canCreate('vendors')) { setMsg('Creating vendor rows needs Create access to Vendor Services (Admin Panel).'); return; }
    const next = await vendorIdMaker();
    const rows = vendorRowsForTrip(trip, { nextId: next, actorEmail: actor().email });
    if (!rows.length) { setMsg(`${trip.TripID}: enter the Travel / Stay / Local cost, then use “Create vendor rows”.`); return; }
    const res = await pool(rows, r => addVendorService(r), 1);
    const ok = rows.filter((_, i) => !(res[i] instanceof Error)).map(r => r.serviceId);
    if (ok.length) await saveTrip(trip, { 'Vendor Service IDs': [...idsOf(trip['Vendor Service IDs']), ...ok].join('; ') });
    setMsg(`${trip.TripID}: ${ok.length} vendor row(s) created (${ok.join(', ') || '—'})${ok.length < rows.length ? ` · ${rows.length - ok.length} failed` : ''}.`);
  }
  async function setTripStatus(trip, status) {
    const patch = { 'Booking Status': status };
    if (status === 'Booked' && !s(trip['Booked On'])) Object.assign(patch, { 'Booked By': actor().email, 'Booked On': today });
    if (status === 'Shared') patch['Shared With Traveller On'] = today;
    setBusy('Saving trip…');
    try {
      if (!(await saveTrip(trip, patch))) return;
      const now = { ...trip, ...patch };
      const k = s(trip['EC Index']);
      if (['Booked', 'Shared', 'Completed'].includes(status) && !s(trip['Vendor Service IDs'])) await raiseTripVendors(now);
      if (status === 'Shared') {
        const n = notifyItinerary(engByKey[k], now, actor());
        if (!s(now['Traveller Email'])) setMsg(`${trip.TripID} shared · itinerary sent to ${n} Ops owner(s) — add the traveller's email on the trip to send it to them too.`);
      }
      const finish = travelStepsToComplete(tasksRef.current.filter(t => s(t['EC Index']) === k), tripsRef.current.filter(t => s(t['EC Index']) === k), stepsById);
      for (const t of finish) await setStatus(t, 'Done');
      if (finish.length) setMsg(`Travel updated · ${finish.map(t => `“${t.Step}”`).join(', ')} marked Done in the checklist.`);
    } finally { setBusy(''); }
  }
  async function pushTravelToEC(k, total) {
    const eng = engByKey[k];
    if (!window.confirm(`Set the Engagement Calendar "Travel, Stay and Misc Expenses" for ${eng?.Company || k} to ₹${Math.round(total).toLocaleString('en-IN')} (billable trips)? This replaces the current value.`)) return;
    setBusy('Updating Engagement Calendar…');
    try {
      const ec = (await getAllEngagementsCached()).find(r => s(r.engagementKey) === k);
      if (!ec) throw new Error(`Index ${k} not found in the Engagement Calendar`);
      await updateECFinanceAmounts(k, { travelExpenses: Math.round(total) }, ec.startDate, ec);
      setMsg(`Engagement Calendar updated · ${ec.company}: Travel, Stay and Misc Expenses ₹${Math.round(total).toLocaleString('en-IN')}.`);
    } catch (e) { setMsg(`Engagement Calendar not updated: ${e.message || e}`); } finally { setBusy(''); }
  }

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
    let ids;
    try { ids = await liveTaskIds(); } catch (e) { setMsg(`Step not added to open programs — OpsTaskTable could not be read: ${e.message || e}`); return; }
    const made = [];
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
  // Phase bands: late phases + the phase holding the next due step open by default
  const phaseStats = {};
  for (const t of tl) {
    const ph = s(t.row.Phase) || '—'; const p = (phaseStats[ph] ||= { total: 0, done: 0, late: 0, open: 0 });
    if (!t.applicable) continue;
    p.total++; if (t.done) p.done++; else { p.open++; if (t.overdue) p.late++; }
  }
  const nextPh = s(tl.find(t => t.applicable && !t.done && t.due === sum?.nextDue)?.row.Phase) || '—';
  for (const [ph, p] of Object.entries(phaseStats)) p.defaultOpen = !!p.late || ph === nextPh || !Object.values(phaseStats).some(x => x.open);

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
          <button className={tab === 'travel' ? 'on' : ''} onClick={() => setTab('travel')}>Travel desk{data?.travel ? <span>{data.travel.filter(t => !['Completed', 'Cancelled'].includes(s(t['Booking Status']))).length}</span> : null}</button>
          {canEdit && <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Step Library</button>}
        </div>
        <div className="ov2-head-act">
          <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>{loading ? '⟳' : '↺'}</button>
          {canEdit && <button className="btn btn-outline btn-sm" onClick={() => syncFromEc()} disabled={!!busy || loading} title="Copy program details, status and answered steps from the Engagement Calendar">⇅ Sync from EC</button>}
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
        <KPICard label="TAT missed" value={kpi.tat.length} icon="🔴" sub="Programs with a late step" variant={kpi.tat.length ? 'ov2-kpi-alert' : ''}
          list={kpi.tat.map(e => ({ name: e.Company, sub: `${s(e.Topic)} · ${sums[keyOf(e)]?.overdue || 0} late · worst ${sums[keyOf(e)]?.maxLate || 0}d` }))} />
      </div>

      {msg && <div className="ov2-msg" onClick={() => setMsg('')}>{msg} <span>×</span></div>}

      {tab === 'travel' ? (
        <TravelDesk trips={data.travel} engagements={data.engagements} canEdit={canEdit} canDelete={canDelete('ops')} busy={busy}
          onSave={saveTrip} onStatus={setTripStatus} onAddFromConsultants={addTripsFromConsultants} onAddBlank={addBlankTrip}
          onDelete={deleteTrip} onRaiseVendors={raiseTripVendors} onPushEC={pushTravelToEC}
          onCheck={async () => { const rows = await opsListOptional('travel', { force: true }).catch(e => { setMsg(`Travel Desk not loaded: ${e.message || e}`); return tripsRef.current; }); tripsRef.current = rows || []; setData(d => ({ ...d, travel: rows })); setMsg(rows ? `TravelTable found · ${rows.length} trip(s).` : 'TravelTable still not found in Operations Checklist.xlsx.'); travelNotice(rows); }} />
      ) : tab === 'library' ? (
        <StepLibrary steps={data.steps} departments={data.departments} members={data.members} lists={lists} listRows={data.listRows}
          canEdit={canEdit} propagate={propagate} setPropagate={setPropagate} busy={busy}
          onSaveStep={saveLibraryStep} onAddStep={addLibraryStep} onSaveList={saveListValue} onAddList={addListValue}
          onCheckLists={async () => { const rows = await loadLists({ force: true }); setData(d => ({ ...d, listRows: rows })); setMsg(rows ? `ListTable found · ${rows.length} values.` : 'ListTable still not found in Operations Checklist.xlsx.'); }} />
      ) : tab === 'my' ? (
        <OpsOverview timelines={timelines} engByKey={engByKey} phases={lists.phases} myEmail={myEmail} today={today}
          scopeAll={scopeAll} setScopeAll={setScopeAll} canEdit={canEdit} onStatus={setStatus}
          onOpen={k => { setSel(k); setTab('programs'); setStatusF('All'); }} todoIds={todoIds} onTodo={addToTodo} busy={busy} ecIssues={ecIssues} />
      ) : (
        <div className="ov2-grid">
          <div className="card ov2-card ov2-list">
            <div className="ov2-list-filters">
              <input className="form-input wide" placeholder="🔍 Company, topic, EG.ID" value={q} onChange={e => setQ(e.target.value)} />
              <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
                {['Active', 'TAT missed', 'All', ...CHECKLIST_STATUSES].map(x => <option key={x} value={x}>{x === 'Active' ? 'Active checklists' : x === 'All' ? 'All checklists' : x}</option>)}
              </select>
            </div>
            <div className="ov2-list-body">
              {!programs.length && <div className="ov2-empty">No checklists{data.engagements.length ? ' match' : ' yet — open one with “+ New checklist”'}.</div>}
              {programs.map(p => {
                const k = keyOf(p); const m = sums[k] || {};
                return (
                  <button key={k} type="button" className={`ov2-prog${k === sel ? ' sel' : ''}`} onClick={() => { setSel(k); setExpanded(''); setAdding(''); }}>
                    <div className="ov2-prog-top"><b>{p.Company}</b><span>{fmtD(toISO(p['Start Date']))}</span></div>
                    <div className="ov2-prog-mid">
                      <span className="ov2-prog-sub" title={s(p.Topic)}>{s(p.Topic) || '—'}</span>
                      <span className={`ov2-pill ${progPill(m).cls}`}>{progPill(m).text}</span>
                    </div>
                    <div className="ov2-bar" title={`${m.done || 0}/${m.applicable || 0} done`}><i style={{ width: `${m.progress || 0}%` }} /></div>
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
                  <span className={`ov2-pill ${progPill(sum).cls}`} title={sum?.tatMissed ? `${sum.overdue} step(s) past TAT` : ''}>{sum?.tatMissed ? `TAT missed · ${sum.overdue} late · ${sum.maxLate}d` : progPill(sum).text}</span>
                  <span className="ov2-chip">{sum?.done || 0}/{sum?.applicable || 0} · next due {fmtD(sum?.nextDue)}</span>
                  {ecIssues[sel] && <span className="ov2-pill risk" title={`EC Index ${sel} ${ecIssues[sel].current ? `is ${ecIssues[sel].current.company} · ${fmtD(toISO(ecIssues[sel].current.startDate))}` : 'is not in the Engagement Calendar'}`}>
                    EC link wrong{ecIssues[sel].suggest ? ` → EC ${ecIssues[sel].suggest}` : ''}</span>}
                  {canEdit ? <select className="form-input ov2-mini" value={s(eng['Checklist Status']) || 'Not Started'} onChange={e => setChecklistStatus(eng, e.target.value)}>{CHECKLIST_STATUSES.map(x => <option key={x}>{x}</option>)}</select>
                    : <span className="badge badge-gray">{s(eng['Checklist Status'])}</span>}
                  {tl.some(t => todoEligible(t) && !todoIds.has(s(t.row.TaskID))) && (
                    <button className="btn btn-outline btn-sm" disabled={busy === 'todo'} title="Add open steps due within 7 days (and late ones) to To-Do"
                      onClick={() => addToTodo(tl.filter(t => todoEligible(t) && !todoIds.has(s(t.row.TaskID))))}>+ This week → To-Do</button>
                  )}
                </div>
              </div>
              <div className="table-wrap ov2-tl">
                <table className="ov2-table">
                  <thead><tr><th title="Applies to this program" /><th>#</th><th>Step</th><th>Owners</th><th>Due</th><th>Status</th><th>Done on</th></tr></thead>
                  <tbody>
                    {!tl.length && <tr><td colSpan={7} className="ov2-empty">No steps for this program.</td></tr>}
                    {tl.map((t, i) => {
                      const r = t.row; const id = s(r.TaskID); const newPhase = i === 0 || s(tl[i - 1].row.Phase) !== s(r.Phase);
                      const nextT = tl[i + 1];
                      const ph = s(r.Phase) || '—'; const pk = `${sel}|${ph}`; const ps = phaseStats[ph] || {};
                      const isOpen = pk in phaseOpen ? phaseOpen[pk] : ps.defaultOpen;
                      return (
                        <Fragment key={`${id}-${i}`}>
                          {newPhase && <tr className={`ov2-phase${ps.late ? ' late' : ''}`} onClick={() => setPhaseOpen(o => ({ ...o, [pk]: !isOpen }))}>
                            <td colSpan={7}><span className="ov2-caret">{isOpen ? '▾' : '▸'}</span>{ph}
                              <span className="ov2-phase-meta">{ps.late ? <b>{ps.late} late</b> : null}{ps.late ? ' · ' : ''}{ps.done}/{ps.total} done</span></td></tr>}
                          {isOpen && <>
                          <tr className={`ov2-row${t.applicable ? '' : ' na'}${t.overdue ? ' late' : ''}${expanded === id ? ' open' : ''}`}>
                            <td><label className="ov2-switch" title={t.applicable ? 'Mark NA (removes its TAT)' : 'Make applicable'}>
                              <input type="checkbox" checked={t.applicable} disabled={!canEdit} onChange={() => toggleNA(r)} /><span /></label></td>
                            <td className="ov2-muted">{s(r.Seq)}</td>
                            <td className="ov2-step" onClick={() => setExpanded(expanded === id ? '' : id)}>
                              {r.Step}{s(r['Custom Step']) === 'Yes' && <span className="ov2-tag">custom</span>}
                              <div className="ov2-muted">{s(r['Owner Dept'])}{s(r['Waiting On']) && ` · waiting on ${s(r['Waiting On'])}`}</div>
                            </td>
                            <td className="ov2-own">{ownerList(r).length ? <span className="ov2-inits">{ownerList(r).map(n => <i key={n} title={n}>{initialsOf(n)}</i>)}</span> : <span className="ov2-muted">—</span>}</td>
                            <td title={`TAT ${t.tat} · ${tatLabel(t.tat, t.anchor)} · planned start ${fmtD(t.plannedStart)}`}><DueCell t={t} today={today} /></td>
                            <td className="ov2-st-cell">{canEdit && t.applicable
                              ? <select className={`form-input ov2-status ${STATUS_CLS[s(r.Status)] || ''}`} value={s(r.Status) || 'Not Started'} onChange={e => setStatus(r, e.target.value)}>{STATUSES.filter(x => x !== 'NA').map(x => <option key={x}>{x}</option>)}</select>
                              : <span className={`badge badge-${STATUS_CLS[s(r.Status)] || 'gray'}`}>{s(r.Status) || '—'}</span>}
                              {todoIds.has(id) ? <span className="ov2-todo-ic in" title="In To-Do">✓</span>
                                : todoEligible(t) && <button className="ov2-todo-ic" disabled={busy === 'todo'} onClick={() => addToTodo([t])} title="Add to To-Do (Projects)">＋</button>}</td>
                            <td>{!t.done ? null
                              : canEdit ? (
                                <div className="ov2-doneon">
                                  <input key={t.completed} className="form-input ov2-cell" type="date" max={today} defaultValue={t.completed} title="Date this step was done"
                                    onChange={e => { const v = e.target.value; if (v && v !== t.completed && v <= today) patchTask(r, { 'Completed On': v }); }} />
                                  {t.delay ? <small className="ov2-due late">+{t.delay}d late</small> : null}
                                </div>
                              ) : <span className={t.delay ? 'ov2-due late' : ''}>{fmtD(t.completed)}{t.delay ? <small> · +{t.delay}d</small> : ''}</span>}</td>
                          </tr>
                          {expanded === id && (
                            <tr className="ov2-more"><td colSpan={7}>
                              <div className="ov2-more-grid">
                                <div>
                                  {t.step?.what && <p><b>What to do:</b> {t.step.what}</p>}
                                  {t.step?.doneWhen && <p><b>Done when:</b> {t.step.doneWhen}</p>}
                                  {t.step?.vendorCategory && (
                                    <div className="ov2-vendor-links">
                                      <span className="badge badge-mauve">Vendor: {t.step.vendorCategory}</span>
                                      {s(r['Vendor Service IDs']) && <span className="ov2-muted">Vendor rows: {s(r['Vendor Service IDs'])}</span>}
                                      {canEdit && canCreate('vendors') && <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => raiseVendorRequest(t)}>Raise vendor request</button>}
                                      <a className="ov2-link sm" href="/vendors">Open Vendor Services</a>
                                    </div>
                                  )}
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
                            : <tr className="ov2-insert"><td colSpan={7}><button type="button" onClick={() => setAdding(id)}>+ Add step here</button></td></tr>)}
                          </>}
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
