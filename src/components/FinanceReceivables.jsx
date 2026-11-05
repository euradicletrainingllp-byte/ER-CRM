/**
 * Finance dashboard — receivables, pending billing, credit notes & cancelled invoices (6 Nov 2026).
 * Visual blocks used by FinanceLiveDashboard. Tap a client bar to list its engagements;
 * double-tap an engagement to open it for editing in the Finance Tracker.
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = iso => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${+iso.slice(8, 10)} ${MON3[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '—');
const L = v => { const n = Number(v) || 0; return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Hand-off read by the Finance Tracker page: open this engagement for editing. */
export const FIN_OPEN_KEY = 'ercrm.fin.open';
function useOpener() {
  const navigate = useNavigate();
  return key => {
    if (!key) return;
    try { sessionStorage.setItem(FIN_OPEN_KEY, key); } catch { /* storage blocked */ }
    navigate('/finance');
  };
}

/** Single tap = select, second tap on the same row within 400 ms (or a mouse double-click) = open. */
function useDoubleTap(open) {
  const last = useRef({ id: null, t: 0 });
  const [sel, setSel] = useState(null);
  const tap = (id, key) => {
    const now = Date.now();
    if (last.current.id === id && now - last.current.t < 400) { last.current = { id: null, t: 0 }; open(key); return; }
    last.current = { id, t: now };
    setSel(id);
  };
  return { sel, tap };
}

/* ─── Receivables by client ─────────────────────────────────────────────── */
const AGE = [
  { k: 'ok', label: 'Within credit', note: 'not yet due' },
  { k: 'a1', label: '1–30 days', note: 'overdue' },
  { k: 'a2', label: '31–60 days', note: 'overdue' },
  { k: 'a3', label: '60+ days', note: 'overdue' },
];
const ageOf = d => (!d.overdue ? 'ok' : d.pastDays <= 30 ? 'a1' : d.pastDays <= 60 ? 'a2' : 'a3');

