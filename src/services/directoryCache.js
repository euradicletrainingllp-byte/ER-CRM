/**
 * EURADICLE CRM — SHARED LOOKUP LISTS FOR THE PICKERS
 * ====================================================
 * One place that holds the master lists the pickers suggest from:
 *   clients + contacts  (Client Directory)     consultants (Consultant Directory)
 *   vendors             (past Vendor Name values in Vendor Services)
 *   proposals           (BD / Solution Tracker lines, one per Proposal ID)
 * Team names come from the Admin Panel permissions (read in the picker, not here).
 *
 * Nothing here changes Excel except quickAddClient / quickAddContact, which only ADD one row
 * to the Client Directory through the existing CLIENTS_CRUD flow. Lists load once per session
 * (re-using whatever the pages already loaded) and refresh after any quick-add.
 * If a list fails to load it stays empty and the picker works as a plain text box.
 */
import { peekList, onListChange, getSolutionTracker, _rememberList as rememberList } from './api.js';
import { getClientDirectory, peekClientDirectory, clientsConfigured, readTableFresh, addRecord, nextId, emptyRecord } from './clientsApi.js';
import { getConsultants, peekConsultants, consultantsConfigured } from './consultantsApi.js';
import { getVendorServices } from './leadsVendorsApi.js';
import FLOW_URLS from '../config/powerAutomate.js';
import { CLIENT_ALIASES, NOT_A_CLIENT } from '../config/clientAliases.js';

const txt = v => String(v ?? '').trim();
/** Compare key: lower case, & → and, letters and digits only. "Ford India Pvt. Ltd." → "fordindiapvtltd". */
export const nameKey = v => txt(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const SUFFIX = /(privatelimited|pvtltd|pvt|limited|ltd|llp|inc|incorporated|corporation|corp|company|co|india|group)$/;
/** Key without company suffixes, for near-duplicate checks ("Ford India Pvt Ltd" ≈ "Ford"). */
export const coreKey = v => { let k = nameKey(v), p; do { p = k; k = k.replace(SUFFIX, ''); } while (k !== p && k); return k || nameKey(v); };

const ALIAS = new Map(Object.entries(CLIENT_ALIASES).map(([a, b]) => [nameKey(a), b]));
const NOT_CLIENT = new Set(NOT_A_CLIENT.map(nameKey));
export const isNotAClient = v => NOT_CLIENT.has(nameKey(v));

/* ─── State ─── */
const LISTS = ['client-dir:clients', 'client-dir:contacts', 'consultants', 'vendors', 'solution'];
const failed = {};
const subs = new Set();
let loading = null;
let snap = build();

function build() {
  const clients = peekList('client-dir:clients') || [];
  const contacts = peekList('client-dir:contacts') || [];
  const consultants = (peekList('consultants') || []).filter(c => txt(c.fullName));
  const vendorRows = peekList('vendors') || [];
  const sol = peekList('solution') || [];
  // Vendors: distinct past names, latest contact kept
  const vMap = new Map();
  for (const v of vendorRows) {
    const n = txt(v.vendorName); if (!n) continue;
    const k = nameKey(n), cur = vMap.get(k);
    vMap.set(k, { name: cur?.name || n, contact: txt(v.vendorContact) || cur?.contact || '', uses: (cur?.uses || 0) + 1, categories: [...new Set([...(cur?.categories || []), txt(v.category)].filter(Boolean))] });
  }
  // Proposals: one entry per Proposal ID (latest version wins)
  const pMap = new Map();
  const ver = r => Number(String(r.proposalVersion || '').replace(/[^0-9.]/g, '')) || 0;
  for (const r of sol) {
    const id = txt(r.proposalId); if (!id) continue;
    const cur = pMap.get(id);
    if (!cur || ver(r) >= ver(cur.row)) pMap.set(id, { id, row: r });
  }
  const proposals = [...pMap.values()].map(({ id, row: r }) => ({
    id, client: txt(r.clientName), topic: txt(r.programTopic || r.solutionTopic), version: txt(r.proposalVersion),
    status: txt(r.bdStatus || r.status), link: txt(r.proposalV1Link), industry: txt(r.industry),
  })).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));

  const byKey = new Map();
  for (const c of clients) for (const n of [c.name, c.legalName]) { const k = nameKey(n); if (k && !byKey.has(k)) byKey.set(k, c); }
  // "Also Known As" spellings saved on the client (never override a real client / legal name)
  for (const c of clients) for (const n of txt(c.aliases).split(/\s*[;\n]\s*/)) { const k = nameKey(n); if (k && !byKey.has(k)) byKey.set(k, c); }
  return {
    clients, contacts, consultants, proposals,
    vendors: [...vMap.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
    byKey,
    ready: { clients: !!peekList('client-dir:clients'), consultants: !!peekList('consultants'), vendors: !!peekList('vendors'), proposals: !!peekList('solution') },
    failed: { ...failed },
  };
}
const publish = () => { snap = build(); subs.forEach(fn => { try { fn(snap); } catch { /* ignore */ } }); };
onListChange(name => { if (LISTS.includes(name)) publish(); });

