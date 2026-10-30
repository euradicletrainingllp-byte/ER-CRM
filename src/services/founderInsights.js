/**
 * EURADICLE CRM — FOUNDER'S DESK INSIGHTS (forward view + risk radar)
 * ===================================================================
 * Pure functions over the rows Founder's Desk already loads. Nothing is fetched or saved.
 * Same money rules as the Finance Tracker (money.js: GST 18%, TDS 10%, collection capped at the bill),
 * same proposal rule as the BD Tracker (proposalData.js: latest version, BD Proposal Value only),
 * same revenue basis switch as Dashboard → Finance (Delivery month / Invoice month).
 *
 *   revenueOutlook   FY target vs achieved to date, confirmed + tentative bookings ahead, pace, run-rate needed
 *   cashForecast     money expected in the next 90 days, DSO, on-time %, TDS to claim, GST paid on unpaid bills
 *   clientMix        revenue concentration (last 12 months) and clients with no forward business
 *   deliveryRisks    next 45 days: consultant clashes, no consultant, tentative, unpriced, PO not confirmed,
 *                    not in Ops / low readiness, consultant contract expired
 *   pipelineHealth   stale proposals, no value, submitted with no answer, coverage of the target gap
 *   qualitySummary   feedback scores — last 90 days vs the 90 before, low scores, missing feedback
 *   riskRadar        all of the above turned into one ranked list of High / Medium / Low risks
 *
 * Thresholds live in RISK_RULES so they can be tuned in one place.
 */
import { financeStage } from '../pages/FinanceTracker.jsx';
import { toIso } from '../config/pendingFields.js';
import { contractAlert } from './consultantsApi.js';
import { leadIsOpen, isBillable } from '../config/leadVendorOptions.js';
import { buildProposals, toRupees } from '../components/proposalData.js';
import { money, collectedOf, expectedOf, gstOf, tdsOf } from './money.js';
import { FIN_TARGET_CR, SALES_TARGETS, FIN_CREDIT_NOTES } from '../config/dashboardBaseline.js';
import { todayIso, daysBetween, addDaysIso, upcomingDeliveries, bdLines } from './actionItems.js';

/* ─── Tunable thresholds ───────────────────────────────────────────────────── */
export const RISK_RULES = {
  tentativeWeight: 0.5,        // a Tentative session counts as half in the projection
  paceHigh: 0.8,               // achieved < 80% of pro-rata target → High
  paceMedium: 0.95,            // < 95% → Medium
  monthCoverHigh: 0.25,        // a coming month booked below 25% of its target → High
  monthCoverMedium: 0.5,       // below 50% → Medium
  pipelineCoverHigh: 1.5,      // open pipeline < 1.5× the uncovered target gap → High
  pipelineCoverMedium: 3,      // < 3× → Medium (usual sales rule: 3× coverage)
  staleDays: 60,               // In Process proposal older than this → stale
  noAnswerDays: 30,            // submitted to client, still In Process after this many days
  overdueShareHigh: 0.3,       // overdue receivables > 30% of outstanding → High
  dsoMedium: 60, dsoHigh: 90,  // average days from invoice to payment
  invoiceLateDays: 7,          // session ended, invoice not raised for this many days
  topClientHigh: 0.35, topClientMedium: 0.25, top3Medium: 0.7,   // share of last-12-month revenue
  horizonDays: 45,             // delivery risks look this far ahead
  noConsultantDays: 14, tentativeDays: 10, notInOpsDays: 14, lowReadyDays: 7, lowReadyPct: 50, poDays: 30,
  keyPersonShare: 0.4,         // one consultant leads > 40% of session days in the next 90 days
  overloadDays: 12,            // > 12 session days in the next 30 days for one consultant
  feedbackLow: 4,              // a session scored below 4 / 5
  feedbackAvgMedium: 4.2, feedbackDrop: 0.3,
  ownerOverdue: 10,            // one owner holding this many overdue tasks
};

const s = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = v => money(v);
const pad2 = n => String(n).padStart(2, '0');
const NOT_REVENUE = /cancel|lost|drop|postpon|hold/i;
const CANCEL = /cancel/i;
const isTentative = e => /tentative/i.test(s(e.status));
const isDelivered = e => /deliver/i.test(s(e.status));
export const MONTHS_FY = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const fyOf = iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 4 ? y : y - 1; };
const slotOf = iso => (+iso.slice(5, 7) + 8) % 12;          // Apr = 0 … Mar = 11
const startOf = e => toIso(e.startDate);
const endOf = e => toIso(e.endDate) || toIso(e.startDate);
const L = v => '₹' + ((Number(v) || 0) / 1e5).toFixed(1) + ' L';
const fmtMoney = v => { const n = Number(v) || 0; return n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : L(n); };
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = v => Math.round((Number(v) || 0) * 100) + '%';

/** Client name → grouping key ("DBS Bank" → "dbs", "Axis Max Life" → "axis", "FORD" → "ford"). */
const STOP = new Set(['the', 'ltd', 'limited', 'pvt', 'private', 'india', 'bank', 'inc', 'llp', 'co', 'company', 'group', 'and', 'of', 'm', 's']);
export function clientKey(name) {
  const words = s(name).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w && !STOP.has(w));
  return words[0] || s(name).toLowerCase();
}

/** Days a session takes (Day column, else the date span). */
const sessionDays = e => {
  const d = Number(e.day);
  if (d > 0) return d;
  const st = startOf(e), en = endOf(e);
  return st && en ? Math.max(1, daysBetween(st, en) + 1) : 1;
};

/* ─── Revenue outlook vs target ───────────────────────────────────────────── */
/**
 * basis 'delivery' — Price (INR) by session start month (cancelled / lost / postponed / on hold excluded).
 *   achieved = sessions that have started; confirmed = future sessions not Tentative; tentative = future Tentative.
 * basis 'invoice'  — achieved = Price of rows invoiced in the FY up to today (cancelled excluded);
 *   confirmed / tentative = sessions not invoiced yet, placed in the month their invoice is due (end + 1 day).
 */
