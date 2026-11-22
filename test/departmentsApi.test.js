import { describe, it, expect, vi, beforeEach } from 'vitest';
import FLOW_URLS from '../src/config/powerAutomate';
import { fetchDepartments, addMember, nextId, departmentsOf } from '../src/services/departmentsApi';

let calls;
beforeEach(() => {
  FLOW_URLS.ADMIN_CRUD = 'https://example.test/flow';
  calls = [];
  global.fetch = vi.fn(async (u, o) => {
    const b = JSON.parse(o.body); calls.push(b);
    const data = b.table === 'DepartmentTable'
      ? [{ DeptID: 'DEP-01', Department: 'Finance', Active: 'True' }, { DeptID: '', Department: '' }]
      : [{ MemberID: 'DM-001', Email: 'A@x.com', DeptID: 'DEP-01', 'Is Primary': true }, { MemberID: 'DM-002', Email: 'a@x.com', DeptID: 'DEP-02', 'Is Primary': 'False' }];
    const body = b.action === 'get' ? JSON.stringify(data) : '{"ok":true}';
    return { ok: true, status: 200, text: async () => body };
  });
});

describe('departments', () => {
  it('loads departments and multi-department members', async () => {
    const r = await fetchDepartments();
    expect(r.departments).toEqual([{ id: 'DEP-01', name: 'Finance', description: '', head: '', active: true }]);
    expect(departmentsOf(r.members, 'a@x.com')).toEqual(['DEP-01', 'DEP-02']);
    expect(r.members[0].primary).toBe(true);
  });
  it('creates a membership row with exact headers', async () => {
    await addMember({ id: 'DM-003', email: 'b@x.com', name: 'B', deptId: 'DEP-01', primary: false, addedOn: '2026-11-22' }, 'Finance');
    expect(calls[0]).toEqual({ action: 'create', table: 'DeptMemberTable', row: {
      MemberID: 'DM-003', Email: 'b@x.com', Name: 'B', DeptID: 'DEP-01', Department: 'Finance', 'Is Primary': 'false', 'Added On': '2026-11-22' } });
  });
  it('next ids', () => {
    expect(nextId('DEP', ['DEP-01', 'DEP-08'], 2)).toBe('DEP-09');
    expect(nextId('DM', [], 3)).toBe('DM-001');
  });
});
