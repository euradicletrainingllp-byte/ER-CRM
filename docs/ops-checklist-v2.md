# Ops Checklist v2 (page /ops — /ops-v2 redirects here)

Files: `src/pages/OpsChecklistV2.jsx`, `src/services/opsV2Engine.js` (rules), `src/services/opsV2Notify.js` (emails),
`src/services/opsV2Api.js` (OPS_V2_CRUD), `src/styles/opsV2.css`, `test/opsV2Engine.test.js`. Old Ops Checklist page and OPS_CHECKLIST_CRUD removed 2026-11-22 (old page kept in backups/old-ops-checklist/).

## Rules (TAT from program dates, 2026-11-22 16:39)
- **Signed TAT (2026-11-22 17:15):** Due = anchor date (Start Date; End Date for Anchor End) − TAT; a "+" sign means after: `2` = 2 days before start, `+2` = 2 days after start, `0` = on the day. Stored as text ("2" / "+2"). Custom steps take the anchor of the step above. Pre-program = Start-anchored without "+".
- Planned Start = previous applicable step's due in the same group (first: Checklist Created On / End Date), never after Due. Completing a step does not move others.
- NA → no dates. At risk = an open pre-program step is overdue and the program hasn't started. "short lead" = step was already due when the checklist was opened.
- Saved Planned Start / Due Date are rewritten after every change and once on page load (active programs, only differing rows) so the nudge flow reads current dates.
- Owner Dept can hold several departments ("Operations; Finance"). Owners = Step Library default owners if set, else all members of all those departments.
- New checklist: EngagementTable row + one task per active Step Library step; steps not matching Mode / Offering come in as NA.
- Custom step ("+ Add step here"): StepID CUS-###, Seq between neighbours, Custom Step = Yes.

## Step Library tab (Ops edit access)
- Steps: inline edit of Seq, Step, Owner Dept, TAT, Anchor, Mode, Offering, Required, Active; "details" drawer for What to do, Done when, default owners, remind/escalate. "+ Add step here" → OPS-### with Seq between neighbours. No hard delete (Active off).
- "Also update open checklists" (off by default): Step, Phase, Seq, TAT, Owner Dept and owners are copied to not-done tasks of active programs (not Delivered/Closed) and dates recalculated; a new step is added to active programs it fits.
- Lists: Phase, Offering, Mode, Waiting On from ListTable (ListID, List, Value, Order, Active). Until ListTable exists the editors use Step Library values. Seed: `Claude outputs/ops-checklist-v2/ListTable_import.xlsx`.
- Writes use the StepTable column names found in Excel (Owner Emails / Default Owner Email, Required/Optional / Required).

## Emails (CRM Notify, one email per recipient)
- Checklist created / custom step added → each owner gets their steps with due dates.
- Step Done → owners of the next open step + program Ops Owner Emails (not the person who marked it).

## "Ops Nudges" Power Automate flow (manual setup)
1. Trigger: **Recurrence** — daily 09:00, time zone (UTC+05:30) Chennai.
2. **List rows present in a table** — Operations Checklist.xlsx / OpsTaskTable, Filter Query `Applicable eq 'Yes'`, DateTime format ISO 8601, pagination on (5000).
3. **Filter array** — Status not equal `Done` and not equal `NA`, and Due Date not empty.
4. **Apply to each** (filtered rows), compute `daysLeft = div(sub(ticks(item()?['Due Date']), ticks(utcNow('yyyy-MM-dd'))), 864000000000)`:
   - **Reminder** — if `daysLeft` ≤ 1 and `Last Reminder On` ≠ today: Send email (V2) To = `Owner Emails`, subject `Due {Due Date}: {Step} — {Company}` (or `Overdue` when daysLeft < 0). Then Update a row (key TaskID): `Last Reminder On` = today, `Reminder Count` = +1.
   - **Escalation** — if `daysLeft` ≤ −2 and `Escalated` ≠ `Yes`: Send email To = Ops Head (flow variable) and CC `Owner Emails`. Update a row: `Escalated` = `Yes`.
5. Optional: one digest per owner instead of one email per task (group with Select + union on Owner Emails).

Pending: create the flow; confirm Step Library "Escalate After (days)" values if escalation should vary per step (flow currently uses 2 days).

## Other pages reading v2 (services/opsV2Data.js)
`getOpsChecklist()` / `peekOpsPrograms()` / `clScore()` return one summary per program (ready %, open / overdue steps, at risk, invoice owner, tasks). Used by Dashboard readiness card, Founder's Desk delivery risks, action items (open / completed steps), Client & Consultant 360, Directory Cleanup (fixes EngagementTable Company), Finance Tracker (read-only invoice owner from the "Invoice raised" step), Engagement Calendar "Add to Ops Checklist" (opens a v2 checklist).
