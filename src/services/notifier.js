/**
 * EURADICLE CRM — EMAIL NOTIFICATIONS
 * =====================================
 * Every Create / Delete in a tracker sends an email to everyone who has View
 * (Read) access to that tracker in the Admin Panel. Updates do NOT send an email
 * (23 Oct 2026) — they stay in the activity log only. Change NOTIFY_OPTIONS.actions
 * to bring them back.
 *
 * How it works
 *  - Hooks into the activity log (auditLogger.onAuditEvent), which already sees
 *    every tracker write with its before / after values. No page code changes.
 *  - The tracker is decided by the page the change was made on, because some
 *    trackers share one Excel file (BD + Solution → Solutioning_Tracker.xlsx,
 *    Engagement Calendar + Finance → Engagement Calendar master).
 *  - Changes are held for a few seconds and grouped per tracker, so one save,
 *    a burst of checkbox ticks or a multi-row add becomes ONE email, not ten.
 *  - Recipients come from the live Admin Panel permissions (PermissionsContext).
 *    The admin always has View access, so is always included.
 *  - Sent through the Power Automate flow "CRM Notify" (FLOW_URLS.NOTIFY).
 *    Leave NOTIFY as "" to switch emails off. A failed email never affects a save.
 *  - System writes (BD S No renumbering) and failed saves send nothing.
 */
import FLOW_URLS from '../config/powerAutomate.js';
import { ADMIN_EMAIL } from '../config/permissions.js';
import { onAuditEvent, normVal } from './auditLogger.js';

// ── Switches ─────────────────────────────────────────────────────────────────
export const NOTIFY_OPTIONS = {
  includeActor:  true,    // the person who made the change also gets the email
  quietMs:       10000,   // send once a tracker has had no new change for 10 s
  maxWaitMs:     45000,   // …but never hold a change longer than 45 s
  maxRecords:    25,      // records listed in one email (rest summarised)
  maxFields:     30,      // fields listed per record
  // Which actions send an email. 'UPDATE' left out on purpose: edits are logged, not emailed.
  // (An edit made within a few seconds of creating a record is folded into the "created" email.)
  actions:       ['CREATE', 'DELETE'],
};

// ── Trackers ─────────────────────────────────────────────────────────────────
export const NOTIFY_TRACKERS = {
  bd:            { name: 'BD Tracker',          route: '/bd-tracker' },
  solution:      { name: 'Solution Tracker',    route: '/solution' },
  engagement:    { name: 'Engagement Calendar', route: '/engagement' },
  finance:       { name: 'Finance Tracker',     route: '/finance' },
  ops:           { name: 'Ops Checklist',       route: '/ops' },
  'content-dev': { name: 'Content Dev Tracker', route: '/content-dev' },
  leads:         { name: 'Lead Tracker',        route: '/leads' },
  vendors:       { name: 'Vendor Service Tracker', route: '/vendors' },
};

// Activity-log Module (= Excel store) → trackers that show that store.
// The first one is used when the change was made from another page.
const STORE_TRACKERS = {
  bd:            ['bd'],
  solution:      ['solution', 'bd'],
  engagement:    ['engagement', 'finance'],
  ops:           ['ops'],
  'content-dev': ['content-dev'],
  leads:         ['leads'],
  vendors:       ['vendors'],
};

const ROUTE_TRACKER = {
  '/bd-tracker': 'bd', '/solution': 'solution', '/engagement': 'engagement',
  '/er-calendar': 'engagement', '/finance': 'finance', '/ops': 'ops', '/content-dev': 'content-dev',
  '/leads': 'leads', '/vendors': 'vendors',
};

function trackerFor(module, route) {
  const options = STORE_TRACKERS[module];
  if (!options) return null;
  const onPage = ROUTE_TRACKER[String(route || '').replace(/\/+$/, '') || '/'];
  return options.includes(onPage) ? onPage : options[0];
}

