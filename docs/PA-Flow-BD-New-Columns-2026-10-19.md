# Power Automate — BD Tracker new columns (2026-10-19)

Flow: **SOLUTION_CRUD** · File: `Solutioning_Tracker.xlsx` · Table: `Table1`
Additions only. Nothing existing is renamed, removed or rewired.

| Switch case | Change |
|---|---|
| get | none (List rows returns the new columns automatically) |
| create (Add a row) | map 8 new columns |
| update (Update a row) | map the same 8 columns |
| delete | none |

## Safe-edit rules
1. **Save As** a backup first: `SOLUTION_CRUD_BACKUP_2026-10-19`.
2. **Do not re-select the File or Table dropdown** in Add a row / Update a row (that wipes every mapping).
   To make the new columns appear: Save → close the flow → reopen (or refresh the tab).
   Still missing? Open the action's **Advanced parameters** → tick the new column names.
3. Leave the HTTP trigger as it is and type the expressions below in the **Expression (fx)** tab.
   If the trigger schema is ever regenerated from a sample, **delete its `"required": [...]` list**.
4. **Never map "Total Cost of Proposal"** — it is an Excel formula (Price per Batch × Total Expected Batches).
   Writing to it would replace the formula in that row.

## Mappings (same in Add a row AND Update a row)

| Excel column | Expression |
|---|---|
| Total Expected Headcount | `triggerBody()?['Total Expected Headcount']` |
| Total Expected Batches | `triggerBody()?['Total Expected Batches']` |
| Price per Batch | `triggerBody()?['Price per Batch']` |
| Participant Profile | `triggerBody()?['Participant Profile']` |
| BD Comments | `triggerBody()?['BD Comments']` |
| Client POC Email ID | `triggerBody()?['Client POC Email ID']` |
| Client POC Designation | `triggerBody()?['Client POC Designation']` |
| Additional Client POCs | `triggerBody()?['Additional Client POCs']` |
| Total Cost of Proposal | **leave empty** |

If the existing columns in **Update a row** use a wrapper such as
`if(empty(triggerBody()?['X']), null, triggerBody()?['X'])`, use the same wrapper here.

The CRM leaves a key out when a save path has no value for it → the flow receives `null` →
"Update a row" leaves the cell unchanged. `""` is sent only when a user clears a field on purpose.

## Optional trigger schema snippet (inside `"properties"`)
```json
"Total Expected Headcount": { "type": "string" },
"Total Expected Batches":   { "type": "string" },
"Price per Batch":          { "type": "string" },
"Participant Profile":      { "type": "string" },
"BD Comments":              { "type": "string" },
"Client POC Email ID":      { "type": "string" },
"Client POC Designation":   { "type": "string" },
"Additional Client POCs":   { "type": "string" }
```

## Sample keys the CRM now adds to create / update
```json
"Total Expected Headcount": "120",
"Total Expected Batches": "4",
"Price per Batch": "185000",
"Participant Profile": "HR; Manager",
"BD Comments": "Client wants Q4 start; budget approval pending",
"Client POC Email ID": "rachel@acme.com",
"Client POC Designation": "L&D Manager",
"Additional Client POCs": "[{\"name\":\"Arun\",\"designation\":\"HRBP\",\"email\":\"arun@acme.com\",\"phone\":\"9876543210\"}]"
```

## Test (after saving the flow)
| Test in the CRM | Expected in Excel |
|---|---|
| BD Tracker → + Add BD Lead with all new fields → Save | New row has all 8 values; Total Cost = Price × Batches |
| Edit that lead → change only BD Comments → Save | Comments updated, other new cells unchanged |
| Add a Solution item to the lead | BD line keeps its new values |
| Edit an OLD lead (saved before today) → Save | Its new cells stay empty, no error |
| Flow run history → trigger Raw inputs | Shows the new keys |
