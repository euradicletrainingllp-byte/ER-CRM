import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getSolutionTracker, peekList,
  addSolutionRow,
  updateSolutionRow,
  deleteSolutionRow,
  BD_EXTRA_COLUMNS,
  checkSolutionDates,
} from '../services/api.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { EditButton, DeleteButton } from '../components/ActionButtons.jsx';
import { Trash2 } from 'lucide-react';
import { useExcelFilters, CollapsibleFilterBar } from '../components/ExcelFilter.jsx';
import { LinkButton, LinkInput } from '../components/LinkButton.jsx';
import ChecklistPicker, { ChecklistChips } from '../components/ChecklistPicker.jsx';
import { parseChecklist } from '../config/opsChecklistItems.js';
import ExportButton from '../components/ExportButton.jsx';
import { pushBdChecklist } from '../services/bdChecklistSync.js';
import PendingFieldsBar, { revealField } from '../components/PendingFieldsBar.jsx';
import { pendingItems, BD_RULES, SOL_RULES, toIso } from '../config/pendingFields.js';
import { getLeads, updateLead } from '../services/leadsVendorsApi.js';

// In Process and Won proposals must carry the Operations checklist ticked by the BD person
const CHECKLIST_STATUSES = ['In Process', 'Won'];
const showsChecklist = r => CHECKLIST_STATUSES.includes(r?.bdStatus);
const needsChecklist = r => showsChecklist(r) && parseChecklist(r.opsChecklist).length === 0;
// Proposal link for a solution item: its own link, else any link saved under the same Proposal ID
const proposalLinkFor = (rows, pid, own) =>
  own || (rows.find(x => x.proposalId === pid && String(x.proposalV1Link || '').trim()) || {}).proposalV1Link || '';
// BD-level proposal link for one version of a proposal: the BD anchor row's link first,
// then any row of that version, then any row of the proposal.
const hasLink = r => !!String(r?.proposalV1Link || '').trim();
function bdLinkFor(rows, pid, version) {
  const same = rows.filter(r => r.proposalId === pid);
  const ver  = same.filter(r => versionNo(r.proposalVersion) === versionNo(version));
  const hit  = ver.find(r => r.bdSNo && hasLink(r)) || ver.find(hasLink) || same.find(hasLink);
  return hit ? String(hit.proposalV1Link).trim() : '';
}

// ── Proposal versions (V1, V2 …) ─────────────────────────────────────────────
// Each revised version of a proposal is its own Excel row with the same Proposal ID.
const versionNo = v => { const m = String(v ?? '').match(/(\d+)/); return m ? Number(m[1]) : 1; };
// Serial shown for a BD line: its position in BD-month order (each version is its own line and number)
const bdNoOf = r => r?._bdNo ?? (r?.bdSNo || r?.sno);
// The row that represents the latest version of a proposal (prefers the BD anchor row of that version)
function latestRowFor(rows, pid) {
  let best = null, bestI = -1;
  rows.forEach((r, i) => {
    if (r.proposalId !== pid) return;
    if (!best) { best = r; bestI = i; return; }
    const a = versionNo(r.proposalVersion), b = versionNo(best.proposalVersion);
    if (a > b || (a === b && !best.bdSNo && r.bdSNo)) { best = r; bestI = i; }
  });
  return best;
}
// Date of Discussion for a proposal: from a row of the same version first, else any row
function proposalDiscussion(rows, pid, version) {
  const same = rows.filter(r => r.proposalId === pid && r.dateOfDiscussion);
  const v = same.find(r => versionNo(r.proposalVersion) === versionNo(version));
  return (v || same[0])?.dateOfDiscussion || '';
}
// One row per version of a proposal, oldest first
function versionsFor(rows, pid) {
  const byV = new Map();
  rows.filter(r => r.proposalId === pid).forEach(r => {
    const k = versionNo(r.proposalVersion);
    const prev = byV.get(k);
    if (!prev || (!prev.bdSNo && r.bdSNo)) byV.set(k, r);
  });
  return [...byV.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
}
// Next version label for a proposal: highest existing version + 1 (keeps the "V" style)
function nextVersionLabel(rows, pid, current) {
  const nums = rows.filter(r => r.proposalId === pid).map(r => versionNo(r.proposalVersion));
  const n = Math.max(versionNo(current), ...nums, 0) + 1;
  return /^\s*\d+\s*$/.test(String(current || '')) ? String(n) : `V${n}`;
}
// Solution-item fields — never copied onto a revised BD version row
const SOL_FIELDS = ['solutionTopic', 'solutionMonth', 'programType', 'engagementType', 'lineOfService',
  'typeOfService', 'developmentCategory', 'solutionValue', 'status', 'remarks', 'proposalV1Link'];
// Solution-item fields carried over to a revised version (Solution Month / S Nos are left to Excel)
const SOL_COPY_FIELDS = ['solutionTopic', 'programType', 'engagementType', 'lineOfService',
  'typeOfService', 'developmentCategory', 'solutionValue', 'remarks', 'proposalV1Link'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k] ?? '']));
// Each version of a proposal is its own line in the list: key = Proposal ID + version number
const groupKey = (pid, v) => `${pid}|${versionNo(v)}`;
const rowsOfVersion = (rows, pid, v) =>
  rows.filter(r => r.proposalId === pid && versionNo(r.proposalVersion) === versionNo(v));
// BD line of one version: the row with a BD S No, else the first row of that version
function anchorOfVersion(rows, pid, v) {
  const vr = rowsOfVersion(rows, pid, v);
  return vr.find(r => r.bdSNo) || vr[0] || null;
}

// ── Excel export columns ──────────────────────────────────────────────────────
const BD_EXPORT_COLUMNS = [
  { label: 'BD S No',              get: r => bdNoOf(r) },
  { label: 'Proposal ID',          get: r => r.proposalId },
  { label: 'Proposal Version',     get: r => r.proposalVersion },
  { label: 'Client Name',          get: r => r.clientName },
  { label: 'Client POC',           get: r => r.clientPoc },
  { label: 'Contact Number',       get: r => r.contactNumber },
  { label: 'Client POC Email ID',  get: r => r.clientPocEmail },
  { label: 'Client POC Designation', get: r => r.clientPocDesignation },
  { label: 'Additional Client POCs', get: r => parsePocs(r.additionalPocs).map(pocLabel).join(' | ') },
  { label: 'Date of Discussion',   get: r => r.dateOfDiscussion },
  { label: 'Client Expected Date', get: r => r.clientExpectedDate },
  { label: 'BD Month',             get: r => r.bdMonth },
  { label: 'Program Topic',        get: r => r.programTopic },
  { label: 'BD Status',            get: r => r.bdStatus },
  { label: 'BD Proposal Value',    get: r => (toNum(r.bdProposalValue) || r.bdProposalValue || '') },
  { label: 'Date of Submission to Client', get: r => r.submissionToClient },
  { label: 'Ops Checklist',        get: r => parseChecklist(r.opsChecklist).join(', ') },
  { label: 'Participant Profile',  get: r => splitList(r.participantProfile).join(', ') },
  { label: 'Total Expected Headcount', get: r => (toNum(r.expectedHeadcount) || r.expectedHeadcount || '') },
  { label: 'Total Expected Batches',   get: r => (toNum(r.expectedBatches) || r.expectedBatches || '') },
  { label: 'Price per Batch',      get: r => (toNum(r.pricePerBatch) || '') },
  { label: 'Total Cost of Proposal', get: r => (totalCostOf(r) || '') },
  { label: 'BD Comments',          get: r => r.bdComments },
];
const SOL_EXPORT_COLUMNS = [
  { label: 'Proposal ID',          get: r => r.proposalId },
  { label: 'Proposal Version',     get: r => r.proposalVersion },
  { label: 'Client Name',          get: r => r.clientName },
  { label: 'Program Topic',        get: r => r.programTopic },
  { label: 'BD Status',            get: r => r.bdStatus },
  { label: 'Sol S No',             get: r => r.solSNo },
  { label: 'Solution Month',       get: r => r.solutionMonth },
  { label: 'Solution Topic',       get: r => r.solutionTopic },
  { label: 'Program Type',         get: r => r.programType },
  { label: 'Engagement Type',      get: r => r.engagementType },
  { label: 'Line of Service',      get: r => r.lineOfService },
  { label: 'Type of Service',      get: r => r.typeOfService },
  { label: 'Development Category', get: r => r.developmentCategory },
  { label: 'Solution Value',       get: r => (toNum(r.solutionValue) || r.solutionValue || '') },
  { label: 'Status',               get: r => r.status },
  { label: 'Remarks',              get: r => r.remarks },
  { label: 'Proposal Link',        get: r => r.proposalV1Link },
  { label: 'Date of Submission by Sol team', get: r => r.submissionBySolTeam },
  { label: 'Date of Submission to Client',   get: r => r.submissionToClient },
];

// ── Excel-style filter columns (same behaviour as the Engagement Calendar) ────
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Year / month of a BD lead: Date of Discussion first, else the BD Month text ("Sep 2026")
function bdYearMonth(r) {
  const d = String(r.dateOfDiscussion || '');
  if (/^\d{4}-\d{2}/.test(d)) return { y: d.slice(0, 4), m: Number(d.slice(5, 7)) };
  const t = String(r.bdMonth || '');
  const y = (t.match(/(19|20)\d{2}/) || [''])[0];
  const mi = MONTHS_SHORT.findIndex(mm => t.toLowerCase().includes(mm.toLowerCase()));
  return { y, m: mi >= 0 ? mi + 1 : 0 };
}
const toNum = v => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
// Sort key (year*12 + month) of a BD line, from its BD Month ("Sep 2026", "Sept", "April"), else its dates.
// A month without a year takes the year of the line's Date of Discussion, else the current FY
// (Apr–Dec → FY start year, Jan–Mar → the year after). No month at all → end of the list.
const fyStartYear = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
function lineMonthKey(rows) {
  const iso = rows.map(r => String(r.dateOfDiscussion || '')).find(d => /^\d{4}-\d{2}/.test(d)) || '';
  for (const r of rows) {
    const t = String(r.bdMonth || '').trim();
    const mi = MONTHS_SHORT.findIndex(mm => t.toLowerCase().startsWith(mm.toLowerCase()));
    if (mi < 0) continue;
    const y = Number((t.match(/(19|20)\d{2}/) || [''])[0])
      || (iso && Number(iso.slice(5, 7)) === mi + 1 ? Number(iso.slice(0, 4)) : 0)
      || (mi >= 3 ? fyStartYear() : fyStartYear() + 1);
    return y * 12 + mi;
  }
  const d = iso || rows.map(r => String(r.submissionToClient || r.submissionBySolTeam || '')).find(x => /^\d{4}-\d{2}/.test(x)) || '';
  return d ? Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 : Infinity;
}
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthHeading = k => (Number.isFinite(k) ? `${MONTHS_LONG[k % 12]} ${Math.floor(k / 12)}` : 'No BD Month');
const pidNum = pid => { const m = String(pid || '').match(/(\d+)/); return m ? Number(m[1]) : Infinity; };
// BD view uses only the BD Proposal Value; Solution view uses only the Solution Values of the line's items.
// (No fallback from one to the other — each tracker shows its own figures.)
const lineValue = r => toNum(r.bdProposalValue);
const solValueOf = r => (r._sols || []).reduce((t, x) => t + toNum(x.solutionValue), 0);
const fmtL  = n => (n > 0 ? '₹' + (n / 100000).toFixed(1) + 'L' : '₹0');
const fmtIN = n => (n > 0 ? '₹' + Math.round(n).toLocaleString('en-IN') : '—');
const solVals = (r, k) => (r._sols || []).map(s => s[k]);

