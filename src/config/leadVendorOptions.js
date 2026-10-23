/**
 * Drop-down values for the Lead Tracker and the Vendor Service Tracker.
 * Edit these lists to change the choices. Values already saved in Excel that are not
 * in a list are still shown (as "(old value)") and kept.
 */

/* ─── Leads ─── */
export const LEAD_SOURCES = [
  'Referral – Client', 'Referral – Associate / Partner', 'Referral – Internal team', 'LinkedIn', 'Website / Inbound form',
  'Email inbound', 'Event / Conference', 'Existing client – repeat', 'Cold outreach', 'Lead database (Lusha etc.)', 'Other',
];
export const LEAD_STATUSES = [
  'New', 'Contacted', 'In discussion', 'Proposal requested', 'Converted to BD', 'On hold', 'Not interested', 'Lost / Closed',
];
// Statuses that end a lead (no follow-up expected)
export const LEAD_CLOSED = ['Converted to BD', 'Not interested', 'Lost / Closed'];
export const LEAD_PRIORITIES = ['Hot', 'Warm', 'Cold'];
export const LEAD_ACTION_TYPES = ['Call', 'Email', 'Meeting', 'WhatsApp / Message', 'Proposal shared', 'Internal discussion', 'Note'];

/* ─── Vendor services ─── */
export const VENDOR_CATEGORIES = [
  'Venue', 'Printing & material', 'Props / kits', 'Travel', 'Stay', 'Local transport', 'Catering', 'Associate / facilitator fee',
  'Photography / video', 'Design / creative', 'Technology / platform', 'Courier / logistics', 'Other',
];
export const VENDOR_UNITS = ['Lump sum', 'Per day', 'Per person', 'Per piece', 'Per hour', 'Per night', 'Per km', 'Per trip'];
export const BILLABLE_OPTIONS = ['Billable to client', 'Not billable (EuRadicle cost)', 'Included in program fee'];
export const CLIENT_BILLING = ['To bill', 'Billed', 'Not applicable'];
export const VENDOR_PAYMENT = ['Invoice awaited', 'To pay', 'Partly paid', 'Paid', 'On hold / disputed'];

/* Reminder timings (days) — used by the Reminders popup and the Founder's Desk */
export const LEAD_FOLLOWUP_DEFAULT_DAYS = 3;     // suggested next follow-up when logging an action
export const VENDOR_INVOICE_EXPECTED_DAYS = 7;   // vendor invoice expected within N days of the service date
export const CLIENT_BILLING_DAYS = 7;            // billable service should be billed to the client within N days of the service date
export const VENDOR_PAYMENT_DAYS = 30;           // vendor invoice paid within N days of the invoice date

export const isBillable = v => /^billable/i.test(String(v || ''));
export const leadIsOpen = l => !LEAD_CLOSED.includes(String(l?.status || '').trim());
