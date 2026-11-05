
## 2026-10-30 — Engagement Calendar: price breakup + travel billing columns
- New EC columns read/written: PM Cost (INR), Material Cost (INR), Other Cost (INR), Other Cost Details, Price Comments, Travel Invoice Raised, Travel Invoice Date, Travel Amount Received, Travel Received Amount (INR), Travel Received Date. Facilitation Fee (INR) = Excel formula, read only (never written).
- Columns are sent on every EC write (create, EC edit form, finance saves, BD checklist sync) only once a read shows they exist in Excel — safe before the Excel/flow change.
- Finance Tracker panel: "Price Breakup" (costs, auto facilitation fee, red when negative, price comments) and "Travel, Stay & Misc Billing" (invoice raised/date, received/amount/date, balance; auto Yes/Partly). Export includes the new columns.
- Files: services/api.js (EC_EXTRA_COLS, ecExtraFields, ecHasExtraCols), services/syncWithEC.js, pages/FinanceTracker.jsx, pages/EngagementCalendar.jsx. Backup: Claude outputs/backup-2026-10-30-ec-price-breakup/.
- Manual: Engagement calendar CRUD 2 → Create + Update a row: map the 10 new columns (not Facilitation Fee).
- Update (23:59): Price breakup (PM / Material / Other cost, details, Price Comments) moved to the Engagement Calendar edit form + details (facilitation fee shown, red when costs exceed price); removed from the Finance Tracker. Travel billing stays editable in the Finance Tracker and shows locked / read-only in the Engagement Calendar. EC_FINANCE_FIELDS now holds only the travel keys, so an EC form save never overwrites travel billing and a finance save keeps the price breakup.

## 2026-11-02 — Finance Tracker: whole engagement list + FY / month filters
- Finance Tracker now loads the full Engagement Calendar (getAllEngagementsCached / peekAllEngagements) instead of a 1–12 month window.
- Replaced ◀ ▶ / Today / span picker with: FY select (All years + FYs from session start dates, Apr–Mar, saved per browser), Month select (months of the chosen FY, or all), "This month" shortcut.
- Rows with no start date appear only under All years + All months. KPI cards, export name and empty-state text follow the selection.
- Files: src/pages/FinanceTracker.jsx. Backup: Claude outputs/backup-2026-11-02-finance-all.tgz. No manual setup.

## 2026-11-02 — Invoice No (Engagement Calendar)
- New EC column "Invoice No" (one invoice can cover several engagement rows). Read as `invoiceNo`; written in every EC save only once the column is seen in a read (`ecHasInvoiceNo`, via `ecExtraFields`).
- Finance Tracker: editable Invoice No (autosave), shown in list ("Invoiced dd-mmm · INV…"), searchable, exported. Part of EC_FINANCE_FIELDS (fresh-read / lock rules apply).
- Dashboard Finance: "No. of Invoices Raised" + monthly invoice counts = distinct Invoice No (fallback Company + Invoice date). suspectReceipts groups rows by Invoice No (`invoiceNoOf` in money.js).
- Files: api.js, syncWithEC.js, money.js, FinanceTracker.jsx, FinanceLiveDashboard.jsx. Backup: Claude outputs/backup-2026-11-02-invoice-no.tgz.
- Pending: add "Invoice No" column to EC Excel table; map it in ENGAGEMENT_CRUD Add a row + Update a row.

## 2026-11-02 — Finance Tracker: Next up
- List auto-scrolls the next upcoming / ongoing engagement (earliest start, not ended, not cancelled) to the middle on load and on FY / month change; orange "⏭ Next up" tag + outline, "⏭ Next up" button in the filter bar (same as Engagement Calendar). File: FinanceTracker.jsx.

## 2026-11-02 — Finance dashboard: Revenue incl. GST + TDS card
- Total Revenue card = Price + GST (travel excl.), same basis toggle as before. Monthly / FY charts unchanged (price excl. GST, fixed years from report).
- Collection unchanged: Amount Received − travel & stay, capped at invoice value.
- New card "TDS (Not Credited)" = 10% of Price on Revenue rows; sub-line Collection + TDS + to collect = Revenue. KPI row now g4 (4 cards).
- File: FinanceLiveDashboard.jsx. Backup: Claude outputs/backup-2026-11-02-rev-gst-tds.tgz.
- Invoice count: an Invoice No cell holding several numbers ("ER/013/26-27, ER/026/26-27") now counts each number (FY 26-27: 52 → 53).

## 2026-11-02 — Engagement Calendar in Start Date order
- List default order = Start Date ↑, End Date ↑, Index ↑ (Filters column sort still overrides). File: EngagementCalendar.jsx.
- Office Script docs/office-scripts/SortEngagementCalendar.ts sorts EngagementMasterTable the same way; S No (=ROW()-1) follows. Index untouched.
- Pending: save script in Excel Online; ENGAGEMENT_CRUD → "Run script" after Response in create + update branches. Backup: Claude outputs/backup-2026-11-02-ec-date-order.tgz.
- Finance Tracker list also sorted by Start Date first (then S No).

