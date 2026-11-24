/**
 * Ops Checklist v2 — one-time workbook setup (Office Script).
 * Run on the Operations Checklist.xlsx the CRM flow uses:
 *   OneDrive › Back-up Folder › Info Folders › Test Trackers › Operations Checklist.xlsx
 * Excel for the web → Automate → New Script → paste → Save → Run.  Safe to run again (skips what is done).
 *  1. TAT (days) as Text in StepTable + OpsTaskTable; End-anchored steps get "+" (3 → +3).
 *  2. Owner Dept drop-downs removed (several departments per cell: "Operations; Finance").
 *  3. StepTable "Vendor Category" (+ drop-down, filled for logistics / printing steps).
 *  4. OpsTaskTable "Vendor Service IDs".
 *  5. Sheet "List Values" → ListTable.
 *  6. Sheet "Travel Desk" → TravelTable.
 */
function main(workbook: ExcelScript.Workbook) {
  const log: string[] = [];
  const steps = workbook.getTable("StepTable");
  const tasks = workbook.getTable("OpsTaskTable");
  if (!steps || !tasks) throw new Error("StepTable / OpsTaskTable not found — open the Operations Checklist.xlsx the CRM uses.");

  const col = (t: ExcelScript.Table, name: string) => {
    const c = t.getColumnByName(name);
    if (!c) throw new Error(`Column "${name}" not found in ${t.getName()}`);
    return c;
  };
  const ensureCol = (t: ExcelScript.Table, name: string) => {
    let c = t.getColumnByName(name);
    if (!c) { c = t.addColumn(-1, undefined, name); log.push(`${t.getName()}: added "${name}"`); }
    return c;
  };
  const txt = (v: string | number | boolean) => String(v ?? "").trim();
  const plus = (v: string) => (!v || v === "0" || v.startsWith("+") ? v : "+" + v.replace(/^-/, ""));

  // 1 — TAT as text, "+" for End-anchored steps
  const stepIds = col(steps, "StepID").getRangeBetweenHeaderAndTotal().getValues().map(r => txt(r[0]));
  const anchors = col(steps, "Anchor").getRangeBetweenHeaderAndTotal().getValues().map(r => txt(r[0]));
  const endSteps = new Set(stepIds.filter((_, i) => anchors[i].toLowerCase() === "end"));
  const fixTat = (t: ExcelScript.Table, isEnd: (i: number) => boolean) => {
    const r = col(t, "TAT (days)").getRangeBetweenHeaderAndTotal();
    const before = r.getValues().map(x => txt(x[0]));
    const after = before.map((v, i) => [isEnd(i) ? plus(v) : v]);
    r.setNumberFormat("@");
    r.setValues(after);
    const n = after.filter((v, i) => v[0] !== before[i]).length;
    log.push(`${t.getName()}: TAT as text${n ? `, ${n} End step(s) given "+"` : ""}`);
  };
  fixTat(steps, i => anchors[i].toLowerCase() === "end");
  const taskStepIds = col(tasks, "StepID").getRangeBetweenHeaderAndTotal().getValues().map(r => txt(r[0]));
  fixTat(tasks, i => endSteps.has(taskStepIds[i]));

  // 2 — several departments per cell
  col(steps, "Owner Dept").getRangeBetweenHeaderAndTotal().getDataValidation().clear();
  col(tasks, "Owner Dept").getRangeBetweenHeaderAndTotal().getDataValidation().clear();
  log.push("Owner Dept drop-downs removed (StepTable, OpsTaskTable)");

  // 3 — Vendor Category on steps
  const VENDOR_CATS = ["Venue", "Printing & material", "Props / kits", "Travel", "Stay", "Local transport", "Catering", "Courier / logistics", "Other"];
  const MAP: { [id: string]: string } = { "OPS-006": "Travel", "OPS-007": "Stay", "OPS-018": "Printing & material", "OPS-019": "Courier / logistics", "OPS-020": "Printing & material", "OPS-021": "Props / kits" };
  const vc = ensureCol(steps, "Vendor Category").getRangeBetweenHeaderAndTotal();
  vc.setNumberFormat("@");
  vc.setValues(vc.getValues().map((r, i) => [txt(r[0]) || MAP[stepIds[i]] || ""]));
  vc.getDataValidation().clear();
  vc.getDataValidation().setRule({ list: { inCellDropDown: true, source: VENDOR_CATS.join(",") } });

  // 4 — link from a task to its vendor rows
  ensureCol(tasks, "Vendor Service IDs").getRangeBetweenHeaderAndTotal().setNumberFormat("@");

  // 5 — ListTable
  if (!workbook.getTable("ListTable")) {
    const lists: [string, string[]][] = [
      ["Phase", ["1. Setup", "2. Logistics", "3. Content & Material", "4. Delivery", "5. Post-Program", "6. Finance"]],
      ["Offering", ["Learning Journey", "Workshop", "Coaching"]],
      ["Mode", ["In-person", "Virtual"]],
      ["Waiting On", ["Internal", "Client", "Consultant", "Vendor"]],
    ];
    const rows: (string | number)[][] = [["ListID", "List", "Value", "Order", "Active"]];
    let n = 0;
    lists.forEach(([name, vals]) => vals.forEach((v, i) => { n++; rows.push([`LST-${String(n).padStart(3, "0")}`, name, v, i + 1, "Yes"]); }));
    const ws = workbook.getWorksheet("List Values") || workbook.addWorksheet("List Values");
    const rg = ws.getRange(`A1:E${rows.length}`);
    rg.setNumberFormat("@");
    rg.setValues(rows);
    ws.getRange(`D2:D${rows.length}`).setNumberFormat("0");
    workbook.addTable(rg, true).setName("ListTable");
    ws.getRange("A:E").getFormat().autofitColumns();
    log.push(`ListTable created (${rows.length - 1} values)`);
  } else log.push("ListTable already there");

  // 6 — TravelTable
  if (!workbook.getTable("TravelTable")) {
    const H = ["TripID", "EC Index", "EG.ID", "Company", "Program", "Program Start", "Program End", "Location", "Traveller", "Traveller Email", "Traveller Role",
      "From City", "To City", "Travel Mode", "Onward Date", "Onward Time", "Onward Carrier / No", "Onward PNR", "Return Date", "Return Time", "Return Carrier / No", "Return PNR",
      "Ticket Link", "Hotel Name", "Hotel Address", "Check-in", "Check-out", "Local Transport", "Travel Cost", "Stay Cost", "Local Cost", "Total Cost", "Billable to Client",
      "Booking Status", "Booked By", "Booked On", "Shared With Traveller On", "Vendor Service IDs", "Notes", "Created By", "Updated On"];
    const ws = workbook.getWorksheet("Travel Desk") || workbook.addWorksheet("Travel Desk");
    const lastCol = (n: number) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    const hdr = ws.getRange(`A1:${lastCol(H.length - 1)}1`);
    hdr.setValues([H]);
    const t = workbook.addTable(ws.getRange(`A1:${lastCol(H.length - 1)}2`), true);
    t.setName("TravelTable");
    const body = (name: string) => t.getColumnByName(name)!.getRangeBetweenHeaderAndTotal();
    const DATES = ["Program Start", "Program End", "Onward Date", "Return Date", "Check-in", "Check-out", "Booked On", "Shared With Traveller On", "Updated On"];
    const TIMES = ["Onward Time", "Return Time"];
    const MONEY = ["Travel Cost", "Stay Cost", "Local Cost", "Total Cost"];
    H.forEach(h => body(h).setNumberFormat(DATES.includes(h) ? "dd-mmm-yyyy" : TIMES.includes(h) ? "hh:mm" : MONEY.includes(h) ? "#,##,##0" : "@"));
    body("Total Cost").setFormula("=SUM([@[Travel Cost]],[@[Stay Cost]],[@[Local Cost]])");
    const dd = (h: string, vals: string[]) => body(h).getDataValidation().setRule({ list: { inCellDropDown: true, source: vals.join(",") } });
    dd("Traveller Role", ["Consultant", "Co-facilitator", "Ops team", "Other"]);
    dd("Travel Mode", ["Flight", "Train", "Bus", "Cab", "Self-drive", "None"]);
    dd("Booking Status", ["Requested", "Booked", "Shared", "Completed", "Cancelled"]);
    dd("Billable to Client", ["Billable to client", "Not billable (EuRadicle cost)", "Included in program fee"]);
    ws.getFreezePanes().freezeRows(1);
    hdr.getFormat().autofitColumns();
    log.push(`TravelTable created (${H.length} columns)`);
  } else log.push("TravelTable already there");

  console.log(log.join("\n"));
}