export function revenueOutlook(eng = [], sol = [], { basis = 'delivery', today = todayIso() } = {}) {
  const fy = fyOf(today);
  const fyFrom = `${fy}-04-01`, fyTo = `${fy + 1}-03-31`;
  const z = () => Array(12).fill(0);
  const achieved = z(), confirmed = z(), tentative = z(), lastFy = z();
  const lastYearToday = `${+today.slice(0, 4) - 1}${today.slice(4)}`;
  let lastFyToDate = 0;
  const forwardRows = [];

  eng.forEach(e => {
    const price = num(e.price);
    if (!price) return;
    if (basis === 'invoice') {
      const inv = toIso(e.invoice);
      if (CANCEL.test(s(e.status))) return;
      if (inv) {
        if (fyOf(inv) === fy && inv <= today) achieved[slotOf(inv)] += price;
        if (fyOf(inv) === fy - 1) { lastFy[slotOf(inv)] += price; if (inv <= lastYearToday) lastFyToDate += price; }
        return;
      }
      if (NOT_REVENUE.test(s(e.status))) return;
      const st = startOf(e);
      if (!st || st < addDaysIso(fyFrom, -90)) return;            // very old un-invoiced rows are a data issue, not revenue
      let due = addDaysIso(endOf(e), 1);
      if (due < today) due = today;
      if (due > fyTo) return;
      (isTentative(e) ? tentative : confirmed)[slotOf(due)] += price;
      forwardRows.push({ e, date: due, price });
      return;
    }
    if (NOT_REVENUE.test(s(e.status))) return;
    const st = startOf(e);
    if (!st) return;
    if (fyOf(st) === fy - 1) { lastFy[slotOf(st)] += price; if (st <= lastYearToday) lastFyToDate += price; }
    if (fyOf(st) !== fy) return;
    if (st <= today || isDelivered(e)) achieved[slotOf(st)] += price;
    else { (isTentative(e) ? tentative : confirmed)[slotOf(st)] += price; forwardRows.push({ e, date: st, price }); }
  });

  // Targets: FY target (₹ Cr) and quarterly targets; a missing quarter shares what is left of the FY target
  const fyTarget = FIN_TARGET_CR[fy] ? FIN_TARGET_CR[fy] * 1e7 : (SALES_TARGETS[fy] || []).reduce((t, q) => t + (q || 0), 0);
  const q = SALES_TARGETS[fy] || [null, null, null, null];
  const knownQ = q.reduce((t, v) => t + (v || 0), 0);
  const missingQ = q.filter(v => !v).length;
  const fillQ = missingQ && fyTarget > knownQ ? (fyTarget - knownQ) / missingQ : 0;
  const quarterTarget = q.map(v => v || fillQ || (fyTarget ? fyTarget / 4 : 0));
  const monthTarget = MONTHS_FY.map((_, i) => quarterTarget[Math.floor(i / 3)] / 3);

  const sum = a => a.reduce((t, v) => t + v, 0);
  const nowSlot = slotOf(today);
  const daysInMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const monthFrac = +today.slice(8, 10) / daysInMonth;
  const proRata = sum(monthTarget.slice(0, nowSlot)) + monthTarget[nowSlot] * monthFrac;
  const A = sum(achieved), C = sum(confirmed), T = sum(tentative);
  const projected = A + C + T * RISK_RULES.tentativeWeight;
  const monthsLeft = 12 - nowSlot - monthFrac;
  const gapAfterBooked = Math.max(0, fyTarget - projected);

  // Pipeline: open proposals (latest version, BD value) weighted by the historical win rate
  const props = buildProposals(sol);
  const won = props.filter(p => p.pipeline === 'closed').length, lost = props.filter(p => p.pipeline === 'lost').length;
  const winRate = won + lost ? won / (won + lost) : 0;
  const openV = props.filter(p => p.pipeline === 'process').reduce((t, p) => t + (p.bdValue || 0), 0);

  const quarters = [0, 1, 2, 3].map(i => {
    const a = sum(achieved.slice(i * 3, i * 3 + 3)), c = sum(confirmed.slice(i * 3, i * 3 + 3)), t = sum(tentative.slice(i * 3, i * 3 + 3));
    return { q: `Q${i + 1}`, target: quarterTarget[i], targetSet: !!q[i], achieved: a, confirmed: c, tentative: t,
      pct: quarterTarget[i] ? (a + c) / quarterTarget[i] : null, current: Math.floor(nowSlot / 3) === i, past: Math.floor(nowSlot / 3) > i };
  });

  return {
    fy, basis, months: MONTHS_FY, nowSlot, achieved, confirmed, tentative, lastFy, monthTarget, quarters,
    target: fyTarget, achievedTotal: A, confirmedTotal: C, tentativeTotal: T, projected, proRata,
    pace: proRata ? A / proRata : null,
    achievedPct: fyTarget ? A / fyTarget : null, projectedPct: fyTarget ? projected / fyTarget : null,
    gapAfterBooked, monthsLeft, runRateNeeded: monthsLeft > 0.2 ? gapAfterBooked / monthsLeft : gapAfterBooked,
    avgMonthlyAchieved: nowSlot + monthFrac > 0 ? A / (nowSlot + monthFrac) : 0,
    lastFyToDate, yoy: lastFyToDate ? (A - lastFyToDate) / lastFyToDate : null,
    winRate, openPipeline: openV, weightedPipeline: openV * winRate,
    coverage: gapAfterBooked > 0 ? openV / gapAfterBooked : null,
    creditNotes: (FIN_CREDIT_NOTES[fy] || []).reduce((t, c) => t + (Number(c[2]) || 0) * 1e5, 0),
    forwardRows: forwardRows.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/* ─── Cash forecast ───────────────────────────────────────────────────────── */
const OPEN_STAGES = ['Awaiting Payment', 'Payment Overdue', 'Partly Received'];
export function cashForecast(eng = [], { today = todayIso(), horizon = 90 } = {}) {
  const buckets = ['Overdue now', 'Next 30 days', '31–60 days', '61–90 days'].map(label => ({ label, invoiced: 0, toInvoice: 0, upcoming: 0, rows: [] }));
  const bucketOf = d => (d < today ? 0 : daysBetween(today, d) <= 30 ? 1 : daysBetween(today, d) <= 60 ? 2 : daysBetween(today, d) <= horizon ? 3 : -1);
  let gstOnUnpaid = 0;
  eng.forEach(e => {
    if (CANCEL.test(s(e.status))) return;
    const stage = s(e.engagementKey) ? financeStage(e) : '';
    const inv = toIso(e.invoice);
    if (OPEN_STAGES.includes(stage) && inv) {
      const exp = expectedOf(e), got = collectedOf(e).gross;
      const bal = Math.max(0, exp - got);
      if (!bal) return;
      const due = addDaysIso(inv, 30);
      const b = bucketOf(due);
      if (b >= 0) { buckets[b].invoiced += bal; buckets[b].rows.push({ e, due, amount: bal, kind: 'Invoice raised' }); }
      gstOnUnpaid += exp ? gstOf(e) * (bal / exp) : 0;            // GST is paid to the government when the invoice is raised
      return;
    }
    if (inv || NOT_REVENUE.test(s(e.status)) || ['Received', 'Not Applicable'].includes(stage)) return;
    const st = startOf(e), en = endOf(e);
    if (!st) return;
    const amount = expectedOf(e);
    if (!amount) return;
    if (en < today) {                                             // ended, not invoiced: invoice now, paid 30 days later
      if (daysBetween(en, today) > 365) return;
      const due = addDaysIso(today, 30);
      const b = bucketOf(due);
      if (b >= 0) { buckets[b].toInvoice += amount; buckets[b].rows.push({ e, due, amount, kind: 'To invoice' }); }
      return;
    }
    if (st > addDaysIso(today, horizon)) return;
    const due = addDaysIso(en, 31);                               // invoice the day after, 30-day credit
    const b = bucketOf(due);
    if (b >= 0) { buckets[b].upcoming += amount * (isTentative(e) ? RISK_RULES.tentativeWeight : 1); buckets[b].rows.push({ e, due, amount, kind: isTentative(e) ? 'Upcoming (tentative)' : 'Upcoming session' }); }
  });
  buckets.forEach(b => { b.total = b.invoiced + b.toInvoice + b.upcoming; b.rows.sort((x, y) => y.amount - x.amount); });

  // Payment behaviour over the last 12 months
  const yearAgo = addDaysIso(today, -365), q = addDaysIso(today, -90), q2 = addDaysIso(today, -180);
  const paid = eng.map(e => ({ e, inv: toIso(e.invoice), rec: toIso(e.receivedDate), amt: collectedOf(e).amount }))
    .filter(x => x.inv && x.rec && x.rec >= x.inv && x.rec > yearAgo && x.rec <= today && x.amt > 0);
  const dsoOf = list => { const w = list.reduce((t, x) => t + x.amt, 0); return w ? list.reduce((t, x) => t + daysBetween(x.inv, x.rec) * x.amt, 0) / w : null; };
  const recent = paid.filter(x => x.rec > q), prior = paid.filter(x => x.rec > q2 && x.rec <= q);
  const byClient = new Map();
  paid.forEach(x => { const k = s(x.e.company); const o = byClient.get(k) || { client: k, w: 0, d: 0, n: 0 }; o.w += x.amt; o.d += daysBetween(x.inv, x.rec) * x.amt; o.n++; byClient.set(k, o); });
  const slowPayers = [...byClient.values()].filter(o => o.n >= 2).map(o => ({ client: o.client, days: Math.round(o.d / o.w), payments: o.n }))
    .sort((a, b) => b.days - a.days).slice(0, 5);

  // TDS deducted by clients this FY (to match in Form 26AS) — rows paid in the FY
  const fy = fyOf(today);
  const tdsFy = eng.filter(e => { const r = toIso(e.receivedDate) || (s(e.payment).toLowerCase().includes('received') ? toIso(e.invoice) : ''); return r && fyOf(r) === fy; })
    .reduce((t, e) => t + tdsOf(e), 0);

  return {
    buckets, next90: buckets.slice(1).reduce((t, b) => t + b.total, 0), overdueNow: buckets[0].total,
    dso: dsoOf(paid), dsoRecent: dsoOf(recent), dsoPrior: dsoOf(prior),
    onTimePct: paid.length ? paid.filter(x => daysBetween(x.inv, x.rec) <= 30).length / paid.length : null,
    paidCount: paid.length, slowPayers, gstOnUnpaid, tdsFy,
  };
}

/* ─── Client concentration & retention ────────────────────────────────────── */
export function clientMix(eng = [], sol = [], { today = todayIso() } = {}) {
  const from = addDaysIso(today, -365);
  const rev = new Map();
  const names = new Map();
  const lastSession = new Map();
  const forward = new Map();
  eng.forEach(e => {
    if (NOT_REVENUE.test(s(e.status))) return;
    const st = startOf(e); const k = clientKey(e.company);
    if (!st || !k) return;
    if (!names.has(k)) names.set(k, s(e.company));
    if (st > from && st <= today) {
      rev.set(k, (rev.get(k) || 0) + num(e.price));
      if (!lastSession.get(k) || st > lastSession.get(k).date) lastSession.set(k, { date: st, topic: s(e.topic) });
    }
    if (endOf(e) >= today) forward.set(k, (forward.get(k) || 0) + num(e.price));
  });
  const total = [...rev.values()].reduce((t, v) => t + v, 0);
  const ranked = [...rev.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, name: names.get(k), revenue: v, share: total ? v / total : 0, forward: forward.get(k) || 0 }));
  const openProps = buildProposals(sol).filter(p => p.pipeline === 'process');
  const openBy = new Map();
  openProps.forEach(p => { const k = clientKey(p.client); openBy.set(k, (openBy.get(k) || 0) + (p.bdValue || 0)); });
  const noForward = ranked.filter(c => !c.forward && !openBy.has(c.key))
    .map(c => ({ ...c, last: lastSession.get(c.key)?.date || '', lastTopic: lastSession.get(c.key)?.topic || '' }));
  const hhi = ranked.reduce((t, c) => t + c.share * c.share, 0);
  return {
    total, clients: ranked.length, top: ranked.slice(0, 8),
    topShare: ranked[0]?.share || 0, top3Share: ranked.slice(0, 3).reduce((t, c) => t + c.share, 0),
    hhi, effectiveClients: hhi ? 1 / hhi : 0,
    noForward, noForwardValue: noForward.reduce((t, c) => t + c.revenue, 0),
    withPipeline: ranked.filter(c => openBy.has(c.key)).length,
  };
}