const BD_FILTER_COLUMNS = [
  { key: 'year',     label: 'Year',          get: r => bdYearMonth(r).y, order: 'desc' },
  { key: 'month',    label: 'Month',         get: r => { const m = bdYearMonth(r).m; return m ? MONTHS_SHORT[m - 1] : ''; }, order: 'month', sortBy: r => bdYearMonth(r).m },
  { key: 'bdStatus', label: 'BD Status',     get: r => r.bdStatus },
  { key: 'client',   label: 'Client',        get: r => r.clientName },
  { key: 'topic',    label: 'Program Topic', get: r => r.programTopic },
  { key: 'poc',      label: 'Client POC',    get: r => r.clientPoc },
  { key: 'version',  label: 'Version',       get: r => r.proposalVersion },
  { key: 'profile',  label: 'Participant Profile', get: r => splitList(r.participantProfile) },
  { key: 'value',    label: 'Proposal Value', get: r => (r.bdProposalValue ? String(r.bdProposalValue) : ''), sortBy: r => toNum(r.bdProposalValue) },
];
const SOL_FILTER_COLUMNS = [
  ...BD_FILTER_COLUMNS.filter(c => c.key !== 'value'),   // Solution view: Solution Value instead of BD Proposal Value
  { key: 'solValue', label: 'Solution Value', get: r => { const v = solValueOf(r); return v ? String(v) : ''; }, sortBy: r => solValueOf(r) },
  { key: 'solMonth',   label: 'Sol Month',       get: r => solVals(r, 'solutionMonth') },
  { key: 'programType', label: 'Program Type',   get: r => solVals(r, 'programType') },
  { key: 'engType',    label: 'Engagement Type', get: r => solVals(r, 'engagementType') },
  { key: 'los',        label: 'Line of Service', get: r => solVals(r, 'lineOfService') },
  { key: 'tos',        label: 'Type of Service', get: r => solVals(r, 'typeOfService') },
  { key: 'devCat',     label: 'Dev Category',    get: r => solVals(r, 'developmentCategory') },
];

// ── Status colours ────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Won':        { bg: '#d1fae5', color: '#065f46' },
  'Lost':       { bg: '#fee2e2', color: '#991b1b' },
  'In Process': { bg: '#fef3c7', color: '#92400e' },
};
const BD_STATUS_OPTIONS  = ['In Process', 'Won', 'Lost'];
const SOL_STATUS_OPTIONS = ['Pending', 'In Progress', 'Submitted', 'Approved', 'Rejected'];

function pill(label, opts = {}) {
  const c = STATUS_COLORS[label] || { bg: 'var(--border)', color: 'var(--text)' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px',
      borderRadius: 12, background: c.bg, color: c.color,
      whiteSpace: 'nowrap', ...opts,
    }}>{label || '—'}</span>
  );
}

// ── Empty form templates ───────────────────────────────────────────────────────
// Auto-generated by Excel formulas — never sent to PA:
//   SNo, BD S No, Sol S No, Internal TAT, Date of Submission by Sol team
const EMPTY_BD = {
  proposalId: '', clientName: '', clientPoc: '', contactNumber: '',
  dateOfDiscussion: '', clientExpectedDate: '', bdMonth: '',
  programTopic: '', proposalVersion: 'V1', bdStatus: 'In Process', bdProposalValue: '',
  submissionToClient: '', opsChecklist: '', proposalV1Link: '',
  // BD Tracker additions (2026-10-19)
  expectedHeadcount: '', expectedBatches: '', pricePerBatch: '', participantProfile: '', bdComments: '',
  clientPocEmail: '', clientPocDesignation: '', additionalPocs: '',
};
const EMPTY_SOL = {
  proposalId: '', solutionTopic: '', solutionMonth: '', programType: '',
  engagementType: '', lineOfService: '', typeOfService: '', developmentCategory: '',
  solutionValue: '', status: 'Pending', remarks: '', proposalV1Link: '',
};

// ── Shared Input Component ────────────────────────────────────────────────────
function Field({ label, children, half }) {
  return (
    <div style={{ gridColumn: half ? 'span 1' : 'span 2', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  );
}
const inp = {
  padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface)', color: 'var(--text)', fontSize: 13, width: '100%',
  boxSizing: 'border-box',
};

// ── Fixed dropdown option lists ────────────────────────────────────────────────
const PROGRAM_TYPE_OPTS     = ['Standard', 'Customized', 'New Creation'];
const ENGAGEMENT_TYPE_OPTS  = ['Standalone', 'Journey'];
const LINE_OF_SERVICE_OPTS  = ['Training', 'Talent Management', 'HR Services', 'Coaching', 'Other'];
const TYPE_OF_SERVICE_OPTS  = ['Facilitation', 'Coaching', 'One-O-One Coaching', 'Mini Group Coaching', 'Assessment & Development Centres', 'Success Presentation'];
const DEV_CATEGORY_OPTS     = [
  'Power Skills Enablement',
  'Leadership Development',
  'DEI & Culture Building',
  'Consulting & Talent Management',
  'Digital & Business Transformation',
  'Commercial & Sales Enablement (CSE)',
  'Creative Solutions (CS)',
  'Assessment & Development Centers',
];

// ── BD Tracker additions (2026-10-19): headcount, batches, cost, profile, comments, POCs ──
const BD_EXTRA_KEYS = Object.keys(BD_EXTRA_COLUMNS);
const PARTICIPANT_PROFILE_OPTS = ['HR', 'Manager', 'Executive'];
const splitList = v => String(v ?? '').split(/[;\n|]+/).map(x => x.trim()).filter(Boolean);
const joinList  = a => [...new Set(a.map(x => String(x).trim()).filter(Boolean))].join('; ');
const isEmail   = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
// Additional POCs live in one Excel cell as a JSON list of { name, email, phone, designation }
const blankPoc = () => ({ name: '', email: '', phone: '', designation: '' });
function parsePocs(v) {
  const txt = String(v ?? '').trim();
  if (!txt) return [];
  try {
    const a = JSON.parse(txt);
    if (Array.isArray(a)) return a.map(p => ({ ...blankPoc(), ...Object.fromEntries(Object.entries(p || {}).map(([k, x]) => [k, String(x ?? '')])) }));
  } catch { /* typed straight into Excel as plain text */ }
  return [{ ...blankPoc(), name: txt }];
}
function serializePocs(list) {
  const kept = (list || [])
    .map(p => ({ name: String(p.name || '').trim(), designation: String(p.designation || '').trim(), email: String(p.email || '').trim(), phone: String(p.phone || '').trim() }))
    .filter(p => p.name || p.designation || p.email || p.phone);
  return kept.length ? JSON.stringify(kept) : '';
}
const pocLabel = p => [p.name, p.designation && `(${p.designation})`, p.email, p.phone].filter(Boolean).join(' · ');
// Total Cost of Proposal = Price per Batch × Total Expected Batches. Excel calculates it (formula
// column); the CRM shows the same sum live in the form and falls back to it until Excel answers.
const calcTotalCost = r => { const p = toNum(r?.pricePerBatch), b = toNum(r?.expectedBatches); return p && b ? p * b : 0; };
const totalCostOf   = r => toNum(r?.totalCost) || calcTotalCost(r);

function ParticipantProfilePicker({ value, onChange }) {
  const chosen = splitList(value);
  const [otherText, setOtherText] = useState(() => chosen.filter(v => !PARTICIPANT_PROFILE_OPTS.includes(v)).join('; '));
  const toggle = opt => onChange(joinList(chosen.includes(opt) ? chosen.filter(v => v !== opt) : [...chosen, opt]));
  const setOther = txt => {
    setOtherText(txt);
    onChange(joinList([...chosen.filter(v => PARTICIPANT_PROFILE_OPTS.includes(v)), ...splitList(txt)]));
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {PARTICIPANT_PROFILE_OPTS.map(opt => {
        const on = chosen.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => toggle(opt)}
            style={{ padding: '5px 12px', borderRadius: 14, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: on ? '1px solid #6366f1' : '1px solid var(--border)', background: on ? '#6366f1' : 'var(--surface)', color: on ? '#fff' : 'var(--text)' }}>
            {on ? '✓ ' : ''}{opt}
          </button>
        );
      })}
      <input style={{ ...inp, flex: 1, minWidth: 180, width: 'auto' }} value={otherText} onChange={e => setOther(e.target.value)}
        placeholder="Other — e.g. Sales Leaders (separate with ;)" />
    </div>
  );
}

function AdditionalPocsEditor({ value, onChange }) {
  const [list, setList] = useState(() => parsePocs(value));
  const update = next => { setList(next); onChange(serializePocs(next)); };
  const setP = (i, k, v) => update(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const small = { ...inp, padding: '6px 8px', fontSize: 12 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 1fr auto', gap: 6, alignItems: 'center' }}>
          <input style={small} placeholder="Name" value={p.name} onChange={e => setP(i, 'name', e.target.value)} />
          <input style={small} placeholder="Designation" value={p.designation} onChange={e => setP(i, 'designation', e.target.value)} />
          <input style={{ ...small, ...(p.email && !isEmail(p.email) ? { borderColor: '#f59e0b' } : {}) }} type="email" placeholder="Email ID"
            value={p.email} onChange={e => setP(i, 'email', e.target.value.trim())} />
          <input style={small} type="tel" inputMode="numeric" maxLength={10} placeholder="Contact number"
            value={p.phone} onChange={e => setP(i, 'phone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
          <button type="button" title="Remove this POC" onClick={() => update(list.filter((_, j) => j !== i))}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: '#b91c1c', padding: '4px 8px' }}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: 12 }}
        onClick={() => setList([...list, blankPoc()])}>+ Add POC</button>
    </div>
  );
}

