/**
 * EURADICLE CRM — ACTION ITEMS ENGINE (Founder's Desk)
 * ====================================================
 * Reads the rows already loaded from every tracker and turns them into one list of
 * open tasks (with due dates and owners), one list of completed work, the missing-field
 * count per tracker, and the money / pipeline figures the founder needs.
 * Pure functions — no fetching, no saving. Same TAT and finance rules as the tracker pages.
 */
import { CL_ITEMS } from '../pages/OpsChecklist.jsx';
import { financeDates, financeStage, totalOf } from '../pages/FinanceTracker.jsx';
import { pendingItems, OPS_RULES, EC_RULES, CDT_RULES, FIN_RULES, BD_RULES, SOL_RULES, LEAD_RULES, VENDOR_RULES, CONSULTANT_RULES, CLIENT_RULES, toIso } from '../config/pendingFields.js';
import { taskIsOpen } from '../config/taskOptions.js';
import { contractAlert, noticeDays } from './consultantsApi.js';
import { CONTRACT_WARN_DAYS } from '../config/clientOptions.js';
import { leadIsOpen, isBillable, VENDOR_INVOICE_EXPECTED_DAYS, CLIENT_BILLING_DAYS, VENDOR_PAYMENT_DAYS } from '../config/leadVendorOptions.js';
import { parseChecklist } from '../config/opsChecklistItems.js';
import { buildProposals, toRupees } from '../components/proposalData.js';
import { normPayment } from './syncWithEC.js';

export const TRACKERS = {
  bd:          { label: 'BD Tracker',          short: 'BD',       route: '/bd-tracker' },
  solution:    { label: 'Solution Tracker',    short: 'Solution', route: '/solution' },
  engagement:  { label: 'Engagement Calendar', short: 'Calendar', route: '/engagement' },
  ops:         { label: 'Ops Checklist',       short: 'Ops',      route: '/ops' },
  finance:     { label: 'Finance Tracker',     short: 'Finance',  route: '/finance' },
  'content-dev': { label: 'Content Dev Tracker', short: 'Content', route: '/content-dev' },
  leads:       { label: 'Lead Tracker',        short: 'Leads',    route: '/leads' },
  vendors:     { label: 'Vendor Services',     short: 'Vendors',  route: '/vendors' },
  tasks:       { label: 'Project Management',  short: 'Projects', route: '/tasks' },
  consultants: { label: 'Consultant Directory', short: 'Consultants', route: '/consultants' },
  clients:     { label: 'Client Directory',    short: 'Clients',  route: '/clients' },
};
const clientOpenAction = a => ['Open', 'In progress', ''].includes(s(a.status));
const vToBill = v => isBillable(v.billable) && !['Billed', 'Not applicable'].includes(s(v.clientBilling));
const vToPay = v => ['To pay', 'Partly paid'].includes(s(v.paymentStatus));

const s = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const pad2 = n => String(n).padStart(2, '0');
export const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const addDaysIso = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cancelled = r => /cancel/i.test(s(r.status));
const owner = v => s(v) || 'Unassigned';

/* ─── Periods ─────────────────────────────────────────────────────────────── */
export const PERIODS = [
  { id: 'month',   label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'fy',      label: 'This FY' },
  { id: '30d',     label: 'Last 30 days' },
  { id: 'lastfy',  label: 'Last FY' },
  { id: 'all',     label: 'All time' },
];
export function periodRange(id, today = todayIso()) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const fy = m >= 4 ? y : y - 1;
  const iso = (yy, mm, dd) => `${yy}-${pad2(mm)}-${pad2(dd)}`;
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (id) {
    case 'month':   return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
    case 'quarter': {                                   // Indian FY quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar
      const qStart = [1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10][m - 1];
      const endM = qStart + 2;
      return { from: iso(y, qStart, 1), to: iso(y, endM, lastDay(y, endM)) };
    }
    case 'fy':      return { from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31) };
    case 'lastfy':  return { from: iso(fy - 1, 4, 1), to: iso(fy, 3, 31) };
    case '30d':     return { from: addDaysIso(today, -29), to: today };
    default:        return { from: '0000-01-01', to: '9999-12-31' };
  }
}
export const inRange = (iso, r) => !!iso && iso >= r.from && iso <= r.to;

/* ─── BD lines: one per Proposal ID, latest version ───────────────────────── */
const versionNo = v => { const m = String(v ?? '').match(/(\d+)/); return m ? Number(m[1]) : 1; };
export function bdLines(solRows) {
  const byPid = new Map();
  (solRows || []).forEach(r => {
    if (!s(r.proposalId)) return;
    const k = s(r.proposalId);
    if (!byPid.has(k)) byPid.set(k, []);
    byPid.get(k).push(r);
  });
  return [...byPid.values()].map(rows => {
    const top = Math.max(...rows.map(r => versionNo(r.proposalVersion)));
    const vr = rows.filter(r => versionNo(r.proposalVersion) === top);
    const anchor = vr.find(r => s(r.bdSNo)) || vr[0];
    const link = s(anchor.proposalV1Link) || s((vr.find(r => s(r.proposalV1Link)) || {}).proposalV1Link);
    return { ...anchor, proposalV1Link: link, _sols: vr.filter(r => s(r.solutionTopic)) };
  });
}

