/**
 * Turns Solution Tracker / BD Tracker rows into proposal LINES — the same unit the BD Tracker page shows.
 * Used by the Solutioning and Sales dashboards (and, latest lines only, by Founder's Desk).
 *
 * One line = one Proposal ID + one version (V1, V2 …). A row with a blank Proposal Version belongs to the
 * version of its proposal's BD row; "Original" or no number counts as version 1 (same as the BD Tracker page).
 *   Count   every line counts — a revision is counted again in the month it was sent
 *           (the BD Tracker "Total Proposals" card; unique Proposal IDs are shown as a note)
 *   Month   Date of Discussion → BD Month → Date of Submission to Client → by Sol team → Solution Month
 *           (a month with no year, e.g. "April", is placed in the current FY — same month as the BD Tracker filter),
 *           taken from that version's rows (same order as the BD Tracker Year / Month filters)
 *   Status  that line's BD Status: Won / Closed / Confirmed → closed · Lost / Dropped / Rejected → lost · else process
 *   Value   BD Proposal Value of the line, else its Solution Values added up — counted the same way as the
 *           number: every version adds its own value in its own month (same as the Dashboard Report Excel).
 *           Lists of deals (order book, open pipeline, Founder's Desk) use only the latest version.
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
/** Version number — same rule as the BD Tracker page: first number in the text, else 1 ("Original", blank). */
export const versionNo = v => { const m = String(v ?? '').match(/(\d+)/); return m ? Number(m[1]) : 1; };
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

const hasBdNo = r => clean(r?.bdSNo) !== '';

/**
 * A month written without a year ("April", "Sept") — as many BD Month cells are. The BD Tracker page files it
 * under that month, so do the same: use the year of the line's other dates, else the current FY
 * (Apr–Dec → FY start year, Jan–Mar → the year after). Never "today", which would move it to the current month.
 */
function monthInFy(v, refYear) {
  const iso = toISODate(v, refYear);
  if (iso) return iso;
  const m = clean(v).match(/[A-Za-z]{3,}/);
  const mon = m ? MONTH_IDX[m[0].slice(0, 3).toLowerCase()] : 0;
  if (!mon) return '';
  return `${mon >= 4 ? CURRENT_FY : CURRENT_FY + 1}-${pad2(mon)}-01`;
}

/** One record per Proposal ID + version (see the note at the top). */
export function buildProposalLines(solutions) {
  const byId = new Map();
  (solutions || []).forEach(r => {
    const id = clean(r.proposalId);
    if (!id) return;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(r);
  });
  const out = [];
  byId.forEach((rows, id) => {
    const bdRow = rows.find(hasBdNo);
    // One opportunity per proposal: its first BD S No (each version now has its own BD S No)
    const bdNos = rows.map(r => Number(clean(r.bdSNo))).filter(n => clean(n) !== '' && Number.isFinite(n) && n > 0);
    const oppKey = bdNos.length ? `bd-${Math.min(...bdNos)}` : `p-${id}`;
    const effVersion = r => (clean(r.proposalVersion) ? versionNo(r.proposalVersion) : versionNo(bdRow?.proposalVersion));
    const groups = new Map();
    rows.forEach(r => { const n = effVersion(r); if (!groups.has(n)) groups.set(n, []); groups.get(n).push(r); });
    const top = Math.max(...groups.keys());
    const all = rows;
    groups.forEach((vr, n) => {
      const anchor = vr.find(hasBdNo) || vr[0];
      const lineRows = [anchor, ...vr.filter(r => r !== anchor)];
      const f = k => { for (const r of lineRows) { if (clean(r[k])) return r[k]; } for (const r of all) { if (clean(r[k])) return r[k]; } return ''; };
      const fl = k => { for (const r of lineRows) { if (clean(r[k])) return r[k]; } return ''; };   // this version only

      // Month — this version's own dates first, so a revision sits in the month it was sent
      const pickDate = g => {
        const disc = toISODate(g('dateOfDiscussion'));
        const refYear = +(disc || toISODate(g('submissionToClient')) || '').slice(0, 4) || null;
        return disc || monthInFy(g('bdMonth'), refYear) || toISODate(g('submissionToClient'))
            || toISODate(g('submissionBySolTeam')) || monthInFy(g('solutionMonth'), refYear);
      };
      const date = pickDate(fl) || pickDate(f);

      const client = clean(anchor.clientName) || clean(f('clientName'));
      const bdValue = toRupees(anchor.bdProposalValue) || Math.max(0, ...vr.map(r => toRupees(r.bdProposalValue)));
      const solValue = vr.reduce((sum, r) => sum + toRupees(r.solutionValue), 0);
      const solCount = vr.filter(r => clean(r.solutionTopic)).length;   // solution items in this version
      const quotedValue = bdValue || solValue;
      const isLatest = n === top;
      out.push({
        id, version: n, key: `${id}|${n}`, isLatest, versionCount: groups.size,
        client,
        topic: clean(anchor.programTopic) || clean(f('programTopic')) || clean(f('solutionTopic')),
        link: clean(fl('proposalV1Link')) || clean(f('proposalV1Link')),
        status: clean(anchor.bdStatus) || clean(f('bdStatus')),
        oppKey,
        bdNo: clean(anchor.bdSNo),   // this version's own BD S No
        date,
        undated: !date,
        // A line with no date at all is counted in the current FY (a recent BD line still being filled in)
        fy: date ? fyStartOf(date) : CURRENT_FY,
        quotedValue,
        value: quotedValue,
        bdValue,     // BD Proposal Value only — used by the Sales tab (matches the BD Tracker)
        solCount,    // number of solution items (rows with a Solution Topic) in this version
        solValue,    // Solution Values only — used by the Solutioning tab (matches the Solution Tracker)
        pipeline: pipelineOf(clean(anchor.bdStatus) || f('bdStatus'), f('status')),
        industry: clean(f('industry')) || industryFromConfig(client),
        developmentCategory: f('developmentCategory'), engagementType: f('engagementType'),
        lineOfService: f('lineOfService'), typeOfService: f('typeOfService'),
        customization: customizationOf(f('programType')),
      });
    });
  });
  return out;
}

/** One record per Proposal ID — its latest version (Founder's Desk pipeline, order book, open pipeline lists). */
export function buildProposals(solutions) {
  return buildProposalLines(solutions).filter(l => l.isLatest);
}

/** Number of different Proposal IDs in a list of lines. */
export const uniqueProposals = lines => new Set((lines || []).map(l => l.id)).size;

/** Month slot (Apr = 0 … Mar = 11) of a proposal; undated ones go to the current month. */
export function monthSlot(p) {
  const iso = p.date || new Date().toISOString().slice(0, 10);
  return (+iso.slice(5, 7) + 8) % 12;
}
