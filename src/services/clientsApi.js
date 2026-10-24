/**
 * EURADICLE CRM — CLIENT DIRECTORY (data layer)
 * ==============================================
 * ONE Excel file (Client_Directory.xlsx) with FIVE tables, served by ONE
 * Power Automate flow (CLIENTS_CRUD). Every call says which table it is for:
 *
 *   { action: get | create | update | delete, table: 'ClientTable', sno: <record ID>, ...exact headers }
 *
 * The flow picks the key column from the table name (Key map compose) and writes
 * the whole body as the row:
 *   removeProperty(removeProperty(removeProperty(triggerBody(),'action'),'sno'),'table')
 * so the body holds ONLY 'action', 'table', 'sno' and exact Excel headers.
 *
 *   Table             Key column          IDs        One row per
 *   ClientTable       Client ID           CL-001     client organisation
 *   ContactTable      Contact ID          CT-0001    person at a client
 *   ProgramTable      Program Record ID   AP-001     program / PO per client
 *   ActionTable       Action ID           AC-0001    follow-up action
 *   InteractionTable  Interaction ID      INT-0001   call / meeting / email
 *
 * Child tables carry both Client ID and Client Name. The CRM always writes both.
 */
import FLOW_URLS from '../config/powerAutomate.js';
import { _callFlow as callFlow, _getField as getField, _formatDate as formatDate, _withReadRetry as withReadRetry,
  _rememberList as rememberList, _withDecodedKeys as withDecodedKeys, peekList } from './api.js';

const txt = v => String(v ?? '').trim();
const variants = h => [h, h.replace(/ /g, '_'), h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]/g, ''),
  h.replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()];
const numOrBlank = v => { const s = txt(v).replace(/[^0-9.-]/g, ''); return s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : ''); };

