/**
 * Step Library + Lists editors for Ops Checklist v2.
 * Pure UI — every write goes through the callbacks from OpsChecklistV2.jsx.
 */
import { useState, useMemo, Fragment } from 'react';
import OwnerChips, { DeptChips } from './OwnerChips.jsx';
import { splitEmails, joinEmails, ownersForDept, seqBetween, fmtTat, tatLabel, isValidTat } from '../../services/opsV2Engine.js';

const s = v => String(v ?? '').trim();
const withCur = (opts, cur) => (cur && !opts.includes(cur) ? [...opts, cur] : opts);
const LIST_NAMES = [['Phase', 'Phases'], ['Offering', 'Offerings'], ['Mode', 'Modes'], ['Waiting On', 'Waiting on']];

function Cell({ value, type = 'text', onCommit, disabled, className = '' }) {
  return <input key={String(value)} className={`form-input ov2-cell ${className}`} type={type} min={type === 'number' ? 0 : undefined} defaultValue={value}
    disabled={disabled} onKeyDown={e => e.key === 'Enter' && e.target.blur()}
    onBlur={e => { const v = type === 'number' ? Number(e.target.value) || 0 : e.target.value.trim(); if (String(v) !== String(value) && (type === 'number' || v)) onCommit(v); }} />;
}
function Pick({ value, options, onCommit, disabled }) {
  return <select className="form-input ov2-cell" value={value} disabled={disabled} onChange={e => onCommit(e.target.value)}>{withCur(options, value).map(o => <option key={o}>{o}</option>)}</select>;
}

function StepDrawer({ draft, isNew, lists, departments, members, onClose, onSave, saving }) {
  const [f, setF] = useState(draft);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const emails = splitEmails(f.ownerEmails);
  const deptOwners = ownersForDept(f.dept, departments, members);
  const changed = Object.keys(f).filter(k => String(f[k] ?? '') !== String(draft[k] ?? ''));
  const ok = s(f.step) && isValidTat(f.tat) && (isNew || changed.length);
  const num = (k, label) => <label>{label}<input className="form-input" type="number" min="0" value={f[k]} onChange={e => set(k, Number(e.target.value) || 0)} /></label>;
  return (
    <aside className="ov2-drawer">
      <div className="ov2-drawer-head"><b>{isNew ? 'New step' : `${f.id} · edit step`}</b><button className="ov2-x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="ov2-drawer-body">
        <label>Step<input className="form-input" value={f.step} onChange={e => set('step', e.target.value)} autoFocus={isNew} /></label>
        <div className="ov2-two">
          <label>Phase<select className="form-input" value={f.phase} onChange={e => set('phase', e.target.value)}>{withCur(lists.phases, f.phase).map(o => <option key={o}>{o}</option>)}</select></label>
          <label>Seq<input className="form-input" type="number" value={f.seq} onChange={e => set('seq', Number(e.target.value) || 0)} /></label>
        </div>
        <label>What to do<textarea className="form-input" rows={3} value={f.what} onChange={e => set('what', e.target.value)} /></label>
        <label>Done when<textarea className="form-input" rows={2} value={f.doneWhen} onChange={e => set('doneWhen', e.target.value)} /></label>
        <div className="ov2-lbl">Owner departments</div>
        <DeptChips value={f.dept} departments={departments} onChange={v => set('dept', v)} />
        <div className="ov2-lbl">Default owners</div>
        <OwnerChips emails={emails} departments={departments} members={members} onChange={l => set('ownerEmails', joinEmails(l))}
          emptyText={`None — all ${f.dept} members (${deptOwners.length})`} />
        <div className="ov2-two">
          <label title='"2" = 2 days before, "+2" = 2 days after, "0" = on the day'>TAT · {isValidTat(f.tat) ? tatLabel(f.tat, f.anchor) : 'e.g. 2 or +2'}
            <input className="form-input" value={f.tat} onChange={e => set('tat', e.target.value)} placeholder="2 or +2" /></label>
          <label>Anchor<select className="form-input" value={f.anchor} onChange={e => set('anchor', e.target.value)}><option>Start</option><option>End</option></select></label>
        </div>
        <div className="ov2-two">
          <label>Applies to mode<select className="form-input" value={f.mode || 'All'} onChange={e => set('mode', e.target.value)}>{withCur(['All', ...lists.modes], f.mode).map(o => <option key={o}>{o}</option>)}</select></label>
          <label>Applies to offering<select className="form-input" value={f.offering || 'All'} onChange={e => set('offering', e.target.value)}>{withCur(['All', ...lists.offerings], f.offering).map(o => <option key={o}>{o}</option>)}</select></label>
        </div>
        <div className="ov2-two">
          <label>Required<select className="form-input" value={f.required} onChange={e => set('required', e.target.value)}><option>Required</option><option>Optional</option></select></label>
          <label>Active<select className="form-input" value={f.active ? 'Yes' : 'No'} onChange={e => set('active', e.target.value === 'Yes')}><option>Yes</option><option>No</option></select></label>
        </div>
        <div className="ov2-two">
          {num('remindBefore', 'Remind before (days)')}
          {num('escalateAfter', 'Escalate after (days)')}
        </div>
        <label>Escalate to<input className="form-input" value={f.escalateTo} onChange={e => set('escalateTo', e.target.value)} placeholder="e.g. Ops Head" /></label>
      </div>
      <div className="ov2-drawer-foot">
        <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
        <button className="btn btn-cta btn-sm" disabled={!ok || saving}
          onClick={() => { const g = { ...f, tat: fmtTat(f.tat) }; onSave(isNew ? g : Object.fromEntries(changed.map(k => [k, g[k]]))); }}>{saving ? 'Saving…' : isNew ? 'Add step' : 'Save'}</button>
      </div>
    </aside>
  );
}

