/**
 * EURADICLE CRM — API SERVICE
 * All Power Automate HTTP calls go through here.
 */

import FLOW_URLS from '../config/powerAutomate.js';
import { logEvent, withAuditContext, normKey, normVal, AUDIT_OPTIONS } from './auditLogger.js';

// ─── Activity log hook ───────────────────────────────────────────────────────
// Every tracker read/write goes through callFlow(), so this is the single place
// where create / read / update / delete are recorded. The last rows read from
// Excel are remembered (per module, keyed by S No) so an update can record
// exactly which fields changed, and a delete can record the removed row.
const AUDIT_MODULE = {
  BD_TRACKER_CRUD:    'bd',
  ENGAGEMENT_CRUD:    'engagement',
  OPS_CHECKLIST_CRUD: 'ops',
  CONTENT_DEV_CRUD:   'content-dev',
  SOLUTION_CRUD:      'solution',
  LEADS_CRUD:         'leads',
  VENDOR_CRUD:        'vendors',
  TASKS_CRUD:         'tasks',
  CONSULTANTS_CRUD:   'consultants',
  CLIENTS_CRUD:       'clients',
};
const AUDIT_ACTION = { get: 'READ', create: 'CREATE', update: 'UPDATE', delete: 'DELETE' };
const AUDIT_META_KEYS = new Set(['action', 'rowId', 'sno', 'SNo', 'newSno', 'table']);
const _auditRows = new Map();          // module → Map(sno → { vals:{norm→value}, names:{norm→column} })

function auditRowsOf(module) {
  if (!_auditRows.has(module)) _auditRows.set(module, new Map());
  return _auditRows.get(module);
}

function auditIndexRow(raw) {
  const vals = {}, names = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (k.startsWith('@odata') || k === 'ItemInternalId') continue;
    const n = normKey(k);
    if (!(n in vals)) { vals[n] = v; names[n] = k.trim(); }
  }
  return { vals, names };
}

function auditRecordId(body) {
  const v = body.rowId ?? body.SNo ?? body.sno ?? body['S No'] ?? body['S.No'];
  return v === undefined || v === null ? '' : String(v).trim();
}

function auditLabel(vals) {
  const pick = (...keys) => { for (const k of keys) { const v = vals[normKey(k)]; if (v) return String(v).trim(); } return ''; };
  const who  = pick('Client', 'Company', 'Client Name', 'Vendor Name', 'Full Name');
  const whom = pick('Full Name') && pick('Client Name') ? pick('Full Name') : '';
  const what = whom || pick('Topic', 'Program Topic', 'Solution Topic', 'Service Description', 'Requirement', 'Task Title', 'Program Name', 'Action', 'Summary');
  const eg   = pick('EG ID', 'Proposal ID', 'Lead ID', 'Service ID', 'Task ID', 'Consultant ID',
    'Contact ID', 'Program Record ID', 'Action ID', 'Interaction ID', 'Client ID');
  return [eg, who, what].filter(Boolean).join(' · ');
}

function auditRecord(flowKey, body, data, startedAt, error) {
  try {
    const Module = AUDIT_MODULE[flowKey];
    const Action = AUDIT_ACTION[body?.action];
    if (!Module || !Action) return;
    if (Action === 'READ' && !AUDIT_OPTIONS.logReads && !error) return;

    const DurationMs = Math.round(performance.now() - startedAt);
    const rows = auditRowsOf(Module);
    const RecordId = Action === 'READ' ? '' : (auditRecordId(body) || String(body['EG ID'] ?? body['Proposal ID'] ?? ''));
    const base = { Category: 'CRUD', Action, Module, RecordId, DurationMs };

    // Payload fields (one entry per column, aliases such as 'Start Date ' merged)
    const payload = {}, payloadNames = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (AUDIT_META_KEYS.has(k)) continue;
      const n = normKey(k);
      if (!(n in payload)) { payload[n] = v; payloadNames[n] = k.replace(/\n/g, ' ').trim(); }
    }

    if (error) {
      logEvent({ ...base, RecordLabel: auditLabel(payload), Result: 'FAILED',
        ErrorMessage: String(error?.message || error).slice(0, 2000) });
      return;
    }

    if (Action === 'READ') {
      const list = Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];
      for (const raw of list) {
        const idx = auditIndexRow(raw);
        const sno = normVal(idx.vals.sno);
        if (sno) rows.set(sno, idx);
      }
      const range = body.fromDate && body.toDate ? ` (${body.fromDate} → ${body.toDate})` : '';
      logEvent({ ...base, RecordLabel: `${list.length} rows loaded${range}` });
      return;
    }

    const prev = RecordId ? rows.get(normVal(RecordId)) : null;

    if (Action === 'CREATE') {
      const NewValues = {};
      for (const n of Object.keys(payload)) if (normVal(payload[n]) !== '') NewValues[payloadNames[n]] = payload[n];
      logEvent({ ...base, RecordLabel: auditLabel(payload),
        ChangedFields: Object.keys(NewValues).join(', '), NewValues });
      return;
    }

    if (Action === 'DELETE') {
      const OldValues = {};
      if (prev) for (const n of Object.keys(prev.vals)) OldValues[prev.names[n]] = prev.vals[n];
      logEvent({ ...base, RecordLabel: prev ? auditLabel(prev.vals) : auditLabel(payload), OldValues });
      if (RecordId) rows.delete(normVal(RecordId));
      return;
    }

    // UPDATE — record only the columns whose value actually changed
    const OldValues = {}, NewValues = {}, changed = [];
    for (const n of Object.keys(payload)) {
      const before = prev ? prev.vals[n] : undefined;
      if (prev && normVal(before) === normVal(payload[n])) continue;
      if (!prev && normVal(payload[n]) === '') continue;
      changed.push(payloadNames[n]);
      NewValues[payloadNames[n]] = payload[n];
      if (prev) OldValues[payloadNames[n]] = before ?? '';
    }
    logEvent({ ...base, RecordLabel: auditLabel(prev ? { ...prev.vals, ...payload } : payload),
      ChangedFields: changed.join(', ') || '(no change)', OldValues: prev ? OldValues : '', NewValues });
    if (prev) for (const n of Object.keys(payload)) prev.vals[n] = payload[n];
  } catch { /* logging must never break a save */ }
}

// ─── Core caller ─────────────────────────────────────────────────────────────
async function callFlow(flowKey, body = {}) {
  const startedAt = performance.now();
  try {
    const result = await callFlowRaw(flowKey, body);
    auditRecord(flowKey, body, result, startedAt, null);
    return result;
  } catch (err) {
    auditRecord(flowKey, body, null, startedAt, err);
    throw err;
  }
}

async function callFlowRaw(flowKey, body = {}) {
  const url = FLOW_URLS[flowKey];
  if (!url) throw new Error(`FLOW_NOT_CONFIGURED:${flowKey}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    // 502 = the flow ran but one of its steps (usually an Excel step) failed.
    // Power Automate's own text is vague, so say where to look.
    if (response.status === 502) {
      let detail = '';
      try { detail = JSON.parse(text)?.error?.message || ''; } catch { detail = text.slice(0, 200); }
      throw new Error(`Power Automate flow ${flowKey} failed inside one of its steps (502, action "${body?.action || '?'}")` +
        (detail ? ` — ${detail}` : '') +
        `. Open the flow in Power Automate → Run history → the failed run to see which Excel step broke.`);
    }
    throw new Error(`Flow ${flowKey} failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (response.status === 202 || !contentType.includes('application/json')) {
    return { success: true };
  }
  return response.json();
}

// Power Automate encodes some characters in Excel headers, e.g. '.' → '_x002e_'
// ('Actual Gen. Date' arrives as 'Actual Gen_x002e_ Date'). Add the decoded
// name next to every encoded one so lookups by the real header always work.
function withDecodedKeys(r) {
  if (!r || typeof r !== 'object') return r;
  const out = { ...r };
  for (const k of Object.keys(r)) {
    if (!/_x[0-9a-f]{4}_/i.test(k)) continue;
    const dec = k.replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (!(dec in out)) out[dec] = r[k];
  }
  return out;
}

// Helper: get a field trying multiple key variants (PA renames special chars)
// ─── Price breakup + travel billing columns (Engagement Calendar, 30 Oct 2026) ──────────────────
// [field, Excel header, type]. "Facilitation Fee (INR)" is an Excel formula: read only, never written.
export const EC_EXTRA_COLS = [
  ['pmCost', 'PM Cost (INR)', 'num'], ['materialCost', 'Material Cost (INR)', 'num'], ['otherCost', 'Other Cost (INR)', 'num'],
  ['otherCostDetails', 'Other Cost Details'], ['priceComments', 'Price Comments'],
  ['travelInvoiceRaised', 'Travel Invoice Raised'], ['travelInvoiceDate', 'Travel Invoice Date', 'date'],
  ['travelReceived', 'Travel Amount Received'], ['travelReceivedAmount', 'Travel Received Amount (INR)', 'num'],
  ['travelReceivedDate', 'Travel Received Date', 'date'],
];
const headerVariants = h => [...new Set([h, h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]+/g, '_'), h.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')])];
// Sent only once the Excel table has these columns (seen in a read) — before that, saves stay exactly as they were
let _ecHasExtraCols = false;
export const ecHasExtraCols = () => _ecHasExtraCols;
function readEcExtras(r) {
  const out = {};
  EC_EXTRA_COLS.forEach(([k, h, type]) => {
    const raw = getField(r, ...headerVariants(h), k);
    if (raw !== undefined) _ecHasExtraCols = true;
    out[k] = raw == null || String(raw).trim() === '' ? '' : type === 'num' ? toAmount(raw) : type === 'date' ? formatDate(raw) : String(raw);
  });
  const fee = getField(r, ...headerVariants('Facilitation Fee (INR)'), 'facilitationFee');
  out.facilitationFee = fee == null || String(fee).trim() === '' ? '' : toAmount(fee);
  return out;
}
/** Excel columns for every EC write (the flow rewrites the whole row, so they must always be sent). */
export const ecExtraFields = e => (_ecHasExtraCols ? Object.fromEntries(EC_EXTRA_COLS.map(([k, h]) => [h, e?.[k] ?? ''])) : {});

function getField(r, ...keys) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

// ─── ENGAGEMENT INDEX (permanent link ID) ────────────────────────────────────
// The 'Index' column links one engagement across the Engagement Calendar,
// Ops Checklist and Content Dev Tracker. It is a fixed number (NOT a formula),
// set once by the CRM, shown read-only, never edited. S No is display-only.
export const ENGAGEMENT_KEY_COL = 'Index';

/** Next Index for a new engagement = highest Index in the Engagement Calendar + 1. */
export async function nextEngagementIndex() {
  const rows = await getAllEngagementsCached({ force: true });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.engagementKey) || 0), 0);
  return String(max + 1);
}

