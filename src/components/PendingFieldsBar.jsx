import { useState, useEffect, useRef, useMemo } from 'react';
import { BellRing, X, ArrowRight, AlertTriangle, CalendarClock, ListChecks } from 'lucide-react';

/**
 * Reminders popup (PendingFieldsBar)
 * ──────────────────────────────────
 * Floating button in the bottom-right corner of every tracker. Tapping it opens a
 * card with three sections (tabs):
 *   • Overdue          — tasks whose due date / TAT has passed (most overdue first)
 *   • Due in 7 days    — tasks due today or within the next 7 days (soonest first)
 *   • Missing fields   — records with empty fields, in serial (S No) order
 * Tapping a chip closes the card and opens / scrolls to that record and field.
 * The card closes with ✕, "Later", Esc, or a click anywhere outside it.
 *
 * items:     [{ id, serial, title, subtitle, missing: [{ key, label }] }]   (missing fields, serial order)
 * dueItems:  [{ id, serial, title, subtitle, tasks: [{ key, label, due: 'YYYY-MM-DD' }] }]
 * onPick(item, field) / onPickDue(item, task)
 */
export const DUE_SOON_DAYS = 7;

const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const daysFromToday = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(todayIso() + 'T00:00:00Z')) / 86400000);
const fmtShort = iso => {
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
};
const dueText = days => (days < 0 ? `${-days}d overdue` : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `in ${days}d`);

/** Split due tasks into the Overdue and Due-soon sections, each record sorted by its earliest task. */
function splitDue(dueItems) {
  const over = [], soon = [];
  (dueItems || []).forEach(it => {
    const tasks = (it.tasks || []).filter(t => t.due && /^\d{4}-\d{2}-\d{2}$/.test(t.due))
      .map(t => ({ ...t, days: daysFromToday(t.due) }));
    const o = tasks.filter(t => t.days < 0).sort((a, b) => a.days - b.days);
    const s = tasks.filter(t => t.days >= 0 && t.days <= DUE_SOON_DAYS).sort((a, b) => a.days - b.days);
    if (o.length) over.push({ ...it, tasks: o, first: o[0].days });
    if (s.length) soon.push({ ...it, tasks: s, first: s[0].days });
  });
  over.sort((a, b) => a.first - b.first);
  soon.sort((a, b) => a.first - b.first);
  return { over, soon };
}