function ListsPanel({ rows, onSave, onAdd, canEdit }) {
  const [adding, setAdding] = useState({});
  if (!rows) return (
    <div className="ov2-setup">
      <b>Lists can't be edited yet.</b> In Operations Checklist.xlsx, convert the <b>Lists</b> sheet into a table named <b>ListTable</b> with columns
      <code>ListID · List · Value · Order · Active</code> (one row per value, e.g. LST-001 · Phase · 1. Setup · 1 · Yes), then allow ListTable in the OPS_V2_CRUD flow's valid tables.
      Until then the editors use the values already in the Step Library.
    </div>
  );
  return (
    <div className="ov2-lists">
      {LIST_NAMES.map(([name, label]) => {
        const vals = rows.filter(r => s(r.List).toLowerCase() === name.toLowerCase()).sort((a, b) => Number(a.Order) - Number(b.Order));
        const move = (i, d) => { const a = vals[i], b = vals[i + d]; if (!b) return; onSave(a, { Order: b.Order }); onSave(b, { Order: a.Order }); };
        return (
          <div key={name} className="card ov2-list-card">
            <div className="card-header"><span className="card-title">{label}</span><span className="ov2-muted">{vals.length}</span></div>
            {vals.map((r, i) => (
              <div key={r.ListID} className={`ov2-lv${/^(no|false)$/i.test(s(r.Active)) ? ' off' : ''}`}>
                <Cell value={s(r.Value)} disabled={!canEdit} onCommit={v => onSave(r, { Value: v })} />
                {canEdit && <>
                  <button type="button" className="ov2-icon" disabled={!i} onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button type="button" className="ov2-icon" disabled={i === vals.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                  <label className="ov2-switch" title="Active"><input type="checkbox" checked={!/^(no|false)$/i.test(s(r.Active))} onChange={e => onSave(r, { Active: e.target.checked ? 'Yes' : 'No' })} /><span /></label>
                </>}
              </div>
            ))}
            {canEdit && <div className="ov2-lv">
              <input className="form-input ov2-cell" placeholder="+ Add value" value={adding[name] || ''} onChange={e => setAdding(a => ({ ...a, [name]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && s(adding[name])) { onAdd(name, s(adding[name])); setAdding(a => ({ ...a, [name]: '' })); } }} />
            </div>}
          </div>
        );
      })}
    </div>
  );
}

export default function StepLibrary({ steps, departments, members, lists, listRows, canEdit, propagate, setPropagate, onSaveStep, onAddStep, onSaveList, onAddList, busy }) {
  const [sub, setSub] = useState('steps');
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [drawer, setDrawer] = useState(null);       // { draft, isNew }
  const nameOf = e => members.find(m => m.email === e)?.name || e.split('@')[0];

  const rows = useMemo(() => [...steps].sort((a, b) => a.seq - b.seq)
    .filter(st => (showOff || st.active) && (!q || `${st.id} ${st.step} ${st.dept} ${st.phase}`.toLowerCase().includes(q.toLowerCase()))), [steps, q, showOff]);
  const save = (st, fields) => onSaveStep(st, fields);
  const openNew = (after, next) => setDrawer({ isNew: true, draft: {
    id: '', seq: seqBetween(after?.seq ?? 0, next?.seq), phase: after?.phase || lists.phases[0] || '', step: '', what: '', doneWhen: '',
    dept: after?.dept || 'Operations', ownerEmails: '', anchor: after?.anchor || 'Start', offset: 0, tat: '1', mode: 'All', offering: 'All',
    required: 'Required', remindBefore: 1, escalateAfter: 2, escalateTo: after?.escalateTo || '', active: true } });

  return (
    <div className={`card ov2-card ov2-lib${drawer ? ' with-drawer' : ''}`}>
      <div className="ov2-lib-bar">
        <div className="ov2-tabs sm">
          <button className={sub === 'steps' ? 'on' : ''} onClick={() => setSub('steps')}>Steps <span>{steps.filter(x => x.active).length}</span></button>
          <button className={sub === 'lists' ? 'on' : ''} onClick={() => { setSub('lists'); setDrawer(null); }}>Lists</button>
        </div>
        {sub === 'steps' && <>
          <input className="form-input" placeholder="🔍 Step, dept, phase" value={q} onChange={e => setQ(e.target.value)} />
          <label className="ov2-check"><input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> Show inactive</label>
          {canEdit && <label className="ov2-check strong" title="Step name, phase, Seq, TAT and owners are copied to steps not yet done in active programs; dates are recalculated">
            <input type="checkbox" checked={propagate} onChange={e => setPropagate(e.target.checked)} /> Also update open checklists</label>}
          {busy && <span className="ov2-muted">{busy}</span>}
          {canEdit && <button className="btn btn-primary btn-sm ov2-push" onClick={() => { const all = [...steps].sort((a, b) => a.seq - b.seq); openNew(all[all.length - 1], undefined); }}>+ Add step</button>}
        </>}
      </div>

      {sub === 'lists' ? <ListsPanel rows={listRows} onSave={onSaveList} onAdd={onAddList} canEdit={canEdit} /> : (
        <div className="ov2-lib-main">
          <div className="table-wrap ov2-tl">
            <table className="ov2-table ov2-libt">
              <thead><tr><th>Seq</th><th>Step</th><th>Owner Depts</th><th>Default owners</th><th title='From program start (End anchor: end). 2 = 2 days before, +2 = 2 days after'>TAT</th><th>Anchor</th><th>Mode</th><th>Offering</th><th>Required</th><th>Active</th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={10} className="ov2-empty">No steps.</td></tr>}
                {rows.map((st, i) => {
                  const newPhase = i === 0 || rows[i - 1].phase !== st.phase;
                  const fixed = splitEmails(st.ownerEmails);
                  return (
                    <Fragment key={st.id}>
                      {newPhase && <tr className="ov2-phase"><td colSpan={10}>{st.phase || '—'}</td></tr>}
                      <tr className={`ov2-row${st.active ? '' : ' na'}${drawer?.draft.id === st.id ? ' open' : ''}`}>
                        <td><Cell type="number" value={st.seq} disabled={!canEdit} onCommit={v => save(st, { seq: v })} className="ov2-num" /></td>
                        <td className="ov2-step-cell">
                          <Cell value={st.step} disabled={!canEdit} onCommit={v => save(st, { step: v })} />
                          <button type="button" className="ov2-link sm" onClick={() => setDrawer({ isNew: false, draft: { ...st } })}>{st.id} · details</button>
                        </td>
                        <td className="ov2-dept-cell"><DeptChips value={st.dept} departments={departments} disabled={!canEdit} onChange={v => save(st, { dept: v })} /></td>
                        <td className="ov2-own">{fixed.length ? fixed.map(nameOf).join('; ') : <span className="ov2-muted">All {st.dept} ({ownersForDept(st.dept, departments, members).length})</span>}</td>
                        <td title={tatLabel(st.tat, st.anchor)}><Cell value={st.tat} disabled={!canEdit} className="ov2-num"
                          onCommit={v => (isValidTat(v) ? fmtTat(v) !== st.tat && save(st, { tat: fmtTat(v) }) : alert('TAT must be a whole number like 2 or +2.'))} /></td>
                        <td><Pick value={st.anchor} options={['Start', 'End']} disabled={!canEdit} onCommit={v => save(st, { anchor: v })} /></td>
                        <td><Pick value={st.mode || 'All'} options={['All', ...lists.modes]} disabled={!canEdit} onCommit={v => save(st, { mode: v })} /></td>
                        <td><Pick value={st.offering || 'All'} options={['All', ...lists.offerings]} disabled={!canEdit} onCommit={v => save(st, { offering: v })} /></td>
                        <td><Pick value={st.required} options={['Required', 'Optional']} disabled={!canEdit} onCommit={v => save(st, { required: v })} /></td>
                        <td><label className="ov2-switch"><input type="checkbox" checked={st.active} disabled={!canEdit} onChange={e => save(st, { active: e.target.checked })} /><span /></label></td>
                      </tr>
                      {canEdit && <tr className="ov2-insert"><td colSpan={10}><button type="button" onClick={() => openNew(st, rows[i + 1])}>+ Add step here</button></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {drawer && <StepDrawer key={drawer.draft.id || 'new'} draft={drawer.draft} isNew={drawer.isNew} lists={lists} departments={departments} members={members}
            saving={!!busy} onClose={() => setDrawer(null)}
            onSave={async fields => { const ok = drawer.isNew ? await onAddStep(fields) : await save(drawer.draft, fields); if (ok !== false) setDrawer(null); }} />}
        </div>
      )}
    </div>
  );
}
