/**
 * Turns Solution Tracker / BD Tracker rows into one record per proposal.
 * Used by the Solutioning and Sales dashboards.
 *
 * A proposal has several rows (the BD line + one per solution item). The latest version is used,
 * and every field is taken from the first row of that version that has it filled.
 *   Date    Date of Discussion → BD Month → Date of Submission to Client → by Sol team → Solution Month
 *           (same as the BD Tracker page's Year / Month filters); no date at all → current FY
 *   Value   BD Proposal Value of the BD line, else Solution Values of that version added up
 *   Status  BD Status Won / Closed / Confirmed → closed · Lost / Dropped / Rejected → lost · else process
 */
import CLIENT_INDUSTRY from '../config/clientIndustry.js';
import { clean, keyOf, pad2, fyStartOf, CURRENT_FY } from './erdCharts.jsx';

export const MONTH_IDX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/* ─── Parsing (same rules as the Solution Tracker page) ─── */
export function toISODate(v, refYear) {
  const s = clean(v);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isNaN(n)) {
    if (n > 25000 && n < 80000) { const d = new Date(Math.round((n - 25569) * 86400 * 1000)); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
    return '';
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12) return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`; }
  m = s.match(/([A-Za-z]{3,})[\s'’,-]*(\d{2,4})?/);
  if (m) {
    const mon = MONTH_IDX[m[1].slice(0, 3).toLowerCase()];
    if (mon) { let y = m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : null; if (!y && refYear) y = refYear; if (y) return `${y}-${pad2(mon)}-01`; }
  }
  return '';
}
export function toRupees(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v > 0 ? v : 0;
  const s = clean(v).toLowerCase().replace(/,/g, '');
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  if (!(n > 0)) return 0;
  if (/\bcr|crore/.test(s)) return n * 1e7;
  if (/\bl\b|lakh|lac|\dl/.test(s)) return n * 1e5;
  if (/\bk\b|\dk/.test(s)) return n * 1e3;
  return n;
}
const versionNo = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(n) ? 0 : n; };
function pipelineOf(bdStatus, solStatus) {
  const s = clean(bdStatus).toLowerCase();
  if (/won|closed|confirm|converted/.test(s)) return 'closed';
  if (/lost|drop|reject|declin|cancel/.test(s)) return 'lost';
  if (!s && /reject/i.test(clean(solStatus))) return 'lost';
  return 'process';
}
function customizationOf(t) {
  const s = clean(t);
  if (!s) return '';
  if (/new/i.test(s)) return 'New Creation';
  if (/custom/i.test(s)) return 'Customized';
  if (/standard/i.test(s)) return 'Standard';
  return s;
}
const industryFromConfig = client => {
  const c = keyOf(client);
  if (!c) return '';
  for (const [name, ind] of Object.entries(CLIENT_INDUSTRY)) if (c.includes(name.toLowerCase())) return ind;
  return '';
};

export function buildProposals(solutions) {
  const byId = new Map();
  (solutions || []).forEach(r => {
    const id = clean(r.proposalId);
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(r);
  });
  return [...byId.entries()].map(([id, rows]) => {
    // BD anchor row — same rule as the BD Tracker page: highest version, prefer the row with a BD S No
    let anchor = rows[0];
    rows.forEach(r => {
      const a = versionNo(r.proposalVersion), b = versionNo(anchor.proposalVersion);
      if (a > b || (a === b && !clean(anchor.bdSNo) && clean(r.bdSNo))) anchor = r;
    });
    const top = versionNo(anchor.proposalVersion);
    const vr = [anchor, ...rows.filter(r => r !== anchor && versionNo(r.proposalVersion) === top)];
    const f = k => { for (const r of vr) { if (clean(r[k])) return r[k]; } for (const r of rows) { if (clean(r[k])) return r[k]; } return ''; };

    // Proposal month — same order as the BD Tracker page's Year / Month filters:
    // Date of Discussion → BD Month → Date of Submission to Client → by Sol team → Solution Month
    const disc = toISODate(f('dateOfDiscussion'));
    const refYear = +(disc || toISODate(f('submissionToClient')) || '').slice(0, 4) || null;
    const date = disc || toISODate(f('bdMonth'), refYear) || toISODate(f('submissionToClient'))
              || toISODate(f('submissionBySolTeam')) || toISODate(f('solutionMonth'), refYear);

    const client = clean(anchor.clientName) || clean(f('clientName'));
    const bdValue = toRupees(anchor.bdProposalValue) || Math.max(0, ...vr.map(r => toRupees(r.bdProposalValue)));
    const solValue = vr.reduce((s, r) => s + toRupees(r.solutionValue), 0);
    return {
      id, client,
      topic: clean(anchor.programTopic) || clean(f('programTopic')) || clean(f('solutionTopic')),
      link: clean(f('proposalV1Link')),
      status: clean(anchor.bdStatus) || clean(f('bdStatus')),
      oppKey: clean(f('bdSNo')) ? `bd-${clean(f('bdSNo'))}` : `p-${id}`,
      date,
      undated: !date,
      // A proposal with no date at all is counted in the current FY (it is a recent BD line still being filled in)
      fy: date ? fyStartOf(date) : CURRENT_FY,
      value: bdValue || solValue,
      pipeline: pipelineOf(clean(anchor.bdStatus) || f('bdStatus'), f('status')),
      industry: clean(f('industry')) || industryFromConfig(client),
      developmentCategory: f('developmentCategory'), engagementType: f('engagementType'),
      lineOfService: f('lineOfService'), typeOfService: f('typeOfService'),
      customization: customizationOf(f('programType')),
    };
  });
}

/** Month slot (Apr = 0 … Mar = 11) of a proposal; undated ones go to the current month. */
export function monthSlot(p) {
  const iso = p.date || new Date().toISOString().slice(0, 10);
  return (+iso.slice(5, 7) + 8) % 12;
}
