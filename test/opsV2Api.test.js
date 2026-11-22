import { it, expect, vi } from 'vitest';
import FLOW_URLS from '../src/config/powerAutomate';
import { opsList, opsUpdate, opsCreate } from '../src/services/opsV2Api';

it('uses OPS_V2_CRUD with table/key and drops calculated columns', async () => {
  FLOW_URLS.OPS_V2_CRUD = 'https://example.test/ops';
  const calls = [];
  global.fetch = vi.fn(async (u, o) => { calls.push([u, JSON.parse(o.body)]);
    const body = JSON.parse(o.body).action === 'get' ? '[{"TaskID":"T-00001","@odata.etag":"x"}]' : '{"ok":true}';
    return { ok: true, status: 200, text: async () => body }; });
  expect(await opsList('tasks')).toEqual([{ TaskID: 'T-00001' }]);
  await opsUpdate('tasks', 'T-00001', { Status: 'Done', 'On Time': 'Yes' });
  expect(calls[1]).toEqual(['https://example.test/ops', { action: 'update', table: 'OpsTaskTable', keyColumn: 'TaskID', keyValue: 'T-00001', row: { Status: 'Done' } }]);
});

it('translates dotted column names (EG.ID ↔ EG_x002e_ID)', async () => {
  FLOW_URLS.OPS_V2_CRUD = 'https://example.test/ops';
  const calls = [];
  global.fetch = vi.fn(async (u, o) => { calls.push(JSON.parse(o.body));
    const body = JSON.parse(o.body).action === 'get' ? '[{"EC Index":"7","EG_x002e_ID":"EG.ID 9"}]' : '{"ok":true}';
    return { ok: true, status: 200, text: async () => body }; });
  expect(await opsList('engagements')).toEqual([{ 'EC Index': '7', 'EG.ID': 'EG.ID 9' }]);
  await opsCreate('engagements', { 'EC Index': '8', 'EG.ID': 'EG.ID 10', Mode: 'Virtual' });
  expect(calls[1].row).toEqual({ 'EC Index': '8', 'EG_x002e_ID': 'EG.ID 10' });
});
