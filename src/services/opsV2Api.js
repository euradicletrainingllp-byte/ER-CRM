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
// null = the table does not exist in Excel (remembered 24 h; force: true checks again).
// A flow failure (502 NoResponse, timeout) is NOT "missing": the last rows read in this browser are
// returned with rows.stale = true (or the error is thrown when none), so saved rows never vanish and
// new IDs are never re-used.  (2026-11-24: a 502 used to hide the Travel Desk for 24 h.)
const MISSING_KEY = t => `ercrm:ops-v2:missing:${t}`;
const LAST_KEY = t => `ercrm:ops-v2:last:${t}`;
const NOT_FOUND = /table.*(not (be )?found|does ?n[o']t exist)|ItemNotFound|InvalidTable|No table/i;
const _probe = {};
const readLast = t => { try { const v = JSON.parse(localStorage.getItem(LAST_KEY(t)) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
export function opsListOptional(t, { force = false } = {}) {
  const k = MISSING_KEY(t);
  if (force) { delete _probe[t]; try { localStorage.removeItem(k); } catch { /* ignore */ } }
  if (!force) { try { if (Date.now() - Number(localStorage.getItem(k) || 0) < 864e5) return Promise.resolve(null); } catch { /* ignore */ } }
  const key = OPS_V2_TABLES[t]?.key;
  return (_probe[t] ||= opsList(t, { retries: 1 })
    .then(rows => {
      const out = key ? rows.filter(r => String(r[key] ?? '').trim()) : rows;   // skip Excel's empty first row
      try { localStorage.removeItem(k); localStorage.setItem(LAST_KEY(t), JSON.stringify(out)); } catch { /* ignore */ }
      delete _probe[t];
      return out;
    })
    .catch(e => {
      delete _probe[t];
      if (NOT_FOUND.test(String(e?.message || e))) { try { localStorage.setItem(k, String(Date.now())); } catch { /* ignore */ } return null; }
      const last = readLast(t);
      if (!last) throw e;
      const out = [...last]; out.stale = String(e?.message || e); return out;
    }));
}

/** Rows whose key value appears more than once (Excel "Delete/Update a row" fails on these). */
export const duplicateKeys = (t, rows) => {
  const key = OPS_V2_TABLES[t]?.key; const seen = new Map();
  for (const r of rows || []) { const v = String(r?.[key] ?? '').trim(); if (v) seen.set(v, (seen.get(v) || 0) + 1); }
  return [...seen].filter(([, n]) => n > 1).map(([v]) => v);
};
