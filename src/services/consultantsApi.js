/**
 * EURADICLE CRM — CONSULTANT DIRECTORY (data layer)
 * ==================================================
 * ONE Excel table (Consultant_Directory.xlsx → ConsultantTable), ONE Power Automate
 * flow (CONSULTANTS_CRUD). One row per consultant; key column "Consultant ID" (CN-001…),
 * set by the CRM and never changed.
 *
 * The flow passes the whole body to Excel as the row (same as Project Management):
 *   Row = removeProperty(removeProperty(triggerBody(), 'action'), 'sno')
 * so the body holds ONLY 'action', 'sno' and exact Excel headers.
 *
 * Multi-value cells (skills, industries, clients …) are stored as "a; b; c" text
 * so they stay readable in Excel; the CRM turns them into lists.
 */
import FLOW_URLS from '../config/powerAutomate.js';
import { _callFlow as callFlow, _getField as getField, _formatDate as formatDate, _withReadRetry as withReadRetry,
  _rememberList as rememberList, _withDecodedKeys as withDecodedKeys, peekList } from './api.js';

const txt = v => String(v ?? '').trim();
const variants = h => [h, h.replace(/ /g, '_'), h.replace(/[^A-Za-z0-9]/g, '_'), h.replace(/[^A-Za-z0-9]/g, '')];
const numOrBlank = v => { const s = txt(v).replace(/[^0-9.-]/g, ''); return s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : ''); };

/** CRM key → exact Excel header (59 columns, same order as the workbook). */
export const CONSULTANT_COLS = {
  consultantId: 'Consultant ID', fullName: 'Full Name', designation: 'Designation', engagementModel: 'Engagement Model',
  status: 'Status', city: 'Base City', country: 'Country',
  email: 'Email', phone: 'Phone', linkedin: 'LinkedIn URL',
  headline: 'Profile Headline', about: 'About', yearsExp: 'Years of Experience', trained: 'Professionals Trained',
  coachingHours: 'Coaching Hours',
  badges: 'Practice Badges', skills: 'Core Skills', industries: 'Client Industries', clients: 'Notable Clients',
  geographies: 'Geographies', certifications: 'Certifications & Qualifications', credential: 'Coaching Credential',
  psychometrics: 'Psychometric Tools', languages: 'Languages', deliveryMode: 'Delivery Mode', travel: 'Open to Travel',
  photoLink: 'Photo Link', profileLink: 'Profile PDF Link', canvaLink: 'Canva Link', profileUpdated: 'Profile Last Updated',
  currency: 'Currency', dayRate: 'Full-Day Rate', halfDayRate: 'Half-Day Rate', coachingRate: 'Coaching Rate / Hour',
  travelTerms: 'Travel Terms', gstRegistered: 'GST Registered', gstin: 'GSTIN', rateNotes: 'Rate Notes',
  contractType: 'Contract Type', contractStatus: 'Contract Status', contractStart: 'Contract Start Date',
  contractEnd: 'Contract End Date', renewalNotice: 'Renewal Notice (Days)', autoRenew: 'Auto-Renew',
  contractLink: 'Contract Link', ndaSigned: 'NDA Signed', ndaDate: 'NDA Date', ndaLink: 'NDA Link',
  nonSolicit: 'Non-Solicit Clause', ipClause: 'IP Clause', lastRenewed: 'Last Renewed On', contractNotes: 'Contract Notes',
  owner: 'Relationship Owner', onboardedOn: 'Onboarded On', rating: 'Internal Rating', preferredFor: 'Preferred For',
  remarks: 'Remarks', createdBy: 'Created By', lastUpdated: 'Last Updated',
};
const DATES = new Set(['profileUpdated', 'contractStart', 'contractEnd', 'ndaDate', 'lastRenewed', 'onboardedOn', 'lastUpdated']);
const NUMS = new Set(['yearsExp', 'trained', 'coachingHours', 'dayRate', 'halfDayRate', 'coachingRate', 'renewalNotice']);
/** Multi-value fields ("a; b; c" in Excel). */
export const MULTI = ['badges', 'skills', 'industries', 'clients', 'geographies', 'certifications', 'psychometrics', 'languages'];
/** Commercial fields — shown only to people who can see money (Finance read) or admins. */
export const COMMERCIAL_KEYS = ['currency', 'dayRate', 'halfDayRate', 'coachingRate', 'travelTerms', 'gstRegistered', 'gstin', 'rateNotes'];

