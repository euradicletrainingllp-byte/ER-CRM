/**
 * EURADICLE CRM — BD checklist → Engagement Calendar → Ops Checklist
 *
 * The Operations checklist the BD person ticks (In Process or Won) travels with the
 * program, whatever its BD Status:
 *   • BD Tracker save        → copied to every Engagement Calendar row of that proposal
 *                              and to their Ops Checklist rows ("BD Checklist")
 *   • Engagement added       → if the form has no checklist, it is looked up from the proposal
 *   • "Add to Ops Checklist" → same lookup when the EC row has none
 *
 * An EC row belongs to a proposal when it carries the proposal's link, or when its
 * Company and Topic match the proposal's client and one of its topics exactly
 * (case / spaces / punctuation ignored).
 */
import {
  getSolutionTracker, peekList, getAllEngagementsCached, updateEngagementRow, patchEngagementCaches,
  getOpsChecklist, updateOpsRow,
} from './api.js';
import { ecUpdateBody, runForIndex } from './syncWithEC.js';

const txt = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clientKey = v => txt(String(v ?? '').toLowerCase().replace(/\b(bank|insurance|ltd|limited|pvt|private|india|group|inc|llp)\b/g, ''));
const vNo = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(n) ? 0 : n; };
const clean = v => String(v ?? '').trim();

/** Proposal ID → { checklist, client, topics, links } built from Solution / BD Tracker rows. */
export function proposalIndex(solRows) {
  const by = new Map();
  (solRows || []).forEach(r => {
    const id = clean(r.proposalId);
    if (!id) return;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  });
  const out = new Map();
  by.forEach((rows, id) => {
    const sorted = rows.slice().sort((a, b) => vNo(b.proposalVersion) - vNo(a.proposalVersion) || (clean(b.bdSNo) ? 1 : 0) - (clean(a.bdSNo) ? 1 : 0));
    const checklist = clean((sorted.find(r => clean(r.opsChecklist)) || {}).opsChecklist);
    out.set(id, {
      id, checklist,
      client: clientKey((sorted.find(r => clean(r.clientName)) || {}).clientName),
      topics: new Set(rows.flatMap(r => [r.programTopic, r.solutionTopic]).map(txt).filter(Boolean)),
      links: new Set(rows.map(r => clean(r.proposalV1Link)).filter(Boolean)),
    });
  });
  return out;
}

const belongs = (ec, p) =>
  (clean(ec.proposalLink) && p.links.has(clean(ec.proposalLink))) ||
  (p.client && clientKey(ec.company) === p.client && p.topics.has(txt(ec.topic)));

/** Checklist for an engagement (EC row or Add form) — '' when no single proposal matches. */
export async function checklistForEngagement(ec) {
  let sol = peekList('solution');
  if (!sol) { try { sol = await getSolutionTracker(); } catch { return ''; } }
  const found = new Set();
  proposalIndex(sol).forEach(p => { if (p.checklist && belongs(ec, p)) found.add(p.checklist); });
  return found.size === 1 ? [...found][0] : '';
}

/**
 * Copies a proposal's checklist to its Engagement Calendar rows and their Ops Checklist rows.
 * @returns {{ ec: number, ops: number, failed: string[] }}
 */
export async function pushBdChecklist(proposalId, checklist, solRows) {
  const list = clean(checklist);
  const p = proposalIndex(solRows).get(clean(proposalId));
  if (!list || !p) return { ec: 0, ops: 0, failed: [] };
  const all = await getAllEngagementsCached({ force: true });
  const mine = all.filter(e => clean(e.engagementKey) && !/cancel/i.test(clean(e.status)) && belongs(e, p));
  const failed = [];
  let ec = 0;
  for (const e of mine.filter(x => clean(x.opsChecklist) !== list)) {
    const key = clean(e.engagementKey);
    try {
      await runForIndex(key, () => updateEngagementRow(e.egId, e.sno, ecUpdateBody({ ...e, opsChecklist: list }), key));
      ec++;
    } catch (err) { failed.push(`EC ${e.egId || key}: ${err.message}`); }
  }
  try { patchEngagementCaches(rows => rows.map(r => (mine.some(m => clean(m.engagementKey) === clean(r.engagementKey)) ? { ...r, opsChecklist: list } : r))); } catch { /* cache only */ }

  let ops = 0;
  const keys = new Set(mine.map(e => clean(e.engagementKey)));
  if (keys.size) {
    const ocRows = await getOpsChecklist();
    for (const oc of ocRows.filter(o => keys.has(clean(o.engagementKey)) && clean(o.bdChecklist) !== list)) {
      try { await updateOpsRow(oc.sno, { bdChecklist: list }, oc.engagementKey); ops++; }
      catch (err) { failed.push(`Ops ${clean(oc.engagementKey)}: ${err.message}`); }
    }
  }
  return { ec, ops, failed };
}
