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
import { pendingItems, OPS_RULES, EC_RULES, CDT_RULES, FIN_RULES, BD_RULES, SOL_RULES, LEAD_RULES, VENDOR_RULES, toIso } from '../config/pendingFields.js';
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
};
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
export function openTasks({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [] }) {
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

  return out.map(x => ({ ...x, days: daysBetween(t, x.due) }));
}

/* ─── Completed work (dated) ───────────────────────────────────────────────── */
// { id, tracker, record, label, date, amount? }
export function completedWork({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [] }) {
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
  // A future 'done' date is a typo or a plan, not completed work
  const t = todayIso();
  return out.filter(x => x.date <= t).sort((a, b) => b.date.localeCompare(a.date));
}

/* ─── Missing fields per tracker (same rules as the Reminders popup) ───────── */
export function missingByTracker({ sol = [], eng = [], ops = [], cdt = [], leads = [], vendors = [] }) {
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
  ].filter(m => m.tracker !== 'leads' && m.tracker !== 'vendors' || (m.tracker === 'leads' ? leads.length : vendors.length));
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
