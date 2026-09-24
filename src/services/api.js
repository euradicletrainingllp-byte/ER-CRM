/**
 * EURADICLE CRM — API SERVICE
 * All Power Automate HTTP calls go through here.
 */

import FLOW_URLS from '../config/powerAutomate.js';

// ─── Core caller ─────────────────────────────────────────────────────────────
async function callFlow(flowKey, body = {}) {
  const url = FLOW_URLS[flowKey];
  if (!url) throw new Error(`FLOW_NOT_CONFIGURED:${flowKey}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Flow ${flowKey} failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (response.status === 202 || !contentType.includes('application/json')) {
    return { success: true };
  }
  return response.json();
}

// Helper: get a field trying multiple key variants (PA renames special chars)
function getField(r, ...keys) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

// ─── BD TRACKER ──────────────────────────────────────────────────────────────
// All 4 operations go to the single BD_TRACKER_CRUD flow URL.
// The flow switches internally on the `action` field.

async function callBDFlow(action, payload = {}) {
  return callFlow('BD_TRACKER_CRUD', { action, ...payload });
}

export async function getBDTracker() {
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

export async function getEngagements(filters = {}) {
  const data = await callEngagementFlow('get', filters);
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];

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
      consultant1: getField(r, 'Consultant - 1', 'Consultant_1', 'Consultant___1', 'consultant1') ?? '',
      consultant2: getField(r, 'Consultant - 2', 'Consultant_2', 'Consultant___2', 'consultant2') ?? '',
      consultant3: getField(r, 'Consultant - 3', 'Consultant_3', 'Consultant___3', 'consultant3') ?? '',
      status:      getField(r, 'Status', 'status') ?? '',
      contract:    getField(r, 'Contract', 'contract') ?? '',
      poStatus:    getField(r, 'PO Status', 'PO_Status', 'POStatus', 'poStatus') ?? '',
      invoice:        formatDate(getField(r, 'Invoice ', 'Invoice', 'invoice')),
      price:          Number(getField(r, 'Price (INR)', 'Price__INR_', 'Price_INR_', 'price') ?? 0) || 0,
      travelExpenses: Number(getField(r, 'Travel, Stay and Misc Expenses', 'Travel, Stay and Misc. Expenses', 'travelExpenses') ?? 0) || 0,
      gst:            Number(getField(r, 'GST', 'gst') ?? 0) || 0,
      payment:        getField(r, 'Payment', 'payment') ?? '',
      amountReceived: getField(r, 'Amount Received', 'Amount_Received', 'amountReceived') ?? '',
      receivedDate:   formatDate(getField(r, 'Received Date', 'ReceivedDate', 'Received_Date', 'receivedDate')),
      comments:       getField(r, 'Comments ', 'Comments', 'comments') ?? '',
      feedback:       getField(r, 'Feedback ', 'Feedback', 'feedback') ?? '',
      nps:            getField(r, 'NPS', 'nps') ?? '',
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
  return cachedRead('all', () => getEngagements(), force);
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
  return callEngagementFlow('create', {
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
    contract:                          rowData.contract       || '',
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
  }).then(notifyEcChanged);
}

export async function updateEngagementRow(egId, sno, updates) {
  // The flow's "Update a row" Key Value must never be empty — PA fails with
  // "parameters are invalid, they may not be null or empty: 'id'" (HTTP 502).
  const key = sno == null ? '' : String(sno).trim();
  if (!key) {
    throw new Error(`Cannot update engagement ${egId || ''}: its S No is blank in Excel. Fill in the S No cell for this row and refresh.`);
  }
  // The flow's Key Column is 'SNo' and its Key Value reads triggerBody()?['SNo']
  // (case-sensitive). 'SNo' also feeds the item/SNo cell, so it must carry the
  // real value or the S No cell would be blanked. rowId / sno kept as fallbacks.
  invalidateEngagementCache();
  return callEngagementFlow('update', { ...updates, SNo: key, rowId: key, sno: key }).then(notifyEcChanged);
}

export async function deleteEngagementRow(egId, sno) {
  invalidateEngagementCache();
  return callEngagementFlow('delete', { egId, sno }).then(notifyEcChanged);
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
  return s;
};

async function fetchOpsChecklist() {
  const data = await callOpsFlow('get');
  const rows = Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];
  return rows.map((r, i) => ({
    sno:             getField(r,'S No','S.No','S_No','sno') ?? i + 1,
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
  })).filter(r => r.company);
}

const OPS_FIELD_MAP = {
  sno:'S No',
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
};

export async function updateOpsRow(sno, changes) {
  const excelFields = {};
  for (const [k, v] of Object.entries(changes)) {
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
  return callOpsFlow('update', { rowId: sno, ...excelFields });
}

export async function addOpsRow(form) {
  const excelFields = {};
  for (const [k, v] of Object.entries(form)) {
    if (v !== undefined && v !== '') excelFields[OPS_FIELD_MAP[k] || k] = v;
  }
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

export async function deleteOpsRow(sno) {
  return callOpsFlow('delete', { rowId: sno });
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
  })).filter(r => r.client);
}

export async function addContentDevRow(rowData) {
  // Non-date fields always sent.
  // Date fields ONLY sent when non-empty — omitting a key means PA skips that
  // Excel cell entirely, so no corrupt serial is written regardless of the
  // flow's "DateTime Format" setting.
  const body = {
    'Client':       rowData.client      || '',
    'Program Type': rowData.programType || '',
    'EV Required':  rowData.evRequired  || '',
    'POC':          rowData.poc         || '',
    'PM Required':  rowData.pmRequired  || '',
  };
  // sno is optional — passed by syncCDTWithEC so the Excel row gets the correct
  // S No from the Engagement Calendar instead of auto-incrementing.
  if (rowData.sno != null && rowData.sno !== '') body['SNo'] = rowData.sno;
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
  return callContentDevFlow('create', body);
}

export async function updateContentDevRow(sno, rowData) {
  return callContentDevFlow('update', {
    sno,
    'SNo':             sno,                         // keep SNo cell in sync with the key
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
  });
}

export async function deleteContentDevRow(sno) {
  return callContentDevFlow('delete', { sno });
}

// ─── SOLUTION TRACKER (BD + Solution combined) ───────────────────────────────
async function callSolutionFlow(action, payload = {}) {
  return callFlow('SOLUTION_CRUD', { action, ...payload });
}

async function fetchSolutionTracker() {
  const data = await callSolutionFlow('get');
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];
  return rows.map((r, i) => ({
    id:                  i + 1,
    sno:                 getField(r, 'S No', 'S_No', 'SNo', 'sno') ?? i + 1,
    proposalId:          getField(r, 'Proposal ID', 'Proposal_ID', 'proposalId') ?? '',
    bdSNo:               getField(r, 'BD S No', 'BD_S_No', 'bdSNo') ?? '',
    solSNo:              getField(r, 'Sol S No', 'Sol_S_No', 'solSNo') ?? '',
    clientName:          getField(r, 'Client Name', 'Client_Name', 'clientName') ?? '',
    clientPoc:           getField(r, 'Client POC', 'Client_POC', 'clientPoc') ?? '',
    contactNumber:       getField(r, 'Contact Number', 'Contact_Number', 'contactNumber') ?? '',
    dateOfDiscussion:    formatDate(getField(r, 'Date of Discussion', 'Date_of_Discusssion', 'dateOfDiscussion')),
    internalTat:         getField(r, 'Internal TAT', 'Internal_TAT', 'internalTat') ?? '',
    clientExpectedDate:  formatDate(getField(r, 'Client Expt', 'Client_Expt', 'clientExpectedDate')),
    bdMonth:             getField(r, 'BD Month', 'BD_Month', 'bdMonth') ?? '',
    programTopic:        getField(r, 'Program Topic', 'Program_Topic', 'programTopic') ?? '',
    proposalVersion:     getField(r, 'Proposal Version', 'Proposal_Version', 'proposalVersion') ?? '',
    bdStatus:            getField(r, 'BD Status', 'BD_Status', 'bdStatus') ?? '',
    bdProposalValue:     getField(r, 'BD Proposal Value', 'BD_Proposal_Value', 'bdProposalValue') ?? '',
    solutionTopic:       getField(r, 'Solution Topic', 'Solution_Topic', 'solutionTopic') ?? '',
    solutionMonth:       getField(r, 'Solution Month', 'Solution_Month', 'solutionMonth') ?? '',
    programType:         getField(r, 'Program Type', 'Program_Type', 'programType') ?? '',
    engagementType:      getField(r, 'Engagement Type', 'Engagement_Type', 'engagementType') ?? '',
    lineOfService:       getField(r, 'Line of Service', 'Line_of_Service', 'lineOfService') ?? '',
    typeOfService:       getField(r, 'Type of Service', 'Type_of_Service', 'typeOfService') ?? '',
    developmentCategory: getField(r, 'Development Category', 'Development_Category', 'developmentCategory') ?? '',
    solutionValue:       getField(r, 'Solution Value', 'Solution_Value', 'solutionValue') ?? '',
    status:              getField(r, 'Status', 'status') ?? '',
    remarks:             getField(r, 'Remarks', 'remarks') ?? '',
    proposalV1Link:      getField(r, 'Proposal V1 Link2', 'Proposal_V1_Link', 'proposalV1Link') ?? '',
    submissionBySolTeam: formatDate(getField(r, 'Date of Submission by Sol team', 'Date_of_Submission_by_Sol_team', 'submissionBySolTeam')),
    submissionToClient:  formatDate(getField(r, 'Date of Submission to Client', 'Date of submission ER Team4', 'Date_of_submission_ER_Team4', 'submissionToClient')),
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
    'Date of Discusssion':              rowData.dateOfDiscussion    || '',
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
    'Date of Submission to Client':      rowData.submissionToClient  || '',
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
    'Date of Discusssion':              rowData.dateOfDiscussion    || '',
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
    'Date of Submission to Client':      rowData.submissionToClient  || '',
  });
}

export async function deleteSolutionRow(sno) {
  return callSolutionFlow('delete', { sno: String(sno) });
}

// ─── Utilities ───────────────────────────────────────────────────────────────
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
  return s.slice(0, 10);
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

function rememberList(name, rows) {
  _listMem.set(name, rows);
  try {
    const json = JSON.stringify({ ts: Date.now(), rows });
    if (json.length < LIST_MAX_CHARS) localStorage.setItem(LIST_STORE_PREFIX + name, json);
  } catch { /* storage full / blocked — memory copy still works */ }
  return rows;
}

/** Last loaded rows for 'ops' | 'cdt' | 'solution' — or null. Never hits the network. */
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
export async function getContentDevTracker() { return rememberList('cdt',      await withReadRetry(fetchContentDevTracker)); }
export async function getSolutionTracker()   { return rememberList('solution', await withReadRetry(fetchSolutionTracker)); }
