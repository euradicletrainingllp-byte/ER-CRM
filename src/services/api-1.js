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
    sno:         getField(r, 'S.No', 'S_No', 'sno') ?? i + 1,
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
  return callBDFlow('update', { rowId: sno, 'S.No': updates['S.No'] ?? sno, ...updates });
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
export async function getEngagements(filters = {}) {
  const data = await callFlow('GET_ENGAGEMENTS', filters);
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];

  return rows.map((r, i) => {
    // PA renames 'EG.ID' — try every known variant
    const egId = getField(r,
      'EG.ID', 'EG_ID', 'EGID', 'EG__ID', 'egId', 'eg_id', 'EgId'
    ) ?? `EG.ID ${i + 1}`;

    return {
      id: i + 1,
      egId: String(egId),
      sno:  getField(r, 'S.No', 'S_No', 'sno') ?? i + 1,
      company:     getField(r, 'Company', 'company') ?? '',
      // PA may trim leading space from ' Start Date'
      startDate:   formatDate(getField(r, ' Start Date', 'Start Date', 'StartDate', 'Start_Date', 'startDate')),
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
      invoice:     getField(r, 'Invoice ', 'Invoice', 'invoice') ?? '',
      price:       Number(getField(r, 'Price (INR)', 'Price__INR_', 'Price_INR_', 'price') ?? 0) || 0,
      travelExpenses: Number(getField(r, 'Travel, Stay and Misc. Expenses', 'travelExpenses') ?? 0) || 0,
    };
  }).filter(r => r.company); // only require company — egId always has a fallback
}

export async function addEngagementRow(rowData) {
  return callFlow('ADD_ENGAGEMENT_ROW', {
    'EG.ID': rowData.egId,
    'Company': rowData.company,
    ' Start Date': rowData.startDate,
    'End Date': rowData.endDate,
    'Topic ': rowData.topic,
    'Sector': rowData.sector,
    'Service Type': rowData.serviceType,
    'Day': rowData.day,
    'Location': rowData.location,
    'Consultant - 1': rowData.consultant1,
    'Status': rowData.status,
    'Price (INR)': rowData.price,
  });
}

export async function updateEngagementRow(egId, sno, updates) {
  return callFlow('UPDATE_ENGAGEMENT_ROW', { egId, sno, ...updates });
}

export async function deleteEngagementRow(egId, sno) {
  return callFlow('DELETE_ENGAGEMENT_ROW', { egId, sno });
}

// ─── OPS CHECKLIST ───────────────────────────────────────────────────────────
export async function getOpsChecklist() {
  const data = await callFlow('GET_OPS_CHECKLIST');
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];
  return rows.map((r, i) => ({
    sno:     getField(r, 'S.No', 'S_No', 'sno') ?? i + 1,
    egId:    getField(r, 'EG.ID', 'EG_ID', 'EGID', 'egId') ?? '',
    company: getField(r, 'Company', 'company') ?? '',
    clientSpoc: getField(r, 'Client SPOC', 'Client_SPOC', 'clientSpoc') ?? '',
    startDate: formatDate(getField(r,
      'Engagement Start Date (MM/DD/YY)',
      'Engagement_Start_Date__MM_DD_YY_',
      'startDate')),
    topic:    getField(r, 'Topic', 'topic') ?? '',
    participantListReceived: getField(r, 'Participant List Received', 'Participant_List_Received') ?? '',
    noOfParticipants: Number(getField(r, 'No of Paticipants', 'No_of_Paticipants', 'noOfParticipants') ?? 0) || 0,
    day:      Number(getField(r, 'Day', 'day') ?? 0) || 0,
    venue:    getField(r, 'Venue', 'venue') ?? '',
    location: getField(r, 'Location', 'location') ?? '',
    consultant1: getField(r, 'Consultant - 1', 'Consultant_1', 'Consultant___1', 'consultant1') ?? '',
    consultant2: getField(r, 'Consultant - 2', 'Consultant_2', 'Consultant___2', 'consultant2') ?? '',
    status:   getField(r, 'Status', 'status') ?? '',
    contract: getField(r, 'Contract', 'contract') ?? '',
    poStatus: getField(r, 'PO Status', 'PO_Status', 'POStatus', 'poStatus') ?? '',
    checklist: {
      calendarBlock:    getField(r, 'Facilitator Calendar Block', 'Facilitator_Calendar_Block') ?? '',
      travelDetails:    getField(r, 'Travel Details Finalised', 'Travel_Details_Finalised') ?? '',
      welcomeEmail:     getField(r, 'Welcome Email(Pre Work & Training Program) - Sent',
                                    'Welcome_Email_Pre_Work___Training_Program____Sent') ?? '',
      preWork:          getField(r, 'Pre Work Details:', 'Pre_Work_Details_') ?? '',
      evAndPm:          getField(r, 'Sharing EV & PM with Consultant', 'Sharing_EV___PM_with_Consultant') ?? '',
      bootcamp:         getField(r, 'Bootcamp  Finalised', 'Bootcamp_Finalised', 'Bootcamp__Finalised') ?? '',
      teachback:        getField(r, 'Teachback  Finalised', 'Teachback_Finalised', 'Teachback__Finalised') ?? '',
      electronicVisuals: getField(r, 'Electronic Visuals(EV) + Feedback QR',
                                     'Electronic_Visuals_EV____Feedback_QR') ?? '',
      participantManual: getField(r, 'Participant Manual(PM)- Hardcopy/ Editable',
                                     'Participant_Manual_PM___Hardcopy__Editable') ?? '',
      attendanceSheet:  getField(r, 'Attendance Sheet/LAB Sheet & Photos',
                                    'Attendance_Sheet_LAB_Sheet___Photos') ?? '',
      feedbackReport:   getField(r, 'Feedback Report', 'Feedback_Report') ?? '',
      impactReport:     getField(r, 'Impact Report', 'Impact_Report') ?? '',
      socialMedia:      getField(r, 'Social Media Post', 'Social_Media_Post') ?? '',
    }
  })).filter(r => r.company);
}

