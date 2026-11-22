/**
 * Live check of a generic CRUD flow ({ action, table, keyColumn, keyValue, row }).
 *   npm run test:flow -- ops      → OPS_V2_CRUD   (Operations Checklist.xlsx)
 *   npm run test:flow -- admin    → ADMIN_CRUD    (Admin Panel.xlsx)
 * URL is read from src/config/powerAutomate.js — paste it there first.
 * The ops run also does one safe write: changes Comments on the first task, reads it back, restores it.
 */
import { readFileSync } from 'node:fs';

const which = (process.argv[2] || 'ops').toLowerCase();
const SUITES = {
  ops: {
    key: 'OPS_V2_CRUD',
    tables: [['StepTable', 'StepID'], ['EngagementTable', 'EC Index'], ['OpsTaskTable', 'TaskID'], ['ListTable', 'ListID']],
    writeTest: { table: 'OpsTaskTable', keyColumn: 'TaskID', field: 'Comments' },
  },
  admin: {
    key: 'ADMIN_CRUD',
    tables: [['PermissionsTable', 'Email'], ['DepartmentTable', 'DeptID'], ['DeptMemberTable', 'MemberID']],
  },
};
const suite = SUITES[which];
if (!suite) { console.error(`Unknown suite "${which}". Use: ops | admin`); process.exit(1); }

const cfg = readFileSync(new URL('../src/config/powerAutomate.js', import.meta.url), 'utf8');
const url = (cfg.match(new RegExp(`${suite.key}\\s*:\\s*"([^"]*)"`)) || [])[1] || '';
if (!url.startsWith('http')) { console.error(`✗ ${suite.key} is empty in src/config/powerAutomate.js — paste the flow URL first.`); process.exit(1); }

let failed = 0;
const ok = m => console.log(`  ✓ ${m}`);
const bad = m => { failed++; console.log(`  ✗ ${m}`); };

async function call(body) {
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, ms: Date.now() - t0 };
}
const rowsOf = d => (Array.isArray(d) ? d : d?.value || []);

console.log(`\nTesting ${suite.key} …`);
const cache = {};
for (const [table, key] of suite.tables) {
  try {
    const r = await call({ action: 'get', table });
    if (r.status !== 200) { bad(`get ${table}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); continue; }
    const rows = rowsOf(r.data); cache[table] = rows;
    const cols = rows[0] ? Object.keys(rows[0]).filter(k => !k.startsWith('@odata') && k !== 'ItemInternalId') : [];
    if (rows.length && !cols.includes(key)) bad(`get ${table}: key column "${key}" not found (columns: ${cols.slice(0, 8).join(', ')}…)`);
    else ok(`get ${table}: ${rows.length} rows, ${cols.length} columns (${r.ms} ms)`);
  } catch (e) { bad(`get ${table}: ${e.message}`); }
}

try {
  const r = await call({ action: 'get', table: 'NoSuchTable' });
  r.status === 400 ? ok('unknown table rejected (400)') : console.log(`  ! unknown table returned HTTP ${r.status} — add the "Valid table" condition to the flow`);
} catch (e) { bad(`unknown table check: ${e.message}`); }
try {
  const r = await call({ action: 'nope', table: suite.tables[0][0] });
  r.status === 400 ? ok('unknown action rejected (400)') : console.log(`  ! unknown action returned HTTP ${r.status} — add a 400 Response in the Switch Default`);
} catch (e) { bad(`unknown action check: ${e.message}`); }

const w = suite.writeTest;
if (w && cache[w.table]?.length) {
  const first = cache[w.table].find(r => r[w.keyColumn]);
  const id = first[w.keyColumn]; const before = first[w.field] ?? '';
  const mark = `flow test ${new Date().toISOString()}`;
  try {
    let r = await call({ action: 'update', table: w.table, keyColumn: w.keyColumn, keyValue: String(id), row: { [w.field]: mark } });
    if (r.status !== 200) bad(`update ${id}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    else {
      r = await call({ action: 'get', table: w.table });
      const now = rowsOf(r.data).find(x => String(x[w.keyColumn]) === String(id));
      now?.[w.field] === mark ? ok(`update ${id}.${w.field} written and read back`) : bad(`update ${id}: value not found on read-back`);
      r = await call({ action: 'update', table: w.table, keyColumn: w.keyColumn, keyValue: String(id), row: { [w.field]: before } });
      r.status === 200 ? ok(`update ${id}.${w.field} restored`) : bad(`restore ${id}: HTTP ${r.status} — set ${w.field} back to "${before}" by hand`);
    }
  } catch (e) { bad(`update test: ${e.message}`); }
}

console.log(failed ? `\n${failed} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