/* ─── Open tasks (everything with a due date that is not done) ─────────────── */
// Task: { id, tracker, record, sub, label, due, owner, amount?, details: [[label, value]], key }
export function openTasks({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [], tasks = [], consultants = [], clients = null }) {
  const out = [];
  const opsByKey = new Map(ops.map(o => [s(o.engagementKey), o]));

  // Ops Checklist — every item not Yes / NA, due on its TAT
  ops.filter(r => !cancelled(r)).forEach(r => {
    const st = toIso(r.startDate), en = toIso(r.endDate);
    CL_ITEMS.forEach(it => {
      if (['Yes', 'NA'].includes(s(r[it.key]))) return;
      const due = it.tatFn(st, en);
      if (!due) return;
      out.push({
        id: `ops|${r.sno}|${it.key}`, tracker: 'ops', record: s(r.company) || '(no company)', serial: r.sno,
        sub: [s(r.topic), st].filter(Boolean).join(' · '), label: it.label, due, owner: owner(r[it.pocKey] || r.internalPoc),
        details: [['Session', `${s(r.company)} — ${s(r.topic)}`], ['Dates', [st, en].filter(Boolean).join(' → ')], ['EG.ID', s(r.egId)],
          ['Item POC', s(r[it.pocKey])], ['Internal POC', s(r.internalPoc)], ['Lead consultant', s(r.consultant1)], ['Comment', s(r[it.commentKey])],
          ['Required by BD', parseChecklist(r.bdChecklist).includes(it.key) ? 'Yes' : '']],
      });
    });
  });

  // Content Dev — open work items + entries past Due Date with no Completion Date
  cdt.forEach(r => {
    [['contentAssets', 'Content Assets'], ['preWorkItems', 'Pre-Work'], ['postWorkItems', 'Post-Work']].forEach(([k, lbl]) =>
      (r[k] || []).forEach(it => {
        if (it.done || !it.deadline) return;
        out.push({
          id: `cdt|${r.sno}|${it.id}`, tracker: 'content-dev', record: s(r.client) || '(no client)', serial: r.sno, sub: s(r.topic),
          label: `${lbl}: ${s(it.title) || '(untitled)'}`, due: toIso(it.deadline), owner: owner(r.poc), link: s(it.link),
          details: [['Program', s(r.topic)], ['Start date', toIso(r.startDate)], ['POC', s(r.poc)], ['Link', s(it.link)]],
        });
      }));
    const done = s(r.completionDate);
    const due = toIso(r.dueDate);
    if ((!done || done === '—') && due) out.push({
      id: `cdt|${r.sno}|completion`, tracker: 'content-dev', record: s(r.client) || '(no client)', serial: r.sno, sub: s(r.topic),
      label: 'Content completion', due, owner: owner(r.poc),
      details: [['Program', s(r.topic)], ['Start date', toIso(r.startDate)], ['POC', s(r.poc)], ['PM required', s(r.pmRequired)], ['EV required', s(r.evRequired)]],
    });
  });

  // Finance — raise invoice (end + 1), collect payment (invoice + 30)
  eng.forEach(e => {
    if (!s(e.engagementKey)) return;
    const stage = financeStage(e);
    const { invDue, payDue } = financeDates(e);
    const oc = opsByKey.get(s(e.engagementKey));
    const base = {
      tracker: 'finance', record: s(e.company) || '(no company)', serial: e.engagementKey, sub: [s(e.egId), s(e.topic)].filter(Boolean).join(' · '),
      owner: owner(oc?.invoicePoc), amount: totalOf(e),
      details: [['Engagement', `${s(e.company)} — ${s(e.topic)}`], ['Dates', [toIso(e.startDate), toIso(e.endDate)].filter(Boolean).join(' → ')],
        ['Total (price + travel + GST)', totalOf(e) ? '₹ ' + totalOf(e).toLocaleString('en-IN') : ''], ['Payment status', s(e.payment)],
        ['Invoice date', toIso(e.invoice)], ['Amount received', num(e.amountReceived) ? '₹ ' + num(e.amountReceived).toLocaleString('en-IN') : ''],
        ['Invoice POC', s(oc?.invoicePoc)], ['Invoice comment', s(oc?.invoiceComment)]],
    };
    if (['To Invoice', 'Invoice Overdue', 'Upcoming'].includes(stage) && invDue)
      out.push({ ...base, id: `fin|${e.engagementKey}|inv`, label: 'Raise invoice', due: invDue });
    if (['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(stage) && payDue)
      out.push({ ...base, id: `fin|${e.engagementKey}|pay`, label: stage === 'Partly Received' ? 'Collect balance' : 'Collect payment', due: payDue,
        amount: Math.max(0, totalOf(e) - num(e.amountReceived)) });
  });

  // Engagement Calendar — finished but never marked Delivered
  const t = todayIso();
  eng.forEach(e => {
    const st = s(e.status);
    if (/cancel|postpone|deliver/i.test(st)) return;
    const start = toIso(e.startDate), end = toIso(e.endDate) || start;
    if (!end || end >= t) return;
    out.push({
      id: `ec|${e.egId}|${e.sno}|status`, tracker: 'engagement', record: s(e.company) || '(no company)', serial: e.sno,
      sub: [s(e.egId), s(e.topic)].filter(Boolean).join(' · '), label: 'Mark as Delivered', due: end, owner: owner(e.consultant1),
      details: [['Engagement', `${s(e.company)} — ${s(e.topic)}`], ['Dates', [start, end].filter(Boolean).join(' → ')], ['Status now', st || '(blank)'],
        ['Lead consultant', s(e.consultant1)], ['Location', s(e.location)]],
    });
  });

  // BD — In Process proposals not yet submitted, due on the Client Expected Date
  bdLines(sol).forEach(r => {
    if (s(r.bdStatus) !== 'In Process' || toIso(r.submissionToClient)) return;
    const due = toIso(r.clientExpectedDate);
    if (!due) return;
    out.push({
      id: `bd|${r.proposalId}|submit`, tracker: 'bd', record: s(r.clientName) || '(no client)', serial: r.bdSNo || r.sno,
      sub: [s(r.proposalId), s(r.programTopic)].filter(Boolean).join(' · '), label: 'Submit proposal', due, owner: 'BD team',
      amount: toRupees(r.bdProposalValue),
      details: [['Proposal', `${s(r.proposalId)} ${s(r.proposalVersion) || 'V1'}`], ['Program', s(r.programTopic)], ['Client POC', s(r.clientPoc)],
        ['Date of discussion', toIso(r.dateOfDiscussion)], ['Proposal value', s(r.bdProposalValue)], ['BD comments', s(r.bdComments)]],
    });
  });

  // Leads — open leads with a follow-up date
  leads.forEach(l => {
    if (!leadIsOpen(l) || !toIso(l.nextFollowUp)) return;
    const last = [...(l.actions || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    out.push({
      id: `lead|${l.leadId}`, tracker: 'leads', record: s(l.company) || '(no company)', serial: l.leadId,
      sub: [s(l.status), s(l.source)].filter(Boolean).join(' · '), label: 'Follow up lead', due: toIso(l.nextFollowUp), owner: owner(l.owner),
      amount: num(l.estValue),
      details: [['Lead', `${s(l.leadId)} · ${s(l.company)}`], ['Contact', [s(l.contactName), s(l.designation), s(l.email), s(l.phone)].filter(Boolean).join(' · ')],
        ['Source', [s(l.source), s(l.sourceDetail)].filter(Boolean).join(' — ')], ['Shared by', s(l.sharedBy)], ['Requirement', s(l.requirement)],
        ['Status', s(l.status)], ['Actions logged', String((l.actions || []).length)],
        ['Last action', last ? `${s(last.by)} · ${s(last.type)}: ${s(last.comment)}` : '']],
    });
  });

  // Vendor services — bill the client, get the vendor invoice, pay the vendor
  vendors.forEach(v => {
    const base = {
      tracker: 'vendors', record: s(v.vendorName) || '(no vendor)', serial: v.serviceId, sub: [s(v.category), s(v.client)].filter(Boolean).join(' · '),
      owner: owner(v.requestedBy), amount: num(v.total),
      details: [['Service', `${s(v.serviceId)} · ${s(v.description)}`], ['Engagement', [s(v.client), s(v.program), s(v.egId)].filter(Boolean).join(' · ')],
        ['Service date', toIso(v.serviceDate)], ['Total', num(v.total) ? '₹ ' + num(v.total).toLocaleString('en-IN') : ''], ['Billable', s(v.billable)],
        ['Client billing', s(v.clientBilling)], ['Vendor invoice', [s(v.vendorInvoiceNo), toIso(v.vendorInvoiceDate)].filter(Boolean).join(' · ')], ['Vendor payment', s(v.paymentStatus)]],
    };
    const sd = toIso(v.serviceDate);
    if (sd && vToBill(v)) out.push({ ...base, id: `vs|${v.serviceId}|bill`, label: 'Bill vendor cost to client', due: addDaysIso(sd, CLIENT_BILLING_DAYS) });
    if (sd && s(v.paymentStatus) === 'Invoice awaited') out.push({ ...base, id: `vs|${v.serviceId}|inv`, label: 'Get vendor invoice', due: addDaysIso(sd, VENDOR_INVOICE_EXPECTED_DAYS) });
    const vid = toIso(v.vendorInvoiceDate);
    if (vid && vToPay(v)) out.push({ ...base, id: `vs|${v.serviceId}|pay`, label: 'Pay vendor', due: addDaysIso(vid, VENDOR_PAYMENT_DAYS),
      amount: Math.max(0, num(v.total) - num(v.paidAmount)) });
  });

  // Project Management — open tasks with a due date, owned by the assignee
  tasks.forEach(k => {
    const due = toIso(k.dueDate);
    if (!taskIsOpen(k) || !due) return;
    out.push({
      id: `task|${k.taskId}`, tracker: 'tasks', record: s(k.projectName) || '(no project)', serial: k.taskId,
      sub: [s(k.client), s(k.team)].filter(Boolean).join(' · '), label: s(k.title) || '(untitled task)', due, owner: owner(k.assignedTo),
      details: [['Task', `${s(k.taskId)} · ${s(k.title)}`], ['Project', [s(k.projectId), s(k.projectName)].filter(Boolean).join(' · ')], ['Client', s(k.client)],
        ['Assigned to', s(k.assignedTo)], ['Assigned by', s(k.assignedBy)], ['Status', s(k.status)], ['Priority', s(k.priority)],
        ['Waiting on', s(k.waitingOn)], ['Description', s(k.description)], ['Output', s(k.outputLink)]],
    });
  });

  // Consultant Directory — contracts in the renewal window or expired
  consultants.forEach(c => {
    if (s(c.status) === 'Inactive') return;
    const a = contractAlert(c);
    if (a !== 'renew' && a !== 'expired') return;
    out.push({
      id: `cn|${c.consultantId}|renew`, tracker: 'consultants', record: s(c.fullName) || '(no name)', serial: c.consultantId,
      sub: [s(c.designation), s(c.contractType)].filter(Boolean).join(' · '), label: a === 'expired' ? 'Contract expired — renew' : 'Renew contract',
      due: addDaysIso(toIso(c.contractEnd), -noticeDays(c)), owner: owner(c.owner),
      details: [['Consultant', `${s(c.consultantId)} · ${s(c.fullName)}`], ['Contract', [s(c.contractType), s(c.contractStatus)].filter(Boolean).join(' · ')],
        ['Ends', toIso(c.contractEnd)], ['Last renewed', toIso(c.lastRenewed)], ['NDA', s(c.ndaSigned)], ['Relationship owner', s(c.owner)], ['Contract link', s(c.contractLink)]],
    });
  });

  // Client Directory — follow-ups, open client actions, contract renewals
  if (clients) {
    const byId = new Map((clients.clients || []).map(c => [s(c.clientId), c]));
    const byName = new Map((clients.clients || []).map(c => [s(c.name).toLowerCase(), c]));
    (clients.clients || []).forEach(c => {
      const base = {
        tracker: 'clients', record: s(c.name) || '(no name)', serial: c.clientId, sub: [s(c.clientType), s(c.industry)].filter(Boolean).join(' · '),
        owner: owner(c.owner), details: [['Client', `${s(c.clientId)} · ${s(c.name)}`], ['Type', s(c.clientType)], ['Relationship', [s(c.relStatus), s(c.health) && `${s(c.health)} health`].filter(Boolean).join(' · ')],
          ['Account owner', s(c.owner)], ['Next action', s(c.nextAction)], ['Last interaction', toIso(c.lastInteraction)]],
      };
      const fu = toIso(c.nextFollowUp);
      if (fu) out.push({ ...base, id: `cl|${c.clientId}|fu`, label: s(c.nextAction) ? `Follow up: ${s(c.nextAction)}` : 'Client follow-up', due: fu });
      const end = toIso(c.contractEnd);
      if (end && !['Expired', 'Not required'].includes(s(c.contractStatus)))
        out.push({ ...base, id: `cl|${c.clientId}|contract`, label: 'Renew client contract', due: addDaysIso(end, -CONTRACT_WARN_DAYS),
          details: [...base.details, ['Contract', [s(c.contractBasis), s(c.contractStatus)].filter(Boolean).join(' · ')], ['Ends', end]] });
    });
    (clients.actions || []).forEach(a => {
      const due = toIso(a.due);
      if (!clientOpenAction(a) || !due) return;
      const c = byId.get(s(a.clientId)) || byName.get(s(a.clientName).toLowerCase()) || {};
      out.push({
        id: `ca|${a.actionId}`, tracker: 'clients', record: s(a.clientName) || s(c.name) || '(no client)', serial: a.actionId,
        sub: s(a.ownerContact) ? `with ${s(a.ownerContact)}` : s(a.timing), label: s(a.action) || 'Client action', due, owner: owner(a.erOwner || c.owner),
        details: [['Action', s(a.action)], ['Client', s(a.clientName)], ['With', s(a.ownerContact)], ['Priority', s(a.priority)], ['Status', s(a.status) || 'Open'], ['Context', s(a.context)]],
      });
    });
  }

  return out.map(x => ({ ...x, days: daysBetween(t, x.due) }));
}

/* ─── Completed work (dated) ───────────────────────────────────────────────── */
// { id, tracker, record, label, date, amount? }
export function completedWork({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [], tasks = [], consultants = [], clients = null }) {
  const out = [];
  ops.forEach(r => CL_ITEMS.forEach(it => {
    if (s(r[it.key]) !== 'Yes') return;
    const d = toIso(r[it.doneKey]);
    if (d) out.push({ id: `ops|${r.sno}|${it.key}`, tracker: 'ops', record: s(r.company), sub: s(r.topic), label: it.label, date: d, who: s(r[it.pocKey]) });
  }));
  cdt.forEach(r => {
    [['contentAssets', 'Content Assets'], ['preWorkItems', 'Pre-Work'], ['postWorkItems', 'Post-Work']].forEach(([k, lbl]) =>
      (r[k] || []).forEach(it => { const d = toIso(it.done); if (d) out.push({ id: `cdt|${r.sno}|${it.id}`, tracker: 'content-dev', record: s(r.client), sub: s(r.topic), label: `${lbl}: ${s(it.title)}`, date: d, who: s(r.poc) }); }));
    const d = toIso(r.completionDate);
    if (d) out.push({ id: `cdt|${r.sno}|done`, tracker: 'content-dev', record: s(r.client), sub: s(r.topic), label: 'Content completed', date: d, who: s(r.poc) });
  });
  eng.forEach(e => {
    const end = toIso(e.endDate) || toIso(e.startDate);
    if (/deliver/i.test(s(e.status)) && end) out.push({ id: `ec|${e.egId}|${e.sno}`, tracker: 'engagement', record: s(e.company), sub: s(e.topic), label: 'Session delivered', date: end, amount: num(e.price), who: s(e.consultant1) });
    const inv = toIso(e.invoice);
    if (inv) out.push({ id: `fin|${e.engagementKey}|inv`, tracker: 'finance', record: s(e.company), sub: s(e.topic), label: 'Invoice raised', date: inv, amount: totalOf(e) });
    const rec = toIso(e.receivedDate);
    if (rec) out.push({ id: `fin|${e.engagementKey}|rec`, tracker: 'finance', record: s(e.company), sub: s(e.topic), label: 'Payment received', date: rec, amount: num(e.amountReceived) || totalOf(e) });
  });
  bdLines(sol).forEach(r => {
    const sub = toIso(r.submissionToClient);
    if (sub) out.push({ id: `bd|${r.proposalId}|sub`, tracker: 'bd', record: s(r.clientName), sub: `${s(r.proposalId)} · ${s(r.programTopic)}`, label: 'Proposal submitted', date: sub, amount: toRupees(r.bdProposalValue) });
  });
  leads.forEach(l => (l.actions || []).forEach(a => {
    const d = toIso(String(a.at || '').slice(0, 10));
    if (d) out.push({ id: `lead|${l.leadId}|${a.id}`, tracker: 'leads', record: s(l.company), sub: `${s(a.type)}: ${s(a.comment)}`,
      label: s(a.status) === 'Converted to BD' ? 'Lead converted to BD' : 'Lead action', date: d, who: s(a.by) });
  }));
  vendors.forEach(v => {
    const b = toIso(v.clientInvoiceDate);
    if (b && s(v.clientBilling) === 'Billed') out.push({ id: `vs|${v.serviceId}|billed`, tracker: 'vendors', record: s(v.vendorName), sub: s(v.client), label: 'Vendor cost billed to client', date: b, amount: num(v.total) });
    const p = toIso(v.paidDate);
    if (p) out.push({ id: `vs|${v.serviceId}|paid`, tracker: 'vendors', record: s(v.vendorName), sub: s(v.client), label: 'Vendor paid', date: p, amount: num(v.paidAmount) || num(v.total) });
  });
  tasks.forEach(k => {
    const d = toIso(k.completedDate);
    if (d && s(k.status) === 'Done') out.push({ id: `task|${k.taskId}|done`, tracker: 'tasks', record: s(k.projectName), sub: s(k.title), label: 'Task completed', date: d, who: s(k.assignedTo) });
  });
  consultants.forEach(c => {
    const d = toIso(c.lastRenewed);
    if (d) out.push({ id: `cn|${c.consultantId}|renewed`, tracker: 'consultants', record: s(c.fullName), sub: s(c.contractType), label: 'Consultant contract renewed', date: d, who: s(c.owner) });
  });
  if (clients) {
    (clients.actions || []).forEach(a => {
      const d = toIso(a.closedOn);
      if (d && s(a.status) === 'Done') out.push({ id: `ca|${a.actionId}|done`, tracker: 'clients', record: s(a.clientName), sub: s(a.action), label: 'Client action closed', date: d, who: s(a.erOwner) });
    });
    (clients.interactions || []).forEach(i => {
      const d = toIso(i.date);
      if (d && s(i.summary)) out.push({ id: `ci|${i.interactionId}`, tracker: 'clients', record: s(i.clientName), sub: `${s(i.type)}: ${s(i.summary)}`, label: 'Client interaction', date: d, who: s(i.erAttendees || i.loggedBy) });
    });
  }
  // A future 'done' date is a typo or a plan, not completed work
  const t = todayIso();
  return out.filter(x => x.date <= t).sort((a, b) => b.date.localeCompare(a.date));
}

/* ─── Missing fields per tracker (same rules as the Reminders popup) ───────── */
export function missingByTracker({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [], consultants = [], clients = null }) {
  const lines = bdLines(sol);
  const sols = lines.flatMap(l => l._sols);
  const make = (tracker, rows, rules, title) => {
    const items = pendingItems(rows, rules, r => ({ id: `${tracker}|${r.sno ?? r.engagementKey ?? Math.random()}`, serial: r.sno, title: title(r) }));
    const fieldCount = {};
    items.forEach(it => it.missing.forEach(m => { fieldCount[m.label] = (fieldCount[m.label] || 0) + 1; }));
    return {
      tracker, records: items.length, fields: items.reduce((t, it) => t + it.missing.length, 0),
      top: Object.entries(fieldCount).sort((a, b) => b[1] - a[1]).slice(0, 4), items,
    };
  };
  return [
    make('bd', lines, BD_RULES, r => `${s(r.proposalId)} · ${s(r.clientName)}`),
    make('solution', sols, SOL_RULES, r => `${s(r.proposalId)} · ${s(r.solutionTopic)}`),
    make('engagement', eng, EC_RULES, r => s(r.company)),
    make('ops', ops, OPS_RULES, r => s(r.company)),
    make('finance', eng.filter(e => s(e.engagementKey)), FIN_RULES, r => s(r.company)),
    make('content-dev', cdt, CDT_RULES, r => s(r.client)),
    make('leads', leads, LEAD_RULES, r => `${s(r.leadId)} · ${s(r.company)}`),
    make('vendors', vendors, VENDOR_RULES, r => `${s(r.serviceId)} · ${s(r.vendorName)}`),
    make('consultants', consultants, CONSULTANT_RULES, r => `${s(r.consultantId)} · ${s(r.fullName)}`),
    make('clients', clients?.clients || [], CLIENT_RULES, r => `${s(r.clientId)} · ${s(r.name)}`),
  ].filter(m => {                          // optional trackers appear only once they have data
    const n = { leads: leads.length, vendors: vendors.length, consultants: consultants.length, clients: (clients?.clients || []).length }[m.tracker];
    return n === undefined || n > 0;
  });
}

/* ─── Money ────────────────────────────────────────────────────────────────── */
const NOT_REVENUE = /cancel|lost|drop|postpon|hold/i;
export function cashSummary(eng, range) {
  const t = todayIso();
  let booked = 0, delivered = 0, invoiced = 0, collected = 0, toInvoice = 0, toInvoiceN = 0, overdueInvoiceN = 0;
  let outstanding = 0, overdueOut = 0;
  const aging = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
  const byClient = new Map();
  eng.forEach(e => {
    const start = toIso(e.startDate);
    const price = num(e.price);
    if (inRange(start, range) && !NOT_REVENUE.test(s(e.status))) { booked += price; if (/deliver/i.test(s(e.status))) delivered += price; }
    if (inRange(toIso(e.invoice), range)) invoiced += totalOf(e);
    if (inRange(toIso(e.receivedDate), range)) collected += num(e.amountReceived) || totalOf(e);
    if (!s(e.engagementKey)) return;
    const stage = financeStage(e);
    if (stage === 'To Invoice' || stage === 'Invoice Overdue') { toInvoice += price; toInvoiceN++; if (stage === 'Invoice Overdue') overdueInvoiceN++; }
    if (['Awaiting Payment', 'Payment Overdue', 'Partly Received'].includes(stage)) {
      const bal = Math.max(0, totalOf(e) - num(e.amountReceived));
      outstanding += bal;
      const inv = toIso(e.invoice);
      const age = inv ? daysBetween(inv, t) : 0;
      aging[age <= 30 ? '0–30' : age <= 60 ? '31–60' : age <= 90 ? '61–90' : '90+'] += bal;
      if (stage === 'Payment Overdue') overdueOut += bal;
      const c = s(e.company) || '(no company)';
      byClient.set(c, (byClient.get(c) || 0) + bal);
    }
  });
  return {
    booked, delivered, invoiced, collected, toInvoice, toInvoiceN, overdueInvoiceN, outstanding, overdueOut, aging,
    topOutstanding: [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

/* ─── Pipeline ─────────────────────────────────────────────────────────────── */
export function pipelineSummary(sol, range) {
  const all = buildProposals(sol);
  const inP = all.filter(p => inRange(p.date, range) || (p.undated && range.to >= todayIso()));
  const sum = (list, k) => list.filter(p => p.pipeline === k);
  const won = sum(inP, 'closed'), lost = sum(inP, 'lost'), open = sum(inP, 'process');
  const val = list => list.reduce((t, p) => t + (p.value || 0), 0);
  const allOpen = all.filter(p => p.pipeline === 'process');
  const lines = bdLines(sol);
  const awaitingSubmission = lines.filter(r => s(r.bdStatus) === 'In Process' && !toIso(r.submissionToClient)).length;
  const checklistPending = lines.filter(r => ['In Process', 'Won'].includes(s(r.bdStatus)) && parseChecklist(r.opsChecklist).length === 0).length;
  return {
    count: inP.length, won: won.length, lost: lost.length, open: open.length,
    wonV: val(won), lostV: val(lost), openV: val(open), totalV: val(inP),
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    pipelineAll: allOpen.length, pipelineAllV: val(allOpen),
    topOpen: [...allOpen].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 6),
    recentWins: [...won].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6),
    awaitingSubmission, checklistPending,
  };
}

/* ─── Upcoming deliveries with Ops readiness ───────────────────────────────── */
export function upcomingDeliveries(eng, ops, days) {
  const t = todayIso(), until = addDaysIso(t, days);
  const opsByKey = new Map(ops.map(o => [s(o.engagementKey), o]));
  return eng.filter(e => {
    if (/cancel|postpone/i.test(s(e.status))) return false;
    const st = toIso(e.startDate), en = toIso(e.endDate) || st;
    return st && en >= t && st <= until;
  }).map(e => {
    const oc = opsByKey.get(s(e.engagementKey));
    let ready = null, openItems = 0, lateItems = 0;
    if (oc) {
      const st = toIso(oc.startDate), en = toIso(oc.endDate);
      const done = CL_ITEMS.filter(it => ['Yes', 'NA'].includes(s(oc[it.key]))).length;
      ready = Math.round((done / CL_ITEMS.length) * 100);
      CL_ITEMS.forEach(it => {
        if (['Yes', 'NA'].includes(s(oc[it.key]))) return;
        openItems++;
        const due = it.tatFn(st, en);
        if (due && due < t) lateItems++;
      });
    }
    return { ...e, _start: toIso(e.startDate), _end: toIso(e.endDate) || toIso(e.startDate), _ops: oc || null, ready, openItems, lateItems };
  }).sort((a, b) => a._start.localeCompare(b._start));
}

export const fmtL = v => {
  const n = Number(v) || 0;
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(0) + 'K';
  return '₹' + Math.round(n);
};

/* ─── Client Directory summary ─────────────────────────────────────────────── */
const COLD_DAYS = 60;
export function clientSummary(clients, eng = []) {
  const list = clients?.clients || [];
  const t = todayIso(), week = addDaysIso(t, 7);
  const lastLog = new Map();
  (clients?.interactions || []).forEach(i => {
    const k = s(i.clientId) || s(i.clientName).toLowerCase(); const d = toIso(i.date);
    if (d && (!lastLog.get(k) || d > lastLog.get(k))) lastLog.set(k, d);
  });
  const lastTouch = c => [toIso(c.lastInteraction), lastLog.get(s(c.clientId)), lastLog.get(s(c.name).toLowerCase())].filter(Boolean).sort().pop() || '';
  // sessions in the Engagement Calendar per client name (to show who is busiest now)
  const live = list.filter(c => ['Existing'].includes(s(c.clientType)) || s(c.relStatus) === 'Active');
  const atRisk = live.filter(c => ['Red', 'Amber'].includes(s(c.health)));
  const cold = live.filter(c => { const lt = lastTouch(c); return !lt || daysBetween(lt, t) > COLD_DAYS; });
  const followWeek = list.filter(c => { const f = toIso(c.nextFollowUp); return f && f <= week; });
  const openActs = (clients?.actions || []).filter(a => clientOpenAction(a));
  const noOwner = list.filter(c => !s(c.owner));
  const engCount = new Map();
  eng.forEach(e => { const k = s(e.company).toLowerCase(); if (k) engCount.set(k, (engCount.get(k) || 0) + 1); });
  const describe = c => ({
    id: c.clientId, name: s(c.name), type: s(c.clientType), health: s(c.health), owner: s(c.owner), status: s(c.relStatus),
    lastTouch: lastTouch(c), next: toIso(c.nextFollowUp), nextAction: s(c.nextAction), outstanding: num(c.outstanding),
    openActions: openActs.filter(a => s(a.clientId) === s(c.clientId) || s(a.clientName).toLowerCase() === s(c.name).toLowerCase()).length,
    sessions: engCount.get(s(c.name).toLowerCase()) || 0,
  });
  const watch = [...new Map([...atRisk, ...cold].map(c => [c.clientId, c])).values()].map(describe)
    .sort((a, b) => (b.health === 'Red') - (a.health === 'Red') || (a.lastTouch || '0').localeCompare(b.lastTouch || '0'));
  return {
    total: list.length, existing: list.filter(c => s(c.clientType) === 'Existing').length, prospects: list.filter(c => s(c.clientType) === 'Prospect').length,
    active: list.filter(c => s(c.relStatus) === 'Active').length, atRisk: atRisk.length, cold: cold.length, coldDays: COLD_DAYS,
    followWeek: followWeek.length, openActions: openActs.length, noOwner: noOwner.length,
    dues: list.reduce((x, c) => x + num(c.outstanding), 0), withDues: list.filter(c => num(c.outstanding) > 0).length,
    watch: watch.slice(0, 10),
    upcoming: followWeek.map(describe).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 8),
    topDues: list.filter(c => num(c.outstanding) > 0).map(describe).sort((a, b) => b.outstanding - a.outstanding).slice(0, 6),
  };
}

/* ─── Project Management summary ───────────────────────────────────────────── */
export function projectSummary(tasks = [], range) {
  const t = todayIso(), week = addDaysIso(t, 7);
  const open = tasks.filter(taskIsOpen);
  const overdue = open.filter(k => toIso(k.dueDate) && toIso(k.dueDate) < t);
  const dueWeek = open.filter(k => { const d = toIso(k.dueDate); return d && d >= t && d <= week; });
  const doneP = tasks.filter(k => s(k.status) === 'Done' && inRange(toIso(k.completedDate), range));
  const byProject = new Map();
  tasks.forEach(k => {
    const id = s(k.projectId) || s(k.projectName) || '(no project)';
    const p = byProject.get(id) || { id, name: s(k.projectName) || id, client: s(k.client), owner: s(k.projectOwner), due: toIso(k.projectDue), team: s(k.team), total: 0, done: 0, open: 0, overdue: 0, cancelled: 0 };
    if (s(k.status) === 'Cancelled') p.cancelled++;
    else { p.total++; if (s(k.status) === 'Done') p.done++; else { p.open++; if (toIso(k.dueDate) && toIso(k.dueDate) < t) p.overdue++; } }
    byProject.set(id, p);
  });
  const projects = [...byProject.values()].filter(p => p.total > 0).map(p => ({
    ...p, pct: Math.round((p.done / p.total) * 100),
    state: p.open === 0 ? 'Completed' : p.overdue > 0 || (p.due && p.due < t) ? 'At risk' : p.done > 0 ? 'Active' : 'Not started',
  }));
  const active = projects.filter(p => p.state !== 'Completed');
  return {
    open: open.length, overdue: overdue.length, dueWeek: dueWeek.length, done: doneP.length,
    activeProjects: active.length, atRisk: active.filter(p => p.state === 'At risk').length, waiting: open.filter(k => /waiting/i.test(s(k.status))).length,
    projects: active.sort((a, b) => (b.state === 'At risk') - (a.state === 'At risk') || b.overdue - a.overdue || a.pct - b.pct).slice(0, 10),
  };
}

/* ─── Consultant Directory summary ─────────────────────────────────────────── */
export function consultantSummary(consultants = [], eng = [], days = 30) {
  const t = todayIso(), until = addDaysIso(t, days);
  const live = consultants.filter(c => s(c.status) !== 'Inactive');
  const alerts = { ok: 0, renew: 0, expired: 0, none: 0, terminated: 0 };
  live.forEach(c => { alerts[contractAlert(c)]++; });
  // sessions per consultant in the Engagement Calendar (lead or co-consultant), next N days
  const load = new Map();
  eng.forEach(e => {
    if (/cancel|postpone/i.test(s(e.status))) return;
    const st = toIso(e.startDate);
    if (!st || st < t || st > until) return;
    [e.consultant1, e.consultant2, e.consultant3].map(s).filter(Boolean).forEach((n, i) => {
      const k = n.toLowerCase(); const o = load.get(k) || { name: n, lead: 0, co: 0 };
      if (i === 0) o.lead++; else o.co++; load.set(k, o);
    });
  });
  const known = new Map(consultants.map(c => [s(c.fullName).toLowerCase(), c]));
  const bench = [...load.values()].map(x => ({ ...x, total: x.lead + x.co, inDirectory: known.has(x.name.toLowerCase()), id: known.get(x.name.toLowerCase())?.consultantId || '' }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
  const renewals = live.filter(c => ['renew', 'expired'].includes(contractAlert(c)))
    .map(c => ({ id: c.consultantId, name: s(c.fullName), alert: contractAlert(c), end: toIso(c.contractEnd), owner: s(c.owner), type: s(c.contractType) }))
    .sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
  return {
    total: consultants.length, active: consultants.filter(c => s(c.status) === 'Active').length, onboarding: consultants.filter(c => s(c.status) === 'Onboarding').length,
    alerts, renewals, bench, days, notInDirectory: [...load.values()].filter(x => !known.has(x.name.toLowerCase())).length,
  };
}
