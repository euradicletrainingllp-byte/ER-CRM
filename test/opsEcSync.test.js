import { it, expect } from 'vitest';
import { linkFor, engPatchFromEc, autoFillPatches, planEcSync, autoFillNewTasks } from '../src/services/opsEcSync';

const ec = (k, extra = {}) => ({ engagementKey: k, egId: `EG-${k}`, company: 'Zscaler', startDate: '2026-11-16', endDate: '2026-11-16', topic: 'Service Edge (batch 1)', status: 'Scheduled', poStatus: 'Received', consultant1: 'Vasanth', day: 1, ...extra });
const eng = (k, extra = {}) => ({ 'EC Index': k, Company: 'Zscaler', 'Start Date': '2026-11-16', 'End Date': '2026-11-16', Topic: 'Service Edge (batch 1)', 'Checklist Status': 'In Preparation', 'Checklist Created On': '2026-11-10', ...extra });

it('trusts the index only for the same program and suggests the right EC row otherwise', () => {
  const rows = [ec('595', { company: 'Ford', topic: 'Other', startDate: '2026-11-12' }), ec('597')];
  expect(linkFor(eng('597'), rows).how).toBe('index');
  const bad = linkFor(eng('595'), rows);
  expect(bad.how).toBe('mismatch');
  expect(bad.suggest).toBe('597');
  expect(linkFor(eng('999'), rows).how).toBe('missing');
});

it('a rescheduled program (same index, company and topic, new date) still links and its dates sync', () => {
  const r = ec('597', { startDate: '2026-11-20', endDate: '2026-11-21' });
  expect(linkFor(eng('597'), [r]).how).toBe('index');
  const { patch } = engPatchFromEc(eng('597'), r);
  expect(patch['Start Date']).toBe('2026-11-20');
  expect(patch['End Date']).toBe('2026-11-21');
});

it('maps EC status to checklist status', () => {
  expect(engPatchFromEc(eng('1'), ec('1', { status: 'Cancelled' })).patch['Checklist Status']).toBe('Closed');
  expect(engPatchFromEc(eng('1'), ec('1', { status: 'Delivered' })).patch['Checklist Status']).toBe('Delivered');
  expect(engPatchFromEc(eng('1', { 'Checklist Status': 'Closed' }), ec('1', { status: 'Delivered' })).patch['Checklist Status']).toBeUndefined();
});

it('auto-fills answered steps with the checklist opening date, EC dates for finance, never undoes', () => {
  const tasks = [
    { TaskID: 'T-1', StepID: 'OPS-001', Status: 'Not Started' },
    { TaskID: 'T-2', StepID: 'OPS-002', Status: 'Not Started' },
    { TaskID: 'T-3', StepID: 'OPS-032', Status: 'Not Started' },
    { TaskID: 'T-4', StepID: 'OPS-004', Status: 'Done', 'Completed On': '2026-11-11' },
    { TaskID: 'T-6', StepID: 'OPS-004', Status: 'Not Started' },
    { TaskID: 'T-7', StepID: 'OPS-026', Status: 'Not Started' },
    { TaskID: 'T-5', StepID: 'OPS-030', Status: 'NA', Applicable: 'NA' },
  ];
  const f = autoFillPatches(tasks, ec('1', { payment: 'Paid', receivedDate: '2026-11-20' }), '2026-11-10', '2026-11-24');
  expect(f.map(x => x.id)).toEqual(['T-1', 'T-2', 'T-3']);
  expect(f[0].patch['Completed On']).toBe('2026-11-10');
  expect(f[2].patch['Completed On']).toBe('2026-11-20');
});

it('plan skips duplicate TaskIDs and mismatched links', () => {
  const plan = planEcSync({
    engagements: [eng('597'), eng('595')],
    tasks: [{ TaskID: 'T-1', 'EC Index': '597', StepID: 'OPS-001', Status: 'Not Started' }, { TaskID: 'T-2', 'EC Index': '597', StepID: 'OPS-002', Status: 'Not Started' }],
    ecRows: [ec('597'), ec('595', { company: 'Ford' })], dupTaskIds: ['T-2'], today: '2026-11-24',
  });
  expect(plan.programs[0].fills.map(x => x.id)).toEqual(['T-1']);
  expect(plan.mismatches[0].k).toBe('595');
});

it('new checklist rows come out with answered steps done', () => {
  const rows = autoFillNewTasks([{ TaskID: 'T-9', StepID: 'OPS-001', Status: 'Not Started' }], ec('1'), '2026-11-24');
  expect(rows[0].Status).toBe('Done');
  expect(rows[0]['Completed On']).toBe('2026-11-24');
});

it('two EC programs of the same company on the same day: a different topic is not trusted', () => {
  const rows = [ec('590', { topic: 'Session 02' }), ec('591', { topic: 'One on one coaching' })];
  expect(linkFor(eng('591', { Topic: 'Batch 9 session 1' }), rows).how).toBe('mismatch');
  expect(linkFor(eng('591', { Topic: 'One on one coaching' }), rows).how).toBe('index');
});

it('never copies a status word that sits in an EC consultant column', () => {
  const { patch } = engPatchFromEc(eng('1', { 'Consultant 3': '' }), ec('1', { consultant3: 'Delivered' }));
  expect(patch['Consultant 3']).toBeUndefined();
});
