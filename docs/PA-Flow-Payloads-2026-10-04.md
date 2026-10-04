# Power Automate — new columns for the 4 CRUD flows (2026-10-04)

These are additions only. Nothing in the existing flows gets renamed, removed or rewired.

| Flow | Switch cases to edit | New key(s) the CRM sends | Excel column |
|---|---|---|---|
| SOLUTION_CRUD | create, update | `Ops Checklist` | Ops Checklist |
| ENGAGEMENT_CRUD | create, update | `Proposal Link`, `Ops Checklist` | Proposal Link, Ops Checklist |
| OPS_CHECKLIST_CRUD | create, update | `BD Checklist` | BD Checklist |
| CONTENT_DEV_CRUD | create, update | `Content Assets`, `Pre-Work`, `Post-Work` | Content Assets, Pre-Work, Post-Work |

The `get` and `delete` cases need no change, because **List rows** returns new columns automatically.

---

## Safe-edit rules (read once)

1. **Back up first:** in each flow, use **Save As** to make a copy (for example `…_BACKUP_2026-10-04`) before editing.
2. **Don't re-select the Table or File dropdown** in *Add a row* or *Update a row*. Re-selecting it wipes every existing mapping.
   - To make the new column fields appear: **Save → close the flow → reopen it**, or refresh the browser tab.
   - If they still don't appear, open the action's **Advanced parameters** and tick the new column names.
3. **The trigger schema is optional.** The CRM's values reach the flow through `triggerBody()?['<key>']` whether or not the schema lists them. Pick one of the options below.
   - **Option A (recommended, no risk):** leave the HTTP trigger alone. Type the expressions below straight into the new column fields (Expression tab, or the *fx* button).
   - **Option B (to get the new keys as Dynamic content):** open the trigger's *Request Body JSON Schema* and **add** the snippet shown for that flow inside the existing `"properties": { … }`. Change nothing else.
   - **If the schema is regenerated from a full sample payload:** PA adds a `"required": [ … ]` list. **Delete that list**, otherwise `get` and `delete` calls (which send only a few keys) will fail with HTTP 400.
4. **Map only the new columns.** Leave every existing column mapping exactly as it is.

---

## 1. SOLUTION_CRUD — Solutioning_Tracker.xlsx → Table1

**Schema snippet (Option B) — add inside `"properties"`:**

```json
"Ops Checklist": { "type": "string" }
```

**Mappings:**

| Action (Switch case) | Column | Expression |
|---|---|---|
| Add a row (create) | Ops Checklist | `triggerBody()?['Ops Checklist']` |
| Update a row (update) | Ops Checklist | `triggerBody()?['Ops Checklist']` |

The CRM always sends the current value on update. It sends `""` only when no checklist exists, so the mapping never wipes real data.

**Sample payload — create** (exactly what the CRM sends):

```json
{
  "action": "create",
  "Proposal ID": "P ID 091",
  "Client Name": "Acme Ltd",
  "Client POC": "Rachel",
  "Contact Number": "9876543210",
  "Date of Discusssion": "2026-10-01",
  "Client Expt": "2026-10-08",
  "BD Month": "Oct 2026",
  "Program Topic": "The Art of Business Storytelling",
  "Proposal Version": "V1",
  "BD Status": "Won",
  "BD Proposal Value": "350000",
  "Solution Topic": "The Art of Business Storytelling",
  "Solution Month": "",
  "Program Type": "Customized",
  "Engagement Type": "Journey",
  "Line of Service": "Training",
  "Type of Service": "Facilitation",
  "Development Category": "Power Skills Enablement",
  "Solution Value": "184500",
  "Status": "Won",
  "Remarks": "",
  "Proposal V1 Link2": "https://euradicle.sharepoint.com/proposals/acme-v1.pdf",
  "Date of Submission to Client": "2026-10-03",
  "Ops Checklist": "Facilitator Calendar Block; Participant Manual; Feedback Report"
}
```

**Update:** same body with `"action": "update"` and `"sno": "12"` added (a string). **Delete:** `{ "action": "delete", "sno": "12" }`.

---

## 2. ENGAGEMENT_CRUD — ER Engagement Calender_Master.xlsx → EngagementMasterTable

**Schema snippet (Option B):**