/** Unique ID for a tracker row that was NOT created from the calendar (manual add). */
export function newLocalKey(prefix, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, '0');
  return `${prefix}-${String(now.getFullYear()).slice(2)}${p(now.getMonth() + 1)}${p(now.getDate())}-${rand}`;
}

/** Excel stores the calendar Index as a number. */
const keyCell = k => (/^\d+$/.test(String(k)) ? Number(k) : k);

const readKey = r => String(getField(r, 'Index', 'index', 'Engagement Key', 'Engagement_Key', 'engagementKey') ?? '').trim();

function requireKey(key, what) {
  const k = String(key ?? '').trim();
  if (!k) {
    throw new Error(`${what} has no Index, so it can't be saved safely. ` +
      'Rows typed straight into Excel need an Index — ask the CRM admin to add one.');
  }
  return k;
}

// ─── BD TRACKER ──────────────────────────────────────────────────────────────
// All 4 operations go to the single BD_TRACKER_CRUD flow URL.
// The flow switches internally on the `action` field.

async function callBDFlow(action, payload = {}) {
  return callFlow('BD_TRACKER_CRUD', { action, ...payload });
}

export async function getBDTracker() {
  return rememberList('bd', await withReadRetry(fetchBDTracker));
}

async function fetchBDTracker() {
  const data = await callBDFlow('get');
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];
  return rows.map((r, i) => ({
    id: i + 1,
    sno:         getField(r, 'S No', 'S.No', 'S_No', 'sno') ?? i + 1,
    client:      getField(r, 'Client', 'client') ?? '',
    concern:     getField(r, 'Concern Person', 'Concern_Person', 'concern') ?? '',
    contact:     String(getField(r, 'Contact Number', 'Contact_Number', 'contact') ?? ''),
    topic:       getField(r, 'Topic', 'topic') ?? '',
    status:      getField(r, 'Status', 'status') ?? '',
    duration:    getField(r, 'Duration / Dates', 'Duration___Dates', 'duration') ?? '',
    statusDetail:  getField(r, 'Status2', 'Status_1', 'statusDetail') ?? '',
    commercials:   Number(getField(r, 'Commercials', 'commercials') ?? 0) || null,
    comments:      getField(r, 'Comments', 'comments') ?? '',
    serviceType:   getField(r, 'Service Type', 'Service_Type', 'serviceType') ?? '',
    industry:      getField(r, 'Industry', 'industry', 'Industry / Sector', 'Sector') ?? '',
    proposalLink1: getField(r, 'Proposal Link 1', 'Proposal_Link_1') ?? '',
    modules:       getField(r, 'Modules', 'modules') ?? '',
    proposalLink2: getField(r, 'Proposal Link 2', 'Proposal_Link_2') ?? '',
    modules3:      getField(r, 'Modules3', 'modules3') ?? '',
    proposalLink3: getField(r, 'Proposal Link 3', 'Proposal_Link_3') ?? '',
    modules4:      getField(r, 'Modules4', 'modules4') ?? '',
  })).filter(r => r.client);
}

export async function addBDRow(rowData) {
  return callBDFlow('create', {
    'Client':           rowData.client,
    'Concern Person':   rowData.concern,
    'Contact Number':   rowData.contact,
    'Topic':            rowData.topic,
    'Status':           rowData.status,
    'Duration / Dates': rowData.duration,
    'Status2':          rowData.statusDetail || '',
    'Commercials':      rowData.commercials || '',
    'Comments':         rowData.comments,
    'Service Type':     rowData.serviceType,
    'Proposal Link 1':  rowData.proposalLink1 || '',
    'Modules':          rowData.modules || '',
    'Proposal Link 2':  rowData.proposalLink2 || '',
    'Modules3':         rowData.modules3 || '',
    'Proposal Link 3':  rowData.proposalLink3 || '',
    'Modules4':         rowData.modules4 || '',
  });
}

export async function updateBDRow(sno, updates) {
  return callBDFlow('update', { rowId: sno, newSno: updates['S.No'] ?? sno, ...updates });
}

export async function deleteBDRow(sno) {
  return callBDFlow('delete', { rowId: sno });
}

// After a delete, renumber all rows whose S.No > deletedSno
// Processes in ascending order so there are no key conflicts in Excel.
export async function renumberBDRows(deletedSno, allRows) {
  // Activity log: the S No shifts are recorded as RENUMBER rows sharing one CorrelationId
  return withAuditContext({ Action: 'RENUMBER', Category: 'SYSTEM' }, () => renumberBDRowsInner(deletedSno, allRows));
}

async function renumberBDRowsInner(deletedSno, allRows) {
  const rowsToUpdate = allRows
    .filter(r => r.sno > deletedSno)
    .sort((a, b) => a.sno - b.sno);

  for (const row of rowsToUpdate) {
    await updateBDRow(row.sno, {
      'S.No':             row.sno - 1,
      'Client':           row.client,
      'Concern Person':   row.concern,
      'Contact Number':   row.contact,
      'Topic':            row.topic,
      'Status':           row.status,
      'Duration / Dates': row.duration,
      'Status2':          row.statusDetail || '',
      'Commercials':      row.commercials || '',
      'Comments':         row.comments,
      'Service Type':     row.serviceType,
      'Proposal Link 1':  row.proposalLink1 || '',
      'Modules':          row.modules || '',
      'Proposal Link 2':  row.proposalLink2 || '',
      'Modules3':         row.modules3 || '',
      'Proposal Link 3':  row.proposalLink3 || '',
      'Modules4':         row.modules4 || '',
    });
  }
}

// ─── ENGAGEMENT CALENDAR ─────────────────────────────────────────────────────
async function callEngagementFlow(action, payload = {}) {
  return callFlow('ENGAGEMENT_CRUD', { action, ...payload });
}

// EC 'Contract' (shown as Contract Type). The header has been written as 'Contract',
// 'Contract Type' and with stray spaces — read whichever holds a value.
function ecContract(r) {
  const v = getField(r, 'Contract', 'Contract Type', 'Contract ', 'Contract_Type', 'contract');
  if (v !== undefined && String(v).trim() !== '') return v;
  for (const [k, val] of Object.entries(r || {})) {
    const lk = String(k).toLowerCase().replace(/[^a-z]/g, '');
    if ((lk === 'contract' || lk === 'contracttype') && String(val ?? '').trim() !== '') return val;
  }
  return v ?? '';
}
/** Every key the EC flow may use for the contract column (it maps whichever one it was built with). */
export const ecContractFields = v => ({ contract: v || '', Contract: v || '', 'Contract Type': v || '' });

export async function getEngagements(filters = {}) {
  const data = await callEngagementFlow('get', filters);
  const rows = (Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : []).map(withDecodedKeys);

  return rows.map((r, i) => {
    // PA renames columns — try every known variant (column is now 'EG ID' with a space)
    const egId = getField(r,
      'EG ID', 'EG.ID', 'EG_ID', 'EGID', 'EG__ID', 'EG_x002e_ID', 'egId', 'eg_id', 'EgId'
    ) ?? `EG.ID ${i + 1}`;

    return {
      id: i + 1,
      egId: String(egId),
      // Excel column is 'SNo' — read it first so the real S No is used (not the list index)
      sno:  getField(r, 'SNo', 'S No', 'S.No', 'S_No', 'sno') ?? i + 1,
      engagementKey: readKey(r),
      company:     getField(r, 'Company', 'company') ?? '',
      // EC column is ' Start Date' (leading space). PA converts spaces→underscores,
      // so the leading space becomes a leading underscore: '_Start_Date'.
      startDate:   formatDate(getField(r, '_Start_Date', ' Start Date', 'Start Date', 'StartDate', 'Start_Date', 'startDate')),
      endDate:     formatDate(getField(r, 'End Date', 'EndDate', 'End_Date', 'endDate')),
      // PA may trim trailing space from 'Topic '
      topic:       String(getField(r, 'Topic ', 'Topic', 'topic') ?? '').replace(/\s+/g, ' ').trim(),
      sector:      getField(r, 'Sector', 'sector') ?? '',
      serviceType: getField(r, 'Service Type', 'Service_Type', 'ServiceType', 'serviceType') ?? '',
      offering:    getField(r, 'Offering', 'offering') ?? '',
      day:         Number(getField(r, 'Day', 'day') ?? 0) || 0,
      location:    sanitiseLocation(getField(r, 'Location', 'location')),
      // raw Excel value (blank / '#VALUE!' kept) — used by the Operations dashboard for delivery mode
      locationRaw: String(getField(r, 'Location', 'location') ?? '').trim(),
      consultant1: getField(r, 'Consultant - 1', 'Consultant_1', 'Consultant___1', 'consultant1') ?? '',
      consultant2: getField(r, 'Consultant - 2', 'Consultant_2', 'Consultant___2', 'consultant2') ?? '',
      consultant3: getField(r, 'Consultant - 3', 'Consultant_3', 'Consultant___3', 'consultant3') ?? '',
      status:      getField(r, 'Status', 'status') ?? '',
      contract:    ecContract(r),
      poStatus:    getField(r, 'PO Status', 'PO_Status', 'POStatus', 'poStatus') ?? '',
      invoice:        formatDate(getField(r, 'Invoice ', 'Invoice', 'invoice')),
      // toAmount: also reads text cells such as "1,50,000" or "₹ 50,000" (plain Number() made them 0)
      price:          toAmount(getField(r, 'Price (INR)', 'Price__INR_', 'Price_INR_', 'price')),
      travelExpenses: toAmount(getField(r, 'Travel, Stay and Misc Expenses', 'Travel, Stay and Misc. Expenses', 'travelExpenses')),
      gst:            toAmount(getField(r, 'GST', 'gst')),
      payment:        getField(r, 'Payment', 'payment') ?? '',
      amountReceived: getField(r, 'Amount Received', 'Amount_Received', 'amountReceived') ?? '',
      receivedDate:   formatDate(getField(r, 'Received Date', 'ReceivedDate', 'Received_Date', 'receivedDate')),
      comments:       getField(r, 'Comments ', 'Comments', 'comments') ?? '',
      feedback:       getField(r, 'Feedback ', 'Feedback', 'feedback') ?? '',
      nps:            getField(r, 'NPS', 'nps') ?? '',
      // Carried from the Solution / BD Tracker when the engagement is added
      proposalLink:   getField(r, 'Proposal Link', 'Proposal_Link', 'proposalLink') ?? '',
      opsChecklist:   getField(r, 'Ops Checklist', 'Ops_Checklist', 'opsChecklist') ?? '',
      ...readEcExtras(r),
    };
  }).filter(r => r.company); // only require company — egId always has a fallback
}

