/**
 * opsV2Engine.js — pure rules for Operations Checklist v2 (no network).
 *  - Timeline: TAT is counted from the program Start Date (End Date for End-anchored steps):
 *    "2" (no sign) or "-2" = 2 days before, "+2" = 2 days after, "0" = on the day. NA steps get no dates.
 *  - At-risk: an open pre-program step is overdue before the program starts.
 *  - Owners: Step Library default owners, else all members of the step's Owner Dept (DeptMemberTable).
 * Design: project doc claude/ops-checklist-v2-design.md
 */
export const STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Blocked', 'Done', 'NA'];
export const CHECKLIST_STATUSES = ['Not Started', 'In Preparation', 'Delivered', 'Closed'];
export const WAITING_ON = ['Internal', 'Client', 'Consultant', 'Vendor'];

const s = v => String(v ?? '').trim();
const lc = v => s(v).toLowerCase();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, '0');

// ── Dates (ISO yyyy-mm-dd, day arithmetic in UTC) ─────────────────────────────
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : todayISO(v);
  const t = s(v);
  if (/^\d+(\.\d+)?$/.test(t)) {                       // Excel serial
    const n = Number(t);
    if (n < 25000 || n > 80000) return '';
    return new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
  }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);  // dd/mm/yyyy (India)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(t);
  return isNaN(d) ? '' : todayISO(d);
}
export function addDays(iso, n) {
  if (!iso) return '';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + Math.round(n))).toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : 0);

// ── Emails ────────────────────────────────────────────────────────────────────
export const splitEmails = v => [...new Set(s(v).split(/[;,\s]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))];
export const joinEmails = list => [...new Set((list || []).map(e => lc(e)).filter(Boolean))].join('; ');

// ── Engagement / step helpers ─────────────────────────────────────────────────
export const modeOf = location => (/vilt|virtual|online/i.test(s(location)) ? 'Virtual' : 'In-person');
export const engMode = eng => s(eng?.Mode) || modeOf(eng?.Location);

/** Step Library value "All" / blank / "A, B" against the engagement value. */
export function appliesTo(stepVal, engVal) {
  const opts = s(stepVal).split(/[,;/]/).map(lc).filter(Boolean);
  if (!opts.length || opts.includes('all')) return true;
  const v = lc(engVal);
  return !!v && opts.some(o => v === o || v.includes(o));
}

export function normStep(r) {
  return {
    id: s(r.StepID), seq: num(r.Seq), phase: s(r.Phase), step: s(r.Step),
    what: s(r['What to do']), doneWhen: s(r['Done when']), dept: s(r['Owner Dept']),
    ownerEmails: s(r['Owner Emails'] ?? r['Default Owner Email']), anchor: lc(r.Anchor) === 'end' ? 'End' : 'Start',
    offset: num(r['Offset Days']), tat: fmtTat(r['TAT (days)']),
    mode: s(r['Applies To Mode']), offering: s(r['Applies To Offering']),
    required: s(r['Required/Optional'] ?? r.Required) || 'Required',
    remindBefore: num(r['Remind Before (days)']), escalateAfter: num(r['Escalate After (days)']),
    escalateTo: s(r['Escalate To']), active: !/^(no|false|0)$/i.test(s(r.Active)),
  };
}

/** Owner Dept can hold several departments: "Operations; Finance". */
export const splitDepts = v => [...new Set(s(v).split(';').map(x => x.trim()).filter(Boolean))];
export const joinDepts = list => [...new Set((list || []).map(x => s(x)).filter(Boolean))].join('; ');

/** Owners of one or more departments: every member in Admin Panel DeptMemberTable. */
export function ownersForDept(deptNames, departments = [], members = []) {
  const names = splitDepts(deptNames).map(lc);
  const ids = departments.filter(d => names.includes(lc(d.name)) && d.active !== false).map(d => d.id);
  const seen = new Set();
  return members.filter(m => ids.includes(m.deptId) && m.email && !seen.has(m.email) && seen.add(m.email))
    .map(m => ({ email: m.email, name: m.name || m.email.split('@')[0] }));
}

