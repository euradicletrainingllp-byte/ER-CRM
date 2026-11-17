import { useState, useEffect, useMemo, useRef } from 'react';
import { readSheet, toISODate } from '../utils/importExcel.js';
import { downloadXlsx } from '../utils/exportExcel.js';
import { getAllEngagementsCached, nextEngagementIndex, ecHasExtraCols } from '../services/api.js';
import { ClientPicker, ConsultantPicker } from './pickers/index.jsx';
import '../styles/bulkUpload.css';

/**
 * BulkUploadEngagements — upload an .xlsx/.csv of engagements, review and edit them in a grid,
 * then save them one by one. Rows that fail stay in the grid with the error.
 *
 * Each file row is matched to the calendar:
 *   - file has an Index column -> match by Index only (blank Index = new row)
 *   - no Index column          -> match by company + Start Date + topic
 * Matched rows are seeded with the calendar's values, so only cells that differ count as updates
 * (a blank cell in the file never clears a value). Unchanged rows are not uploaded.
 *
 *   onSaveRow(form, index)         -> Promise  adds one engagement (same rules as "+ Add Engagement")
 *   onUpdateRow(original, changes) -> Promise  updates one engagement (same rules as Edit)
 *   genEgId(existingIds)   → next EG ID after the given ones
 *   onFinished({ added, updated }) called after a run that saved at least one row
 */

const STATUSES = ['Scheduled', 'Tentative', 'Delivered', 'Cancelled', 'Postponed', 'Re-Schedule'];

// [key, label, width, type, header aliases]
const BASE_COLS = [
  ['egId',           'EG ID',           110, 'text',   ['egid', 'eg', 'egnumber']],
  ['company',        'Client / Company', 190, 'client', ['company', 'client', 'clientname', 'clientcompany', 'companyname', 'account']],
  ['startDate',      'Start Date',      135, 'date',   ['startdate', 'start', 'date', 'fromdate', 'from']],
  ['endDate',        'End Date',        135, 'date',   ['enddate', 'end', 'todate', 'to']],
  ['topic',          'Topic / Program', 220, 'text',   ['topic', 'program', 'programme', 'topicprogram', 'programname', 'engagement']],
  ['sector',         'Sector',          120, 'text',   ['sector', 'industry']],
  ['serviceType',    'Service Type',    130, 'text',   ['servicetype', 'service']],
  ['offering',       'Offering',        130, 'text',   ['offering']],
  ['day',            'Days',             64, 'number', ['day', 'days', 'noofdays', 'numberofdays']],
  ['location',       'Location',        110, 'text',   ['location', 'city', 'venue', 'mode']],
  ['consultant1',    'Lead Consultant', 170, 'consultant', ['consultant1', 'leadconsultant', 'consultant', 'facilitator', 'trainer', 'coach']],
  ['consultant2',    'Co-Consultant',   170, 'consultant', ['consultant2', 'coconsultant', 'cofacilitator']],
  ['status',         'Status',          120, 'status', ['status']],
  ['contract',       'Contract Type',   120, 'text',   ['contract', 'contracttype']],
  ['poStatus',       'Contract Status', 120, 'text',   ['postatus', 'contractstatus', 'po']],
  ['price',          'Price (₹)',       110, 'number', ['priceinr', 'price', 'fee', 'fees', 'amount', 'value']],
  ['travelExpenses', 'Travel & Misc (₹)', 110, 'number', ['travelstayandmiscexpenses', 'travelexpenses', 'travel', 'travelstaymiscexp']],
];
const EXTRA_COLS = [
  ['pmCost',           'PM Cost (₹)',       100, 'number', ['pmcost']],
  ['materialCost',     'Material Cost (₹)', 110, 'number', ['materialcost']],
  ['otherCost',        'Other Cost (₹)',    100, 'number', ['othercost']],
  ['otherCostDetails', 'Other Cost Details', 150, 'text',  ['othercostdetails']],
  ['priceComments',    'Price Comments',    160, 'text',   ['pricecomments']],
];
const TAIL_COLS = [
  ['comments',     'Comments',      200, 'text', ['comments', 'comment', 'remarks', 'notes']],
  ['proposalLink', 'Proposal Link', 200, 'text', ['proposallink', 'proposal', 'link']],
];