export async function updateOpsRow(sno, field, value) {
  return callFlow('UPDATE_OPS_ROW', { sno, field, value });
}

export async function addOpsRow(rowData) {
  return callFlow('ADD_OPS_ROW', {
    'EG.ID':                                  rowData.egId            || '',
    'Company':                                rowData.company         || '',
    'Client SPOC':                            rowData.clientSpoc      || '',
    'Engagement Start Date (MM/DD/YY)':       rowData.startDate       || '',
    'Topic':                                  rowData.topic           || '',
    'Participant List Received':              rowData.participantListReceived || '',
    'No of Paticipants':                      Number(rowData.noOfParticipants) || 0,
    'Day':                                    Number(rowData.day)     || 0,
    'Venue':                                  rowData.venue           || '',
    'Location':                               rowData.location        || '',
    'Consultant - 1':                         rowData.consultant1     || '',
    'Consultant - 2':                         rowData.consultant2     || '',
    'Status':                                 rowData.status          || 'Scheduled',
    'Contract':                               rowData.contract        || '',
    'PO Status':                              rowData.poStatus        || '',
  });
}

export async function updateOpsSession(sno, rowData) {
  return callFlow('UPDATE_OPS_SESSION', {
    sno,
    'EG.ID':                                  rowData.egId            || '',
    'Company':                                rowData.company         || '',
    'Client SPOC':                            rowData.clientSpoc      || '',
    'Engagement Start Date (MM/DD/YY)':       rowData.startDate       || '',
    'Topic':                                  rowData.topic           || '',
    'Participant List Received':              rowData.participantListReceived || '',
    'No of Paticipants':                      Number(rowData.noOfParticipants) || 0,
    'Day':                                    Number(rowData.day)     || 0,
    'Venue':                                  rowData.venue           || '',
    'Location':                               rowData.location        || '',
    'Consultant - 1':                         rowData.consultant1     || '',
    'Consultant - 2':                         rowData.consultant2     || '',
    'Status':                                 rowData.status          || '',
    'Contract':                               rowData.contract        || '',
    'PO Status':                              rowData.poStatus        || '',
  });
}

export async function deleteOpsRow(sno) {
  return callFlow('DELETE_OPS_ROW', { sno });
}

// ─── SOLUTIONING TRACKER ─────────────────────────────────────────────────────
export async function getSolutioningTracker() {
  const data = await callFlow('GET_SOLUTIONING');
  const rows = Array.isArray(data?.value) ? data.value
             : Array.isArray(data)        ? data
             : [];
  return rows.map((r, i) => ({
    id:             i + 1,
    sno:            getField(r, 'SNo', 'sno') ?? i + 1,
    client:         getField(r, 'Client', 'client') ?? '',
    startDate:      formatDate(getField(r, 'Program Start Date', 'Program_Start_Date', 'startDate')),
    endDate:        formatDate(getField(r, 'End Date ', 'End Date', 'End_Date', 'endDate')),
    programType:    getField(r, 'Program Type', 'Program_Type', 'programType') ?? '',
    evRequired:     getField(r, 'EV Required', 'EV_Required', 'evRequired') ?? '',
    poc:            getField(r, 'POC', 'poc') ?? '',
    dueDate:        formatDate(getField(r, 'Due Date', 'Due_Date', 'dueDate')),
    completionDate: formatDate(getField(r, 'Completion Date', 'Completion_Date', 'completionDate')),
    pmRequired:     getField(r, 'PM Required', 'PM_Required', 'pmRequired') ?? '',
  })).filter(r => r.client);
}

export async function addSolutioningRow(rowData) {
  return callFlow('ADD_SOLUTIONING_ROW', {
    'Client':               rowData.client         || '',
    'Program Start Date':   rowData.startDate      || '',
    'End Date ':            rowData.endDate        || '',
    'Program Type':         rowData.programType    || '',
    'EV Required':          rowData.evRequired     || '',
    'POC':                  rowData.poc            || '',
    'Due Date':             rowData.dueDate        || '',
    'Completion Date':      rowData.completionDate || '',
    'PM Required':          rowData.pmRequired     || '',
  });
}

export async function updateSolutioningRow(sno, rowData) {
  return callFlow('UPDATE_SOLUTIONING_ROW', {
    sno,
    'Client':               rowData.client         || '',
    'Program Start Date':   rowData.startDate      || '',
    'End Date ':            rowData.endDate        || '',
    'Program Type':         rowData.programType    || '',
    'EV Required':          rowData.evRequired     || '',
    'POC':                  rowData.poc            || '',
    'Due Date':             rowData.dueDate        || '',
    'Completion Date':      rowData.completionDate || '',
    'PM Required':          rowData.pmRequired     || '',
  });
}

export async function deleteSolutioningRow(sno) {
  return callFlow('DELETE_SOLUTIONING_ROW', { sno });
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function formatDate(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

function sanitiseLocation(val) {
  if (!val) return 'VILT';
  const s = String(val).trim();
  if (!s || s === '#VALUE!' || s === 'null') return 'VILT';
  return s;
}
