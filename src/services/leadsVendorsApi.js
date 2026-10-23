/**
 * EURADICLE CRM — LEAD TRACKER + VENDOR SERVICE TRACKER (data layer)
 * ==================================================================
 * Same pattern as the other trackers: one Power Automate CRUD flow per Excel table,
 * called through callFlow() so every write lands in the activity log (and the
 * create / delete emails). Each row has a permanent ID set by the CRM
 * ("Lead ID" = LD-0001…, "Service ID" = VS-0001…) — the flows find rows by it.
 *
 * Lead actions (who did what, status after, comment) are stored as a JSON list
 * in one "Actions" cell, like the Content Dev work items.
 */
import { _callFlow as callFlow, _getField as getField, _formatDate as formatDate, _withReadRetry as withReadRetry,
  _rememberList as rememberList, _withDecodedKeys as withDecodedKeys } from './api.js';

const txt = v => String(v ?? '').trim();
const numOrBlank = v => { const s = txt(v).replace(/[^0-9.-]/g, ''); return s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : ''); };
// Excel header → keys Power Automate may return it under (spaces / dashes / dots encoded or replaced)
const variants = h => [h, h.replace(/ /g, '_'), h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]/g, '')];

function readRow(raw, cols, dates, nums) {
  const r = withDecodedKeys(raw);
  const out = {};
  for (const [k, h] of Object.entries(cols)) {
    const v = getField(r, ...variants(h));
    out[k] = dates.has(k) ? formatDate(v) : nums.has(k) ? numOrBlank(v) : txt(v);
  }
  return out;
}

/** CRM object → Excel body. Empty dates are left out on create (no bad serials). */
function toBody(obj, cols, dates, { create }) {
  const body = {};
  for (const [k, h] of Object.entries(cols)) {
    let v = obj[k];
    if (Array.isArray(v)) v = v.length ? JSON.stringify(v) : '';
    v = v == null ? '' : v;
    if (create && dates.has(k) && !v) continue;
    body[h] = typeof v === 'number' ? v : String(v);
  }
  return body;
}

function nextId(rows, key, prefix) {
  const max = Math.max(0, ...rows.map(r => Number(String(r[key] || '').replace(/\D/g, '')) || 0));
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function rowsOf(data) {
  return Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : [];
}

export function parseJsonList(raw) {
  if (Array.isArray(raw)) return raw;
  const s = txt(raw);
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []; }
  catch { return [{ id: 'a0', at: '', by: '', type: 'Note', status: '', comment: s, next: '' }]; }   // text typed in Excel is kept as one note
}

/* ═══ LEAD TRACKER ═══════════════════════════════════════════════════════ */
export const LEAD_COLS = {
  leadId: 'Lead ID', dateReceived: 'Date Received', source: 'Lead Source', sourceDetail: 'Source Detail', sharedBy: 'Shared By',
  company: 'Company', contactName: 'Contact Person', designation: 'Designation', email: 'Email', phone: 'Phone',
  requirement: 'Requirement', programInterest: 'Program Interest', owner: 'Lead Owner', status: 'Status', priority: 'Priority',
  nextFollowUp: 'Next Follow-up', estValue: 'Estimated Value', proposalId: 'BD Proposal ID', actions: 'Actions',
  comments: 'Comments', createdBy: 'Created By',
};
const LEAD_DATES = new Set(['dateReceived', 'nextFollowUp']);
const LEAD_NUMS = new Set(['estValue']);

async function fetchLeads() {
  const data = await callFlow('LEADS_CRUD', { action: 'get' });
  return rowsOf(data).map(raw => {
    const r = readRow(raw, LEAD_COLS, LEAD_DATES, LEAD_NUMS);
    return { ...r, sno: r.leadId, actions: parseJsonList(r.actions) };
  }).filter(r => r.leadId || r.company);
}
export async function getLeads() { return rememberList('leads', await withReadRetry(fetchLeads)); }
export const nextLeadId = rows => nextId(rows, 'leadId', 'LD-');