export function ReceivablesByClient({ dues, daysLeft }) {
  const openFin = useOpener();
  const { sel, tap } = useDoubleTap(openFin);
  const [openClient, setOpenClient] = useState(null);

  const { clients, tiles, total } = useMemo(() => {
    const m = new Map();
    const tiles = Object.fromEntries(AGE.map(a => [a.k, { v: 0, n: 0 }]));
    dues.forEach(d => {
      const name = String(d.r.company || '').trim() || '(no company)';
      const k = name.toLowerCase();
      if (!m.has(k)) m.set(k, { name, total: 0, seg: { ok: 0, a1: 0, a2: 0, a3: 0 }, items: [], worst: 0 });
      const g = m.get(k), a = ageOf(d);
      g.total += d.open; g.seg[a] += d.open; g.items.push({ ...d, age: a }); g.worst = Math.max(g.worst, d.pastDays || 0);
      tiles[a].v += d.open; tiles[a].n += 1;
    });
    const clients = [...m.values()].sort((a, b) => b.total - a.total);
    clients.forEach(c => c.items.sort((x, y) => (y.pastDays || 0) - (x.pastDays || 0) || y.open - x.open));
    return { clients, tiles, total: clients.reduce((t, c) => t + c.total, 0) };
  }, [dues]);
  const max = Math.max(1, ...clients.map(c => c.total));

  return (
    <div className="card fr-card">
      <div className="fr-head">
        <div><h3>Receivables by Client</h3><div className="cs">Invoices raised and not fully paid · {L(total)} across {plural(dues.length, 'invoice')}, {plural(clients.length, 'client')} · tap a client to see its engagements</div></div>
      </div>
      <div className="fr-tiles">
        {AGE.map(a => (
          <div key={a.k} className={`fr-tile ${a.k}`}>
            <div className="fr-tile-lb">{a.label} <span>{a.note}</span></div>
            <div className="fr-tile-vl">{L(tiles[a.k].v)}</div>
            <div className="fr-tile-sb">{plural(tiles[a.k].n, 'invoice')}{total > 0 ? ` · ${Math.round((tiles[a.k].v / total) * 100)}%` : ''}</div>
          </div>
        ))}
      </div>
      {clients.length === 0 ? <div className="erd-empty">No money outstanding — every raised invoice is paid</div> : (
        <div className="fr-scroll" style={{ maxHeight: 480 }}>
          {clients.map(c => {
            const isOpen = openClient === c.name;
            return (
              <div key={c.name} className={`fr-row${isOpen ? ' open' : ''}`}>
                <button type="button" className="fr-bar-line" onClick={() => setOpenClient(isOpen ? null : c.name)} aria-expanded={isOpen}>
                  <span className="fr-name" title={c.name}>{c.name}</span>
                  <span className="fr-track">
                    <span className="fr-fill" style={{ width: `${(c.total / max) * 100}%` }}>
                      {AGE.map(a => c.seg[a.k] > 0 && <span key={a.k} className={`fr-seg ${a.k}`} style={{ flexGrow: c.seg[a.k] }} title={`${a.label}: ${L(c.seg[a.k])}`} />)}
                    </span>
                  </span>
                  <span className="fr-val"><b>{L(c.total)}</b><em>{plural(c.items.length, 'inv')}{c.worst > 0 ? ` · ${c.worst}d late` : ''}</em></span>
                  <span className="fr-caret">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="fr-list">
                    <div className="fr-hint">Double-tap an engagement to edit it in the Finance Tracker</div>
                    {c.items.map((d, i) => {
                      const id = `${c.name}|${i}`;
                      return (
                        <div key={id} className={`fr-item${sel === id ? ' sel' : ''}`} onClick={() => tap(id, d.r.engagementKey)} onDoubleClick={() => openFin(d.r.engagementKey)} title="Double-tap to edit in the Finance Tracker">
                          <span className={`fr-dot ${d.age}`} />
                          <div className="fr-item-main"><b>{String(d.r.topic || '(No program)').trim()}</b>
                            <span>Inv {d.r.invNo || '—'} · {fmtDate(d.r.inv)} · due {fmtDate(d.dueDate)}</span></div>
                          <span className={`fr-chip ${d.age}`}>{d.r.p === 'Partly Received' ? 'Partly received' : d.overdue ? `${d.pastDays}d overdue` : `${daysLeft(d.dueDate)}d left`}</span>
                          <span className="fr-amt">{L(d.open)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="fr-legend">{AGE.map(a => <span key={a.k}><i className={`fr-seg ${a.k}`} />{a.label}</span>)}</div>
    </div>
  );
}

/* ─── Pending billing (to be invoiced) ──────────────────────────────────── */
const WAIT = [
  { k: 'w1', label: 'Under 7 days' },
  { k: 'w2', label: '7–30 days' },
  { k: 'w3', label: '30+ days' },
];
const waitOf = t => (t.waiting == null || t.waiting < 7 ? 'w1' : t.waiting <= 30 ? 'w2' : 'w3');

export function PendingBilling({ toInvoice }) {
  const openFin = useOpener();
  const { sel, tap } = useDoubleTap(openFin);
  const [openClient, setOpenClient] = useState(null);
  const { clients, total, sessions } = useMemo(() => {
    const m = new Map();
    toInvoice.forEach(t => {
      const name = t.client || '(no company)', k = name.toLowerCase();
      if (!m.has(k)) m.set(k, { name, total: 0, seg: { w1: 0, w2: 0, w3: 0 }, items: [], wait: 0 });
      const g = m.get(k), w = waitOf(t);
      g.total += t.amount; g.seg[w] += t.amount; g.items.push({ ...t, w }); g.wait = Math.max(g.wait, t.waiting || 0);
    });
    const clients = [...m.values()].sort((a, b) => b.total - a.total);
    return { clients, total: clients.reduce((s, c) => s + c.total, 0), sessions: toInvoice.reduce((s, t) => s + t.sessions, 0) };
  }, [toInvoice]);
  const max = Math.max(1, ...clients.map(c => c.total));
  const byWait = WAIT.map(w => ({ ...w, v: clients.reduce((s, c) => s + c.seg[w.k], 0) }));

  return (
    <div className="card fr-card">
      <div className="fr-head"><div><h3>To be Invoiced — Pending Billing</h3>
        <div className="cs">{L(total)} across {plural(toInvoice.length, 'program')} ({plural(sessions, 'session')}) — ended or delivered, no invoice raised · coloured by days since the last session</div></div></div>
      <div className="fr-tiles three">
        {byWait.map(w => (
          <div key={w.k} className={`fr-tile ${w.k}`}><div className="fr-tile-lb">{w.label} <span>since last session</span></div><div className="fr-tile-vl">{L(w.v)}</div>
            <div className="fr-tile-sb">{total > 0 ? `${Math.round((w.v / total) * 100)}% of pending` : '—'}</div></div>
        ))}
      </div>
      {clients.length === 0 ? <div className="erd-empty">Nothing pending — every ended session has been invoiced</div> : (
        <div className="fr-scroll" style={{ maxHeight: 420 }}>
          {clients.map(c => {
            const isOpen = openClient === c.name;
            return (
              <div key={c.name} className={`fr-row${isOpen ? ' open' : ''}`}>
                <button type="button" className="fr-bar-line" onClick={() => setOpenClient(isOpen ? null : c.name)} aria-expanded={isOpen}>
                  <span className="fr-name" title={c.name}>{c.name}</span>
                  <span className="fr-track"><span className="fr-fill" style={{ width: `${(c.total / max) * 100}%` }}>
                    {WAIT.map(w => c.seg[w.k] > 0 && <span key={w.k} className={`fr-seg ${w.k}`} style={{ flexGrow: c.seg[w.k] }} title={`${w.label}: ${L(c.seg[w.k])}`} />)}
                  </span></span>
                  <span className="fr-val"><b>{L(c.total)}</b><em>{plural(c.items.length, 'program')} · {c.wait}d</em></span>
                  <span className="fr-caret">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="fr-list">
                    <div className="fr-hint">Double-tap a program to edit it in the Finance Tracker</div>
                    {c.items.map((t, i) => {
                      const id = `${c.name}|${i}`;
                      return (
                        <div key={id} className={`fr-item${sel === id ? ' sel' : ''}`} onClick={() => tap(id, t.keys?.[0])} onDoubleClick={() => openFin(t.keys?.[0])} title="Double-tap to edit in the Finance Tracker">
                          <span className={`fr-dot ${t.w}`} />
                          <div className="fr-item-main"><b>{t.topic || '(No program)'}</b>
                            <span>{t.first === t.last ? fmtDate(t.first) : `${fmtDate(t.first)} – ${fmtDate(t.last)}`}{t.sessions > 1 ? ` · ${t.sessions} sessions` : ''}{t.po ? ` · PO: ${t.po}` : ''}</span></div>
                          <span className={`fr-chip ${t.w}`}>{t.waiting != null ? `${t.waiting}d waiting` : 'No end date'}</span>
                          <span className="fr-amt">{L(t.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="fr-legend">{WAIT.map(w => <span key={w.k}><i className={`fr-seg ${w.k}`} />{w.label}</span>)}</div>
    </div>
  );
}

/* ─── Credit notes & cancelled invoices ─────────────────────────────────── */
export function CreditAndCancelled({ notes, cancelled, fyLabel }) {
  const openFin = useOpener();
  const cnTap = useDoubleTap(openFin), ciTap = useDoubleTap(openFin);
  const cnTotal = notes.reduce((t, n) => t + n.amount, 0);
  const byClient = useMemo(() => {
    const m = new Map();
    cancelled.forEach(c => { const k = c.client.toLowerCase(); if (!m.has(k)) m.set(k, { client: c.client, list: [] }); m.get(k).list.push(c); });
    return [...m.values()].sort((a, b) => b.list.length - a.list.length);
  }, [cancelled]);

  return (
    <div className="cg c11">
      <div className="card fr-card">
        <div className="fr-head"><div><h3>Credit Notes — {fyLabel}</h3><div className="cs">From the Finance Tracker "Credit Notes" section · double-tap to open the engagement</div></div>
          <div className="fr-badge cn"><b>{L(cnTotal)}</b><span>{plural(notes.length, 'note')}</span></div></div>
        {notes.length === 0 ? <div className="erd-empty">No credit notes recorded in {fyLabel}</div> : (
          <div className="fr-scroll fr-cards" style={{ maxHeight: 340 }}>
            {notes.map((n, i) => (
              <div key={i} className={`fr-cn${cnTap.sel === i ? ' sel' : ''}`} onClick={() => cnTap.tap(i, n.key)} onDoubleClick={() => openFin(n.key)}>
                <div className="fr-cn-top"><span className="fr-cn-no">{n.no || 'Credit note'}</span><span className="fr-cn-amt">− {L(n.amount)}</span></div>
                <div className="fr-cn-client">{n.client || '—'}</div>
                <div className="fr-cn-meta">{[n.date ? fmtDate(n.date) : '', n.topic].filter(Boolean).join(' · ') || '—'}</div>
                {n.reason && <div className="fr-cn-reason">{n.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card fr-card">
        <div className="fr-head"><div><h3>Cancelled Invoices — {fyLabel}</h3><div className="cs">From the Finance Tracker "Cancelled Invoice No" field, grouped by client</div></div>
          <div className="fr-badge ci"><b>{cancelled.length}</b><span>cancelled</span></div></div>
        {cancelled.length === 0 ? <div className="erd-empty">No cancelled invoices in {fyLabel}</div> : (
          <div className="fr-scroll" style={{ maxHeight: 340 }}>
            {byClient.map(g => (
              <div key={g.client} className="fr-ci-group">
                <div className="fr-ci-client">{g.client}<span>{plural(g.list.length, 'invoice')}</span></div>
                <div className="fr-ci-tags">
                  {g.list.map((c, i) => {
                    const id = `${g.client}|${i}`;
                    return (
                      <span key={id} className={`fr-ci-tag${ciTap.sel === id ? ' sel' : ''}`} onClick={() => ciTap.tap(id, c.key)} onDoubleClick={() => openFin(c.key)} title={`${c.topic || ''}${c.date ? ' · ' + fmtDate(c.date) : ''} — double-tap to open`}>
                        <s>{c.no}</s><em>{[c.date ? fmtDate(c.date) : '', c.topic].filter(Boolean).join(' · ')}</em>
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