export const getDirectory = () => snap;
export function onDirectoryChange(fn) { subs.add(fn); return () => subs.delete(fn); }

/** Loads any list not yet in memory. Safe to call from every picker — runs once. */
export function ensureDirectory({ force = false } = {}) {
  if (loading && !force) return loading;
  const jobs = [];
  const job = (key, need, run) => { if (force || need) jobs.push(run().then(() => { delete failed[key]; }).catch(() => { failed[key] = true; })); };
  job('clients', clientsConfigured() && !peekClientDirectory(), getClientDirectory);
  job('consultants', consultantsConfigured() && !peekConsultants(), getConsultants);
  job('vendors', !!FLOW_URLS.VENDOR_CRUD && !peekList('vendors'), getVendorServices);
  job('proposals', !peekList('solution'), getSolutionTracker);
  loading = Promise.all(jobs).then(publish);
  return loading;
}

/* ─── Clients ─── */
/** The directory client a typed name refers to (name, legal entity or a known spelling variant) — or null. */
export function findClient(name, d = snap) {
  const k = nameKey(name);
  if (!k) return null;
  if (d.byKey.has(k)) return d.byKey.get(k);
  const alias = ALIAS.get(k);
  return alias ? d.byKey.get(nameKey(alias)) || null : null;
}
/** Correct directory spelling for a typed name, or '' when there is none. */
export const directoryNameFor = (name, d = snap) => findClient(name, d)?.name || '';

function score(q, fields) {
  let best = 0;
  for (const [f, w] of fields) {
    const k = nameKey(f); if (!k) continue;
    if (k === q) best = Math.max(best, 100 * w);
    else if (k.startsWith(q)) best = Math.max(best, 80 * w);
    else if (k.includes(q)) best = Math.max(best, 50 * w);
    else if (txt(f).toLowerCase().split(/[\s/&,.-]+/).some(word => nameKey(word).startsWith(q))) best = Math.max(best, 60 * w);
  }
  return best;
}
export function suggestClients(query, limit = 30, d = snap) {
  const q = nameKey(query);
  const list = d.clients.filter(c => txt(c.name));
  if (!q) return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const alias = ALIAS.get(q);
  return list.map(c => [c, Math.max(score(q, [[c.name, 1], [c.legalName, 0.9], [c.parentGroup, 0.6]]), alias && nameKey(alias) === nameKey(c.name) ? 95 : 0)])
    .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).slice(0, limit).map(([c]) => c);
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** Directory clients that look like the typed name ("Ford India" → Ford). Used to warn before creating. */
export function nearDuplicates(name, d = snap) {
  const c = coreKey(name);
  if (!c) return [];
  return d.clients.filter(x => {
    const ks = [x.name, x.legalName].map(coreKey).filter(Boolean);
    return ks.some(k => k === c || (Math.min(k.length, c.length) >= 4 && (k.startsWith(c) || c.startsWith(k))) || (c.length >= 5 && lev(k, c) <= 2));
  }).slice(0, 5);
}

/* ─── Contacts ─── */
export function contactsOf(clientOrName, d = snap) {
  const c = typeof clientOrName === 'string' ? findClient(clientOrName, d) : clientOrName;
  if (!c) return [];
  const keys = new Set([nameKey(c.name), nameKey(c.legalName)].filter(Boolean));
  return d.contacts.filter(p => txt(p.fullName) && ((c.clientId && p.clientId === c.clientId) || keys.has(nameKey(p.clientName))))
    .sort((a, b) => (/yes/i.test(b.primary) - /yes/i.test(a.primary)) || (/former|left/i.test(a.status) - /former|left/i.test(b.status)) || a.fullName.localeCompare(b.fullName));
}
/** A contact of that client with this name or email, or null. */
export function findContact(client, { name = '', email = '' } = {}, d = snap) {
  const list = contactsOf(client, d);
  const e = txt(email).toLowerCase(), n = nameKey(name);
  return list.find(p => e && txt(p.email).toLowerCase() === e) || list.find(p => n && nameKey(p.fullName) === n) || null;
}

