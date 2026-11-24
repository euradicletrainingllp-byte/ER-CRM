/**
 * Vendor Service Tracker — link columns for Ops Checklist v2 / Travel Desk (Office Script).
 * Run on the Vendor_Service_Tracker.xlsx the VENDOR_CRUD flow uses.
 * Excel for the web → Automate → New Script → paste → Save → Run.  Safe to run again.
 * Adds Source (Manual / Ops Checklist / Travel Desk), Ops Task ID, Trip ID to VendorServiceTable;
 * existing rows get Source = Manual.
 */
function main(workbook: ExcelScript.Workbook) {
  const t = workbook.getTable("VendorServiceTable");
  if (!t) throw new Error("VendorServiceTable not found — open the Vendor_Service_Tracker.xlsx the CRM uses.");
  const log: string[] = [];
  const ensure = (name: string) => {
    let c = t.getColumnByName(name);
    if (!c) { c = t.addColumn(-1, undefined, name); log.push(`added "${name}"`); }
    const r = c.getRangeBetweenHeaderAndTotal();
    r.setNumberFormat("@");
    return r;
  };
  const src = ensure("Source");
  ensure("Ops Task ID");
  ensure("Trip ID");
  src.getDataValidation().clear();
  src.getDataValidation().setRule({ list: { inCellDropDown: true, source: "Manual,Ops Checklist,Travel Desk" } });
  const ids = t.getColumnByName("Service ID")!.getRangeBetweenHeaderAndTotal().getValues();
  const vals = src.getValues();
  let n = 0;
  src.setValues(vals.map((v, i) => { const has = String(ids[i][0] ?? "").trim(); if (has && !String(v[0] ?? "").trim()) { n++; return ["Manual"]; } return [v[0]]; }));
  log.push(`Source = Manual on ${n} existing row(s)`);
  console.log(log.join("\n"));
}