## 2026-11-04 — Finance: Pro bono + overdue pending amount
- "Pro bono" in Payment / Contract / PO Status / Status / Price / Comments → stage Not Applicable; never invoice/payment overdue (`isProBono`, financeStage, overdueDays).
- Overdue filters (Needs Action, Invoice Overdue, Payment Overdue, Overdue 30+) show "Pending ₹…" on Engagements / To Invoice / Awaiting Payment cards (balance = Total to Receive − Amount Received).
- File: src/pages/FinanceTracker.jsx. Dashboard / Founder's Desk use financeStage/overdueDays, so they follow.
- 2026-11-04 (b): Payment Status "Pro Bono" option (normPayment; Ops copy → NA); stage "Pro Bono"; NA / Pro Bono / Cancelled → totalOf 0 (not billed). New "Not Billed" card + filter. Card tap filters list (under overdue filters: To Invoice → Invoice Overdue, Awaiting → Overdue 30+), highlights active card, scrolls list to top. Files: FinanceTracker.jsx, syncWithEC.js.

## 2026-11-04 — Revised proposals: older version = Lost, drop-only value
- Saving V2 (or any save on a proposal) sets BD Status / item status of older versions to Lost in Excel; editing an older version keeps it Lost; latest version keeps its own status (propagateBdFields statusFor).
- Calculations (proposalData buildProposalLines + BD Tracker KPIs): replaced version = Lost, value = max(0, own − next version). E.g. V1 10L → V2 12L Won: Won 12L, Lost 0; V2 8L: Lost 2L. Applies to bdValue and solValue. Fields added: replaced, bdFull, solFull. Lost card shows lost value.
- Existing Excel rows: older versions still holding Won / In Process show as Lost in all figures; Excel updates on the next save of that proposal.
- Files: src/components/proposalData.js, src/pages/SolutionTracker.jsx.
- 2026-11-04 (b): Lost value of a replaced version = max(0, own − LATEST version) (was next version). Lost proposal with no earlier version = full value. Latest Won → only latest Won, earlier versions Lost.

## 2026-11-04 — Operations dashboard
- EC rows with Index / S No and dates TBD count as upcoming in the current FY (not stale).
- FY table, consultant and client charts calculated from the Engagement Calendar for every year; fixed baseline only for a year with no delivered EC rows.
- New Consultant Days / Client Status year-on-year grouped charts (last 3 FYs + current incl. upcoming, top 15) replace the per-year mini charts.
- Recent Program Feedback: overall average of scored sessions; table of sessions latest first, last-7-days delivered at top (highlighted, "Awaited" if no score), scroll for earlier.
- File: src/components/OpsLiveDashboard.jsx.
- 2026-11-04 (c): Solutioning tab Solutions card shows unique solutions (distinct Solution Topics; proposalData solTopics). SALES_TARGETS FY26 Q4 = 81L (was null).

## 2026-11-04 — Finance dashboard
- To be Raised = delivered / ended, no Invoice date (Pro Bono / NA / Cancelled excluded). Total Due in Market = To be Raised + Yet to Receive + Overdue. Collection = sum of Amount Received in the period.
- Outstanding Payments Due = overdue invoices (client, program, invoice no., dates, amount, past due days). Invoice-Level Breakdown = invoices awaiting payment within credit period. Invoice & Payment Summary card removed.
- File: src/components/FinanceLiveDashboard.jsx.

## 2026-11-04 — Dashboard click-through lists
- New src/components/KpiListModal.jsx: list popup (search, status badge, amount), egItem / propItem, DrillContext + drillItems.
- KPI cards (Kpi in erdCharts, KPICard) take `list`; wired on Overview (4), Operations (4), Sales (5), Solutioning (5), Finance (8) — the list uses the same rows as the card.
- Every ChartBox: tapping a bar / point / slice opens the matching engagements or proposals (FY, month, quarter, status, delivery mode or name of client / consultant / industry); falls back to the point values. Per-chart override: `listFor(label, series, value)`.
- Dashboard.jsx wraps each tab in DrillContext (EC rows; BD lines for Sales / Solutioning).
- Build not run here (Windows node_modules: rollup native binary missing in the VM) — run `npm run build` locally.
- 2026-11-04 (d): Popup lists — double-tap an engagement row → /engagement opens its Edit form (state editEc); a proposal row → /bd-tracker opens that version's BD Edit form (state editBd). Needs edit rights. Files: KpiListModal.jsx, EngagementCalendar.jsx, SolutionTracker.jsx.
- 2026-11-04 (e): Popup lists — "Excel" button top-right downloads the shown list (search applied): engagement columns (S No, Index, EG ID, client, program, dates, consultants, location, status, price, invoice, payment, received, feedback, list amount) or proposal columns (P.ID, version, client, topic, date, status, BD / Solution value, topics, industry, type). Logged as EXPORT. File: KpiListModal.jsx.

