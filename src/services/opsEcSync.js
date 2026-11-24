/**
 * opsEcSync.js — Engagement Calendar (EC) → Ops Checklist v2 sync rules (pure functions, no I/O).
 *
 * 1. Link check   — a checklist (EngagementTable) is linked to its EC row by EC Index. The link is trusted
 *                   only when the EC row is the same program (same company and same start date or topic).
 *                   Otherwise it is reported with a suggested EC Index and NOT synced.
 * 2. Program data — Company, EG.ID, dates, Topic, Sector, Service Type, Offering, Location, Days,
 *                   Consultants, EC Status, Contract Type / Status are copied from the EC when they differ.
 * 3. Status       — EC Cancelled → Checklist "Closed"; EC Delivered → "Delivered" (from Not Started / In Preparation).
 * 4. Auto-fill    — steps the EC already answers are marked Done. Completed On = the date the checklist was
 *                   opened (Checklist Created On), or the EC date when the EC has one (invoice / payment).
 *                   Never un-does a step and never touches NA steps.
 *                   Facilitator calendar block (OPS-004) and Feedback report (OPS-026) stay manual.
 */
import { toISO } from './opsV2Engine.js';

const s = v => String(v ?? '').trim();
const norm = v => s(v).replace(/\s+/g, ' ').toLowerCase();
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const has = (v, list) => list.includes(norm(v));

// EC data error guard: some EC rows hold a status word in a Consultant column ("Delivered") — never copy it.
const NOT_A_PERSON = ['delivered', 'scheduled', 'cancelled', 'tentative', 'postponed', 're-schedule', 'na', 'n/a', '-', '0'];
const person = v => (NOT_A_PERSON.includes(norm(v)) ? '' : s(v));

/** EngagementTable column ← EC value. */
export const EC_FIELDS = [
  ['EG.ID', ec => (/^EG\.ID \d+$/.test(s(ec.egId)) ? '' : s(ec.egId))],   // skip the list-position fallback
  ['Company', ec => s(ec.company)],
  ['Start Date', ec => toISO(ec.startDate)],
  ['End Date', ec => toISO(ec.endDate) || toISO(ec.startDate)],
  ['Topic', ec => s(ec.topic)],
  ['Sector', ec => s(ec.sector)],
  ['Service Type', ec => s(ec.serviceType)],
  ['Offering', ec => s(ec.offering)],
  ['Location', ec => s(ec.locationRaw || ec.location)],
  ['Days', ec => (num(ec.day) ? String(num(ec.day)) : '')],
  ['Consultant 1', ec => person(ec.consultant1)],
  ['Consultant 2', ec => person(ec.consultant2)],
  ['Consultant 3', ec => person(ec.consultant3)],
  ['EC Status', ec => s(ec.status)],
  ['Contract Type', ec => s(ec.contract)],
  ['Contract Status', ec => s(ec.poStatus)],
];
const same = (field, a, b) => (field === 'Days' ? num(a) === num(b)
  : /Date$/.test(field) ? toISO(a) === toISO(b) : norm(a) === norm(b));

/** Same program? company must match; then start date or topic. */
export function sameProgram(eng, ec) {
  if (!ec || norm(eng?.Company) !== norm(ec.company)) return false;
  return toISO(eng['Start Date']) === toISO(ec.startDate) || norm(eng.Topic) === norm(ec.topic);
}

/** EC row for a checklist: { ec, how: 'index' | 'mismatch' | 'missing', suggest? } */
export function linkFor(eng, ecRows, byKey = indexEc(ecRows)) {
  const k = s(eng?.['EC Index']);
  const ec = byKey[k];
  if (ec && sameProgram(eng, ec)) {
    // Same company + date but another topic: only trusted when no other EC row of that company/date has this topic
    const topicOk = norm(eng.Topic) === norm(ec.topic);
    const twin = !topicOk && ecRows.some(x => x !== ec && norm(x.company) === norm(ec.company) && toISO(x.startDate) === toISO(ec.startDate));
    if (topicOk || !twin) return { ec, how: 'index' };
  }
  const cands = ecRows.filter(x => norm(x.company) === norm(eng?.Company)
    && (norm(x.topic) === norm(eng?.Topic) || toISO(x.startDate) === toISO(eng?.['Start Date'])));
  const best = cands.find(x => norm(x.topic) === norm(eng?.Topic) && toISO(x.startDate) === toISO(eng?.['Start Date']))
    || (cands.filter(x => norm(x.topic) === norm(eng?.Topic)).length === 1 ? cands.find(x => norm(x.topic) === norm(eng?.Topic)) : null)
    || (cands.length === 1 ? cands[0] : null);                         // several candidates, no exact topic → let a person choose
  return { ec: null, how: ec ? 'mismatch' : 'missing', current: ec || null, suggest: best ? s(best.engagementKey) : '', candidates: cands.map(x => s(x.engagementKey)) };
}
export const indexEc = rows => Object.fromEntries((rows || []).map(r => [s(r.engagementKey), r]));

