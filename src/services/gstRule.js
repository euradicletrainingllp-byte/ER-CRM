/**
 * GST written to the Engagement Calendar "GST" column (9 Nov 2026).
 *  • Price > 0, GST typed as 0  → 0 — billed without GST; never overwritten
 *  • Price > 0, anything else   → 18% of Price, recalculated on every save (blank cells filled in)
 *  • Price 0 (travel-only rows) → the GST as typed
 * No imports on purpose: used by api.js / syncWithEC.js / pages without an import cycle.
 */
const amt = v => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
export const GST_LOCKED_ZERO = e => { const t = String(e?.gst ?? '').trim(); return t !== '' && amt(t) === 0; };
export function gstForExcel(e) {
  const p = amt(e?.price);
  if (p <= 0) return amt(e?.gst);
  return GST_LOCKED_ZERO(e) ? 0 : Math.round(p * 18) / 100;
}
