/**
 * CLIENT 360 — everything the trackers hold about one client, gathered for the Client Directory
 * ==============================================================================================
 * Read-only. Loads the trackers (re-using lists the pages already loaded), matches every row's client
 * name to a Client Directory profile and returns:
 *   • byClient   rows per client and tracker (the profile tabs)
 *   • unlinked   client names typed in the trackers that have no profile ("Not in directory")
 *   • nearBy     unlinked names that look like an existing client ("Ashiana" ≈ "Ashiana Housing")
 * A name is matched by Client Name, Legal entity, the client's "Also Known As" list, or the fixed
 * list in config/clientAliases.js — compared ignoring case, spaces and punctuation.
 */
import { getAllEngagementsCached, getOpsChecklist, getContentDevTracker, getSolutionTracker, peekList, peekAllEngagements } from './api.js';
import { getLeads, getVendorServices } from './leadsVendorsApi.js';
import { getPOs, poConfigured } from './poApi.js';
import { getTasks, tasksConfigured } from './tasksApi.js';
import { findClient, nameKey, coreKey, isNotAClient, getDirectory } from './directoryCache.js';
import FLOW_URLS from '../config/powerAutomate.js';
import { leadIsOpen } from '../config/leadVendorOptions.js';
import { taskIsOpen } from '../config/taskOptions.js';
import { buildProposalLines } from '../components/proposalData.js';
import { financeStage, totalOf, overdueDays } from '../pages/FinanceTracker.jsx';
import { clScore } from '../pages/OpsChecklist.jsx';
import { money, collectedOf } from './money.js';

const txt = v => String(v ?? '').trim();
const iso = v => { const m = txt(v).match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; };
const pad2 = n => String(n).padStart(2, '0');
export const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };

/* ─── Trackers that carry a client name ─── */
export const SOURCES = [
  { id: 'ec', label: 'Engagement Calendar', short: 'Engagements', page: 'engagement', route: '/engagement', on: () => true,
    load: force => getAllEngagementsCached({ force }), peek: () => peekAllEngagements(), get: r => r.company, date: r => iso(r.startDate) },
  { id: 'bd', label: 'BD / Solution Tracker', short: 'Proposals', page: 'bd', route: '/bd-tracker', on: () => !!FLOW_URLS.SOLUTION_CRUD,
    load: () => getSolutionTracker(), peek: () => peekList('solution'), get: r => r.clientName, date: r => iso(r.dateOfDiscussion) },
  { id: 'leads', label: 'Lead Tracker', short: 'Leads', page: 'leads', route: '/leads', on: () => !!FLOW_URLS.LEADS_CRUD,
    load: () => getLeads(), peek: () => peekList('leads'), get: r => r.company, date: r => iso(r.dateReceived) },
  { id: 'ops', label: 'Ops Checklist', short: 'Ops', page: 'ops', route: '/ops', on: () => !!FLOW_URLS.OPS_CHECKLIST_CRUD,
    load: () => getOpsChecklist(), peek: () => peekList('ops'), get: r => r.company, date: r => iso(r.startDate) },
  { id: 'cdt', label: 'Content Dev Tracker', short: 'Content', page: 'content-dev', route: '/content-dev', on: () => !!FLOW_URLS.CONTENT_DEV_CRUD,
    load: () => getContentDevTracker(), peek: () => peekList('cdt'), get: r => r.client, date: r => iso(r.startDate) },
  { id: 'vendors', label: 'Vendor Services', short: 'Vendors', page: 'vendors', route: '/vendors', on: () => !!FLOW_URLS.VENDOR_CRUD,
    load: () => getVendorServices(), peek: () => peekList('vendors'), get: r => r.client, date: r => iso(r.serviceDate) },
  { id: 'po', label: 'PO Tracker', short: 'POs', page: 'po', route: '/po', on: () => poConfigured(),
    load: () => getPOs(), peek: () => peekList('po'), get: r => r.client, date: r => iso(r.poDate) },
  { id: 'tasks', label: 'Project Management', short: 'Tasks', page: 'tasks', route: '/tasks', on: () => tasksConfigured(),
    load: () => getTasks(), peek: () => peekList('tasks'), get: r => r.client, date: r => iso(r.dueDate) },
];
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));
export const emptyBucket = () => Object.fromEntries(SOURCES.map(s => [s.id, []]));

