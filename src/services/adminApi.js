/**
 * adminApi.js — generic CRUD for every table in "Admin Panel.xlsx"
 * through ONE Power Automate flow (FLOW_URLS.ADMIN_CRUD).
 *
 * Body sent: { action, table, keyColumn, keyValue, row }
 * Adding a new admin table = create the Excel Table + add it to ADMIN_TABLES.
 * No flow change needed. Row keys must match the Excel headers exactly.
 * Flow guide: project doc claude/flow-admin-crud-generic.md
 */
import FLOW_URLS from '../config/powerAutomate';

/** Registry of admin tables: Excel table name + its unique key column. */
export const ADMIN_TABLES = {
  permissions:   { table: 'PermissionsTable',      key: 'Email' },
  departments:   { table: 'DepartmentTable',       key: 'DeptID' },     // DeptID, Department, Description, Head Email, Active
  deptMembers:   { table: 'DeptMemberTable',       key: 'MemberID' },   // MemberID, Email, Name, DeptID, Department, Is Primary, Added On (one row per user × department)
  features:      { table: 'FeatureFlagTable',      key: 'FeatureKey' },
  notifications: { table: 'NotificationRuleTable', key: 'RuleID' },
  settings:      { table: 'SettingsTable',         key: 'Key' },
};

export const isAdminCrudReady = () => String(FLOW_URLS.ADMIN_CRUD || '').startsWith('http');

const cfg = t => {
  const c = typeof t === 'string' ? ADMIN_TABLES[t] : t;
  if (!c?.table) throw new Error(`Unknown admin table: ${t}`);
  return c;
};

const post = body => crudPost('ADMIN_CRUD', body);

/** Generic-CRUD caller shared by every workbook flow that uses the
 *  { action, table, keyColumn, keyValue, row } contract. */
export async function crudPost(flowKey, body, timeoutMs = 90_000, retries = 1) {
  const url = String(FLOW_URLS[flowKey] || '');
  if (!url.startsWith('http')) throw new Error(`FLOW_NOT_CONFIGURED:${flowKey}`);
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 502 && attempt < retries) { await new Promise(r => setTimeout(r, 3000)); continue; }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${flowKey}: ${body.action} on ${body.table} failed: ${res.status}${text ? ' — ' + text.slice(0, 200) : ''}`);
      }
      const text = await res.text();
      try { return text ? JSON.parse(text) : null; } catch { return text; }
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries && err.name === 'AbortError') { await new Promise(r => setTimeout(r, 3000)); continue; }
      if (err.name === 'AbortError') throw new Error(`Request timed out — ${flowKey} flow is taking too long`);
      throw err;
    }
  }
}

export const clean = r => {
  const o = {};
  for (const [k, v] of Object.entries(r || {})) if (!k.startsWith('@odata') && k !== 'ItemInternalId') o[k] = v;
  return o;
};

export async function adminList(t) {
  const { table } = cfg(t);
  const data = await post({ action: 'get', table });
  const list = Array.isArray(data) ? data : (data?.value || []);
  return list.map(clean);
}

export const adminCreate = (t, row) => post({ action: 'create', table: cfg(t).table, row });

export function adminUpdate(t, keyValue, row) {
  const { table, key } = cfg(t);
  return post({ action: 'update', table, keyColumn: key, keyValue: String(keyValue), row });
}

export function adminDelete(t, keyValue) {
  const { table, key } = cfg(t);
  return post({ action: 'delete', table, keyColumn: key, keyValue: String(keyValue) });
}

/** Run async jobs with limited parallelism (Excel connector dislikes bursts). */
export async function runLimited(jobs, limit = 3) {
  const out = []; let i = 0;
  const worker = async () => { while (i < jobs.length) { const n = i++; out[n] = await jobs[n](); } };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}
