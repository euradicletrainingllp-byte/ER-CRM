# Index (permanent link ID) — rollout guide (2026-10-06)

> Update: the link column is called **Index** (fixed numbers in the Engagement Calendar, column C). New engagements get highest Index + 1 from the CRM. Manual Ops/Content Dev rows get `OC-…` / `CD-…` IDs.

**Why:** S No is `=ROW()-1` in both Excel files, so it changes whenever rows are added, deleted or sorted.
Linking by S No made "Sync with EC" add the same engagements again and again (251 duplicate rows in the
Ops Checklist) and left old copies with wrong company/topic/dates.

**Fix:** every engagement gets a permanent **Index** (e.g. `580`; new ones = highest + 1).
The CRM creates it once and shows it read-only (🔒). S No stays as a display-only formula.

---

## Do the steps in this order

**Don't use "Sync with EC" until step 4 is finished.**

### Step 1 — Excel 
1. **ER  Engagement Calender_Master.xlsx**: ✅ done — `Index` column (1–594, fixed values, not a formula).
2. **Operations Checklist.xlsx → Table2** (use `OC_Index_Setup.xlsx`): new headers `Index` and `Cleanup Action`; paste columns
   G:H of sheet *OC Index* (405 rows) as values from row 2. Filter `Cleanup Action = DELETE` (267 rows) →
   delete those table rows. Check the 11 REVIEW rows (sheet *Review*). Delete the `Cleanup Action` column.
3. **Content_Development_Tracker.xlsx → ContentDevTable**: add header `Index`. Keys for this file
   still need to be prepared (upload the file).
4. Spot-check before pasting: the grey columns (EG ID, Company, Start Date) must match the live rows.

### Step 2 — deploy the CRM code
Changed files: `src/services/api.js`, `syncEngine.js`, `syncWithEC.js`,
`src/pages/EngagementCalendar.jsx`, `OpsChecklist.jsx`, `ContentDevelopmentTracker.jsx`
(backup: `Claude outputs/backup-2026-10-06-engagement-key/`).

### Step 3 — Power Automate (Save As a backup copy of each flow first)
Don't re-select the File/Table dropdowns. After adding the Excel column: Save → close → reopen the flow so the
new column appears.

| Flow | Action (Switch case) | Change |
|---|---|---|
| **ENGAGEMENT_CRUD** | Add a row (create) | Map column `Index` = `triggerBody()?['Index']` |
| | Update a row (update) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']`. Clear the `SNo` column field (leave it empty) |
| | Delete a row (delete) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']` |
| **OPS_CHECKLIST_CRUD** | Add a row (create) | Map `Index` = `triggerBody()?['Index']`. Clear the `S No` field |
| | Update a row (update) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']`. Clear the `S No` field |
| | Delete a row (delete) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']` |
| **CONTENT_DEV_CRUD** | Add a row (create) | Map `Index` = `triggerBody()?['Index']`. Clear the `SNo` field |
| | Update a row (update) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']`. Clear the `SNo` field |
| | Delete a row (delete) | **Key Column** = `Index`; **Key Value** = `triggerBody()?['Index']` |

`get` cases need no change (List rows returns the new column automatically).
Do **not** map `Index` in any *Update a row* column field — it is only the lookup key, so it can never be changed.

### Step 4 — test (5 minutes)
1. Edit one engagement in the Engagement Calendar → the card shows `Index 🔒` and the edit lands on the right Excel row.
2. Ops Checklist → *Sync with EC* → *Recent*: expected **13 updated, 0 added** (corrects the moved Sep dates of DBS, Ford, AirIndia rows).
3. Run it again → **0 updated, 0 added**.
4. Add a test engagement → its Ops Checklist row is created with the same key → delete both.

---

## Rules from now on
- Never type, copy or edit the Index in Excel. Add new engagements through the CRM.
- A row typed straight into Excel has no key: the CRM won't save it and the sync skips it (with a warning)
  until a key is added. The sync also refuses to run if two rows share a key, or if a keyless tracker row
  matches an engagement (that would create a duplicate) — nothing is changed in those cases.
- S No is display only. Sorting/deleting rows no longer breaks links.
- *Whole Engagement Calendar* sync adds every engagement since 2022 that the tracker doesn't have
  (≈467 rows for the Ops Checklist). Use *Recent* unless that is intended.