// ─── ENGAGEMENT CALENDAR — 3-MONTH WINDOW LOADING ────────────────────────────
// Loading all rows at once makes the Power Automate flow time out (HTTP 504)
// once the sheet grows to hundreds of rows. The Engagement Calendar page loads
// a 3-month window instead (previous, current and next month). The range is sent
// to the flow so it can filter on its side; the rows are ALSO filtered here, so
// the page works correctly even if the flow still returns every row.

const EC_CACHE_TTL_MS = 2 * 60 * 1000;          // reuse a window for 2 minutes
const _ecCache = new Map();                      // key → { ts, promise }

/** Clear cached engagement reads (called automatically after every write). */
export function invalidateEngagementCache() {
  _ecCache.clear();
}

const pad2 = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → Excel serial number (days since 1899-12-30). */
export function isoToExcelSerial(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

/**
 * Build a 3-month window centred on (year, monthIndex 0-11).
 * Returns { from, to, months: [{ key:'YYYY-MM', label:'Sep 2026', year, month }] }
 */
export function buildMonthWindow(year, month) {
  const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = [-1, 0, 1].map(delta => {
    const dt = new Date(year, month + delta, 1);
    const y = dt.getFullYear(), m = dt.getMonth();
    return { key: `${y}-${pad2(m + 1)}`, label: `${SHORT[m]} ${y}`, year: y, month: m };
  });
  const first = months[0], last = months[2];
  const lastDay = new Date(last.year, last.month + 1, 0).getDate();
  return {
    from: `${first.key}-01`,
    to:   `${last.key}-${pad2(lastDay)}`,
    months,
  };
}

/**
 * Range of `count` months starting at (year, monthIndex 0-11).
 * Returns { from, to, months: [{ key:'YYYY-MM', label:'Sep 2026', year, month }] }
 */
export function buildMonthRange(year, month, count = 3) {
  const SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const n = Math.max(1, Math.min(36, Number(count) || 1));
  const months = Array.from({ length: n }, (_, i) => {
    const dt = new Date(year, month + i, 1);
    const y = dt.getFullYear(), m = dt.getMonth();
    return { key: `${y}-${pad2(m + 1)}`, label: `${SHORT[m]} ${y}`, year: y, month: m };
  });
  const first = months[0], last = months[n - 1];
  const lastDay = new Date(last.year, last.month + 1, 0).getDate();
  return { from: `${first.key}-01`, to: `${last.key}-${pad2(lastDay)}`, months };
}

/** True when the engagement overlaps [from, to] (ISO strings compare correctly). */
export function engagementInRange(e, from, to) {
  if (!e.startDate) return false;
  const start = e.startDate;
  const end   = e.endDate && e.endDate >= start ? e.endDate : start;
  return start <= to && end >= from;
}

// Retry only READ calls, only for gateway/throttling errors. A 504 from Power
// Automate often has no CORS headers, so the browser reports it as a TypeError
// ("Failed to fetch") — treat that as retryable too.
async function withReadRetry(fn, delays = [2000, 5000]) {
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const retryable = err instanceof TypeError || /\((429|502|503|504)\)/.test(msg);
      if (!retryable || attempt === delays.length) break;
      await new Promise(res => setTimeout(res, delays[attempt]));
    }
  }
  if (lastErr instanceof TypeError) {
    throw new Error('The Power Automate flow did not respond in time (timeout / 504). Please try again in a minute.');
  }
  throw lastErr;
}

// ── Saved copy of each loaded range (memory + browser storage) ──────────────
// Lets the page show data instantly (stale-while-revalidate) while a fresh
// copy loads from Excel in the background. Browser copy expires after 24h.
const _ecData = new Map();                       // key → { ts, rows }
const EC_STORE_KEY = 'ercrm.engagements.cache.v1';
const EC_STORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EC_STORE_MAX_ENTRIES = 12;