/** Tracker rows already in memory (instant, may be partial) — or null when nothing is loaded yet. */
export function peekWorld() {
  const rows = {}; let any = false;
  for (const s of SOURCES) { let v = null; try { v = s.on() ? s.peek() : null; } catch { v = null; } if (Array.isArray(v)) { rows[s.id] = v; any = true; } }
  return any ? { rows, failed: [], partial: SOURCES.some(s => s.on() && !rows[s.id]) } : null;
}
/** Reads every tracker (lists already in memory are re-used unless force). A tracker that fails is listed in `failed`. */
export async function loadWorld({ force = false } = {}) {
  const on = SOURCES.filter(s => { try { return s.on(); } catch { return false; } });
  const res = await Promise.allSettled(on.map(s => { const have = !force && s.id !== 'ec' ? s.peek() : null; return Array.isArray(have) ? have : s.load(force); }));
  const rows = {}, failed = [];
  on.forEach((s, i) => {
    if (res[i].status === 'fulfilled') rows[s.id] = Array.isArray(res[i].value) ? res[i].value : [];
    else { const saved = (() => { try { return s.peek(); } catch { return null; } })(); if (Array.isArray(saved)) rows[s.id] = saved; failed.push(`${s.label}: ${res[i].reason?.message || res[i].reason}`); }
  });
  return { rows, failed, partial: false };
}

/* ─── Name matching ─── */
export const splitAliases = v => [...new Set(txt(v).split(/\s*[;\n]\s*/).map(txt).filter(Boolean))];

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const NOISE = ['and', 'the', 'of', 'pvt', 'ltd', 'limited', 'private', 'india', 'llp', 'inc'];
// words many organisations share — never enough on their own to call two names alike
const GENERIC = ['bank', 'group', 'technologies', 'technology', 'tech', 'solutions', 'services', 'global', 'international', 'financial', 'finance', 'capital', 'industries', 'enterprises', 'systems', 'insurance', 'motors', 'steel', 'foundation', 'consulting', 'labs', 'software', 'pharma', 'healthcare', 'energy', 'power'];
const words = v => txt(v).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !NOISE.includes(w));
/** 0–100: how alike two organisation names are (suffixes such as Pvt Ltd / India ignored). */
export function similarity(a, b) {
  const ka = coreKey(a), kb = coreKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 96;
  const short = Math.min(ka.length, kb.length), long = Math.max(ka.length, kb.length);
  let best = 0;
  if (short >= 3 && (ka.startsWith(kb) || kb.startsWith(ka))) best = Math.max(best, 70 + Math.round(25 * short / long));
  const wa = words(a), wb = words(b);
  if (wa.length && wb.length) {
    const [sh, lg] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    if (sh.every((x, i) => lg[i] === x) && !sh.every(x => GENERIC.includes(x))) best = Math.max(best, 70 + Math.round(25 * sh.join('').length / lg.join('').length));   // "LG" ⊂ "LG Factory"
    else if (wa[0] === wb[0] && wa[0].length >= 3 && !GENERIC.includes(wa[0])) best = Math.max(best, 66);                                              // same first word, then different
    const shared = wa.filter(x => wb.includes(x) && !GENERIC.includes(x)).length;
    if (shared) best = Math.max(best, Math.round(60 * (2 * shared) / (wa.length + wb.length)) + (shared >= 2 ? 15 : 0));
  }
  if (short >= 5 && Math.abs(ka.length - kb.length) <= 2) { const d = lev(ka, kb); if (d <= 2 && d / short <= 0.25) best = Math.max(best, 92 - d * 6); }
  return Math.min(95, best);
}
export const NEAR_MATCH_MIN = 65;
/** Directory clients a typed name looks like, best first: [{ client, score }]. */
export function nearClients(name, clients, limit = 3) {
  return (clients || []).map(c => ({ client: c, score: Math.max(similarity(name, c.name), similarity(name, c.legalName), ...splitAliases(c.aliases).map(a => similarity(name, a))) }))
    .filter(x => x.score >= NEAR_MATCH_MIN).sort((a, b) => b.score - a.score || txt(a.client.name).localeCompare(txt(b.client.name))).slice(0, limit);
}
/** Pairs of directory clients whose names look alike (possible duplicate profiles). */
export function duplicateClients(clients) {
  const out = new Map();
  const list = (clients || []).filter(c => txt(c.name));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const sc = similarity(list[i].name, list[j].name);
    if (sc < 80) continue;
    const pg = nameKey(list[i].parentGroup) && nameKey(list[i].parentGroup) === nameKey(list[j].parentGroup) && txt(list[i].businessUnit) !== txt(list[j].businessUnit);
    if (pg) continue;                                   // two units of one group, kept apart on purpose
    for (const [a, b] of [[list[i], list[j]], [list[j], list[i]]]) { if (!out.has(a.clientId)) out.set(a.clientId, []); out.get(a.clientId).push({ client: b, score: sc }); }
  }
  return out;
}

