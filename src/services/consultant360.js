/**
 * CONSULTANT 360 — a consultant's whole journey with EuRadicle, gathered for the Consultant Directory
 * ====================================================================================================
 * Read-only. Reads the Engagement Calendar (Consultant - 1 / 2 / 3) and the Ops Checklist, matches every
 * consultant name to a Consultant Directory profile and returns the rows per consultant plus the names
 * that have no profile. A cell may hold several names ("A & B", "A, B").
 * Revenue: a session's Price (INR) is split equally between the consultants named on it, so the totals
 * of all consultants never add up to more than the session price.
 */
import { getAllEngagementsCached, getOpsChecklist, peekList, peekAllEngagements } from './api.js';
import { nameKey, findClient, getDirectory } from './directoryCache.js';
import { ecState, feedbackOf, todayIso } from './client360.js';
import { money } from './money.js';
import FLOW_URLS from '../config/powerAutomate.js';
import { CONSULTANT_EXTRAS, CONSULTANT_ALIASES } from '../config/clientAliases.js';

const txt = v => String(v ?? '').trim();
const iso = v => { const m = txt(v).match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; };
export const fyOf = d => { const s = iso(d); if (!s) return null; const y = +s.slice(0, 4), m = +s.slice(5, 7); return m >= 4 ? y : y - 1; };
export const fyLabel = fy => `FY${String(fy + 1).slice(2)}`;
const EXTRA = new Set((CONSULTANT_EXTRAS || []).map(nameKey).concat(['na', 'nil', 'none', 'tbc', 'tba', 'internal']));
const ALIAS = new Map(Object.entries(CONSULTANT_ALIASES || {}).map(([a, b]) => [nameKey(a), nameKey(b)]));
const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'col', 'capt', 'coach']);
const tokens = v => txt(v).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !TITLES.has(t));

/** Names typed in the three consultant cells of a row (cells may hold several names). */
export const namesOn = r => [...new Map([r.consultant1, r.consultant2, r.consultant3]
  .flatMap(c => txt(c).split(/\s*(?:,|;|&|\/|\+|\band\b)\s*/i)).map(txt).filter(n => n && !EXTRA.has(nameKey(n))).map(n => [nameKey(n), n])).values()];

/** Builds a matcher: typed name → Consultant Directory record (exact name, known alias, or the only consultant whose name contains every typed word). */
export function consultantMatcher(consultants) {
  const list = (consultants || []).filter(c => txt(c.fullName));
  const byKey = new Map(list.map(c => [nameKey(c.fullName), c]));
  const toks = list.map(c => [c, tokens(c.fullName)]);
  const cache = new Map();
  return name => {
    const k = nameKey(name); if (!k) return null;
    if (cache.has(k)) return cache.get(k);
    let hit = byKey.get(k) || byKey.get(ALIAS.get(k)) || null;
    if (!hit) {
      const t = tokens(name);
      const cand = t.length ? toks.filter(([, ct]) => t.every(x => x.length >= 3 && ct.includes(x))) : [];
      if (cand.length === 1) hit = cand[0][0];
    }
    cache.set(k, hit); return hit;
  };
}

export function peekConsultantWorld() {
  const ec = peekAllEngagements(), ops = peekList('ops');
  return Array.isArray(ec) ? { ec, ops: Array.isArray(ops) ? ops : [], failed: [], partial: !Array.isArray(ops) } : null;
}
export async function loadConsultantWorld({ force = false } = {}) {
  const opsOn = !!FLOW_URLS.OPS_CHECKLIST_CRUD;
  const res = await Promise.allSettled([getAllEngagementsCached({ force }), opsOn ? (!force && peekList('ops')) || getOpsChecklist() : []]);
  const failed = [];
  const pick = (r, label, saved) => { if (r.status === 'fulfilled' && Array.isArray(r.value)) return r.value; failed.push(`${label}: ${r.reason?.message || r.reason || 'no data'}`); return Array.isArray(saved) ? saved : []; };
  return { ec: pick(res[0], 'Engagement Calendar', peekAllEngagements()), ops: pick(res[1], 'Ops Checklist', peekList('ops')), failed, partial: false };
}