const BLANK = {
  egId: '', company: '', startDate: '', endDate: '', topic: '', sector: '', serviceType: '', offering: '',
  day: '1', location: 'VILT', consultant1: '', consultant2: '', status: 'Scheduled', contract: '', poStatus: '',
  invoice: '', price: '', travelExpenses: '', gst: '', payment: '', amountReceived: '', receivedDate: '',
  comments: '', feedback: '', nps: '', proposalLink: '', opsChecklist: '',
  pmCost: '', materialCost: '', otherCost: '', otherCostDetails: '', priceComments: '',
  travelInvoiceRaised: '', travelInvoiceDate: '', travelReceived: '', travelReceivedAmount: '', travelReceivedDate: '',
};

const INDEX_ALIASES = ['index', 'engagementkey', 'engagementindex', 'idx'];
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const lc = s => String(s ?? '').trim().toLowerCase();
const dupKey = r => `${lc(r.company)}|${toISODate(r.startDate) || ''}|${lc(r.topic)}`;
const numOf = v => Number(String(v ?? '').replace(/[₹,\s]/g, '')) || 0;
const show = v => (v == null || String(v).trim() === '' ? '(blank)' : String(v));
let uid = 0;
const newId = () => `bu${++uid}`;

const filledIn = (cells, map, k) => {
  const i = map.indexOf(k);
  return i >= 0 && String(cells[i] ?? '').trim() !== '';
};

function validate(r) {
  const errs = [];
  if (!String(r.egId).trim())    errs.push('EG ID is required');
  if (!String(r.company).trim()) errs.push('Company is required');
  if (!String(r.topic).trim())   errs.push('Topic is required');
  if (!r.startDate)              errs.push('Start Date is required');
  if (r._badDate?.startDate)     errs.push(`Start Date "${r._badDate.startDate}" not readable`);
  if (r._badDate?.endDate)       errs.push(`End Date "${r._badDate.endDate}" not readable`);
  if (r.startDate && r.endDate && r.endDate < r.startDate) errs.push('End Date is before Start Date');
  for (const k of ['day', 'price', 'travelExpenses', 'pmCost', 'materialCost', 'otherCost']) {
    if (String(r[k] ?? '').trim() !== '' && isNaN(Number(String(r[k]).replace(/[₹,\s]/g, '')))) errs.push(`${k} must be a number`);
  }
  return errs;
}