function storeReadAll() {
  try { return JSON.parse(localStorage.getItem(EC_STORE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function storeWriteAll(all) {
  try { localStorage.setItem(EC_STORE_KEY, JSON.stringify(all)); } catch { /* storage full / blocked */ }
}
function storeSave(key, rows) {
  const all = storeReadAll();
  all[key] = { ts: Date.now(), rows };
  const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts);
  keys.slice(EC_STORE_MAX_ENTRIES).forEach(k => delete all[k]);
  storeWriteAll(all);
}

function cachedRead(key, loader, force, persist = false) {
  const hit = _ecCache.get(key);
  if (!force && hit && Date.now() - hit.ts < EC_CACHE_TTL_MS) return hit.promise;
  const entry = { ts: Date.now(), promise: null };
  entry.promise = withReadRetry(loader).then(rows => {
    _ecData.set(key, { ts: Date.now(), rows });
    if (persist) storeSave(key, rows);
    return rows;
  }).catch(err => {
    if (_ecCache.get(key) === entry) _ecCache.delete(key);   // never cache a failure
    throw err;
  });
  _ecCache.set(key, entry);
  return entry.promise;
}

/** Last known rows for a range (memory first, then browser copy) — or null. Never hits the network. */
export function peekEngagementsForRange(from, to) {
  const key = `range|${from}|${to}`;
  const mem = _ecData.get(key);
  if (mem) return mem.rows;
  const saved = storeReadAll()[key];
  if (saved && Array.isArray(saved.rows) && Date.now() - saved.ts < EC_STORE_MAX_AGE_MS) {
    _ecData.set(key, saved);
    return saved.rows;
  }
  return null;
}

/** Last known FULL Engagement Calendar (memory first, then browser copy) — or null. */
export function peekAllEngagements() {
  const mem = _ecData.get('all');
  if (mem) return mem.rows;
  const saved = storeReadAll()['all'];
  if (saved && Array.isArray(saved.rows) && Date.now() - saved.ts < EC_STORE_MAX_AGE_MS) {
    _ecData.set('all', saved);
    return saved.rows;
  }
  return null;
}

/** Load a range in the background (no-op if a fresh copy is already cached). */
export function prefetchEngagementsForRange(from, to) {
  const hit = _ecCache.get(`range|${from}|${to}`);
  if (hit && Date.now() - hit.ts < EC_CACHE_TTL_MS) return;
  getEngagementsForRange(from, to).catch(() => { /* silent — it is only a prefetch */ });
}

/** Apply a change to every saved copy (used after a successful save/delete). */
export function patchEngagementCaches(mutate) {
  for (const [k, v] of _ecData) _ecData.set(k, { ...v, rows: mutate(v.rows) });
  const all = storeReadAll();
  Object.keys(all).forEach(k => { if (Array.isArray(all[k].rows)) all[k].rows = mutate(all[k].rows); });
  storeWriteAll(all);
}

/**
 * Engagements overlapping [from, to] plus rows with no Start Date
 * (flagged `undated: true`). Cached for 2 minutes; pass { force: true } to refresh.
 */
export function getEngagementsForRange(from, to, { force = false } = {}) {
  return cachedRead(`range|${from}|${to}`, async () => {
    const rows = await getEngagements({
      fromDate:   from,
      toDate:     to,
      fromSerial: isoToExcelSerial(from),
      toSerial:   isoToExcelSerial(to),
    });
    return rows
      .filter(e => !e.startDate || engagementInRange(e, from, to))
      .map(e => (e.startDate ? e : { ...e, undated: true }));
  }, force, true);
}

/** Every engagement (used only when the Add form needs all EG IDs). Cached. */
export function getAllEngagementsCached({ force = false } = {}) {
  return cachedRead('all', () => getEngagements(), force, true);
}

/**
 * Every engagement, for the Dashboard. Tries the full read first; when that fails (usually the
 * flow timing out on a large sheet) it reads the previous, current and next financial year in
 * 3-month windows — the same reads the Engagement Calendar page uses — and keeps the last saved
 * copy for rows outside those years. Returns { rows, fallback } — fallback is the full-read
 * error when the window path was used, else null. Throws only if both paths fail.
 */
export async function getAllEngagementsResilient({ force = false } = {}) {
  try {
    return { rows: await getAllEngagementsCached({ force }), fallback: null };
  } catch (fullErr) {
    const t = new Date();
    const fy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;   // FY starts in April
    const windows = [];
    for (let i = 0; i < 12; i++) {                                          // Apr (FY-1) … Mar (FY+2)
      const s = new Date(fy - 1, 3 + i * 3, 1), e = new Date(fy - 1, 3 + i * 3 + 3, 0);
      const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      windows.push([iso(s), iso(e)]);
    }
    const parts = [];
    for (let i = 0; i < windows.length; i += 3) {                           // 3 reads at a time
      const got = await Promise.all(windows.slice(i, i + 3).map(([f, to]) => getEngagementsForRange(f, to, { force })));
      parts.push(...got);
    }
    const from = windows[0][0], to = windows[windows.length - 1][1];
    const keyOfRow = e => `${e.egId}|${e.sno}|${String(e.engagementKey ?? '').trim()}`;
    const merged = new Map();
    // Older saved copy first (only rows outside the re-read years), then the fresh windows
    (peekAllEngagements() || []).forEach(e => {
      if (e.startDate && !engagementInRange(e, from, to)) merged.set(keyOfRow(e), e);
    });
    parts.flat().forEach(e => { const { undated, ...row } = e; merged.set(keyOfRow(row), row); });   // eslint-disable-line no-unused-vars
    const rows = [...merged.values()];
    _ecData.set('all', { ts: Date.now(), rows });
    storeSave('all', rows);
    return { rows, fallback: fullErr };
  }
}

// Tell the background sync that the Engagement Calendar changed
function notifyEcChanged(result) {
  try { window.dispatchEvent(new CustomEvent('ercrm:ec-changed')); } catch { /* non-browser */ }
  return result;
}

export async function addEngagementRow(rowData) {
  // Use exact Excel column names for fields with spaces/special chars so PA
  // triggerBody()?['Service Type'] matches without needing camelCase mapping.
  // Single-word columns (sector, offering, etc.) still work as-is (CI match).
  invalidateEngagementCache();
  const key = String(rowData.engagementKey || '').trim() || await nextEngagementIndex();
  return callEngagementFlow('create', {
    [ENGAGEMENT_KEY_COL]:              keyCell(key),
    'EG ID':                           rowData.egId           || '',
    company:                           rowData.company        || '',
    'Start Date':                      rowData.startDate      || '',
    'End Date':                        rowData.endDate        || '',
    topic:                             rowData.topic          || '',
    sector:                            rowData.sector         || '',
    'Service Type':                    rowData.serviceType    || '',
    offering:                          rowData.offering       || '',
    day:                               rowData.day            ?? 1,
    location:                          rowData.location       || '',
    'Consultant - 1':                  rowData.consultant1    || '',
    'Consultant - 2':                  rowData.consultant2    || '',
    status:                            rowData.status         || '',
    ...ecContractFields(rowData.contract),
    'PO Status':                       rowData.poStatus       || '',
    invoice:                           rowData.invoice        || '',
    'Price (INR)':                     rowData.price          || 0,
    'Travel, Stay and Misc Expenses':  rowData.travelExpenses || 0,
    gst:                               rowData.gst            || 0,
    payment:                           rowData.payment        || '',
    'Amount Received':                 rowData.amountReceived || '',
    'Received Date':                   rowData.receivedDate   || '',
    comments:                          rowData.comments       || '',
    feedback:                          rowData.feedback       || '',
    nps:                               rowData.nps            || '',
    'Proposal Link':                   rowData.proposalLink   || '',
    'Ops Checklist':                   rowData.opsChecklist   || '',
    ...ecExtraFields(rowData),
  }).then(notifyEcChanged).then(res => ({ ...(res || {}), engagementKey: key }));
}

export async function updateEngagementRow(egId, sno, updates, engagementKey) {
  // The flow's "Update a row" finds the row by its Index (Key Column
  // 'Index', Key Value triggerBody()?['Index']). S No is a
  // =ROW()-1 formula now, so it is never used to find a row.
  const key = requireKey(engagementKey ?? updates?.[ENGAGEMENT_KEY_COL], `Engagement ${egId || ''}`.trim());
  const body = { ...updates };
  delete body.SNo; delete body.sno; delete body.rowId; delete body.engagementKey;
  invalidateEngagementCache();
  return callEngagementFlow('update', { ...body, [ENGAGEMENT_KEY_COL]: key }).then(notifyEcChanged);
}

export async function deleteEngagementRow(egId, sno, engagementKey) {
  const key = requireKey(engagementKey, `Engagement ${egId || ''}`.trim());
  invalidateEngagementCache();
  return callEngagementFlow('delete', { egId, sno, [ENGAGEMENT_KEY_COL]: key }).then(notifyEcChanged);
}

// ─── OPS CHECKLIST ───────────────────────────────────────────────────────────
async function callOpsFlow(action, payload = {}) {
  return callFlow('OPS_CHECKLIST_CRUD', { action, ...payload });
}

const fmtDtField = d => {
  if (!d) return '';
  const s = String(d).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 25000) {
    const dt = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(dt) ? s : dt.toISOString().slice(0, 10);
  }
  // Text typed as a date (26/10/2026, 26-Oct-2026 …) → YYYY-MM-DD so date filters / dashboards can use it
  const f = formatDate(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) && !/^\d{4}-\d{2}-\d{2}/.test(s) ? f : s;
};

// Raw rows from the last Ops Checklist read — used only to explain a failed save
let _lastOpsRaw = [];
/** Raw Excel row (column names exactly as Power Automate returns them) for this Index, or null. */
export function rawOpsRowFor(index) {
  const k = String(index ?? '').trim();
  return _lastOpsRaw.find(r => String(r?.Index ?? r?.index ?? '').trim() === k) || null;
}

async function fetchOpsChecklist() {
  const data = await callOpsFlow('get');
  const rows = (Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : []).map(withDecodedKeys);
  _lastOpsRaw = rows;
  return rows.map((r, i) => ({
    sno:             getField(r,'S No','S.No','S_No','sno') ?? i + 1,
    engagementKey:   readKey(r),
    egId:            getField(r,'EG.ID','EG_ID','EG_x002e_ID') ?? '',
    company:         getField(r,'Company') ?? '',
    clientSpoc:      getField(r,'Client SPOC','Client_SPOC') ?? '',
    startDate:       fmtDtField(getField(r,'Engagement\nStart Date','Engagement_x000a_Start_Date','Engagement Start Date')),
    endDate:         fmtDtField(getField(r,'Engagement\nEnd Date','Engagement_x000a_End_Date','Engagement End Date')),
    topic:           getField(r,'Topic') ?? '',
    sector:          getField(r,'Sector') ?? '',
    serviceType:     getField(r,'Service Type','Service_Type') ?? '',
    offering:        getField(r,'Offering') ?? '',
    internalPoc:     getField(r,'Internal POC','Internal_POC') ?? '',
    contractType:    getField(r,'Contract Type','Contract_Type') ?? '',
    contractStatus:  getField(r,'Contract Status','Contract_Status') ?? '',
    paxListReceived: getField(r,'Pax List\nReceived','Pax_List_Received') ?? '',
    noOfParticipants:Number(getField(r,'No of\nParticipants','No_of_Participants','No of Participants') ?? 0) || 0,
    day:             getField(r,'Day') ?? '',
    programType:     getField(r,'Program Type','Program_Type') ?? '',
    location:        getField(r,'Location') ?? '',
    consultant1:     getField(r,'Consultant 1','Consultant_1') ?? '',
    consultant2:     getField(r,'Consultant 2','Consultant_2') ?? '',
    consultant3:     getField(r,'Consultant 3','Consultant_3') ?? '',
    status:          getField(r,'Status') ?? '',
    calendarBlock:           getField(r,'Facilitator Calendar Block','Facilitator_Calendar_Block') ?? '',
    calendarBlockPoc:        getField(r,'SPOC / POC','SPOC___POC') ?? '',
    calendarBlockDone:       fmtDtField(getField(r,'Date of Completion','Date_of_Completion')),
    calendarBlockComment:    getField(r,'Comments - Facilitator Calendar Block','Comments___Facilitator_Calendar_Block') ?? '',
    travelDetails:           getField(r,'Travel Details Finalised','Travel_Details_Finalised') ?? '',
    travelDetailsPoc:        getField(r,'SPOC / POC2','SPOC___POC2') ?? '',
    travelDetailsDone:       fmtDtField(getField(r,'Date of Completion4','Date_of_Completion4')),
    travelDetailsComment:    getField(r,'Comments - Travel Details Finalised','Comments___Travel_Details_Finalised') ?? '',
    welcomeEmail:            getField(r,'Welcome Email + Pre-Work','Welcome_Email___Pre_Work') ?? '',
    welcomeEmailPoc:         getField(r,'SPOC / POC5','SPOC___POC5') ?? '',
    welcomeEmailDone:        fmtDtField(getField(r,'Date of Completion7','Date_of_Completion7')),
    welcomeEmailComment:     getField(r,'Comments - Welcome Email + Pre-Work','Comments___Welcome_Email___Pre_Work') ?? '',
    preWork:                 getField(r,'Pre-Work Details','Pre_Work_Details') ?? '',
    preWorkPoc:              getField(r,'SPOC / POC8','SPOC___POC8') ?? '',
    preWorkDone:             fmtDtField(getField(r,'Date of Completion10','Date_of_Completion10')),
    preWorkComment:          getField(r,'Comments - Pre-Work Details','Comments___Pre_Work_Details') ?? '',
    evAndPm:                 getField(r,'EV & PM Shared with Consultant','EV___PM_Shared_with_Consultant','EV & PM Shared w/ Consultant') ?? '',
    evAndPmPoc:              getField(r,'SPOC / POC11','SPOC___POC11') ?? '',
    evAndPmDone:             fmtDtField(getField(r,'Date of Completion13','Date_of_Completion13')),
    evAndPmComment:          getField(r,'Comments - EV & PM Shared with Consultant','Comments___EV___PM_Shared_with_Consultant') ?? '',
    bootcamp:                getField(r,'Bootcamp Finalised','Bootcamp_Finalised') ?? '',
    bootcampPoc:             getField(r,'SPOC / POC14','SPOC___POC14') ?? '',
    bootcampDone:            fmtDtField(getField(r,'Date of Completion16','Date_of_Completion16')),
    bootcampComment:         getField(r,'Comments - Bootcamp Finalised','Comments___Bootcamp_Finalised') ?? '',
    teachback:               getField(r,'Teachback Finalised','Teachback_Finalised') ?? '',
    teachbackPoc:            getField(r,'SPOC / POC17','SPOC___POC17') ?? '',
    teachbackDone:           fmtDtField(getField(r,'Date of Completion19','Date_of_Completion19')),
    teachbackComment:        getField(r,'Comments - Teachback Finalised','Comments___Teachback_Finalised') ?? '',
    electronicVisuals:       getField(r,'Electronic Visuals + QR','Electronic_Visuals___QR') ?? '',
    electronicVisualsPoc:    getField(r,'SPOC / POC20','SPOC___POC20') ?? '',
    electronicVisualsDone:   fmtDtField(getField(r,'Date of Completion22','Date_of_Completion22')),
    electronicVisualsComment:getField(r,'Comments - Electronic Visuals + QR','Comments___Electronic_Visuals___QR') ?? '',
    participantManual:       getField(r,'Participant Manual','Participant_Manual') ?? '',
    participantManualPoc:    getField(r,'SPOC / POC23','SPOC___POC23') ?? '',
    participantManualDone:   fmtDtField(getField(r,'Date of Completion25','Date_of_Completion25')),
    participantManualComment:getField(r,'Comments - Participant Manual','Comments___Participant_Manual') ?? '',
    materialPrinting:        getField(r,'Material Printing Required','Material_Printing_Required') ?? '',
    materialPrintingPoc:     getField(r,'SPOC / POC26','SPOC___POC26') ?? '',
    materialPrintingDone:    fmtDtField(getField(r,'Date of Completion28','Date_of_Completion28')),
    materialPrintingComment: getField(r,'Comments - Material Printing Required','Comments___Material_Printing_Required') ?? '',
    materialOrdering:        getField(r,'Material Ordering & Delivery Status','Material_Ordering___Delivery_Status') ?? '',
    materialOrderingPoc:     getField(r,'SPOC / POC29','SPOC___POC29') ?? '',
    materialOrderingDone:    fmtDtField(getField(r,'Date of Completion31','Date_of_Completion31')),
    materialOrderingComment: getField(r,'Comments - Material Ordering & Delivery Status','Comments___Material_Ordering___Delivery_Status') ?? '',
    materialConversion:      getField(r,'Material Conversion to Editable Form','Material_Conversion_to_Editable_Form') ?? '',
    materialConversionPoc:   getField(r,'SPOC / POC32','SPOC___POC32') ?? '',
    materialConversionDone:  fmtDtField(getField(r,'Date of Completion34','Date_of_Completion34')),
    materialConversionComment:getField(r,'Comments - Material Conversion to Editable Form','Comments___Material_Conversion_to_Editable_Form') ?? '',
    attendanceSheet:         getField(r,'Attendance Sheet & Photos','Attendance_Sheet___Photos') ?? '',
    attendanceSheetPoc:      getField(r,'SPOC / POC35','SPOC___POC35') ?? '',
    attendanceSheetDone:     fmtDtField(getField(r,'Date of Completion37','Date_of_Completion37')),
    attendanceSheetComment:  getField(r,'Comments - Attendance Sheet & Photos','Comments___Attendance_Sheet___Photos') ?? '',
    feedbackReport:          getField(r,'Feedback Report','Feedback_Report') ?? '',
    feedbackReportPoc:       getField(r,'SPOC / POC38','SPOC___POC38') ?? '',
    feedbackReportDone:      fmtDtField(getField(r,'Date of Completion40','Date_of_Completion40')),
    feedbackReportComment:   getField(r,'Comments - Feedback Report','Comments___Feedback_Report') ?? '',
    impactReport:            getField(r,'Impact Report','Impact_Report') ?? '',
    impactReportPoc:         getField(r,'SPOC / POC41','SPOC___POC41') ?? '',
    impactReportDone:        fmtDtField(getField(r,'Date of Completion43','Date_of_Completion43')),
    impactReportComment:     getField(r,'Comments - Impact Report','Comments___Impact_Report') ?? '',
    socialMedia:             getField(r,'Social Media Post','Social_Media_Post') ?? '',
    socialMediaPoc:          getField(r,'SPOC / POC44','SPOC___POC44') ?? '',
    socialMediaDone:         fmtDtField(getField(r,'Date of Completion46','Date_of_Completion46')),
    socialMediaComment:      getField(r,'Comments - Social Media Post','Comments___Social_Media_Post') ?? '',
    invoiceGenerated:        getField(r,'Invoice Generated','Invoice_Generated') ?? '',
    invoicePoc:              getField(r,'Internal POC47','Internal_POC47') ?? '',
    invoiceActualDate:       fmtDtField(getField(r,'Actual Gen. Date','Actual_Gen__Date')),
    invoiceComment:          getField(r,'Comments - Invoice Generated','Comments___Invoice_Generated') ?? '',
    paymentReceived:         getField(r,'Payment Received','Payment_Received') ?? '',
    paymentActualDate:       fmtDtField(getField(r,'Actual Payout Date','Actual_Payout_Date')),
    // Items the BD person ticked when the proposal was won (carried via the Engagement Calendar)
    bdChecklist:             getField(r,'BD Checklist','BD_Checklist','bdChecklist') ?? '',
  })).filter(r => r.company);
}

const OPS_FIELD_MAP = {
  sno:'S No', engagementKey:'Index',
  egId:'EG ID', company:'company', clientSpoc:'Client SPOC',
  startDate:'Engagement Start Date', endDate:'Engagement End Date',
  topic:'Topic', sector:'Sector', serviceType:'Service Type', offering:'Offering',
  internalPoc:'Internal POC', contractType:'Contract Type', contractStatus:'Contract Status',
  paxListReceived:'Pax List\nReceived', noOfParticipants:'No of\nParticipants',
  day:'Day', programType:'Program Type', location:'Location',
  consultant1:'Consultant 1', consultant2:'Consultant 2', consultant3:'Consultant 3', status:'Status',
  calendarBlock:'Facilitator Calendar Block', calendarBlockPoc:'SPOC / POC', calendarBlockDone:'Date of Completion', calendarBlockComment:'Comments - Facilitator Calendar Block',
  travelDetails:'Travel Details Finalised', travelDetailsPoc:'SPOC / POC2', travelDetailsDone:'Date of Completion4', travelDetailsComment:'Comments - Travel Details Finalised',
  welcomeEmail:'Welcome Email + Pre-Work', welcomeEmailPoc:'SPOC / POC5', welcomeEmailDone:'Date of Completion7', welcomeEmailComment:'Comments - Welcome Email + Pre-Work',
  preWork:'Pre-Work Details', preWorkPoc:'SPOC / POC8', preWorkDone:'Date of Completion10', preWorkComment:'Comments - Pre-Work Details',
  evAndPm:'EV & PM Shared with Consultant', evAndPmPoc:'SPOC / POC11', evAndPmDone:'Date of Completion13', evAndPmComment:'Comments - EV & PM Shared with Consultant',
  bootcamp:'Bootcamp Finalised', bootcampPoc:'SPOC / POC14', bootcampDone:'Date of Completion16', bootcampComment:'Comments - Bootcamp Finalised',
  teachback:'Teachback Finalised', teachbackPoc:'SPOC / POC17', teachbackDone:'Date of Completion19', teachbackComment:'Comments - Teachback Finalised',
  electronicVisuals:'Electronic Visuals + QR', electronicVisualsPoc:'SPOC / POC20', electronicVisualsDone:'Date of Completion22', electronicVisualsComment:'Comments - Electronic Visuals + QR',
  participantManual:'Participant Manual', participantManualPoc:'SPOC / POC23', participantManualDone:'Date of Completion25', participantManualComment:'Comments - Participant Manual',
  materialPrinting:'Material Printing Required', materialPrintingPoc:'SPOC / POC26', materialPrintingDone:'Date of Completion28', materialPrintingComment:'Comments - Material Printing Required',
  materialOrdering:'Material Ordering & Delivery Status', materialOrderingPoc:'SPOC / POC29', materialOrderingDone:'Date of Completion31', materialOrderingComment:'Comments - Material Ordering & Delivery Status',
  materialConversion:'Material Conversion to Editable Form', materialConversionPoc:'SPOC / POC32', materialConversionDone:'Date of Completion34', materialConversionComment:'Comments - Material Conversion to Editable Form',
  attendanceSheet:'Attendance Sheet & Photos', attendanceSheetPoc:'SPOC / POC35', attendanceSheetDone:'Date of Completion37', attendanceSheetComment:'Comments - Attendance Sheet & Photos',
  feedbackReport:'Feedback Report', feedbackReportPoc:'SPOC / POC38', feedbackReportDone:'Date of Completion40', feedbackReportComment:'Comments - Feedback Report',
  impactReport:'Impact Report', impactReportPoc:'SPOC / POC41', impactReportDone:'Date of Completion43', impactReportComment:'Comments - Impact Report',
  socialMedia:'Social Media Post', socialMediaPoc:'SPOC / POC44', socialMediaDone:'Date of Completion46', socialMediaComment:'Comments - Social Media Post',
  invoiceGenerated:'Invoice Generated', invoicePoc:'Internal POC47',
  invoiceActualDate:'Actual Gen. Date', invoiceComment:'Comments - Invoice Generated',
  paymentReceived:'Payment Received', paymentActualDate:'Actual Payout Date',
  bdChecklist:'BD Checklist',
};

export async function updateOpsRow(sno, changes, engagementKey) {
  const key = requireKey(engagementKey ?? changes?.engagementKey, `Ops Checklist row ${sno ?? ''}`.trim());
  const excelFields = {};
  for (const [k, v] of Object.entries(changes)) {
    // S No is a =ROW()-1 formula and the key is permanent — never write either
    if (k === 'sno' || k === 'engagementKey' || k === 'id' || k === 'S No' || k === ENGAGEMENT_KEY_COL) continue;
    excelFields[OPS_FIELD_MAP[k] || k] = v;
  }
  // Belt-and-suspenders: send ambiguous fields under every possible key name so
  // PA picks up whichever spelling its expression references (dot vs space for
  // EG ID, newline vs space for date columns — PA can't type newlines in formulas).
  const egVal = excelFields['EG ID'] ?? excelFields['EG.ID'];
  if (egVal !== undefined) { excelFields['EG ID'] = egVal; excelFields['EG.ID'] = egVal; }
  const sdVal = excelFields['Engagement Start Date'];
  if (sdVal !== undefined) excelFields['Engagement\nStart Date'] = sdVal;
  const edVal = excelFields['Engagement End Date'];
  if (edVal !== undefined) excelFields['Engagement\nEnd Date'] = edVal;
  return callOpsFlow('update', { ...excelFields, rowId: key, [ENGAGEMENT_KEY_COL]: key });
}

export async function addOpsRow(form) {
  const key = String(form.engagementKey || '').trim() || newLocalKey('OC');
  const excelFields = {};
  for (const [k, v] of Object.entries(form)) {
    if (k === 'sno' || k === 'engagementKey' || k === 'id' || k === 'S No' || k === ENGAGEMENT_KEY_COL) continue;
    if (v !== undefined && v !== '') excelFields[OPS_FIELD_MAP[k] || k] = v;
  }
  excelFields[ENGAGEMENT_KEY_COL] = keyCell(key);
  // Belt-and-suspenders: same alias logic as updateOpsRow — covers both create
  // and update paths so EG ID and dates land regardless of PA expression spelling.
  const egVal = excelFields['EG ID'] ?? excelFields['EG.ID'];
  if (egVal !== undefined) { excelFields['EG ID'] = egVal; excelFields['EG.ID'] = egVal; }
  const sdVal = excelFields['Engagement Start Date'];
  if (sdVal !== undefined) excelFields['Engagement\nStart Date'] = sdVal;
  const edVal = excelFields['Engagement End Date'];
  if (edVal !== undefined) excelFields['Engagement\nEnd Date'] = edVal;
  return callOpsFlow('create', excelFields);
}

export async function deleteOpsRow(sno, engagementKey) {
  const key = requireKey(engagementKey, `Ops Checklist row ${sno ?? ''}`.trim());
  const res = await callOpsFlow('delete', { rowId: key, [ENGAGEMENT_KEY_COL]: key });
  forgetListRow('ops', key);
  return res;
}


// ─── CONTENT DEVELOPMENT TRACKER ─────────────────────────────────────────────
async function callContentDevFlow(action, payload = {}) {
  return callFlow('CONTENT_DEV_CRUD', { action, ...payload });
}

async function fetchContentDevTracker() {
  const data = await callContentDevFlow('get');
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];
  return rows.map((r, i) => ({
    id:             i + 1,
    sno:            getField(r, 'SNo', 'sno') ?? i + 1,
    engagementKey:  readKey(r),
    client:         getField(r, 'Client', 'client') ?? '',
    // Excel column is 'Start Date ' (trailing space); PA may trim or convert it
    startDate:      formatDate(getField(r, 'Start Date ', 'Start Date', 'Start_Date_', 'Start_Date', 'startDate')),
    // CDT has no End Date column — field will always be empty
    programType:    getField(r, 'Program Type', 'Program_Type', 'programType') ?? '',
    evRequired:     getField(r, 'EV Required', 'EV_Required', 'evRequired') ?? '',
    poc:            getField(r, 'POC', 'poc') ?? '',
    dueDate:        formatDate(getField(r, 'Due Date', 'Due_Date', 'dueDate')),
    completionDate: formatDate(getField(r, 'Completion Date', 'Completion_Date', 'completionDate')),
    pmRequired:     getField(r, 'PM Required', 'PM_Required', 'pmRequired') ?? '',
    // Excel column is 'Topic' (not 'Program Topic')
    topic:          getField(r, 'Topic', 'topic') ?? '',
    // Work items — each column holds a JSON list of { id, title, link, deadline, done }
    contentAssets:  parseWorkItems(getField(r, 'Content Assets', 'Content_Assets', 'contentAssets')),
    preWorkItems:   parseWorkItems(getField(r, 'Pre-Work', 'Pre_Work', 'PreWork', 'preWorkItems')),
    postWorkItems:  parseWorkItems(getField(r, 'Post-Work', 'Post_Work', 'PostWork', 'postWorkItems')),
  })).filter(r => r.client);
}

// ─── CDT work items (Content Assets / Pre-Work / Post-Work) ─────────────────
// Stored as JSON text in one Excel cell per section. Plain text typed directly
// in Excel is kept as a single item so nothing is lost on the next save.
export function parseWorkItems(raw) {
  if (Array.isArray(raw)) return raw;
  const s = String(raw ?? '').trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) {
      return v.filter(x => x && typeof x === 'object').map((x, i) => ({
        id:       String(x.id || `w${i}`),
        title:    String(x.title ?? ''),
        link:     String(x.link ?? ''),
        deadline: formatDate(x.deadline) || '',
        done:     formatDate(x.done) || '',
      }));
    }
  } catch { /* not JSON — fall through */ }
  const isUrl = /^(https?:\/\/|www\.)/i.test(s);
  return [{ id: 'w0', title: isUrl ? '' : s, link: isUrl ? s : '', deadline: '', done: '' }];
}