```json
"Proposal Link": { "type": "string" },
"Ops Checklist": { "type": "string" }
```

**Mappings:**

| Action (Switch case) | Column | Expression |
|---|---|---|
| Add a row (create) | Proposal Link | `triggerBody()?['Proposal Link']` |
| Add a row (create) | Ops Checklist | `triggerBody()?['Ops Checklist']` |
| Update a row (update) | Proposal Link | `triggerBody()?['Proposal Link']` |
| Update a row (update) | Ops Checklist | `triggerBody()?['Ops Checklist']` |

The update flow overwrites the whole row. Every CRM update path now always sends both keys: the EC edit form, the Ops → Finance sync and the background sync. Existing values are therefore carried through and never blanked.

**Sample payload — create:**

```json
{
  "action": "create",
  "EG ID": "EG.ID 426",
  "company": "Acme Ltd",
  "Start Date": "2026-10-20",
  "End Date": "2026-10-21",
  "topic": "The Art of Business Storytelling",
  "sector": "FinTech",
  "Service Type": "Facilitator-led Programs",
  "offering": "Workshop",
  "day": 2,
  "location": "VILT",
  "Consultant - 1": "Shahnawaz Khan",
  "Consultant - 2": "",
  "status": "Scheduled",
  "contract": "SOW",
  "PO Status": "Received",
  "invoice": "",
  "Price (INR)": 184500,
  "Travel, Stay and Misc Expenses": 0,
  "gst": 0,
  "payment": "",
  "Amount Received": "",
  "Received Date": "",
  "comments": "",
  "feedback": "",
  "nps": "",
  "Proposal Link": "https://euradicle.sharepoint.com/proposals/acme-v1.pdf",
  "Ops Checklist": "Facilitator Calendar Block; Participant Manual; Feedback Report"
}
```

**Update:** same body with `"action": "update"` plus `"SNo": "512"`, `"rowId": "512"`, `"sno": "512"`. The existing Key Column `SNo` and Key Value `triggerBody()?['SNo']` stay as they are.

**Delete:** `{ "action": "delete", "egId": "EG.ID 426", "sno": "512" }`.

**Get:** `{ "action": "get", "fromDate": "2026-09-01", "toDate": "2026-11-30", "fromSerial": 46266, "toSerial": 46356 }`.

---

## 3. OPS_CHECKLIST_CRUD — Operations Checklist.xlsx → Table2

**Schema snippet (Option B):**

```json
"BD Checklist": { "type": "string" }
```

**Mappings:**

| Action (Switch case) | Column | Expression |
|---|---|---|
| Add a row (create) | BD Checklist | `triggerBody()?['BD Checklist']` |
| Update a row (update) | BD Checklist | `triggerBody()?['BD Checklist']` |

> ⚠ **Partial updates:** the Ops Checklist screen saves one field at a time, for example `{ "action":"update", "rowId":"10", "Participant Manual":"Yes" }`. In those calls `BD Checklist` is **absent**, so the expression returns `null`, and the Excel connector leaves the cell unchanged.
>
> **Map `BD Checklist` exactly the way the existing OC columns are already mapped** in this flow. If those use a wrapper such as `if(empty(triggerBody()?['X']), null, triggerBody()?['X'])`, use the same wrapper with `'BD Checklist'`.
>
> After saving, test that ticking one checklist item in the CRM does **not** blank the BD Checklist cell.

**Sample payload — create** (sent by "Sync with EC" and right after an engagement is added):

```json
{
  "action": "create",
  "S No": "512",
  "EG ID": "EG.ID 426",
  "EG.ID": "EG.ID 426",
  "company": "Acme Ltd",
  "Engagement Start Date": "2026-10-20",
  "Engagement\nStart Date": "2026-10-20",
  "Engagement End Date": "2026-10-21",
  "Engagement\nEnd Date": "2026-10-21",
  "Topic": "The Art of Business Storytelling",
  "Sector": "FinTech",
  "Service Type": "Facilitator-led Programs",
  "Offering": "Workshop",
  "Location": "VILT",
  "Consultant 1": "Shahnawaz Khan",
  "Consultant 2": "",
  "Consultant 3": "",
  "Status": "Scheduled",
  "Contract Type": "SOW",
  "Contract Status": "Received",
  "Day": "2",
  "BD Checklist": "Facilitator Calendar Block; Participant Manual; Feedback Report"
}
```