/* ─── Table schemas: CRM key → exact Excel header (same order as the workbook) ─── */
export const TABLES = {
  clients: {
    table: 'ClientTable', idKey: 'clientId', prefix: 'CL-', pad: 3,
    cols: {
      clientId: 'Client ID', name: 'Client Name', legalName: 'Legal / Billing Entity Name', parentGroup: 'Parent Group',
      businessUnit: 'Business Unit / Division', clientType: 'Client Type', tier: 'Account Tier',
      industry: 'Industry', subIndustry: 'Sub-Industry / Segment', orgType: 'Organisation Type', employeeSize: 'Employee Size',
      hqCity: 'HQ City', locations: 'Delivery Locations', geography: 'Geography', countries: 'Countries Covered',
      website: 'Website', linkedin: 'LinkedIn Page', context: 'Company Context',
      owner: 'EuRadicle Account Owner', secondaryOwner: 'Secondary Owner', relStatus: 'Relationship Status',
      health: 'Relationship Health', clientSince: 'Client Since (Year)', lastEngagement: 'Last Engagement Date',
      howAcquired: 'How Acquired', needs: 'Key Business Needs', delivered: 'Programs Delivered', activePrograms: 'Active Programs',
      opportunities: 'Open Opportunities', potential: 'Potential Revenue (₹)',
      contractBasis: 'Contract Basis', contractStatus: 'Contract / SOW Status', contractStart: 'Contract Start Date',
      contractEnd: 'Contract End Date', contractLink: 'Contract / SOW Link', nda: 'NDA Signed', vendorReg: 'Vendor Registration',
      dayRate: 'Standard Day Rate (₹)', commercialNotes: 'Commercial Notes', tsPolicy: 'T&S Policy', tsNotes: 'T&S Notes',
      payDays: 'Payment Terms (Days)', payBasis: 'Payment Terms Basis', poRequired: 'PO Required', portal: 'Invoice Portal',
      invoiceContact: 'Invoice Contact', invoiceNotes: 'Invoice Process Notes', gstin: 'GSTIN', billingAddress: 'Billing Address',
      payStatus: 'Payment Status', outstanding: 'Outstanding Amount (₹)', outstandingAsOf: 'Outstanding As Of',
      deliveryMode: 'Preferred Delivery Mode', platform: 'Preferred Platform', feedbackProcess: 'Feedback Process',
      feedbackThreshold: 'Feedback Threshold', facilitatorPrefs: 'Facilitator Preferences', branding: 'Branding & Compliance Notes',
      playbook: 'Operating Playbook',
      lastInteraction: 'Last Interaction Date', nextFollowUp: 'Next Follow-up Date', nextAction: 'Next Action',
      folderLink: 'Account Folder Link', comments: 'Overall Comments', dataNotes: 'Data Source / Verification Notes',
      createdBy: 'Created By', createdOn: 'Created On', updatedBy: 'Last Updated By', updatedOn: 'Last Updated On',
    },
    dates: ['lastEngagement', 'contractStart', 'contractEnd', 'outstandingAsOf', 'lastInteraction', 'nextFollowUp', 'createdOn', 'updatedOn'],
    nums: ['clientSince', 'potential', 'dayRate', 'payDays', 'outstanding'],
  },
  contacts: {
    table: 'ContactTable', idKey: 'contactId', prefix: 'CT-', pad: 4,
    cols: {
      contactId: 'Contact ID', clientId: 'Client ID', clientName: 'Client Name', fullName: 'Full Name', designation: 'Designation',
      role: 'Role in Account', department: 'Department / Function', reportsTo: 'Reports To', decisionRole: 'Decision Role',
      email: 'Email', mobile: 'Mobile', altPhone: 'Alternate Phone', location: 'Location', linkedin: 'LinkedIn',
      primary: 'Primary Contact', status: 'Contact Status', strength: 'Relationship Strength', lastContacted: 'Last Contacted',
      notes: 'Responsibilities / Working Notes', portalNote: 'Portal Access Note', createdBy: 'Created By', updatedOn: 'Last Updated On',
    },
    dates: ['lastContacted', 'updatedOn'], nums: [],
  },
  programs: {
    table: 'ProgramTable', idKey: 'programId', prefix: 'AP-', pad: 3,
    cols: {
      programId: 'Program Record ID', clientId: 'Client ID', clientName: 'Client Name', program: 'Program Name', type: 'Program Type',
      audience: 'Audience / Level', fy: 'Financial Year', status: 'Status', batchesContracted: 'Batches Contracted',
      batchesDelivered: 'Batches Delivered', participants: 'Participants Covered', feeBasis: 'Fee Basis', feeRate: 'Fee Rate (₹)',
      tsTerms: 'T&S Terms', poRef: 'PO / SOW Reference', poValue: 'PO Value (₹)', facilitators: 'Facilitators / Coaches',
      clientOwner: 'Client Owner', erOwner: 'EuRadicle Owner', nextMilestone: 'Next Milestone', feedback: 'Avg Feedback',
      proposalId: 'BD Proposal ID', notes: 'Key Notes', updatedOn: 'Last Updated On',
    },
    dates: ['updatedOn'], nums: ['batchesContracted', 'batchesDelivered', 'participants', 'feeRate', 'poValue', 'feedback'],
  },
  actions: {
    table: 'ActionTable', idKey: 'actionId', prefix: 'AC-', pad: 4,
    cols: {
      actionId: 'Action ID', clientId: 'Client ID', clientName: 'Client Name', action: 'Action', ownerContact: 'Owner / Contact',
      erOwner: 'EuRadicle Owner', due: 'Due Date', timing: 'Timing Note', status: 'Status', priority: 'Priority',
      context: 'Context', createdOn: 'Created On', closedOn: 'Closed On',
    },
    dates: ['due', 'createdOn', 'closedOn'], nums: [],
  },
  interactions: {
    table: 'InteractionTable', idKey: 'interactionId', prefix: 'INT-', pad: 4,
    cols: {
      interactionId: 'Interaction ID', clientId: 'Client ID', clientName: 'Client Name', date: 'Date', type: 'Interaction Type',
      erAttendees: 'EuRadicle Attendees', clientAttendees: 'Client Attendees', summary: 'Summary', outcome: 'Outcome / Decisions',
      nextStep: 'Next Step', nextFollowUp: 'Next Follow-up Date', loggedBy: 'Logged By',
    },
    dates: ['date', 'nextFollowUp'], nums: [],
  },
};

/** Client fields shown / edited / exported only for admins and Finance viewers. */
export const CLIENT_MONEY_KEYS = ['potential', 'dayRate', 'commercialNotes', 'tsPolicy', 'tsNotes', 'payDays', 'payBasis', 'poRequired',
  'portal', 'invoiceContact', 'invoiceNotes', 'gstin', 'billingAddress', 'payStatus', 'outstanding', 'outstandingAsOf'];