export function serializeWorkItems(items) {
  const list = (Array.isArray(items) ? items : [])
    .filter(x => x && (String(x.title || '').trim() || String(x.link || '').trim()))
    .map(x => ({ id: x.id, title: String(x.title || '').trim(), link: String(x.link || '').trim(), deadline: x.deadline || '', done: x.done || '' }));
  return list.length ? JSON.stringify(list) : '';
}

export async function addContentDevRow(rowData) {
  // Non-date fields always sent.
  // Date fields ONLY sent when non-empty — omitting a key means PA skips that
  // Excel cell entirely, so no corrupt serial is written regardless of the
  // flow's "DateTime Format" setting.
  const body = {
    [ENGAGEMENT_KEY_COL]: keyCell(String(rowData.engagementKey || '').trim() || newLocalKey('CD')),
    'Client':       rowData.client      || '',
    'Program Type': rowData.programType || '',
    'EV Required':  rowData.evRequired  || '',
    'POC':          rowData.poc         || '',
    'PM Required':  rowData.pmRequired  || '',
  };
  // sno is optional — passed by syncCDTWithEC so the Excel row gets the correct
  // S No from the Engagement Calendar instead of auto-incrementing.
  // S No is display-only — rows are linked by Index, so no SNo is sent.
  // Send Start Date under both spellings: PA flow may have been built with or
  // without the trailing space that the Excel column header has.
  if (rowData.startDate) {
    body['Start Date']  = rowData.startDate;   // without trailing space
    body['Start Date '] = rowData.startDate;   // with trailing space (Excel column)
  }
  // No 'End Date' column in CDT Excel — omitted intentionally.
  // Due Date is a formula in Excel — never send it; let Excel calculate it.
  if (rowData.completionDate) body['Completion Date'] = rowData.completionDate;
  // 'Topic' is the actual Excel column name (NOT 'Program Topic')
  if (rowData.topic)          body['Topic']            = rowData.topic;
  const ca = serializeWorkItems(rowData.contentAssets);
  const pr = serializeWorkItems(rowData.preWorkItems);
  const po = serializeWorkItems(rowData.postWorkItems);
  if (ca) body['Content Assets'] = ca;
  if (pr) body['Pre-Work']       = pr;
  if (po) body['Post-Work']      = po;
  return callContentDevFlow('create', body);
}