export const splitMulti = v => (Array.isArray(v) ? v : txt(v).split(/\s*[;\n]\s*/)).map(txt).filter(Boolean);
export const joinMulti = v => splitMulti(v).join('; ');

function readRow(raw) {
  const r = withDecodedKeys(raw);
  const out = {};
  for (const [k, h] of Object.entries(CONSULTANT_COLS)) {
    const v = getField(r, ...variants(h));
    out[k] = DATES.has(k) ? formatDate(v) : NUMS.has(k) ? numOrBlank(v) : txt(v);
  }
  out.sno = out.consultantId;
  return out;
}

/** CRM consultant → Excel body (exact headers only). Empty dates are left out on create. */
function toBody(c, { create }) {
  const body = {};
  for (const [k, h] of Object.entries(CONSULTANT_COLS)) {
    let v = c[k];
    if (MULTI.includes(k)) v = joinMulti(v);
    v = v == null ? '' : v;
    if (create && DATES.has(k) && !v) continue;
    body[h] = typeof v === 'number' ? v : String(v);
  }
  return body;
}

const rowsOf = data => (Array.isArray(data?.value) ? data.value : Array.isArray(data) ? data : []);

export function nextConsultantId(rows) {
  const max = Math.max(0, ...rows.map(r => Number(String(r.consultantId || '').replace(/\D/g, '')) || 0));
  return `CN-${String(max + 1).padStart(3, '0')}`;
}

export const consultantsConfigured = () => !!FLOW_URLS.CONSULTANTS_CRUD;

async function fetchConsultants() {
  const data = await callFlow('CONSULTANTS_CRUD', { action: 'get' });
  return rowsOf(data).map(readRow).filter(r => r.consultantId || r.fullName);
}
export async function getConsultants() { return rememberList('consultants', await withReadRetry(fetchConsultants)); }
export const peekConsultants = () => peekList('consultants');

export async function addConsultant(c) {
  return callFlow('CONSULTANTS_CRUD', { action: 'create', sno: c.consultantId, ...toBody(c, { create: true }) });
}
export async function updateConsultant(c) {
  if (!txt(c.consultantId)) throw new Error('This consultant has no Consultant ID in Excel, so it cannot be saved. Type an ID (e.g. CN-042) in its Consultant ID cell, then Refresh.');
  return callFlow('CONSULTANTS_CRUD', { action: 'update', sno: c.consultantId, ...toBody(c, { create: false }) });
}
export async function deleteConsultant(consultantId) {
  return callFlow('CONSULTANTS_CRUD', { action: 'delete', sno: consultantId });
}

/* ─── Contract expiry ─── */
const DAY = 86400000;
const todayUtc = () => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); };

/** Days until the contract end date ('' when no end date). Negative = expired. */
export function daysToExpiry(c) {
  if (!c.contractEnd) return '';
  const end = Date.parse(String(c.contractEnd).slice(0, 10) + 'T00:00:00Z');
  return isNaN(end) ? '' : Math.round((end - todayUtc()) / DAY);
}
export const noticeDays = c => (Number(c.renewalNotice) > 0 ? Number(c.renewalNotice) : 30);

/**
 * Contract alert, same rules as the Excel "Contract Watch":
 *   terminated | none (no end date) | expired | renew (within notice window) | ok
 */
export function contractAlert(c) {
  if (c.contractStatus === 'Terminated') return 'terminated';
  const d = daysToExpiry(c);
  if (d === '') return 'none';
  if (d < 0) return 'expired';
  if (d <= noticeDays(c)) return 'renew';
  return 'ok';
}
export const ALERT_LABEL = { terminated: 'Terminated', none: 'No contract date', expired: 'Expired', renew: 'Renew now', ok: 'Valid' };