const plural = (n, noun) => (n === 1 ? noun : /[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's');

export default function PendingFieldsBar({ items = [], dueItems = [], onPick, onPickDue, canEdit = true, noun = 'record' }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(null);
  const cardRef = useRef(null);
  const { over, soon } = useMemo(() => splitDue(dueItems), [dueItems]);

  const overCount  = over.reduce((t, it) => t + it.tasks.length, 0);
  const soonCount  = soon.reduce((t, it) => t + it.tasks.length, 0);
  const fieldCount = items.reduce((t, it) => t + it.missing.length, 0);
  const total = overCount + soonCount + fieldCount;

  // Close on Esc or a click outside the card
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    const onDown = e => { if (cardRef.current && !cardRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  useEffect(() => { if (!total) setOpen(false); }, [total]);
  if (!total) return null;

  const tabs = [
    { id: 'over',  label: 'Overdue',  tip: 'Past the due date / TAT',                     count: overCount,  Icon: AlertTriangle },
    { id: 'soon',  label: 'Due soon', tip: `Due today or within ${DUE_SOON_DAYS} days`, count: soonCount,  Icon: CalendarClock },
    { id: 'field', label: 'Missing',  tip: 'Empty fields to fill',                          count: fieldCount, Icon: ListChecks },
  ];
  // Default: the most urgent section that has something in it
  const active = (tab && tabs.find(t => t.id === tab)?.count) ? tab : tabs.find(t => t.count)?.id;

  const openCard = () => { setTab(null); setOpen(true); };
  const pickField = (it, f) => { if (!canEdit || !onPick) return; setOpen(false); onPick(it, f); };
  const pickDue = (it, t) => { if (!onPickDue) return; setOpen(false); onPickDue(it, t); };

  if (!open) {
    return (
      <button type="button" className={`pf-launch${overCount ? ' pf-pulse' : ''}`} onClick={openCard}
        title={[overCount && `${overCount} overdue`, soonCount && `${soonCount} due in ${DUE_SOON_DAYS} days`, fieldCount && `${fieldCount} missing fields`].filter(Boolean).join(' · ')}>
        <BellRing size={14} strokeWidth={2} />
        <span className="pf-word">Reminders</span>
        {overCount > 0 && <span className="pf-count pf-c-over">{overCount}</span>}
        {soonCount > 0 && <span className="pf-count pf-c-soon">{soonCount}</span>}
        {fieldCount > 0 && <span className="pf-count pf-c-field">{fieldCount}</span>}
      </button>
    );
  }

  const sub = {
    over:  <><strong>{overCount}</strong> past due / TAT · {over.length} {plural(over.length, noun)} · most overdue first</>,
    soon:  <><strong>{soonCount}</strong> due within {DUE_SOON_DAYS} days · {soon.length} {plural(soon.length, noun)} · soonest first</>,
    field: <><strong>{fieldCount}</strong> empty {plural(fieldCount, 'field')} · {items.length} {plural(items.length, noun)} · serial order{canEdit ? '' : ' · view only'}</>,
  }[active];

  const dueList = active === 'over' ? over : soon;
  const firstDue = dueList[0];

  return (
    <div className="pf-card" ref={cardRef} role="dialog" aria-label="Reminders">
      <div className="pf-card-head">
        <div className="pf-card-title"><span className="pf-card-icon"><BellRing size={14} strokeWidth={2} /></span>Reminders</div>
        <button type="button" className="pf-close" onClick={() => setOpen(false)} aria-label="Close"><X size={15} strokeWidth={2} /></button>
        <div className="pf-tabs" role="tablist">
          {tabs.map(({ id, label, tip, count, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={active === id} disabled={!count} title={tip}
              className={`pf-tab pf-tab-${id}${active === id ? ' on' : ''}`} onClick={() => setTab(id)}>
              <Icon size={12} strokeWidth={2} />
              <span className="pf-tab-label">{label}</span>
              <span className="pf-tab-count">{count}</span>
            </button>
          ))}
        </div>
        <p className="pf-card-sub">{sub}</p>
      </div>

      <div className="pf-list">
        {active === 'field' ? items.map((it, idx) => (
          <div key={it.id} className="pf-row">
            <span className="pf-serial" title="Serial order">{idx + 1}</span>
            <div className="pf-rec">
              <div className="pf-rec-title">
                {it.serial ? <span className="pf-sno">#{it.serial}</span> : null}
                <span className="pf-name" title={it.title}>{it.title}</span>
              </div>
              {it.subtitle && <div className="pf-sub" title={it.subtitle}>{it.subtitle}</div>}
              <div className="pf-chips">
                {it.missing.map(f => (
                  <button type="button" key={f.key} className="pf-chip pf-chip-field" disabled={!canEdit}
                    title={canEdit ? `Open the edit form at "${f.label}"` : 'View only — no edit access'}
                    onClick={() => pickField(it, f)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )) : dueList.map((it, idx) => (
          <div key={it.id} className="pf-row">
            <span className={`pf-serial pf-serial-${active}`}>{idx + 1}</span>
            <div className="pf-rec">
              <div className="pf-rec-title">
                {it.serial ? <span className="pf-sno">#{it.serial}</span> : null}
                <span className="pf-name" title={it.title}>{it.title}</span>
              </div>
              {it.subtitle && <div className="pf-sub" title={it.subtitle}>{it.subtitle}</div>}
              <div className="pf-chips">
                {it.tasks.map(t => (
                  <button type="button" key={t.key} className={`pf-chip pf-chip-${active}`}
                    title={`${t.label} — due ${fmtShort(t.due)}. Tap to open.`} onClick={() => pickDue(it, t)}>
                    {t.label} <span className="pf-chip-when">· {dueText(t.days)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pf-card-foot">
        <button type="button" className="pf-later" onClick={() => setOpen(false)}>Later</button>
        {active === 'field' ? (canEdit && (
          <button type="button" className="pf-next" onClick={() => pickField(items[0], items[0].missing[0])}
            title={`${items[0].serial ? `#${items[0].serial} ` : ''}${items[0].title} — ${items[0].missing[0].label}`}>
            <span>Fill next field</span>
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        )) : firstDue && (
          <button type="button" className="pf-next" onClick={() => pickDue(firstDue, firstDue.tasks[0])}
            title={`${firstDue.serial ? `#${firstDue.serial} ` : ''}${firstDue.title} — ${firstDue.tasks[0].label}`}>
            <span>{active === 'over' ? 'Open most overdue' : 'Open next due'}</span>
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Jump to a field inside the form that has just opened ─────────────────
   Looks for (in order): [data-pf="key"], [name="key"], then a label whose text
   matches the field label. Retries for ~2 s while the form mounts.            */
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function findField(key, label) {
  const byPf = document.querySelector(`[data-pf="${CSS.escape(key)}"]`);
  if (byPf) return byPf;
  const byName = document.querySelector(`[name="${CSS.escape(key)}"]`);
  if (byName) return byName.closest('.form-field') || byName.parentElement || byName;

  // Search the top-most open form (modal) first, then the whole page
  const overlays = [...document.querySelectorAll('.modal-overlay, .modal-box, [style*="position: fixed"]')];
  const roots = [...overlays.reverse(), document];
  const target = norm(label);
  if (!target) return null;
  for (const root of roots) {
    const labels = [...root.querySelectorAll('label, .form-label')];
    const hit = labels.find(l => norm(l.textContent) === target)
             || labels.find(l => norm(l.textContent).startsWith(target));
    if (hit) return hit.closest('.form-field') || hit.parentElement;
  }
  return null;
}

export function revealField(key, label, { tries = 40 } = {}) {
  let n = 0;
  const attempt = () => {
    const box = findField(key, label);
    if (!box) { if (++n < tries) setTimeout(attempt, 50); return; }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('pf-flash');
    void box.offsetWidth;                 // restart the animation
    box.classList.add('pf-flash');
    setTimeout(() => box.classList.remove('pf-flash'), 2800);
    const input = box.matches?.('input, select, textarea') ? box
      : box.querySelector('input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 120);
  };
  setTimeout(attempt, 30);
}