// Label + value cell used in the BD Tracker expanded row
function InfoCell({ label, full, children }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

/**
 * ComboSelect — dropdown with fixed options + "Other (type your own)" fallback.
 * Syncs with external `value` so it stays correct when the form is reset or
 * pre-filled from an existing record.
 */
function ComboSelect({ options, value, onChange, placeholder }) {
  const isPreset    = options.includes(value);
  const [showCustom, setShowCustom] = useState(!isPreset && !!value);
  const [customText, setCustomText] = useState(!isPreset ? (value || '') : '');

  // Sync when value changes externally (e.g., pre-fill from existing record)
  useEffect(() => {
    const preset = options.includes(value);
    setShowCustom(!preset && !!value);
    if (!preset) setCustomText(value || '');
    else setCustomText('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const selectVal = showCustom ? '__custom__' : (value || '');

  return (
    <>
      <select style={inp} value={selectVal} onChange={e => {
        if (e.target.value === '__custom__') {
          setShowCustom(true);
          onChange(customText);
        } else {
          setShowCustom(false);
          setCustomText('');
          onChange(e.target.value);
        }
      }}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__custom__">Other (type your own…)</option>
      </select>
      {showCustom && (
        <input
          style={{ ...inp, marginTop: 6 }}
          placeholder={placeholder || 'Type custom value…'}
          value={customText}
          onChange={e => { setCustomText(e.target.value); onChange(e.target.value); }}
        />
      )}
    </>
  );
}

// ── Proposal ID auto-generator ────────────────────────────────────────────────
// Finds the largest numeric suffix across all existing Proposal IDs and increments it.
// e.g. ["P ID 088", "P ID 090"] → "P ID 091"
function generateNextPid(existingPids) {
  if (!existingPids || existingPids.length === 0) return 'P ID 001';
  const pairs = existingPids
    .map(pid => { const m = String(pid).match(/^(.*?)(\d+)$/); return m ? [m[1], m[2]] : null; })
    .filter(Boolean);
  if (pairs.length === 0) return 'P ID 001';
  pairs.sort((a, b) => parseInt(a[1], 10) - parseInt(b[1], 10));
  const [prefix, digits] = pairs[pairs.length - 1];
  const next = String(parseInt(digits, 10) + 1).padStart(digits.length, '0');
  return prefix + next;
}

// ── BD Modal ──────────────────────────────────────────────────────────────────
function BDModal({ initial, onSave, onClose, saving, bdRows, allRows }) {
  const isEdit = !!initial?.sno;
  // Revised mode: the edit form turns into "add next version" with every value copied
  const [revision, setRevision] = useState(false);
  // Revised mode: null = not answered yet, false = copy items as they are, true = edit them here
  const [editItems, setEditItems] = useState(null);

  // Compute existing PIDs and auto-generated next PID (add mode only)
  const existingPids = isEdit
    ? []
    : [...new Set((allRows || bdRows || []).map(r => r.proposalId).filter(Boolean))];
  const nextPid = isEdit ? '' : generateNextPid(existingPids);

  // Pre-fill proposalId with the generated ID when opening in add mode
  const [form, setForm] = useState(() => {
    const base = initial ? { ...initial } : { ...EMPTY_BD };
    if (!isEdit && !base.proposalId) base.proposalId = nextPid;
    // Show the proposal's link even when it was only saved on a solution item
    if (isEdit && !String(base.proposalV1Link || '').trim())
      base.proposalV1Link = bdLinkFor(allRows || [], base.proposalId, base.proposalVersion);
    return base;
  });
  // Tracks which option is selected in the Proposal ID dropdown (add mode only)
  const [pidSelect, setPidSelect] = useState('__new__');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const nextVersion = isEdit ? nextVersionLabel(allRows || [], initial.proposalId, initial.proposalVersion) : '';

  function startRevision() {
    // Copy every value of the current version — BD line AND all its solution items;
    // the user edits what changed before saving
    const srcItems = rowsOfVersion(allRows || [], initial.proposalId, initial.proposalVersion).filter(r => r.solutionTopic);
    setForm({
      ...initial, proposalVersion: nextVersion, _revision: true, _revisedFrom: initial.proposalVersion || 'V1',
      _solItems: srcItems.map(r => ({ ...pick(r, SOL_COPY_FIELDS), _src: r.sno, _keep: true })),
    });
    setEditItems(srcItems.length ? null : false);
    setRevision(true);
  }
  function cancelRevision() {
    setForm({ ...initial });
    setRevision(false);
    setEditItems(null);
  }
  const setItem = (i, k, v) => setForm(f => ({ ...f, _solItems: (f._solItems || []).map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const revItems = revision ? (form._solItems || []) : [];
  const keptItems = revItems.filter(s => s._keep !== false);
  const itemTopicMissing = keptItems.some(s => !String(s.solutionTopic || '').trim());

  const checklistMissing = needsChecklist(form);
  const blocked = saving || !form.proposalId.trim() || !form.clientName.trim() || checklistMissing ||
    (revision && (itemTopicMissing || (revItems.length > 0 && editItems === null)));

  // Auto-derive BD Month (e.g. "Sep 2026") whenever Date of Discussion changes
  function handleDateChange(dateVal) {
    set('dateOfDiscussion', dateVal);
    if (dateVal) {
      const [y, mo, d] = dateVal.split('-').map(Number);
      const formatted = new Date(y, mo - 1, d)
        .toLocaleString('en-US', { month: 'short', year: 'numeric' });
      set('bdMonth', formatted);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--card)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {revision ? `Add Revised Version — ${form.proposalVersion || nextVersion}` : isEdit ? 'Edit BD Entry' : 'Add BD Entry'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
        </div>
        {revision && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', fontSize: 12.5, color: '#3730a3', lineHeight: 1.5 }}>
            <strong>Revising {form.proposalId}: {form._revisedFrom} → {form.proposalVersion || nextVersion}</strong><br />
            All values are copied from {form._revisedFrom} — the BD line and {revItems.length ? <strong>all {revItems.length} solution item{revItems.length !== 1 ? 's' : ''}</strong> : 'its solution items (none yet)'}. Update anything that changed (value, dates, topic …) and click <strong>Save Revised Version</strong>.
            {' '}{form._revisedFrom} stays in the tracker as history.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* ── Proposal ID — smart dropdown in add mode, plain text in edit ── */}
          {isEdit ? (
            <Field label="Proposal ID *" half>
              <input style={{ ...inp, ...(revision ? { background: 'var(--border)', cursor: 'not-allowed' } : {}) }} value={form.proposalId} readOnly={revision} title={revision ? 'A revised version keeps the same Proposal ID' : undefined} onChange={e => set('proposalId', e.target.value)} placeholder="e.g. P ID 001" />
            </Field>
          ) : (
            <Field label="Proposal ID *" half>
              <select
                style={inp}
                value={pidSelect}
                onChange={e => {
                  const val = e.target.value;
                  setPidSelect(val);
                  if (val === '__new__') {
                    // Reset to a blank form with the new auto-generated PID
                    setForm({ ...EMPTY_BD, proposalId: nextPid });
                  } else {
                    // Find the most-recent row with this PID and pre-fill all fields
                    const match = (bdRows || []).find(r => r.proposalId === val);
                    if (match) {
                      setForm({
                        ...EMPTY_BD,
                        ...match,
                        proposalId: val,
                        sno: '',                   // clear row key → treated as new row
                        dateOfDiscussion: '',       // dates are typically different each session
                        clientExpectedDate: '',
                        bdMonth: '',
                      });
                    } else {
                      set('proposalId', val);
                    }
                  }
                }}
              >
                <option value="__new__">➕ New Proposal ID — {nextPid}</option>
                {existingPids.map(pid => (
                  <option key={pid} value={pid}>{pid}</option>
                ))}
              </select>
              {pidSelect !== '__new__' && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                  Adding another entry to existing proposal <strong>{form.proposalId}</strong>
                </p>
              )}
            </Field>
          )}

          <Field label="Client Name *" half><input style={inp} value={form.clientName} onChange={e => set('clientName', e.target.value)} /></Field>
          <Field label="Client POC" half><input style={inp} value={form.clientPoc} onChange={e => set('clientPoc', e.target.value)} /></Field>
          <Field label="Contact Number" half>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              style={inp}
              value={form.contactNumber || ''}
              onChange={e => set('contactNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
            />
            {!!form.contactNumber && String(form.contactNumber).replace(/\D/g, '').length !== 10 && (
              <span style={{ fontSize: 11, color: '#b45309' }}>
                {String(form.contactNumber).replace(/\D/g, '').length}/10 digits
              </span>
            )}
          </Field>
          <Field label="Client POC Email ID" half>
            <input type="email" style={{ ...inp, ...(form.clientPocEmail && !isEmail(form.clientPocEmail) ? { borderColor: '#f59e0b' } : {}) }}
              value={form.clientPocEmail || ''} onChange={e => set('clientPocEmail', e.target.value.trim())} placeholder="name@company.com" />
            {!!form.clientPocEmail && !isEmail(form.clientPocEmail) && (
              <span style={{ fontSize: 11, color: '#b45309' }}>Check the email format</span>
            )}
          </Field>
          <Field label="Client POC Designation" half>
            <input style={inp} value={form.clientPocDesignation || ''} onChange={e => set('clientPocDesignation', e.target.value)} placeholder="e.g. L&D Manager" />
          </Field>
          <Field label="Additional Client POCs">
            <AdditionalPocsEditor value={form.additionalPocs} onChange={v => set('additionalPocs', v)} />
          </Field>

          {/* ── Date of Discussion — auto-fills BD Month on change ── */}
          <Field label="Date of Discussion *" half>
            <input
              type="date"
              style={inp}
              value={form.dateOfDiscussion}
              onChange={e => handleDateChange(e.target.value)}
            />
          </Field>
          <Field label="Client Expt" half><input type="date" style={inp} value={form.clientExpectedDate} onChange={e => set('clientExpectedDate', e.target.value)} /></Field>

          {/* ── BD Month — auto-filled from date; user can still override ── */}
          <Field label="BD Month" half>
            <input
              style={inp}
              value={form.bdMonth}
              onChange={e => set('bdMonth', e.target.value)}
              placeholder="Auto-filled from date (e.g. Sep 2026)"
            />
          </Field>
          <Field label="Program Topic" half><input style={inp} value={form.programTopic} onChange={e => set('programTopic', e.target.value)} /></Field>
          <Field label={revision ? 'Proposal Version (new)' : 'Proposal Version'} half>
            <input style={{ ...inp, ...(revision ? { borderColor: '#6366f1', fontWeight: 700 } : {}) }} value={form.proposalVersion} onChange={e => set('proposalVersion', e.target.value)} placeholder="V1" />
          </Field>
          <Field label="BD Status" half>
            <select style={inp} value={form.bdStatus} onChange={e => set('bdStatus', e.target.value)}>
              {BD_STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="BD Proposal Value"><input style={inp} value={form.bdProposalValue} onChange={e => set('bdProposalValue', e.target.value)} placeholder="₹ Amount" /></Field>
          <Field label="Date of Submission to Client *" half><input type="date" style={inp} value={form.submissionToClient} onChange={e => set('submissionToClient', e.target.value)} /></Field>
          <Field label="Proposal Link">
            <LinkInput inputStyle={inp} value={form.proposalV1Link || ''} onChange={v => set('proposalV1Link', v)} placeholder="https://..." />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Copied automatically to every Solution item of this proposal{revision ? ' version' : ''} — editable per item.</span>
          </Field>

          {/* ── Program size & commercials — Total Cost = Price per Batch × Batches (Excel formula) ── */}
          <Field label="Participant Profile">
            <ParticipantProfilePicker value={form.participantProfile} onChange={v => set('participantProfile', v)} />
          </Field>
          <Field label="Total Expected Headcount" half>
            <input type="number" min="0" step="1" style={inp} value={form.expectedHeadcount || ''} onChange={e => set('expectedHeadcount', e.target.value)} placeholder="e.g. 120" />
          </Field>
          <Field label="Total Expected Batches" half>
            <input type="number" min="0" step="1" style={inp} value={form.expectedBatches || ''} onChange={e => set('expectedBatches', e.target.value)} placeholder="e.g. 4" />
          </Field>
          <Field label="Price per Batch" half>
            <input style={inp} inputMode="decimal" value={form.pricePerBatch || ''} onChange={e => set('pricePerBatch', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="₹ Amount" />
          </Field>
          <Field label="Total Cost of Proposal" half>
            <input readOnly style={{ ...inp, background: 'var(--border)', cursor: 'not-allowed', fontWeight: 700 }}
              value={calcTotalCost(form) ? fmtIN(calcTotalCost(form)) : ''} placeholder="Price per Batch × Batches"
              title="Calculated by Excel: Price per Batch × Total Expected Batches" />
          </Field>
          <Field label="BD Comments">
            <textarea style={{ ...inp, resize: 'vertical', minHeight: 60 }} value={form.bdComments || ''} onChange={e => set('bdComments', e.target.value)}
              placeholder="Notes from client discussions, next steps …" />
          </Field>

          {/* ── In Process / Won → BD ticks what Operations must arrange ── */}
          {showsChecklist(form) && (
            <Field label="Operations Checklist * — tick everything Operations must arrange">
              <div style={{ fontSize: 12, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '6px 10px', marginBottom: 6 }}>
                {form.bdStatus === 'Won' ? '🎉 Proposal won! ' : ''}This list goes to the Engagement Calendar and the Operations Checklist when the engagement is added.
              </div>
              <ChecklistPicker value={form.opsChecklist} onChange={v => set('opsChecklist', v)} required />
            </Field>
          )}
        </div>

        {/* ── Revised: solution items of the old version are copied to the new one ── */}
        {revision && (
          <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 8, border: '1px solid #c7d2fe', background: '#f8faff' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Solution Items — {form._revisedFrom} → {form.proposalVersion || nextVersion}
            </div>
            {revItems.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{form._revisedFrom} has no solution items — only the BD line will be added.</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text)', marginBottom: 8 }}>
                  {revItems.length} solution item{revItems.length !== 1 ? 's' : ''} of {form._revisedFrom} will be added under {form.proposalVersion || nextVersion} with the same Proposal ID.
                  <strong style={{ display: 'block', marginTop: 6 }}>Do you want to edit solution items also?</strong>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: editItems ? 12 : 0 }}>
                  {[[false, 'No — copy as they are'], [true, 'Yes — edit solution items']].map(([val, label]) => (
                    <button key={label} type="button" onClick={() => setEditItems(val)} disabled={saving}
                      style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                        border: editItems === val ? '1px solid #6366f1' : '1px solid var(--border)',
                        background: editItems === val ? '#6366f1' : 'var(--surface)', color: editItems === val ? '#fff' : 'var(--text)' }}>
                      {editItems === val ? '✓ ' : ''}{label}
                    </button>
                  ))}
                </div>
                {editItems === false && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--muted)' }}>
                    {revItems.map((s, i) => <li key={`ri-${i}`}>{s.solutionTopic}{s.solutionValue ? ` — ₹${s.solutionValue}` : ''}</li>)}
                  </ul>
                )}
                {editItems && revItems.map((s, i) => {
                  const off = s._keep === false;
                  return (
                    <div key={`ri-${i}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 10, background: off ? 'transparent' : 'var(--card)', opacity: off ? 0.55 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: off ? 0 : 8 }}>
                        <strong style={{ fontSize: 12.5 }}>Item {i + 1}{off ? ` — ${s.solutionTopic || ''} (not copied)` : ''}</strong>
                        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input type="checkbox" checked={!off} onChange={e => setItem(i, '_keep', e.target.checked)} />
                          Copy to {form.proposalVersion || nextVersion}
                        </label>
                      </div>
                      {!off && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <Field label="Solution Topic *"><input style={inp} value={s.solutionTopic || ''} onChange={e => setItem(i, 'solutionTopic', e.target.value)} /></Field>
                          <Field label="Program Type" half><ComboSelect options={PROGRAM_TYPE_OPTS} value={s.programType} onChange={v => setItem(i, 'programType', v)} /></Field>
                          <Field label="Engagement Type" half><ComboSelect options={ENGAGEMENT_TYPE_OPTS} value={s.engagementType} onChange={v => setItem(i, 'engagementType', v)} /></Field>
                          <Field label="Line of Service" half><ComboSelect options={LINE_OF_SERVICE_OPTS} value={s.lineOfService} onChange={v => setItem(i, 'lineOfService', v)} /></Field>
                          <Field label="Type of Service" half><ComboSelect options={TYPE_OF_SERVICE_OPTS} value={s.typeOfService} onChange={v => setItem(i, 'typeOfService', v)} /></Field>
                          <Field label="Development Category" half><ComboSelect options={DEV_CATEGORY_OPTS} value={s.developmentCategory} onChange={v => setItem(i, 'developmentCategory', v)} /></Field>
                          <Field label="Solution Value" half><input style={inp} value={s.solutionValue || ''} onChange={e => setItem(i, 'solutionValue', e.target.value)} placeholder="₹ Amount" /></Field>
                          <Field label="Remarks"><textarea style={{ ...inp, resize: 'vertical', minHeight: 44 }} value={s.remarks || ''} onChange={e => setItem(i, 'remarks', e.target.value)} /></Field>
                          <Field label="Proposal Link">
                            <LinkInput inputStyle={inp} value={s.proposalV1Link || ''} onChange={v => setItem(i, 'proposalV1Link', v)} placeholder="https://..." />
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>If this still holds the {form._revisedFrom} link, the new BD link above replaces it.</span>
                          </Field>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── Revised — last option in the edit form: add the next version of this proposal ── */}
        {isEdit && (
          <div style={{ marginTop: 20, padding: '12px 14px', borderRadius: 8, border: '1px dashed #6366f1', background: revision ? '#eef2ff' : 'transparent', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: 'var(--muted)' }}>
              {revision
                ? <>Saving will add <strong style={{ color: 'var(--text)' }}>{form.proposalVersion || nextVersion}</strong> as a new line with {keptItems.length} solution item{keptItems.length !== 1 ? 's' : ''}. {form._revisedFrom} is not changed.</>
                : <>Client asked for changes? Add the next version (<strong style={{ color: 'var(--text)' }}>{nextVersion}</strong>) with all values copied from {initial.proposalVersion || 'V1'} — edit them before saving.</>}
            </div>
            {revision ? (
              <button type="button" onClick={cancelRevision} disabled={saving} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: 12.5 }}>
                ↩ Back to edit {initial.proposalVersion || 'V1'}
              </button>
            ) : (
              <button type="button" onClick={startRevision} disabled={saving} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' }}>
                ⟳ Revised
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={blocked || (revision && !String(form.proposalVersion || '').trim())} style={{ padding: '8px 22px', borderRadius: 6, border: 'none', background: revision ? '#6366f1' : 'var(--accent)', color: '#fff', fontWeight: 700, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}>
            {saving ? 'Saving…' : revision ? `Save Revised Version (${form.proposalVersion || nextVersion})` : 'Save'}
          </button>
        </div>
        {(!form.proposalId.trim() || !form.clientName.trim()) && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>* Proposal ID and Client Name are required</p>
        )}
        {checklistMissing && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>* Tick the Operations Checklist before saving an In Process or Won proposal</p>
        )}
        {revision && revItems.length > 0 && editItems === null && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>* Choose whether to edit the solution items before saving</p>
        )}
        {revision && itemTopicMissing && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>* Every copied solution item needs a Solution Topic</p>
        )}
      </div>
    </div>
  );
}

// ── Solution Modal ─────────────────────────────────────────────────────────────
// proposalId is always known from the BD row context — no picker shown
function SolModal({ initial, proposalId, proposalVersion, programTopic, bdStatus, bdLink, onSave, onClose, saving }) {
  // New items: Solution Topic defaults to the proposal's Program Topic (editable).
  // Status always mirrors the BD Status of the parent proposal.
  const [form, setForm] = useState(() => ({
    ...(initial || { ...EMPTY_SOL, solutionTopic: programTopic || '' }),
    // Proposal link comes from the BD entry; the user can change it for this item
    proposalV1Link: String(initial?.proposalV1Link || '').trim() || bdLink || '',
    proposalId,
    proposalVersion: initial?.proposalVersion || proposalVersion || '',
    status: bdStatus || (initial?.status) || 'In Process',
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!initial?.sno;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--card)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{isEdit ? 'Edit Solution Item' : 'Add Solution Item'}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              Proposal: <strong style={{ color: 'var(--accent)' }}>{proposalId}</strong>{form.proposalVersion ? <> · Version <strong>{form.proposalVersion}</strong></> : null}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
        </div>
        {/* Solution Month — auto-generated by Excel formula, display only */}
        {form.solutionMonth && (
          <div style={{ marginBottom: 14, padding: '8px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Solution Month</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{form.solutionMonth}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>Auto-generated by Excel</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Solution Topic *">
            <input style={inp} value={form.solutionTopic || ''} onChange={e => set('solutionTopic', e.target.value)} placeholder={programTopic || ''} />
            {!initial && programTopic && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Pre-filled from Proposal Topic — edit if needed</span>
            )}
          </Field>
          <Field label="Program Type" half>
            <ComboSelect options={PROGRAM_TYPE_OPTS} value={form.programType} onChange={v => set('programType', v)} />
          </Field>
          <Field label="Engagement Type" half>
            <ComboSelect options={ENGAGEMENT_TYPE_OPTS} value={form.engagementType} onChange={v => set('engagementType', v)} />
          </Field>
          <Field label="Line of Service" half>
            <ComboSelect options={LINE_OF_SERVICE_OPTS} value={form.lineOfService} onChange={v => set('lineOfService', v)} />
          </Field>
          <Field label="Type of Service" half>
            <ComboSelect options={TYPE_OF_SERVICE_OPTS} value={form.typeOfService} onChange={v => set('typeOfService', v)} />
          </Field>
          <Field label="Development Category" half>
            <ComboSelect options={DEV_CATEGORY_OPTS} value={form.developmentCategory} onChange={v => set('developmentCategory', v)} />
          </Field>
          <Field label="Solution Value" half><input style={inp} value={form.solutionValue} onChange={e => set('solutionValue', e.target.value)} placeholder="₹ Amount" /></Field>
          <Field label="Remarks"><textarea style={{ ...inp, resize: 'vertical', minHeight: 56 }} value={form.remarks} onChange={e => set('remarks', e.target.value)} /></Field>
          <Field label="Proposal Link">
            <LinkInput inputStyle={inp} value={form.proposalV1Link || ''} onChange={v => set('proposalV1Link', v)} placeholder="https://..." />
            {bdLink && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {String(form.proposalV1Link || '').trim() === bdLink ? 'Carried from BD Tracker — edit if this item uses a different link' : 'Different from the BD Tracker link'}
              </span>
            )}
          </Field>
          <Field label="Status (from BD Status)" half>
            <div style={{ ...inp, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', cursor: 'default' }}>
              {pill(form.status)}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Change it in BD Tracker</span>
            </div>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !form.proposalId || !(form.solutionTopic || '').trim()} style={{ padding: '8px 22px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: (saving || !form.proposalId || !(form.solutionTopic || '').trim()) ? 'not-allowed' : 'pointer', opacity: (saving || !form.proposalId || !(form.solutionTopic || '').trim()) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {(!form.proposalId || !(form.solutionTopic || '').trim()) && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ef4444', textAlign: 'right' }}>* Proposal ID and Solution Topic are required</p>
        )}
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ──────────────────────────────────────────────────────
// type='bd' with linkedCount > 0 → cascade warning (BD + all Sol rows deleted together).
// type='bd' with linkedCount = 0 OR type='sol' → simple single-row confirm.
function DeleteDialog({ label, onConfirm, onCancel, saving, type, linkedCount }) {
  const isCascade = type === 'bd' && linkedCount > 0;
  const totalRows  = linkedCount + 1; // anchor + sol rows

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
      <div style={{ background: 'var(--card)', borderRadius: 10, padding: 28, maxWidth: 440, width: '90%', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
        {isCascade ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ margin: '0 0 6px', color: '#b45309' }}>Delete BD Entry + All Solutions?</h3>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 14 }}>{label}</p>
            <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '12px 14px', margin: '0 0 20px', fontSize: 13, color: '#92400e', textAlign: 'left' }}>
              This will permanently delete <strong>{totalRows} rows</strong>:<br />
              <span style={{ display: 'block', marginTop: 6 }}>• 1 BD anchor row (this entry)</span>
              <span style={{ display: 'block' }}>• <strong>{linkedCount} linked solution row{linkedCount !== 1 ? 's' : ''}</strong> (Sol S No A – {String.fromCharCode(64 + linkedCount)})</span>
              <span style={{ display: 'block', marginTop: 8, fontWeight: 700 }}>This cannot be undone.</span>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={onCancel} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
              <button onClick={onConfirm} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Deleting…' : `Delete All (${totalRows} rows)`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><span style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: '#fee2e2', color: '#dc2626' }}><Trash2 size={28} /></span></div>
            <h3 style={{ margin: '0 0 8px' }}>Delete this entry?</h3>
            <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: 14 }}>{label}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={onCancel} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Cancel</button>
              <button onClick={onConfirm} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function SolutionTracker({ onRefreshed, view }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { canCreate, canUpdate, canDelete, canEdit } = usePermissions();

  const [rows, setRows]       = useState(() => peekList('solution') || []);
  const [loading, setLoading] = useState(() => !peekList('solution'));   // full loader only on the very first visit
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  // Set of proposalIds whose Sol rows are currently expanded
  const [expanded, setExpanded] = useState(new Set());

  // Modal state
  // solModal: null | { mode:'add', lockedPid:string } | { mode:'edit', row:obj }
  const [bdModal, setBdModal]     = useState(null);
  const [solModal, setSolModal]   = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [saving, setSaving]       = useState(false);

  // Arrived from the Lead Tracker ("Add to BD Tracker"): open the Add form pre-filled.
  // The Proposal ID is generated by the form (next free P.ID); after saving it is written back to the lead.
  useEffect(() => {
    const L = location.state?.fromLead;
    if (!L || view !== 'bd' || !rows.length) return;   // wait for the BD rows, so the next Proposal ID is right
    navigate(location.pathname, { replace: true, state: null });   // open once only
    if (!canCreate('bd')) return;
    const notes = [L.requirement && `Requirement: ${L.requirement}`, L.comments, L.leadId && `From lead ${L.leadId}`].filter(Boolean).join('\n');
    setBdModal({
      ...EMPTY_BD,
      clientName: L.company || '', clientPoc: L.contactName || '', contactNumber: L.phone || '',
      clientPocEmail: L.email || '', clientPocDesignation: L.designation || '',
      programTopic: L.programInterest || '', bdProposalValue: L.estValue === '' || L.estValue == null ? '' : String(L.estValue),
      bdComments: notes,
      _fromLead: L.leadId,
    });
  }, [location.state, view, rows.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Write the new Proposal ID back to the lead it came from (fresh read, so other edits are kept)
  async function linkLeadToProposal(leadId, proposalId) {
    if (!leadId || !proposalId) return;
    try {
      const lead = (await getLeads()).find(l => String(l.leadId) === String(leadId));
      if (!lead) throw new Error(`lead ${leadId} not found`);
      const action = { id: `a${Date.now().toString(36)}`, at: new Date().toISOString(), by: lead.owner || '',
        type: 'Note', status: 'Converted to BD', comment: `Added to BD Tracker as ${proposalId}`, next: '' };
      await updateLead({ ...lead, proposalId, status: 'Converted to BD', nextFollowUp: '', actions: [...(lead.actions || []), action] });
    } catch (e) {
      alert(`BD line saved as ${proposalId}, but the lead ${leadId} could not be updated (${e.message}). Enter ${proposalId} in the lead's BD Proposal ID by hand.`);
    }
  }

  // Show the last loaded rows straight away, then fetch fresh rows in the background
  const load = useCallback(async () => {
    const saved = peekList('solution');
    if (saved) { setRows(r => (r.length ? r : saved)); setLoading(false); }
    else setLoading(true);
    setRefreshing(true);
    setError('');
    try {
      const data = await getSolutionTracker();
      setRows(data);
      onRefreshed?.(new Date().toLocaleTimeString());
    } catch (e) {
      if (!saved) setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onRefreshed]);

  useEffect(() => { load(); }, [load]);

  // ── Toggle expand/collapse for a proposal ──────────────────────────────────
  function toggleExpand(pid) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  // One line per Proposal ID + version; every other row of that version is a solution item and is
  // shown only in the line's dropdown. Lines are ordered by BD Month (then Proposal ID number, then
  // version), so a revision sits in the month it was sent, and numbered 1, 2, 3 … in that order —
  // whatever the row order in Excel. The Excel BD S No is kept as _bdExcel.
  // A row with a blank Proposal Version belongs to the version of its proposal's BD row.
  const allBdRows = useMemo(() => {
    const sNoOf = r => { const n = Number(r.sno); return Number.isFinite(n) ? n : Infinity; };
    const bdNoNum = r => { const n = Number(String(r?.bdSNo ?? '').trim()); return String(r?.bdSNo ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };
    // BD row (row with a BD S No) of each Proposal ID
    const bdRowOf = new Map();
    rows.forEach(r => { if (r.proposalId && bdNoNum(r) != null && !bdRowOf.has(r.proposalId)) bdRowOf.set(r.proposalId, r); });
    const effVersion = r => String(r.proposalVersion ?? '').trim() !== ''
      ? versionNo(r.proposalVersion)
      : versionNo(bdRowOf.get(r.proposalId)?.proposalVersion);
    const groups = new Map();   // key → { pid, n, rows, first }
    rows.forEach((r, i) => {
      if (!r.proposalId) return;
      const n = effVersion(r);
      const k = groupKey(r.proposalId, n);
      if (!groups.has(k)) groups.set(k, { pid: r.proposalId, n, rows: [], first: i });
      groups.get(k).rows.push(r);
    });
    const topVersion = new Map(), countByPid = new Map();
    groups.forEach(g => {
      topVersion.set(g.pid, Math.max(topVersion.get(g.pid) || 0, g.n));
      countByPid.set(g.pid, (countByPid.get(g.pid) || 0) + 1);
    });
    return [...groups.entries()].map(([k, g]) => {
      const sorted = [...g.rows].sort((a, b) => sNoOf(a) - sNoOf(b));
      const anchor = sorted.find(r => bdNoNum(r) != null) || sorted[0];
      const pidBd = bdNoNum(bdRowOf.get(g.pid));
      const ownBd = bdNoNum(anchor);
      return {
        ...anchor,
        _key: k,
        _bdExcel: ownBd ?? pidBd ?? (anchor.bdSNo || anchor.sno),   // BD S No in Excel (reference only)
        _monthKey: lineMonthKey([anchor, ...sorted]),
        _pidNum: pidNum(g.pid),
        _version: g.n,
        _order: Math.min(...g.rows.map(sNoOf)),
        _first: g.first,
        _sols: sorted.filter(x => x.solutionTopic),       // dropdown: solution items in S No order
        _isLatest: g.n === topVersion.get(g.pid),
        _versionCount: countByPid.get(g.pid),
      };
    }).sort((a, b) => (a._monthKey - b._monthKey) || (a._pidNum - b._pidNum) || (a._version - b._version)
        || (a._order - b._order) || (a._first - b._first))
      .map((r, i) => ({ ...r, _bdNo: i + 1 }));   // number shown: position in BD-month order
  }, [rows]);

  // Excel-style column filters + sorting (shared with Engagement Calendar)
  const filterState = useExcelFilters(allBdRows, view === 'bd' ? BD_FILTER_COLUMNS : SOL_FILTER_COLUMNS);
  const bdRows = filterState.filtered
    .filter(r => !search || [r.proposalId, r.clientName, r.programTopic, r.bdStatus, r.bdMonth, r.clientPoc,
      r.clientPocEmail, r.clientPocDesignation, r.participantProfile, r.bdComments,
      ...(r._sols || []).map(x => x.solutionTopic)].join(' ').toLowerCase().includes(search.toLowerCase()));

  // Lines per BD month among the shown lines (month headings)
  const monthCounts = bdRows.reduce((m, r) => m.set(r._monthKey, (m.get(r._monthKey) || 0) + 1), new Map());

  // KPI figures (follow the active filters). A proposal counts once — its highest version
  // among the shown lines — so revised versions don't double the value.
  const kpiRows = [...bdRows.reduce((m, r) => {
    const p = m.get(r.proposalId);
    if (!p || versionNo(r.proposalVersion) > versionNo(p.proposalVersion)) m.set(r.proposalId, r);
    return m;
  }, new Map()).values()];
  const kpi = {
    total:    kpiRows.length,
    all:      new Set(allBdRows.map(r => r.proposalId)).size,
    lines:    bdRows.length,
    allLines: allBdRows.length,
    // Line counts (each version counts) — same as the Sales / Solutioning dashboards
    wonLines:  bdRows.filter(r => r.bdStatus === 'Won').length,
    lostLines: bdRows.filter(r => r.bdStatus === 'Lost').length,
    ipLines:   bdRows.filter(r => r.bdStatus === 'In Process').length,
    // Value — same rule as the Sales / Solutioning dashboards: BD Proposal Value, else the line's Solution Values
    // added up; every line (version) adds its own value, like the Total Proposals count
    value:    bdRows.reduce((t, r) => t + lineValue(r), 0),
    wonValue: bdRows.filter(r => r.bdStatus === 'Won').reduce((t, r) => t + lineValue(r), 0),
    wonSolValue: kpiRows.filter(r => r.bdStatus === 'Won').reduce((t, r) => t + solValueOf(r), 0),
    clients:  new Set(kpiRows.map(r => r.clientName).filter(Boolean)).size,
    won:      kpiRows.filter(r => r.bdStatus === 'Won').length,
    lost:     kpiRows.filter(r => r.bdStatus === 'Lost').length,
    inProc:   kpiRows.filter(r => r.bdStatus === 'In Process').length,
    solItems: kpiRows.reduce((t, r) => t + (r._sols || []).length, 0),
    solValue: kpiRows.reduce((t, r) => t + solValueOf(r), 0),
  };
  const decided = kpi.won + kpi.lost;

  // Pending-fields bar — BD view: one item per BD line; Solution view: one item per solution item.
  // Follows the filters / search and the order shown in the table.
  const pendingBar = useMemo(() => {
    if (view === 'bd') {
      return pendingItems(
        bdRows.map(r => ({ ...r, proposalV1Link: bdLinkFor(rows, r.proposalId, r.proposalVersion) })),
        BD_RULES,
        r => ({ id: r._key, serial: bdNoOf(r), title: `${r.proposalId} ${r.proposalVersion || 'V1'} · ${r.clientName || '(no client)'}`, subtitle: r.programTopic }),
      ).map(it => ({ ...it, row: bdRows.find(b => b._key === it.id) || it.row }));
    }
    const items = bdRows.flatMap(r => (r._sols || []).map(sol => ({ ...sol, _line: r })));
    return pendingItems(items, SOL_RULES, sol => ({
      id: `${sol._line._key}|${sol.sno}`, serial: `${bdNoOf(sol._line)}${sol.solSNo ? '·' + sol.solSNo : ''}`,
      title: `${sol.proposalId} ${sol._line.proposalVersion || 'V1'} · ${sol._line.clientName || '(no client)'}`,
      subtitle: sol.solutionTopic,
    }));
  }, [view, bdRows, rows]);

  function openPending(it, f) {
    if (view === 'bd') {
      setBdModal(it.row);
    } else {
      const { _line: line, ...sol } = it.row;
      setExpanded(prev => new Set(prev).add(line._key));
      setSolModal({ mode: 'edit', row: sol, programTopic: line.programTopic, bdStatus: line.bdStatus });
    }
    revealField(f.key, f.label);
  }

  // Reminders popup: In Process proposals not yet submitted, due on the Client Expected Date
  const dueBar = useMemo(() => bdRows.map(r => {
    if (r.bdStatus !== 'In Process' || toIso(r.submissionToClient)) return null;
    const due = toIso(r.clientExpectedDate);
    return due ? {
      id: r._key, serial: bdNoOf(r), title: `${r.proposalId} ${r.proposalVersion || 'V1'} · ${r.clientName || '(no client)'}`,
      subtitle: r.programTopic, tasks: [{ key: 'submissionToClient', label: 'Submit proposal to client', due }], row: r,
    } : null;
  }).filter(Boolean), [bdRows]);
  function openDue(it, t) {
    if (view === 'bd' && canUpdate('bd')) { setBdModal(it.row); revealField(t.key, 'Date of Submission to Client'); return; }
    setExpanded(prev => new Set(prev).add(it.id));
    revealField(`line-${it.id}`, '');
  }
  const winRate = decided ? Math.round((kpi.won / decided) * 100) : 0;



  // ── CRUD handlers ─────────────────────────────────────────────────────────
  // If the row carries a solution item, its status mirrors the BD Status.
  function withSolStatus(form, existing) {
    const hasSol = !!(form.solutionTopic || existing?.solutionTopic);
    return hasSol && form.bdStatus ? { ...form, status: form.bdStatus } : form;
  }

  // Push BD-level fields to every other row sharing this Proposal ID.
  async function propagateBdFields(form, skipSno, oldLink = '') {
    const otherRows = rows.filter(
      r => r.proposalId === form.proposalId && String(r.sno) !== String(skipSno)
    );
    const sameVersion = r => versionNo(r.proposalVersion) === versionNo(form.proposalVersion);
    // Proposal link: copy to items of this version that have no link or still hold the
    // previous BD link — a link edited on a single Solution item is left as it is.
    const newLink = String(form.proposalV1Link || '').trim();
    const takesLink = r => newLink && sameVersion(r) &&
      String(r.proposalV1Link || '').trim() !== newLink &&
      (!hasLink(r) || String(r.proposalV1Link).trim() === String(oldLink || '').trim());
    // Discussion date: every line of this version gets it; other versions only if theirs is blank
    const takesDiscussion = r => form.dateOfDiscussion && r.dateOfDiscussion !== form.dateOfDiscussion &&
      (sameVersion(r) || !r.dateOfDiscussion);
    const changed = otherRows.filter(r =>
      takesLink(r) || takesDiscussion(r) ||
      (form.submissionToClient && sameVersion(r) && r.submissionToClient !== form.submissionToClient) ||
      (form.bdStatus && r.bdStatus !== form.bdStatus) ||
      (form.bdStatus && r.solutionTopic && r.status !== form.bdStatus) ||
      (form.opsChecklist && r.opsChecklist !== form.opsChecklist)
    );
    await Promise.all(changed.map(r => updateSolutionRow(r.sno, {
      ...r,
      ...(form.submissionToClient && sameVersion(r) ? { submissionToClient: form.submissionToClient } : {}),
      ...(takesDiscussion(r) ? { dateOfDiscussion: form.dateOfDiscussion } : {}),
      ...(form.bdStatus ? { bdStatus: form.bdStatus } : {}),
      ...(form.bdStatus && r.solutionTopic ? { status: form.bdStatus } : {}),
      ...(form.opsChecklist ? { opsChecklist: form.opsChecklist } : {}),
      ...(takesLink(r) ? { proposalV1Link: newLink } : {}),
    })));
  }

  async function handleSaveBD(form) {
    if (needsChecklist(form)) { alert(`Please tick the Operations Checklist for this ${form.bdStatus} proposal.`); return; }
    const missingDates = [!form.dateOfDiscussion && 'Date of Discussion', !form.submissionToClient && 'Date of Submission to Client'].filter(Boolean);
    if (missingDates.length) { alert(`Please fill ${missingDates.join(' and ')} — every BD line needs both dates.`); return; }
    if (form._revision) {
      const v = String(form.proposalVersion || '').trim();
      if (rows.some(r => r.proposalId === form.proposalId && versionNo(r.proposalVersion) === versionNo(v))) {
        alert(`${form.proposalId} already has version ${v}. Choose a new version number.`);
        return;
      }
    }
    setSaving(true);
    try {
      if (form._revision) {
        // ── Revised version: same Proposal ID, next version — the BD line AND every
        //    solution item of the old version are added as new rows under the new version ──
        const srcVersion = form._revisedFrom || 'V1';
        const srcAnchor  = anchorOfVersion(rows, form.proposalId, srcVersion);
        const oldLink    = bdLinkFor(rows, form.proposalId, srcVersion);
        const newLink    = String(form.proposalV1Link || '').trim();   // link of the new version
        const items      = (form._solItems || []).filter(s => s._keep !== false && String(s.solutionTopic || '').trim());

        const bdLine = { ...form, sno: '', bdSNo: '', solSNo: '' };
        SOL_FIELDS.forEach(k => { bdLine[k] = ''; });
        Object.keys(bdLine).filter(k => k.startsWith('_')).forEach(k => { delete bdLine[k]; });
        bdLine.proposalV1Link = newLink;

        // An item still holding the old version's link (or none) takes the new BD link
        const itemLink = s => {
          const own = String(s.proposalV1Link || '').trim();
          return (!own || own === oldLink) ? (newLink || own) : own;
        };
        // BD-only fields (headcount, price per batch, POCs …) stay on the BD line, so Excel's
        // Total Cost appears once per version. undefined = not sent = cell left empty.
        const noBdExtras = Object.fromEntries(BD_EXTRA_KEYS.map(k => [k, undefined]));
        const itemRow = (s, isBdLine = false) => ({
          ...bdLine,
          ...(isBdLine ? {} : noBdExtras),
          ...pick(s, SOL_COPY_FIELDS),
          solutionTopic: String(s.solutionTopic).trim(),
          proposalV1Link: itemLink(s),
          status: form.bdStatus || 'In Process',
        });
        // Same layout as the old version: if its BD line also carried the first solution item, so does the new one
        const newRows = (srcAnchor?.solutionTopic && items.length)
          ? items.map((s, i) => itemRow(s, i === 0))      // first item shares the BD line's row
          : [bdLine, ...items.map(s => itemRow(s))];
        for (const r of newRows) await addSolutionRow(r);   // one by one so Excel keeps the order

        // Status / checklist apply to the whole proposal — keep every row in step
        await propagateBdFields({ ...bdLine, submissionToClient: '', proposalV1Link: '' }, null);
        setExpanded(prev => new Set(prev).add(groupKey(form.proposalId, form.proposalVersion)));
      } else
      // Use != null so sno=0 is treated as a valid row key (truthy check would fail for 0)
      if (form.sno != null && form.sno !== '') {
        // ── Edit existing BD anchor row ──────────────────────────────────────
        const self = rows.find(r => String(r.sno) === String(form.sno));
        const oldLink = bdLinkFor(rows, form.proposalId, self?.proposalVersion ?? form.proposalVersion);
        await updateSolutionRow(form.sno, withSolStatus(form, self));

        // Propagate BD-level fields (discussion + submission dates, BD Status, Proposal Link) to
        // every other row under this P ID so all Excel rows stay in sync.
        await propagateBdFields(form, form.sno, oldLink);
      } else {
        // ── New BD entry ─────────────────────────────────────────────────────
        const existingAnchor = rows.find(r => r.proposalId === form.proposalId && r.bdSNo);
        if (existingAnchor) {
          const oldLink = bdLinkFor(rows, form.proposalId, existingAnchor.proposalVersion);
          await updateSolutionRow(existingAnchor.sno, withSolStatus(form, existingAnchor));
          await propagateBdFields(form, existingAnchor.sno, oldLink);
        } else {
          await addSolutionRow(form);
        }
      }
      // The flow says "OK" even when it drops a column it doesn't map, so read
      // the row back and say so if a date didn't make it into Excel.
      const notSaved = await checkSolutionDates(form.proposalId, form.proposalVersion, form).catch(() => []);
      setBdModal(null);
      if (form._fromLead) await linkLeadToProposal(form._fromLead, form.proposalId);
      await load();
      // BD checklist (In Process or Won) → this proposal's Engagement Calendar rows + their Ops Checklist rows
      if (String(form.opsChecklist || '').trim()) {
        const solNow = [...rows, { ...form, proposalV1Link: form.proposalV1Link || '' }];
        pushBdChecklist(form.proposalId, form.opsChecklist, solNow)
          .then(r => {
            if (r.ec || r.ops) console.info(`[BD checklist] ${form.proposalId}: copied to ${r.ec} Engagement Calendar and ${r.ops} Ops Checklist row(s)`);
            if (r.failed.length) alert(`Checklist saved, but it could not be copied to:\n${r.failed.join('\n')}`);
          })
          .catch(e => alert(`Checklist saved, but copying it to the Engagement Calendar failed: ${e.message}`));
      }
      if (notSaved.length) {
        alert(`Saved, but Excel did not keep: ${notSaved.join(' and ')}.\n\n` +
          'The SOLUTION_CRUD flow in Power Automate is not writing this column. Open the flow → ' +
          '"Add a row" and "Update a row" → map the column to ' +
          notSaved.map(l => l === 'Date of Discussion'
            ? "triggerBody()?['Date of Discusssion']"
            : "column \"Date of submission ER Team4\" = triggerBody()?['Date of submission ER Team4']").join(' and ') + '.' +
          (notSaved.columns?.length ? `\n\nDate columns Excel returned: ${notSaved.columns.map(c => `"${c}"`).join(', ')}` : ''));
      }
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSol(form) {
    setSaving(true);
    try {
      let payload = { ...form };

      // Solution status always follows the proposal's BD Status
      // The item belongs to the version of the line it was added from (latest if unknown)
      const lineAnchor = (form.proposalVersion && anchorOfVersion(rows, form.proposalId, form.proposalVersion)) ||
        latestRowFor(rows, form.proposalId);
      const bdAnchor = lineAnchor;
      if (bdAnchor?.bdStatus) payload.status = bdAnchor.bdStatus;

      if (!form.sno && form.proposalId) {
        const anchor = lineAnchor;
        if (anchor) {
          payload = {
            ...payload,
            clientName:         anchor.clientName         || payload.clientName,
            clientPoc:          anchor.clientPoc          || payload.clientPoc,
            contactNumber:      anchor.contactNumber      || payload.contactNumber,
            dateOfDiscussion:   anchor.dateOfDiscussion   || proposalDiscussion(rows, form.proposalId, anchor.proposalVersion) || payload.dateOfDiscussion,
            clientExpectedDate: anchor.clientExpectedDate || payload.clientExpectedDate,
            bdMonth:            anchor.bdMonth            || payload.bdMonth,
            programTopic:       anchor.programTopic       || payload.programTopic,
            proposalVersion:    anchor.proposalVersion    || payload.proposalVersion,
            bdStatus:           anchor.bdStatus           || payload.bdStatus,
            bdProposalValue:    anchor.bdProposalValue    || payload.bdProposalValue,
            submissionToClient: anchor.submissionToClient || payload.submissionToClient,
            opsChecklist:       anchor.opsChecklist       || payload.opsChecklist,
          };

          const hasSolRows = rowsOfVersion(rows, form.proposalId, anchor.proposalVersion).some(r => r.solutionTopic);
          if (!hasSolRows) {
            await updateSolutionRow(anchor.sno, { ...pick(anchor, BD_EXTRA_KEYS), ...payload });
            setSolModal(null);
            await load();
            return;
          }
        }
      }

      if (form.sno) {
        await updateSolutionRow(form.sno, payload);
      } else {
        await addSolutionRow(payload);
      }
      setSolModal(null);
      await load();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  // Count solution items linked to a BD entry by P ID + Version (user-defined index)
  const linkedSolCount = delTarget?.type === 'bd'
    ? rows.filter(r =>
        r.proposalId === delTarget.proposalId &&
        versionNo(r.proposalVersion) === versionNo(delTarget.proposalVersion) &&
        r.solutionTopic
      ).length
    : 0;

  async function handleDelete() {
    if (!delTarget) return;
    setSaving(true);
    try {
      if (delTarget.type === 'bd') {
        // Cascade delete: remove BD anchor + all Solution items indexed by P ID + Version
        const allRows = rows.filter(r =>
          r.proposalId === delTarget.proposalId &&
          versionNo(r.proposalVersion) === versionNo(delTarget.proposalVersion)
        );
        for (const r of allRows) {
          await deleteSolutionRow(r.sno);
        }
      } else {
        await deleteSolutionRow(delTarget.sno);
      }
      setDelTarget(null);
      await load();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Shared cell styles ────────────────────────────────────────────────────
  const thStyle = {
    padding: '10px 12px', fontWeight: 700, fontSize: 11, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
    borderBottom: '2px solid var(--border)', background: 'var(--surface, #F8F9FB)',
    position: 'sticky', top: 0, zIndex: 2, boxShadow: 'inset 0 -2px 0 var(--border)',
  };
  const tdStyle = { padding: '11px 12px', verticalAlign: 'middle' };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="tracker-page" style={{ maxWidth: 1400, margin: '0 auto', width: '100%' }}>
      {/* ── Fixed header: title, KPIs, filter bar ── */}
      <div className="tracker-fixed">
        <h1 className="tracker-title">
          {view === 'bd' ? '🎯 BD Tracker' : '💡 Solution Tracker'}
          <small>click a row to expand</small>
        </h1>

        {/* KPI Row */}
        <div className="kpi-compact">
          {view === 'bd' ? (
            <div className="kpi-card accent">
              <div className="kpi-label">Total Proposals</div>
              <div className="kpi-value">{loading ? '…' : kpi.lines}</div>
              <div className="kpi-sub">
                {kpi.total} unique proposal{kpi.total === 1 ? '' : 's'}
                {kpi.lines > kpi.total ? ` · ${kpi.lines - kpi.total} revision${kpi.lines - kpi.total === 1 ? '' : 's'}` : ''}
                {kpi.lines < kpi.allLines ? ` · of ${kpi.allLines} total` : ''}
              </div>
            </div>
          ) : (
            <div className="kpi-card accent">
              <div className="kpi-label">Filtered Proposals</div>
              <div className="kpi-value">{loading ? '…' : kpi.total}</div>
              <div className="kpi-sub">of {kpi.all} total{kpi.lines > kpi.total ? ` · ${kpi.lines} lines incl. revisions` : ''}</div>
            </div>
          )}
          {view === 'bd' ? (
            <div className="kpi-card green">
              <div className="kpi-label">Proposal Value</div>
              <div className="kpi-value">{loading ? '…' : fmtL(kpi.value)}</div>
              <div className="kpi-sub">{fmtIN(kpi.value)}</div>
            </div>
          ) : (
            <div className="kpi-card green">
              <div className="kpi-label">Solution Items</div>
              <div className="kpi-value">{loading ? '…' : kpi.solItems}</div>
              <div className="kpi-sub">Value {fmtIN(kpi.solValue)}</div>
            </div>
          )}
          {view === 'bd' ? (
            <div className="kpi-card blue">
              <div className="kpi-label">In Process</div>
              <div className="kpi-value">{loading ? '…' : kpi.ipLines}</div>
              <div className="kpi-sub">{kpi.inProc} unique · {kpi.lostLines} lost ({kpi.lost} unique)</div>
            </div>
          ) : (
            <div className="kpi-card blue">
              <div className="kpi-label">Unique Clients</div>
              <div className="kpi-value">{loading ? '…' : kpi.clients}</div>
              <div className="kpi-sub">{kpi.inProc} in process</div>
            </div>
          )}
          <div className="kpi-card purple">
            <div className="kpi-label">Won</div>
            <div className="kpi-value">{loading ? '…' : (view === 'bd' ? kpi.wonLines : kpi.won)}</div>
            <div className="kpi-sub">{view === 'bd' ? `${kpi.won} unique · ` : ''}{decided ? `${winRate}% win rate · ${fmtL(view === 'bd' ? kpi.wonValue : kpi.wonSolValue)}` : 'No closed proposals'}</div>
          </div>
        </div>

        {!loading && !error && (
          <PendingFieldsBar
            items={pendingBar}
            dueItems={dueBar}
            onPick={openPending}
            onPickDue={openDue}
            canEdit={view === 'bd' ? canUpdate('bd') : canEdit('solution')}
            storageKey={view === 'bd' ? 'bd' : 'solution'}
            noun={view === 'bd' ? 'BD line' : 'solution item'}
          />
        )}

        {/* Excel-style Filter Bar */}
        <CollapsibleFilterBar state={filterState}>
            {refreshing && !loading && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#e8760a' }}>⟳ Syncing with Excel…</span>
            )}
            <input
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inp, width: 180, padding: '5px 10px', height: 32 }}
            />
            <button className="btn btn-outline btn-sm" onClick={load} disabled={refreshing}>
              ↺ Refresh
            </button>
            {view === 'bd' ? (
              <ExportButton
                page="bd" filename="BD Tracker" sheetName="BD Tracker"
                columns={BD_EXPORT_COLUMNS}
                // one line per proposal version, as shown
                rows={() => bdRows}
                disabled={loading}
              />
            ) : (
              <ExportButton
                page="solution" filename="Solution Tracker" sheetName="Solution Tracker"
                columns={SOL_EXPORT_COLUMNS}
                // one line per solution item (proposals without items get one line)
                rows={() => bdRows.flatMap(r => (r._sols && r._sols.length
                  ? r._sols.map(s => ({ ...s, bdStatus: r.bdStatus, bdProposalValue: r.bdProposalValue, proposalVersion: r.proposalVersion, submissionToClient: r.submissionToClient }))
                  : [r]))}
                disabled={loading}
              />
            )}
            {view === 'bd' && canCreate('bd') && (
              <button className="btn btn-primary btn-sm" onClick={() => setBdModal('add')} style={{ whiteSpace: 'nowrap' }}>
                + Add BD Lead
              </button>
            )}
        </CollapsibleFilterBar>
      </div>

      {/* Main Card */}
      <div style={{ background: 'var(--card)', borderRadius: 10, padding: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading && <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>Loading…</div>}
        {error   && <div style={{ textAlign: 'center', padding: 48, color: '#ef4444' }}>⚠ {error}</div>}

        {!loading && !error && (
          <>
          <div className="tracker-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ ...thStyle, width: 36, textAlign: 'center' }}></th>
                  <th style={thStyle}>BD S No</th>
                  <th style={thStyle}>Proposal ID</th>
                  <th style={thStyle}>Client Name</th>
                  <th style={thStyle}>Program Topic</th>
                  <th style={thStyle}>BD Month</th>
                  <th style={thStyle}>BD Status</th>
                  <th style={thStyle}>{view === 'bd' ? 'Proposal Value' : 'Solution Value'}</th>
                  {view !== 'bd' && <th style={thStyle}>Sol Items</th>}
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bdRows.length === 0 && (
                  <tr>
                    <td colSpan={view === 'bd' ? 9 : 10} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                      {allBdRows.length && bdRows.length === 0 ? 'No proposals match the current filters' : <>No BD entries found. Click <strong>+ Add BD Lead</strong> to create one.</>}
                    </td>
                  </tr>
                )}

                {bdRows.map((r, i) => {
                  const solItems = r._sols || [];
                  const isOpen   = expanded.has(r._key);
                  const hasSols  = solItems.length > 0;
                  const multi    = r._versionCount > 1;
                  // Month heading above the first line of each BD month (default month order only)
                  const showMonth = !filterState.sort && (i === 0 || bdRows[i - 1]._monthKey !== r._monthKey);

                  return (
                    <Fragment key={`group-${r._key}-${i}`}>
                      {showMonth && (
                        <tr data-month-head>
                          <td colSpan={10} style={{ padding: '10px 14px 6px', background: 'var(--surface, #F8F9FB)',
                            borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: '#2D3047',
                            letterSpacing: 0.3, textTransform: 'uppercase' }}>
                            {monthHeading(r._monthKey)}
                            <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--muted)', textTransform: 'none' }}>
                              · {monthCounts.get(r._monthKey) || 0} {monthCounts.get(r._monthKey) === 1 ? 'line' : 'lines'}
                            </span>
                          </td>
                        </tr>
                      )}
                      {/* ── BD Primary Row ── */}
                      <tr
                        style={{
                          borderBottom: isOpen ? 'none' : '1px solid var(--border)',
                          background: isOpen ? 'var(--surface)' : 'transparent',
                          transition: 'background 0.15s',
                          cursor: 'pointer',
                        }}
                        data-pf={`line-${r._key}`}
                        onClick={() => toggleExpand(r._key)}
                        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'var(--surface)'; }}
                        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {/* Chevron toggle */}
                        <td style={{ ...tdStyle, textAlign: 'center', width: 36 }}>
                          <span style={{
                            display: 'inline-block',
                            transition: 'transform 0.2s',
                            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                            fontSize: 11, color: 'var(--muted)', userSelect: 'none',
                          }}>▶</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 700, background: 'var(--border)', borderRadius: 4, padding: '2px 7px', fontSize: 12 }}>#{bdNoOf(r)}</span>
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {r.proposalId}
                          <span title={multi ? (r._isLatest ? 'Latest version' : 'Earlier version — kept as history') : 'Proposal version'}
                            style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: '1px 7px',
                              background: multi && r._isLatest ? '#eef2ff' : 'var(--border)',
                              color: multi && r._isLatest ? '#4f46e5' : 'var(--muted)' }}>
                            {r.proposalVersion || 'V1'}
                          </span>
                          {multi && !r._isLatest && <span style={{ display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--muted)' }}>earlier version</span>}
                        </td>
                        <td style={tdStyle}>{r.clientName}</td>
                        <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.programTopic || '—'}</td>
                        <td style={tdStyle}>{r.bdMonth || '—'}</td>
                        <td style={tdStyle}>
                          {pill(r.bdStatus)}
                          {needsChecklist(r) && (
                            <span title="Operations Checklist not ticked yet. Edit the BD lead to tick it." style={{ display: 'block', marginTop: 3, fontSize: 10, fontWeight: 700, color: '#b91c1c' }}>⚠ Checklist pending</span>
                          )}
                        </td>
                        {/* BD view: BD Proposal Value as entered · Solution view: Solution Values of the line added up */}
                        <td style={tdStyle}>{view === 'bd'
                          ? (r.bdProposalValue ? `₹${r.bdProposalValue}` : '—')
                          : fmtIN(solValueOf(r))}</td>
                        {view !== 'bd' && (
                          <td style={tdStyle}>
                            {hasSols ? (
                              <span style={{ fontSize: 11, fontWeight: 600, background: '#ede9fe', color: '#6d28d9', borderRadius: 10, padding: '2px 8px' }}>
                                {solItems.length} sol
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>
                            )}
                          </td>
                        )}
                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                          {view === 'bd' && canEdit('bd') ? (
                            <div style={{ display: 'flex', gap: 5 }}>
                              {canUpdate('bd') && (
                                <EditButton onClick={() => setBdModal(r)} title="Edit BD Lead" />
                              )}
                              {canDelete('bd') && (
                                <DeleteButton
                                  onClick={() => setDelTarget({
                                    type: 'bd',
                                    sno: r.sno,
                                    proposalId: r.proposalId,
                                    proposalVersion: r.proposalVersion || '',
                                    label: `${r.proposalId}${r.proposalVersion ? ' / ' + r.proposalVersion : ''} — ${r.clientName}`,
                                  })}
                                  title="Delete BD Lead (cascades to linked Solution items)"
                                />
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>—</span>
                          )}
                        </td>
                      </tr>

                      {/* ── Expanded Sol Panel ── */}
                      {isOpen && (
                        <tr>
                          <td colSpan={view === 'bd' ? 9 : 10} style={{ padding: 0, borderBottom: '2px solid var(--accent)', background: 'var(--surface)' }}>
                            <div style={{ paddingLeft: 48, paddingRight: 16, paddingBottom: 16, paddingTop: 8 }}>

                              {view === 'bd' ? (
                                /* ── BD Tracker expanded: show remaining BD fields only ── */
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px 24px', padding: '12px 14px', background: 'rgba(99,102,241,0.05)', borderRadius: 8, fontSize: 13 }}>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Client POC</div>
                                    <div>{r.clientPoc || '—'}</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Contact Number</div>
                                    <div>{r.contactNumber || '—'}</div>
                                  </div>
                                  <InfoCell label="Client POC Email ID">
                                    {r.clientPocEmail ? <a href={`mailto:${r.clientPocEmail}`} style={{ color: 'var(--accent)' }}>{r.clientPocEmail}</a> : '—'}
                                  </InfoCell>
                                  <InfoCell label="Client POC Designation">{r.clientPocDesignation || '—'}</InfoCell>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Date of Discussion</div>
                                    <div>{r.dateOfDiscussion || '—'}</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Client Expected Date</div>
                                    <div>{r.clientExpectedDate || '—'}</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Proposal Version</div>
                                    <div>{r.proposalVersion || '—'}</div>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Proposal Link</div>
                                    <div>{bdLinkFor(rows, r.proposalId, r.proposalVersion) ? <LinkButton url={bdLinkFor(rows, r.proposalId, r.proposalVersion)} label="Open proposal" compact /> : '—'}</div>
                                  </div>
                                  <InfoCell label="Participant Profile">{splitList(r.participantProfile).join(', ') || '—'}</InfoCell>
                                  <InfoCell label="Expected Headcount">{r.expectedHeadcount || '—'}</InfoCell>
                                  <InfoCell label="Expected Batches">{r.expectedBatches || '—'}</InfoCell>
                                  <InfoCell label="Price per Batch">{fmtIN(toNum(r.pricePerBatch))}</InfoCell>
                                  <InfoCell label="Total Cost of Proposal"><strong>{fmtIN(totalCostOf(r))}</strong></InfoCell>
                                  {parsePocs(r.additionalPocs).length > 0 && (
                                    <InfoCell label="Additional Client POCs" full>
                                      {parsePocs(r.additionalPocs).map((p, i) => <div key={i}>{pocLabel(p)}</div>)}
                                    </InfoCell>
                                  )}
                                  {!!String(r.bdComments || '').trim() && (
                                    <InfoCell label="BD Comments" full><div style={{ whiteSpace: 'pre-wrap' }}>{r.bdComments}</div></InfoCell>
                                  )}
                                  {showsChecklist(r) && (
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Operations Checklist</div>
                                      <ChecklistChips value={r.opsChecklist} empty="⚠ Not ticked yet — edit this lead to tick it" />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                /* ── Solution Tracker expanded: BD detail strip + Sol items ── */
                                <>
                                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
                                    {r.clientPoc && <span><span style={{ color: 'var(--muted)' }}>POC:</span> {r.clientPoc}</span>}
                                    {r.contactNumber && <span><span style={{ color: 'var(--muted)' }}>Contact:</span> {r.contactNumber}</span>}
                                    {r.clientPocEmail && <span><span style={{ color: 'var(--muted)' }}>Email:</span> {r.clientPocEmail}</span>}
                                    {r.participantProfile && <span><span style={{ color: 'var(--muted)' }}>Profile:</span> {splitList(r.participantProfile).join(', ')}</span>}
                                    {!!(r.expectedHeadcount || r.expectedBatches) && <span><span style={{ color: 'var(--muted)' }}>Headcount / Batches:</span> {r.expectedHeadcount || '—'} / {r.expectedBatches || '—'}</span>}
                                    {totalCostOf(r) > 0 && <span><span style={{ color: 'var(--muted)' }}>Total Cost:</span> {fmtIN(totalCostOf(r))}</span>}
                                    {r.dateOfDiscussion && <span><span style={{ color: 'var(--muted)' }}>Discussion:</span> {r.dateOfDiscussion}</span>}
                                    {r.clientExpectedDate && <span><span style={{ color: 'var(--muted)' }}>Client Expt:</span> {r.clientExpectedDate}</span>}
                                    {r.proposalVersion && <span><span style={{ color: 'var(--muted)' }}>Version:</span> {r.proposalVersion}</span>}
                                  </div>

                                  {solItems.length > 0 ? (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
                                      <thead>
                                        <tr>
                                          {['Sol S No', 'Sol Month', 'Solution Topic', 'Line of Service', 'Type of Service', 'Dev Category', 'Sol Value', 'Status', 'Submitted to Client', 'Proposal', 'Actions'].map(h => (
                                            <th key={h} style={{ padding: '6px 10px', fontWeight: 700, fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {solItems.map((s, si) => (
                                          <tr key={`sol-${s.sno}-${si}`} style={{ borderBottom: '1px solid var(--border)' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.04)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <td style={{ padding: '8px 10px' }}>
                                              <span style={{ fontWeight: 700, background: '#ede9fe', color: '#6d28d9', borderRadius: 4, padding: '2px 7px', fontSize: 11 }}>{s.solSNo || '—'}</span>
                                            </td>
                                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{s.solutionMonth || '—'}</td>
                                            <td style={{ padding: '8px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{s.solutionTopic}</td>
                                            <td style={{ padding: '8px 10px' }}>{s.lineOfService || '—'}</td>
                                            <td style={{ padding: '8px 10px' }}>{s.typeOfService || '—'}</td>
                                            <td style={{ padding: '8px 10px' }}>{s.developmentCategory || '—'}</td>
                                            <td style={{ padding: '8px 10px' }}>{s.solutionValue ? `₹${s.solutionValue}` : '—'}</td>
                                            <td style={{ padding: '8px 10px' }}>{pill(r.bdStatus || s.status)}</td>
                                            <td style={{ padding: '8px 10px' }}>{r.submissionToClient || '—'}</td>
                                            <td style={{ padding: '8px 10px' }}><LinkButton url={String(s.proposalV1Link || '').trim() || bdLinkFor(rows, s.proposalId, s.proposalVersion)} label="Open" compact /></td>
                                            <td style={{ padding: '8px 10px' }}>
                                              <div style={{ display: 'flex', gap: 5 }}>
                                                <EditButton
                                                  onClick={() => setSolModal({ mode: 'edit', row: s, programTopic: r.programTopic, bdStatus: r.bdStatus })}
                                                  title="Edit Solution Item"
                                                />
                                                <DeleteButton
                                                  onClick={() => setDelTarget({ sno: s.sno, label: `SNo ${s.sno} — ${s.proposalId} / ${s.solutionTopic}`, type: 'sol' })}
                                                  title="Delete Solution Item"
                                                />
                                                {canCreate('engagement') && (
                                                  <button
                                                    title="Add to Engagement Calendar"
                                                    onClick={() => (needsChecklist(r) ? alert('The Operations Checklist for this proposal has not been ticked yet.\n\nAsk the BD person to tick it in the BD Tracker (edit the lead) before adding the engagement.') : true) && navigate('/engagement', {
                                                      state: {
                                                        prefill: {
                                                          company:     r.clientName       || '',
                                                          topic:       s.solutionTopic    || '',
                                                          serviceType: s.typeOfService    || '',
                                                          sector:      s.developmentCategory || '',
                                                          proposalLink: String(s.proposalV1Link || '').trim() || bdLinkFor(rows, s.proposalId, s.proposalVersion),
                                                          opsChecklist: r.opsChecklist || s.opsChecklist || '',
                                                        },
                                                      },
                                                    })}
                                                    style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #a5b4fc', background: '#ede9fe', color: '#5b21b6', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                                                  >📅</button>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--muted)' }}>No solution items yet for this proposal version.</p>
                                  )}

                                  <button
                                    onClick={() => setSolModal({ mode: 'add', lockedPid: r.proposalId, lockedVersion: r.proposalVersion, programTopic: r.programTopic, bdStatus: r.bdStatus })}
                                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px dashed var(--accent)', background: 'transparent', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
                                  >+ Add Solution Item</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tracker-fixed" style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 12, borderTop: '1px solid var(--border)' }}>
            Showing {bdRows.length} of {allBdRows.length} line{allBdRows.length !== 1 ? 's' : ''} · {kpi.total} of {kpi.all} proposal{kpi.all !== 1 ? 's' : ''} (each revised version is its own line)
          </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {(bdModal === 'add' || (bdModal && typeof bdModal === 'object')) && (
        <BDModal
          initial={bdModal === 'add' ? null : bdModal}
          onSave={handleSaveBD}
          onClose={() => setBdModal(null)}
          saving={saving}
          bdRows={bdRows}
          allRows={rows}
        />
      )}

      {solModal && solModal.mode === 'add' && (
        <SolModal
          initial={null}
          proposalId={solModal.lockedPid}
          proposalVersion={solModal.lockedVersion}
          bdLink={bdLinkFor(rows, solModal.lockedPid, solModal.lockedVersion ?? (latestRowFor(rows, solModal.lockedPid) || {}).proposalVersion)}
          programTopic={solModal.programTopic}
          bdStatus={solModal.bdStatus}
          onSave={handleSaveSol}
          onClose={() => setSolModal(null)}
          saving={saving}
        />
      )}
      {solModal && solModal.mode === 'edit' && (
        <SolModal
          initial={solModal.row}
          proposalId={solModal.row.proposalId}
          bdLink={bdLinkFor(rows, solModal.row.proposalId, solModal.row.proposalVersion)}
          programTopic={solModal.programTopic}
          bdStatus={solModal.bdStatus}
          onSave={handleSaveSol}
          onClose={() => setSolModal(null)}
          saving={saving}
        />
      )}

      {delTarget && (
        <DeleteDialog
          label={delTarget.label}
          onConfirm={handleDelete}
          onCancel={() => setDelTarget(null)}
          saving={saving}
          type={delTarget.type}
          linkedCount={linkedSolCount}
        />
      )}
    </div>
  );
}
