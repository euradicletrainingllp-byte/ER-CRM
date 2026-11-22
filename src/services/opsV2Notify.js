/**
 * opsV2Notify.js — Ops Checklist v2 emails through the "CRM Notify" flow (emailPerson).
 *  - Checklist created → one email per owner listing that owner's steps and due dates.
 *  - Step marked Done  → owners of the next open step + the program's Ops Owner Emails.
 * Daily due / overdue reminders and escalation run in the "Ops Nudges" PA flow (docs/ops-checklist-v2.md).
 * An email never blocks a save.
 */
import { emailPerson } from './notifier.js';
import { splitEmails, toISO } from './opsV2Engine.js';

const TRACKER = { tracker: 'ops', trackerName: 'Ops Checklist' };
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = iso => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const link = () => (typeof window !== 'undefined' ? `${window.location.origin}/ops` : '/ops');
const progName = eng => `${eng.Company || ''}${eng.Topic ? ` — ${eng.Topic}` : ''}`;

const table = rows => `<table cellpadding="6" style="border-collapse:collapse;font:13px Arial;border:1px solid #E5E7EB">
<tr style="background:#2D3047;color:#fff"><th align="left">Step</th><th align="left">Phase</th><th align="left">Due</th></tr>
${rows.map(r => `<tr><td style="border-top:1px solid #E5E7EB">${esc(r.Step)}</td><td style="border-top:1px solid #E5E7EB">${esc(r.Phase)}</td><td style="border-top:1px solid #E5E7EB">${fmt(toISO(r['Due Date']))}</td></tr>`).join('')}
</table>`;

const wrap = (eng, body) => `<div style="font:14px Arial;color:#4B5563">
<p><b style="color:#2D3047">${esc(progName(eng))}</b><br>Program start: ${fmt(toISO(eng['Start Date']))}</p>
${body}
<p><a href="${link()}" style="color:#3E3264">Open Ops Checklist</a></p></div>`;

export function notifyChecklistCreated(eng, tasks, actor = {}) {
  const byOwner = new Map();
  for (const t of tasks) {
    if (t.Applicable === 'NA') continue;
    for (const e of splitEmails(t['Owner Emails'])) byOwner.set(e, [...(byOwner.get(e) || []), t]);
  }
  for (const [to, rows] of byOwner) {
    emailPerson({ to, ...TRACKER, actor,
      subject: `Ops checklist: ${rows.length} step${rows.length === 1 ? '' : 's'} for ${eng.Company} (starts ${fmt(toISO(eng['Start Date']))})`,
      html: wrap(eng, `<p>A checklist has been opened. These steps are assigned to your department:</p>${table(rows)}`) });
  }
  return byOwner.size;
}

export function notifyStepDone(eng, doneRow, nextRow, actor = {}) {
  const to = new Set([...splitEmails(nextRow?.['Owner Emails']), ...splitEmails(eng['Ops Owner Emails'])]);
  to.delete(String(actor.email || '').toLowerCase());
  const body = `<p><b>Done:</b> ${esc(doneRow.Step)} (by ${esc(actor.name || actor.email || 'CRM')})</p>`
    + (nextRow ? `<p><b>Next step:</b> ${esc(nextRow.Step)} — due ${fmt(toISO(nextRow['Due Date']))}</p>` : '<p>All applicable steps are done.</p>');
  for (const e of to) {
    emailPerson({ to: e, ...TRACKER, actor,
      subject: nextRow ? `Ops checklist: "${nextRow.Step}" is next for ${eng.Company}` : `Ops checklist complete: ${eng.Company}`,
      html: wrap(eng, body) });
  }
  return to.size;
}
