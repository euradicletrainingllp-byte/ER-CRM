/**
 * EURADICLE CRM — PO TRACKER (data layer)
 * ER_Engagement_Master workbook → sheet "PO Tracker" → table POTable, key "PO ID" (PO-001…).
 * Flow PO_CRUD (same pattern as Consultants): Row = removeProperty(removeProperty(triggerBody(),'action'),'sno').
 * One PO can cover several engagements: "Engagement Index" holds EC Index values "580; 581".
 * Used = Σ Price (INR) of the linked engagements (excl. GST, same basis as PO Value); Balance = PO Value − Used.
 */
import FLOW_URLS from '../config/powerAutomate.js';
import { _callFlow as callFlow, _getField as getField, _formatDate as formatDate, _withReadRetry as withReadRetry,
  _rememberList as rememberList, _withDecodedKeys as withDecodedKeys, peekList } from './api.js';

const txt = v => String(v ?? '').trim();
const variants = h => [h, h.replace(/ /g, '_'), h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]/g, '')];
const numOrBlank = v => { const s = txt(v).replace(/[^0-9.-]/g, ''); return s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : ''); };

export const PO_COLS = {
  poId: 'PO ID', poNumber: 'PO Number', client: 'Client', poDate: 'PO Date', receivedDate: 'PO Received Date', proposalId: 'Proposal ID',
  scope: 'Description / Scope', value: 'PO Value (INR)', gstIncluded: 'GST Included', validFrom: 'Valid From', validTo: 'Valid To',
  indexes: 'Engagement Index', used: 'Used Amount (INR)', balance: 'Balance (INR)', status: 'Status', link: 'PO Link',
  spoc: 'Client SPOC', remarks: 'Remarks', createdBy: 'Created By',
};
const DATES = new Set(['poDate', 'receivedDate', 'validFrom', 'validTo']);
const NUMS = new Set(['value', 'used', 'balance']);
export const PO_STATUS = ['Active', 'Fully Used', 'Expired', 'Closed'];

export const splitIdx = v => [...new Set(txt(v).split(/\s*[;,\n]\s*/).map(txt).filter(Boolean))];

function readRow(raw) {
  const r = withDecodedKeys(raw), out = {};
  for (const [k, h] of Object.entries(PO_COLS)) { const v = getField(r, ...variants(h)); out[k] = DATES.has(k) ? formatDate(v) : NUMS.has(k) ? numOrBlank(v) : txt(v); }
  out.sno = out.poId;
  return out;
}
function toBody(p, { create }) {
  const body = {};
  for (const [k, h] of Object.entries(PO_COLS)) {
    let v = k === 'indexes' ? splitIdx(p[k]).join('; ') : p[k];
    v = v == null ? '' : v;
    if (create && DATES.has(k) && !v) continue;
    body[h] = typeof v === 'number' ? v : String(v);
  }
  return body;
}
const rowsOf = d => (Array.isArray(d?.value) ? d.value : Array.isArray(d) ? d : []);

export const poConfigured = () => !!FLOW_URLS.PO_CRUD;
export const nextPoId = rows => `PO-${String(Math.max(0, ...rows.map(r => Number(String(r.poId || '').replace(/\D/g, '')) || 0)) + 1).padStart(3, '0')}`;
async function fetchPOs() { return rowsOf(await callFlow('PO_CRUD', { action: 'get' })).map(readRow).filter(r => r.poId || r.poNumber); }
export async function getPOs() { return rememberList('po', await withReadRetry(fetchPOs)); }
export const peekPOs = () => peekList('po');
export const addPO = p => callFlow('PO_CRUD', { action: 'create', sno: p.poId, ...toBody(p, { create: true }) });
export const updatePO = p => {
  if (!txt(p.poId)) throw new Error('This PO has no PO ID in Excel. Type one (e.g. PO-012) in its PO ID cell, then Refresh.');
  return callFlow('PO_CRUD', { action: 'update', sno: p.poId, ...toBody(p, { create: false }) });
};
export const deletePO = id => callFlow('PO_CRUD', { action: 'delete', sno: id });

/** Links typed in the PO Link cell — several allowed, separated by a comma, semicolon, space or new line. */
export const splitLinks = v => [...new Set(txt(v).split(/[\s,;]+/).map(txt).filter(Boolean))].map(u => (/^https?:\/\//i.test(u) ? u : `https://${u}`));

/**
 * Live usage from the Engagement Calendar (cancelled / lost rows not counted).
 *   used    = Price of linked engagements marked Delivered
 *   booked  = Price of linked engagements not yet Delivered
 *   balance = PO value − used − booked (what is still free to allocate)
 */
export function poUsage(po, ecRows) {
  const ids = splitIdx(po.indexes);
  const rows = ids.map(i => (ecRows || []).find(e => String(e.engagementKey) === i)).filter(Boolean);
  const live = rows.filter(e => !/cancel|lost|drop/i.test(String(e.status || '')));
  const isDone = e => /deliver|complet/i.test(String(e.status || ''));
  const sum = l => l.reduce((s, e) => s + (Number(e.price) || 0), 0);
  const used = sum(live.filter(isDone)), booked = sum(live.filter(e => !isDone(e)));
  const value = Number(po.value) || 0;
  const p = n => (value ? Math.min(999, Math.round((n / value) * 100)) : 0);
  return { ids, rows, missing: ids.filter(i => !rows.some(e => String(e.engagementKey) === i)), used, booked, committed: used + booked,
    balance: value - used - booked, pct: p(used), bookedPct: p(booked), committedPct: p(used + booked) };
}
/** Shown status: Expired / Fully Used worked out from dates and usage unless Closed. Fully Used = delivered engagements cover the PO value. */
export function poStatus(po, u, today = new Date().toISOString().slice(0, 10)) {
  if (po.status === 'Closed') return 'Closed';
  if (u && Number(po.value) > 0 && u.used >= Number(po.value)) return 'Fully Used';
  if (po.validTo && po.validTo < today) return 'Expired';
  return po.status || 'Active';
}