export async function updateContentDevRow(sno, rowData, engagementKey) {
  const key = requireKey(engagementKey ?? rowData?.engagementKey, `Content Dev row ${sno ?? ''}`.trim());
  return callContentDevFlow('update', {
    sno: key,                                       // flow Key Value (now the Index)
    [ENGAGEMENT_KEY_COL]: key,
    'Client':          rowData.client         || '',
    // Send Start Date under both spellings — PA flow parameter name may or may
    // not have the trailing space that the Excel column header carries.
    'Start Date':      rowData.startDate      || '',  // without trailing space
    'Start Date ':     rowData.startDate      || '',  // with trailing space (Excel column)
    // No 'End Date' column in CDT Excel — omitted intentionally.
    'Program Type':    rowData.programType    || '',
    'EV Required':     rowData.evRequired     || '',
    'POC':             rowData.poc            || '',
    // Due Date is a formula in Excel — never overwrite it; let Excel calculate it.
    'Completion Date': rowData.completionDate || '',
    'PM Required':     rowData.pmRequired     || '',
    'Topic':           rowData.topic          || '',  // actual Excel column name (NOT 'Program Topic')
    'Content Assets':  serializeWorkItems(rowData.contentAssets),
    'Pre-Work':        serializeWorkItems(rowData.preWorkItems),
    'Post-Work':       serializeWorkItems(rowData.postWorkItems),
  });
}

export async function deleteContentDevRow(sno, engagementKey) {
  const key = requireKey(engagementKey, `Content Dev row ${sno ?? ''}`.trim());
  const res = await callContentDevFlow('delete', { sno: key, [ENGAGEMENT_KEY_COL]: key });
  forgetListRow('cdt', key);
  return res;
}

// ─── SOLUTION TRACKER (BD + Solution combined) ───────────────────────────────
// The Excel headers are 'Date of Discusssion' (typo, 3 s) and, for the
// submission date, 'Date of submission ER Team4' in older copies of the file /
// flow, 'Date of Submission to Client' in newer ones. Power Automate's
// "List rows" returns the header text as-is (spaces kept), so every spelling is
// read, and every spelling is sent — the flow maps whichever one it was built
// with and ignores the rest. (Before this, the 3-s spelling was never read, so
// the date showed blank and the next save wrote the blank back to Excel.)
const DISCUSSION_KEYS = ['Date of Discusssion', 'Date of Discussion', 'Date_of_Discusssion', 'Date_of_Discussion'];
const SUBMISSION_KEYS = ['Date of Submission to Client', 'Date of submission ER Team4', 'Date of submission ER Team',
                         'Date_of_Submission_to_Client', 'Date_of_submission_ER_Team4'];
// Header compare that ignores case, spaces, underscores, line breaks and
// Power Automate's _xHHHH_ codes ('Date of_x000a_Discussion' = 'Date of Discussion').
const looseKey = k => String(k ?? '')
  .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// First spelling that holds a value (an empty column must not hide a filled one).
// Exact header first, then the same header written slightly differently.
function firstFilled(r, ...keys) {
  const filled = v => v !== undefined && v !== null && String(v).trim() !== '';
  for (const k of keys) if (filled(r[k])) return r[k];
  const wanted = new Set(keys.map(looseKey));
  for (const [k, v] of Object.entries(r || {})) if (wanted.has(looseKey(k)) && filled(v)) return v;
  return '';
}
// Last raw rows from the Solution Tracker read (only used to explain a date that didn't save)
let _lastSolutionRaw = [];
const isDateCol = k => /date|discus|submis|expt/i.test(looseKey(k));
const discussionFields = v => ({ 'Date of Discusssion': v || '', 'Date of Discussion': v || '' });
const submissionFields = v => ({ 'Date of Submission to Client': v || '', 'Date of submission ER Team4': v || '' });

