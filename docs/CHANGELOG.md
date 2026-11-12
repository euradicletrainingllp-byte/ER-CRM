
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

## 2026-11-05 — Market due fix: "Unpaid" read as Received; GST 0 respected
- `src/services/syncWithEC.js` normPayment: "Unpaid" / "Not paid" / "Not received" now = Invoice Raised (before, the "paid" match made them Received, dropping ~Rs.21.7L of open invoices from Finance dashboard dues and sending Received = Yes to Ops Checklist).
- `src/services/money.js` gstOf: GST typed as 0 = no GST (Ford, DBS); blank still = 18% of Price.
- Backup: `Claude outputs/backup-2026-11-05-unpaid-gst/`. Not pushed; vite build to run locally (Windows node_modules).
- Manual: Engagement Calendar updates (DBS ER/069–070 re-invoice, Ford ER/066–067 invoice dates, GST 0 for Ford/DBS, travel invoice nos, Vertiv / Air India invoice dates).
- `src/components/FinanceLiveDashboard.jsx`: Total Due in Market = Raised within Timeline – Yet to Receive + Overdue; To be Raised no longer added (value, list, sub-text, "How" note).
- `FinanceLiveDashboard.jsx` card rules: Raised = Invoice date / Invoice No / Payment Invoice Raised or Partly Received. To be Raised = not raised (ended/delivered). Yet to Receive = raised, Invoice date + 30 days not crossed (no date = not crossed). Overdue = raised, due date crossed. Closed = Received / Cancelled / NA / Pro Bono. "How" notes updated.

## 2026-11-05 — Sales dashboard re-layout
- Sales tab grouped into three source bands: BD Tracker → Engagement Calendar → Clients (KPIs split per band).
- Expected Major Pipeline: every In Process proposal (latest version, any FY), scrollable chart; proposals without a BD value listed below.
- Monthly Revenue Key Clients: table → stacked bar (top 8 clients + Others, month total on top).
- Client Engagement by FY: table → Returning vs New stacked bar + per-FY client chips (new clients highlighted, live years).
- Quarterly Targets table moved beside its chart; long lists scroll inside their card (pipeline, order book, chips).
- Files: src/components/SalesLiveDashboard.jsx, src/components/erdDashboard.css. Backup: backups/sales-dash-*.tgz
- Manual setup pending: none.

## 2026-11-05 — Finance Tracker amount cards
- KPI row now shows amounts, counts as tag lines: Total Revenue (price, hero) · To be Raised (Price+GST+travel) · Billed Yet to Receive · Billed Overdue (balance = Price+GST−TDS+travel − received) · Collected (Received Date in period) · Not Billed.
- Added a revenue flow bar (to raise / yet to receive / overdue / collected). Cards still filter the list.
- Files: src/pages/FinanceTracker.jsx, src/styles/index.css. Backup: backups/finance-kpi-*.tgz

## 2026-11-06 — Finance dashboard: receivables, pending billing, credit notes visuals
- Outstanding Payments Due + Invoice-Level Breakdown → "Receivables by Client": ageing tiles + stacked bar per client (within credit / 1–30 / 31–60 / 60+); tap = engagements list; double-tap = open in Finance Tracker.
- To be Invoiced → stacked bars per client by days since last session; same tap / double-tap.
- Credit notes only from the Finance Tracker "Credit Notes" field (fixed Excel list dropped); cancelled invoices shown as tags grouped by client.
- Finance Tracker reads the hand-off (sessionStorage ercrm.fin.open): selects the engagement, sets its FY, scrolls to it.
- Files: src/components/FinanceReceivables.jsx (new), FinanceLiveDashboard.jsx, erdDashboard.css, src/pages/FinanceTracker.jsx. Backup: backups/finance-receivables-*.tgz

