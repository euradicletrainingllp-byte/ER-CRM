/**
 * Travel Desk (Ops Checklist v2) — trips per program (TravelTable), List and Calendar views.
 * Pure UI — writes go through the callbacks from OpsChecklistV2.jsx. Rules: services/opsV2Travel.js
 */
import { useState, useMemo } from 'react';
import { TRIP_STATUSES, TRAVEL_MODES, TRAVELLER_ROLES, BILLABLE, tripStart, tripEnd, tripTotal, isActiveTrip, nightsOf, tripLabel, billableTravelTotal, monthGrid, tripsOnDay, inHotel } from '../../services/opsV2Travel.js';
import { toISO, todayISO } from '../../services/opsV2Engine.js';

const s = v => String(v ?? '').trim();
const fmtD = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const inr = n => (n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—');
const ST_CLS = { Requested: 'yellow', Booked: 'info', Shared: 'green', Completed: 'gray', Cancelled: 'red' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const keyOf = e => s(e['EC Index']);

const GROUPS = [
  ['Traveller', [['Traveller'], ['Traveller Email'], ['Traveller Role', 'select', TRAVELLER_ROLES]]],
  ['Route', [['From City'], ['To City'], ['Travel Mode', 'select', TRAVEL_MODES]]],
  ['Onward', [['Onward Date', 'date'], ['Onward Time', 'time'], ['Onward Carrier / No'], ['Onward PNR']]],
  ['Return', [['Return Date', 'date'], ['Return Time', 'time'], ['Return Carrier / No'], ['Return PNR']]],
  ['Stay', [['Hotel Name'], ['Hotel Address'], ['Check-in', 'date'], ['Check-out', 'date']]],
  ['Costs & billing', [['Travel Cost', 'number'], ['Stay Cost', 'number'], ['Local Cost', 'number'], ['Billable to Client', 'select', BILLABLE]]],
  ['Other', [['Local Transport'], ['Ticket Link'], ['Notes', 'textarea']]],
];
const FIELDS = GROUPS.flatMap(([, f]) => f.map(x => x[0]));
const norm = (k, v) => (['Onward Date', 'Return Date', 'Check-in', 'Check-out'].includes(k) ? toISO(v) : s(v));

function TripDrawer({ trip, canEdit, canDelete, busy, onClose, onSave, onStatus, onDelete, onRaiseVendors }) {
  const init = Object.fromEntries(FIELDS.map(k => [k, norm(k, trip[k])]));
  const [f, setF] = useState(init);
  const changed = FIELDS.filter(k => s(f[k]) !== s(init[k]));
  const st = s(trip['Booking Status']) || 'Requested';
  const vendorIds = s(trip['Vendor Service IDs']);
  return (
    <aside className="ov2-drawer">
      <div className="ov2-drawer-head"><b>{s(trip.TripID)} · {s(trip.Company)}</b><button className="ov2-x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="ov2-drawer-body">
        <div className="ov2-muted">{s(trip.Program)} · {fmtD(toISO(trip['Program Start']))}{toISO(trip['Program End']) !== toISO(trip['Program Start']) ? ` – ${fmtD(toISO(trip['Program End']))}` : ''} · {s(trip.Location)}</div>
        <label>Booking status
          <select className={`form-input ov2-status ${ST_CLS[st] || ''}`} value={st} disabled={!canEdit || !!busy} onChange={e => onStatus(trip, e.target.value)}>
            {TRIP_STATUSES.map(x => <option key={x}>{x}</option>)}
          </select>
        </label>
        <div className="ov2-muted">Booked → vendor rows are created from the costs · Shared → itinerary email to the traveller{vendorIds ? ` · Vendor rows: ${vendorIds}` : ''}</div>
        {GROUPS.map(([g, fields]) => (
          <div key={g}>
            <div className="ov2-lbl">{g}</div>
            <div className="ov2-two">
              {fields.map(([k, type, opts]) => (
                <label key={k} className={type === 'textarea' ? 'wide' : ''}>{k}
                  {type === 'select' ? <select className="form-input" disabled={!canEdit} value={f[k]} onChange={e => setF(p => ({ ...p, [k]: e.target.value }))}><option value="">—</option>{opts.map(o => <option key={o}>{o}</option>)}</select>
                    : type === 'textarea' ? <textarea className="form-input" rows={2} disabled={!canEdit} value={f[k]} onChange={e => setF(p => ({ ...p, [k]: e.target.value }))} />
                    : <input className="form-input" type={type || 'text'} min={type === 'number' ? 0 : undefined} disabled={!canEdit} value={f[k]} onChange={e => setF(p => ({ ...p, [k]: e.target.value }))} />}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="ov2-muted">Total {inr(Number(f['Travel Cost'] || 0) + Number(String(f['Stay Cost'] || 0).replace(/[^0-9.]/g, '')) + Number(f['Local Cost'] || 0))}{nightsOf(f) ? ` · ${nightsOf(f)} night(s)` : ''}</div>
      </div>
      <div className="ov2-drawer-foot">
        {canDelete && <button className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={() => onDelete(trip)}>Delete</button>}
        {canEdit && ['Booked', 'Shared', 'Completed'].includes(st) && !vendorIds && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => onRaiseVendors(trip)}>Create vendor rows</button>}
        <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        {canEdit && <button className="btn btn-cta btn-sm" disabled={!changed.length || !!busy} onClick={() => onSave(trip, Object.fromEntries(changed.map(k => [k, f[k]])))}>{busy ? 'Saving…' : 'Save'}</button>}
      </div>
    </aside>
  );
}

function CalendarView({ trips, onOpen }) {
  const t0 = todayISO();
  const [ym, setYm] = useState(() => ({ y: Number(t0.slice(0, 4)), m: Number(t0.slice(5, 7)) - 1 }));
  const weeks = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const shift = d => setYm(({ y, m }) => { const n = m + d; return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 }; });
  const mm = String(ym.m + 1).padStart(2, '0');
  return (
    <div className="ov2-cal">
      <div className="ov2-cal-bar">
        <button className="btn btn-outline btn-sm" onClick={() => shift(-1)}>◀</button>
        <b>{MONTHS[ym.m]} {ym.y}</b>
        <button className="btn btn-outline btn-sm" onClick={() => shift(1)}>▶</button>
        <button className="btn btn-outline btn-sm" onClick={() => setYm({ y: Number(t0.slice(0, 4)), m: Number(t0.slice(5, 7)) - 1 })}>Today</button>
        <span className="ov2-cal-legend">{TRIP_STATUSES.map(x => <span key={x} className={`ov2-tripchip ${ST_CLS[x]}`}>{x}</span>)}<span>🛏 hotel night</span></span>
      </div>
      <div className="ov2-cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="ov2-cal-dow">{d}</div>)}
        {weeks.flat().map(d => {
          const list = tripsOnDay(trips, d);
          return (
            <div key={d} className={`ov2-cal-day${d.slice(5, 7) !== mm ? ' out' : ''}${d === t0 ? ' today' : ''}`}>
              <div className="ov2-cal-num">{Number(d.slice(8))}</div>
              {list.slice(0, 4).map(t => (
                <button type="button" key={t.TripID} className={`ov2-tripchip ${ST_CLS[s(t['Booking Status'])] || 'yellow'}`} title={`${tripLabel(t)} · ${s(t.Company)} · ${s(t['Booking Status'])}`} onClick={() => onOpen(t)}>
                  {d === tripStart(t) ? '✈ ' : d === tripEnd(t) && tripEnd(t) !== tripStart(t) ? '↩ ' : inHotel(t, d) ? '🛏 ' : ''}{s(t.Traveller).split(' ')[0] || '—'} · {s(t['To City']) || s(t.Location)}
                </button>
              ))}
              {list.length > 4 && <div className="ov2-muted">+{list.length - 4} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TravelDesk({ trips, engagements, canEdit, canDelete, busy, onSave, onStatus, onAddFromConsultants, onAddBlank, onDelete, onRaiseVendors, onPushEC, onCheck }) {
  const [view, setView] = useState('list');
  const [q, setQ] = useState('');
  const [stF, setStF] = useState('Open');
  const [prog, setProg] = useState('');
  const [openId, setOpenId] = useState('');
  const engByKey = useMemo(() => Object.fromEntries(engagements.map(e => [keyOf(e), e])), [engagements]);

  if (!trips) return (
    <div className="card ov2-card"><div className="ov2-setup">
      <b>Travel Desk isn't set up yet.</b> In Operations Checklist.xlsx (the copy the Ops flow uses), add a sheet "Travel Desk" with a table named <b>TravelTable</b> (key column TripID).
      <div style={{ marginTop: 8 }}><button type="button" className="btn btn-outline btn-sm" onClick={onCheck}>Check again</button></div>
    </div></div>
  );

  const filtered = trips
    .filter(t => !prog || s(t['EC Index']) === prog)
    .filter(t => stF === 'All' || (stF === 'Open' ? !['Completed', 'Cancelled'].includes(s(t['Booking Status'])) : s(t['Booking Status']) === stF))
    .filter(t => !q || `${t.Traveller} ${t.Company} ${t.Program} ${t['From City']} ${t['To City']} ${t.TripID}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => tripStart(a).localeCompare(tripStart(b)));
  const byProg = filtered.reduce((m, t) => { (m[s(t['EC Index'])] ||= []).push(t); return m; }, {});
  const open = trips.find(t => t.TripID === openId);
  const progOptions = engagements.filter(e => !['Closed'].includes(s(e['Checklist Status']))).sort((a, b) => toISO(a['Start Date']).localeCompare(toISO(b['Start Date'])));

  return (
    <div className={`card ov2-card ov2-lib${open ? ' with-drawer' : ''}`}>
      <div className="ov2-lib-bar">
        <div className="ov2-tabs sm">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List <span>{filtered.length}</span></button>
          <button className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>Calendar</button>
        </div>
        <input className="form-input" placeholder="🔍 Traveller, client, city, trip" value={q} onChange={e => setQ(e.target.value)} />
        <select className="form-input ov2-mini" value={stF} onChange={e => setStF(e.target.value)}>
          {['Open', 'All', ...TRIP_STATUSES].map(x => <option key={x} value={x}>{x === 'Open' ? 'Open trips' : x === 'All' ? 'All trips' : x}</option>)}
        </select>
        <select className="form-input ov2-mini" style={{ maxWidth: 240 }} value={prog} onChange={e => setProg(e.target.value)}>
          <option value="">All programs</option>
          {progOptions.map(e => <option key={keyOf(e)} value={keyOf(e)}>{s(e.Company)} · {fmtD(toISO(e['Start Date']))}</option>)}
        </select>
        {busy && <span className="ov2-muted">{busy}</span>}
        {canEdit && prog && <>
          <button className="btn btn-primary btn-sm ov2-push" disabled={!!busy} onClick={() => onAddFromConsultants(prog)}>+ Trips for consultants</button>
          <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => onAddBlank(prog)}>+ Blank trip</button>
        </>}
        {canEdit && !prog && <span className="ov2-muted ov2-push">Pick a program to add trips</span>}
      </div>

      <div className="ov2-lib-main">
        {view === 'cal' ? <CalendarView trips={filtered.filter(isActiveTrip)} onOpen={t => setOpenId(t.TripID)} /> : (
          <div className="table-wrap ov2-tl">
            <table className="ov2-table">
              <thead><tr><th>Traveller</th><th>Route</th><th>Onward</th><th>Return</th><th>Stay</th><th>Mode · PNR</th><th>Cost</th><th>Status</th><th>Vendor rows</th></tr></thead>
              <tbody>
                {!filtered.length && <tr><td colSpan={9} className="ov2-empty">No trips{prog ? ' for this program yet — use “+ Trips for consultants”' : ''}.</td></tr>}
                {Object.entries(byProg).map(([k, list]) => {
                  const e = engByKey[k] || {};
                  const bill = billableTravelTotal(list);
                  return [
                    <tr key={`h-${k}`} className="ov2-phase"><td colSpan={9}>
                      {s(e.Company) || s(list[0].Company)} · {s(e.Topic) || s(list[0].Program)} · {fmtD(toISO(e['Start Date'] || list[0]['Program Start']))} · {s(e.Location) || s(list[0].Location)}
                      <span className="ov2-muted"> · billable {inr(bill)}</span>
                      {canEdit && bill > 0 && <button type="button" className="ov2-link sm" disabled={!!busy} onClick={() => onPushEC(k, bill)}>Update Engagement Calendar travel total</button>}
                    </td></tr>,
                    ...list.map(t => (
                      <tr key={t.TripID} className={`ov2-row${openId === t.TripID ? ' open' : ''}${isActiveTrip(t) ? '' : ' na'}`} onClick={() => setOpenId(t.TripID)} style={{ cursor: 'pointer' }}>
                        <td><b>{s(t.Traveller) || '—'}</b><div className="ov2-muted">{s(t['Traveller Role'])} · {s(t.TripID)}</div></td>
                        <td>{[s(t['From City']) || '?', s(t['To City']) || s(t.Location)].join(' → ')}</td>
                        <td>{fmtD(toISO(t['Onward Date']))}{s(t['Onward Time']) && <div className="ov2-muted">{s(t['Onward Time'])}</div>}</td>
                        <td>{fmtD(toISO(t['Return Date']))}{s(t['Return Time']) && <div className="ov2-muted">{s(t['Return Time'])}</div>}</td>
                        <td>{s(t['Hotel Name']) || '—'}{nightsOf(t) ? <div className="ov2-muted">{nightsOf(t)} night(s)</div> : null}</td>
                        <td>{s(t['Travel Mode']) || '—'}{s(t['Onward PNR']) && <div className="ov2-muted">{s(t['Onward PNR'])}</div>}</td>
                        <td>{inr(tripTotal(t))}</td>
                        <td><span className={`badge badge-${ST_CLS[s(t['Booking Status'])] || 'yellow'}`}>{s(t['Booking Status']) || 'Requested'}</span></td>
                        <td className="ov2-muted">{s(t['Vendor Service IDs']) || '—'}</td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {open && <TripDrawer key={open.TripID + s(open['Updated On'])} trip={open} canEdit={canEdit} canDelete={canDelete} busy={busy}
          onClose={() => setOpenId('')} onSave={onSave} onStatus={onStatus} onRaiseVendors={onRaiseVendors}
          onDelete={async t => { if (await onDelete(t)) setOpenId(''); }} />}
      </div>
    </div>
  );
}