/** Step owners: Step Library default owners first, else every member of the Owner Dept. */
export function resolveOwners(st, departments = [], members = []) {
  const fixed = splitEmails(st?.ownerEmails);
  if (fixed.length) return fixed.map(e => ({ email: e, name: members.find(m => m.email === e)?.name || e.split('@')[0] }));
  return ownersForDept(st?.dept, departments, members);
}

// ── Step Library writes (column names follow the live StepTable) ─────────────
const STEP_COLS = {
  id: ['StepID'], seq: ['Seq'], phase: ['Phase'], step: ['Step'], what: ['What to do'], doneWhen: ['Done when'],
  dept: ['Owner Dept'], ownerEmails: ['Owner Emails', 'Default Owner Email'], anchor: ['Anchor'], offset: ['Offset Days'],
  tat: ['TAT (days)'], mode: ['Applies To Mode'], offering: ['Applies To Offering'], required: ['Required/Optional', 'Required'],
  remindBefore: ['Remind Before (days)'], escalateAfter: ['Escalate After (days)'], escalateTo: ['Escalate To'], active: ['Active'],
};
export const stepColumns = sample => Object.fromEntries(Object.entries(STEP_COLS).map(([k, c]) => [k, (sample && c.find(x => x in sample)) || c[0]]));
export function stepPatch(fields, cols) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (cols[k]) out[cols[k]] = k === 'active' ? (v ? 'Yes' : 'No') : v;
  return out;
}
/** Step fields that are copied to not-done tasks of open checklists. */
export const STEP_SYNC_FIELDS = ['step', 'phase', 'seq', 'tat', 'dept', 'ownerEmails'];
export const taskPatchFromStep = (st, owners) => ({
  Step: st.step, Phase: st.phase, Seq: st.seq, 'TAT (days)': st.tat, 'Owner Dept': st.dept,
  'Owner Emails': joinEmails(owners.map(o => o.email)), 'Owner Names': owners.map(o => o.name).join('; '),
});
/** Only the fields whose value differs from the task row. */
export const diffRow = (row, patch) => Object.fromEntries(Object.entries(patch).filter(([k, v]) => s(row[k]) !== s(v)));

/** Values of one list (ListTable: ListID, List, Value, Order, Active), or the fallback. */
export function listValues(rows, name, fallback = []) {
  const v = (rows || []).filter(r => lc(r.List) === lc(name) && !/^(no|false|0)$/i.test(s(r.Active)) && s(r.Value))
    .sort((a, b) => num(a.Order) - num(b.Order)).map(r => s(r.Value));
  return v.length ? v : fallback;
}

export function nextNumberId(prefix, ids, pad = 5) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  const n = ids.map(i => (s(i).match(re) || [])[1]).filter(Boolean).map(Number);
  return `${prefix}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(pad, '0')}`;
}

/** Seq for a step inserted after `prev` (and before `next`, if any). */
export function seqBetween(prev, next) {
  const a = num(prev);
  if (next == null || next === '') return a + 10;
  const b = num(next);
  const mid = Math.floor((a + b) / 2);
  return mid > a && mid < b ? mid : Math.round(((a + b) / 2) * 100) / 100;
}

// ── TAT: "2" / "-2" = days before the anchor date, "+2" = days after ─────────
export function parseTat(v) {
  const t = s(v).replace(/\s+/g, '');
  const after = t.startsWith('+');
  const days = Math.round(Math.abs(parseFloat(t.replace(/^[+-]/, '')) || 0));
  return { days, after: after && days > 0 };
}
/** Days to add to the anchor date (negative = before). */
export const tatOffset = v => { const { days, after } = parseTat(v); return after ? days : -days; };
/** Normalised text stored in Excel: "2" (before) or "+2" (after). */
export const fmtTat = v => { const { days, after } = parseTat(v); return after ? `+${days}` : String(days); };
/** Short label: "2d before", "+2d after", "on the day". */
export const tatLabel = (v, anchor = 'Start') => {
  const { days, after } = parseTat(v);
  const at = anchor === 'End' ? 'end' : 'start';
  return !days ? `on ${at}` : after ? `+${days}d after ${at}` : `${days}d before ${at}`;
};
export const isValidTat = v => /^[+-]?\d+$/.test(s(v).replace(/\s+/g, ''));