## 2026-11-06 — Sales dashboard: Clients section redesign
- New src/components/SalesClients.jsx: 4 tiles (unique, active vs last FY, new, top-client share) · ranked Revenue by Client (delivered/scheduled, tap → month strip) · Client Mix doughnut (top 6 + Others) · Client Growth (returning/new + total line) · Client Roster tabs per FY.
- Removed old key-clients stacked chart, FY chart + chip list and the single Total Unique Clients card.
- Files: SalesClients.jsx (new), SalesLiveDashboard.jsx, erdDashboard.css. Backup: backups/sales-clients-*.tgz

## 2026-11-06 — Solutioning dashboard rebuilt (L&D view)
- Last FY (fixed report) now compared only by pace (running total, same months) and % share mix — no more full-year vs part-year bars. Tracker data replaces the fixed numbers automatically once FY 2025-26 rows are added.
- New: 6 KPIs (proposals YTD vs same date last FY, win rate, avg value, turnaround, IP reuse, journey share) · scope switch (this FY / all) · What We Win by 6 dimensions · Portfolio Mix % (count/value) · Industry × Category heatmap · Turnaround & on-time · Process health (versions, V1→final value) · IP library · Open pipeline age · Data gaps.
- Removed the old count/value pair charts and FY pipeline summary.
- Files: src/components/SolLiveDashboard.jsx (rewritten), erdDashboard.css. Backup: backups/sol-dash-*.tgz

## 2026-11-06 — Tap-to-list + double-tap-to-edit on Solutioning, Sales and Finance dashboards
- KpiListModal: shows "How this is calculated" (from the card / chart), double-tap works on phones (two taps < 400 ms), rows highlight on tap.
- Solutioning: every KPI, chart bar, win row, heatmap cell, process stat, IP topic, pipeline band/row and data-gap tile opens its proposal list → double-tap opens the BD edit form.
- Sales: proposal / funnel / pipeline / revenue / quarterly / target charts, targets table and PO rows list their records; Clients section tiles, client rows, month bars, doughnut, growth chart and roster tiles list sessions → double-tap opens the Engagement Calendar edit.
- Finance: KPI lists and Revenue / Invoices / Billing-days charts open the Finance Tracker edit (router state openFin).
- Files: KpiListModal.jsx, erdCharts.jsx, SolLiveDashboard.jsx, SalesLiveDashboard.jsx, SalesClients.jsx, FinanceLiveDashboard.jsx, FinanceTracker.jsx, erdDashboard.css. Backup: backups/drill-*.tgz

## 2026-11-06 — Solutioning: Portfolio Mix redesign
- 100% stacked bars replaced by one row per category: paired bars (last FY grey · this FY teal) with % labels, change chip (▲/▼ pts, NEW), biggest gain / drop chips, top 8 + Others / not recorded. Tap a row → this FY's proposals.
- Files: SolLiveDashboard.jsx, erdDashboard.css. Backup: backups/sol-mix-*.tgz

## 2026-11-06 — Collapsible sidebar
- Toggle (PanelLeftClose/Open) at top of sidebar collapses it to a 56px icon rail; labels show as tooltips. State saved per browser (ercrm.sidebar.collapsed.v1).
- Files: src/components/Sidebar.jsx, src/styles/index.css. Backup: backups/backup-2026-11-06-sidebar-collapse.tgz

## 2026-11-07 — Sales: EC revenue KPIs, roster New tags for past years
- Sales tab: 4 KPI cards under the Engagement Calendar band — FY revenue, Delivered, Scheduled, This month (+ quarter). Tap = session list.
- Client Roster: baseline years (FY20-25) now tag New clients (first year a name appears); note shown when tags differ from the report count.
- Files: SalesLiveDashboard.jsx, SalesClients.jsx. Backup: backups/backup-2026-11-07-sales-ec-kpi.tgz

## 2026-11-07 — Client Roster reads Client Directory only
- Roster tabs = "Client Since (Year)" values (FY start year; "FY 22-23" also accepted); each tab lists clients acquired that year. Session/revenue sub-line still matched from EC for years with sessions.
- Caption shows count of directory clients with no Client Since year.
- File: SalesClients.jsx. Backup: backups/backup-2026-11-07-roster-directory.tgz
- Revised: roster tab per FY = EC/baseline clients + directory clients with that Client Since (New); "All" tab = whole Client Directory with this FY sessions (0 if none).

