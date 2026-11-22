import { describe, it, expect, vi, beforeEach } from 'vitest';
import FLOW_URLS from '../src/config/powerAutomate';
import { fetchPermissions, savePermissions } from '../src/services/permissionsApi';

let table, calls;
beforeEach(() => {
  FLOW_URLS.ADMIN_CRUD = 'https://example.test/flow';
  calls = [];
  table = [
    { Email: 'a@x.com', Name: 'A', BDRead: 'True', BDCreate: 'False', '@odata.etag': '', ItemInternalId: '1' },
    { Email: 'gone@x.com', Name: 'G', BDRead: 'True', BDCreate: 'False' },
  ];
  global.fetch = vi.fn(async (url, opt) => {
    const b = JSON.parse(opt.body); calls.push(b);
    const body = b.action === 'get' ? JSON.stringify(table) : '{"ok":true}';
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  });
});

describe('generic admin CRUD', () => {
  it('reads permissions via table name', async () => {
    const p = await fetchPermissions();
    expect(calls[0]).toEqual({ action: 'get', table: 'PermissionsTable' });
    expect(p['a@x.com'].crud.bd.read).toBe(true);
  });
  it('saves only diffs: update, create, delete', async () => {
    await savePermissions({
      'a@x.com': { name: 'A', crud: { bd: { create: true, read: true } } },
      'new@x.com': { name: 'N', crud: { bd: { read: true } } },
    });
    const w = calls.filter(c => c.action !== 'get');
    const up = w.find(c => c.action === 'update');
    expect(up).toMatchObject({ keyColumn: 'Email', keyValue: 'a@x.com', row: { BDCreate: 'true' } });
    expect(Object.keys(up.row)).toEqual(['BDCreate']);
    const cr = w.find(c => c.action === 'create');
    expect(Object.keys(cr.row).sort()).toEqual(['BDCreate', 'BDRead', 'Email', 'Name']);
    expect(w.find(c => c.action === 'delete')).toMatchObject({ keyValue: 'gone@x.com' });
    expect(w).toHaveLength(3);
  });
});
