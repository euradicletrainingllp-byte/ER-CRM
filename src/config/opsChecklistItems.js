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
 * `key` matches the item keys used in OpsChecklist.jsx (CL_ITEMS).
 * Values are stored in Excel as readable labels joined by "; ".
 */

export const OPS_CHECKLIST_ITEMS = [
  { key: 'calendarBlock',      label: 'Facilitator Calendar Block' },
  { key: 'travelDetails',      label: 'Travel Details Finalised' },
  { key: 'welcomeEmail',       label: 'Welcome Email + Pre-Work' },
  { key: 'preWork',            label: 'Pre-Work Details' },
  { key: 'evAndPm',            label: 'EV & PM Shared with Consultant' },
  { key: 'bootcamp',           label: 'Bootcamp Finalised' },
  { key: 'teachback',          label: 'Teachback Finalised' },
  { key: 'electronicVisuals',  label: 'Electronic Visuals + QR' },
  { key: 'participantManual',  label: 'Participant Manual' },
  { key: 'materialPrinting',   label: 'Material Printing Required' },
  { key: 'materialOrdering',   label: 'Material Ordering & Delivery Status' },
  { key: 'materialConversion', label: 'Material Conversion to Editable Form' },
  { key: 'attendanceSheet',    label: 'Attendance Sheet & Photos' },
  { key: 'feedbackReport',     label: 'Feedback Report' },
  { key: 'impactReport',       label: 'Impact Report' },
  { key: 'socialMedia',        label: 'Social Media Post' },
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
