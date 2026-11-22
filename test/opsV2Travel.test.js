import { it, expect } from 'vitest';
import { tripsForProgram, vendorRowsForTrip, vendorRowForStep, travelStepsToComplete, billableTravelTotal, monthGrid, tripsOnDay, nightsOf } from '../src/services/opsV2Travel';
import { normStep } from '../src/services/opsV2Engine';

const eng = { 'EC Index': '42', 'EG.ID': 'EG.ID 9', Company: 'Acme', Topic: 'Storytelling', Location: 'Hyderabad', 'No of Participants': 25,
  'Start Date': '2026-12-10', 'End Date': '2026-12-11', 'Consultant 1': 'Kiran', 'Consultant 2': 'Shahnawaz', 'Consultant 3': 'Kiran' };

it('creates one trip per consultant for in-person programs only', () => {
  const trips = tripsForProgram(eng, { existingIds: ['TR-0007'], actorEmail: 'Ops@x.com', today: '2026-11-22' });
  expect(trips.map(t => [t.TripID, t.Traveller, t['Traveller Role'], t['Onward Date'], t['Return Date'], t['Check-out'], t['Booking Status']]))
    .toEqual([['TR-0008', 'Kiran', 'Consultant', '2026-12-09', '2026-12-12', '2026-12-11', 'Requested'], ['TR-0009', 'Shahnawaz', 'Co-facilitator', '2026-12-09', '2026-12-12', '2026-12-11', 'Requested']]);
  expect(tripsForProgram(eng, { existing: trips })).toEqual([]);
  expect(tripsForProgram({ ...eng, Location: 'VILT' })).toEqual([]);
});

it('turns a booked trip into vendor rows and a vendor step into a request', () => {
  const [trip] = tripsForProgram(eng);
  Object.assign(trip, { 'Travel Cost': 8400, 'Stay Cost': '7,000', 'Local Cost': 0, 'Hotel Name': 'Novotel', 'From City': 'Bengaluru' });
  let n = 3; const rows = vendorRowsForTrip(trip, { nextId: () => `VS-${String(++n).padStart(4, '0')}`, actorEmail: 'ops@x.com' });
  expect(rows.map(r => [r.serviceId, r.category, r.quantity, r.rate, r.amount, r.vendorName, r.billable, r.source, r.tripId]))
    .toEqual([['VS-0004', 'Travel', 1, 8400, 8400, '', 'Billable to client', 'Travel Desk', trip.TripID], ['VS-0005', 'Stay', 2, 3500, 7000, 'Novotel', 'Billable to client', 'Travel Desk', trip.TripID]]);
  expect(nightsOf(trip)).toBe(2);
  expect(billableTravelTotal([trip, { ...trip, 'Booking Status': 'Cancelled' }])).toBe(15400);
  const st = normStep({ StepID: 'OPS-018', Step: 'Printing order', 'Vendor Category': 'Printing & material' });
  const v = vendorRowForStep(st, { TaskID: 'T-9', Step: 'Printing order', 'EC Index': '42', 'Due Date': '2026-12-05', 'Owner Names': 'Revanth' }, eng, { serviceId: 'VS-0010' });
  expect(v).toMatchObject({ category: 'Printing & material', quantity: 25, unit: 'Per piece', billable: 'Included in program fee', source: 'Ops Checklist', opsTaskId: 'T-9', serviceDate: '2026-12-05' });
});

it('finishes travel steps from trip statuses', () => {
  const tasks = [
    { TaskID: 'a', StepID: 'OPS-006', Step: 'Facilitator travel booked', Applicable: 'Yes', Status: 'Not Started' },
    { TaskID: 'b', StepID: 'OPS-007', Step: 'Facilitator stay & food arranged', Applicable: 'Yes', Status: 'Not Started' },
    { TaskID: 'c', StepID: 'OPS-008', Step: 'Itinerary shared with consultant', Applicable: 'Yes', Status: 'Not Started' },
  ];
  const trips = [{ 'Booking Status': 'Booked' }, { 'Booking Status': 'Shared' }, { 'Booking Status': 'Cancelled' }];
  expect(travelStepsToComplete(tasks, trips).map(t => t.TaskID)).toEqual(['a', 'b']);
  expect(travelStepsToComplete(tasks, trips.map(t => ({ 'Booking Status': t['Booking Status'] === 'Cancelled' ? 'Cancelled' : 'Shared' }))).map(t => t.TaskID)).toEqual(['a', 'b', 'c']);
  expect(travelStepsToComplete(tasks, [{ 'Booking Status': 'Requested' }])).toEqual([]);
});

it('calendar helpers', () => {
  const g = monthGrid(2026, 11);            // December 2026
  expect(g[0][0]).toBe('2026-11-30');       // Monday before 1 Dec
  expect(g.flat()).toContain('2026-12-31');
  const t = { 'Onward Date': '2026-12-09', 'Return Date': '2026-12-12' };
  expect([tripsOnDay([t], '2026-12-09').length, tripsOnDay([t], '2026-12-13').length]).toEqual([1, 0]);
});
