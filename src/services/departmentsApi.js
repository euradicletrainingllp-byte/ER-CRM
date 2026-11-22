/**
 * departmentsApi.js — departments and user ↔ department membership
 * (Admin Panel.xlsx → DepartmentTable + DeptMemberTable) via the generic Admin CRUD flow.
 * A user can belong to several departments: one DeptMemberTable row per user × department.
 */
import { adminList, adminCreate, adminUpdate, adminDelete } from './adminApi';

const truthy = v => String(v ?? '').trim().toLowerCase() === 'true';
const s = v => String(v ?? '').trim();

export const nextId = (prefix, ids, pad) => {
  const n = ids.map(i => parseInt(String(i).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  return `${prefix}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(pad, '0')}`;
};

export async function fetchDepartments() {
  const [d, m] = await Promise.all([adminList('departments'), adminList('deptMembers')]);
  const departments = d.filter(r => s(r.DeptID)).map(r => ({
    id: s(r.DeptID), name: s(r.Department), description: s(r.Description),
    head: s(r['Head Email']).toLowerCase(), active: r.Active === '' || r.Active == null ? true : truthy(r.Active),
  }));
  const members = m.filter(r => s(r.MemberID) && s(r.Email)).map(r => ({
    id: s(r.MemberID), email: s(r.Email).toLowerCase(), name: s(r.Name),
    deptId: s(r.DeptID), primary: truthy(r['Is Primary']), addedOn: s(r['Added On']),
  }));
  return { departments, members };
}

const deptRow = d => ({ DeptID: d.id, Department: d.name, Description: d.description || '', 'Head Email': d.head || '', Active: String(!!d.active) });

export const createDepartment = d => adminCreate('departments', deptRow(d));
export const updateDepartment = d => adminUpdate('departments', d.id, deptRow(d));
export const deleteDepartment = id => adminDelete('departments', id);

export const addMember = (m, deptName) => adminCreate('deptMembers', {
  MemberID: m.id, Email: m.email, Name: m.name || '', DeptID: m.deptId, Department: deptName || '',
  'Is Primary': String(!!m.primary), 'Added On': m.addedOn || new Date().toISOString().slice(0, 10),
});
export const setMemberPrimary = (id, primary) => adminUpdate('deptMembers', id, { 'Is Primary': String(!!primary) });
export const removeMember = id => adminDelete('deptMembers', id);

/** Department ids for one user — for grouping audiences/notifications later. */
export const departmentsOf = (members, email) => members.filter(m => m.email === String(email).toLowerCase()).map(m => m.deptId);