/** EngagementTable patch from the EC (only changed fields) → { patch, changes: [[field, from, to]] } */
export function engPatchFromEc(eng, ec) {
  const patch = {}; const changes = [];
  for (const [f, get] of EC_FIELDS) {
    const v = get(ec);
    if (f === 'EG.ID' && !v) continue;
    if (!same(f, eng[f], v)) { patch[f] = v; changes.push([f, s(eng[f]), v]); }
  }
  const st = norm(ec.status); const cs = s(eng['Checklist Status']) || 'Not Started';
  if (st.startsWith('cancel') && cs !== 'Closed') { patch['Checklist Status'] = 'Closed'; changes.push(['Checklist Status', cs, 'Closed']); }
  else if (st === 'delivered' && ['Not Started', 'In Preparation'].includes(cs)) { patch['Checklist Status'] = 'Delivered'; changes.push(['Checklist Status', cs, 'Delivered']); }
  return { patch, changes };
}

// ── Auto-fill rules: StepID → (ec, eng) → false | { on?: ISO date, why } ──────────
const PO_OK = ['received', 'under contract', 'sow', 'under sow', 'email confirmation', 'email', 'complimentary'];
const PAID = ['paid', 'received'];
const INVOICED = [...PAID, 'invoice raised', 'partly received', 'partially received'];
const LIVE = ['scheduled', 'delivered', 're-schedule', 'rescheduled'];
export const AUTO_RULES = {
  'OPS-001': ec => has(ec.status, LIVE) && { why: `EC status ${s(ec.status)}` },
  'OPS-002': ec => has(ec.poStatus, PO_OK) && { why: `EC PO status ${s(ec.poStatus)}` },
  'OPS-030': ec => (toISO(ec.invoice) || has(ec.payment, INVOICED)) && { on: toISO(ec.invoice), why: toISO(ec.invoice) ? `EC invoice date ${toISO(ec.invoice)}` : `EC payment ${s(ec.payment)}` },
  'OPS-031': ec => has(ec.payment, PAID) && { on: toISO(ec.receivedDate), why: `EC payment ${s(ec.payment)}` },
  'OPS-032': ec => has(ec.payment, PAID) && { on: toISO(ec.receivedDate), why: `EC payment ${s(ec.payment)}` },
};

/** Task patches for one program → [{ id, patch, why }]. createdOn = Checklist Created On (default completion date). */
export function autoFillPatches(taskRows, ec, createdOn, today) {
  const out = [];
  for (const t of taskRows || []) {
    const rule = AUTO_RULES[s(t.StepID)];
    if (!rule || s(t.Status) === 'Done' || s(t.Status) === 'NA' || s(t.Applicable) === 'NA') continue;
    const hit = rule(ec);
    if (!hit) continue;
    let on = toISO(hit.on) || toISO(createdOn) || today;
    if (today && on > today) on = today;
    const note = `Auto-filled from EC (${hit.why})`;
    out.push({ id: s(t.TaskID), patch: { Status: 'Done', 'Completed On': on, Comments: s(t.Comments) ? `${s(t.Comments)} · ${note}` : note }, why: hit.why });
  }
  return out;
}

/** Whole plan for every checklist. dupTaskIds: TaskIDs that appear twice (never patched — Excel would hit the wrong row). */
export function planEcSync({ engagements = [], tasks = [], ecRows = [], dupTaskIds = [], today }) {
  const byKey = indexEc(ecRows);
  const dup = new Set(dupTaskIds.map(s));
  const tasksBy = {};
  for (const t of tasks) (tasksBy[s(t['EC Index'])] ||= []).push(t);
  const plan = { programs: [], mismatches: [], missing: [] };
  for (const eng of engagements) {
    const k = s(eng['EC Index']);
    if (!k) continue;
    const link = linkFor(eng, ecRows, byKey);
    if (!link.ec) { (link.how === 'missing' ? plan.missing : plan.mismatches).push({ k, eng, ...link }); continue; }
    const { patch, changes } = engPatchFromEc(eng, link.ec);
    const fills = autoFillPatches((tasksBy[k] || []).filter(t => !dup.has(s(t.TaskID))), link.ec, eng['Checklist Created On'], today);
    if (changes.length || fills.length) plan.programs.push({ k, eng, ec: link.ec, patch, changes, fills,
      datesChanged: changes.some(([f]) => f === 'Start Date' || f === 'End Date') });
  }
  return plan;
}

/** New checklist: Done flags for steps the EC already answers (completion = checklist opening day). */
export function autoFillNewTasks(rows, ec, createdOn) {
  const fills = autoFillPatches(rows, ec, createdOn, createdOn);
  const by = Object.fromEntries(fills.map(f => [f.id, f.patch]));
  return rows.map(r => (by[s(r.TaskID)] ? { ...r, ...by[s(r.TaskID)] } : r));
}