/**
 * Sorts every tracker row under its client.
 * @param rows   { ec:[], bd:[], … } from loadWorld / peekWorld
 * @param dir    directory snapshot (getDirectory()) — must hold the clients
 * @param ignore Set of name keys the user marked "not a client"
 */
export function buildIndex(rows, dir = getDirectory(), ignore = new Set()) {
  const byClient = new Map(), names = new Map(), un = new Map();
  // Suffix-only differences ("Ashiana Housing Ltd", "Ford India Pvt Ltd") — linked when exactly one client fits
  const core = new Map();
  for (const c of dir?.clients || []) for (const k of new Set([c.name, c.legalName, ...splitAliases(c.aliases)].map(coreKey).filter(Boolean))) core.set(k, core.has(k) && core.get(k) !== c ? null : c);
  for (const s of SOURCES) for (const r of rows?.[s.id] || []) {
    const n = txt(s.get(r)); if (!n || isNotAClient(n)) continue;
    const k = nameKey(n); if (!k) continue;
    const c = findClient(n, dir) || core.get(coreKey(n)) || null;
    if (c) {
      if (!byClient.has(c.clientId)) byClient.set(c.clientId, emptyBucket());
      byClient.get(c.clientId)[s.id].push(r);
      if (k !== nameKey(c.name)) {                      // linked through a different spelling
        if (!names.has(c.clientId)) names.set(c.clientId, new Map());
        const m = names.get(c.clientId), cur = m.get(k) || { name: n, total: 0, where: {} };
        cur.total++; cur.where[s.id] = (cur.where[s.id] || 0) + 1; m.set(k, cur);
      }
      continue;
    }
    const cur = un.get(k) || { name: n, key: k, total: 0, where: {}, rows: emptyBucket(), last: '', first: '' };
    cur.total++; cur.where[s.id] = (cur.where[s.id] || 0) + 1; cur.rows[s.id].push(r);
    const d = s.date(r); if (d) { if (d > cur.last) cur.last = d; if (!cur.first || d < cur.first) cur.first = d; }
    un.set(k, cur);
  }
  const clients = dir?.clients || [];
  const unlinked = [...un.values()].map(u => ({ ...u, ignored: ignore.has(u.key), near: nearClients(u.name, clients) }))
    .sort((a, b) => (b.near.length ? 1 : 0) - (a.near.length ? 1 : 0) || b.total - a.total || a.name.localeCompare(b.name));
  const nearBy = new Map();
  for (const u of unlinked) { if (u.ignored) continue; for (const n of u.near) { if (!nearBy.has(n.client.clientId)) nearBy.set(n.client.clientId, []); nearBy.get(n.client.clientId).push({ ...u, score: n.score }); } }
  return {
    byClient, unlinked, nearBy,
    variants: id => [...(names.get(id)?.values() || [])].sort((a, b) => b.total - a.total),
    bucket: id => byClient.get(id) || emptyBucket(),
  };
}