## 2026-11-07 — Solutioning on solution items; Proposal Pace moved to Sales
- Solutioning tab: every KPI/chart counts solution items (rows with a Solution Topic, per version); item keeps its own Dev Category / Line / Type of Service / Engagement Type / Solution Value; date, FY, status from its proposal line. Pace renamed "Solution Item Pace". Fixed report (proposal counts) no longer used there; last FY = tracker rows only. Turnaround / Process Health / IP reuse stay per proposal.
- Sales tab: Monthly Proposal Status (Count) now carries running-total lines this FY vs last FY (BD lines, else report monthly).
- proposalData.js: lines expose itemRows.
- Files: SolLiveDashboard.jsx, SalesLiveDashboard.jsx, proposalData.js. Backup: backups/backup-2026-11-07-sol-items.tgz
- Revised: Solutioning counts UNIQUE solutions = Proposal ID + Solution Topic, once (highest version carrying it); repeats across versions/rows dropped.
- Revised: Solutioning has a "Count: Solution items | Proposals" toggle; every KPI/chart (pace, win, mix, heatmap, pipeline age, gaps) switches. Proposal view uses latest versions/lines and the fixed report for last FY.
- Solutioning drill lists: new solItem() (KpiListModal) — rows show solution items (or proposal lines in Proposals view); double-tap opens /solution (editSol state → expands line + opens that item's Edit form) instead of BD Tracker. Removed BD fallback DrillContext on the Solutioning tab. Files: KpiListModal.jsx, SolLiveDashboard.jsx, SolutionTracker.jsx, Dashboard.jsx.
- Fix: unique-solution dedupe now only drops a topic repeated in a LATER version of the same Proposal ID (keeps highest version); rows within one version are never merged. YTD KPI sub shows tracker rows vs repeats removed.

## 2026-11-07 — Operations dashboard rebuilt (intelligence view)
- 6 KPIs (Delivered vs last FY same date, Training days, Participants/Clients served, Next 30 days + not-ready tag, Feedback avg + awaited, Consultant load).
- Insight cards (stale status, not-ready sessions, overloaded consultant, quiet clients 90d, feedback awaited, feedback < 4, pace vs LY, busiest week) — tap = list.
- Readiness table next 30 days (red/amber/green flags), Delivery rhythm (monthly delivered/booked vs LY), day heatmap, Consultant load (stacked, 1.5x avg flag), Client portfolio (sparklines), Mode donut, Service mix, Feedback by program; History section collapsed (old charts + feedback log).
- api.js: EC rows read No of Participants as pax (0 if the column is absent).
- Files: OpsLiveDashboard.jsx, erdDashboard.css, api.js. Backup: backups/backup-2026-11-07-ops-dashboard.tgz
- Ops feedback redesigned: "Program Quality" card (score ring + trend vs LY + % 4.5+, score-spread bands, Needs attention < 4.0 + low-score chips, Top performers 4.5+, awaiting-feedback button). Removed Feedback-by-Program chart and History feedback log.
- Ops 3-year + projections: projection strip (Projected FY = max(Delivered YTD ÷ YTD share, Delivered + Booked); YTD share = avg share of last 3 FYs done by today; CAGR; projected days). Rhythm: this FY delivered/booked/projected bars + last 3 FYs lines. Calendar: FY selector (3 FYs). Consultant load: FY-2, FY-1, this FY delivered/booked/projected. Client portfolio: FY-2, FY-1, projected + trend vs LY. Mode: % stacked by 4 FYs. Service mix: grouped by 3 FYs. Quality: FY averages. History trend: projected bar. Backup: backups/backup-2026-11-07-ops-3yr.tgz
- Ops projections explained: every projection opens a worked calculation with real numbers (strip tiles "How?", projected month bars, consultant projected segment, client Projected cell, history projected bar).
- Ops projections removed for now (strip, projected bars/segments, client Projected column, explanations); 3-year history kept. Client table Total = done + booked with ▲▼ vs last FY.

## 2026-11-08 — Solutioning & Ops dashboard tweaks
- Solutioning dashboard: removed Avg Turnaround KPI (row now 5 KPIs), Turnaround & On-time chart, and Process Health "Discussion → Sol team" / "Sol team → Client" boxes. Process Health now full width.
- Ops dashboard: "Delivery Readiness — Next 30 Days" replaced by two side-by-side lists — Scheduled (today → 7 days, with readiness flags) and Delivered (last 7 days, with feedback).
- Files: src/components/SolLiveDashboard.jsx, src/components/OpsLiveDashboard.jsx
- Manual setup: none.

## 2026-11-08 — Ops dashboard: Feedback N/A = not required
- Sessions with Feedback "N/A" (also NA / Not required / Not applicable) are now excluded from feedback averages and from awaited / missing-feedback counts (KPI, Program Quality, 60-day insight, feedback log, Delivered — Last Week shows "N/A").
- Files: src/components/OpsLiveDashboard.jsx

## 2026-11-09 — Finance dashboard: invoice count
- No. of Invoices Raised = invoices raised − credit notes − cancelled invoices.
- Raised = distinct program Invoice No (no number → Company + Invoice date) ∪ Cancelled Invoice No. Each cancelled / credit-note number counts once even when typed on several program rows (numbers matched ignoring case and spaces).
- FY summary row uses the same rule. Cancelled invoices list shows one entry per number (programs merged).
- File: src/components/FinanceLiveDashboard.jsx. Parse-checked; full build not run. Backup: backups/backup-2026-11-09-invoice-count/.
- 2026-11-09 (later): invoice total reverted to program + cancelled (not already a program number). Credit notes deduplicated like cancelled invoices: same number on several programs counts once (KPI count + value, Credit Notes list merged, amount taken once).

## 2026-11-09 — Credit note counted once across its line items
- One credit note typed on several rows (same Credit Note No, or same Company + Invoice No + Credit Note Total) is now deducted once, spread over those rows by amount (Price + GST − TDS + Travel). Before, the full amount came off every row.
- money.js: applyCreditShares(list), creditAppliedOf(e); expectedOf uses the row's share (falls back to its own total if the row's credit notes were edited since).
- Applied in: FinanceLiveDashboard (Yet to Receive / Overdue / Total Due in Market), FinanceTracker (rows + amount cards), FounderDashboard (cashSummary, cashForecast).
- Parse-checked; full build not run. Backup: backups/backup-2026-11-09-credit-share/.
- 2026-11-09 (later): Finance dashboard dues (Yet to Receive / Overdue / Total Due in Market) no longer deduct credit notes — balance = Price + GST − TDS + Travel − Amount Received. Finance Tracker unchanged.
- 2026-11-09 (later): Finance dashboard Yet to Receive / Overdue now include TDS — balance = Price + GST + Travel − Amount Received; Total Due in Market = sum of both.

