/**
 * opsV2Travel.js — Travel Desk + vendor-request rules for Ops Checklist v2 (no network).
 *  TravelTable (Operations Checklist.xlsx, key TripID): one row per trip.
 *  - Trips are created for each consultant (Consultant 1–3) of an in-person program.
 *  - Booking a trip creates Vendor Service rows (Travel / Stay / Local transport, Source = Travel Desk).
 *  - Travel steps finish themselves: all trips Booked → "travel booked" + "stay" steps Done;
 *    all trips Shared → "itinerary shared" step Done.
 *  - A step with a Vendor Category gets "Raise vendor request" → one Vendor Service row (Source = Ops Checklist).
 */
import { toISO, addDays, daysBetween, todayISO, engMode, nextNumberId, isApplicable, isDone } from './opsV2Engine.js';

export const TRIP_STATUSES = ['Requested', 'Booked', 'Shared', 'Completed', 'Cancelled'];
export const TRAVEL_MODES = ['Flight', 'Train', 'Bus', 'Cab', 'Self-drive', 'None'];
export const TRAVELLER_ROLES = ['Consultant', 'Co-facilitator', 'Ops team', 'Other'];
export const BILLABLE = ['Billable to client', 'Not billable (EuRadicle cost)', 'Included in program fee'];
const BOOKED = ['Booked', 'Shared', 'Completed'];
const SHARED = ['Shared', 'Completed'];
const BILLABLE_BY_DEFAULT = ['Travel', 'Stay', 'Local transport'];

const s = v => String(v ?? '').trim();
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const fmt = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '');

export const tripStart = t => toISO(t['Onward Date']) || toISO(t['Check-in']) || toISO(t['Program Start']);
export const tripEnd = t => { const st = tripStart(t); const en = toISO(t['Return Date']) || toISO(t['Check-out']); return en && en >= st ? en : st; };
export const tripTotal = t => num(t['Travel Cost']) + num(t['Stay Cost']) + num(t['Local Cost']);
export const isActiveTrip = t => s(t['Booking Status']) !== 'Cancelled';
export const nightsOf = t => { const a = toISO(t['Check-in']), b = toISO(t['Check-out']); return a && b && b > a ? daysBetween(a, b) : 0; };
export const tripLabel = t => `${s(t.Traveller) || '—'} · ${[s(t['From City']), s(t['To City'])].filter(Boolean).join(' → ') || s(t.Location) || '—'}`;

/** New trips for the consultants of an in-person program who have no trip yet. */
export function tripsForProgram(eng, { existing = [], existingIds = [], actorEmail = '', today = todayISO() } = {}) {
  if (engMode(eng) !== 'In-person') return [];
  const key = s(eng['EC Index']);
  const have = new Set(existing.filter(t => s(t['EC Index']) === key).map(t => s(t.Traveller).toLowerCase()));
  const start = toISO(eng['Start Date']), end = toISO(eng['End Date']) || start;
  const ids = [...existingIds];
  return ['Consultant 1', 'Consultant 2', 'Consultant 3'].map(c => s(eng[c])).filter(Boolean)
    .filter((n, i, a) => a.indexOf(n) === i && !have.has(n.toLowerCase()))
    .map(name => {
      const TripID = nextNumberId('TR', ids, 4); ids.push(TripID);
      return {
        TripID, 'EC Index': key, 'EG.ID': s(eng['EG.ID']), Company: s(eng.Company), Program: s(eng.Topic),
        'Program Start': start, 'Program End': end, Location: s(eng.Location),
        Traveller: name, 'Traveller Email': '', 'Traveller Role': name === s(eng['Consultant 1']) ? 'Consultant' : 'Co-facilitator',
        'From City': '', 'To City': s(eng.Location), 'Travel Mode': 'Flight',
        'Onward Date': start ? addDays(start, -1) : '', 'Return Date': end ? addDays(end, 1) : '',
        'Check-in': start ? addDays(start, -1) : '', 'Check-out': end || '',
        'Billable to Client': 'Billable to client', 'Booking Status': 'Requested',
        'Vendor Service IDs': '', Notes: '', 'Created By': s(actorEmail).toLowerCase(), 'Updated On': today,
      };
    });
}

const unitFor = cat => ({ Travel: 'Per trip', Stay: 'Per night', 'Local transport': 'Lump sum', 'Printing & material': 'Per piece', Catering: 'Per person', Venue: 'Per day' }[cat] || 'Lump sum');
const billingFor = billable => (/^billable/i.test(billable) ? 'To bill' : 'Not applicable');

