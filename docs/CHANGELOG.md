
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