## 2026-11-04 — Credit notes, travel / cancelled invoice nos, PO Tracker
- EC columns (api.js EC_BILL_COLS, own flag ecHasBillCols): Travel Invoice No, Cancelled Invoice No, Credit Notes (JSON [{no,date,amount,reason}]), Credit Note Total (INR). Written on every EC save once Excel has them; Finance Tracker panel edits them (credit-note list add/remove).
- money.js: creditNotesOf / creditTotalOf; expectedOf (dues, balance) now minus credit notes.
- Finance dashboard: invoices = program + cancelled; travel invoices and credit notes in the sub-line; Credit Notes table live from EC (fixed FIN_CREDIT_NOTES only when none recorded).
- New PO Tracker /po (POTracker.jsx, poApi.js): POTable, key PO ID; Engagement Index list; Used = Σ Price of linked EC rows; Balance; status Active / Fully Used / Expired / Closed; Finance panel shows the PO + balance.
- Permissions: page po (prefix PO) — POCreate / PORead / POUpdate / PODelete.
- Pending: PO_CRUD flow + URL, ENGAGEMENT_CRUD mapping of the 4 columns, 4 PermissionsTable columns + Save Permissions mapping.
- 2026-11-04 (f): "🧾 PO Tracker" button in Finance Tracker header and BD Tracker (BD view) header, shown with PO view access; Finance panel PO link opens /po?po=<PO ID> in the app.
- 2026-11-04 (g): Sales dashboard Order Book reads the PO Tracker (PO value, delivered / confirmed = Price of linked EC rows by Index, balance; Closed hidden). No fallback: empty until POs are recorded. File: SalesLiveDashboard.jsx.

## 2026-11-04 — Shared pickers + Client Directory clean-up (branch feature/pickers)
- New `services/directoryCache.js` (clients, contacts, consultants, past vendors, proposals; loads once, refreshes after quick-add), `config/clientAliases.js` (Arcellor Mittal, CJ Darrcl, SocGen, Avery Dennisen; not-a-client names; consultant placeholders), `components/pickers/` (EntityPicker + Client, Contact, Consultant, Team, Vendor, Proposal pickers, New client / New contact forms), `styles/pickers.css`.
- Typing still saves free text ("Not in directory" chip). Related fields fill only on a pick, never with an empty value. Quick-add only ADDS a Client Directory row (fresh read → next CL-/CT- ID; existing name/variant reused). Consultants: no quick-add.
- Wired: Leads (Company + "Add to Client Directory" tick, Contact fills designation/email/phone, Shared By / Owner / Actioned by), BD (Client, POC fills number/email/designation, Additional POCs, "Save to contacts" tick; lead moved to BD adds its client), EC (Company → Sector, Consultant 1/2, proposal → Proposal Link), Ops (Company, Client SPOC, Internal POC, task POCs, Invoice POC, Consultant 1–3), PO (Client, SPOC, Proposal ID), Vendors (Client, Vendor Name, Requested By), Content Dev (Client, POC), Projects (Client), Client Directory (owners, Facilitators, BD Proposal ID), Consultant Directory (Relationship Owner).
- Client Directory → "🧹 Clean-up" tab (admin only): unmatched client names (Add as client), BD POCs not in contacts (Add contact), EC consultants not in the Consultant Directory (list). "Fix spelling everywhere" behind a switch OFF on every page load; fresh read, every row listed, typed CONFIRM, sends only the row key + the one name column per row.
- BD Industry not auto-filled (BD form has no Industry field). Consultant "Notable Clients" left as free text (holds non-EuRadicle clients).
- Files changed: clientsApi.js (readTableFresh), LeadTracker, SolutionTracker, EngagementCalendar, OpsChecklist, POTracker, VendorTracker, ContentDevelopmentTracker, TaskTracker, ClientDirectory, ConsultantDirectory. No Excel or flow changes.
- Verified: vite build; test/directoryCache.test.js 9/9; browser harness with fake flows (pickers, auto-fill, quick-add client/contact, near-duplicate warning, clean-up fix sends {company, Index} only) at 1440 / 390.

## 2026-11-05 — Sales dashboard
- Removed the "Proposal Status — FY" month-wise table; the Monthly Proposal Status charts show the same data. File: src/components/SalesLiveDashboard.jsx.

## 2026-11-05 — Client Directory update/delete: send `keyColumn`
- CLIENTS_CRUD flow's Update/Delete use Key Value `triggerBody()?['keyColumn']`; CRM now sends `keyColumn` (= record ID) alongside `sno` on update and delete.
- `keyColumn` added to audit meta keys (not logged as a field change).
- Files: src/services/clientsApi.js, src/services/api.js. Backup: Claude outputs/backup-2026-11-05-clients-keycolumn.tgz
- Manual (flow): Update a row → item must remove 'keyColumn' and must NOT call removeProperty on '@odata.etag' (dotted names are rejected → InvalidTemplate).
