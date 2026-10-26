/**
 * VENDOR SERVICE TRACKER
 * ======================
 * One line per service taken from a vendor (venue, printing, travel, associate fee …),
 * linked to the engagement it was for, so nothing is missed at billing time:
 *   • billable services not yet billed to the client  → "To bill"
 *   • vendor invoices not yet received                → "Invoice awaited"
 *   • vendor invoices not yet paid                    → "To pay"
 * Excel: Vendor_Service_Tracker.xlsx → VendorServiceTable (flow VENDOR_CRUD). Key: Service ID (VS-0001…).
 */
import { useState, useEffect, useMemo } from 'react';
import { useMsal } from '@azure/msal-react';
import { LoadingState, ErrorState } from '../components/LoadingState.jsx';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import ExportButton from '../components/ExportButton.jsx';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { LinkButton } from '../components/LinkButton.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';
import { peekList, peekAllEngagements, getAllEngagementsCached } from '../services/api.js';
import { getVendorServices, addVendorService, updateVendorService, deleteVendorService, nextServiceId, vendorTotals } from '../services/leadsVendorsApi.js';
import { pendingItems, VENDOR_RULES } from '../config/pendingFields.js';
import {
  VENDOR_CATEGORIES, BILLABLE_OPTIONS, CLIENT_BILLING, VENDOR_PAYMENT, isBillable,
  VENDOR_INVOICE_EXPECTED_DAYS, CLIENT_BILLING_DAYS, VENDOR_PAYMENT_DAYS,
} from '../config/leadVendorOptions.js';
import '../styles/leadsVendors.css';