**Update:** same keys with `"action": "update"` and `"rowId": "512"`. A partial update looks like `{ "action": "update", "rowId": "512", "Participant Manual": "Yes", "Date of Completion25": "2026-10-04" }`.

**Delete:** `{ "action": "delete", "rowId": "512" }`.

---

## 4. CONTENT_DEV_CRUD — Content_Development_Tracker.xlsx → Table1 (Sheet1)

**Schema snippet (Option B):**

```json
"Content Assets": { "type": "string" },
"Pre-Work":       { "type": "string" },
"Post-Work":      { "type": "string" }
```

**Mappings:**

| Action (Switch case) | Column | Expression |
|---|---|---|
| Add a row (create) | Content Assets | `triggerBody()?['Content Assets']` |
| Add a row (create) | Pre-Work | `triggerBody()?['Pre-Work']` |
| Add a row (create) | Post-Work | `triggerBody()?['Post-Work']` |
| Update a row (update) | Content Assets | `triggerBody()?['Content Assets']` |
| Update a row (update) | Pre-Work | `triggerBody()?['Pre-Work']` |
| Update a row (update) | Post-Work | `triggerBody()?['Post-Work']` |

Each value is a JSON list written as text. Do **not** add a *Parse JSON* step; the CRM reads and writes this text itself. On update, the CRM always sends the full current lists, and `""` means the list is empty.

**Sample payload — create** (the three keys are sent only when items were added):

```json
{
  "action": "create",
  "Client": "Acme Ltd",
  "Program Type": "",
  "EV Required": "Yes",
  "POC": "Saba",
  "PM Required": "Yes",
  "SNo": "512",
  "Start Date": "2026-10-20",
  "Start Date ": "2026-10-20",
  "Topic": "The Art of Business Storytelling",
  "Content Assets": "[{\"id\":\"w1\",\"title\":\"Facilitator deck\",\"link\":\"https://euradicle.sharepoint.com/cdt/deck.pptx\",\"deadline\":\"2026-10-10\",\"done\":\"\"}]",
  "Pre-Work": "[{\"id\":\"w2\",\"title\":\"Pre-read article\",\"link\":\"https://example.com/read\",\"deadline\":\"2026-10-15\",\"done\":\"\"}]",
  "Post-Work": "[{\"id\":\"w3\",\"title\":\"Reflection assignment\",\"link\":\"\",\"deadline\":\"2026-10-28\",\"done\":\"\"}]"
}
```

**Update** (sent in full every time):

```json
{
  "action": "update",
  "sno": 512,
  "SNo": 512,
  "Client": "Acme Ltd",
  "Start Date": "2026-10-20",
  "Start Date ": "2026-10-20",
  "Program Type": "",
  "EV Required": "Yes",
  "POC": "Saba",
  "Completion Date": "",
  "PM Required": "Yes",
  "Topic": "The Art of Business Storytelling",
  "Content Assets": "[{\"id\":\"w1\",\"title\":\"Facilitator deck\",\"link\":\"https://euradicle.sharepoint.com/cdt/deck.pptx\",\"deadline\":\"2026-10-10\",\"done\":\"2026-10-09\"}]",
  "Pre-Work": "",
  "Post-Work": ""
}
```

**Delete:** `{ "action": "delete", "sno": 512 }`.

---

## Test checklist (after each flow is saved)

| Flow | Test in the CRM | Expected in Excel |
|---|---|---|
| SOLUTION_CRUD | Edit a BD lead → set Won → tick 2 items → Save | `Ops Checklist` filled on every row of that Proposal ID |
| ENGAGEMENT_CRUD | Solution Tracker → 📅 on a solution item → Save | New EC row has `Proposal Link` + `Ops Checklist` |
| OPS_CHECKLIST_CRUD | Wait for the "Ops Checklist row created" toast | OC row has `BD Checklist`. Ticking one item keeps it. |
| CONTENT_DEV_CRUD | Open a CDT entry → add a Pre-Work item | `Pre-Work` cell holds the JSON text, and the item is still there after Refresh |

If a run fails, open the flow's **Run history**. The trigger's *Raw inputs* show exactly what the CRM sent.
