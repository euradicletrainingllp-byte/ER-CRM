import { it, expect, vi } from 'vitest';
import FLOW_URLS from '../src/config/powerAutomate';
import { opsList, opsUpdate } from '../src/services/opsV2Api';

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
