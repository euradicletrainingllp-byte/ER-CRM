/**
 * PROJECT MANAGEMENT (TASK TRACKER)
 * =================================
 * Create projects, assign tasks inside them, and track assigned / pending work by
 * person, team and project. One Excel table (TaskTable, flow TASKS_CRUD): every row is
 * one task for one person; project details repeat on each task of that project.
 * Views: My Tasks · Board · Projects · All tasks. A floating "My Tasks" panel
 * (components/TaskFloat.jsx) shows the same data on every CRM page.
 */
import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { onListChange } from '../services/api.js';
import {
  getTasks, peekTasks, cacheTasks, addTask, updateTask, deleteTask, nextTaskId, nextProjectId, PROJECT_KEYS, tasksConfigured,
} from '../services/tasksApi.js';
import {
  TASK_TEAMS, PROJECT_TYPES, TASK_STATUSES, TASK_PRIORITIES, FIRST_TASK_TITLE, FIRST_TASK_DAYS, BOARD_DONE_DAYS, taskIsOpen,
} from '../config/taskOptions.js';
import {
  useTaskUser, useTaskRights, StatusPill, PrioPill, DueChip, Avatar, dueInfo, isOverdue, byDue, withStatus, groupProjects,
  notifyAssignee, todayIso, addDays, daysFrom, fmtD, fmtAt, norm, newId, Select, Field,
} from '../components/tasksShared.jsx';
import '../styles/leadsVendors.css';
import '../styles/tasks.css';

const EMPTY_TASK = {
  taskId: '', projectId: '', projectName: '', projectType: '', team: '', client: '', projectOwner: '', projectDue: '',
  title: '', description: '', assignedTo: '', assignedBy: '', assignedDate: '', dueDate: '', priority: 'Medium',
  status: 'To do', waitingOn: '', completedDate: '', outputLink: '', updates: [], remarks: '', createdBy: '',
};
const pickProject = p => Object.fromEntries(PROJECT_KEYS.map(k => [k, p?.[k] || '']));
const isLink = v => /^https?:\/\//i.test(String(v || '').trim());