export async function addLead(lead) {
  const body = toBody(lead, LEAD_COLS, LEAD_DATES, { create: true });
  return callFlow('LEADS_CRUD', { action: 'create', sno: lead.leadId, ...body });
}
export async function updateLead(lead) {
  if (!txt(lead.leadId)) throw new Error('This lead has no Lead ID in Excel, so it cannot be saved. Type an ID (e.g. LD-0042) in its Lead ID cell, then Refresh.');
  const body = toBody(lead, LEAD_COLS, LEAD_DATES, { create: false });
  return callFlow('LEADS_CRUD', { action: 'update', sno: lead.leadId, ...body });
}
export async function deleteLead(leadId) {
  return callFlow('LEADS_CRUD', { action: 'delete', sno: leadId, 'Lead ID': leadId });
}

/* ═══ VENDOR SERVICE TRACKER ═════════════════════════════════════════════ */
export const VENDOR_COLS = {
  serviceId: 'Service ID', vendorName: 'Vendor Name', vendorContact: 'Vendor Contact', category: 'Service Category',
  description: 'Service Description', engagementKey: 'Engagement Index', egId: 'EG ID', client: 'Client', program: 'Program',
  serviceDate: 'Service Date', quantity: 'Quantity', unit: 'Unit', rate: 'Rate', amount: 'Amount', gst: 'GST', total: 'Total',
  requestedBy: 'Requested By', billable: 'Billable to Client', clientBilling: 'Client Billing Status', clientInvoiceRef: 'Client Invoice Ref',
  clientInvoiceDate: 'Client Invoice Date', vendorInvoiceNo: 'Vendor Invoice No', vendorInvoiceDate: 'Vendor Invoice Date',
  vendorInvoiceLink: 'Vendor Invoice Link', paymentStatus: 'Vendor Payment Status', paidAmount: 'Paid Amount', paidDate: 'Paid Date',
  comments: 'Comments', createdBy: 'Created By',
};
const VENDOR_DATES = new Set(['serviceDate', 'clientInvoiceDate', 'vendorInvoiceDate', 'paidDate']);
const VENDOR_NUMS = new Set(['quantity', 'rate', 'amount', 'gst', 'total', 'paidAmount']);

async function fetchVendorServices() {
  const data = await callFlow('VENDOR_CRUD', { action: 'get' });
  return rowsOf(data).map(raw => {
    const r = readRow(raw, VENDOR_COLS, VENDOR_DATES, VENDOR_NUMS);
    return { ...r, sno: r.serviceId };
  }).filter(r => r.serviceId || r.vendorName);
}
export async function getVendorServices() { return rememberList('vendors', await withReadRetry(fetchVendorServices)); }
export const nextServiceId = rows => nextId(rows, 'serviceId', 'VS-');

/** Amount = Quantity × Rate when both are given; Total = Amount + GST. */
export function vendorTotals(v) {
  const q = Number(v.quantity) || 0, rate = Number(v.rate) || 0;
  const amount = v.amount === '' || v.amount == null ? (q && rate ? q * rate : 0) : Number(v.amount) || 0;
  const total = amount + (Number(v.gst) || 0);
  return { amount, total };
}

export async function addVendorService(v) {
  const { amount, total } = vendorTotals(v);
  const body = toBody({ ...v, amount, total }, VENDOR_COLS, VENDOR_DATES, { create: true });
  return callFlow('VENDOR_CRUD', { action: 'create', sno: v.serviceId, ...body });
}
export async function updateVendorService(v) {
  if (!txt(v.serviceId)) throw new Error('This service has no Service ID in Excel, so it cannot be saved. Type an ID (e.g. VS-0042) in its Service ID cell, then Refresh.');
  const { amount, total } = vendorTotals(v);
  const body = toBody({ ...v, amount, total }, VENDOR_COLS, VENDOR_DATES, { create: false });
  return callFlow('VENDOR_CRUD', { action: 'update', sno: v.serviceId, ...body });
}
export async function deleteVendorService(serviceId) {
  return callFlow('VENDOR_CRUD', { action: 'delete', sno: serviceId, 'Service ID': serviceId });
}
