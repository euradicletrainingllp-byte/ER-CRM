/**
 * PO Tracker (/po) — every client PO: value, date received, engagements it covers (EC Index), used and balance.
 * Used = Σ Price (INR) of the linked Engagement Calendar rows (cancelled / lost excluded); written to Excel on each save.
 */
import { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { useLocation } from 'react-router-dom';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { getAllEngagementsCached, peekAllEngagements } from '../services/api.js';
import { ClientPicker, ContactPicker, ProposalPicker } from '../components/pickers/index.jsx';
import { fillNonEmpty } from '../services/directoryCache.js';
import { getPOs, peekPOs, addPO, updatePO, deletePO, nextPoId, poConfigured, poUsage, poStatus, splitIdx, PO_STATUS } from '../services/poApi.js';

const inr = v => '₹ ' + Math.round(Number(v) || 0).toLocaleString('en-IN');
const fmtD = d => (/^\d{4}-\d{2}-\d{2}/.test(d || '') ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const daysTo = d => (d ? Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5) : null);
const BADGE = { Active: ['#3E3264', '#f3eef7'], 'Fully Used': ['#0AC44B', '#F0FFF4'], Expired: ['#E98272', '#FFF5F5'], Closed: ['#6B7280', '#F2F2F2'] };
const EMPTY = { poId: '', poNumber: '', client: '', poDate: '', receivedDate: '', proposalId: '', scope: '', value: '', gstIncluded: 'No', validFrom: '', validTo: '', indexes: '', status: 'Active', link: '', spoc: '', remarks: '', createdBy: '' };

function POForm({ initial, ec, onSave, onClose, saving }) {
  const [f, setF] = useState(initial);
  const [q, setQ] = useState('');
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const sel = splitIdx(f.indexes);
  const toggle = i => setF(x => { const s = splitIdx(x.indexes); return { ...x, indexes: (s.includes(i) ? s.filter(v => v !== i) : [...s, i]).join('; ') }; });
  const u = poUsage(f, ec);
  const pick = useMemo(() => {
    const k = (q || f.client).trim().toLowerCase();
    return ec.filter(e => e.engagementKey && (sel.includes(String(e.engagementKey)) || (k && `${e.company} ${e.topic} ${e.engagementKey} ${e.egId}`.toLowerCase().includes(k))))
      .sort((a, b) => (sel.includes(String(b.engagementKey)) - sel.includes(String(a.engagementKey))) || String(b.startDate || '').localeCompare(String(a.startDate || ''))).slice(0, 60);
  }, [ec, q, f.client, f.indexes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fld = (label, k, type = 'text', req) => (
    <div className="form-field"><label className="form-label">{label}{req && <span className="required">*</span>}</label>
      <input className="form-input" type={type} value={f[k] ?? ''} onChange={set(k)} /></div>);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 760, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{initial.poId ? `Edit ${initial.poId}` : 'New PO'}</div>
        <div className="form-grid">
          {fld('PO Number', 'poNumber', 'text', true)}
          <div className="form-field"><label className="form-label">Client<span className="required">*</span></label>
            <ClientPicker value={f.client} onChange={v => setF(x => ({ ...x, client: v }))} /></div>
          {fld('PO Date', 'poDate', 'date')}{fld('PO Received Date', 'receivedDate', 'date')}
          {fld('PO Value (INR, excl. GST)', 'value', 'number', true)}
          <div className="form-field"><label className="form-label">GST Included</label><select className="form-input" value={f.gstIncluded} onChange={set('gstIncluded')}><option>No</option><option>Yes</option></select></div>
          {fld('Valid From', 'validFrom', 'date')}{fld('Valid To', 'validTo', 'date')}
          <div className="form-field"><label className="form-label">Proposal ID (BD)</label>
            <ProposalPicker value={f.proposalId} client={f.client} onChange={v => setF(x => ({ ...x, proposalId: v }))}
              onPick={p => setF(x => fillNonEmpty(x, { client: x.client || p.client }))} /></div>
          <div className="form-field"><label className="form-label">Client SPOC</label>
            <ContactPicker client={f.client} value={f.spoc} onChange={v => setF(x => ({ ...x, spoc: v }))} /></div>
          <div className="form-field"><label className="form-label">Status</label><select className="form-input" value={f.status} onChange={set('status')}>{PO_STATUS.map(s => <option key={s}>{s}</option>)}</select></div>
          {fld('PO Link', 'link', 'url')}
          <div className="form-field full"><label className="form-label">Description / Scope</label><input className="form-input" value={f.scope} onChange={set('scope')} /></div>
          <div className="form-field full">
            <label className="form-label">Engagements covered ({sel.length}) · used {inr(u.used)} · balance <b style={{ color: u.balance < 0 ? 'var(--error)' : undefined }}>{inr(u.balance)}</b></label>
            <input className="form-input" placeholder="Search client, program, Index or EG ID (defaults to the client)" value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginTop: 6 }}>
              {pick.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>Type to find engagements</div>}
              {pick.map(e => { const id = String(e.engagementKey), on = sel.includes(id); return (
                <label key={id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #F2F2F2', fontSize: 12, cursor: 'pointer', background: on ? '#f6eff6' : undefined }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                  <span style={{ flex: 1 }}><b>{e.topic || '(No program)'}</b> · {e.company} · {fmtD(e.startDate)} · Index {id}{e.status ? ` · ${e.status}` : ''}</span>
                  <b>{Number(e.price) ? inr(e.price) : '—'}</b>
                </label>); })}
            </div>
            {u.missing.length > 0 && <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 4 }}>Index not found in the Engagement Calendar: {u.missing.join(', ')}</div>}
          </div>
          <div className="form-field full"><label className="form-label">Remarks</label><input className="form-input" value={f.remarks} onChange={set('remarks')} /></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-cta" disabled={saving || !f.poNumber || !f.client || !(Number(f.value) > 0)} onClick={() => onSave(f)}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function POTracker({ onRefreshed }) {
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const { canEdit, canCreate, canDelete } = usePermissions();
  const location = useLocation();
  const [pos, setPos] = useState(() => peekPOs() || []);
  const [ec, setEc] = useState(() => peekAllEngagements() || []);
  const [loading, setLoading] = useState(!pos.length);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('All');

  const load = async () => {
    setErr('');
    try { const [p, e] = await Promise.all([getPOs(), getAllEngagementsCached()]); setPos(p); setEc(e || []); onRefreshed?.(new Date().toLocaleTimeString()); }
    catch (e) { setErr(e.message || String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { if (poConfigured()) load(); else setLoading(false); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = new URLSearchParams(location.search).get('po'); const p = id && pos.find(x => x.poId === id); if (p && canEdit('po')) setForm(p); }, [location.search, pos.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => pos.map(p => { const u = poUsage(p, ec); return { ...p, u, shown: poStatus(p, u), left: daysTo(p.validTo) }; }), [pos, ec]);
  const list = rows.filter(r => (st === 'All' || r.shown === st) && (!q || `${r.poNumber} ${r.poId} ${r.client} ${r.scope} ${r.proposalId} ${r.indexes}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(b.receivedDate || b.poDate).localeCompare(String(a.receivedDate || a.poDate)));
  const act = list.filter(r => r.shown === 'Active');
  const k = { value: list.reduce((s, r) => s + (Number(r.value) || 0), 0), used: list.reduce((s, r) => s + r.u.used, 0) };
  const expiring = act.filter(r => r.left != null && r.left <= 30).length, near = act.filter(r => r.u.pct >= 90).length;

  const save = async f => {
    setSaving(true);
    try {
      const fresh = await getPOs().catch(() => pos);
      const isNew = !f.poId;
      const u = poUsage(f, ec);
      const rec = { ...f, poId: f.poId || nextPoId(fresh), createdBy: f.createdBy || me, used: u.used, balance: (Number(f.value) || 0) - u.used,
        status: f.status === 'Active' && Number(f.value) > 0 && u.balance <= 0 ? 'Fully Used' : f.status };
      if (isNew && fresh.some(p => p.poNumber && p.poNumber.trim().toLowerCase() === rec.poNumber.trim().toLowerCase())) throw new Error(`PO Number ${rec.poNumber} already exists.`);
      await (isNew ? addPO(rec) : updatePO(rec));
      setForm(null); await load();
    } catch (e) { alert('Could not save the PO: ' + (e.message || e)); } finally { setSaving(false); }
  };
  const remove = async r => { if (!confirm(`Delete ${r.poNumber || r.poId}? This cannot be undone.`)) return; try { await deletePO(r.poId); await load(); } catch (e) { alert('Delete failed: ' + (e.message || e)); } };

  if (!poConfigured()) return <div className="card" style={{ padding: 24 }}><h3>PO Tracker not connected yet</h3><p style={{ color: 'var(--muted)' }}>Create the "CRM PO CRUD" flow and paste its URL into <code>src/config/powerAutomate.js → PO_CRUD</code>.</p></div>;
  if (loading) return <LoadingState message="Loading POs…" />;
  if (err && !pos.length) return <ErrorState message={err} onRetry={load} />;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card accent" onClick={() => setSt('Active')} style={{ cursor: 'pointer' }}><div className="kpi-label">Active POs</div><div className="kpi-value">{rows.filter(r => r.shown === 'Active').length}</div><div className="kpi-sub">{expiring} expiring ≤ 30 days · {near} ≥ 90% used</div></div>
        <div className="kpi-card"><div className="kpi-label">PO Value</div><div className="kpi-value">{inr(k.value)}</div><div className="kpi-sub">{list.length} PO(s) shown</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Used</div><div className="kpi-value">{inr(k.used)}</div><div className="kpi-sub">{k.value ? Math.round((k.used / k.value) * 100) : 0}% of value</div></div>
        <div className="kpi-card green"><div className="kpi-label">Balance</div><div className="kpi-value">{inr(k.value - k.used)}</div><div className="kpi-sub">Price of linked engagements deducted</div></div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input className="form-input" style={{ flex: '1 1 240px', maxWidth: 360 }} placeholder="Search PO, client, scope, Index…" value={q} onChange={e => setQ(e.target.value)} />
          <select className="form-input" style={{ width: 160 }} value={st} onChange={e => setSt(e.target.value)}>{['All', ...PO_STATUS].map(s => <option key={s}>{s}</option>)}</select>
          <div style={{ flex: 1 }} />
          <ExportButton page="po" filename="PO Tracker" sheetName="POs" rows={() => list}
            columns={[['PO ID', 'poId'], ['PO Number', 'poNumber'], ['Client', 'client'], ['PO Date', 'poDate'], ['Received', 'receivedDate'], ['Value', 'value'], ['Used', r => r.u.used], ['Balance', r => r.u.balance], ['Status', 'shown'], ['Valid To', 'validTo'], ['Engagement Index', 'indexes'], ['Proposal ID', 'proposalId'], ['Scope', 'scope']].map(([label, g]) => ({ label, get: typeof g === 'function' ? g : r => r[g] }))} />
          {canCreate('po') && <button className="btn btn-cta" onClick={() => setForm({ ...EMPTY })}>+ New PO</button>}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>PO</th><th>Client</th><th>Received</th><th>Valid To</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ minWidth: 180 }}>Used / Balance</th><th>Engagements</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No POs</td></tr>}
            {list.map(r => { const [fg, bg] = BADGE[r.shown] || BADGE.Closed; return (
              <tr key={r.poId || r.poNumber} onDoubleClick={() => canEdit('po') && setForm(r)} style={{ cursor: canEdit('po') ? 'pointer' : undefined }}>
                <td><b>{r.poNumber || '—'}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.poId}{r.proposalId ? ` · P.ID ${r.proposalId}` : ''}</div></td>
                <td>{r.client}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.scope}</div></td>
                <td>{fmtD(r.receivedDate || r.poDate)}</td>
                <td>{fmtD(r.validTo)}{r.left != null && r.shown === 'Active' && r.left <= 30 && <div style={{ fontSize: 11, color: 'var(--error)' }}>{r.left < 0 ? 'expired' : `${r.left} days left`}</div>}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.value)}</td>
                <td><div style={{ height: 6, background: '#F2F2F2', borderRadius: 3 }}><div style={{ width: `${Math.min(100, r.u.pct)}%`, height: 6, borderRadius: 3, background: r.u.pct > 100 ? 'var(--error)' : r.u.pct >= 90 ? 'var(--warning)' : 'var(--mauve)' }} /></div>
                  <div style={{ fontSize: 11, marginTop: 3 }}>{inr(r.u.used)} used · <b style={{ color: r.u.balance < 0 ? 'var(--error)' : undefined }}>{inr(r.u.balance)}</b> left ({r.u.pct}%)</div></td>
                <td title={r.u.rows.map(e => `${e.engagementKey}: ${e.topic}`).join('\n')}>{r.u.ids.length}{r.u.missing.length ? <span style={{ color: 'var(--error)' }}> ({r.u.missing.length} not found)</span> : ''}</td>
                <td><span style={{ fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 10, padding: '2px 8px' }}>{r.shown}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.link && <a className="btn btn-sm btn-secondary" href={r.link} target="_blank" rel="noreferrer">PO</a>}{' '}
                  {canEdit('po') && <button className="btn btn-sm btn-secondary" onClick={() => setForm(r)}>Edit</button>}{' '}
                  {canDelete('po') && <button className="btn btn-sm btn-secondary" onClick={() => remove(r)}>Delete</button>}
                </td>
              </tr>); })}
          </tbody>
        </table></div>
      </div>
      {form && <POForm initial={form} ec={ec} saving={saving} onSave={save} onClose={() => setForm(null)} />}
    </div>
  );
}
