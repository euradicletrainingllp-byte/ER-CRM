/**
 * Pending-field rules for the notification bar on each tracker.
 * ─────────────────────────────────────────────────────────────
 * Each rule: { key, label, when?(row) }  — `label` must match the label shown in
 * that tracker's edit form (used to jump to the field). `when` limits a rule to
 * the rows it applies to; without it the field is always expected.
 * To stop flagging a field, delete its line. To flag a new one, add a line.
 */
import { parseChecklist } from './opsChecklistItems.js';
import { leadIsOpen, isBillable } from './leadVendorOptions.js';

const s = v => String(v ?? '').trim();
export const isBlank = v => { const t = s(v); return !t || t === '—' || t === '-'; };
const blankOrZero = v => isBlank(v) || Number(v) === 0;
const cancelled = r => /cancel/i.test(s(r.status));

const pad2 = n => String(n).padStart(2, '0');
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
/** Excel serial / YYYY-MM-DD / DD/MM/YYYY → YYYY-MM-DD ('' if unknown) */
export const toIso = d => {
  const v = s(d);
  if (!v) return '';
  const n = Number(v);
  if (!isNaN(n) && n > 25000) { const dt = new Date(Math.round((n - 25569) * 86400000)); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10); }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
/** Engagement already finished (end date, else start date, is before today) */
const ended = r => { const e = toIso(r.endDate) || toIso(r.startDate); return !!e && e < todayIso(); };

// ── Operations Checklist — "Edit Session" form ──────────────────────────────
export const OPS_RULES = {
  skip: r => cancelled(r),
  fields: [
    { key: 'egId',             label: 'EG.ID' },
    { key: 'clientSpoc',       label: 'Client SPOC' },
    { key: 'internalPoc',      label: 'Internal POC' },
    { key: 'startDate',        label: 'Engagement Start Date' },
    { key: 'endDate',          label: 'Engagement End Date' },
    { key: 'topic',            label: 'Topic / Program' },
    { key: 'sector',           label: 'Sector' },
    { key: 'serviceType',      label: 'Service Type' },
    { key: 'offering',         label: 'Offering' },
    { key: 'programType',      label: 'Program Type' },
    { key: 'location',         label: 'Location' },
    { key: 'noOfParticipants', label: 'No. of Participants', test: blankOrZero },
    { key: 'day',              label: 'Day(s)',              test: blankOrZero },
    { key: 'consultant1',      label: 'Consultant 1' },
    { key: 'contractType',     label: 'Contract Type' },
    { key: 'contractStatus',   label: 'Contract Status' },
    { key: 'paxListReceived',  label: 'Pax List Received' },
  ],
};

// ── Engagement Calendar — "Edit Engagement" form (finance fields live in the Finance Tracker) ──
export const EC_RULES = {
  skip: r => cancelled(r),
  fields: [
    { key: 'egId',        label: 'EG ID' },
    { key: 'company',     label: 'Client / Company' },
    { key: 'startDate',   label: 'Start Date' },
    { key: 'endDate',     label: 'End Date' },
    { key: 'topic',       label: 'Topic / Program' },
    { key: 'sector',      label: 'Sector' },
    { key: 'serviceType', label: 'Service Type' },
    { key: 'offering',    label: 'Offering' },
    { key: 'location',    label: 'Location (VILT / City)' },
    { key: 'consultant1', label: 'Lead Consultant' },
    { key: 'contract',    label: 'Contract Type' },
    { key: 'poStatus',    label: 'Contract Status' },
    { key: 'price',       label: 'Price (₹)', test: blankOrZero },
    // After delivery only
    { key: 'feedback',    label: 'Feedback', when: r => ended(r) || /deliver/i.test(s(r.status)) },
    { key: 'nps',         label: 'NPS',      when: r => ended(r) || /deliver/i.test(s(r.status)) },
  ],
};

// ── Content Development Tracker — detail panel (inline edit) ────────────────
export const CDT_RULES = {
  fields: [
    { key: 'client',     label: 'Client' },
    { key: 'topic',      label: 'Program Topic' },
    { key: 'startDate',  label: 'Start Date' },
    { key: 'poc',        label: 'POC' },
    { key: 'pmRequired', label: 'PM Required' },
    { key: 'evRequired', label: 'EV Required' },
  ],
};

// ── Finance Tracker — finance panel (only what is due by now) ───────────────
const payOf = r => s(r.payment).toLowerCase();
const finActive = r => !cancelled(r) && !/^(na|n\/a|not applicable)$/.test(payOf(r));
export const FIN_RULES = {
  skip: r => !finActive(r),
  fields: [
    { key: 'payment',        label: 'Payment Status',      when: r => ended(r) },
    { key: 'invoice',        label: 'Invoice Date',        when: r => ended(r), test: v => !toIso(v) },
    { key: 'gst',            label: 'GST (₹)',             when: r => !!toIso(r.invoice) },
    { key: 'amountReceived', label: 'Amount Received (₹)', when: r => /received/.test(payOf(r)), test: blankOrZero },
    { key: 'receivedDate',   label: 'Received Date',       when: r => /received/.test(payOf(r)), test: v => !toIso(v) },
  ],
};