/* ─── Helpers ─── */
const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtD = iso => { if (!iso) return '—'; const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); return isNaN(d) ? iso : `${pad2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
const inr = v => (Number(v) ? '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—');
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const toBill = v => isBillable(v.billable) && v.clientBilling !== 'Billed' && v.clientBilling !== 'Not applicable';
const toPay = v => ['To pay', 'Partly paid'].includes(v.paymentStatus);
const balance = v => Math.max(0, (Number(v.total) || vendorTotals(v).total) - (Number(v.paidAmount) || 0));

function Select({ value, options, onChange, blank = '— select —' }) {
  return (
    <select className="form-input" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      {value && !options.includes(value) && <option value={value}>{value} (old value)</option>}
    </select>
  );
}
const Field = ({ label, full, children }) => (
  <div className={`form-field${full ? ' full' : ''}`}><label className="form-label">{label}</label>{children}</div>
);

/* ─── Add / Edit service ─── */
const EMPTY = {
  serviceId: '', vendorName: '', vendorContact: '', category: '', description: '', engagementKey: '', egId: '', client: '', program: '',
  serviceDate: '', quantity: '', unit: 'Lump sum', rate: '', amount: '', gst: '', total: '', requestedBy: '',
  billable: 'Billable to client', clientBilling: 'To bill', clientInvoiceRef: '', clientInvoiceDate: '',
  vendorInvoiceNo: '', vendorInvoiceDate: '', vendorInvoiceLink: '', paymentStatus: 'Invoice awaited', paidAmount: '', paidDate: '',
  comments: '', createdBy: '',
};

function ServiceModal({ initial, prefill, onSave, onClose, saving, engagements, vendors, names, me }) {
  const isEdit = !!initial;
  const [f, setF] = useState(() => {
    const base = isEdit ? { ...EMPTY, ...initial } : { ...EMPTY, ...prefill, requestedBy: me, createdBy: me };
    // One total cost per service (all items, incl. GST). Older rows: start from their saved total.
    const t = isEdit ? (Number(base.total) || vendorTotals(base).total || '') : '';
    return { ...base, cost: t === '' ? '' : String(t) };
  });
  const [engQ, setEngQ] = useState('');
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v };
    if (k === 'quantity' || k === 'rate') { const q = Number(n.quantity), r = Number(n.rate); if (q && r) n.amount = String(Math.round(q * r * 100) / 100); }
    if (k === 'billable') n.clientBilling = isBillable(v) ? (x.clientBilling === 'Not applicable' ? 'To bill' : x.clientBilling || 'To bill') : 'Not applicable';
    if (k === 'vendorInvoiceNo' && v && n.paymentStatus === 'Invoice awaited') n.paymentStatus = 'To pay';
    if (k === 'paidDate' && v && !['Paid', 'Partly paid'].includes(n.paymentStatus)) n.paymentStatus = 'Paid';
    if (k === 'clientInvoiceRef' && v && n.clientBilling === 'To bill') n.clientBilling = 'Billed';
    return n;
  });
  const engOptions = useMemo(() => {
    const q = norm(engQ);
    return engagements.filter(e => !q || [e.company, e.topic, e.egId, e.engagementKey].some(v => norm(v).includes(q)))
      .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).slice(0, 60);
  }, [engagements, engQ]);
  const pickEng = key => {
    const e = engagements.find(x => String(x.engagementKey) === String(key));
    if (!e) { setF(x => ({ ...x, engagementKey: '', egId: '', client: x.client, program: x.program })); return; }
    setF(x => ({ ...x, engagementKey: String(e.engagementKey), egId: e.egId || '', client: e.company || '', program: e.topic || '', serviceDate: x.serviceDate || e.startDate || '' }));
  };
  const valid = f.vendorName.trim() && f.category && (f.description.trim() || f.category);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 780 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">{isEdit ? `Edit Vendor Service · ${f.serviceId}` : 'Add Vendor Service'}</div>
        <datalist id="vs-vendors">{vendors.map(n => <option key={n} value={n} />)}</datalist>
        <datalist id="vs-names">{names.map(n => <option key={n} value={n} />)}</datalist>

        <div className="lv-form-section">Service</div>
        <div className="form-grid">
          <Field label="Vendor Name *"><input className="form-input" list="vs-vendors" value={f.vendorName} onChange={e => set('vendorName', e.target.value)} /></Field>
          <Field label="Vendor Contact"><input className="form-input" value={f.vendorContact} onChange={e => set('vendorContact', e.target.value)} placeholder="Name / phone / email" /></Field>
          <Field label="Service Category *"><Select value={f.category} options={VENDOR_CATEGORIES} onChange={v => set('category', v)} /></Field>
          <Field label="Service Date"><input className="form-input" type="date" value={f.serviceDate} onChange={e => set('serviceDate', e.target.value)} /></Field>
          <Field label="Service Description" full><input className="form-input" value={f.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Conference hall 2 days, 40 participant kits" /></Field>
          <Field label="Requested By"><input className="form-input" list="vs-names" value={f.requestedBy} onChange={e => set('requestedBy', e.target.value)} /></Field>
        </div>

        <div className="lv-form-section">Engagement it was for</div>
        <div className="form-grid">
          <Field label="Engagement" full>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" style={{ maxWidth: 220 }} placeholder="Search client / EG.ID…" value={engQ} onChange={e => setEngQ(e.target.value)} />
              <select className="form-input" value={f.engagementKey} onChange={e => pickEng(e.target.value)}>
                <option value="">— not linked / internal —</option>
                {f.engagementKey && !engOptions.some(e => String(e.engagementKey) === String(f.engagementKey)) &&
                  <option value={f.engagementKey}>{`Index ${f.engagementKey} · ${f.client} · ${f.program}`}</option>}
                {engOptions.map(e => <option key={e.engagementKey} value={e.engagementKey}>{`${fmtD(e.startDate)} · ${e.company} · ${e.topic || ''} · ${e.egId || ''}`}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Client"><input className="form-input" value={f.client} onChange={e => set('client', e.target.value)} /></Field>
          <Field label="Program"><input className="form-input" value={f.program} onChange={e => set('program', e.target.value)} /></Field>
        </div>

        <div className="lv-form-section">Cost</div>
        <div className="form-grid lv-grid-4">
          <div data-pf="total">
            <Field label="Total Cost (₹)"><input className="form-input" inputMode="decimal" value={f.cost} onChange={e => set('cost', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="All items, incl. GST" style={{ fontWeight: 700 }} /></Field>
          </div>
        </div>

        <div className="lv-form-section">Billing to client</div>
        <div className="form-grid">
          <Field label="Billable to Client"><Select value={f.billable} options={BILLABLE_OPTIONS} onChange={v => set('billable', v)} /></Field>
          <Field label="Client Billing Status"><Select value={f.clientBilling} options={CLIENT_BILLING} onChange={v => set('clientBilling', v)} /></Field>
          <Field label="Client Invoice Ref"><input className="form-input" value={f.clientInvoiceRef} onChange={e => set('clientInvoiceRef', e.target.value)} placeholder="Our invoice no. to the client" /></Field>
          <Field label="Client Invoice Date"><input className="form-input" type="date" value={f.clientInvoiceDate} onChange={e => set('clientInvoiceDate', e.target.value)} /></Field>
        </div>

        <div className="lv-form-section">Paying the vendor</div>
        <div className="form-grid">
          <Field label="Vendor Invoice No"><input className="form-input" value={f.vendorInvoiceNo} onChange={e => set('vendorInvoiceNo', e.target.value)} /></Field>
          <Field label="Vendor Invoice Date"><input className="form-input" type="date" value={f.vendorInvoiceDate} onChange={e => set('vendorInvoiceDate', e.target.value)} /></Field>
          <Field label="Vendor Invoice Link" full><input className="form-input" value={f.vendorInvoiceLink} onChange={e => set('vendorInvoiceLink', e.target.value.trim())} placeholder="https://… (OneDrive / SharePoint)" /></Field>
          <Field label="Vendor Payment Status"><Select value={f.paymentStatus} options={VENDOR_PAYMENT} onChange={v => set('paymentStatus', v)} /></Field>
          <Field label="Paid Amount (₹)"><input className="form-input" inputMode="decimal" value={f.paidAmount} onChange={e => set('paidAmount', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
          <Field label="Paid Date"><input className="form-input" type="date" value={f.paidDate} onChange={e => set('paidDate', e.target.value)} /></Field>
          <Field label="Comments" full><textarea className="form-input" rows={2} value={f.comments} onChange={e => set('comments', e.target.value)} /></Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
          <button className="btn btn-cta" disabled={!valid || saving} onClick={() => { const { cost, ...rest } = f; onSave({ ...rest, quantity: '', unit: '', rate: '', gst: '', amount: cost || '', total: cost || '' }); }}>{saving ? 'Saving…' : isEdit ? 'Update Service' : 'Save Service'}</button>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {!valid && <span className="lv-req">* Vendor Name and Service Category are required</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Detail panel ─── */
function ServicePanel({ v, canEdit, onEdit, onDelete, onQuick, saving }) {
  const [inv, setInv] = useState('');
  useEffect(() => setInv(''), [v.serviceId]);
  const Info = ({ k, label, children }) => <div data-pf={k}><dt>{label}</dt><dd>{children || '—'}</dd></div>;
  return (
    <div className="card lv-panel">
      <div className="card-header lv-panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lv-panel-title">{v.vendorName || '(no vendor)'}</div>
          <div className="lv-muted">{v.serviceId} · {v.category || '—'} · {fmtD(v.serviceDate)}</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {toBill(v) && <span className="lv-pill lv-st-hold">To bill client</span>}
            {v.clientBilling === 'Billed' && <span className="lv-pill lv-st-won">Billed to client</span>}
            {!isBillable(v.billable) && <span className="lv-pill lv-st-new">{v.billable || 'Billing not set'}</span>}
            <span className={`lv-pill ${v.paymentStatus === 'Paid' ? 'lv-st-won' : toPay(v) ? 'lv-st-prog' : 'lv-st-hold'}`}>Vendor: {v.paymentStatus || '—'}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="lv-amount">{inr(v.total)}</div>
          {canEdit && <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
            <EditButton onClick={onEdit} title="Edit service" />
            {onDelete && <DeleteButton onClick={onDelete} title="Delete service" iconOnly />}
          </div>}
        </div>
      </div>
      <div className="lv-panel-body">
        {canEdit && (toBill(v) || toPay(v)) && (
          <div className="lv-quick">
            {toBill(v) && (
              <div className="lv-quick-row" data-pf="clientInvoiceRef">
                <span>Billed to the client?</span>
                <input className="form-input" placeholder="Our invoice no." value={inv} onChange={e => setInv(e.target.value)} />
                <button className="btn btn-cta btn-sm" disabled={saving} onClick={() => onQuick({ clientBilling: 'Billed', clientInvoiceRef: inv || v.clientInvoiceRef, clientInvoiceDate: v.clientInvoiceDate || todayIso() })}>Mark billed</button>
              </div>
            )}
            {toPay(v) && (
              <div className="lv-quick-row" data-pf="paidDate">
                <span>Vendor paid {inr(balance(v))}?</span>
                <button className="btn btn-cta btn-sm" disabled={saving} onClick={() => onQuick({ paymentStatus: 'Paid', paidAmount: v.total || v.amount, paidDate: v.paidDate || todayIso() })}>Mark paid today</button>
              </div>
            )}
          </div>
        )}
        <div className="lv-sub">Service</div>
        <dl className="lv-info">
          <Info k="category" label="Category">{v.category}</Info>
          <Info k="serviceDate" label="Service date">{v.serviceDate && fmtD(v.serviceDate)}</Info>
          <div className="lv-info-full" data-pf="description"><dt>Description</dt><dd>{v.description || '—'}</dd></div>
          <Info k="vendorContact" label="Vendor contact">{v.vendorContact}</Info>
          <Info k="requestedBy" label="Requested by">{v.requestedBy}</Info>
        </dl>
        <div className="lv-sub">Engagement</div>
        <dl className="lv-info">
          <Info k="client" label="Client">{v.client}</Info>
          <Info k="program" label="Program">{v.program}</Info>
          <Info k="egId" label="EG.ID / Index">{[v.egId, v.engagementKey && `Index ${v.engagementKey}`].filter(Boolean).join(' · ')}</Info>
        </dl>
        <div className="lv-sub">Cost</div>
        <dl className="lv-info">
          <Info k="total" label="Total cost">{inr(v.total || vendorTotals(v).total)}</Info>
        </dl>
        <div className="lv-sub">Billing &amp; payment</div>
        <dl className="lv-info">
          <Info k="billable" label="Billable to client">{v.billable}</Info>
          <Info k="clientBilling" label="Client billing">{[v.clientBilling, v.clientInvoiceRef, v.clientInvoiceDate && fmtD(v.clientInvoiceDate)].filter(Boolean).join(' · ')}</Info>
          <Info k="vendorInvoiceNo" label="Vendor invoice">{[v.vendorInvoiceNo, v.vendorInvoiceDate && fmtD(v.vendorInvoiceDate)].filter(Boolean).join(' · ')}{v.vendorInvoiceLink && <> <LinkButton url={v.vendorInvoiceLink} label="Open" compact /></>}</Info>
          <Info k="paymentStatus" label="Vendor payment">{[v.paymentStatus, v.paidAmount !== '' && inr(v.paidAmount), v.paidDate && fmtD(v.paidDate)].filter(Boolean).join(' · ')}</Info>
          {v.comments && <div className="lv-info-full"><dt>Comments</dt><dd>{v.comments}</dd></div>}
        </dl>
      </div>
    </div>
  );
}

/* ─── Summary views ─── */
function Summary({ rows, by }) {
  const m = new Map();
  rows.forEach(v => {
    const k = by === 'engagement' ? ([v.client, v.program].filter(Boolean).join(' · ') || '(not linked)') : by === 'vendor' ? (v.vendorName || '(no vendor)') : (v.category || '(no category)');
    const r = m.get(k) || { k, n: 0, total: 0, toBill: 0, toPay: 0, awaited: 0 };
    r.n++; r.total += Number(v.total) || 0;
    if (toBill(v)) r.toBill += Number(v.total) || 0;
    if (toPay(v)) r.toPay += balance(v);
    if (v.paymentStatus === 'Invoice awaited') r.awaited++;
    m.set(k, r);
  });
  const list = [...m.values()].sort((a, b) => b.total - a.total);
  return (
    <table className="lv-table">
      <thead><tr><th>{by === 'engagement' ? 'Engagement' : by === 'vendor' ? 'Vendor' : 'Category'}</th><th>Services</th><th>Total cost</th><th>To bill client</th><th>To pay vendor</th><th>Invoices awaited</th></tr></thead>
      <tbody>{list.map(r => (
        <tr key={r.k}><td>{r.k}</td><td>{r.n}</td><td>{inr(r.total)}</td>
          <td className={r.toBill ? 'lv-warn-t' : ''}>{inr(r.toBill)}</td><td className={r.toPay ? 'lv-warn-t' : ''}>{inr(r.toPay)}</td><td>{r.awaited || '—'}</td></tr>
      ))}</tbody>
    </table>
  );
}

/* ─── Page ─── */
const QUICK = [
  ['all', 'All'], ['tobill', 'To bill client'], ['awaited', 'Vendor invoice awaited'], ['topay', 'To pay vendor'], ['done', 'Closed'],
];

export default function VendorTracker({ onRefreshed }) {
  const { accounts } = useMsal();
  const me = accounts[0]?.name || accounts[0]?.username || '';
  const { permissions } = usePermissionsContext();
  const { canEdit, canCreate, canDelete } = usePermissions();
  const editable = canEdit('vendors');

  const [data, setData] = useState(() => peekList('vendors') || []);
  const [eng, setEng] = useState(() => peekAllEngagements() || []);
  const [loading, setLoading] = useState(() => !peekList('vendors'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState('all');
  const [catF, setCatF] = useState('All');
  const [monthF, setMonthF] = useState('All');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = m => { setToast(m); setTimeout(() => setToast(''), String(m).startsWith('❌') ? 9000 : 3000); };
  const load = async () => {
    if (!peekList('vendors')) setLoading(true);
    setRefreshing(true); setError(null);
    getAllEngagementsCached().then(setEng).catch(() => {});
    try { setData(await getVendorServices()); onRefreshed?.(new Date().toLocaleTimeString()); }
    catch (e) { if (peekList('vendors')) showToast('⚠ Could not refresh from Excel — showing the last saved copy.'); else setError(e); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const names = useMemo(() => [...new Set([...Object.values(permissions || {}).map(p => p?.name), ...data.map(v => v.requestedBy)].filter(Boolean))].sort(), [permissions, data]);
  const vendors = useMemo(() => [...new Set(data.map(v => v.vendorName).filter(Boolean))].sort(), [data]);
  const months = useMemo(() => [...new Set(data.map(v => String(v.serviceDate).slice(0, 7)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse(), [data]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return data.filter(v => {
      const mQ = !q || [v.serviceId, v.vendorName, v.description, v.client, v.program, v.egId, v.vendorInvoiceNo, v.clientInvoiceRef].some(x => norm(x).includes(q));
      const mQuick = quick === 'all' || (quick === 'tobill' && toBill(v)) || (quick === 'awaited' && v.paymentStatus === 'Invoice awaited')
        || (quick === 'topay' && toPay(v)) || (quick === 'done' && !toBill(v) && v.paymentStatus === 'Paid');
      return mQ && mQuick && (catF === 'All' || v.category === catF) && (monthF === 'All' || String(v.serviceDate).startsWith(monthF));
    }).sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || '')) || String(b.serviceId).localeCompare(String(a.serviceId), undefined, { numeric: true }));
  }, [data, search, quick, catF, monthF]);

  const sel = selected ? data.find(v => v.serviceId === selected) : null;
  const sum = (list, f) => list.reduce((t, v) => t + f(v), 0);
  // KPIs (and the quick-tab counts) follow search, category and month. The quick tabs themselves are
  // not applied to the cards — they are the same breakdown, so applying them would zero the others.
  const kpiBase = useMemo(() => {
    const q = norm(search);
    return data.filter(v => (!q || [v.serviceId, v.vendorName, v.description, v.client, v.program, v.egId, v.vendorInvoiceNo, v.clientInvoiceRef].some(x => norm(x).includes(q)))
      && (catF === 'All' || v.category === catF) && (monthF === 'All' || String(v.serviceDate).startsWith(monthF)));
  }, [data, search, catF, monthF]);
  const billList = kpiBase.filter(toBill), payList = kpiBase.filter(toPay), awaitList = kpiBase.filter(v => v.paymentStatus === 'Invoice awaited');
  const costMonth = monthF !== 'All' ? monthF : todayIso().slice(0, 7);

  /* writes */
  const save = async (v, isNew) => {
    setSaving(true);
    try {
      if (isNew) {
        const row = { ...v, serviceId: nextServiceId(data) };
        await addVendorService(row);
        const { amount, total } = vendorTotals(row);
        setData(d => [{ ...row, amount, total }, ...d]); setSelected(row.serviceId); showToast(`✓ Service ${row.serviceId} added`);
      } else {
        await updateVendorService(v);
        const { amount, total } = vendorTotals(v);
        setData(d => d.map(x => (x.serviceId === v.serviceId ? { ...v, amount, total } : x))); showToast('✓ Service updated');
      }
      setModal(null);
    } catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${sel.serviceId} · ${sel.vendorName}? This cannot be undone.`)) return;
    setSaving(true);
    try { await deleteVendorService(sel.serviceId); setData(d => d.filter(v => v.serviceId !== sel.serviceId)); setSelected(null); showToast('✓ Service deleted'); }
    catch (e) { showToast('❌ ' + e.message); }
    finally { setSaving(false); }
  };

  /* Reminders popup */
  const pendingBar = useMemo(() => pendingItems(filtered, VENDOR_RULES, v => ({ id: v.serviceId, serial: v.serviceId.replace(/^VS-0*/, ''), title: v.vendorName || '(no vendor)', subtitle: [v.category, v.client].filter(Boolean).join(' · ') })), [filtered]);
  const dueBar = useMemo(() => filtered.map(v => {
    const tasks = [];
    if (v.serviceDate && toBill(v)) tasks.push({ key: 'bill', label: 'Bill to client', due: addDays(v.serviceDate, CLIENT_BILLING_DAYS) });
    if (v.serviceDate && v.paymentStatus === 'Invoice awaited') tasks.push({ key: 'invoice', label: 'Get vendor invoice', due: addDays(v.serviceDate, VENDOR_INVOICE_EXPECTED_DAYS) });
    if (v.vendorInvoiceDate && toPay(v)) tasks.push({ key: 'pay', label: 'Pay vendor', due: addDays(v.vendorInvoiceDate, VENDOR_PAYMENT_DAYS) });
    return tasks.length ? { id: v.serviceId, serial: v.serviceId.replace(/^VS-0*/, ''), title: v.vendorName || '(no vendor)', subtitle: [v.client, inr(v.total)].filter(Boolean).join(' · '), tasks, row: v } : null;
  }).filter(Boolean), [filtered]);
  const openPending = (it, f) => { setSelected(it.row.serviceId); setModal(it.row); revealField(f.key, f.label); };
  const openDue = (it, t) => {
    setSelected(it.row.serviceId); setView('list');
    if (t.key === 'invoice') { setModal(it.row); revealField('vendorInvoiceNo', 'Vendor Invoice No'); }
    else revealField(t.key === 'bill' ? 'clientInvoiceRef' : 'paidDate', '');
  };

  if (loading) return <LoadingState message="Loading Vendor Service Tracker from Excel…" />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const quickCount = { all: kpiBase.length, tobill: billList.length, awaited: awaitList.length, topay: payList.length, done: kpiBase.filter(v => !toBill(v) && v.paymentStatus === 'Paid').length };

  return (
    <div className="tracker-page">
      {toast && <div className="lv-toast">{toast}</div>}
      {modal && <ServiceModal initial={modal === 'add' ? null : modal} prefill={{}} engagements={eng} vendors={vendors} names={names} me={me}
        saving={saving} onClose={() => setModal(null)} onSave={f => save(f, modal === 'add')} />}

      <div className="kpi-compact">
        <div className="kpi-card"><div className="kpi-label">To bill client</div><div className="kpi-value" style={{ color: billList.length ? 'var(--error)' : undefined }}>{inr(sum(billList, v => Number(v.total) || 0))}</div><div className="kpi-sub">{billList.length} billable services not billed</div></div>
        <div className="kpi-card"><div className="kpi-label">To pay vendors</div><div className="kpi-value">{inr(sum(payList, balance))}</div><div className="kpi-sub">{payList.length} invoice{payList.length === 1 ? "" : "s"} unpaid</div></div>
        <div className="kpi-card"><div className="kpi-label">Vendor invoices awaited</div><div className="kpi-value">{awaitList.length}</div><div className="kpi-sub">{inr(sum(awaitList, v => Number(v.total) || 0))} expected</div></div>
        <div className="kpi-card accent"><div className="kpi-label">{monthF !== 'All' ? `Vendor cost · ${monthF}` : 'Vendor cost this month'}</div><div className="kpi-value">{inr(sum(kpiBase.filter(v => String(v.serviceDate).slice(0, 7) === costMonth), v => Number(v.total) || 0))}</div><div className="kpi-sub">{kpiBase.length !== data.length ? `${kpiBase.length} filtered · ` : ''}{data.length} services in total</div></div>
      </div>

      <div className="filter-bar lv-filters" style={{ flexShrink: 0 }}>
        <div className="lv-tabs">
          {[['list', 'Services'], ['engagement', 'By engagement'], ['vendor', 'By vendor'], ['category', 'By category']].map(([k, l]) =>
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <input className="form-input wide" placeholder="🔍 Vendor, client, invoice no…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input" value={catF} onChange={e => setCatF(e.target.value)}>
          <option value="All">All categories</option>{[...new Set([...VENDOR_CATEGORIES, ...data.map(v => v.category).filter(Boolean)])].map(c => <option key={c}>{c}</option>)}
        </select>
        <select className="form-input" value={monthF} onChange={e => setMonthF(e.target.value)}>
          <option value="All">All months</option>{months.map(m => <option key={m} value={m}>{MON[+m.slice(5) - 1]} {m.slice(0, 4)}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>{refreshing ? '⟳' : '↺'}</button>
        <ExportButton page="vendors" filename="Vendor Service Tracker" sheetName="Vendor Services" rows={() => filtered}
          columns={[['Service ID', 'serviceId'], ['Vendor Name', 'vendorName'], ['Vendor Contact', 'vendorContact'], ['Service Category', 'category'], ['Service Description', 'description'],
            ['Client', 'client'], ['Program', 'program'], ['EG ID', 'egId'], ['Engagement Index', 'engagementKey'], ['Service Date', 'serviceDate'],
            ['Total Cost', 'total'], ['Requested By', 'requestedBy'], ['Billable to Client', 'billable'], ['Client Billing Status', 'clientBilling'],
            ['Client Invoice Ref', 'clientInvoiceRef'], ['Client Invoice Date', 'clientInvoiceDate'], ['Vendor Invoice No', 'vendorInvoiceNo'], ['Vendor Invoice Date', 'vendorInvoiceDate'],
            ['Vendor Payment Status', 'paymentStatus'], ['Paid Amount', 'paidAmount'], ['Paid Date', 'paidDate'], ['Comments', 'comments']].map(([label, key]) => ({ label, key }))} />
        {canCreate('vendors') && <button className="btn btn-primary btn-sm" onClick={() => setModal('add')}>+ Add Service</button>}
      </div>

      <div className="lv-quickfilters">
        {QUICK.map(([k, l]) => <button key={k} className={`lv-qf${quick === k ? ' on' : ''}`} onClick={() => setQuick(k)}>{l} <b>{quickCount[k]}</b></button>)}
      </div>

      {view !== 'list' ? <div className="tracker-scroll"><div className="card" style={{ padding: 16 }}><Summary rows={filtered} by={view} /></div></div> : (
        <div className="grid-sidebar" style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', marginBottom: 0 }}>
            <div className="card-header" style={{ flexShrink: 0 }}>
              <span className="card-title">Vendor services</span>
              <span className="lv-muted">{filtered.length} of {data.length} · {inr(sum(filtered, v => Number(v.total) || 0))}</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {!filtered.length ? <div className="lv-empty" style={{ margin: 16 }}>No services match these filters{data.length ? '' : ' — add the first one with “+ Add Service”'}.</div>
                : filtered.map(v => {
                  const isSel = selected === v.serviceId;
                  return (
                    <div key={v.serviceId} className={`lv-row${isSel ? ' sel' : ''}`} onClick={() => setSelected(isSel ? null : v.serviceId)}>
                      <div className="lv-row-top">
                        <span className="lv-id">{v.serviceId}</span>
                        <span className="lv-row-name">{v.vendorName || '(no vendor)'}</span>
                        <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 13 }}>{inr(v.total)}</span>
                      </div>
                      <div className="lv-row-sub">{[v.category, v.description].filter(Boolean).join(' · ') || '—'}</div>
                      <div className="lv-row-meta">
                        <span>{fmtD(v.serviceDate)}</span>
                        {v.client && <span>{v.client}</span>}
                        {toBill(v) && <span className="lv-due lv-due-bad">To bill</span>}
                        {v.paymentStatus === 'Invoice awaited' && <span className="lv-due lv-due-warn">Invoice awaited</span>}
                        {toPay(v) && <span className="lv-due lv-due-warn">To pay</span>}
                        {v.paymentStatus === 'Paid' && !toBill(v) && <span className="lv-due lv-due-ok">Closed</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div style={{ height: '100%', overflowY: 'auto' }}>
            {sel ? <ServicePanel v={sel} canEdit={editable} saving={saving} onEdit={() => setModal(sel)} onDelete={canDelete('vendors') ? remove : undefined}
              onQuick={changes => save({ ...sel, ...changes }, false)} />
              : <div className="card lv-placeholder"><div className="lv-big">👈</div><b>Select a service</b><div className="lv-muted">See cost, the engagement it was for, client billing and vendor payment</div></div>}
          </div>
        </div>
      )}

      <PendingFieldsBar items={pendingBar} dueItems={dueBar} onPick={openPending} onPickDue={openDue} canEdit={editable} noun="service" />
    </div>
  );
}
