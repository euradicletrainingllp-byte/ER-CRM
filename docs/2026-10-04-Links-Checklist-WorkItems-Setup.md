# Setup: Proposal Link, BD Ops Checklist, CDT Work Items, Open-Link Buttons (2026-10-04)

The React code is done. These features store data in **new Excel columns**, so each
column must be (1) added to the Excel table and (2) mapped in that tracker's Power
Automate CRUD flow ("Add a row" + "Update a row" actions; "List rows" picks new
columns up automatically). Until a flow is updated, the app works but the new value
is not saved to Excel.

| Excel file / table | New column header (exact) | Flow | Map in Add + Update to |
|---|---|---|---|
| Solutioning_Tracker.xlsx → Table1 | `Ops Checklist` | SOLUTION_CRUD | `triggerBody()?['Ops Checklist']` |
| ER Engagement Calender_Master.xlsx → EngagementMasterTable | `Proposal Link` | ENGAGEMENT_CRUD | `triggerBody()?['Proposal Link']` |
| ER Engagement Calender_Master.xlsx → EngagementMasterTable | `Ops Checklist` | ENGAGEMENT_CRUD | `triggerBody()?['Ops Checklist']` |
| Operations Checklist.xlsx → Table2 | `BD Checklist` | OPS_CHECKLIST_CRUD | `triggerBody()?['BD Checklist']` |
| Content_Development_Tracker.xlsx → Table1 | `Content Assets` | CONTENT_DEV_CRUD | `triggerBody()?['Content Assets']` |
| Content_Development_Tracker.xlsx → Table1 | `Pre-Work` | CONTENT_DEV_CRUD | `triggerBody()?['Pre-Work']` |
| Content_Development_Tracker.xlsx → Table1 | `Post-Work` | CONTENT_DEV_CRUD | `triggerBody()?['Post-Work']` |

Notes
- Add the columns at the **right-hand end** of each table so existing formulas keep working.
- Ops Checklist "Update a row": the app sends only changed fields — map `BD Checklist`
  with an `if(empty(...), <keep>, ...)` pattern the same way the other OC columns are mapped.
- Engagement "Update a row" overwrites the whole row; the app now always sends
  `Proposal Link` and `Ops Checklist`, so mapping them is safe.
- Value formats: checklists are readable labels joined by `; `
  (e.g. `Participant Manual; Feedback Report`). CDT work items are JSON lists:
  `[{"id":"…","title":"Facilitator deck","link":"https://…","deadline":"2026-10-20","done":""}]`.

## What changed in the app
1. **Proposal link → Engagement Calendar** — the 📅 "Add to Engagement Calendar" button on a
   solution item carries its Proposal Link (or any link under the same Proposal ID). Shown with an
   Open button in the EC form, EC card and ER Calendar popup.
2. **BD Won checklist** — setting BD Status = Won in the BD Tracker requires ticking the
   Operations Checklist items before Save. Won proposals without one show "⚠ Checklist pending".
   The list is copied to every row of that Proposal ID, carried into the Engagement Calendar
   when the engagement is added, and the Ops Checklist row is created/updated straight away
   (also carried by "Sync with EC"). Ops sees a summary banner and "Required by BD" tags;
   statuses are not changed.
3. **CDT work items** — Content Assets, Pre-Work and Post-Work lists, each item with title, link,
   mandatory deadline and done tick; overdue counts shown in the entry list.
4. **Open-link buttons** — every saved link (proposal links, CDT items) opens in a new tab.

Backup of the previous files: `Claude outputs/backup-2026-10-04-links-checklist/`.
