# Project Management — assign to CRM users + email + My Tasks panel (2026-10-28)

## What changed
- **Assigned To / Assigned By / Project Owner** (task form, new-project form) are now drop-downs of the CRM's users — everyone in the Admin Panel (PermissionsTable: Email + Name). Excel still stores the name. A name already in Excel that is not a CRM user is kept and shown as "(not a CRM user)". Waiting On stays free text.
- **Assignment email** goes to the email saved for that person in the Admin Panel (exact name match first). The form shows "✉ <name> will be emailed (<email>)" or "⚠ <name> has no email in the Admin Panel". The toast after saving says whether the email went out. Sent on: new task, re-assignment, first task of a new project. Never for tasks assigned to oneself.
- **Floating My Tasks panel**
  - "+ Assign to someone / add to a project" opens a New task form: title, Assign to (any CRM user, default me), Project (open projects or none), Team, Due date, Priority, Details. Assigning to someone else emails them and switches to the "Assigned by me" tab.
  - On each expanded task: **Assigned to** drop-down (re-assign; for people allowed to edit the task — Update right or the assigner) and **+ Task in <project>** (opens the form with that project and team filled in).
  - The one-line "Add a task for myself" still works as before.

## Requirements
- CRM Notify flow URL in `NOTIFY` (already set). Names in the Admin Panel should be unique; if two users share a name, the drop-down shows their emails but Excel stores only the name.

## Files
`src/components/tasksShared.jsx` (users list, emailOf, PersonPicker, notifyAssignee result, mailNote), `src/components/TaskFloat.jsx`, `src/pages/TaskTracker.jsx`, `src/styles/tasks.css`.
Backup: `Claude outputs/backup-2026-10-28-task-assign/`.
Checked: all three files parse (Babel) with no undefined names. Production build not run here (Windows node_modules); run `npm run build` locally before pushing.