## 2026-11-09 — GST auto-calculated and written to the Engagement Calendar
- Rule (src/services/gstRule.js): Price > 0 → GST = 18% of Price, recalculated on every save; GST typed as 0 = billed without GST, never overwritten; Price 0 (travel-only) → GST as typed.
- api.js: blank GST cell now read as '' (to be calculated), not 0. Engagement Calendar form save and Ops→EC sync write gstForExcel(); Finance Tracker save already wrote 18% when different.
- Writing a value replaces the Excel formula in that GST cell.
- Pending (Finance): type 0 in GST on DBS / Ford rows that are blank (88 rows) — until then they count 18% GST (≈ ₹14.07L across all years); open dues unaffected.
- Backup: backups/backup-2026-11-09-gst-auto/. Parse-checked; full build not run.
- 2026-11-09 (later): Finance Tracker GST is editable — dropdown Auto (18% of Price) / No GST (0, locked); saved to the EC GST column. File: FinanceTracker.jsx.
  syncWithEC.js: GST blank and 0 no longer treated as equal when comparing/saving (blank = auto, 0 = locked).

## 2026-11-09 — Finance Tracker: travel payments highlighted
- Travel, Stay & Misc counts as pending when travel is billed (Travel Invoice Raised = Yes / Travel Invoice Date / Travel Invoice No), Travel Amount Received is not Yes / NA, and Travel Received Amount < travel. Overdue = Travel Invoice Date (else Invoice date) + 30 days crossed.
- List rows: amber highlight + "✈ TRAVEL PENDING · ₹x"; red highlight + "✈ TRAVEL OVERDUE · Nd · ₹x" — also on rows whose program payment is Received. Same tag in the detail header.
- Filters Needs Action / Overdue (30+ days) / All Awaiting Payment include travel pending / overdue. Amount cards unchanged.
- File: src/pages/FinanceTracker.jsx. Parse-checked.

