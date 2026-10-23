/**
 * Drop-down values for the Project Management (Task) tracker.
 * Edit these lists to change the choices. Values already saved in Excel that are not
 * in a list are still shown (as "(old value)") and kept.
 */
export const TASK_TEAMS = [
  "Founder's Office", 'BD & Solutioning', 'Content Development', 'Operations',
  'Finance', 'Marketing & Branding', 'Tech / CRM', 'HR & Admin',
];
export const PROJECT_TYPES = [
  'Client Engagement', 'Proposal / Pitch', 'Content / IP Development', 'Internal Initiative',
  'Marketing / LinkedIn', 'Tech / CRM', 'Finance / Admin', 'Hiring / HR',
];
export const TASK_STATUSES = ['To do', 'In progress', 'Waiting on someone', 'In review', 'Done', 'Cancelled'];
// Statuses that end a task (no more work expected)
export const TASK_CLOSED = ['Done', 'Cancelled'];
export const TASK_PRIORITIES = ['High', 'Medium', 'Low'];

// First task added automatically with every new project (editable in the form)
export const FIRST_TASK_TITLE = 'Plan the project and break it into tasks';
export const FIRST_TASK_DAYS = 2;           // its default due date = today + N days
export const BOARD_DONE_DAYS = 14;          // Board shows tasks done in the last N days

export const taskIsOpen = t => !TASK_CLOSED.includes(String(t?.status || '').trim());
