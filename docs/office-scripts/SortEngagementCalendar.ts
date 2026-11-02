// Office Script — Excel Online > Automate > New script. Name: SortEngagementCalendar
// Sorts EngagementMasterTable by Start Date (oldest → newest), then End Date, then Index.
// S No is =ROW()-1, so it follows the new row order automatically. Index is never changed.
// TBD / blank start dates go to the bottom.
function main(workbook: ExcelScript.Workbook) {
  const table = workbook.getTable("EngagementMasterTable");
  if (!table) throw new Error("EngagementMasterTable not found");
  const names = table.getHeaderRowRange().getValues()[0].map(v => String(v).trim().toLowerCase());
  const col = (n: string) => { const i = names.indexOf(n.toLowerCase()); if (i < 0) throw new Error(`Column '${n}' not found`); return i; };
  table.getSort().apply([
    { key: col("Start Date"), ascending: true },
    { key: col("End Date"), ascending: true },
    { key: col("Index"), ascending: true },
  ], false);
}