/* ─── One client's numbers ─── */
const isCancelled = e => /cancel|drop/i.test(txt(e.status));
const isPostponed = e => /postpon|on\s*hold|re-?schedul/i.test(txt(e.status));
const isDelivered = e => /deliver|complet/i.test(txt(e.status));
export const ecState = (e, today = todayIso()) => (isCancelled(e) ? 'Cancelled' : isDelivered(e) ? 'Delivered'
  : isPostponed(e) ? 'On hold' : (iso(e.endDate) || iso(e.startDate)) && (iso(e.endDate) || iso(e.startDate)) < today ? 'Ended – status not updated'
  : /tentative/i.test(txt(e.status)) ? 'Tentative' : 'Upcoming');
export const feedbackOf = e => { const m = txt(e.feedback).match(/\d+(\.\d+)?/); if (!m) return null; let v = Number(m[0]); if (v > 5 && v <= 10) v /= 2; return v > 0 && v <= 5 ? v : null; };
export const consultantsOf = e => [e.consultant1, e.consultant2, e.consultant3].map(txt).filter(Boolean);
const OWED = ['Awaiting Payment', 'Payment Overdue', 'Partly Received'];
const TO_INVOICE = ['To Invoice', 'Invoice Overdue'];

export function clientSummary(bucket, today = todayIso()) {
  const b = bucket || emptyBucket();
  const ec = b.ec.filter(e => !isCancelled(e));
  const delivered = ec.filter(isDelivered);
  const upcoming = ec.filter(e => ['Upcoming', 'Tentative'].includes(ecState(e, today))).sort((a, c) => iso(a.startDate).localeCompare(iso(c.startDate)));
  const stale = ec.filter(e => ecState(e, today) === 'Ended – status not updated');
  const past = [...delivered, ...stale].map(e => iso(e.endDate) || iso(e.startDate)).filter(Boolean).sort();
  const fb = delivered.map(feedbackOf).filter(v => v != null);
  const topics = new Map(); for (const e of ec) { const t = txt(e.topic); if (t) topics.set(t, (topics.get(t) || 0) + 1); }
  const cons = new Map(); for (const e of ec) for (const n of consultantsOf(e)) cons.set(n, (cons.get(n) || 0) + 1);

  let billed = 0, received = 0, outstanding = 0, overdue = 0, toInvoice = 0, maxOverdue = 0, suspect = 0;
  const dues = [];
  for (const e of ec) {
    const st = financeStage(e), total = totalOf(e), got = collectedOf(e);
    if (got.suspect) suspect++;
    if (st === 'Received' || OWED.includes(st)) { billed += total; received += Math.min(got.gross, total); }
    if (OWED.includes(st)) { const bal = Math.max(0, total - got.gross); outstanding += bal; const od = overdueDays(e); if (od > 0) { overdue += bal; maxOverdue = Math.max(maxOverdue, od); } if (bal > 0) dues.push({ e, stage: st, balance: bal, overdueDays: od }); }
    if (TO_INVOICE.includes(st) && total > 0) { toInvoice += total; dues.push({ e, stage: st, balance: total, overdueDays: 0 }); }
  }

  const lines = buildProposalLines(b.bd), latest = lines.filter(l => l.isLatest);
  const won = latest.filter(l => l.pipeline === 'closed'), open = latest.filter(l => l.pipeline === 'process'), lost = latest.filter(l => l.pipeline === 'lost');
  const sum = (l, f) => l.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const decided = won.length + lost.length;

  const leadsOpen = b.leads.filter(leadIsOpen);
  const opsUp = b.ops.filter(o => !/cancel/i.test(txt(o.status)) && (iso(o.endDate) || iso(o.startDate)) >= today);
  const readiness = opsUp.length ? Math.round(sum(opsUp, clScore) / opsUp.length) : null;
  const cdtOpen = b.cdt.filter(c => !iso(c.completionDate));
  const tasksOpen = b.tasks.filter(taskIsOpen);
  const vendorCost = sum(b.vendors, v => money(v.total) || money(v.amount));
  const vendorToBill = b.vendors.filter(v => /^to bill$/i.test(txt(v.clientBilling)));
  const poActive = b.po.filter(p => !/closed|expired|fully used/i.test(txt(p.status)));

  return {
    sessions: ec.length, delivered: delivered.length, upcoming, stale,
    days: sum(delivered, e => e.day), pax: sum(delivered, e => e.pax),
    revenue: sum(ec.filter(e => !isPostponed(e)), e => money(e.price)), deliveredValue: sum(delivered, e => money(e.price)),
    bookedValue: sum(upcoming, e => money(e.price)),
    totalValue: sum(ec, e => money(e.price)),          // every session except Cancelled / Dropped: delivered + booked + on hold + ended-not-updated
    cancelledValue: sum(b.ec.filter(isCancelled), e => money(e.price)), cancelledCount: b.ec.length - ec.length,
    firstSession: ec.map(e => iso(e.startDate)).filter(Boolean).sort()[0] || '', lastDelivered: past.pop() || '', next: upcoming[0] || null,
    feedbackAvg: fb.length ? Math.round((fb.reduce((a, c) => a + c, 0) / fb.length) * 100) / 100 : null, feedbackCount: fb.length,
    topics: [...topics.entries()].sort((a, c) => c[1] - a[1]), consultants: [...cons.entries()].sort((a, c) => c[1] - a[1]),
    billed, received, outstanding, overdue, toInvoice, maxOverdue, suspect, dues: dues.sort((a, c) => c.overdueDays - a.overdueDays || c.balance - a.balance),
    lines, proposals: latest.length, won: won.length, open: open.length, lost: lost.length,
    wonValue: sum(won, l => l.bdValue), openValue: sum(open, l => l.bdValue), winRate: decided ? Math.round((won.length / decided) * 100) : null, openLines: open,
    leads: b.leads.length, leadsOpen, opsUpcoming: opsUp, readiness, cdtOpen, tasksOpen,
    tasksOverdue: tasksOpen.filter(t => iso(t.dueDate) && iso(t.dueDate) < today).length,
    vendorCost, vendorToBill, poActive, poBalance: sum(poActive, p => money(p.balance)), poValue: sum(b.po, p => money(p.value)),
    total: SOURCES.reduce((t, s) => t + b[s.id].length, 0),
  };
}