/** Vendor Service rows (camelCase, for addVendorService) for a booked trip — one per cost > 0. */
export function vendorRowsForTrip(trip, { nextId, actorEmail = '' } = {}) {
  const billable = s(trip['Billable to Client']) || 'Billable to client';
  const route = [s(trip['From City']), s(trip['To City'])].filter(Boolean).join(' → ');
  const parts = [
    ['Travel Cost', 'Travel', 1, s(trip['Onward Carrier / No']), toISO(trip['Onward Date'])],
    ['Stay Cost', 'Stay', Math.max(1, nightsOf(trip)), s(trip['Hotel Name']), toISO(trip['Check-in'])],
    ['Local Cost', 'Local transport', 1, '', toISO(trip['Onward Date'])],
  ];
  return parts.filter(([col]) => num(trip[col]) > 0).map(([col, category, qty, vendorName, date]) => {
    const amount = num(trip[col]);
    return {
      serviceId: nextId(), vendorName, vendorContact: '', category,
      description: `${category} — ${s(trip.Traveller)}${route ? ` · ${route}` : ''}${date ? ` · ${fmt(date)}` : ''} (Trip ${s(trip.TripID)})`,
      engagementKey: s(trip['EC Index']), egId: s(trip['EG.ID']), client: s(trip.Company), program: s(trip.Program),
      serviceDate: date || toISO(trip['Program Start']), quantity: qty, unit: unitFor(category), rate: Math.round(amount / qty), amount, gst: 0,
      requestedBy: s(trip['Booked By']) || s(actorEmail), billable, clientBilling: billingFor(billable),
      paymentStatus: 'Invoice awaited', comments: s(trip.Notes), createdBy: s(actorEmail),
      source: 'Travel Desk', tripId: s(trip.TripID), opsTaskId: '',
    };
  });
}

/** One Vendor Service row for an Ops step that has a Vendor Category ("Raise vendor request"). */
export function vendorRowForStep(step, task, eng, { serviceId, actorEmail = '', due = '' } = {}) {
  const category = s(step?.vendorCategory) || 'Other';
  const pax = num(eng?.['No of Participants']);
  const qty = category === 'Printing & material' && pax > 0 ? pax : 1;
  const billable = BILLABLE_BY_DEFAULT.includes(category) ? 'Billable to client' : 'Included in program fee';
  return {
    serviceId, vendorName: '', vendorContact: '', category,
    description: `${s(task.Step)} — ${s(eng?.Company)} · ${s(eng?.Topic)}${s(eng?.Location) ? ` · ${s(eng.Location)}` : ''}${pax ? ` · ${pax} pax` : ''}`,
    engagementKey: s(task['EC Index']), egId: s(task['EG.ID'] || eng?.['EG.ID']), client: s(task.Company || eng?.Company), program: s(eng?.Topic),
    serviceDate: due || toISO(task['Due Date']) || toISO(eng?.['Start Date']), quantity: qty, unit: unitFor(category), rate: '', amount: '', gst: '',
    requestedBy: s(task['Owner Names']) || s(actorEmail), billable, clientBilling: billingFor(billable),
    paymentStatus: 'Invoice awaited', comments: '', createdBy: s(actorEmail),
    source: 'Ops Checklist', opsTaskId: s(task.TaskID), tripId: '',
  };
}

const TRAVEL_BOOKED_STEP = /travel booked|stay .*arranged|stay & food/i;
const ITINERARY_STEP = /itinerary/i;
/**
 * Ops tasks of one program to mark Done because of its trips:
 * every active trip Booked/Shared/Completed → travel + stay steps; every active trip Shared/Completed → itinerary step.
 */
export function travelStepsToComplete(tasks = [], trips = [], stepsById = {}) {
  const active = trips.filter(isActiveTrip);
  if (!active.length) return [];
  const booked = active.every(t => BOOKED.includes(s(t['Booking Status'])));
  const shared = active.every(t => SHARED.includes(s(t['Booking Status'])));
  return tasks.filter(t => isApplicable(t) && !isDone(t)).filter(t => {
    const cat = s(stepsById[s(t.StepID)]?.vendorCategory);
    const isTravel = ['Travel', 'Stay'].includes(cat) || TRAVEL_BOOKED_STEP.test(s(t.Step));
    return (booked && isTravel) || (shared && ITINERARY_STEP.test(s(t.Step)));
  });
}

/** Billable trip total for a program (for the Engagement Calendar "Travel, Stay and Misc Expenses"). */
export const billableTravelTotal = trips => trips.filter(t => isActiveTrip(t) && /^billable/i.test(s(t['Billable to Client']))).reduce((a, t) => a + tripTotal(t), 0);

/** Calendar month: weeks (Mon–Sun) of ISO dates. */
export function monthGrid(year, month) {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const dow = (new Date(first + 'T00:00:00').getDay() + 6) % 7;      // Monday = 0
  let d = addDays(first, -dow);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const wk = []; for (let i = 0; i < 7; i++) { wk.push(d); d = addDays(d, 1); }
    weeks.push(wk);
    if (Number(d.slice(5, 7)) !== month + 1 && w >= 3) break;
  }
  return weeks;
}
export const tripsOnDay = (trips, iso) => trips.filter(t => { const a = tripStart(t), b = tripEnd(t); return a && a <= iso && iso <= b; });
export const inHotel = (t, iso) => { const a = toISO(t['Check-in']), b = toISO(t['Check-out']); return !!a && !!b && a <= iso && iso < b; };