export const isApplicable = r => s(r.Applicable) !== 'NA' && s(r.Status) !== 'NA';
export const isDone = r => s(r.Status) === 'Done';

// ── Timeline ──────────────────────────────────────────────────────────────────
/**
 * TAT from the program dates (2026-11-22 17:15):
 *   Due = anchor date (Start Date; End Date for End-anchored steps) − TAT, or + TAT when TAT has a "+" sign.
 *   "2" = 2 days before start · "+2" = 2 days after start · "0" = on the start day.
 *   Pre-program step = Start-anchored and not "+" (counts for At risk / short lead).
 *   Planned Start = previous applicable step's due (first: Checklist Created On), never after Due.
 * Returns one entry per task row (Seq order):
 * { row, step, anchor, applicable, done, tat, plannedStart, due, completed, overdue, preProgram, shortLead, delay }
 */
export function buildTimeline(taskRows, eng, stepsById = {}, today = todayISO()) {
  const rows = [...(taskRows || [])].sort((a, b) => num(a.Seq) - num(b.Seq));
  const created = toISO(eng?.['Checklist Created On']) || today;
  const start = toISO(eng?.['Start Date']) || created;
  const end = toISO(eng?.['End Date']) || start;
  let prevDue = created;
  let lastAnchor = 'Start';
  return rows.map(row => {
    const step = stepsById[s(row.StepID)];
    const anchor = step?.anchor || lastAnchor;       // custom steps take the anchor of the step before
    lastAnchor = anchor;
    const tat = fmtTat(row['TAT (days)']);
    const applicable = isApplicable(row);
    const done = isDone(row);
    const completed = toISO(row['Completed On']);
    const preProgram = anchor === 'Start' && !parseTat(tat).after;
    if (!applicable) return { row, step, anchor, applicable, done, tat, plannedStart: '', due: '', completed, overdue: false, preProgram, shortLead: false, delay: 0 };
    const due = addDays(anchor === 'End' ? end : start, tatOffset(tat));
    const plannedStart = prevDue < due ? prevDue : due;
    if (due > prevDue) prevDue = due;
    const overdue = !done && due < today;
    const shortLead = preProgram && due < created;   // already due when the checklist was opened
    const delay = done && completed ? Math.max(0, daysBetween(due, completed)) : (overdue ? daysBetween(due, today) : 0);
    return { row, step, anchor, applicable, done, tat, plannedStart, due, completed, overdue, preProgram, shortLead, delay };
  });
}

/** Rows whose stored Planned Start / Due Date differ from the timeline → [{ id, patch }]. */
export function datePatches(timeline) {
  const out = [];
  for (const t of timeline) {
    const patch = {};
    if (toISO(t.row['Planned Start']) !== t.plannedStart) patch['Planned Start'] = t.plannedStart;
    if (toISO(t.row['Due Date']) !== t.due) patch['Due Date'] = t.due;
    if (Object.keys(patch).length) out.push({ id: s(t.row.TaskID), patch });
  }
  return out;
}

export function summarise(timeline, eng, today = todayISO()) {
  const app = timeline.filter(t => t.applicable);
  const doneN = app.filter(t => t.done).length;
  const open = app.filter(t => !t.done);
  const nextDue = open.map(t => t.due).filter(Boolean).sort()[0] || '';
  const start = toISO(eng?.['Start Date']);
  return {
    applicable: app.length, done: doneN, open: open.length,
    progress: app.length ? Math.round((doneN / app.length) * 100) : 0,
    overdue: open.filter(t => t.overdue).length,
    dueThisWeek: open.filter(t => t.due >= today && t.due <= addDays(today, 7)).length,
    // At risk = a pre-program step is overdue and the program has not started yet
    atRisk: !!start && start >= today && open.some(t => t.preProgram && t.overdue),
    lastPreDue: app.filter(t => t.preProgram).map(t => (t.done ? t.completed || t.due : t.due)).sort().pop() || '',
    nextDue, start,
  };
}

