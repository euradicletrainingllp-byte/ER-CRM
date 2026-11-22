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
};
// Calculated in Excel — never written by the CRM.
export const OPS_V2_CALC = {
  engagements: ['Mode', 'Tasks Applicable', 'Tasks Done', 'Progress %', 'Overdue Tasks', 'Next Due Date'],
  tasks: ['Actual Days', 'Delay (days)', 'On Time'],
};

export const isOpsV2Ready = () => String(FLOW_URLS[FLOW] || '').startsWith('http');

const cfg = t => { const c = OPS_V2_TABLES[t]; if (!c) throw new Error(`Unknown ops table: ${t}`); return c; };
const strip = (t, row) => {
  const out = { ...row };
  for (const k of OPS_V2_CALC[t] || []) delete out[k];
  return out;
};

export async function opsList(t, { retries = 1 } = {}) {
  const data = await crudPost(FLOW, { action: 'get', table: cfg(t).table }, 90_000, retries);
  return (Array.isArray(data) ? data : (data?.value || [])).map(clean);
}
export const opsCreate = (t, row) => crudPost(FLOW, { action: 'create', table: cfg(t).table, row: strip(t, row) });
export const opsUpdate = (t, keyValue, row) => {
  const { table, key } = cfg(t);
  return crudPost(FLOW, { action: 'update', table, keyColumn: key, keyValue: String(keyValue), row: strip(t, row) });
};
export const opsDelete = (t, keyValue) => {
  const { table, key } = cfg(t);
  return crudPost(FLOW, { action: 'delete', table, keyColumn: key, keyValue: String(keyValue) });
};