// ── BD Tracker — "Edit BD Entry" form (one line per proposal version) ───────
export const BD_RULES = {
  skip: r => s(r.bdStatus) === 'Lost',
  fields: [
    { key: 'clientPoc',            label: 'Client POC' },
    { key: 'contactNumber',        label: 'Contact Number' },
    { key: 'clientPocEmail',       label: 'Client POC Email ID' },
    { key: 'clientPocDesignation', label: 'Client POC Designation' },
    { key: 'dateOfDiscussion',     label: 'Date of Discussion' },
    { key: 'clientExpectedDate',   label: 'Client Expt' },
    { key: 'programTopic',         label: 'Program Topic' },
    { key: 'bdProposalValue',      label: 'BD Proposal Value' },
    { key: 'submissionToClient',   label: 'Date of Submission to Client' },
    { key: 'proposalV1Link',       label: 'Proposal Link' },        // value supplied by the page (BD link)
    { key: 'participantProfile',   label: 'Participant Profile' },
    { key: 'expectedHeadcount',    label: 'Total Expected Headcount', test: blankOrZero },
    { key: 'expectedBatches',      label: 'Total Expected Batches',   test: blankOrZero },
    { key: 'pricePerBatch',        label: 'Price per Batch',          test: blankOrZero },
    { key: 'opsChecklist',         label: 'Operations Checklist',
      when: r => ['In Process', 'Won'].includes(s(r.bdStatus)), test: v => parseChecklist(v).length === 0 },
  ],
};

// ── Solution Tracker — "Edit Solution Item" form ────────────────────────────
export const SOL_RULES = {
  fields: [
    { key: 'programType',         label: 'Program Type' },
    { key: 'engagementType',      label: 'Engagement Type' },
    { key: 'lineOfService',       label: 'Line of Service' },
    { key: 'typeOfService',       label: 'Type of Service' },
    { key: 'developmentCategory', label: 'Development Category' },
    { key: 'solutionValue',       label: 'Solution Value', test: blankOrZero },
  ],
};

// ── Lead Tracker — "Add / Edit Lead" form ───────────────────────────────────
export const LEAD_RULES = {
  fields: [
    { key: 'source',        label: 'Lead Source' },
    { key: 'sharedBy',      label: 'Shared By' },
    { key: 'contactName',   label: 'Contact Person' },
    { key: 'email',         label: 'Email', when: r => isBlank(r.phone) },      // flagged only when there is no phone either
    { key: 'owner',         label: 'Lead Owner' },
    { key: 'requirement',   label: 'Requirement' },
    { key: 'nextFollowUp',  label: 'Next Follow-up', when: r => leadIsOpen(r) },
  ],
};

// ── Vendor Service Tracker — "Add / Edit Vendor Service" form ───────────────
export const VENDOR_RULES = {
  fields: [
    { key: 'category',          label: 'Service Category' },
    { key: 'description',       label: 'Service Description' },
    { key: 'serviceDate',       label: 'Service Date' },
    { key: 'total',             label: 'Total Cost (₹)', test: blankOrZero },
    { key: 'billable',          label: 'Billable to Client' },
    { key: 'client',            label: 'Client', when: r => isBillable(r.billable) },
    { key: 'vendorInvoiceNo',   label: 'Vendor Invoice No', when: r => ['To pay', 'Partly paid', 'Paid'].includes(s(r.paymentStatus)) },
    { key: 'clientInvoiceRef',  label: 'Client Invoice Ref', when: r => s(r.clientBilling) === 'Billed' },
    { key: 'paidDate',          label: 'Paid Date', when: r => s(r.paymentStatus) === 'Paid' },
  ],
};

/** Missing fields of one row under a rule set → [{ key, label }] */
export function missingFields(row, rules) {
  if (!row || rules.skip?.(row)) return [];
  return rules.fields
    .filter(f => (!f.when || f.when(row)) && (f.test || isBlank)(row[f.key]))
    .map(({ key, label }) => ({ key, label }));
}

/**
 * Build the bar items for a list that is already in serial order.
 * describe(row) → { id, serial, title, subtitle }
 */
export function pendingItems(rows, rules, describe) {
  const out = [];
  (rows || []).forEach(r => {
    const missing = missingFields(r, rules);
    if (missing.length) out.push({ ...describe(r), row: r, missing });
  });
  return out;
}

/* Consultant Directory — labels match the Add / Edit Consultant form */
export const CONSULTANT_RULES = {
  skip: r => s(r.status) === 'Inactive',
  fields: [
    { key: 'email',          label: 'Email' },
    { key: 'phone',          label: 'Phone' },
    { key: 'headline',       label: 'Profile Headline' },
    { key: 'yearsExp',       label: 'Years of Experience', test: blankOrZero },
    { key: 'badges',         label: 'Practice Badges' },
    { key: 'skills',         label: 'Core Skills' },
    { key: 'profileLink',    label: 'Profile PDF Link' },
    { key: 'contractStart',  label: 'Contract Start Date', when: r => s(r.contractStatus) !== 'Terminated' },
    { key: 'contractEnd',    label: 'Contract End Date (expiry)', when: r => s(r.contractStatus) !== 'Terminated' },
    { key: 'contractLink',   label: 'Contract Link', when: r => ['Signed', 'Expired'].includes(s(r.contractStatus)) },
    { key: 'ndaSigned',      label: 'NDA Signed' },
    { key: 'owner',          label: 'Relationship Owner' },
  ],
};