// ── Checklist generation ──────────────────────────────────────────────────────
/** Engagement row (EngagementTable) from a mapped Engagement Calendar record (api.js). */
export function engagementFromEC(ec, { actorEmail = '', today = todayISO() } = {}) {
  return {
    'EC Index': s(ec.engagementKey), 'EG.ID': s(ec.egId), Company: s(ec.company), 'Client SPOC': s(ec.clientSpoc),
    'Start Date': toISO(ec.startDate), 'End Date': toISO(ec.endDate) || toISO(ec.startDate),
    Topic: s(ec.topic), Sector: s(ec.sector), 'Service Type': s(ec.serviceType), Offering: s(ec.offering),
    Location: s(ec.locationRaw || ec.location), Days: ec.day || '', 'No of Participants': ec.pax || '',
    'Consultant 1': s(ec.consultant1), 'Consultant 2': s(ec.consultant2), 'Consultant 3': s(ec.consultant3),
    'EC Status': s(ec.status), 'Contract Type': s(ec.contract), 'Contract Status': s(ec.poStatus),
    'Internal POC': s(ec.internalPoc), 'Ops Owner Emails': lc(actorEmail),
    'Checklist Status': 'In Preparation', 'Checklist Created On': today, 'Synced From EC On': today, 'BD Notes': '',
  };
}

export const stepFits = (st, eng) => appliesTo(st.mode, engMode(eng)) && appliesTo(st.offering, eng?.Offering);

/** One task row for an engagement from a Step Library step (dates left blank for the timeline). */
export function taskFromStep(st, eng, { departments = [], members = [], taskId, actorEmail = '', today = todayISO() }) {
  const fits = stepFits(st, eng);
  return {
    TaskID: taskId, 'EG.ID': s(eng['EG.ID']), 'EC Index': s(eng['EC Index']), Company: s(eng.Company), 'Program Start': toISO(eng['Start Date']),
    StepID: st.id, ...taskPatchFromStep(st, resolveOwners(st, departments, members)),
    Applicable: fits ? 'Yes' : 'NA', Status: fits ? 'Not Started' : 'NA',
    'Planned Start': '', 'Due Date': '', 'Started On': '', 'Completed On': '',
    'Waiting On': '', 'Blocked Reason': '', Comments: '', 'Evidence Link': '', 'Last Reminder On': '',
    'Reminder Count': 0, Escalated: 'No', 'Custom Step': 'No', 'Added By': lc(actorEmail), 'Updated On': today,
  };
}

/**
 * Task rows for one engagement from the Step Library (dates filled by the timeline).
 * Steps that do not fit the engagement's Mode / Offering come in as NA, so they can be switched on.
 */
export function generateTasks({ steps, eng, departments = [], members = [], existingTaskIds = [], actorEmail = '', today = todayISO() }) {
  const ids = [...existingTaskIds];
  const rows = steps.filter(st => st.active && st.id).sort((a, b) => a.seq - b.seq).map(st => {
    const TaskID = nextNumberId('T', ids); ids.push(TaskID);
    return taskFromStep(st, eng, { departments, members, taskId: TaskID, actorEmail, today });
  });
  const stepsById = Object.fromEntries(steps.map(st => [st.id, st]));
  for (const t of buildTimeline(rows, eng, stepsById, today)) {
    t.row['Planned Start'] = t.plannedStart; t.row['Due Date'] = t.due;
  }
  return rows;
}

/** Next applicable, not-done step after `taskId` in the timeline. */
export function nextOpenAfter(timeline, taskId) {
  const i = timeline.findIndex(t => s(t.row.TaskID) === s(taskId));
  return i < 0 ? null : timeline.slice(i + 1).find(t => t.applicable && !t.done) || null;
}
