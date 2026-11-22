/**
 * opsV2Data.js — read-only Ops Checklist v2 summary for other pages
 * (Dashboard, Founder's Desk, action items, Client / Consultant 360, Finance invoice owner).
 * Replaces the old Ops Checklist flow (OPS_CHECKLIST_CRUD, removed 2026-11-22).
 *
 * One row per program (EngagementTable), shaped like the old Ops rows where pages relied on it:
 * { engagementKey, sno, egId, company, topic, startDate, endDate, status (EC Status), checklistStatus,
 *   consultant1-3, internalPoc, ready (% done), openItems, lateItems (overdue), atRisk, nextDue,
 *   invoicePoc, invoiceComment, tasks: [{ taskId, stepId, step, phase, due, status, done, completed, overdue, ownerNames, comments }] }
 */
import { opsList, isOpsV2Ready } from './opsV2Api.js';
import { normStep, buildTimeline, summarise, toISO, todayISO } from './opsV2Engine.js';

const s = v => String(v ?? '').trim();
const STORE = 'ercrm:list:ops-v2';
const MAX_AGE = 12 * 3600 * 1000;
let mem = null;
let loading = null;
const listeners = new Set();

export const clScore = p => Number(p?.ready) || 0;
export const onOpsProgramsChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function programsFrom(stepRows = [], engRows = [], taskRows = [], today = todayISO()) {
  const byId = Object.fromEntries(stepRows.map(normStep).filter(x => x.id).map(x => [x.id, x]));
  const byEng = {};
  for (const t of taskRows) (byEng[s(t['EC Index'])] ||= []).push(t);
  return engRows.filter(e => s(e['EC Index'])).map(e => {
    const k = s(e['EC Index']);
    const tl = buildTimeline(byEng[k] || [], e, byId, today);
    const m = summarise(tl, e, today);
    const inv = tl.find(t => t.applicable && (s(t.row.StepID) === 'OPS-300' || /invoice raised/i.test(s(t.row.Step))));
    return {
      engagementKey: k, sno: k, egId: s(e['EG.ID']), company: s(e.Company), topic: s(e.Topic),
      startDate: toISO(e['Start Date']), endDate: toISO(e['End Date']) || toISO(e['Start Date']),
      status: s(e['EC Status']), checklistStatus: s(e['Checklist Status']),
      consultant1: s(e['Consultant 1']), consultant2: s(e['Consultant 2']), consultant3: s(e['Consultant 3']),
      internalPoc: s(e['Internal POC']), clientSpoc: s(e['Client SPOC']), location: s(e.Location), offering: s(e.Offering),
      ready: m.progress, openItems: m.open, lateItems: m.overdue, atRisk: m.atRisk, nextDue: m.nextDue,
      invoicePoc: s(inv?.row['Owner Names']), invoiceComment: s(inv?.row.Comments),
      tasks: tl.filter(t => t.applicable).map(t => ({
        taskId: s(t.row.TaskID), stepId: s(t.row.StepID), step: s(t.row.Step), phase: s(t.row.Phase), due: t.due,
        status: s(t.row.Status), done: t.done, completed: t.completed, overdue: t.overdue,
        ownerNames: s(t.row['Owner Names']), comments: s(t.row.Comments),
      })),
    };
  });
}

/** Last loaded programs (memory, then this browser's copy) — never hits the network. */
export function peekOpsPrograms() {
  if (mem) return mem;
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && Array.isArray(v.rows) && Date.now() - v.ts < MAX_AGE) return (mem = v.rows);
  } catch { /* ignore */ }
  return null;
}

/** Programs from Operations Checklist v2 (StepTable + EngagementTable + OpsTaskTable). */
export function getOpsChecklist({ force = false } = {}) {
  if (!isOpsV2Ready()) return Promise.resolve([]);
  if (loading && !force) return loading;
  loading = Promise.all([opsList('steps'), opsList('engagements'), opsList('tasks')])
    .then(([st, en, ta]) => setOpsPrograms(programsFrom(st, en, ta)))
    .finally(() => { loading = null; });
  return loading;
}

/** Store a fresh summary (also called by the Ops Checklist page after its own load / saves). */
export function setOpsPrograms(rows) {
  mem = rows;
  try { localStorage.setItem(STORE, JSON.stringify({ ts: Date.now(), rows })); } catch { /* storage full */ }
  listeners.forEach(fn => { try { fn(rows); } catch { /* ignore */ } });
  return rows;
}