// ── Recipients (live Admin Panel permissions) ────────────────────────────────
let directory = {};

/** Called by PermissionsContext whenever permissions load or change. */
export function setNotifyDirectory(perms) {
  if (perms && typeof perms === 'object') directory = perms;
}

export function recipientsFor(tracker, actorEmail = '') {
  const out = new Set();
  for (const [email, cfg] of Object.entries(directory)) {
    if (cfg?.crud?.[tracker]?.read) out.add(email.toLowerCase().trim());
  }
  if (ADMIN_EMAIL) out.add(ADMIN_EMAIL.toLowerCase());
  const me = String(actorEmail || '').toLowerCase().trim();
  if (!NOTIFY_OPTIONS.includeActor && me) out.delete(me);
  return [...out].filter(e => e.includes('@'));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

const HIDDEN_FIELD = k => !k || k.startsWith('@') || k === 'ItemInternalId' || k === '__rowNum';

function show(v) {
  const n = normVal(v);
  if (n === '') return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) {
    const d = new Date(n + 'T00:00:00Z');
    if (!isNaN(d)) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return n.length > 300 ? n.slice(0, 299) + '…' : n;
}

const VERB = { CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted' };

// ── Buffer: tracker → { actor, first, timer, records: Map(recordKey → item) } ─
const buffers = new Map();

function addChange(ev) {
  const tracker = trackerFor(ev.Module, ev.Route);
  if (!tracker) return;

  const actor = { email: ev.UserEmail || '', name: ev.UserName || ev.UserEmail || 'Someone' };
  const bufKey = `${tracker}|${actor.email}`;
  let buf = buffers.get(bufKey);
  if (!buf) { buf = { tracker, actor, first: Date.now(), timer: null, records: new Map() }; buffers.set(bufKey, buf); }

  const oldV = parseJson(ev.OldValues), newV = parseJson(ev.NewValues);
  const recKey = ev.RecordId ? `id:${ev.RecordId}` : `n:${buf.records.size}:${ev.LogId}`;
  const prev = buf.records.get(recKey);

  // Updates are emailed only when switched on — except an edit to a record created moments
  // ago in this same batch, which just refreshes the values shown in the "created" email.
  if (ev.Action === 'UPDATE' && !NOTIFY_OPTIONS.actions.includes('UPDATE') && prev?.action !== 'CREATE') {
    if (!buf.records.size) buffers.delete(bufKey);
    return;
  }
  const fields = prev?.fields || new Map();   // field → { before, after }

  if (ev.Action === 'CREATE') {
    for (const [k, v] of Object.entries(newV)) if (!HIDDEN_FIELD(k)) fields.set(k, { before: '', after: v });
  } else if (ev.Action === 'UPDATE') {
    const names = String(ev.ChangedFields || '').split(',').map(s => s.trim()).filter(Boolean);
    const keys = names.length ? names : Object.keys(newV);
    for (const k of keys) {
      if (HIDDEN_FIELD(k)) continue;
      const f = fields.get(k);
      fields.set(k, { before: f ? f.before : (oldV[k] ?? ''), after: newV[k] ?? '' });
    }
  } else if (ev.Action === 'DELETE') {
    fields.clear();
    const src = Object.keys(oldV).length ? oldV : newV;
    for (const [k, v] of Object.entries(src)) if (!HIDDEN_FIELD(k)) fields.set(k, { before: v, after: '' });
  }

  // CREATE then UPDATE stays "created"; anything then DELETE becomes "deleted"
  const action = ev.Action === 'DELETE' ? 'DELETE' : (prev?.action === 'CREATE' ? 'CREATE' : ev.Action);
  buf.records.set(recKey, {
    action,
    recordId: ev.RecordId || '',
    label: ev.RecordLabel || prev?.label || '',
    fields,
    at: ev.TimestampIST || prev?.at || '',
  });

  clearTimeout(buf.timer);
  const wait = Math.max(0, Math.min(NOTIFY_OPTIONS.quietMs, buf.first + NOTIFY_OPTIONS.maxWaitMs - Date.now()));
  buf.timer = setTimeout(() => sendBuffer(bufKey), wait);
}

// ── Email ────────────────────────────────────────────────────────────────────
function recordTitle(r) {
  return r.label || (r.recordId ? `Record ${r.recordId}` : 'A record');
}

function buildEmail(buf) {
  const t = NOTIFY_TRACKERS[buf.tracker];
  // Drop updates whose values ended where they started
  const records = [...buf.records.values()].filter(r => {
    if (r.action !== 'UPDATE') return true;
    for (const [k, f] of r.fields) if (normVal(f.before) === normVal(f.after)) r.fields.delete(k);
    return r.fields.size > 0;
  });
  if (!records.length) return null;

  const who = buf.actor.name;
  const counts = {};
  records.forEach(r => { counts[r.action] = (counts[r.action] || 0) + 1; });
  const countText = ['CREATE', 'UPDATE', 'DELETE'].filter(a => counts[a]).map(a => `${counts[a]} ${VERB[a]}`).join(', ');

  const subject = records.length === 1
    ? `CRM update: ${t.name} – ${recordTitle(records[0])} has been ${VERB[records[0].action]} by ${who}`
    : `CRM update: ${t.name} – ${records.length} records changed by ${who} (${countText})`;

  const origin = (typeof location !== 'undefined' && location.origin) || '';
  const link = origin ? `${origin}${t.route}` : '';
  const badge = { CREATE: '#15803d', UPDATE: '#1d4ed8', DELETE: '#b91c1c' };
  const th = 'text-align:left;padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;font-weight:600';
  const td = 'padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top';

  const blocks = records.slice(0, NOTIFY_OPTIONS.maxRecords).map(r => {
    const rows = [...r.fields.entries()].slice(0, NOTIFY_OPTIONS.maxFields);
    const more = r.fields.size - rows.length;
    let table = '';
    if (r.action === 'UPDATE') {
      table = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:6px">
        <tr><th style="${th}">Field</th><th style="${th}">Before</th><th style="${th}">After</th></tr>
        ${rows.map(([k, f]) => `<tr><td style="${td};font-weight:600">${esc(k)}</td><td style="${td};color:#6b7280">${esc(show(f.before))}</td><td style="${td}">${esc(show(f.after))}</td></tr>`).join('')}
      </table>`;
    } else if (rows.length) {
      const key = r.action === 'DELETE' ? 'before' : 'after';
      table = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:6px">
        ${rows.filter(([, f]) => normVal(f[key]) !== '').map(([k, f]) => `<tr><td style="${td};font-weight:600;width:40%">${esc(k)}</td><td style="${td}">${esc(show(f[key]))}</td></tr>`).join('')}
      </table>`;
    }
    return `<div style="margin:14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px">
      <div><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${badge[r.action]};color:#fff;font-size:11px;font-weight:700;letter-spacing:.3px">${VERB[r.action].toUpperCase()}</span>
      <b style="font-size:14px;margin-left:6px">${esc(recordTitle(r))}</b>
      ${r.at ? `<span style="color:#9ca3af;font-size:12px;margin-left:6px">${esc(r.at)} IST</span>` : ''}</div>
      ${table}
      ${more > 0 ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">+ ${more} more field(s)</div>` : ''}
    </div>`;
  }).join('');
  const extra = records.length - NOTIFY_OPTIONS.maxRecords;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#111827;max-width:720px">
    <p style="font-size:14px;margin:0 0 4px"><b>${esc(who)}</b> made changes in <b>${esc(t.name)}</b>: ${esc(countText)}.</p>
    ${blocks}
    ${extra > 0 ? `<p style="font-size:13px;color:#6b7280">+ ${extra} more record(s) — open the tracker to see them.</p>` : ''}
    ${link ? `<p style="margin:18px 0"><a href="${esc(link)}" style="background:#1e3a8a;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:600">Open ${esc(t.name)}</a></p>` : ''}
    <p style="color:#9ca3af;font-size:11px;margin-top:20px">Sent by EuRadicle CRM to everyone with View access to ${esc(t.name)} in the Admin Panel.</p>
  </div>`;

  return { subject, html, count: records.length };
}

function sendBuffer(bufKey, { keepalive = false } = {}) {
  const buf = buffers.get(bufKey);
  if (!buf) return;
  clearTimeout(buf.timer);
  buffers.delete(bufKey);
  try {
    const url = FLOW_URLS.NOTIFY;
    if (!url) return;
    const mail = buildEmail(buf);
    if (!mail) return;
    const to = recipientsFor(buf.tracker, buf.actor.email);
    if (!to.length) return;
    const t = NOTIFY_TRACKERS[buf.tracker];
    const body = JSON.stringify({
      to: to.join(';'),
      subject: mail.subject.slice(0, 250),
      html: mail.html,
      tracker: buf.tracker,
      trackerName: t.name,
      actorEmail: buf.actor.email,
      actorName: buf.actor.name,
      recordCount: mail.count,
    });
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: keepalive && body.length < 60000,
    }).catch(() => { /* an email must never break the CRM */ });
  } catch { /* ignore */ }
}

// ── Direct email to one person (Project Management: task assigned) ───────────
// Tasks are NOT broadcast to everyone with View access (that would flood inboxes);
// only the person a task is assigned to gets an email. 'tasks' is therefore not in
// STORE_TRACKERS above.
const normName = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Email of a team member from the Admin Panel, by name (or the email itself). */
export function emailForPerson(nameOrEmail) {
  const n = normName(nameOrEmail);
  if (!n) return '';
  if (n.includes('@')) return n;
  const entries = Object.entries(directory);
  const exact = entries.find(([, cfg]) => normName(cfg?.name) === n);
  if (exact) return exact[0].toLowerCase();
  const first = n.split(' ')[0];
  const byFirst = entries.filter(([email, cfg]) => normName(cfg?.name).split(' ')[0] === first || email.toLowerCase().split(/[@.]/)[0] === first);
  return byFirst.length === 1 ? byFirst[0][0].toLowerCase() : '';
}

/** Send one email through the "CRM Notify" flow. Never throws; returns true when sent. */
export function emailPerson({ to, subject, html, tracker = 'tasks', trackerName = 'Project Management', actor = {} }) {
  try {
    const url = FLOW_URLS.NOTIFY;
    const email = emailForPerson(to);
    if (!url || !email) return false;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email, subject: String(subject || '').slice(0, 250), html, tracker, trackerName,
        actorEmail: actor.email || '', actorName: actor.name || '', recordCount: 1,
      }),
    }).catch(() => { /* an email must never break the CRM */ });
    return true;
  } catch { return false; }
}

/** Send everything waiting now (used when the tab closes or the user logs out). */
export function flushNotifications() {
  for (const k of [...buffers.keys()]) sendBuffer(k, { keepalive: true });
}

// ── Wiring ───────────────────────────────────────────────────────────────────
onAuditEvent(ev => {
  try {
    if (!FLOW_URLS.NOTIFY) return;
    if (ev.Category !== 'CRUD') return;                       // renumber / auth / page views
    if (!VERB[ev.Action]) return;                             // READ etc.
    // UPDATE goes through to addChange only so it can refresh a pending "created" email
    if (ev.Action !== 'UPDATE' && !NOTIFY_OPTIONS.actions.includes(ev.Action)) return;
    if (ev.Result && ev.Result !== 'SUCCESS') return;         // failed saves
    if (ev.Action === 'UPDATE' && ev.ChangedFields === '(no change)') return;
    addChange(ev);
  } catch { /* ignore */ }
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushNotifications);
}