/* ─── Consultants / proposals / vendors ─── */
export const findConsultant = (name, d = snap) => { const k = nameKey(name); return k ? d.consultants.find(c => nameKey(c.fullName) === k) || null : null; };
export const findProposal = (id, d = snap) => d.proposals.find(p => p.id === txt(id)) || null;

/* ─── Quick-add (adds one Client Directory row; never edits or deletes) ─── */
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Creates a client with the next CL- ID, after reading ClientTable fresh from Excel.
 * If the name (or legal name / known variant) already exists there, nothing is created and that client is returned.
 * Resolves to { client, created }.
 */
export async function quickAddClient({ name, industry = '', clientType = 'Prospect', hqCity = '', owner = '', note = '' }, by = '') {
  const n = txt(name);
  if (!n) throw new Error('Type the client name first.');
  if (!clientsConfigured()) throw new Error('The Client Directory flow is not set up.');
  const fresh = await readTableFresh('clients');
  const freshSnap = { ...snap, byKey: new Map(fresh.flatMap(c => [[nameKey(c.name), c], [nameKey(c.legalName), c]]).filter(([k]) => k)) };
  const existing = findClient(n, freshSnap);
  if (existing) { mergeRows('client-dir:clients', fresh, 'clientId'); return { client: existing, created: false }; }
  const rec = { ...emptyRecord('clients'), clientId: nextId('clients', fresh), name: n, industry: txt(industry), clientType: txt(clientType) || 'Prospect',
    hqCity: txt(hqCity), owner: txt(owner), createdBy: by, createdOn: todayIso(), updatedBy: by, updatedOn: todayIso(),
    dataNotes: note || 'Added from a tracker form (quick-add)' };
  rec.sno = rec.clientId;
  await addRecord('clients', rec);
  mergeRows('client-dir:clients', [...fresh, rec], 'clientId');
  return { client: rec, created: true };
}

/** Creates a contact under a directory client with the next CT- ID (ContactTable read fresh). Resolves to { contact, created }. */
export async function quickAddContact({ client, fullName, designation = '', email = '', mobile = '', primary = '' }, by = '') {
  const c = typeof client === 'string' ? findClient(client) : client;
  if (!c) throw new Error('Pick a client from the Client Directory first.');
  const n = txt(fullName);
  if (!n) throw new Error('Type the contact name first.');
  const fresh = await readTableFresh('contacts');
  const same = fresh.find(p => (p.clientId === c.clientId || nameKey(p.clientName) === nameKey(c.name)) &&
    ((txt(email) && txt(p.email).toLowerCase() === txt(email).toLowerCase()) || nameKey(p.fullName) === nameKey(n)));
  if (same) { mergeRows('client-dir:contacts', fresh, 'contactId'); return { contact: same, created: false }; }
  const rec = { ...emptyRecord('contacts'), contactId: nextId('contacts', fresh), clientId: c.clientId, clientName: c.name, fullName: n,
    designation: txt(designation), email: txt(email), mobile: txt(mobile), primary: txt(primary), status: 'Active', createdBy: by, updatedOn: todayIso() };
  rec.sno = rec.contactId;
  await addRecord('contacts', rec);
  mergeRows('client-dir:contacts', [...fresh, rec], 'contactId');
  return { contact: rec, created: true };
}

/** Stores the fresh rows as the shared list (Client Directory page and every picker see them at once). */
function mergeRows(name, rows, idKey) {
  rememberList(name, rows.map(r => ({ ...r, sno: r.sno || r[idKey] })));
}

/** Fills only the target fields whose new value is not empty — never writes '' over an existing value. */
export function fillNonEmpty(current, pairs) {
  const out = { ...current };
  for (const [k, v] of Object.entries(pairs)) { const s = txt(v); if (s) out[k] = s; }
  return out;
}

export const _test = { nameKey, coreKey, lev, build: () => build() };
