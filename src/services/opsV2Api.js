/**
 * opsV2Api.js — Operations Checklist v2 (Operations Checklist.xlsx)
 * via the generic CRUD flow FLOW_URLS.OPS_V2_CRUD.
 *   StepTable       key StepID   — step library (pre-defined steps)
 *   EngagementTable key EC Index — programs pulled from the Engagement Calendar
 *   OpsTaskTable    key TaskID   — one row per engagement × step
 * Design: project doc claude/ops-checklist-v2-design.md
 */
import FLOW_URLS from '../config/powerAutomate';
import { crudPost, clean } from './adminApi';

const FLOW = 'OPS_V2_CRUD';
export const OPS_V2_TABLES = {
  steps:       { table: 'StepTable',       key: 'StepID' },
  engagements: { table: 'EngagementTable', key: 'EC Index' },
  tasks:       { table: 'OpsTaskTable',    key: 'TaskID' },
  lists:       { table: 'ListTable',       key: 'ListID' },   // List, Value, Order, Active
  travel:      { table: 'TravelTable',     key: 'TripID' },   // Travel Desk (one row per trip)
};
// Calculated in Excel — never written by the CRM.
export const OPS_V2_CALC = {
  engagements: ['Mode', 'Tasks Applicable', 'Tasks Done', 'Progress %', 'Overdue Tasks', 'Next Due Date'],
  tasks: ['Actual Days', 'Delay (days)', 'On Time'],
  travel: ['Total Cost'],
};

export const isOpsV2Ready = () => String(FLOW_URLS[FLOW] || '').startsWith('http');

const cfg = t => { const c = OPS_V2_TABLES[t]; if (!c) throw new Error(`Unknown ops table: ${t}`); return c; };
// The Excel connector names a column with a dot by its encoded form ("EG.ID" → "EG_x002e_ID"):
// a write that uses "EG.ID" fails with 502, and reads return the encoded name. The CRM uses the
// plain names everywhere; this is the only place that translates.
export const decodeKey = k => String(k).replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
export const encodeKey = k => String(k).replace(/\./g, '_x002e_');
const decodeRow = r => Object.fromEntries(Object.entries(r).map(([k, v]) => [decodeKey(k), v]));
const strip = (t, row) => {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) if (!(OPS_V2_CALC[t] || []).includes(k)) out[encodeKey(k)] = v;
  return out;
};

export async function opsList(t, { retries = 1 } = {}) {
  const data = await crudPost(FLOW, { action: 'get', table: cfg(t).table }, 90_000, retries);
  return (Array.isArray(data) ? data : (data?.value || [])).map(clean).map(decodeRow);
}
export const opsCreate = (t, row) => crudPost(FLOW, { action: 'create', table: cfg(t).table, row: strip(t, row) });
export const opsUpdate = (t, keyValue, row) => {
  const { table, key } = cfg(t);
  return crudPost(FLOW, { action: 'update', table, keyColumn: encodeKey(key), keyValue: String(keyValue), row: strip(t, row) });
};
export const opsDelete = (t, keyValue) => {
  const { table, key } = cfg(t);
  return crudPost(FLOW, { action: 'delete', table, keyColumn: encodeKey(key), keyValue: String(keyValue) });
};

// ── Optional tables (ListTable, TravelTable) ────────────────────────────────
// Until a table exists in Excel the flow answers 502. The "missing" result is remembered in this
// browser for 24 h (no call, no console error on every load); force: true checks again.
const MISSING_KEY = t => `ercrm:ops-v2:missing:${t}`;
const _probe = {};
export function opsListOptional(t, { force = false } = {}) {
  const k = MISSING_KEY(t);
  if (force) { delete _probe[t]; try { localStorage.removeItem(k); } catch { /* ignore */ } }
  if (!force) { try { if (Date.now() - Number(localStorage.getItem(k) || 0) < 864e5) return Promise.resolve(null); } catch { /* ignore */ } }
  return (_probe[t] ||= opsList(t, { retries: 0 })
    .then(rows => { try { localStorage.removeItem(k); } catch { /* ignore */ } return rows; })
    .catch(() => { try { localStorage.setItem(k, String(Date.now())); } catch { /* ignore */ } delete _probe[t]; return null; }));
}