/** What needs the Relationship Manager's attention for this client, most pressing first. */
export function clientAlerts(sm, { showMoney = false } = {}) {
  const a = [];
  if (showMoney && sm.overdue > 0) a.push({ tone: 'bad', tab: 'finance', text: `Payment overdue — up to ${sm.maxOverdue} days past terms`, amount: sm.overdue });
  if (showMoney && sm.toInvoice > 0) a.push({ tone: 'warn', tab: 'finance', text: 'Delivered but not invoiced yet', amount: sm.toInvoice });
  if (sm.stale.length) a.push({ tone: 'warn', tab: 'ec', text: `${sm.stale.length} session${sm.stale.length > 1 ? 's' : ''} ended but not marked Delivered` });
  if (sm.readiness != null && sm.readiness < 50 && sm.opsUpcoming.length) a.push({ tone: 'warn', tab: 'delivery', text: `Upcoming sessions only ${sm.readiness}% ready in the Ops Checklist` });
  if (sm.open) a.push({ tone: 'info', tab: 'bd', text: `${sm.open} open proposal${sm.open > 1 ? 's' : ''} awaiting a decision`, amount: sm.openValue });
  if (sm.leadsOpen.length) a.push({ tone: 'info', tab: 'leads', text: `${sm.leadsOpen.length} open lead${sm.leadsOpen.length > 1 ? 's' : ''}` });
  if (sm.tasksOverdue) a.push({ tone: 'warn', tab: 'tasks', text: `${sm.tasksOverdue} overdue task${sm.tasksOverdue > 1 ? 's' : ''}` });
  if (sm.delivered && !sm.upcoming.length && !sm.open) a.push({ tone: 'warn', tab: 'ec', text: 'No next business — nothing booked and no open proposal' });
  return a;
}