/* ─── Delivery risks (next N days) ────────────────────────────────────────── */
export function deliveryRisks(eng = [], ops = [], consultants = [], { today = todayIso(), days = RISK_RULES.horizonDays } = {}) {
  const R = RISK_RULES;
  const up = upcomingDeliveries(eng, ops, days);
  const within = (e, n) => e._start <= addDaysIso(today, n);
  const keyOfRow = e => `${s(e.egId)}|${s(e.sno)}`;
  const flags = new Map();
  const flag = (e, f) => { const k = keyOfRow(e); flags.set(k, [...(flags.get(k) || []), f]); };

  // Same consultant on two sessions whose dates overlap (different client or different start)
  const byCons = new Map();
  up.forEach(e => [e.consultant1, e.consultant2, e.consultant3].map(s).filter(Boolean).forEach(n => {
    const k = n.toLowerCase(); byCons.set(k, [...(byCons.get(k) || []), { e, name: n }]);
  }));
  const clashes = [];
  byCons.forEach(list => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i].e, b = list[j].e;
      if (a === b) continue;
      if (a._start <= b._end && b._start <= a._end && !(s(a.company).toLowerCase() === s(b.company).toLowerCase() && a._start === b._start)) {
        clashes.push({ name: list[i].name, a, b, date: a._start > b._start ? a._start : b._start });
        flag(a, 'Consultant clash'); flag(b, 'Consultant clash');
      }
    }
  });

  const noConsultant = up.filter(e => within(e, R.noConsultantDays) && !s(e.consultant1) && !s(e.consultant2));
  const tentativeSoon = up.filter(e => within(e, R.tentativeDays) && isTentative(e));
  const unpriced = up.filter(e => !num(e.price));
  const poOk = e => /receiv|yes|done|signed|approv|n\/?a\b|not required|confirm/i.test(s(e.poStatus));
  const poRisk = up.filter(e => within(e, R.poDays) && !poOk(e) && (/pend|await|not|^no\b|progress|wip/i.test(s(e.poStatus)) || (!s(e.poStatus) && !s(e.contract))));
  const notInOps = up.filter(e => within(e, R.notInOpsDays) && !e._ops);
  const lowReady = up.filter(e => within(e, R.lowReadyDays) && e._ops && e.ready < R.lowReadyPct);
  const known = new Map(consultants.map(c => [s(c.fullName).toLowerCase(), c]));
  const expiredOnSession = [];
  up.forEach(e => [e.consultant1, e.consultant2, e.consultant3].map(s).filter(Boolean).forEach(n => {
    const c = known.get(n.toLowerCase());
    if (!c) return;
    const a = contractAlert(c);
    if (a === 'expired' || a === 'terminated' || s(c.status) === 'Inactive') expiredOnSession.push({ e, name: n, end: toIso(c.contractEnd), alert: a === 'terminated' ? 'Terminated' : s(c.status) === 'Inactive' ? 'Inactive' : 'Expired' });
  }));
  noConsultant.forEach(e => flag(e, 'No consultant'));
  tentativeSoon.forEach(e => flag(e, 'Still tentative'));
  unpriced.forEach(e => flag(e, 'No price'));
  poRisk.forEach(e => flag(e, 'PO not confirmed'));
  expiredOnSession.forEach(x => flag(x.e, `${x.name}: contract ${x.alert.toLowerCase()}`));

  // Consultant load: session days in the next 90 / 30 days
  const load90 = new Map(), load30 = new Map();
  let days90 = 0;
  eng.forEach(e => {
    if (NOT_REVENUE.test(s(e.status))) return;
    const st = startOf(e);
    if (!st || endOf(e) < today || st > addDaysIso(today, 90)) return;
    const d = sessionDays(e);
    days90 += d;
    const lead = s(e.consultant1);
    if (lead) load90.set(lead, (load90.get(lead) || 0) + d);
    if (st <= addDaysIso(today, 30)) [e.consultant1, e.consultant2, e.consultant3].map(s).filter(Boolean).forEach(n => load30.set(n, (load30.get(n) || 0) + d));
  });
  const leadShare = [...load90.entries()].map(([name, d]) => ({ name, days: d, share: days90 ? d / days90 : 0 })).sort((a, b) => b.days - a.days);
  const overloaded = [...load30.entries()].filter(([, d]) => d > R.overloadDays).map(([name, d]) => ({ name, days: d })).sort((a, b) => b.days - a.days);

  return { upcoming: up, flags, clashes, noConsultant, tentativeSoon, unpriced, poRisk, notInOps, lowReady, expiredOnSession, leadShare, overloaded, days90 };
}