/* ─── Add / edit a task ─── */
function TaskModal({ initial, preset, projects, people, user, saving, onSave, onClose }) {
  const isEdit = !!initial;
  const [f, setF] = useState(() => (isEdit ? { ...EMPTY_TASK, ...initial }
    : { ...EMPTY_TASK, assignedBy: user.name, assignedDate: todayIso(), createdBy: user.name, ...preset }));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const chooseProject = id => {
    const p = projects.find(x => x.projectId === id);
    setF(x => ({ ...x, ...(p ? pickProject(p) : pickProject(null)), team: x.team || p?.teams?.[0] || '' }));
  };
  const valid = f.title.trim() && f.assignedTo.trim();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? `Edit Task · ${f.taskId}` : 'Assign a Task'}</div>
        <datalist id="tk-people">{people.map(n => <option key={n} value={n} />)}</datalist>

        <div className="lv-form-section">Project</div>
        <div className="form-grid">
          <Field label="Project" full>
            <select className="form-input" value={f.projectId} onChange={e => chooseProject(e.target.value)}>
              <option value="">— No project (standalone task) —</option>
              {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectId} · {p.projectName}{p.client ? ` · ${p.client}` : ''}</option>)}
              {f.projectId && !projects.some(p => p.projectId === f.projectId) && <option value={f.projectId}>{f.projectId} · {f.projectName}</option>}
            </select>
          </Field>
        </div>

        <div className="lv-form-section">Task</div>
        <div className="form-grid">
          <Field label="Task Title *" full><input autoFocus className="form-input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Start with a verb: “Send welcome email”, “Print 20 manuals”" /></Field>
          <Field label="Description" full><textarea className="form-input" rows={2} value={f.description} onChange={e => set('description', e.target.value)} placeholder="What does “done” look like?" /></Field>
          <Field label="Assigned To *"><input className="form-input" list="tk-people" value={f.assignedTo} onChange={e => set('assignedTo', e.target.value)} placeholder="One person" /></Field>
          <Field label="Team"><Select value={f.team} options={TASK_TEAMS} onChange={v => set('team', v)} /></Field>
          <Field label="Due Date"><input className="form-input" type="date" value={f.dueDate} onChange={e => set('dueDate', e.target.value)} /></Field>
          <Field label="Priority"><Select value={f.priority} options={TASK_PRIORITIES} onChange={v => set('priority', v)} blank={null} /></Field>
          <Field label="Status"><Select value={f.status} options={TASK_STATUSES} onChange={v => setF(x => withStatus(x, v))} blank={null} /></Field>
          {f.status === 'Waiting on someone'
            ? <Field label="Waiting On"><input className="form-input" list="tk-people" value={f.waitingOn} onChange={e => set('waitingOn', e.target.value)} placeholder="Who / what is it blocked by?" /></Field>
            : <Field label="Assigned By"><input className="form-input" list="tk-people" value={f.assignedBy} onChange={e => set('assignedBy', e.target.value)} /></Field>}
          <Field label="Output Link" full><input className="form-input" value={f.outputLink} onChange={e => set('outputLink', e.target.value.trim())} placeholder="SharePoint / OneDrive link to the deliverable" /></Field>
          <Field label="Remarks" full><textarea className="form-input" rows={2} value={f.remarks} onChange={e => set('remarks', e.target.value)} /></Field>
        </div>

        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-cta" disabled={!valid || saving} onClick={() => onSave(f)}>{saving ? 'Saving…' : isEdit ? 'Update Task' : 'Assign Task'}</button>
          {!valid && <span className="lv-req">Task title and Assigned To are required</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── New / edit a project ─── */
function ProjectModal({ initial, people, user, saving, onSave, onClose }) {
  const isEdit = !!initial;
  const [p, setP] = useState(() => (isEdit ? pickProject(initial)
    : { ...pickProject(null), projectOwner: user.name, projectType: 'Client Engagement' }));
  const [first, setFirst] = useState(() => ({ title: FIRST_TASK_TITLE, assignedTo: user.name, dueDate: addDays(todayIso(), FIRST_TASK_DAYS), team: '' }));
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const valid = p.projectName.trim() && p.projectOwner.trim() && (isEdit || (first.title.trim() && first.assignedTo.trim()));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? `Edit Project · ${initial.projectId}` : 'New Project'}</div>
        <datalist id="tk-people">{people.map(n => <option key={n} value={n} />)}</datalist>
        <div className="lv-form-section">Project</div>
        <div className="form-grid">
          <Field label="Project Name *" full><input autoFocus className="form-input" value={p.projectName} onChange={e => set('projectName', e.target.value)} placeholder="e.g. Zscaler CS Training – Wave 1" /></Field>
          <Field label="Project Type"><Select value={p.projectType} options={PROJECT_TYPES} onChange={v => set('projectType', v)} /></Field>
          <Field label="Client"><input className="form-input" value={p.client} onChange={e => set('client', e.target.value)} placeholder="Blank for internal work" /></Field>
          <Field label="Project Owner *"><input className="form-input" list="tk-people" value={p.projectOwner} onChange={e => set('projectOwner', e.target.value)} placeholder="One accountable person" /></Field>
          <Field label="Project Due Date"><input className="form-input" type="date" value={p.projectDue} onChange={e => set('projectDue', e.target.value)} /></Field>
        </div>
        {isEdit ? (
          <div className="lv-muted" style={{ marginTop: 10 }}>Changes are copied to all {initial.tasks?.length || 0} task(s) of this project.</div>
        ) : (
          <>
            <div className="lv-form-section">First task</div>
            <div className="form-grid">
              <Field label="Task Title *" full><input className="form-input" value={first.title} onChange={e => setFirst(x => ({ ...x, title: e.target.value }))} /></Field>
              <Field label="Assigned To *"><input className="form-input" list="tk-people" value={first.assignedTo} onChange={e => setFirst(x => ({ ...x, assignedTo: e.target.value }))} /></Field>
              <Field label="Team"><Select value={first.team} options={TASK_TEAMS} onChange={v => setFirst(x => ({ ...x, team: v }))} /></Field>
              <Field label="Due Date"><input className="form-input" type="date" value={first.dueDate} onChange={e => setFirst(x => ({ ...x, dueDate: e.target.value }))} /></Field>
            </div>
            <div className="lv-muted" style={{ marginTop: 8 }}>Add more tasks from the project card after saving.</div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-cta" disabled={!valid || saving} onClick={() => onSave(p, isEdit ? null : first)}>{saving ? 'Saving…' : isEdit ? 'Update Project' : 'Create Project'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Task detail drawer ─── */
function TaskDrawer({ task, rights, user, saving, onClose, onEdit, onDelete, onStatus, onUpdate }) {
  const [text, setText] = useState('');
  const [st, setSt] = useState(task.status);
  useEffect(() => { setText(''); setSt(task.status); }, [task.taskId, task.status]);
  const ups = [...(task.updates || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const canP = rights.canProgress(task);
  const Info = ({ label, children }) => <div><dt>{label}</dt><dd>{children || '—'}</dd></div>;
  return (
    <div className="tk-drawer-wrap" onClick={onClose}>
      <aside className="tk-drawer" onClick={e => e.stopPropagation()}>
        <div className="tk-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lv-muted">{task.taskId}{task.projectId ? ` · ${task.projectId} · ${task.projectName}` : ' · No project'}</div>
            <div className="tk-drawer-title">{task.title}</div>
            <div className="tk-chips"><StatusPill value={task.status} /><PrioPill value={task.priority} /><DueChip task={task} /></div>
          </div>
          <button type="button" className="lv-x" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="tk-drawer-body">
          {canP && (
            <div className="tk-status-row">
              {TASK_STATUSES.filter(s => s !== 'Cancelled').map(s => (
                <button key={s} type="button" disabled={saving} className={task.status === s ? 'on' : ''} onClick={() => onStatus(task, s)}>{s}</button>
              ))}
            </div>
          )}
          <dl className="lv-info">
            <Info label="Assigned to">{task.assignedTo}</Info>
            <Info label="Assigned by">{[task.assignedBy, task.assignedDate && fmtD(task.assignedDate)].filter(Boolean).join(' · ')}</Info>
            <Info label="Due date">{task.dueDate && fmtD(task.dueDate)}</Info>
            <Info label="Team">{task.team}</Info>
            {task.waitingOn && <Info label="Waiting on">{task.waitingOn}</Info>}
            {task.completedDate && <Info label="Completed">{fmtD(task.completedDate)}</Info>}
            {task.client && <Info label="Client">{task.client}</Info>}
            {task.projectOwner && <Info label="Project owner">{task.projectOwner}</Info>}
            {task.description && <div className="lv-info-full"><dt>Description</dt><dd>{task.description}</dd></div>}
            {task.outputLink && <div className="lv-info-full"><dt>Output</dt><dd>{isLink(task.outputLink) ? <a href={task.outputLink} target="_blank" rel="noreferrer">Open link ↗</a> : task.outputLink}</dd></div>}
            {task.remarks && <div className="lv-info-full"><dt>Remarks</dt><dd>{task.remarks}</dd></div>}
          </dl>

          <div className="lv-sub">Progress updates · {ups.length}</div>
          {canP && (
            <div className="tk-update-form">
              <textarea className="form-input" rows={2} placeholder="What was done, what's next, what's blocking…" value={text} onChange={e => setText(e.target.value)} />
              <div className="tk-update-btns">
                <select className="form-input" value={st} onChange={e => setSt(e.target.value)} title="Status after this update">
                  {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" disabled={saving || !text.trim()}
                  onClick={() => onUpdate(task, { id: newId(), at: new Date().toISOString(), by: user.name, text: text.trim(), status: st })}>{saving ? 'Saving…' : 'Add update'}</button>
              </div>
            </div>
          )}
          {!ups.length ? <div className="lv-empty">No updates yet.</div> : (
            <ol className="lv-timeline">
              {ups.map(u => (
                <li key={u.id || u.at}>
                  <div className="lv-tl-head"><b>{u.by || 'Someone'}</b>{u.status && <StatusPill value={u.status} />}<span className="lv-muted">{fmtAt(u.at)}</span></div>
                  <div className="lv-tl-comment">{u.text}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="tk-drawer-foot">
          {rights.canEdit(task) && <EditButton onClick={onEdit} title="Edit task" />}
          {rights.canRemove && <DeleteButton onClick={onDelete} title="Delete task" />}
        </div>
      </aside>
    </div>
  );
}

/* ─── Page ─── */
export default function TaskTracker({ onRefreshed }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useTaskUser();
  const rights = useTaskRights(user);

  const [tasks, setTasks] = useState(() => peekTasks() || []);
  const [loading, setLoading] = useState(() => !peekTasks());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('mine');
  const [search, setSearch] = useState('');
  const [teamF, setTeamF] = useState('All');
  const [personF, setPersonF] = useState('All');
  const [projectF, setProjectF] = useState('All');
  const [statusF, setStatusF] = useState('Open');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);          // { type:'task'|'project', initial?, preset? }
  const [openProj, setOpenProj] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = m => { setToast(m); setTimeout(() => setToast(''), String(m).startsWith('❌') ? 9000 : 3000); };
  useEffect(() => onListChange(name => { if (name === 'tasks') setTasks(peekTasks() || []); }), []);
  const load = async () => {
    if (!tasksConfigured()) { setLoading(false); return; }
    if (!peekTasks()) setLoading(true);
    setRefreshing(true); setError(null);
    try { setTasks(await getTasks()); onRefreshed?.(new Date().toLocaleTimeString()); }
    catch (e) { if (peekTasks()) showToast('⚠ Could not refresh from Excel — showing the last saved copy.'); else setError(e); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link from the floating panel or an email: /tasks?task=TK-0012
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('task');
    if (id && tasks.some(t => t.taskId === id)) { setSelected(id); navigate('/tasks', { replace: true }); }
  }, [location.search, tasks]);   // eslint-disable-line react-hooks/exhaustive-deps

  const projects = useMemo(() => groupProjects(tasks), [tasks]);
  const people = useMemo(() => [...new Set([...user.people, ...tasks.flatMap(t => [t.assignedTo, t.assignedBy, t.projectOwner])].filter(Boolean))].sort(), [user.people, tasks]);
  const teams = useMemo(() => [...new Set([...TASK_TEAMS, ...tasks.map(t => t.team).filter(Boolean)])], [tasks]);

  // Search / team / person / project filters (status is applied separately, so the Board can still show Done)
  const base = useMemo(() => {
    const q = norm(search);
    return tasks.filter(t => {
      if (q && ![t.taskId, t.title, t.description, t.projectName, t.projectId, t.client, t.assignedTo, t.remarks].some(v => norm(v).includes(q))) return false;
      if (teamF !== 'All' && t.team !== teamF) return false;
      if (personF !== 'All' && norm(t.assignedTo) !== norm(personF)) return false;
      if (projectF !== 'All' && (projectF === '__none__' ? t.projectId : t.projectId !== projectF)) return false;
      return true;
    });
  }, [tasks, search, teamF, personF, projectF]);
  const filtered = useMemo(() => base.filter(t => {
    if (statusF === 'Open') return taskIsOpen(t);
    if (statusF === 'Overdue') return isOverdue(t);
    return statusF === 'All' || t.status === statusF;
  }).sort(byDue), [base, statusF]);

  const t0 = todayIso();
  // KPIs follow search / team / person / project (the `base` list). The status filter is left out
  // because the cards are themselves an open / done breakdown.
  const open = base.filter(taskIsOpen);
  const mineOpen = open.filter(t => user.isMe(t.assignedTo));
  const kpiProjects = projects.filter(p => (projectF === 'All' || p.projectId === projectF)
    && (personF === 'All' || p.people.some(n => norm(n) === norm(personF)) || norm(p.projectOwner) === norm(personF))
    && (teamF === 'All' || p.teams.includes(teamF))
    && (!search || [p.projectName, p.projectId, p.client, p.projectOwner].some(v => norm(v).includes(norm(search))) || p.tasks.some(t => base.includes(t))));
  const kpi = {
    mine: mineOpen.length, mineOver: mineOpen.filter(isOverdue).length,
    open: open.length, over: open.filter(isOverdue).length,
    week: open.filter(t => t.dueDate && daysFrom(t.dueDate) >= 0 && daysFrom(t.dueDate) <= 7).length,
    active: kpiProjects.filter(p => !['Completed', 'Cancelled'].includes(p.status)).length,
    risk: kpiProjects.filter(p => p.status === 'At risk').length,
    doneMonth: base.filter(t => t.status === 'Done' && String(t.completedDate).slice(0, 7) === t0.slice(0, 7)).length,
  };

  /* ── writes ── */
  const freshList = () => getTasks().catch(() => tasks);   // fresh read → no duplicate IDs
  const saveTask = async (t, isNew) => {
    setSaving(true);
    try {
      if (isNew) {
        const fresh = await freshList();
        const row = { ...t, taskId: nextTaskId(fresh), assignedBy: t.assignedBy || user.name, assignedDate: t.assignedDate || todayIso(), createdBy: t.createdBy || user.name };
        await addTask(row);
        cacheTasks([...fresh, row]);
        const mailed = notifyAssignee(row, user);
        showToast(`✓ Task ${row.taskId} assigned to ${row.assignedTo}${mailed ? ' · email sent' : ''}`);
      } else {
        const prev = tasks.find(x => x.taskId === t.taskId);
        await updateTask(t);
        cacheTasks(tasks.map(x => (x.taskId === t.taskId ? t : x)));
        const mailed = prev && norm(prev.assignedTo) !== norm(t.assignedTo) && notifyAssignee(t, user, true);
        showToast(`✓ Task updated${mailed ? ` · ${t.assignedTo} emailed` : ''}`);
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const quickSave = async next => {
    const prevList = tasks;
    cacheTasks(tasks.map(x => (x.taskId === next.taskId ? next : x)));
    setSaving(true);
    try { await updateTask(next); }
    catch (e) { cacheTasks(prevList); showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const setStatus = (t, s) => quickSave(withStatus(t, s));
  const addUpdate = (t, u) => quickSave({ ...withStatus(t, u.status || t.status), updates: [...(t.updates || []), u] });
  const removeTask = async t => {
    if (!window.confirm(`Delete task ${t.taskId} · ${t.title}? This cannot be undone.`)) return;
    setSaving(true);
    try { await deleteTask(t.taskId); cacheTasks(tasks.filter(x => x.taskId !== t.taskId)); setSelected(null); showToast('✓ Task deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const saveProject = async (p, first) => {
    setSaving(true);
    try {
      if (first) {
        const fresh = await freshList();
        const projectId = nextProjectId(fresh);
        const row = { ...EMPTY_TASK, ...p, projectId, ...first, taskId: nextTaskId(fresh), assignedBy: user.name, assignedDate: todayIso(), createdBy: user.name };
        await addTask(row);
        cacheTasks([...fresh, row]);
        notifyAssignee(row, user);
        setOpenProj(s => new Set(s).add(projectId));
        setView('projects');
        showToast(`✓ Project ${projectId} created`);
      } else {
        const rows = tasks.filter(t => t.projectId === modal.initial.projectId);
        const changed = rows.map(t => ({ ...t, ...p, projectId: t.projectId }));
        for (const r of changed) await updateTask(r);            // one by one: Excel handles it better
        const byId = new Map(changed.map(r => [r.taskId, r]));
        cacheTasks(tasks.map(t => byId.get(t.taskId) || t));
        showToast(`✓ Project updated on ${changed.length} task(s)`);
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const removeProject = async p => {
    if (!window.confirm(`Delete project ${p.projectId} · ${p.projectName} and ALL its ${p.tasks.length} task(s)? This cannot be undone.`)) return;
    setSaving(true);
    let left = tasks;
    try {
      for (const t of p.tasks) { await deleteTask(t.taskId); left = left.filter(x => x.taskId !== t.taskId); }
      showToast(`✓ Project ${p.projectId} deleted`);
    } catch (e) { showToast('❌ Stopped: ' + e.message); }
    finally { cacheTasks(left); setSaving(false); }
  };

  const sel = selected ? tasks.find(t => t.taskId === selected) : null;
  const toggleProj = id => setOpenProj(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!tasksConfigured()) {
    return (
      <div className="tracker-page"><div className="card tk-setup">
        <div className="lv-big">🛠️</div><b>Project Management is almost ready</b>
        <div className="lv-muted">Paste the “Project Management Tracker CRUD” flow URL into <code>src/config/powerAutomate.js</code> → <code>TASKS_CRUD</code>, then deploy.</div>
      </div></div>
    );
  }
  if (loading) return <LoadingState message="Loading Project Management from Excel…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  /* ── small renderers (plain functions, not components) ── */
  const taskRow = (t, { showProject = true } = {}) => (
    <div key={t.taskId} className={`tk-row${isOverdue(t) ? ' late' : ''}${!taskIsOpen(t) ? ' closed' : ''}`} onClick={() => setSelected(t.taskId)}>
      <input type="checkbox" className="tkf-check" checked={t.status === 'Done'} disabled={!rights.canProgress(t) || saving}
        onClick={e => e.stopPropagation()} onChange={() => setStatus(t, t.status === 'Done' ? 'In progress' : 'Done')}
        title={t.status === 'Done' ? 'Mark not done' : 'Mark done'} />
      <div className="tk-row-main">
        <div className="tk-row-title">{t.title || '(untitled task)'}</div>
        <div className="tk-row-sub">
          <span className="lv-id">{t.taskId}</span>
          {showProject && <span>{t.projectName || 'No project'}</span>}
          {t.team && <span>· {t.team}</span>}
          {t.status === 'Waiting on someone' && t.waitingOn && <span>· waiting on {t.waitingOn}</span>}
        </div>
      </div>
      <PrioPill value={t.priority} />
      <DueChip task={t} />
      <StatusPill value={t.status} />
      <Avatar name={t.assignedTo} />
    </div>
  );
  const bucketList = (list, emptyText) => {
    const buckets = [['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['nodate', 'No due date']];
    if (!list.length) return <div className="lv-empty" style={{ margin: 12 }}>{emptyText}</div>;
    return buckets.map(([b, label]) => {
      const items = list.filter(t => dueInfo(t)?.bucket === b);
      return items.length ? <div key={b}><div className={`tk-bucket ${b === 'overdue' ? 'bad' : ''}`}>{label} · {items.length}</div>{items.map(t => taskRow(t))}</div> : null;
    });
  };

  const mineList = filtered.filter(t => user.isMe(t.assignedTo) && taskIsOpen(t));
  const byMeList = filtered.filter(t => user.isMe(t.assignedBy) && !user.isMe(t.assignedTo) && taskIsOpen(t));
  const boardCols = TASK_STATUSES.filter(s => s !== 'Cancelled');
  // Board: open tasks per the filters + Done in the last BOARD_DONE_DAYS days
  const boardTasks = statusF === 'Open' || statusF === 'All' ? base : filtered;
  const shownProjects = projects.filter(p => (projectF === 'All' || p.projectId === projectF)
    && (personF === 'All' || p.people.some(n => norm(n) === norm(personF)) || norm(p.projectOwner) === norm(personF))
    && (teamF === 'All' || p.teams.includes(teamF))
    && (!search || [p.projectName, p.projectId, p.client, p.projectOwner].some(v => norm(v).includes(norm(search))) || p.tasks.some(t => filtered.includes(t)))
    && (statusF !== 'Open' || !['Completed', 'Cancelled'].includes(p.status)));

  return (
    <div className="tracker-page">
      {toast && <div className="lv-toast">{toast}</div>}
      {modal?.type === 'task' && <TaskModal initial={modal.initial} preset={modal.preset} projects={projects} people={people} user={user} saving={saving}
        onClose={() => setModal(null)} onSave={f => saveTask(f, !modal.initial)} />}
      {modal?.type === 'project' && <ProjectModal initial={modal.initial} people={people} user={user} saving={saving}
        onClose={() => setModal(null)} onSave={saveProject} />}
      {sel && <TaskDrawer task={sel} rights={rights} user={user} saving={saving} onClose={() => setSelected(null)}
        onEdit={() => setModal({ type: 'task', initial: sel })} onDelete={() => removeTask(sel)} onStatus={setStatus} onUpdate={addUpdate} />}

      <div className="kpi-compact">
        <div className="kpi-card accent"><div className="kpi-label">My open tasks</div><div className="kpi-value">{kpi.mine}</div><div className="kpi-sub" style={{ color: kpi.mineOver ? 'var(--error)' : undefined }}>{kpi.mineOver} overdue</div></div>
        <div className="kpi-card"><div className="kpi-label">Team open tasks</div><div className="kpi-value">{kpi.open}</div><div className="kpi-sub" style={{ color: kpi.over ? 'var(--error)' : undefined }}>{kpi.over} overdue · {kpi.week} due in 7 days</div></div>
        <div className="kpi-card purple"><div className="kpi-label">Active projects</div><div className="kpi-value">{kpi.active}</div><div className="kpi-sub">{kpi.risk} at risk</div></div>
        <div className="kpi-card green"><div className="kpi-label">Done this month</div><div className="kpi-value">{kpi.doneMonth}</div><div className="kpi-sub">tasks completed</div></div>
      </div>

      <div className="filter-bar lv-filters" style={{ flexShrink: 0 }}>
        <div className="lv-tabs">
          {[['mine', 'My Tasks'], ['board', 'Board'], ['projects', 'Projects'], ['all', 'All tasks']].map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <input className="form-input wide" placeholder="🔍 Task, project, client, person…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input" value={statusF} onChange={e => setStatusF(e.target.value)}>
          {['Open', 'Overdue', 'All', ...TASK_STATUSES].map(s => <option key={s} value={s}>{s === 'Open' ? 'Open tasks' : s === 'All' ? 'All statuses' : s}</option>)}
        </select>
        <select className="form-input" value={teamF} onChange={e => setTeamF(e.target.value)}>
          <option value="All">All teams</option>{teams.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-input" value={personF} onChange={e => setPersonF(e.target.value)}>
          <option value="All">All people</option>{people.map(s => <option key={s}>{s}</option>)}
        </select>
        <select className="form-input" value={projectF} onChange={e => setProjectF(e.target.value)}>
          <option value="All">All projects</option><option value="__none__">No project</option>
          {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectId} · {p.projectName}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing} title="Refresh from Excel">{refreshing ? '⟳' : '↺'}</button>
        <ExportButton page="tasks" filename="Project Management" sheetName="Tasks" rows={() => filtered}
          columns={[['Task ID', 'taskId'], ['Project ID', 'projectId'], ['Project Name', 'projectName'], ['Project Type', 'projectType'], ['Team', 'team'],
            ['Client', 'client'], ['Project Owner', 'projectOwner'], ['Project Due Date', 'projectDue'], ['Task Title', 'title'], ['Description', 'description'],
            ['Assigned To', 'assignedTo'], ['Assigned By', 'assignedBy'], ['Assigned Date', 'assignedDate'], ['Due Date', 'dueDate'], ['Priority', 'priority'],
            ['Status', 'status'], ['Waiting On', 'waitingOn'], ['Completed Date', 'completedDate'], ['Output Link', 'outputLink']].map(([label, key]) => ({ label, key }))
            .concat([{ label: 'Updates', get: t => (t.updates || []).map(u => `${fmtAt(u.at)} · ${u.by} · ${u.status}: ${u.text}`).join('\n') }, { label: 'Remarks', key: 'remarks' }])} />
        {rights.canAdd && <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'project' })}>+ New Project</button>}
        {rights.canAdd && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'task', preset: projectF !== 'All' && projectF !== '__none__' ? { ...pickProject(projects.find(p => p.projectId === projectF)) } : {} })}>+ Assign Task</button>}
      </div>

      <div className="tracker-scroll">
        {view === 'mine' && (
          <div className="tk-two">
            <div className="card"><div className="card-header"><span className="card-title">Assigned to me</span><span className="lv-muted">{mineList.length} open</span></div>
              {bucketList(mineList, '🎉 Nothing pending for you with these filters.')}</div>
            <div className="card"><div className="card-header"><span className="card-title">Assigned by me to others</span><span className="lv-muted">{byMeList.length} open</span></div>
              {bucketList(byMeList, 'No open tasks you assigned to others.')}</div>
          </div>
        )}

        {view === 'board' && (
          <div className="tk-board">
            {boardCols.map(s => {
              const col = boardTasks.filter(t => t.status === s && (s !== 'Done' || !t.completedDate || daysFrom(t.completedDate) >= -BOARD_DONE_DAYS)).sort(byDue);
              return (
                <div key={s} className="tk-col">
                  <div className="tk-col-h"><StatusPill value={s} /><span className="lv-muted">{col.length}</span></div>
                  {col.map(t => (
                    <div key={t.taskId} className={`tk-card${isOverdue(t) ? ' late' : ''}`} onClick={() => setSelected(t.taskId)}>
                      <div className="tk-card-title">{t.title}</div>
                      <div className="tk-card-sub">{t.projectName || 'No project'}</div>
                      <div className="tk-card-foot">
                        <Avatar name={t.assignedTo} /><PrioPill value={t.priority} /><DueChip task={t} />
                        {rights.canProgress(t) && (
                          <select className="tk-mini-select" value={t.status} onClick={e => e.stopPropagation()} onChange={e => setStatus(t, e.target.value)} disabled={saving} title="Move to">
                            {TASK_STATUSES.map(x => <option key={x}>{x}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                  {!col.length && <div className="tk-col-empty">—</div>}
                </div>
              );
            })}
          </div>
        )}

        {view === 'projects' && (
          !shownProjects.length ? <div className="card lv-placeholder"><div className="lv-big">📁</div><b>No projects match these filters</b><div className="lv-muted">Start one with “+ New Project”.</div></div>
            : shownProjects.map(p => {
              const ex = openProj.has(p.projectId);
              return (
                <div key={p.projectId} className="card tk-proj">
                  <div className="tk-proj-head" onClick={() => toggleProj(p.projectId)}>
                    <span className="tk-caret">{ex ? '▾' : '▸'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tk-proj-title"><span className="lv-id">{p.projectId}</span> {p.projectName || '(no name)'} <StatusPill value={p.status} /></div>
                      <div className="lv-muted">{[p.projectType, p.client, p.projectOwner && `owner ${p.projectOwner}`, p.projectDue && `due ${fmtD(p.projectDue)}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="tk-progress" title={`${p.done} of ${p.total} done`}><div style={{ width: `${p.progress}%` }} /></div>
                    <span className="tk-proj-stat"><b>{p.progress}%</b> · {p.done}/{p.total} done{p.overdue ? <span className="tk-due tk-due-bad" style={{ marginLeft: 6 }}>{p.overdue} overdue</span> : null}</span>
                  </div>
                  {ex && (
                    <div className="tk-proj-body">
                      <div className="tk-proj-actions">
                        {rights.canAdd && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'task', preset: { ...pickProject(p), team: p.teams[0] || '' } })}>+ Task</button>}
                        {(rights.canAdd || rights.canEdit(p.tasks[0])) && <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'project', initial: p })}>Edit project</button>}
                        {rights.canRemove && <button className="btn btn-outline btn-sm" onClick={() => removeProject(p)} disabled={saving}>Delete project</button>}
                        <span className="lv-muted">{p.people.length ? `People: ${p.people.join(', ')}` : ''}</span>
                      </div>
                      {p.tasks.map(t => taskRow(t, { showProject: false }))}
                    </div>
                  )}
                </div>
              );
            })
        )}

        {view === 'all' && (
          <div className="card">
            <div className="card-header"><span className="card-title">All tasks</span><span className="lv-muted">{filtered.length} of {tasks.length}</span></div>
            {!filtered.length ? <div className="lv-empty" style={{ margin: 12 }}>No tasks match these filters{tasks.length ? '' : ' — start with “+ New Project” or “+ Assign Task”'}.</div>
              : filtered.map(t => taskRow(t))}
          </div>
        )}
      </div>
    </div>
  );
}
