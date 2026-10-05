/**
 * EURADICLE CRM — OPERATIONS CHECKLIST ITEMS (shared)
 *
 * One list used by:
 *   • BD Tracker      – when a proposal is marked Won, the BD person ticks the
 *                       items Operations must arrange (saved in the Solution
 *                       Tracker column "Ops Checklist")
 *   • Engagement Cal. – carried over when the engagement is added
 *                       (column "Ops Checklist")
 *   • Ops Checklist   – shown as "Required by BD" tags (column "BD Checklist")
 *
 * When a `key` matches an item key in OpsChecklist.jsx (CL_ITEMS), that Ops row
 * also gets a "Required by BD" tag; every ticked item shows in the Ops banner.
 * Values are stored in Excel as readable labels joined by "; ".
 */

export const OPS_CHECKLIST_ITEMS = [
  { key: 'preAssessment',  label: 'Pre-Assessment' },
  { key: 'postAssessment', label: 'Post-Assessment' },
  { key: 'feedbackReport', label: 'Feedback Report' },    // same key as the Ops Checklist item → "Required by BD" tag
  { key: 'impactReport',   label: 'Impact Report' },      // same key as the Ops Checklist item → "Required by BD" tag
  { key: 'recapReckoner',  label: 'Recap Reckoner' },
  { key: 'pmHardcopy',     label: 'PM (Hardcopy)' },
  { key: 'pmEditable',     label: 'PM Editable' },
  { key: 'feedbackQr',     label: 'Feedback QR' },
  { key: 'Welcome Email',  label: 'Welcome Email' },
  { key: 'Certificates',  label: 'Certificates' },
];

const SEP = '; ';
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_NORM = new Map();
OPS_CHECKLIST_ITEMS.forEach(it => { BY_NORM.set(norm(it.label), it.key); BY_NORM.set(norm(it.key), it.key); });

/** Stored text ("Participant Manual; Feedback Report") → ['participantManual','feedbackReport'] */
export function parseChecklist(value) {
  if (Array.isArray(value)) return value.filter(k => OPS_CHECKLIST_ITEMS.some(it => it.key === k));
  const keys = String(value ?? '')
    .split(/[;\n|]+/)
    .map(part => BY_NORM.get(norm(part)))
    .filter(Boolean);
  return [...new Set(keys)];
}

/** ['participantManual','feedbackReport'] → "Participant Manual; Feedback Report" (list order) */
export function serializeChecklist(keys) {
  const set = new Set(parseChecklist(keys));
  return OPS_CHECKLIST_ITEMS.filter(it => set.has(it.key)).map(it => it.label).join(SEP);
}

export const checklistLabel = key => OPS_CHECKLIST_ITEMS.find(it => it.key === key)?.label || key;