/** Sorts Engagement Calendar and Ops rows under each consultant. */
export function buildConsultantIndex(world, consultants) {
  const match = consultantMatcher(consultants);
  const by = new Map(), un = new Map(), variants = new Map();
  const bucket = id => { if (!by.has(id)) by.set(id, { ec: [], ops: [] }); return by.get(id); };
  const walk = (rows, kind) => { for (const r of rows || []) {
    const names = namesOn(r); if (!names.length) continue;
    const seen = new Set();
    for (const n of names) {
      const c = match(n);
      if (c) {
        if (seen.has(c.consultantId)) continue; seen.add(c.consultantId);
        bucket(c.consultantId)[kind].push(kind === 'ec' ? { e: r, share: 1 / names.length, with: names.filter(x => match(x) !== c) } : r);
        if (nameKey(n) !== nameKey(c.fullName)) { if (!variants.has(c.consultantId)) variants.set(c.consultantId, new Map()); const m = variants.get(c.consultantId); m.set(n, (m.get(n) || 0) + 1); }
      } else if (kind === 'ec') {
        const k = nameKey(n), cur = un.get(k) || { name: n, key: k, total: 0, first: '', last: '', clients: new Set() };
        cur.total++; const d = iso(r.startDate); if (d) { if (d > cur.last) cur.last = d; if (!cur.first || d < cur.first) cur.first = d; }
        if (txt(r.company)) cur.clients.add(txt(r.company)); un.set(k, cur);
      }
    }
  } };
  walk(world?.ec, 'ec'); walk(world?.ops, 'ops');
  return {
    bucket: id => by.get(id) || { ec: [], ops: [] },
    variants: id => [...(variants.get(id)?.entries() || [])].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    unlinked: [...un.values()].map(u => ({ ...u, clients: [...u.clients] })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

const isCancelled = e => /cancel|drop/i.test(txt(e.status));
const isDelivered = e => /deliver|complet/i.test(txt(e.status));
const isVirtual = e => /virtual|online|zoom|teams|webinar|remote/i.test(`${txt(e.locationRaw || e.location)} ${txt(e.offering)}`);
const avg = l => (l.length ? Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 100) / 100 : null);
const clientName = (e, dir) => findClient(e.company, dir)?.name || txt(e.company) || '(no company)';

/** Everything the profile shows for one consultant. */
export function consultantSummary(bucket, today = todayIso(), dir = getDirectory()) {
  const rows = (bucket?.ec || []).filter(x => !isCancelled(x.e)).map(x => ({ ...x, state: ecState(x.e, today), client: clientName(x.e, dir), fb: feedbackOf(x.e), d: iso(x.e.startDate), rev: money(x.e.price) * x.share }));
  const cancelled = (bucket?.ec || []).length - rows.length;
  const del = rows.filter(x => isDelivered(x.e));
  const upcoming = rows.filter(x => ['Upcoming', 'Tentative'].includes(x.state)).sort((a, b) => a.d.localeCompare(b.d));
  const stale = rows.filter(x => x.state === 'Ended – status not updated');
  const fbMissing = del.filter(x => x.fb == null && !/^(n\/?a|not (required|applicable))$/i.test(txt(x.e.feedback)) && x.d >= `${fyOf(today)}-04-01`);
  const sum = (l, f) => l.reduce((t, x) => t + (Number(f(x)) || 0), 0);
  const dated = rows.filter(x => x.d).sort((a, b) => a.d.localeCompare(b.d));
  const group = (list, keyOf, extra) => { const m = new Map(); for (const x of list) { const k = keyOf(x); if (!k) continue; const g = m.get(k) || { key: k, n: 0, delivered: 0, days: 0, rev: 0, booked: 0, fbs: [], first: '', last: '', set: new Set() };
    g.n++; if (isDelivered(x.e)) { g.delivered++; g.days += Number(x.e.day) || 0; g.rev += x.rev; if (x.fb != null) g.fbs.push(x.fb); } else if (['Upcoming', 'Tentative'].includes(x.state)) g.booked += x.rev;
    if (x.d) { if (!g.first || x.d < g.first) g.first = x.d; if (x.d > g.last) g.last = x.d; } g.set.add(extra(x)); m.set(k, g); }
    return [...m.values()].map(g => ({ ...g, fb: avg(g.fbs), fbN: g.fbs.length, others: [...g.set].filter(Boolean) })); };
  const byFy = group(rows.filter(x => x.d), x => fyOf(x.d), x => x.client).sort((a, b) => a.key - b.key);
  const byClient = group(rows, x => x.client, x => txt(x.e.topic)).sort((a, b) => b.n - a.n || b.rev - a.rev);
  const byTopic = group(rows, x => txt(x.e.topic), x => x.client).sort((a, b) => b.n - a.n);
  const co = new Map(); for (const x of rows) for (const n of x.with) co.set(n, (co.get(n) || 0) + 1);
  const services = new Map(); for (const x of rows) { const s = txt(x.e.serviceType); if (s) services.set(s, (services.get(s) || 0) + 1); }
  const cities = new Map(); for (const x of del) { const s = txt(x.e.location); if (s && !isVirtual(x.e)) cities.set(s, (cities.get(s) || 0) + 1); }
  const lastDel = del.map(x => iso(x.e.endDate) || x.d).filter(Boolean).sort().pop() || '';
  const curFy = fyOf(today), cur = byFy.find(f => f.key === curFy), prev = byFy.find(f => f.key === curFy - 1);
  const rated = byTopic.filter(t => t.fbN >= 2 && t.fb != null);
  return {
    rows, cancelled, sessions: rows.length, delivered: del.length, days: sum(del, x => x.e.day), pax: sum(del, x => x.e.pax),
    clients: byClient.length, first: dated[0] || null, lastDelivered: lastDel, next: upcoming[0] || null, upcoming, stale, fbMissing,
    bookedDays: sum(upcoming, x => x.e.day), feedbackAvg: avg(del.map(x => x.fb).filter(v => v != null)), feedbackCount: del.filter(x => x.fb != null).length,
    revenue: sum(del, x => x.rev), booked: sum(upcoming, x => x.rev), shared: rows.filter(x => x.share < 1).length,
    virtual: del.filter(x => isVirtual(x.e)).length, byFy, byClient, byTopic, cur, prev, curFy,
    co: [...co.entries()].sort((a, b) => b[1] - a[1]), services: [...services.entries()].sort((a, b) => b[1] - a[1]), cities: [...cities.entries()].sort((a, b) => b[1] - a[1]),
    bestTopic: [...rated].sort((a, b) => b.fb - a.fb)[0] || null, lowTopic: rated.filter(t => t.fb < 4).sort((a, b) => a.fb - b.fb)[0] || null,
    idleDays: lastDel ? Math.round((Date.parse(today) - Date.parse(lastDel)) / 86400000) : null, ops: bucket?.ops || [],
  };
}

/** What needs attention for this consultant, most pressing first. */
export function consultantAlerts(sm, contract) {
  const a = [];
  if (contract === 'expired') a.push({ tone: 'bad', tab: 'profile', text: 'Contract has expired' });
  if (contract === 'renew') a.push({ tone: 'warn', tab: 'profile', text: 'Contract is due for renewal' });
  if (sm.stale.length) a.push({ tone: 'warn', tab: 'ec', text: `${sm.stale.length} session${sm.stale.length > 1 ? 's' : ''} ended but not marked Delivered` });
  if (sm.fbMissing.length) a.push({ tone: 'warn', tab: 'ec', text: `Feedback not recorded for ${sm.fbMissing.length} session${sm.fbMissing.length > 1 ? 's' : ''} this FY` });
  if (sm.lowTopic) a.push({ tone: 'warn', tab: 'programs', text: `Feedback below 4.0 on “${sm.lowTopic.key}” (${sm.lowTopic.fb.toFixed(2)})` });
  if (sm.delivered && !sm.upcoming.length) a.push({ tone: 'info', tab: 'ec', text: `Nothing booked ahead${sm.idleDays != null ? ` — last delivered ${sm.idleDays} days ago` : ''}` });
  if (sm.upcoming.length) a.push({ tone: 'info', tab: 'ec', text: `${sm.upcoming.length} session${sm.upcoming.length > 1 ? 's' : ''} booked ahead · ${sm.bookedDays} days` });
  return a;
}