/* ─── Pipeline health ─────────────────────────────────────────────────────── */
export function pipelineHealth(sol = [], { today = todayIso() } = {}) {
  const R = RISK_RULES;
  const props = buildProposals(sol);
  const open = props.filter(p => p.pipeline === 'process');
  const aged = open.map(p => ({ ...p, age: p.date ? daysBetween(p.date, today) : null }));
  const stale = aged.filter(p => p.age != null && p.age > R.staleDays).sort((a, b) => b.age - a.age);
  const noValue = aged.filter(p => !p.bdValue);
  const noAnswer = bdLines(sol).filter(r => s(r.bdStatus) === 'In Process' && toIso(r.submissionToClient) && daysBetween(toIso(r.submissionToClient), today) > R.noAnswerDays)
    .map(r => ({ id: s(r.proposalId), client: s(r.clientName), topic: s(r.programTopic), sent: toIso(r.submissionToClient), age: daysBetween(toIso(r.submissionToClient), today), value: toRupees(r.bdProposalValue) }))
    .sort((a, b) => b.age - a.age);
  const fy = fyOf(today);
  const rate = list => { const w = list.filter(p => p.pipeline === 'closed').length, l = list.filter(p => p.pipeline === 'lost').length; return w + l ? w / (w + l) : null; };
  const ageBands = [['0–30 days', 0, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['90+', 91, 1e9]].map(([label, a, b]) => {
    const list = aged.filter(p => p.age != null && p.age >= a && p.age <= b);
    return { label, count: list.length, value: list.reduce((t, p) => t + (p.bdValue || 0), 0) };
  });
  return {
    open: aged, stale, staleValue: stale.reduce((t, p) => t + (p.bdValue || 0), 0), noValue, noAnswer, ageBands,
    winRateFy: rate(props.filter(p => p.date && fyOf(p.date) === fy)), winRateLastFy: rate(props.filter(p => p.date && fyOf(p.date) === fy - 1)),
  };
}

/* ─── Delivery quality (Feedback column) ──────────────────────────────────── */
const scoreOf = v => {
  const m = s(v).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 0 && n <= 5) return n;
  if (n > 5 && n <= 10) return n / 2;               // a 10-point score, shown out of 5
  return null;
};
export function qualitySummary(eng = [], { today = todayIso() } = {}) {
  const d90 = addDaysIso(today, -90), d180 = addDaysIso(today, -180);
  const delivered = eng.filter(e => isDelivered(e) && endOf(e) && endOf(e) <= today).map(e => ({ e, end: endOf(e), score: scoreOf(e.feedback) }));
  const avg = list => { const v = list.filter(x => x.score != null); return v.length ? v.reduce((t, x) => t + x.score, 0) / v.length : null; };
  const recent = delivered.filter(x => x.end > d90), prior = delivered.filter(x => x.end > d180 && x.end <= d90);
  const low = recent.filter(x => x.score != null && x.score < RISK_RULES.feedbackLow).sort((a, b) => a.score - b.score);
  const missing = delivered.filter(x => x.score == null && x.end <= addDaysIso(today, -7) && x.end > addDaysIso(today, -60));
  return { avgRecent: avg(recent), avgPrior: avg(prior), scored: recent.filter(x => x.score != null).length, sessions: recent.length, low, missing };
}

/* ─── Risk radar ──────────────────────────────────────────────────────────── */
const LEVEL_RANK = { high: 0, medium: 1, low: 2 };
export const RISK_AREAS = ['Revenue', 'Cash', 'Sales', 'Delivery', 'Clients', 'People', 'Quality', 'Data'];
const sessionRow = (e, right, extra = []) => ({
  id: `${s(e.egId)}|${s(e.sno)}|${right}`, main: s(e.company) || '(no company)',
  sub: [startOf(e), s(e.topic), s(e.consultant1) || 'no consultant'].filter(Boolean).join(' · '), right,
  details: [['S No', s(e.sno)], ['EG.ID', s(e.egId)], ['Dates', [startOf(e), endOf(e)].filter((v, i, a) => v && a.indexOf(v) === i).join(' → ')], ['Status', s(e.status)],
    ['Lead consultant', s(e.consultant1)], ['Co-consultant', s(e.consultant2)], ['Price', num(e.price) ? '₹ ' + num(e.price).toLocaleString('en-IN') : '—'],
    ['Contract / PO', [s(e.contract), s(e.poStatus)].filter(Boolean).join(' · ')], ['Location', s(e.location)], ...extra],
});