export const PROGRAM_MONEY_KEYS = ['feeBasis', 'feeRate', 'tsTerms', 'poRef', 'poValue'];

export const emptyRecord = kind => Object.fromEntries(Object.keys(TABLES[kind].cols).map(k => [k, '']));

function readRow(kind, raw) {
  const t = TABLES[kind];
  const r = withDecodedKeys(raw);
  const out = {};
  for (const [k, h] of Object.entries(t.cols)) {
    const v = getField(r, ...variants(h));
    out[k] = t.dates.includes(k) ? formatDate(v) : t.nums.includes(k) ? numOrBlank(v) : txt(v);
  }
  out.sno = out[t.idKey];
  return out;
}

/** CRM record → Excel body (exact headers only). Empty dates are left out on create. */
function toBody(kind, rec, { create }) {
  const t = TABLES[kind];
  const body = {};
  for (const [k, h] of Object.entries(t.cols)) {
    let v = rec[k];
    v = v == null ? '' : v;
    if (create && t.dates.includes(k) && !v) continue;
    if (t.nums.includes(k) && v !== '' && Number.isFinite(Number(v))) v = Number(v);
    body[h] = typeof v === 'number' ? v : String(v);
  }
  return body;
}

const rowsOf = data => (Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : []);

export function nextId(kind, rows) {
  const t = TABLES[kind];
  const max = Math.max(0, ...rows.map(r => Number(String(r[t.idKey] || '').replace(/\D/g, '')) || 0));
  return `${t.prefix}${String(max + 1).padStart(t.pad, '0')}`;
}

export const clientsConfigured = () => !!FLOW_URLS.CLIENTS_CRUD;

async function fetchTable(kind) {
  const t = TABLES[kind];
  const data = await callFlow('CLIENTS_CRUD', { action: 'get', table: t.table });
  // Skip blank template rows (no ID and no name)
  return rowsOf(data).map(r => readRow(kind, r)).filter(r => r[t.idKey] || r.name || r.fullName || r.program || r.action || r.summary);
}

/** Reads all five tables in parallel. A child table that fails to load comes back empty with a warning. */
export async function getClientDirectory() {
  const kinds = Object.keys(TABLES);
  const res = await Promise.allSettled(kinds.map(k => withReadRetry(() => fetchTable(k))));
  if (res[0].status === 'rejected') throw res[0].reason;                // no clients → page error
  const out = { warnings: [] };
  kinds.forEach((k, i) => {
    if (res[i].status === 'fulfilled') out[k] = res[i].value;
    else { out[k] = peekList(`client-dir:${k}`) || []; out.warnings.push(`${TABLES[k].table}: ${res[i].reason?.message || res[i].reason}`); }
    rememberList(`client-dir:${k}`, out[k]);
  });
  return out;
}
export function peekClientDirectory() {
  const clients = peekList('client-dir:clients');
  if (!clients) return null;
  const out = { warnings: [] };
  for (const k of Object.keys(TABLES)) out[k] = peekList(`client-dir:${k}`) || [];
  return out;
}

export async function addRecord(kind, rec) {
  const t = TABLES[kind];
  return callFlow('CLIENTS_CRUD', { action: 'create', table: t.table, sno: rec[t.idKey], ...toBody(kind, rec, { create: true }) });
}
export async function updateRecord(kind, rec) {
  const t = TABLES[kind];
  if (!txt(rec[t.idKey])) throw new Error(`This record has no ${t.cols[t.idKey]} in Excel, so it cannot be saved. Type an ID in its ${t.cols[t.idKey]} cell, then Refresh.`);
  return callFlow('CLIENTS_CRUD', { action: 'update', table: t.table, sno: rec[t.idKey], ...toBody(kind, rec, { create: false }) });
}
export async function deleteRecord(kind, id) {
  return callFlow('CLIENTS_CRUD', { action: 'delete', table: TABLES[kind].table, sno: id });
}

/* ─── Helpers shared by the page ─── */
const DAY = 86400000;
const todayUtc = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); };
export function daysFromToday(iso) {
  if (!iso) return '';
  const d = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  return isNaN(d) ? '' : Math.round((d - todayUtc()) / DAY);
}
export const isOpenAction = a => ['Open', 'In progress', ''].includes(txt(a.status));
