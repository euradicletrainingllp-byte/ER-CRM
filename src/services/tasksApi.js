/**
 * EURADICLE CRM — PROJECT MANAGEMENT (TASK TRACKER) data layer
 * ==============================================================
 * ONE Excel table (Task_Tracker / Project_Management_Tracker.xlsx → TaskTable), ONE
 * Power Automate flow (TASKS_CRUD). Every row is one task for one person; the project's
 * details (Project ID, Name, Type, Client, Owner, Project Due Date) repeat on every task
 * of that project and are kept in step by the CRM.
 *
 * The flow passes the whole body to Excel as the row:
 *   Row = removeProperty(removeProperty(triggerBody(), 'action'), 'sno')
 * so the body must hold ONLY 'action', 'sno' and exact Excel headers — nothing else.
 */
import FLOW_URLS from '../config/powerAutomate.js';
import { _callFlow as callFlow, _getField as getField, _formatDate as formatDate, _withReadRetry as withReadRetry,
  _rememberList as rememberList, _withDecodedKeys as withDecodedKeys, peekList } from './api.js';

const txt = v => String(v ?? '').trim();
const variants = h => [h, h.replace(/ /g, '_'), h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]/g, '')];

export const TASK_COLS = {
  taskId: 'Task ID', projectId: 'Project ID', projectName: 'Project Name', projectType: 'Project Type', team: 'Team',
  client: 'Client', projectOwner: 'Project Owner', projectDue: 'Project Due Date', title: 'Task Title',
  description: 'Description', assignedTo: 'Assigned To', assignedBy: 'Assigned By', assignedDate: 'Assigned Date',
  dueDate: 'Due Date', priority: 'Priority', status: 'Status', waitingOn: 'Waiting On', completedDate: 'Completed Date',
  outputLink: 'Output Link', updates: 'Updates', remarks: 'Remarks', createdBy: 'Created By',
};
// Project-level fields: the same on every task of a project
export const PROJECT_KEYS = ['projectId', 'projectName', 'projectType', 'client', 'projectOwner', 'projectDue'];
const DATES = new Set(['projectDue', 'assignedDate', 'dueDate', 'completedDate']);

export function parseUpdates(raw) {
  if (Array.isArray(raw)) return raw;
  const s = txt(raw);
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []; }
  catch { return [{ id: 'u0', at: '', by: '', text: s, status: '' }]; }   // text typed in Excel is kept as one note
}

function readRow(raw) {
  const r = withDecodedKeys(raw);
  const out = {};
  for (const [k, h] of Object.entries(TASK_COLS)) {
    const v = getField(r, ...variants(h));
    out[k] = DATES.has(k) ? formatDate(v) : txt(v);
  }
  out.updates = parseUpdates(out.updates);
  out.sno = out.taskId;
  return out;
}

/** CRM task → Excel body (exact headers only). Empty dates are left out on create. */
function toBody(task, { create }) {
  const body = {};
  for (const [k, h] of Object.entries(TASK_COLS)) {
    let v = task[k];
    if (Array.isArray(v)) v = v.length ? JSON.stringify(v) : '';
    v = v == null ? '' : v;
    if (create && DATES.has(k) && !v) continue;
    body[h] = String(v);
  }
  return body;
}

const rowsOf = data => (Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : []);

function nextId(rows, key, prefix, width) {
  const max = Math.max(0, ...rows.map(r => Number(String(r[key] || '').replace(/\D/g, '')) || 0));
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}
export const nextTaskId = rows => nextId(rows, 'taskId', 'TK-', 4);
export const nextProjectId = rows => nextId(rows, 'projectId', 'PR-', 3);

export const tasksConfigured = () => !!FLOW_URLS.TASKS_CRUD;

async function fetchTasks() {
  const data = await callFlow('TASKS_CRUD', { action: 'get' });
  return rowsOf(data).map(readRow).filter(r => r.taskId || r.title);
}
/** Load from Excel and share with every open view (page + floating panel). */
export async function getTasks() { return rememberList('tasks', await withReadRetry(fetchTasks)); }
/** Last loaded tasks (memory / browser copy) — never hits the network. */
export const peekTasks = () => peekList('tasks');
/** Replace the shared copy after a save, so every open view updates at once. */
export const cacheTasks = rows => rememberList('tasks', rows);

export async function addTask(task) {
  return callFlow('TASKS_CRUD', { action: 'create', sno: task.taskId, ...toBody(task, { create: true }) });
}
export async function updateTask(task) {
  if (!txt(task.taskId)) throw new Error('This task has no Task ID in Excel, so it cannot be saved. Type an ID (e.g. TK-0042) in its Task ID cell, then Refresh.');
  return callFlow('TASKS_CRUD', { action: 'update', sno: task.taskId, ...toBody(task, { create: false }) });
}
export async function deleteTask(taskId) {
  return callFlow('TASKS_CRUD', { action: 'delete', sno: taskId });
}