export default function BulkUploadEngagements({ onClose, onSaveRow, onUpdateRow, genEgId, onFinished }) {
  const cols = useMemo(() => [...BASE_COLS, ...(ecHasExtraCols() ? EXTRA_COLS : []), ...TAIL_COLS], []);
  const typeOf = useMemo(() => Object.fromEntries(cols.map(c => [c[0], c[3]])), [cols]);
  // Calendar value -> the shape the grid holds (so seeded cells compare equal)
  const gridVal = (k, v) => {
    const t = typeOf[k];
    if (v == null) return '';
    if (t === 'date') return toISODate(v) || '';
    if (t === 'number') return numOf(v) ? String(numOf(v)) : '';
    return String(v).trim();
  };
  const same = (k, a, b) => {
    const t = typeOf[k];
    if (t === 'number') return numOf(a) === numOf(b);
    if (t === 'date') return (toISODate(a) || '') === (toISODate(b) || '');
    if (t === 'status') return lc(a) === lc(b);
    return String(a ?? '').trim() === String(b ?? '').trim();
  };
  const [existing, setExisting] = useState(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows]         = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [readErr, setReadErr]   = useState('');
  const [reading, setReading]   = useState(false);
  const [over, setOver]         = useState(false);
  const [onlyErr, setOnlyErr]   = useState(false);
  const [showSame, setShowSame] = useState(false);
  const [run, setRun]           = useState(null);     // { done, total } while saving
  const [msg, setMsg]           = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    getAllEngagementsCached().then(setExisting).catch(() => setExisting([]));
  }, []);

  const existingByKey = useMemo(() => {
    const m = new Map();
    (existing || []).forEach(e => { const k = dupKey(e); if (!m.has(k)) m.set(k, e); });
    return m;
  }, [existing]);

  const egIdsInUse = list => [...new Set([
    ...(existing || []).map(e => e.egId), ...list.map(r => r.egId),
  ].filter(Boolean))];

  const checked = useMemo(() => {
    const seen = new Map(), seenIdx = new Map();
    rows.forEach(r => {
      const k = dupKey(r); seen.set(k, (seen.get(k) || 0) + 1);
      if (r._match) seenIdx.set(r._match.engagementKey, (seenIdx.get(r._match.engagementKey) || 0) + 1);
    });
    return rows.map(r => {
      const m = r._match;
      const changes = m ? cols.map(c => c[0]).filter(k => !same(k, r[k], gridVal(k, m[k]))) : [];
      const kind = !m ? 'new' : changes.length ? 'update' : 'same';
      let errs = kind === 'same' ? [] : validate(r);
      if (r._saveErr) errs = [...errs, r._saveErr];
      if (m && seenIdx.get(m.engagementKey) > 1) errs = [...errs, `Index ${m.engagementKey} appears more than once in this file`];
      const k = dupKey(r);
      let dup = '';
      if (!m && r.company && r.startDate && r.topic) {
        const hit = existingByKey.get(k);
        dup = hit ? `Possible duplicate of Index ${hit.engagementKey || '-'} (same company, start date and topic)`
            : seen.get(k) > 1 ? 'Repeated in this upload' : '';
      }
      const note = !m && r._fileIndex ? `Index ${r._fileIndex} is not in the calendar, so this row will be added as new` : '';
      return { r, errs, dup, kind, changes: new Set(changes), note };
    });
  }, [rows, existingByKey, cols]);   // eslint-disable-line react-hooks/exhaustive-deps

  const active = checked.filter(c => c.kind !== 'same');
  const nErr  = active.filter(c => c.errs.length).length;
  const nDup  = active.filter(c => !c.errs.length && c.dup).length;
  const nNew  = active.filter(c => !c.errs.length && c.kind === 'new').length;
  const nUpd  = active.filter(c => !c.errs.length && c.kind === 'update').length;
  const nSame = checked.length - active.length;
  const nOk   = nNew + nUpd;
  const shown = checked.filter(c => (onlyErr ? c.errs.length > 0 : (showSame || c.kind !== 'same')));
  const busy  = !!run;

  async function loadFile(file) {
    if (!file) return;
    setReadErr(''); setMsg(''); setReading(true); setFileName(file.name);
    try {
      const { header, rows: raw } = await readSheet(file);
      if (!header.length) throw new Error('The file has no header row');
      const idxCol = header.findIndex(h => INDEX_ALIASES.includes(norm(h)));
      const map = header.map(h => {
        const n = norm(h);
        const hit = cols.find(([key, label, , , al]) => norm(key) === n || norm(label) === n || al.includes(n));
        return hit ? hit[0] : null;
      });
      // one column per field — first match wins
      const used = new Set();
      map.forEach((k, i) => { if (k && used.has(k)) map[i] = null; else if (k) used.add(k); });
      setUnmapped(header.filter((h, i) => h && !map[i] && !INDEX_ALIASES.includes(norm(h)) && !['sno', 'sn', 'serialno'].includes(norm(h))));

      const all = await (existing ? Promise.resolve(existing) : getAllEngagementsCached().catch(() => []));
      if (!existing) setExisting(all);
      const taken = new Set(all.map(e => e.egId).filter(Boolean));
      const byIndex = new Map(all.filter(e => e.engagementKey).map(e => [String(e.engagementKey).trim(), e]));
      const byKey = new Map();
      all.forEach(e => { const k = dupKey(e); if (!byKey.has(k)) byKey.set(k, e); });
      const groupEg = new Map();                    // company|topic → EG ID given to blank rows

      const parsed = raw.map(cells => {
        const r = { ...BLANK, _id: newId(), _badDate: {} };
        map.forEach((k, i) => {
          if (!k) return;
          const v = cells[i];
          if (v == null || String(v).trim() === '') return;
          const type = cols.find(c => c[0] === k)[3];
          if (type === 'date') {
            const iso = toISODate(v);
            if (iso === null) r._badDate[k] = String(v); else r[k] = iso;
          } else if (type === 'status') {
            r[k] = STATUSES.find(s => lc(s) === lc(v)) || String(v).trim();
          } else if (type === 'number') {
            r[k] = String(v).replace(/[₹,\s]/g, '');
          } else r[k] = String(v).trim();
        });
        // Match to the calendar, then seed cells the file left blank with the calendar's values
        const fileIndex = idxCol >= 0 ? String(cells[idxCol] ?? '').trim().replace(/\.0+$/, '') : '';
        const match = idxCol >= 0 ? (fileIndex ? byIndex.get(fileIndex) || null : null)
                                  : (r.company && r.startDate && r.topic ? byKey.get(dupKey(r)) || null : null);
        if (match) {
          for (const [k] of cols) if (!filledIn(cells, map, k)) r[k] = gridVal(k, match[k]);
        }
        r._match = match; r._fileIndex = match ? '' : fileIndex;
        if (!match && !r.endDate && r.startDate) r.endDate = r.startDate;
        if (r.egId) taken.add(r.egId);
        return r;
      });
      // Blank EG IDs: one new EG ID per company + topic in the file
      for (const r of parsed) {
        if (r.egId) continue;
        const g = `${lc(r.company)}|${lc(r.topic)}`;
        if (!groupEg.has(g)) { const id = genEgId([...taken]); taken.add(id); groupEg.set(g, id); }
        r.egId = groupEg.get(g);
      }
      if (!parsed.length) throw new Error('No data rows found under the header');
      setRows(parsed);
    } catch (e) {
      setReadErr(e.message || String(e));
    } finally {
      setReading(false);
    }
  }

  const setCell = (id, k, v) => setRows(rs => rs.map(r => {
    if (r._id !== id) return r;
    const next = { ...r, [k]: v, _saveErr: '' };
    if (r._badDate?.[k]) next._badDate = { ...r._badDate, [k]: undefined };
    return next;
  }));
  const removeRow = id => setRows(rs => rs.filter(r => r._id !== id));
  const copyRow = id => setRows(rs => {
    const i = rs.findIndex(r => r._id === id);
    const copy = { ...rs[i], _id: newId(), _saveErr: '', _badDate: { ...rs[i]._badDate }, _match: null, _fileIndex: '' };  // a copy is always a new row
    return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
  });
  const addRow = () => setRows(rs => [...rs, { ...BLANK, _id: newId(), _badDate: {}, egId: genEgId(egIdsInUse(rs)) }]);

  function downloadTemplate() {
    downloadXlsx({
      filename: 'Engagement Bulk Upload Template', sheetName: 'Engagements',
      columns: [{ label: 'Index', key: 'engagementKey' }, ...cols.map(([key, label]) => ({ label: label.replace(' (₹)', ' (INR)'), key }))],
      rows: [],
    });
  }

  async function upload() {
    const ready = checked.filter(c => c.kind !== 'same' && !c.errs.length);
    if (!ready.length) return;
    setMsg(''); setRun({ done: 0, total: ready.length });
    let idx = null;
    if (ready.some(c => c.kind === 'new')) {
      try { idx = Number(await nextEngagementIndex()) || 1; }
      catch (e) { setRun(null); setMsg('❌ Could not read the next Index: ' + e.message); return; }
    }

    let added = 0, updated = 0;
    for (const c of ready) {
      const r = c.r;
      setRows(rs => rs.map(x => (x._id === r._id ? { ...x, _saving: true } : x)));
      try {
        const { _id, _badDate, _saveErr, _saving, _match, _fileIndex, ...form } = r;
        if (c.kind === 'new') {
          await onSaveRow(form, String(idx));
          idx += 1; added += 1;
        } else {
          const changes = Object.fromEntries([...c.changes].map(k => [k, form[k]]));
          await onUpdateRow(_match, changes);
          updated += 1;
        }
        setRows(rs => rs.filter(x => x._id !== r._id));
      } catch (e) {
        setRows(rs => rs.map(x => (x._id === r._id ? { ...x, _saving: false, _saveErr: 'Save failed: ' + (e.message || e) } : x)));
      }
      setRun(p => ({ ...p, done: p.done + 1 }));
    }
    setRun(null);
    const failed = ready.length - added - updated;
    if (added || updated) onFinished?.({ added, updated });
    if (!failed && ready.length === active.length) { onClose(); return; }
    const done = [added && `${added} added`, updated && `${updated} updated`].filter(Boolean).join(' · ') || 'Nothing saved';
    setMsg(failed ? `${done} · ${failed} failed. Fix the red rows and upload again.` : `${done}. Rows with errors are still here.`);
    if (failed) setOnlyErr(true);
  }

  const cell = (c, col) => {
    const key = col[0];
    const inner = cellInput(c, col);
    if (!c.changes.has(key)) return inner;
    return <div className="bu-chg" title={`Was: ${show(c.r._match[key])}`}>{inner}</div>;
  };

  const cellInput = (c, [key, , , type]) => {
    const r = c.r;
    const bad = (key === 'startDate' && (!r.startDate || r._badDate?.startDate))
             || (key === 'endDate' && (r._badDate?.endDate || (r.endDate && r.startDate && r.endDate < r.startDate)))
             || (['egId', 'company', 'topic'].includes(key) && !String(r[key]).trim());
    const cls = 'bu-in' + (bad ? ' bad' : '');
    if (type === 'client') return (
      <div className="bu-cell-picker"><ClientPicker value={r.company} onChange={v => setCell(r._id, 'company', v)}
        onPick={cl => { if (!r.sector && cl.industry) setCell(r._id, 'sector', cl.industry); }} /></div>
    );
    if (type === 'consultant') return (
      <div className="bu-cell-picker"><ConsultantPicker value={r[key] ?? ''} onChange={v => setCell(r._id, key, v)} /></div>
    );
    if (type === 'status') return (
      <select className={cls} value={r.status} onChange={e => setCell(r._id, 'status', e.target.value)}>
        {[...new Set([...STATUSES, r.status])].filter(Boolean).map(s => <option key={s}>{s}</option>)}
      </select>
    );
    if (type === 'date') return (
      <input type="date" className={cls} value={r[key] || ''} title={r._badDate?.[key] ? `Couldn't read "${r._badDate[key]}"` : undefined}
        onChange={e => setCell(r._id, key, e.target.value)} />
    );
    return (
      <input className={cls} inputMode={type === 'number' ? 'decimal' : undefined} value={r[key] ?? ''}
        onChange={e => setCell(r._id, key, e.target.value)} />
    );
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box bu-modal" onClick={e => e.stopPropagation()}>
        <div className="bu-head">
          <div className="modal-title">⇪ Bulk Upload Engagements</div>
          {fileName && <span className="bu-file">{fileName}</span>}
          <span className="bu-spacer" />
          <button className="bu-link" onClick={downloadTemplate}>Download template</button>
          {rows.length > 0 && !busy && (
            <button className="bu-link" onClick={() => fileRef.current?.click()}>Choose another file</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden
          onChange={e => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />

        {!rows.length ? (
          <div className={'bu-drop' + (over ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); loadFile(e.dataTransfer.files?.[0]); }}>
            <strong>{reading ? '⏳ Reading file…' : 'Drop an Excel (.xlsx) or .csv file here'}</strong>
            Column names are matched to the Engagement Calendar (Index, EG ID, company, Start Date, topic …).<br />
            A full calendar export works too: rows are matched by Index (or company + start date + topic), and only new or changed rows are uploaded.<br />
            Blank cells never clear a value. Blank EG IDs on new rows are filled automatically, with one new EG ID per company + topic.
            <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={reading}>Choose file</button>
              <button className="btn btn-outline btn-sm" onClick={addRow}>Start with an empty row</button>
            </div>
            {readErr && <div className="bu-msg err" style={{ marginTop: 12 }}>❌ {readErr}</div>}
          </div>
        ) : (
          <>
            <div className="bu-chips">
              <span className="bu-chip">{rows.length} rows</span>
              <span className="bu-chip new">{nNew} new</span>
              <span className="bu-chip upd" title="Matched to the calendar with changed cells (hover a highlighted cell to see the old value)">{nUpd} updates</span>
              <span className={'bu-chip same' + (showSame ? ' on' : '')} onClick={() => setShowSame(v => !v)}
                title="Already in the calendar with no changes. Not uploaded. Click to show or hide.">{nSame} unchanged{showSame ? ' (shown)' : ''}</span>
              <span className={'bu-chip err' + (onlyErr ? ' on' : '')} onClick={() => setOnlyErr(v => !v)}
                title="Show only rows with errors">{nErr} with errors</span>
              <span className="bu-chip dup" title="Uploaded anyway — check before saving">{nDup} possible duplicates</span>
              {unmapped.length > 0 && (
                <span className="bu-msg" title={unmapped.join(', ')}>Ignored columns: {unmapped.slice(0, 4).join(', ')}{unmapped.length > 4 ? ` +${unmapped.length - 4}` : ''}</span>
              )}
            </div>
            <div className="bu-grid-wrap">
              <table className="bu-grid">
                <thead>
                  <tr>
                    <th className="bu-sticky" style={{ width: 26 }} />
                    <th style={{ minWidth: 92 }}>In calendar</th>
                    {cols.map(([k, label, w]) => <th key={k} style={{ minWidth: w }}>{label}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(c => (
                    <tr key={c.r._id} className={c.r._saving ? 'saving' : c.errs.length ? 'err' : c.dup ? 'dup' : c.kind === 'same' ? 'same' : ''}>
                      <td className="bu-sticky bu-state" title={[...c.errs, c.dup, c.note].filter(Boolean).join('\n') || (c.kind === 'same' ? 'No changes, so this row is skipped' : 'Ready')}
                        style={{ color: c.errs.length ? '#b4483a' : c.dup ? '#8a6d0b' : '#08803a' }}>
                        {c.r._saving ? '⏳' : c.errs.length ? '✕' : c.dup ? '⚠' : c.kind === 'same' ? '=' : '✓'}
                      </td>
                      <td>
                        {c.kind === 'new'
                          ? <span className="bu-tag new" title={c.note || 'Not in the calendar yet'}>New{c.note ? ' *' : ''}</span>
                          : <span className={'bu-tag ' + c.kind} title={c.kind === 'update' ? `Changes: ${[...c.changes].map(k => cols.find(x => x[0] === k)[1]).join(', ')}` : 'Same as the calendar'}>
                              {c.kind === 'update' ? `${c.changes.size} change${c.changes.size === 1 ? '' : 's'}` : 'Same'} · #{c.r._match.engagementKey}
                            </span>}
                      </td>
                      {cols.map(col => <td key={col[0]}>{cell(c, col)}</td>)}
                      <td>
                        <div className="bu-act">
                          <button title="Duplicate row" onClick={() => copyRow(c.r._id)} disabled={busy}>⧉</button>
                          <button title="Remove row" onClick={() => removeRow(c.r._id)} disabled={busy}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nErr > 0 && (
              <div className="bu-msg" style={{ marginTop: 6 }}>Hover ✕ to see what to fix. Rows with errors are skipped on upload.</div>
            )}
          </>
        )}

        <div className="bu-foot">
          {rows.length > 0 && <button className="btn btn-outline btn-sm" onClick={addRow} disabled={busy}>+ Add row</button>}
          {run ? (
            <>
              <div className="bu-progress"><div style={{ width: `${(run.done / run.total) * 100}%` }} /></div>
              <span className="bu-msg">Saving {run.done} / {run.total}…</span>
            </>
          ) : <span className={'bu-msg' + (msg.includes('failed') || msg.startsWith('❌') ? ' err' : '')} style={{ flex: 1 }}>{msg}</span>}
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>{msg ? 'Close' : 'Cancel'}</button>
          <button className="btn btn-primary" onClick={upload} disabled={busy || !nOk || existing === null}>
            {busy ? '⏳ Uploading…' : `⇪ Upload ${[nNew && `${nNew} new`, nUpd && `${nUpd} update${nUpd === 1 ? '' : 's'}`].filter(Boolean).join(' + ') || '0 rows'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