// ── BD Tracker columns added 2026-10-19 (far right of Table1, after "Ops Checklist") ──
// CRM field → exact Excel header. Read with loose header matching (spaces / case ignored).
// "Total Cost of Proposal" is an Excel formula (Price per Batch × Total Expected Batches):
// it is only READ, never sent — writing to it would replace the formula in that row.
export const BD_EXTRA_COLUMNS = {
  expectedHeadcount:    'Total Expected Headcount',
  expectedBatches:      'Total Expected Batches',
  pricePerBatch:        'Price per Batch',
  participantProfile:   'Participant Profile',
  bdComments:           'BD Comments',
  clientPocEmail:       'Client POC Email ID',
  clientPocDesignation: 'Client POC Designation',
  additionalPocs:       'Additional Client POCs',   // JSON list of { name, email, phone, designation }
};
const TOTAL_COST_COL = 'Total Cost of Proposal';
const bdExtraRead = r => ({
  ...Object.fromEntries(Object.entries(BD_EXTRA_COLUMNS).map(([k, col]) => [k, String(firstFilled(r, col) ?? '')])),
  totalCost: String(firstFilled(r, TOTAL_COST_COL) ?? ''),
});
// Only the keys the row actually carries are sent. A key that is left out reaches the flow as
// null, and "Update a row" then leaves that Excel cell unchanged — so no save path can blank
// these columns by accident. '' is sent only when a value was cleared on purpose.
const bdExtraSend = d => Object.fromEntries(Object.entries(BD_EXTRA_COLUMNS)
  .filter(([k]) => d?.[k] !== undefined)
  .map(([k, col]) => [col, d[k] == null ? '' : String(d[k])]));

async function callSolutionFlow(action, payload = {}) {
  return callFlow('SOLUTION_CRUD', { action, ...payload });
}

async function fetchSolutionTracker() {
  const data = await callSolutionFlow('get');
  const rows = (Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : []).map(withDecodedKeys);
  _lastSolutionRaw = rows;
  return rows.map((r, i) => ({
    id:                  i + 1,
    sno:                 getField(r, 'S No', 'S_No', 'SNo', 'sno') ?? i + 1,
    proposalId:          getField(r, 'Proposal ID', 'Proposal_ID', 'proposalId') ?? '',
    bdSNo:               getField(r, 'BD S No', 'BD_S_No', 'bdSNo') ?? '',
    solSNo:              getField(r, 'Sol S No', 'Sol_S_No', 'solSNo') ?? '',
    clientName:          getField(r, 'Client Name', 'Client_Name', 'clientName') ?? '',
    clientPoc:           getField(r, 'Client POC', 'Client_POC', 'clientPoc') ?? '',
    contactNumber:       getField(r, 'Contact Number', 'Contact_Number', 'contactNumber') ?? '',
    dateOfDiscussion:    formatDate(firstFilled(r, ...DISCUSSION_KEYS, 'dateOfDiscussion') ||
                           firstFilled(r, ...Object.keys(r).filter(k => looseKey(k).startsWith('dateofdiscu')))),
    internalTat:         getField(r, 'Internal TAT', 'Internal_TAT', 'internalTat') ?? '',
    clientExpectedDate:  formatDate(getField(r, 'Client Expt', 'Client_Expt', 'clientExpectedDate')),
    // Excel turns typed text like "Oct 2026" into a date serial (46296) — show it as "Oct 2026" again
    bdMonth:             monthLabel(getField(r, 'BD Month', 'BD_Month', 'bdMonth'), firstFilled(r, ...DISCUSSION_KEYS)),
    programTopic:        getField(r, 'Program Topic', 'Program_Topic', 'programTopic') ?? '',
    proposalVersion:     getField(r, 'Proposal Version', 'Proposal_Version', 'proposalVersion') ?? '',
    bdStatus:            getField(r, 'BD Status', 'BD_Status', 'bdStatus') ?? '',
    bdProposalValue:     getField(r, 'BD Proposal Value', 'BD_Proposal_Value', 'bdProposalValue') ?? '',
    solutionTopic:       getField(r, 'Solution Topic', 'Solution_Topic', 'solutionTopic') ?? '',
    solutionMonth:       monthLabel(getField(r, 'Solution Month', 'Solution_Month', 'solutionMonth')),
    programType:         getField(r, 'Program Type', 'Program_Type', 'programType') ?? '',
    engagementType:      getField(r, 'Engagement Type', 'Engagement_Type', 'engagementType') ?? '',
    lineOfService:       getField(r, 'Line of Service', 'Line_of_Service', 'lineOfService') ?? '',
    typeOfService:       getField(r, 'Type of Service', 'Type_of_Service', 'typeOfService') ?? '',
    developmentCategory: getField(r, 'Development Category', 'Development_Category', 'developmentCategory') ?? '',
    industry:            getField(r, 'Industry', 'industry', 'Industry / Sector', 'Sector') ?? '',
    solutionValue:       getField(r, 'Solution Value', 'Solution_Value', 'solutionValue') ?? '',
    status:              getField(r, 'Status', 'status') ?? '',
    remarks:             getField(r, 'Remarks', 'remarks') ?? '',
    proposalV1Link:      getField(r, 'Proposal V1 Link2', 'Proposal_V1_Link', 'proposalV1Link') ?? '',
    submissionBySolTeam: formatDate(getField(r, 'Date of Submission by Sol team', 'Date_of_Submission_by_Sol_team', 'submissionBySolTeam')),
    submissionToClient:  formatDate(firstFilled(r, ...SUBMISSION_KEYS, 'submissionToClient') ||
                           firstFilled(r, ...Object.keys(r).filter(k => /^dateofsubmission(toclient|erteam)/.test(looseKey(k))))),
    // Ticked by the BD person (In Process or Won) — what Operations must arrange
    opsChecklist:        getField(r, 'Ops Checklist', 'Ops_Checklist', 'opsChecklist') ?? '',
    // Headcount, batches, price per batch, total cost, participant profile, comments, POC details
    ...bdExtraRead(r),
  })).filter(r => r.proposalId);
}

export async function addSolutionRow(rowData) {
  // Columns omitted here are auto-generated by Excel formulas:
  //   SNo, BD S No, Sol S No, Internal TAT, Date of Submission by Sol team
  return callSolutionFlow('create', {
    'Proposal ID':                      rowData.proposalId          || '',
    'Client Name':                      rowData.clientName          || '',
    'Client POC':                       rowData.clientPoc           || '',
    'Contact Number':                   rowData.contactNumber       || '',
    ...discussionFields(rowData.dateOfDiscussion),
    'Client Expt':                      rowData.clientExpectedDate  || '',
    'BD Month':                         rowData.bdMonth             || '',
    'Program Topic':                    rowData.programTopic        || '',
    'Proposal Version':                 rowData.proposalVersion     || '',
    'BD Status':                        rowData.bdStatus            || '',
    'BD Proposal Value':                rowData.bdProposalValue     || '',
    'Solution Topic':                   rowData.solutionTopic       || '',
    'Solution Month':                   rowData.solutionMonth       || '',
    'Program Type':                     rowData.programType         || '',
    'Engagement Type':                  rowData.engagementType      || '',
    'Line of Service':                  rowData.lineOfService       || '',
    'Type of Service':                  rowData.typeOfService       || '',
    'Development Category':             rowData.developmentCategory || '',
    'Solution Value':                   rowData.solutionValue       || '',
    'Status':                           rowData.status              || '',
    'Remarks':                          rowData.remarks             || '',
    'Proposal V1 Link2':                rowData.proposalV1Link      || '',
    ...submissionFields(rowData.submissionToClient),
    'Ops Checklist':                    rowData.opsChecklist        || '',
    ...bdExtraSend(rowData),   // new BD columns (never "Total Cost of Proposal" — Excel formula)
  });
}

export async function updateSolutionRow(sno, rowData) {
  // Columns omitted here are auto-generated by Excel formulas:
  //   SNo, BD S No, Sol S No, Internal TAT, Date of Submission by Sol team
  // sno MUST be sent as a string — PA's int() expression cannot parse a JSON number type.
  return callSolutionFlow('update', {
    sno: String(sno),
    'Proposal ID':                      rowData.proposalId          || '',
    'Client Name':                      rowData.clientName          || '',
    'Client POC':                       rowData.clientPoc           || '',
    'Contact Number':                   rowData.contactNumber       || '',
    ...discussionFields(rowData.dateOfDiscussion),
    'Client Expt':                      rowData.clientExpectedDate  || '',
    'BD Month':                         rowData.bdMonth             || '',
    'Program Topic':                    rowData.programTopic        || '',
    'Proposal Version':                 rowData.proposalVersion     || '',
    'BD Status':                        rowData.bdStatus            || '',
    'BD Proposal Value':                rowData.bdProposalValue     || '',
    'Solution Topic':                   rowData.solutionTopic       || '',
    'Solution Month':                   rowData.solutionMonth       || '',
    'Program Type':                     rowData.programType         || '',
    'Engagement Type':                  rowData.engagementType      || '',
    'Line of Service':                  rowData.lineOfService       || '',
    'Type of Service':                  rowData.typeOfService       || '',
    'Development Category':             rowData.developmentCategory || '',
    'Solution Value':                   rowData.solutionValue       || '',
    'Status':                           rowData.status              || '',
    'Remarks':                          rowData.remarks             || '',
    'Proposal V1 Link2':                rowData.proposalV1Link      || '',
    ...submissionFields(rowData.submissionToClient),
    'Ops Checklist':                    rowData.opsChecklist        || '',
    ...bdExtraSend(rowData),   // new BD columns (never "Total Cost of Proposal" — Excel formula)
  });
}

/**
 * After a save, reads the Solution Tracker again and returns the date fields
 * that did NOT come back with the value just saved. The flow answers "OK" even
 * when it drops a field it doesn't map, so this is the only way to notice.
 * Excel Online can lag a moment, so one re-check is made before reporting.
 * @returns {Promise<string[]>} labels of the dates that didn't save ([] = all fine)
 */
