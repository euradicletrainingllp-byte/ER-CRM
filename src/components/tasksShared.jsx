/**
 * Shared helpers for the Project Management page and the floating "My Tasks" panel.
 */
import { useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { emailPerson } from '../services/notifier.js';
import { taskIsOpen, TASK_CLOSED } from '../config/taskOptions.js';

/* ─── Dates & text ─── */
export const pad2 = n => String(n).padStart(2, '0');
export const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysFrom = iso => Math.round((Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') - Date.parse(todayIso() + 'T00:00:00Z')) / 86400000);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtD = iso => { if (!iso) return '—'; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? iso : `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
export const fmtAt = at => { if (!at) return ''; const d = new Date(at); return isNaN(d) ? at : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
export const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
export const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const initials = name => String(name || '?').split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

/* ─── Status & priority ─── */
const STATUS_TONE = {
  'To do': 'tk-st-todo', 'In progress': 'tk-st-prog', 'Waiting on someone': 'tk-st-wait',
  'In review': 'tk-st-review', 'Done': 'tk-st-done', 'Cancelled': 'tk-st-cancel',
  // derived project statuses
  'Not started': 'tk-st-todo', 'Active': 'tk-st-prog', 'At risk': 'tk-st-risk', 'Completed': 'tk-st-done',
};
export const StatusPill = ({ value }) => <span className={`lv-pill ${STATUS_TONE[value] || 'tk-st-todo'}`}>{value || 'To do'}</span>;
export const PrioPill = ({ value }) => (value ? <span className={`tk-prio tk-prio-${norm(value)}`} title={`${value} priority`}>{value}</span> : null);
export const Avatar = ({ name }) => <span className="tk-avatar" title={name || 'Unassigned'}>{initials(name)}</span>;

/** Due-date label + bucket for an open task. */
export function dueInfo(t) {
  if (!taskIsOpen(t)) return null;
  if (!t.dueDate) return { text: 'No due date', cls: 'tk-due-none', bucket: 'nodate', rank: 9e9 };
  const d = daysFrom(t.dueDate);
  if (d < 0) return { text: `${-d}d overdue`, cls: 'tk-due-bad', bucket: 'overdue', rank: d };
  if (d === 0) return { text: 'Due today', cls: 'tk-due-warn', bucket: 'today', rank: d };
  if (d === 1) return { text: 'Due tomorrow', cls: 'tk-due-warn', bucket: 'week', rank: d };
  if (d <= 7) return { text: `Due ${fmtD(t.dueDate)}`, cls: 'tk-due-ok', bucket: 'week', rank: d };
  return { text: `Due ${fmtD(t.dueDate)}`, cls: 'tk-due-ok', bucket: 'later', rank: d };
}
export const DueChip = ({ task }) => { const i = dueInfo(task); return i ? <span className={`tk-due ${i.cls}`}>{i.text}</span> : null; };
export const isOverdue = t => dueInfo(t)?.bucket === 'overdue';

const PRIO_RANK = { high: 0, medium: 1, low: 2 };
/** Overdue first, then by due date, then priority. */
export const byDue = (a, b) => ((dueInfo(a)?.rank ?? 9e9) - (dueInfo(b)?.rank ?? 9e9))
  || ((PRIO_RANK[norm(a.priority)] ?? 1) - (PRIO_RANK[norm(b.priority)] ?? 1))
  || String(a.taskId).localeCompare(String(b.taskId), undefined, { numeric: true });

/** New status → Completed Date set on Done, cleared otherwise. */
export function withStatus(t, status) {
  return { ...t, status, completedDate: status === 'Done' ? (t.completedDate || todayIso()) : '' };
}

/* ─── Who is signed in ─── */
export function useTaskUser() {
  const { accounts } = useMsal();
  const acc = accounts[0] || {};
  const { permissions } = usePermissionsContext();
  return useMemo(() => {
    const email = String(acc.username || '').toLowerCase();
    const permName = permissions?.[email]?.name || '';
    const msalName = acc.name || '';
    const local = email.split('@')[0];
    const name = msalName || permName || local;
    const keys = new Set([permName, msalName, msalName.split(' ')[0], permName.split(' ')[0], email, local, local.split('.')[0]].map(norm).filter(Boolean));
    const isMe = v => { const n = norm(v); return !!n && (keys.has(n) || keys.has(n.split(' ')[0])); };
    const people = [...new Set(Object.values(permissions || {}).map(p => p?.name).filter(Boolean))].sort();
    return { email, name, isMe, people };
  }, [acc.username, acc.name, permissions]);
}

/** What the signed-in person may do with one task. */
export function useTaskRights(user) {
  const { isAdmin, canCreate, canUpdate, canDelete } = usePermissions();
  return useMemo(() => ({
    canAdd: isAdmin || canCreate('tasks'),
    // Full edit: Update access, or the person who assigned it
    canEdit: t => isAdmin || canUpdate('tasks') || user.isMe(t?.assignedBy) || user.isMe(t?.createdBy),
    // Status + progress updates: also the assignee
    canProgress: t => isAdmin || canUpdate('tasks') || user.isMe(t?.assignedTo) || user.isMe(t?.assignedBy),
    canRemove: isAdmin || canDelete('tasks'),
  }), [isAdmin, canCreate, canUpdate, canDelete, user]);
}

/* ─── Projects (derived from the task rows) ─── */
export function groupProjects(tasks) {
  const m = new Map();
  for (const t of tasks) {
    if (!t.projectId) continue;
    if (!m.has(t.projectId)) m.set(t.projectId, { projectId: t.projectId, tasks: [] });
    const p = m.get(t.projectId);
    p.tasks.push(t);
    // first filled value wins for each project field
    for (const k of ['projectName', 'projectType', 'client', 'projectOwner', 'projectDue']) if (!p[k] && t[k]) p[k] = t[k];
  }
  return [...m.values()].map(p => {
    const real = p.tasks.filter(t => t.status !== 'Cancelled');
    const done = real.filter(t => t.status === 'Done').length;
    const open = p.tasks.filter(taskIsOpen);
    const overdue = open.filter(isOverdue).length;
    const late = p.projectDue && open.length && daysFrom(p.projectDue) < 0;
    const status = !open.length ? (done ? 'Completed' : 'Cancelled')
      : (overdue || late) ? 'At risk'
      : open.some(t => t.status !== 'To do') || done ? 'Active' : 'Not started';
    return {
      ...p, total: real.length, done, open: open.length, overdue, status,
      progress: real.length ? Math.round((done / real.length) * 100) : 0,
      teams: [...new Set(p.tasks.map(t => t.team).filter(Boolean))],
      people: [...new Set(p.tasks.map(t => t.assignedTo).filter(Boolean))],
      tasks: [...p.tasks].sort((a, b) => (TASK_CLOSED.includes(a.status) - TASK_CLOSED.includes(b.status)) || byDue(a, b)),
    };
  }).sort((a, b) => (['Completed', 'Cancelled'].includes(a.status) - ['Completed', 'Cancelled'].includes(b.status))
    || String(b.projectId).localeCompare(String(a.projectId), undefined, { numeric: true }));
}

/* ─── Assignment email (assignee only, never for self-assigned tasks) ─── */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function notifyAssignee(task, user, reassigned = false) {
  if (!task?.assignedTo || user.isMe(task.assignedTo)) return false;
  const link = `${window.location.origin}/tasks?task=${encodeURIComponent(task.taskId)}`;
  const row = (k, v) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : '');
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#2D3047">
    <p>Hi ${esc(task.assignedTo)},</p>
    <p><b>${esc(user.name)}</b> ${reassigned ? 'has re-assigned' : 'has assigned'} a task to you in the EuRadicle CRM.</p>
    <table style="border-collapse:collapse;margin:8px 0 14px">
      ${row('Task', task.title)}${row('Project', task.projectName && `${task.projectName} (${task.projectId})`)}
      ${row('Due date', task.dueDate && fmtD(task.dueDate))}${row('Priority', task.priority)}${row('Details', task.description)}
    </table>
    <p><a href="${link}" style="background:#2D3047;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none">Open task</a></p>
    <p style="color:#6b7280;font-size:12px">Tip: keep the “My Tasks” panel open (bottom-right of every CRM page) to track your daily tasks.</p>
  </div>`;
  return emailPerson({
    to: task.assignedTo,
    subject: `${reassigned ? 'Task re-assigned' : 'New task'}: ${task.title}${task.dueDate ? ` · due ${fmtD(task.dueDate)}` : ''}`,
    html, actor: { email: user.email, name: user.name },
  });
}

/* ─── Small form parts ─── */
export function Select({ value, options, onChange, blank = '— select —', disabled }) {
  return (
    <select className="form-input" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
      {blank !== null && <option value="">{blank}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (old value)</option>}
    </select>
  );
}
export const Field = ({ label, full, children }) => (
  <div className={`form-field${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
);