## 2026-11-09 — Content Development Tracker: one click selected every row
- Cause: selection, row keys and the local save patch used S No; blank / repeated S No cells in Excel made every such row match.
- Fix: rows keyed by Index + sheet position (rowKeyOf) for selection, list keys, pending / reminder bars, local save patch and delete; detail panel remounts per row. Excel writes still use S No + Index as before.
- File: src/pages/ContentDevelopmentTracker.jsx. Parse-checked.

## 2026-11-09 — Finance dashboard: travel billed separately is its own due
- Rows with Travel Invoice No / Date / Raised = Yes: program due = Price + GST − Amount Received (closed by Payment Received); travel due = Travel − Travel Received Amount, closed by Travel Amount Received = Yes / NA, due Travel Invoice Date (else Invoice date) + 30 days — counted even when the program is Received.
- Rows without a separate travel invoice: unchanged (Price + GST + Travel − Amount Received).
- Lists show "✈ Travel" parts. Files: FinanceLiveDashboard.jsx, FinanceTracker.jsx (travelBilled export). Backup: backups/backup-2026-11-09-travel-dues/.

## 2026-11-09 — Finance dashboard: Total Revenue = Price only
- Total Revenue KPI and its list now sum Price (INR) — GST and travel excluded (same basis as the Revenue by FY chart). TDS card identity now reads Collection + TDS + still to collect = Price + GST. File: FinanceLiveDashboard.jsx.

## 2026-11-10 — Win rate = Won ÷ total (Dashboard → Solutioning)
- Win rate is now Won ÷ (Won + Lost + In Process); before it was Won ÷ (Won + Lost).
- Applies to: Win Rate card (and last-FY comparison), What We Win table, Industry × Category dots, IP Library topics. "How" notes updated.
- File: `src/components/SolLiveDashboard.jsx`. Parse-checked; build not run.
- Not changed: Founder's Desk win rate / pipeline cover, BD & Solution Tracker KPI, Lead conversion %.

## 2026-11-10 — Dashboard → Operations layout
- Session Calendar: full row, this FY + previous 2 FYs one below the other (FY switch removed).
- Program Quality (feedback): half width, next to Delivery Rhythm.
- Delivery Rhythm: previous-FY lines no longer stack on each other (each line now reads on the axis scale).
- Client Portfolio: full row, height limit / scroll removed.
- Service Mix — by FY removed. Delivery Mode now sits beside Consultant Load.
- Files: `src/components/OpsLiveDashboard.jsx`, `src/components/erdDashboard.css`. Parse-checked only; build and screenshot not run (Linux VM lacks the rollup binary).
- Consultant Load: grouped bar chart replaced by a ranked list (previous 2 FYs as numbers, this FY one delivered + booked bar, average marker, total + ▲▼ vs last FY). Delivery Mode chart fills the card height.

## 2026-11-10 — Operations → Client Portfolio redesign
- Table replaced by: insight tiles (top-3 share, growing, declining / at risk, nothing booked, new — tap to filter), sort chips, and rows with status tag, 3-FY mini bars, this-FY done + booked bar, growth (× or %), feedback pill, next session with days to go, wider monthly spark.
- Files: `src/components/OpsLiveDashboard.jsx`, `src/components/erdDashboard.css`. Parse-checked only.

