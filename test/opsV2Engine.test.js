import { it, expect } from 'vitest';
import { buildTimeline, summarise, generateTasks, normStep, seqBetween, appliesTo, modeOf, toISO, datePatches, nextOpenAfter, parseTat, tatOffset, fmtTat, isValidTat, tatLabel, resolveOwners, ownersForDept, splitDepts, stepColumns, stepPatch, diffRow, listValues } from '../src/services/opsV2Engine';

const step = (id, seq, tat, extra = {}) => normStep({ StepID: id, Seq: seq, Phase: '1. Setup', Step: id, 'Owner Dept': 'Operations', Anchor: 'Start', 'TAT (days)': tat, 'Applies To Mode': 'All', 'Applies To Offering': 'All', Active: 'Yes', ...extra });
const steps = [step('A', 10, 2), step('B', 20, 3), step('C', 30, 1, { 'Applies To Mode': 'In-person' }), step('D', 40, '+1', { Anchor: 'End' })];
const eng = { 'EC Index': '7', 'EG.ID': 'EG.ID 7', Company: 'X', Location: 'VILT', 'Start Date': '2026-12-01', 'End Date': '2026-12-02', 'Checklist Created On': '2026-11-20' };
const byId = Object.fromEntries(steps.map(s => [s.id, s]));
const departments = [{ id: 'D-01', name: 'Operations', active: true }];
const members = [{ id: 'M1', email: 'a@x.com', name: 'A', deptId: 'D-01' }, { id: 'M2', email: 'b@x.com', name: 'B', deptId: 'D-01' }];

it('generates tasks with dept owners, NA for non-matching mode, TAT counted from start / end', () => {
  const rows = generateTasks({ steps, eng, departments, members, existingTaskIds: ['T-00009'], today: '2026-11-20' });
  expect(rows.map(r => r.TaskID)).toEqual(['T-00010', 'T-00011', 'T-00012', 'T-00013']);
  expect(rows[0]['Owner Emails']).toBe('a@x.com; b@x.com');
  expect(rows[2].Applicable).toBe('NA');                       // In-person step on a VILT program
  expect(rows.map(r => r['Due Date'])).toEqual(['2026-11-29', '2026-11-28', '', '2026-12-03']); // "2" = start − 2; D "+1" = end + 1
});

it('recalculates only the changed step; completion does not move others', () => {
  const rows = generateTasks({ steps, eng, departments, members, today: '2026-11-20' });
  rows[0].Status = 'Done'; rows[0]['Completed On'] = '2026-11-30';
  rows[1]['TAT (days)'] = 5;
  const tl = buildTimeline(rows, eng, byId, '2026-11-21');
  expect(tl[0].delay).toBe(1);
  expect(datePatches(tl)).toEqual([{ id: rows[1].TaskID, patch: { 'Planned Start': '2026-11-26', 'Due Date': '2026-11-26' } }]);
  expect(nextOpenAfter(tl, rows[0].TaskID).row.StepID).toBe('B');
});

it('flags at-risk when a prep step is overdue before start, and short lead time', () => {
  const soon = { ...eng, 'Start Date': '2026-11-23', 'End Date': '2026-11-23', 'Checklist Created On': '2026-11-21' };
  const rows = generateTasks({ steps, eng: soon, departments, members, today: '2026-11-21' });
  const tl = buildTimeline(rows, soon, byId, '2026-11-22');
  expect(summarise(tl, soon, '2026-11-22').atRisk).toBe(true);        // A due 21 Nov, still open
  expect(summarise(buildTimeline(rows, soon, byId, '2026-11-20'), soon, '2026-11-20').atRisk).toBe(false);   // nothing overdue yet
  expect(tl[1].shortLead).toBe(true);                                 // B due 20 Nov < opened 21 Nov
});

it('several owner departments', () => {
  const deps = [...departments, { id: 'D-02', name: 'Finance', active: true }];
  const mem = [...members, { id: 'M3', email: 'c@x.com', name: 'C', deptId: 'D-02' }, { id: 'M4', email: 'a@x.com', name: 'A', deptId: 'D-02' }];
  expect(ownersForDept('Operations; Finance', deps, mem).map(o => o.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  expect(splitDepts(' Operations ;Finance;; ')).toEqual(['Operations', 'Finance']);
});

it('step library: default owners first, column-safe patches, lists', () => {
  const st = { ...steps[0], ownerEmails: 'b@x.com' };
  expect(resolveOwners(st, departments, members)).toEqual([{ email: 'b@x.com', name: 'B' }]);
  expect(resolveOwners(steps[0], departments, members).map(o => o.email)).toEqual(['a@x.com', 'b@x.com']);
  const cols = stepColumns({ StepID: 'A', 'Default Owner Email': '', Required: '' });
  expect(stepPatch({ ownerEmails: 'b@x.com', required: 'Optional', active: false, tat: '+4' }, cols))
    .toEqual({ 'Default Owner Email': 'b@x.com', Required: 'Optional', Active: 'No', 'TAT (days)': '+4' });
  expect(diffRow({ Step: 'A', 'TAT (days)': 2 }, { Step: 'A', 'TAT (days)': '3' })).toEqual({ 'TAT (days)': '3' });
  const rows = [{ List: 'Phase', Value: 'B', Order: 2, Active: 'Yes' }, { List: 'Phase', Value: 'A', Order: 1, Active: 'Yes' }, { List: 'Phase', Value: 'C', Order: 3, Active: 'No' }];
  expect(listValues(rows, 'phase', ['x'])).toEqual(['A', 'B']);
  expect(listValues(null, 'Phase', ['x'])).toEqual(['x']);
});

it('signed TAT: no sign = before, + = after', () => {
  expect([parseTat('2'), parseTat('-2'), parseTat('+2'), parseTat(' + 3 '), parseTat('0'), parseTat('')])
    .toEqual([{ days: 2, after: false }, { days: 2, after: false }, { days: 2, after: true }, { days: 3, after: true }, { days: 0, after: false }, { days: 0, after: false }]);
  expect([tatOffset('2'), tatOffset('+2'), fmtTat(' +2'), fmtTat('-4'), fmtTat(3)]).toEqual([-2, 2, '+2', '4', '3']);
  expect([isValidTat('+2'), isValidTat('2'), isValidTat('2.5'), isValidTat('x')]).toEqual([true, true, false, false]);
  const rows = generateTasks({ steps: [step('A', 10, '2'), step('B', 20, '+2')], eng, departments, members, today: '2026-11-20' });
  expect(rows.map(r => r['Due Date'])).toEqual(['2026-11-29', '2026-12-03']);
  expect(buildTimeline(rows, eng, {}, '2026-11-20').map(t => t.preProgram)).toEqual([true, false]);
  expect(tatLabel('+2')).toBe('+2d after start');
});

it('helpers', () => {
  expect(seqBetween(100, 110)).toBe(105);
  expect(seqBetween(100, 101)).toBe(100.5);
  expect(seqBetween(320)).toBe(330);
  expect(appliesTo('Learning Journey', 'Learning Journey')).toBe(true);
  expect(appliesTo('Learning Journey', 'Workshop')).toBe(false);
  expect(modeOf('Online')).toBe('Virtual');
  expect(toISO(46356)).toBe('2026-11-30');
  expect(toISO('05/12/2026')).toBe('2026-12-05');
});
