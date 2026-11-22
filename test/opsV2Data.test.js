import { it, expect } from 'vitest';
import { programsFrom, clScore } from '../src/services/opsV2Data';
import { upcomingDeliveries, openTasks, completedWork } from '../src/services/actionItems';

const steps = [
  { StepID: 'OPS-010', Seq: 10, Phase: '1. Setup', Step: 'Kick-off', 'Owner Dept': 'Operations', Anchor: 'Start', 'TAT (days)': 3, Active: 'Yes' },
  { StepID: 'OPS-300', Seq: 300, Phase: '6. Finance', Step: 'Invoice raised', 'Owner Dept': 'Finance', Anchor: 'End', 'TAT (days)': '+1', Active: 'Yes' },
];
const engs = [{ 'EC Index': '42', 'EG.ID': 'EG.ID 9', Company: 'Acme', Topic: 'Storytelling', 'Start Date': '2099-01-10', 'End Date': '2099-01-11',
  'EC Status': 'Scheduled', 'Checklist Status': 'In Preparation', 'Checklist Created On': '2098-12-01', 'Consultant 1': 'Kiran' }];
const tasks = [
  { TaskID: 'T-1', 'EC Index': '42', StepID: 'OPS-010', Seq: 10, Phase: '1. Setup', Step: 'Kick-off', 'TAT (days)': 3, Applicable: 'Yes', Status: 'Done', 'Completed On': '2025-01-05', 'Owner Names': 'Revanth' },
  { TaskID: 'T-2', 'EC Index': '42', StepID: 'OPS-300', Seq: 300, Phase: '6. Finance', Step: 'Invoice raised', 'TAT (days)': '+1', Applicable: 'Yes', Status: 'Not Started', 'Owner Names': 'Priya', Comments: 'GST no. pending' },
];

it('summarises v2 programs for other pages', () => {
  const [p] = programsFrom(steps, engs, tasks, '2099-01-01');
  expect(p).toMatchObject({ engagementKey: '42', company: 'Acme', status: 'Scheduled', ready: 50, openItems: 1, lateItems: 0, invoicePoc: 'Priya', invoiceComment: 'GST no. pending' });
  expect(p.tasks.map(t => [t.taskId, t.due])).toEqual([['T-1', '2099-01-07'], ['T-2', '2099-01-12']]);
  expect(clScore(p)).toBe(50);

  const eng = [{ engagementKey: '42', company: 'Acme', topic: 'Storytelling', startDate: '2099-01-10', endDate: '2099-01-11', status: 'Scheduled' }];
  const programs = programsFrom(steps, engs, tasks, '2099-01-01');
  const open = openTasks({ ops: programs }).filter(t => t.tracker === 'ops');
  expect(open.map(t => [t.id, t.label, t.due, t.owner])).toEqual([['ops|T-2', 'Invoice raised', '2099-01-12', 'Priya']]);
  expect(completedWork({ ops: programs }).filter(t => t.tracker === 'ops').map(t => t.date)).toEqual(['2025-01-05']);
  expect(typeof upcomingDeliveries).toBe('function');
  expect(eng.length).toBe(1);
});