export async function checkSolutionDates(proposalId, proposalVersion, expected) {
  const FIELDS = [['dateOfDiscussion', 'Date of Discussion'], ['submissionToClient', 'Date of Submission to Client']];
  const want = FIELDS.filter(([k]) => String(expected?.[k] || '').trim());
  if (!want.length || !proposalId) return [];
  const ver = v => { const m = String(v ?? '').match(/(\d+)/); return m ? Number(m[1]) : 1; };
  const check = async () => {
    const rows = await fetchSolutionTracker();
    const mine = rows.filter(r => r.proposalId === proposalId && ver(r.proposalVersion) === ver(proposalVersion));
    if (!mine.length) return [];                       // row not visible yet — nothing to compare
    return want.filter(([k]) => !mine.some(r => r[k] === String(expected[k]).slice(0, 10))).map(([, label]) => label);
  };
  let bad = await check();
  if (bad.length) { await new Promise(res => setTimeout(res, 2500)); bad = await check(); }
  if (bad.length) {
    // Show the real date columns Excel returned for this proposal, so a header mismatch is obvious
    const raw = _lastSolutionRaw.filter(r => String(firstFilled(r, 'Proposal ID', 'Proposal_ID')).trim() === proposalId);
    const cols = {};
    raw.forEach(r => Object.entries(r).forEach(([k, v]) => { if (isDateCol(k) && !(k in cols)) cols[k] = v; }));
    console.warn('[BD Tracker] Date not kept', { proposalId, sent: { dateOfDiscussion: expected.dateOfDiscussion, submissionToClient: expected.submissionToClient }, excelDateColumns: cols });
    bad.columns = Object.keys(cols);
  }
  return bad;
}

export async function deleteSolutionRow(sno) {
  return callSolutionFlow('delete', { sno: String(sno) });
}

// ─── Utilities ───────────────────────────────────────────────────────────────
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Month column value → "Oct 2026".
 *  - Excel date serial (46296, or "46296")  → "Oct 2026"
 *  - ISO date ("2026-10-01…")               → "Oct 2026"
 *  - text without a year ("Sept") + a discussion date in the same month → "Sep 2026"
 *  - anything else                          → unchanged text
 */
export function monthLabel(raw, fallbackDate) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const iso = formatDate(s);                      // handles serials and ISO strings
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && (/^\d+(\.\d+)?$/.test(s) || /^\d{4}-\d{2}/.test(s))) {
    return `${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  }
  if (!/(19|20)\d{2}/.test(s) && fallbackDate) {
    const d = formatDate(fallbackDate);
    const mi = MON3.findIndex(m => s.toLowerCase().startsWith(m.toLowerCase()));
    if (/^\d{4}-\d{2}/.test(d) && mi >= 0 && Number(d.slice(5, 7)) === mi + 1) return `${MON3[mi]} ${d.slice(0, 4)}`;
  }
  return s;
}

/**
 * Convert any date value from Power Automate "List rows" to a YYYY-MM-DD string.
 *
 * PA's "List rows" ALWAYS returns dates as Excel serial numbers — even when
 * "DateTime Format" is set to ISO 8601 on the "Add a row" action.  The serial
 * arrives as a JS number (e.g. 46273) OR as a numeric string (e.g. "46273").
 *
 * Edge cases handled:
 *  - null / undefined / '' / 0 / negative  → ''   (empty / corrupt cell)
 *  - numeric string  "46273"               → '2026-09-08'
 *  - negative string "-5" / "0"            → ''   (PA bug: blank date cell
 *                                                   that was written as 0)
 *  - ISO string "2026-09-08"               → '2026-09-08' (pass-through)
 */
function formatDate(val) {
  if (val === null || val === undefined || val === '') return '';
  const s = String(val).trim();
  if (!s) return '';
  const num = Number(s);
  if (!isNaN(num)) {
    if (num <= 0) return '';       // corrupt / truly-empty Excel date cell
    if (num > 25000) {             // valid Excel serial (any date after 1969)
      const date = new Date(Math.round((num - 25569) * 86400 * 1000));
      return isNaN(date) ? '' : date.toISOString().slice(0, 10);
    }
    return '';                     // tiny positive serial — not a real date
  }
  // Already a string date like '2026-09-08T...' or '2026-09-08'
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Typed text dates: 26/10/2026, 26-10-2026, 26.10.26 (day first, as used in India), 26-Oct-2026, 26 Oct 2026
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const y4 = y => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const ok = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));   // rejects 31/02 etc.
    return y >= 2000 && y <= 2099 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  };
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) return ok(y4(m[3]), Number(m[2]), Number(m[1])) || s.slice(0, 10);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3})[A-Za-z]*\.?[\s\-/,]+(\d{2}|\d{4})$/);
  if (m && MON[m[2].toLowerCase()]) return ok(y4(m[3]), MON[m[2].toLowerCase()], Number(m[1])) || s.slice(0, 10);
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MON[m[1].toLowerCase()]) return ok(Number(m[3]), MON[m[1].toLowerCase()], Number(m[2])) || s.slice(0, 10);
  return s.slice(0, 10);
}

/** Money cell → number. Handles numbers and text such as "1,50,000", "₹ 50,000", "Rs. 12,500/-". Blank / text → 0. */
function toAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const n = Number(String(val).replace(/rs\.?|inr|₹|\/-|,|\s/gi, ''));
  return Number.isFinite(n) ? n : 0;
}

function sanitiseLocation(val) {
  if (!val) return 'VILT';
  const s = String(val).trim();
  if (!s || s === '#VALUE!' || s === 'null') return 'VILT';
  return s;
}


// ─── Instant display for tracker pages (stale-while-revalidate) ─────────────
// Every successful load is remembered (memory + browser copy, 24h). Pages show
// the remembered rows immediately and swap in fresh rows when they arrive.
const _listMem = new Map();
const LIST_STORE_PREFIX = 'ercrm.list.v1.';
const LIST_MAX_AGE_MS   = 24 * 60 * 60 * 1000;
const LIST_MAX_CHARS    = 1500000;          // skip the browser copy for very large lists

// Rows deleted / added in this browser in the last minute. Excel Online takes a
// moment to reflect a write, so a read straight after a delete can still return
// the deleted row (and one straight after an add can miss the new row). These
// keep the remembered lists right until Excel catches up.
const RECENT_WRITE_MS = 60 * 1000;
const _recentDeletes = new Map();   // list name → Map(Index → ts)
const _recentAdds    = new Map();   // list name → Map(Index → { ts, row })
const _normKey = v => String(v ?? '').replace(/\s+/g, ' ').trim();
function _recent(map, name) {
  const m = map.get(name) || new Map(); map.set(name, m);
  const now = Date.now();
  for (const [k, v] of m) if (now - (typeof v === 'number' ? v : v.ts) > RECENT_WRITE_MS) m.delete(k);
  return m;
}
function applyRecentWrites(name, rows) {
  const dels = _recent(_recentDeletes, name);
  const adds = _recent(_recentAdds, name);
  let out = dels.size ? rows.filter(r => !dels.has(_normKey(r.engagementKey))) : rows;
  if (adds.size) {
    const have = new Set(out.map(r => _normKey(r.engagementKey)));
    for (const [k, v] of adds) {
      if (have.has(k)) adds.delete(k);          // Excel has caught up
      else out = [...out, v.row];
    }
  }
  return out;
}
const _listListeners = new Set();
/** Subscribe to changes of the remembered lists. Returns an unsubscribe fn. */
export function onListChange(fn) { _listListeners.add(fn); return () => _listListeners.delete(fn); }

/** Call after a tracker row is deleted, so it disappears everywhere straight away. */
export function forgetListRow(name, engagementKey) {
  const key = _normKey(engagementKey);
  if (!key) return;
  _recent(_recentDeletes, name).set(key, Date.now());
  _recent(_recentAdds, name).delete(key);
  const cur = peekList(name);
  if (cur) rememberList(name, cur);
}

/** Call after a tracker row is added, so it shows as added everywhere straight away. */
export function rememberListRow(name, row) {
  const key = _normKey(row?.engagementKey);
  if (!key) return;
  _recent(_recentDeletes, name).delete(key);
  _recent(_recentAdds, name).set(key, { ts: Date.now(), row });
  rememberList(name, peekList(name) || []);
}

function rememberList(name, rows) {
  rows = applyRecentWrites(name, rows);
  _listMem.set(name, rows);
  _listListeners.forEach(fn => { try { fn(name); } catch { /* ignore */ } });
  try {
    const json = JSON.stringify({ ts: Date.now(), rows });
    if (json.length < LIST_MAX_CHARS) localStorage.setItem(LIST_STORE_PREFIX + name, json);
  } catch { /* storage full / blocked — memory copy still works */ }
  return rows;
}

/** Last loaded rows for 'ops' | 'cdt' | 'solution' | 'bd' — or null. Never hits the network. */
export function peekList(name) {
  if (_listMem.has(name)) return _listMem.get(name);
  try {
    const v = JSON.parse(localStorage.getItem(LIST_STORE_PREFIX + name) || 'null');
    if (v && Array.isArray(v.rows) && Date.now() - v.ts < LIST_MAX_AGE_MS) {
      _listMem.set(name, v.rows);
      return v.rows;
    }
  } catch { /* ignore */ }
  return null;
}

export async function getOpsChecklist()      { return rememberList('ops',      await withReadRetry(fetchOpsChecklist)); }
/** Straight read from Excel — no remembered copy, no recent-write patching. Used to confirm a write landed. */
export async function readTrackerFresh(name) {
  return name === 'ops' ? fetchOpsChecklist() : fetchContentDevTracker();
}
export async function getContentDevTracker() { return rememberList('cdt',      await withReadRetry(fetchContentDevTracker)); }
export async function getSolutionTracker()   { return rememberList('solution', await withReadRetry(fetchSolutionTracker)); }

// Shared helpers for the Lead and Vendor Service trackers (src/services/leadsVendorsApi.js)
export { callFlow as _callFlow, getField as _getField, formatDate as _formatDate, withReadRetry as _withReadRetry, rememberList as _rememberList, withDecodedKeys as _withDecodedKeys };
