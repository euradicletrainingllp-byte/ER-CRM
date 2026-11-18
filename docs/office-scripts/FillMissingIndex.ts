// Office Script — Excel Online > Automate > New script. Name: FillMissingIndex
// Gives every row of EngagementMasterTable with a blank Index the next number (highest Index + 1, +2 …).
// Writes plain numbers (no formulas), so the Index never changes when the table is sorted.
// Existing Index values are never touched. Safe to run any number of times.
function main(workbook: ExcelScript.Workbook): number {
  const table = workbook.getTable("EngagementMasterTable");
  if (!table) throw new Error("EngagementMasterTable not found");
  const names = table.getHeaderRowRange().getValues()[0].map(v => String(v).trim().toLowerCase());
  const c = names.indexOf("index");
  if (c < 0) throw new Error("Column 'Index' not found");
  const body = table.getRangeBetweenHeaderAndTotal();
  const col = body.getColumn(c);
  const vals = col.getValues();
  let max = 0;
  vals.forEach(r => { const n = Number(r[0]); if (String(r[0]).trim() !== "" && !isNaN(n)) max = Math.max(max, n); });
  let filled = 0;
  const out = vals.map(r => (String(r[0] ?? "").trim() === "" ? [++max] : [r[0]]));
  out.forEach((r, i) => { if (r[0] !== vals[i][0]) filled++; });
  if (filled) col.setValues(out);
  return filled;   // number of rows that got an Index
}
