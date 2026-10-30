/**
 * FLOATING "MY TASKS" PANEL
 * =========================
 * A small panel that stays on top of every CRM page, so people can track and tick off
 * their daily tasks while working in any other tracker.
 *  - Launcher button bottom-right (just above the Reminders button) with open / overdue counts.
 *  - Drag the panel by its header; position, open/closed state and tab are remembered.
 *  - Tabs: Mine (overdue / today / this week / later / no date), Assigned by me, Done today.
 *  - Tick = Done. Expand a task to change status, add a progress note or open it in full.
 *  - New task: for myself or any CRM user (Admin Panel), in a project or standalone, with team,
 *    due date and priority. The assignee is emailed (CRM Notify). "+ Task in this project" on any
 *    task opens the same form with its project filled in; the assigner can re-assign a task.
 * Shares its data with the Project Management page (both update straight away).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions.js';
import { onListChange } from '../services/api.js';
import { getTasks, peekTasks, cacheTasks, addTask, updateTask, nextTaskId, tasksConfigured } from '../services/tasksApi.js';
import { taskIsOpen, TASK_TEAMS, TASK_PRIORITIES } from '../config/taskOptions.js';
import { PROJECT_KEYS } from '../services/tasksApi.js';
import {
  useTaskUser, useTaskRights, dueInfo, DueChip, StatusPill, byDue, withStatus, todayIso, newId,
  groupProjects, notifyAssignee, mailNote, PersonPicker, norm,
} from './tasksShared.jsx';
import '../styles/tasks.css';

const LS = { open: 'erTaskFloat.open', pos: 'erTaskFloat.pos', tab: 'erTaskFloat.tab' };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked storage — fine */ } };
const QUICK_STATUSES = ['To do', 'In progress', 'Waiting on someone', 'In review'];
const BUCKETS = [
  ['overdue', 'Overdue'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later'], ['nodate', 'No due date'],
];
const PANEL_W = 360;

export default function TaskFloat() {
  const { isAdmin, canAccess } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useTaskUser();
  const rights = useTaskRights(user);
  const allowed = isAdmin || canAccess('tasks');

  const [open, setOpen] = useState(() => lsGet(LS.open) === '1');
  const [tab, setTab] = useState(() => lsGet(LS.tab) || 'mine');
  const [pos, setPos] = useState(() => { try { return JSON.parse(lsGet(LS.pos) || 'null'); } catch { return null; } });
  const [tasks, setTasks] = useState(() => peekTasks() || []);
  const [loaded, setLoaded] = useState(() => !!peekTasks());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [note, setNote] = useState('');
  const [quick, setQuick] = useState('');
  const [quickDue, setQuickDue] = useState(todayIso());
  const [full, setFull] = useState(false);                 // full "New task" form open
  const [qTo, setQTo] = useState('');                     // assignee ('' = me)
  const [qProject, setQProject] = useState('');
  const [qTeam, setQTeam] = useState('');
  const [qPrio, setQPrio] = useState('Medium');
  const [qDesc, setQDesc] = useState('');
  const [info, setInfo] = useState('');
  const drag = useRef(null);
  const panel = useRef(null);

  useEffect(() => onListChange(name => { if (name === 'tasks') { setTasks(peekTasks() || []); setLoaded(true); } }), []);
  useEffect(() => { lsSet(LS.open, open ? '1' : '0'); }, [open]);
  useEffect(() => { lsSet(LS.tab, tab); }, [tab]);

  const refresh = async () => {
    if (!tasksConfigured()) { setErr('The Project Management flow is not set up yet (TASKS_CRUD).'); return; }
    setBusy('refresh'); setErr('');
    try { setTasks(await getTasks()); setLoaded(true); }
    catch { setErr('Could not load tasks from Excel. Try ↺ again.'); }
    finally { setBusy(''); }
  };
  // Load once when first opened, then refresh every 5 minutes while open
  useEffect(() => {
    if (!allowed || !open) return undefined;
    if (!loaded) refresh();
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [allowed, open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => tasks.filter(t => user.isMe(t.assignedTo) && taskIsOpen(t)).sort(byDue), [tasks, user]);
  const delegated = useMemo(() => tasks.filter(t => user.isMe(t.assignedBy) && !user.isMe(t.assignedTo) && taskIsOpen(t)).sort(byDue), [tasks, user]);
  const doneToday = useMemo(() => tasks.filter(t => user.isMe(t.assignedTo) && t.status === 'Done' && t.completedDate === todayIso()), [tasks, user]);
  const projects = useMemo(() => groupProjects(tasks).filter(p => !['Completed', 'Cancelled'].includes(p.status)), [tasks]);
  const overdueN = mine.filter(t => dueInfo(t)?.bucket === 'overdue').length;
  const todayN = mine.filter(t => dueInfo(t)?.bucket === 'today').length;

  /* ── drag the panel by its header ── */
  const onDragStart = e => {
    if (e.button !== 0 || e.target.closest('button, input, select, a')) return;
    const r = panel.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = e => {
    if (!drag.current) return;
    const h = panel.current?.offsetHeight || 400;
    const x = Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - PANEL_W - 8);
    const y = Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - Math.min(h, 120));
    setPos({ x, y });
  };
  const onDragEnd = () => { if (drag.current) { drag.current = null; setPos(p => { if (p) lsSet(LS.pos, JSON.stringify(p)); return p; }); } };
  const resetPos = () => { setPos(null); lsSet(LS.pos, 'null'); };

  /* ── writes (optimistic, reverted on failure) ── */
  const save = async (next, prevList = tasks) => {
    cacheTasks(prevList.map(t => (t.taskId === next.taskId ? next : t)));
    try { await updateTask(next); setErr(''); }
    catch (e) { cacheTasks(prevList); setErr('❌ Not saved: ' + e.message); }
  };
  const setStatus = (t, status) => save(withStatus(t, status));
  const addNote = t => {
    const text = note.trim();
    if (!text) return;
    setNote('');
    save({ ...t, updates: [...(t.updates || []), { id: newId(), at: new Date().toISOString(), by: user.name, text, status: t.status }] });
  };
  const resetQuick = () => { setQuick(''); setQDesc(''); setQTo(''); setQProject(''); setQTeam(''); setQPrio('Medium'); setQuickDue(todayIso()); };
  const startInProject = t => {               // "+ Task in this project"
    setFull(true); setQProject(t.projectId || ''); setQTeam(t.team || ''); setQTo(''); setQuick(''); setQDesc('');
    setTimeout(() => panel.current?.querySelector('.tkf-q-title')?.focus(), 0);
  };
  const quickAdd = async () => {
    const title = quick.trim();
    if (!title || busy) return;
    setBusy('add'); setErr(''); setInfo('');
    try {
      const fresh = await getTasks().catch(() => tasks);      // fresh list → no duplicate Task ID
      const proj = full && qProject ? groupProjects(fresh).find(p => p.projectId === qProject) || projects.find(p => p.projectId === qProject) : null;
      const projectCols = Object.fromEntries(PROJECT_KEYS.map(k => [k, proj?.[k] || '']));
      const to = (full && qTo) || user.name;
      const row = {
        taskId: nextTaskId(fresh), ...projectCols, team: full ? qTeam : '',
        title, description: full ? qDesc.trim() : '', assignedTo: to, assignedBy: user.name, assignedDate: todayIso(), dueDate: quickDue,
        priority: full ? qPrio : 'Medium', status: 'To do', waitingOn: '', completedDate: '', outputLink: '', updates: [], remarks: '', createdBy: user.name,
      };
      await addTask(row);
      cacheTasks([...fresh, row]);
      const mail = notifyAssignee(row, user);
      const self = user.isMe(to);
      setInfo(`✓ ${row.taskId} ${self ? 'added to your tasks' : `assigned to ${to}`}${self ? '' : mailNote(mail, to)}`);
      setTimeout(() => setInfo(''), 6000);
      resetQuick();
      setTab(self ? 'mine' : 'delegated');
    } catch (e) { setErr('❌ Not added: ' + e.message); }
    finally { setBusy(''); }
  };
  const reassign = async (t, to) => {
    if (!to || norm(to) === norm(t.assignedTo)) return;
    const next = { ...t, assignedTo: to, assignedBy: user.name, assignedDate: todayIso() };
    const prevList = tasks;
    cacheTasks(prevList.map(x => (x.taskId === t.taskId ? next : x)));
    try {
      await updateTask(next); setErr('');
      const mail = notifyAssignee(next, user, true);
      setInfo(`✓ ${t.taskId} re-assigned to ${to}${user.isMe(to) ? '' : mailNote(mail, to)}`);
      setTimeout(() => setInfo(''), 6000);
    } catch (e) { cacheTasks(prevList); setErr('❌ Not re-assigned: ' + e.message); }
  };

  if (!allowed) return null;

  const openFull = t => navigate(t ? `/tasks?task=${encodeURIComponent(t.taskId)}` : '/tasks');
  const style = pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 68 };

  // Plain render function (not a component) so the note box keeps focus while typing
  const renderItem = (t, showAssignee = false) => {
    const ex = expanded === t.taskId;
    const can = rights.canProgress(t);
    return (
      <div key={t.taskId} className={`tkf-item${ex ? ' ex' : ''}`}>
        <div className="tkf-row">
          <input type="checkbox" className="tkf-check" checked={t.status === 'Done'} disabled={!can}
            title={can ? (t.status === 'Done' ? 'Mark not done' : 'Mark done') : 'Only the assignee or assigner can change this'}
            onChange={() => setStatus(t, t.status === 'Done' ? 'In progress' : 'Done')} />
          <button type="button" className="tkf-main" onClick={() => { setExpanded(ex ? null : t.taskId); setNote(''); }}>
            <span className="tkf-title">{t.title || '(untitled task)'}</span>
            <span className="tkf-sub">
              {showAssignee ? `→ ${t.assignedTo || 'unassigned'}` : (t.projectName || 'No project')}
              <DueChip task={t} />
              {t.status !== 'To do' && t.status !== 'Done' && <StatusPill value={t.status} />}
            </span>
          </button>
        </div>
        {ex && (
          <div className="tkf-more">
            {can && (
              <div className="tkf-status">
                {QUICK_STATUSES.map(s => (
                  <button key={s} type="button" className={t.status === s ? 'on' : ''} onClick={() => setStatus(t, s)}>{s === 'Waiting on someone' ? 'Waiting' : s}</button>
                ))}
              </div>
            )}
            {t.waitingOn && <div className="tkf-note">Waiting on: <b>{t.waitingOn}</b></div>}
            {(t.updates || []).length > 0 && (
              <div className="tkf-note">Last update: {t.updates[t.updates.length - 1].text}</div>
            )}
            {can && (
              <div className="tkf-addnote">
                <input className="form-input" placeholder="Add a progress note…" value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addNote(t); }} />
                <button type="button" className="btn btn-outline btn-sm" disabled={!note.trim()} onClick={() => addNote(t)}>Add</button>
              </div>
            )}
            {rights.canEdit(t) && (
              <div className="tkf-reassign">
                <span>Assigned to</span>
                <PersonPicker className="form-input" value={t.assignedTo} users={user.users} blank={null} onChange={v => reassign(t, v)} title="Re-assign (the new person is emailed)" />
              </div>
            )}
            <div className="tkf-links">
              {rights.canAdd && (
                <button type="button" className="tkf-link" onClick={() => startInProject(t)}>
                  + {t.projectId ? `Task in ${t.projectName || t.projectId}` : 'New task'}
                </button>
              )}
              <button type="button" className="tkf-link" onClick={() => openFull(t)}>Open {t.taskId} ↗</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!open) {
    return (
      <button type="button" className="tkf-launch" onClick={() => setOpen(true)} title="My Tasks — track your daily tasks">
        ✅ My Tasks
        {mine.length > 0 && <span className="tkf-count">{mine.length}</span>}
        {overdueN > 0 && <span className="tkf-count bad">{overdueN}</span>}
      </button>
    );
  }

  const list = tab === 'mine' ? mine : tab === 'delegated' ? delegated : doneToday;
  return (
    <div ref={panel} className="tkf-panel" style={style} role="dialog" aria-label="My Tasks">
      <div className="tkf-head" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onDoubleClick={resetPos}
        title="Drag to move · double-click to put it back in the corner">
        <span className="tkf-grip">⋮⋮</span>
        <span className="tkf-h-title">My Tasks</span>
        <span className="tkf-h-sub">{mine.length} open{overdueN ? ` · ${overdueN} overdue` : ''}{todayN ? ` · ${todayN} today` : ''}</span>
        <button type="button" className="tkf-icon" onClick={refresh} disabled={busy === 'refresh'} title="Refresh from Excel">{busy === 'refresh' ? '⟳' : '↺'}</button>
        {location.pathname !== '/tasks' && <button type="button" className="tkf-icon" onClick={() => openFull()} title="Open Project Management">↗</button>}
        <button type="button" className="tkf-icon" onClick={() => setOpen(false)} title="Minimise">—</button>
      </div>

      <div className="tkf-tabs">
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Mine <b>{mine.length}</b></button>
        <button className={tab === 'delegated' ? 'on' : ''} onClick={() => setTab('delegated')}>Assigned by me <b>{delegated.length}</b></button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Done today <b>{doneToday.length}</b></button>
      </div>

      {err && <div className="tkf-err">{err}</div>}
      {info && <div className="tkf-info">{info}</div>}

      <div className="tkf-body">
        {!loaded && !err ? <div className="tkf-empty">Loading tasks…</div>
          : !list.length ? (
            <div className="tkf-empty">
              {tab === 'mine' ? '🎉 Nothing pending. Add a task below or pick one up in Project Management.'
                : tab === 'delegated' ? 'No open tasks assigned by you to others.' : 'Nothing ticked off yet today.'}
            </div>
          ) : tab === 'mine' ? BUCKETS.map(([b, label]) => {
            const items = mine.filter(t => dueInfo(t)?.bucket === b);
            return items.length ? (
              <div key={b} className="tkf-group">
                <div className={`tkf-group-h ${b === 'overdue' ? 'bad' : ''}`}>{label} · {items.length}</div>
                {items.map(t => renderItem(t))}
              </div>
            ) : null;
          }) : list.map(t => renderItem(t, tab === 'delegated'))}
      </div>

      {rights.canAdd && (
        <div className={`tkf-quick${full ? ' full' : ''}`}>
          {full && (
            <div className="tkf-q-head">
              <b>New task</b>
              <button type="button" className="tkf-icon" onClick={() => { setFull(false); resetQuick(); }} title="Close">✕</button>
            </div>
          )}
          <div className="tkf-q-line">
            <input className="form-input tkf-q-title" placeholder={full ? 'Task title — start with a verb' : '+ Add a task for myself…'} value={quick}
              onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') quickAdd(); }} disabled={busy === 'add'} />
            {!full && <input className="form-input tkf-date" type="date" value={quickDue} onChange={e => setQuickDue(e.target.value)} title="Due date" />}
            {!full && <button type="button" className="btn btn-primary btn-sm" disabled={!quick.trim() || busy === 'add'} onClick={quickAdd}>{busy === 'add' ? '…' : 'Add'}</button>}
          </div>
          {full ? (
            <>
              <div className="tkf-q-grid">
                <label>Assign to
                  <PersonPicker value={qTo || user.pickName} users={user.users} blank={null} onChange={setQTo} />
                </label>
                <label>Project
                  <select className="form-input" value={qProject} onChange={e => {
                    const id = e.target.value; setQProject(id);
                    const p = projects.find(x => x.projectId === id);
                    if (p && !qTeam && p.teams?.[0]) setQTeam(p.teams[0]);
                  }}>
                    <option value="">— No project —</option>
                    {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectId} · {p.projectName}</option>)}
                  </select>
                </label>
                <label>Team
                  <select className="form-input" value={qTeam} onChange={e => setQTeam(e.target.value)}>
                    <option value="">— Team —</option>
                    {TASK_TEAMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>Due date
                  <input className="form-input" type="date" value={quickDue} onChange={e => setQuickDue(e.target.value)} />
                </label>
                <label>Priority
                  <select className="form-input" value={qPrio} onChange={e => setQPrio(e.target.value)}>
                    {TASK_PRIORITIES.map(p => <option key={p}>{p}</option>)}
                  </select>
                </label>
              </div>
              <textarea className="form-input tkf-q-desc" rows={2} placeholder="Details (optional) — what does “done” look like?" value={qDesc} onChange={e => setQDesc(e.target.value)} />
              <div className="tkf-q-foot">
                <span className="tkf-q-hint">
                  {qTo && !user.isMe(qTo) ? (user.emailOf(qTo) ? `✉ ${qTo} will be emailed` : `⚠ No email for ${qTo} in Admin Panel`) : 'For myself'}
                </span>
                <button type="button" className="btn btn-cta btn-sm" disabled={!quick.trim() || busy === 'add'} onClick={quickAdd}>
                  {busy === 'add' ? 'Saving…' : qTo && !user.isMe(qTo) ? 'Assign task' : 'Add task'}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="tkf-link tkf-q-more" onClick={() => setFull(true)}>+ Assign to someone / add to a project</button>
          )}
        </div>
      )}
    </div>
  );
}