/**
 * One ranked list of risks. Inputs are the already-built summaries so nothing is computed twice.
 * Each risk: { id, level, area, title, metric, why, how, rows, go (section id), tracker }
 */
export function riskRadar({ outlook, forecast, mix, delivery, pipe, quality, cash, tasks = [], clientSum, leads = [], vendors = [], missing = [], today = todayIso() }) {
  const R = RISK_RULES;
  const out = [];
  const add = r => out.push(r);

  // ── Revenue
  if (outlook?.target && outlook.pace != null) {
    const lvl = outlook.pace < R.paceHigh ? 'high' : outlook.pace < R.paceMedium ? 'medium' : null;
    if (lvl) add({ id: 'rev-pace', level: lvl, area: 'Revenue', go: 'outlook', tracker: 'engagement',
      title: 'Revenue behind the target pace', metric: `${pct(outlook.pace)} of where the FY target says it should be today`,
      why: `Achieved ${fmtMoney(outlook.achievedTotal)} against ${fmtMoney(outlook.proRata)} expected by today (FY target ${fmtMoney(outlook.target)}).`,
      how: 'Achieved to date ÷ (monthly targets of the months gone + the share of this month elapsed). Monthly target = quarterly target ÷ 3.' });
    if (outlook.projected < outlook.target) add({ id: 'rev-gap', level: outlook.projectedPct < 0.8 ? 'high' : 'medium', area: 'Revenue', go: 'outlook', tracker: 'engagement',
      title: 'Booked business does not reach the FY target', metric: `${fmtMoney(outlook.gapAfterBooked)} still to win · ${fmtMoney(outlook.runRateNeeded)} a month needed`,
      why: `Achieved + confirmed + half of tentative = ${fmtMoney(outlook.projected)} (${pct(outlook.projectedPct)} of target). The rest must come from new wins delivered before 31 March.`,
      how: 'Projection = achieved + confirmed future sessions + 50% of tentative ones in this FY. Run-rate = gap ÷ months left.' });
    const cliffs = [];
    for (let i = outlook.nowSlot + 1; i <= Math.min(11, outlook.nowSlot + 3); i++) {
      const t = outlook.monthTarget[i]; if (!t) continue;
      const booked = outlook.confirmed[i] + outlook.tentative[i] * R.tentativeWeight;
      if (booked < t * R.monthCoverMedium) cliffs.push({ i, booked, t, cover: booked / t });
    }
    if (cliffs.length) add({ id: 'rev-cliff', level: cliffs.some(c => c.cover < R.monthCoverHigh) ? 'high' : 'medium', area: 'Revenue', go: 'outlook', tracker: 'engagement',
      title: 'Thin bookings in the coming months', metric: cliffs.map(c => `${outlook.months[c.i]} ${pct(c.cover)} booked`).join(' · '),
      why: 'These months have less than half of their revenue target booked in the Engagement Calendar.',
      how: 'Confirmed + 50% tentative sessions in the month ÷ the month\'s target (next 3 months).',
      rows: cliffs.map(c => ({ id: 'cliff' + c.i, main: outlook.months[c.i], sub: `target ${fmtMoney(c.t)}`, right: `${fmtMoney(c.booked)} booked`, details: [['Month target', fmtMoney(c.t)], ['Confirmed', fmtMoney(outlook.confirmed[c.i])], ['Tentative', fmtMoney(outlook.tentative[c.i])], ['Covered', pct(c.cover)]] })) });
  }

  // ── Sales
  if (outlook?.coverage != null) {
    const lvl = outlook.coverage < R.pipelineCoverHigh ? 'high' : outlook.coverage < R.pipelineCoverMedium ? 'medium' : null;
    if (lvl) add({ id: 'sales-cover', level: lvl, area: 'Sales', go: 'pipeline', tracker: 'bd',
      title: 'Pipeline too small to close the target gap', metric: `${outlook.coverage.toFixed(1)}× coverage (healthy ≥ 3×)`,
      why: `Open pipeline ${fmtMoney(outlook.openPipeline)} vs ${fmtMoney(outlook.gapAfterBooked)} not yet booked. At the ${pct(outlook.winRate)} win rate it is worth about ${fmtMoney(outlook.weightedPipeline)}.`,
      how: 'BD Proposal Value of open proposals (latest version) ÷ (FY target − projection). Win rate = won ÷ (won + lost), all proposals.' });
  }
  if (pipe?.stale.length) add({ id: 'sales-stale', level: pipe.stale.length >= 5 ? 'medium' : 'low', area: 'Sales', go: 'pipeline', tracker: 'bd',
    title: `Proposals in process for over ${R.staleDays} days`, metric: `${pl(pipe.stale.length, 'proposal')} · ${fmtMoney(pipe.staleValue)}`,
    why: 'Old proposals still marked In Process inflate the pipeline. Close them as Won / Lost or chase the client.',
    how: 'Latest version In Process, dated (Date of Discussion → BD Month → submission dates) more than 60 days ago.',
    rows: pipe.stale.slice(0, 10).map(p => ({ id: 'st' + p.id, main: p.client || '(no client)', sub: `${p.id} · ${p.topic || '—'}`, right: `${p.age}d · ${fmtMoney(p.bdValue)}`, details: [['Proposal', `${p.id} V${p.version}`], ['Dated', p.date], ['Status', p.status], ['BD value', fmtMoney(p.bdValue)], ['Proposal link', p.link]] })) });
  if (pipe?.noAnswer.length) add({ id: 'sales-noanswer', level: 'medium', area: 'Sales', go: 'pipeline', tracker: 'bd',
    title: `Submitted, no client answer for ${R.noAnswerDays}+ days`, metric: `${pl(pipe.noAnswer.length, 'proposal')} · ${fmtMoney(pipe.noAnswer.reduce((t, p) => t + p.value, 0))}`,
    why: 'These proposals reached the client but are still In Process. A follow-up call usually decides them.',
    how: 'Latest version In Process with a Date of Submission to Client older than 30 days.',
    rows: pipe.noAnswer.slice(0, 10).map(p => ({ id: 'na' + p.id, main: p.client, sub: `${p.id} · ${p.topic}`, right: `${p.age}d`, details: [['Sent to client', p.sent], ['BD value', fmtMoney(p.value)]] })) });
  if (pipe?.winRateFy != null && pipe.winRateLastFy != null && pipe.winRateFy < pipe.winRateLastFy - 0.1) add({ id: 'sales-winrate', level: 'medium', area: 'Sales', go: 'pipeline', tracker: 'bd',
    title: 'Win rate falling', metric: `${pct(pipe.winRateFy)} this FY vs ${pct(pipe.winRateLastFy)} last FY`,
    why: 'Fewer decided proposals are being won than last year.', how: 'Won ÷ (won + lost) unique proposals dated in each FY.' });

  // ── Cash
  if (cash?.outstanding > 0 && cash.overdueOut / cash.outstanding > R.overdueShareHigh) add({ id: 'cash-overdue', level: 'high', area: 'Cash', go: 'forecast', tracker: 'finance',
    title: 'Large share of receivables overdue', metric: `${fmtMoney(cash.overdueOut)} overdue · ${pct(cash.overdueOut / cash.outstanding)} of outstanding`,
    why: 'Invoices more than 30 days old and not paid.', how: 'Overdue = invoice date + 30 days passed, not Received / NA. Balance = Price + GST − TDS + travel − received.',
    rows: (forecast?.buckets[0].rows || []).slice(0, 10).map(x => sessionRow(x.e, fmtMoney(x.amount), [['Invoice date', toIso(x.e.invoice)], ['Due', x.due], ['Days overdue', String(daysBetween(x.due, today))]])) });
  else if (cash?.overdueOut > 0) add({ id: 'cash-overdue', level: 'medium', area: 'Cash', go: 'forecast', tracker: 'finance',
    title: 'Overdue receivables', metric: `${fmtMoney(cash.overdueOut)} overdue`, why: 'Invoices more than 30 days old and not paid.', how: 'Invoice date + 30 days passed, not Received / NA.',
    rows: (forecast?.buckets[0].rows || []).slice(0, 10).map(x => sessionRow(x.e, fmtMoney(x.amount), [['Invoice date', toIso(x.e.invoice)], ['Due', x.due]])) });
  if (cash?.aging?.['90+'] > 0) add({ id: 'cash-90', level: 'high', area: 'Cash', go: 'cash', tracker: 'finance',
    title: 'Invoices unpaid for 90+ days', metric: fmtMoney(cash.aging['90+']), why: 'Money this old is at risk of not being paid. Escalate or check whether it was paid and not recorded.',
    how: 'Open balance of invoices raised more than 90 days ago.' });
  const lateInv = tasks.filter(t => t.tracker === 'finance' && t.label === 'Raise invoice' && t.days < -R.invoiceLateDays);
  if (lateInv.length) add({ id: 'cash-noinv', level: lateInv.reduce((t, x) => t + (x.amount || 0), 0) > 1e6 ? 'high' : 'medium', area: 'Cash', go: 'attention', tracker: 'finance',
    title: `Sessions delivered, invoice not raised for ${R.invoiceLateDays}+ days`, metric: `${lateInv.length} · ${fmtMoney(lateInv.reduce((t, x) => t + (x.amount || 0), 0))}`,
    why: 'Every day without an invoice pushes the payment date out by a day.', how: 'Finance stage Invoice Overdue: session end + 1 day passed more than 7 days ago, no Invoice date.',
    rows: lateInv.sort((a, b) => a.days - b.days).slice(0, 10).map(t => ({ id: t.id, main: t.record, sub: t.sub, right: `${-t.days}d late`, details: t.details })) });
  if (forecast?.dso != null && forecast.dso > R.dsoMedium) add({ id: 'cash-dso', level: forecast.dso > R.dsoHigh ? 'high' : 'medium', area: 'Cash', go: 'forecast', tracker: 'finance',
    title: 'Clients take long to pay', metric: `${Math.round(forecast.dso)} days on average (terms 30)`,
    why: forecast.slowPayers.length ? `Slowest: ${forecast.slowPayers.slice(0, 3).map(p => `${p.client} ${p.days}d`).join(', ')}.` : 'Average time from invoice to payment over the last 12 months.',
    how: 'Days from Invoice date to Received Date, weighted by amount, payments received in the last 12 months.' });
  if (forecast?.gstOnUnpaid > 5e5) add({ id: 'cash-gst', level: 'low', area: 'Cash', go: 'forecast', tracker: 'finance',
    title: 'GST already paid on unpaid invoices', metric: fmtMoney(forecast.gstOnUnpaid),
    why: 'GST is paid to the government in the month after the invoice, before the client pays. This cash is tied up until collection.',
    how: '18% GST on the unpaid share of every open invoice.' });
  if (cash?.suspects?.length) add({ id: 'data-received', level: 'medium', area: 'Data', go: 'cash', tracker: 'finance',
    title: '"Amount Received" cells to check', metric: `${cash.suspects.length} cells`, why: 'These amounts cannot be read or are larger than the row\'s bill. Collection is capped meanwhile.',
    how: 'Same check as the Finance Tracker warning.', rows: cash.suspects.slice(0, 10).map((x, i) => ({ id: 'sus' + i, main: x.company, sub: `S No ${x.sno} · "${x.raw}"`, right: '', details: [['Reason', x.reason]] })) });

  // ── Clients
  if (mix?.total > 0) {
    const top = mix.top[0];
    const lvl = mix.topShare > R.topClientHigh ? 'high' : mix.topShare > R.topClientMedium || mix.top3Share > R.top3Medium ? 'medium' : null;
    if (lvl) add({ id: 'cl-conc', level: lvl, area: 'Clients', go: 'concentration', tracker: 'engagement',
      title: 'Revenue depends on a few clients', metric: `${top.name} ${pct(mix.topShare)} · top 3 ${pct(mix.top3Share)} of the last 12 months`,
      why: `Losing ${top.name} would remove ${fmtMoney(top.revenue)} of yearly revenue. Effective number of clients: ${mix.effectiveClients.toFixed(1)}.`,
      how: 'Price (INR) of sessions started in the last 12 months by client (cancelled / lost / postponed excluded). Client names grouped by their first word.' });
    if (mix.noForward.length) add({ id: 'cl-churn', level: mix.noForwardValue > 0.15 * mix.total ? 'high' : 'medium', area: 'Clients', go: 'concentration', tracker: 'clients',
      title: 'Recent clients with no next business', metric: `${pl(mix.noForward.length, 'client')} · ${fmtMoney(mix.noForwardValue)} last-12-month revenue`,
      why: 'They bought in the last 12 months but have no future session and no open proposal. Plan an account conversation.',
      how: 'Clients with revenue in the last 12 months, no Engagement Calendar session from today and no In Process proposal (matched on the client name\'s first word).',
      rows: mix.noForward.slice(0, 10).map(c => ({ id: 'nf' + c.key, main: c.name, sub: `last session ${c.last || '—'} · ${c.lastTopic || ''}`, right: fmtMoney(c.revenue), details: [['Revenue last 12 months', fmtMoney(c.revenue)], ['Share', pct(c.share)], ['Last session', c.last], ['Program', c.lastTopic]] })) });
  }
  if (clientSum?.atRisk) add({ id: 'cl-health', level: clientSum.watch.some(c => c.health === 'Red') ? 'high' : 'medium', area: 'Clients', go: 'clients', tracker: 'clients',
    title: 'Accounts marked Amber / Red', metric: `${pl(clientSum.atRisk, 'account')}`, why: 'Relationship Health set to Amber or Red in the Client Directory.', how: 'Client Directory → Relationship Health.',
    rows: clientSum.watch.filter(c => ['Red', 'Amber'].includes(c.health)).slice(0, 10).map(c => ({ id: 'h' + c.id, main: c.name, sub: c.owner ? `owner ${c.owner}` : 'no owner', right: `${c.health}`, details: [['Next action', c.nextAction], ['Last interaction', c.lastTouch]] })) });
  if (clientSum?.cold) add({ id: 'cl-cold', level: 'low', area: 'Clients', go: 'clients', tracker: 'clients',
    title: `Active accounts with no contact for ${clientSum.coldDays}+ days`, metric: `${pl(clientSum.cold, 'account')}`, why: 'No interaction logged recently.', how: 'Client Directory last interaction / interaction log.' });

  // ── Delivery
  if (delivery) {
    const D = delivery;
    if (D.clashes.length) add({ id: 'del-clash', level: 'high', area: 'Delivery', go: 'calendar', tracker: 'engagement',
      title: 'Consultant booked on two sessions at once', metric: `${D.clashes.length} clash${D.clashes.length > 1 ? 'es' : ''}`,
      why: 'The same consultant is on overlapping dates for different sessions. Re-assign or confirm it is one combined session.',
      how: `Next ${R.horizonDays} days; consultant 1 / 2 / 3; overlapping start–end dates; same client + same start date ignored.`,
      rows: D.clashes.slice(0, 10).map((c, i) => ({ id: 'cl' + i, main: c.name, sub: `${s(c.a.company)} (${c.a._start}) ↔ ${s(c.b.company)} (${c.b._start})`, right: c.date,
        details: [['Session A', `${s(c.a.company)} — ${s(c.a.topic)} · ${c.a._start} → ${c.a._end} · S No ${s(c.a.sno)}`], ['Session B', `${s(c.b.company)} — ${s(c.b.topic)} · ${c.b._start} → ${c.b._end} · S No ${s(c.b.sno)}`]] })) });
    if (D.expiredOnSession.length) add({ id: 'del-contract', level: 'high', area: 'People', go: 'consultants', tracker: 'consultants',
      title: 'Consultant on a coming session without a valid contract', metric: `${D.expiredOnSession.length} session${D.expiredOnSession.length > 1 ? 's' : ''}`,
      why: 'The Consultant Directory shows the contract expired / terminated or the consultant inactive.', how: `Next ${R.horizonDays} days, matched by consultant name.`,
      rows: D.expiredOnSession.slice(0, 10).map(x => sessionRow(x.e, `${x.name} · ${x.alert}`, [['Contract end', x.end]])) });
    if (D.noConsultant.length) add({ id: 'del-nocons', level: 'high', area: 'Delivery', go: 'calendar', tracker: 'engagement',
      title: `Sessions in the next ${R.noConsultantDays} days with no consultant`, metric: `${pl(D.noConsultant.length, 'session')}`,
      why: 'No consultant 1 or 2 in the Engagement Calendar.', how: 'Start date within 14 days, not cancelled / postponed.', rows: D.noConsultant.slice(0, 10).map(e => sessionRow(e, e._start)) });
    if (D.lowReady.length) add({ id: 'del-ready', level: 'high', area: 'Delivery', go: 'ops', tracker: 'ops',
      title: `Sessions this week below ${R.lowReadyPct}% ready`, metric: `${pl(D.lowReady.length, 'session')}`, why: 'Ops Checklist items still open close to the session.', how: 'Start within 7 days, Ops readiness (Yes / NA ÷ all items) below 50%.',
      rows: D.lowReady.map(e => sessionRow(e, `${e.ready}% ready`, [['Open items', String(e.openItems)], ['Late items', String(e.lateItems)]])) });
    if (D.notInOps.length) add({ id: 'del-noops', level: 'medium', area: 'Delivery', go: 'ops', tracker: 'ops',
      title: `Sessions in the next ${R.notInOpsDays} days not in the Ops Checklist`, metric: `${pl(D.notInOps.length, 'session')}`, why: 'Nobody is tracking logistics for them yet.', how: 'No Ops Checklist row with the same Index.', rows: D.notInOps.slice(0, 10).map(e => sessionRow(e, e._start)) });
    if (D.tentativeSoon.length) add({ id: 'del-tent', level: 'medium', area: 'Delivery', go: 'calendar', tracker: 'engagement',
      title: `Still tentative, starting within ${R.tentativeDays} days`, metric: `${pl(D.tentativeSoon.length, 'session')} · ${fmtMoney(D.tentativeSoon.reduce((t, e) => t + num(e.price), 0))}`,
      why: 'Confirm with the client or release the consultant.', how: 'Status = Tentative, start within 10 days.', rows: D.tentativeSoon.map(e => sessionRow(e, e._start)) });
    if (D.poRisk.length) add({ id: 'del-po', level: 'medium', area: 'Cash', go: 'calendar', tracker: 'engagement',
      title: `PO / contract not confirmed for sessions in the next ${R.poDays} days`, metric: `${pl(D.poRisk.length, 'session')} · ${fmtMoney(D.poRisk.reduce((t, e) => t + num(e.price), 0))}`,
      why: 'Delivering without a PO is the most common reason invoices get stuck.', how: 'PO Status pending / awaited / not received, or both PO Status and Contract blank.',
      rows: D.poRisk.slice(0, 10).map(e => sessionRow(e, s(e.poStatus) || 'blank')) });
    if (D.unpriced.length) add({ id: 'del-price', level: 'medium', area: 'Revenue', go: 'calendar', tracker: 'engagement',
      title: 'Coming sessions with no price', metric: `${pl(D.unpriced.length, 'session')}`, why: 'They add ₹0 to revenue, targets and invoices until Price (INR) is filled.', how: `Next ${R.horizonDays} days, Price (INR) blank or 0.`,
      rows: D.unpriced.slice(0, 10).map(e => sessionRow(e, e._start)) });
    const top = D.leadShare[0];
    if (top && D.days90 >= 10 && top.share > R.keyPersonShare) add({ id: 'ppl-key', level: 'medium', area: 'People', go: 'consultants', tracker: 'consultants',
      title: 'Delivery depends on one consultant', metric: `${top.name} leads ${pct(top.share)} of session days (next 90 days)`,
      why: `${top.days} of ${D.days90} session days. Plan a backup facilitator for key programs.`, how: 'Day column (else date span) of sessions in the next 90 days, by consultant 1.' });
    if (D.overloaded.length) add({ id: 'ppl-load', level: 'medium', area: 'People', go: 'consultants', tracker: 'engagement',
      title: `Consultants with more than ${R.overloadDays} session days in 30 days`, metric: D.overloaded.map(o => `${o.name} ${o.days}d`).join(' · '),
      why: 'Heavy back-to-back delivery affects quality and travel.', how: 'Session days in the next 30 days as consultant 1, 2 or 3.' });
  }

  // ── People / team
  const byOwner = new Map();
  tasks.filter(t => t.days < 0).forEach(t => byOwner.set(t.owner, (byOwner.get(t.owner) || 0) + 1));
  const heavy = [...byOwner.entries()].filter(([o, n]) => n >= R.ownerOverdue && o !== 'Unassigned').sort((a, b) => b[1] - a[1]);
  if (heavy.length) add({ id: 'ppl-owner', level: 'medium', area: 'People', go: 'owners', tracker: null,
    title: 'Overdue work piling up with a few owners', metric: heavy.map(([o, n]) => `${o} ${n}`).join(' · '),
    why: 'One person holding many overdue items is a bottleneck.', how: `Owners with ${R.ownerOverdue}+ overdue tasks across all trackers.` });
  const unassigned = byOwner.get('Unassigned') || 0;
  if (unassigned >= 5) add({ id: 'ppl-unassigned', level: 'low', area: 'People', go: 'attention', tracker: null,
    title: 'Overdue tasks with no owner', metric: `${pl(unassigned, 'task')}`, why: 'No POC filled, so nobody is reminded.', how: 'Overdue tasks whose POC / owner field is blank.' });

  // ── Quality
  if (quality) {
    const Q = quality;
    if (Q.avgRecent != null && (Q.avgRecent < R.feedbackAvgMedium || (Q.avgPrior != null && Q.avgRecent < Q.avgPrior - R.feedbackDrop)))
      add({ id: 'q-avg', level: 'medium', area: 'Quality', go: null, tracker: 'engagement',
        title: 'Participant feedback slipping', metric: `${Q.avgRecent.toFixed(2)} / 5 last 90 days${Q.avgPrior != null ? ` (was ${Q.avgPrior.toFixed(2)})` : ''}`,
        why: 'Average feedback score of delivered sessions.', how: 'Feedback column (out of 5; scores out of 10 halved) of sessions delivered in the last 90 days vs the 90 before.' });
    if (Q.low.length) add({ id: 'q-low', level: 'medium', area: 'Quality', go: null, tracker: 'engagement',
      title: `Sessions scored below ${R.feedbackLow} / 5`, metric: `${Q.low.length} in the last 90 days`, why: 'Review with the consultant and the client SPOC.', how: 'Feedback column, delivered sessions, last 90 days.',
      rows: Q.low.map(x => sessionRow(x.e, `${x.score.toFixed(1)} / 5`, [['Feedback', s(x.e.feedback)], ['NPS', s(x.e.nps)]])) });
    if (Q.missing.length >= 3) add({ id: 'q-missing', level: 'low', area: 'Data', go: null, tracker: 'engagement',
      title: 'Delivered sessions without a feedback score', metric: `${pl(Q.missing.length, 'session')} (ended 7–60 days ago)`, why: 'Without scores, quality problems stay invisible.', how: 'Delivered, end date 7–60 days ago, Feedback blank.',
      rows: Q.missing.slice(0, 10).map(x => sessionRow(x.e, x.end)) });
  }

  // ── Data
  const notDelivered = tasks.filter(t => t.tracker === 'engagement' && t.label === 'Mark as Delivered');
  if (notDelivered.length) add({ id: 'data-status', level: notDelivered.length >= 5 ? 'medium' : 'low', area: 'Data', go: 'attention', tracker: 'engagement',
    title: 'Finished sessions not marked Delivered', metric: `${pl(notDelivered.length, 'session')}`, why: 'Delivered counts, consultant days and the Operations dashboard skip them until Status is updated.',
    how: 'End date passed, Status not Delivered / Cancelled / Postponed.', rows: notDelivered.slice(0, 10).map(t => ({ id: t.id, main: t.record, sub: t.sub, right: `ended ${t.due}`, details: t.details })) });
  const missingTotal = missing.reduce((t, m) => t + m.fields, 0);
  if (missingTotal >= 50) add({ id: 'data-missing', level: 'low', area: 'Data', go: 'health', tracker: null,
    title: 'Many required fields empty', metric: `${missingTotal} fields in ${missing.reduce((t, m) => t + m.records, 0)} records`, why: 'Figures on this page are only as good as the trackers.', how: 'Same rules as the Reminders → Missing tab.' });

  // ── Leads / vendors
  const staleLeads = leads.filter(l => leadIsOpen(l) && (!toIso(l.nextFollowUp) || daysBetween(toIso(l.nextFollowUp), today) > 7));
  if (staleLeads.length) add({ id: 'sales-leads', level: staleLeads.length >= 5 ? 'medium' : 'low', area: 'Sales', go: 'attention', tracker: 'leads',
    title: 'Open leads going cold', metric: `${pl(staleLeads.length, 'lead')}`, why: 'No follow-up date, or the follow-up is more than a week overdue.', how: 'Lead Tracker, open statuses.',
    rows: staleLeads.slice(0, 10).map(l => ({ id: 'ld' + l.leadId, main: s(l.company), sub: `${s(l.leadId)} · ${s(l.status)} · owner ${s(l.owner) || '—'}`, right: toIso(l.nextFollowUp) || 'no date', details: [['Requirement', s(l.requirement)], ['Source', s(l.source)]] })) });
  const unbilled = vendors.filter(v => isBillable(v.billable) && !['Billed', 'Not applicable'].includes(s(v.clientBilling)) && toIso(v.serviceDate) && toIso(v.serviceDate) <= addDaysIso(today, -14));
  if (unbilled.length) add({ id: 'cash-vendor', level: 'medium', area: 'Cash', go: 'attention', tracker: 'vendors',
    title: 'Billable vendor costs not billed to the client', metric: `${unbilled.length} · ${fmtMoney(unbilled.reduce((t, v) => t + num(v.total), 0))}`,
    why: 'EuRadicle pays the vendor; if the client is not billed, this is lost margin.', how: 'Vendor Services: Billable, client billing not Billed, service date 14+ days ago.',
    rows: unbilled.slice(0, 10).map(v => ({ id: 'vb' + v.serviceId, main: s(v.vendorName), sub: `${s(v.client)} · ${s(v.description)}`, right: fmtMoney(num(v.total)), details: [['Service date', toIso(v.serviceDate)], ['Client billing', s(v.clientBilling)]] })) });

  return out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || RISK_AREAS.indexOf(a.area) - RISK_AREAS.indexOf(b.area));
}

export const _test = { scoreOf, sessionDays, fyOf, slotOf, pad2 };