## 2026-11-11 — Operations: Financial year picker
- "Financial year" switch (current FY and the two before; default current, not saved). The whole tab follows it; a closed FY is shown as at 31 Mar, with a note and a "Back to current" button.
- `OpsLiveDashboard` is now a wrapper holding the FY + Count-by state; the tab body (`OpsLiveInner`) is remounted per FY.
- Files: `src/components/OpsLiveDashboard.jsx`, `src/components/erdDashboard.css`. Parse + scope checked only.

## 2026-11-12 — Client Directory: Client 360 + names not in the directory
- Profile page: "Live from the trackers" numbers (sessions, next session, proposals, business / outstanding, feedback) and tabs — Overview · Engagements · Proposals · Leads · Finance (Finance viewers) · Delivery (Ops + Content) · Vendors & POs · Tasks. Read-only, each with "Open <tracker>". Overview shows alerts (overdue payment, to invoice, ended not Delivered, low readiness, open proposals / leads, no next business).
- New tab **Not in directory** (+ coral banner on the Clients grid): client names used in EC / BD / Leads / Ops / CDT / Vendors / PO / Tasks with no profile; closest client with match %; Link · Create profile (pre-filled from tracker rows) · hide (per browser).
- Near-name highlights (gold): on the profile ("Ashiana" looks like this client → link), on cards, in Add / Edit client, quick filter "Similar names".
- Matching: Client Name, Legal entity, new **Also Known As** field, `config/clientAliases.js`, and suffix-only differences (Ltd / Pvt Ltd / India) when one client fits. `'Ashiana' → 'Ashiana Housing'` added to clientAliases.js (no tracker row changed).
- Files: new `src/services/client360.js`, `src/components/Client360.jsx`, `src/styles/client360.css`; changed `ClientDirectory.jsx`, `clientsApi.js` (optional column, `aliasColumnReady`), `directoryCache.js` (aliases in byKey), `clientAliases.js`.
- Checks: Babel parse + undefined-name check on all changed files; matching engine run on mock data. Build and screenshot not run (Linux VM lacks the rollup binary) — run `npm run build` and check `/clients` before pushing.
- Manual setup pending: add column **Also Known As** to ClientTable (Client_Directory.xlsx). Until then Link buttons are disabled and saves are unchanged; the Ashiana link already works from the config list.
- Backup: `Claude outputs/backup-2026-11-12-client-360/`.
- 2026-11-12 (later): Client 360 "Business to date" (delivered only) → "Total business" = Price of every session except Cancelled / Dropped; sub-line shows delivered, not yet delivered, cancelled excluded. Files: client360.js, Client360.jsx. Parse-checked.

## 2026-11-12 — Consultant Directory: Consultant 360 (journey with EuRadicle)
- Profile page: live strip + tabs — Profile (existing sheet) · Journey (FY-by-FY sessions / days / clients / feedback, milestones, alerts) · Engagements · Clients · Programs · Revenue (admins + Finance viewers) · Delivery (Ops Checklist). Read-only.
- Source: Engagement Calendar Consultant 1 / 2 / 3 (a cell may hold several names) + Ops Checklist. Revenue = Price (INR) of delivered sessions, split equally when a session names several consultants; booked shown separately. No payout / fee figures (no per-session payout data).
- Name matching: full name, `CONSULTANT_ALIASES` (config/clientAliases.js), or the only consultant whose name contains every typed word. Banner on the list for calendar names with no profile.
- Files: new `src/services/consultant360.js`, `src/components/Consultant360.jsx`; changed `ConsultantDirectory.jsx`, `Client360.jsx` (shared exports), `client360.css`, `clientAliases.js`.
- Checks: Babel parse + undefined-name check; summary engine run on mock data. Build and screenshot not run — run `npm run build` and check `/consultants` before pushing. Manual setup: none.
