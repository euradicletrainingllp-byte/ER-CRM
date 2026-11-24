/**
 * OpsOverview — "My tasks" tab of Ops Checklist v2: one section per phase listing the programs
 * pending in it (most-lagging first), drill-down to the steps.
 * Scope: my steps (owner email) or all active programs.
 */
import { useEffect, useMemo, useState } from 'react';
import { STATUSES, splitEmails, toISO, addDays, daysBetween } from '../../services/opsV2Engine.js';

const s = v => String(v ?? '').trim();
const fmtD = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
const ACTIVE = e => !['Closed', 'Delivered'].includes(s(e?.['Checklist Status']));
const STATUS_CLS = { 'Not Started': 'gray', 'In Progress': 'info', Waiting: 'yellow', Blocked: 'red', Done: 'green', NA: 'gray' };

export default function OpsOverview({ timelines, engByKey, phases = [], myEmail, today, scopeAll, setScopeAll, canEdit, onStatus, onOpen, todoIds, onTodo, busy }) {
  const [pick, setPick] = useState(null);            // { k, phase }
  const week = addDays(today, 7);

  // One section per phase → programs with open steps in it
  const sections = useMemo(() => {
    const by = {};
    for (const [k, tl] of Object.entries(timelines)) {
      const eng = engByKey[k];
      if (!ACTIVE(eng)) continue;
      for (const t of tl) {
        if (!t.applicable || t.done || !(scopeAll || splitEmails(t.row['Owner Emails']).includes(myEmail))) continue;
        const ph = s(t.row.Phase) || '—';
        const sec = (by[ph] ||= {});
        const p = (sec[k] ||= { k, eng, open: 0, late: 0, maxLate: 0, week: 0, items: [] });
        p.open++; p.items.push(t);
        if (t.overdue) { p.late++; if (t.delay >= p.maxLate) { p.maxLate = t.delay; p.worstStep = s(t.row.Step); } }
        else { if (t.due <= week) p.week++; if (!p.next || t.due < p.next.due) p.next = { step: s(t.row.Step), due: t.due }; }
      }
    }
    const order = [...phases, ...Object.keys(by).filter(p => !phases.includes(p))];
    return order.map(ph => {
      const progs = Object.values(by[ph] || {}).sort((a, b) => (b.maxLate - a.maxLate) || (b.late - a.late) || toISO(a.eng['Start Date']).localeCompare(toISO(b.eng['Start Date'])));
      const missed = progs.filter(p => p.late);
      const rest = progs.filter(p => !p.late).sort((a, b) => (b.week > 0) - (a.week > 0) || (a.next?.due || '9').localeCompare(b.next?.due || '9'));
      return { ph, progs, missed, rest, late: progs.reduce((n, p) => n + p.late, 0), open: progs.reduce((n, p) => n + p.open, 0), worst: missed[0]?.maxLate || 0 };
    });
  }, [timelines, engByKey, phases, scopeAll, myEmail, week]);

  const sel = pick && sections.find(x => x.ph === pick.phase)?.progs.find(p => p.k === pick.k);
  const selItems = sel ? [...sel.items].sort((a, b) => (b.overdue - a.overdue) || a.due.localeCompare(b.due)) : [];
  const eligible = t => !t.done && t.due && t.due <= week;

  const [missOnly, setMissOnly] = useState(false);
  useEffect(() => { if (pick) document.getElementById('ov2-ovw-steps')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [pick]);
  const [showAll, setShowAll] = useState({});          // `${phase}|miss` / `${phase}|rest` → past the first LIMIT rows
  const LIMIT = 5;
  const more = (key, list) => (list.length > LIMIT && !showAll[key]
    ? <button type="button" className="ov2-sec-more" onClick={() => setShowAll(o => ({ ...o, [key]: true }))}>+ {list.length - LIMIT} more</button> : null);
  const cut = (key, list) => (showAll[key] ? list : list.slice(0, LIMIT));
  const totLate = sections.reduce((n, x) => n + x.late, 0);
  const totProgLate = new Set(sections.flatMap(x => x.missed.map(p => p.k))).size;
  const jump = ph => document.getElementById(`ov2-sec-${ph}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const row = (x, p, missed) => {
    const on = pick?.k === p.k && pick?.phase === x.ph;
    return (
      <button key={p.k} type="button" className={`ov2-sec-row${missed ? ' miss' : ''}${on ? ' on' : ''}`} onClick={() => setPick(on ? null : { k: p.k, phase: x.ph })}>
        <span className="ov2-sec-prog">
          <b>{p.eng.Company}</b>
          <small className="tp" title={s(p.eng.Topic)}>{s(p.eng.Topic) || '—'} · starts {fmtD(toISO(p.eng['Start Date']))}</small>
          {missed && p.worstStep ? <small className="st late">⚠ Late: <em>{p.worstStep}</em></small>
            : p.next ? <small className="st">→ Next: <em className="nx">{p.next.step}</em> · {fmtD(p.next.due)}</small> : null}
        </span>
        {missed
          ? <span className="ov2-miss-num"><b>{p.maxLate}d</b><small>{p.late} late</small></span>
          : <span className={`ov2-cnt${p.week ? ' soon' : ''}`}><b>{p.week || p.open}</b><small>{p.week ? 'due this wk' : 'open'}</small></span>}
      </button>
    );
  };

  return (
    <div className="ov2-ovw">
      <div className="ov2-ovw-bar">
        <span className="card-title">Pending by section</span>
        <span className={`ov2-miss-total${totLate ? '' : ' ok'}`}>{totLate ? `${totLate} steps past TAT · ${totProgLate} programs` : '✓ No TAT misses'}</span>
        <label className="ov2-miss-toggle"><input type="checkbox" checked={missOnly} onChange={e => setMissOnly(e.target.checked)} /> Misses only</label>
        <div className="ov2-ovw-scope">
          <button className={!scopeAll ? 'on' : ''} onClick={() => { setScopeAll(false); setPick(null); }}>My steps</button>
          <button className={scopeAll ? 'on' : ''} onClick={() => { setScopeAll(true); setPick(null); }}>All programs</button>
        </div>
      </div>

      <div className="ov2-sec-grid">
        {sections.filter(x => !missOnly || x.late).map(x => (
          <div key={x.ph} id={`ov2-sec-${x.ph}`} className={`card ov2-card ov2-sec${x.late ? ' has-late' : ''}`}>
            <div className="ov2-sec-head">
              <b>{x.ph}</b>
              <span className="ov2-muted">{x.progs.length} prog · {x.open} open</span>
              {x.late ? <span className="ov2-pill late">{x.late} late</span> : <span className="ov2-pill ok">On track</span>}
            </div>
            <div className="ov2-sec-body">
              {!x.progs.length && <div className="ov2-sec-clear">✓ Nothing pending</div>}
              {!!x.missed.length && <div className="ov2-sec-lbl miss">⚠ TAT missed · {x.missed.length}</div>}
              {cut(`${x.ph}|miss`, x.missed).map(p => row(x, p, true))}
              {more(`${x.ph}|miss`, x.missed)}
              {!missOnly && !!x.rest.length && <>
                <div className="ov2-sec-lbl open">Open tasks · {x.rest.reduce((n, p) => n + p.open, 0)} in {x.rest.length} prog</div>
                {cut(`${x.ph}|rest`, x.rest).map(p => row(x, p, false))}
                {more(`${x.ph}|rest`, x.rest)}
              </>}
            </div>
          </div>
        ))}
        {missOnly && !totLate && <div className="ov2-empty">✓ No TAT misses{scopeAll ? '' : ' in my steps'}.</div>}
      </div>

      <div className="ov2-ovw-low">
        <div className="card ov2-card" id="ov2-ovw-steps">
          <div className="card-header">
            <span className="card-title">{sel ? <>{sel.eng.Company} · {pick.phase} <button className="ov2-link" onClick={() => onOpen(sel.k)}>open program →</button></> : 'Steps'}</span>
            {sel && !!selItems.filter(t => eligible(t) && !todoIds.has(s(t.row.TaskID))).length && (
              <button className="btn btn-outline btn-sm" disabled={busy === 'todo'} onClick={() => onTodo(selItems.filter(t => eligible(t) && !todoIds.has(s(t.row.TaskID))))}>+ Add due-this-week to To-Do</button>
            )}
          </div>
          {!sel ? <div className="ov2-empty">Select a program in a section to see its pending steps.</div> : (
            <div className="table-wrap">
              <table className="ov2-table">
                <thead><tr><th>Step</th><th>Owners</th><th>Due</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {!selItems.length && <tr><td colSpan={5} className="ov2-empty">All done.</td></tr>}
                  {selItems.map((t, i) => {
                    const d = daysBetween(today, t.due); const id = s(t.row.TaskID);
                    return (
                      <tr key={`${id}-${i}`} className={t.overdue ? 'late' : ''}>
                        <td>{t.row.Step}</td>
                        <td className="ov2-muted">{s(t.row['Owner Names']) || '—'}</td>
                        <td><span className={t.overdue ? 'ov2-due late' : d <= 2 ? 'ov2-due soon' : 'ov2-due'}>{fmtD(t.due)}<small>{t.overdue ? ` · ${-d}d late` : d === 0 ? ' · today' : ` · in ${d}d`}</small></span></td>
                        <td>{canEdit ? <select className={`form-input ov2-status ${STATUS_CLS[s(t.row.Status)] || ''}`} value={s(t.row.Status) || 'Not Started'} onChange={e => onStatus(t.row, e.target.value)}>{STATUSES.filter(x => x !== 'NA').map(x => <option key={x}>{x}</option>)}</select> : s(t.row.Status)}</td>
                        <td className="ov2-ovw-act">
                          {canEdit && <button className="btn btn-cta btn-sm" onClick={() => onStatus(t.row, 'Done')}>Mark done</button>}
                          {todoIds.has(id) ? <span className="ov2-todo-in">✓ In To-Do</span>
                            : eligible(t) && <button className="btn btn-outline btn-sm" disabled={busy === 'todo'} onClick={() => onTodo([t])}>+ To-Do</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
