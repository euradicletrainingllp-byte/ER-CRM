/**
 * PLATFORM TOUR — content
 * =======================
 * One block per page key (same keys as the Admin Panel / usePermissions).
 * The tour only ever shows chapters for pages the signed-in person can open,
 * and steps marked `needs` only when they hold that right.
 *
 * Step fields
 *   target   : list of candidates, first visible match wins
 *                '.css-selector'          normal selector
 *                '@button:<regex>'        a button inside the page whose text matches
 *                '@parent:.css-selector'  parent of the first match (e.g. KPI row)
 *              omitted / null → a centred card with no spotlight
 *   title    : short heading
 *   body     : text (Edit / Full access)
 *   viewBody : optional text for View-only access
 *   needs    : 'create' | 'edit' → only shown with that right
 *   optional : true → quietly skipped if the element is not on screen
 *
 * Bump TOUR_VERSION when the tour content changes a lot (everyone sees it again).
 * New pages need no bump: people who finished the tour get a "What's new" prompt for them.
 */

export const TOUR_VERSION = 1;

// Shared targets
const T = {
  nav:       page => [`[data-tour-nav="${page}"]`],
  kpis:      ['.page-content .kpi-compact', '.page-content .kpi-grid', '.page-content .fd-stats', '@parent:.page-content .kpi-card'],
  search:    ['.page-content input[placeholder*="🔍"]', '.page-content input[placeholder^="Search"]'],
  filters:   ['.page-content .filter-bar', '.page-content .lv-quickfilters', '.page-content .lv-tabs'],
  tabs:      ['.page-content .lv-tabs'],
  add:       ['@button:^\\s*(\\+|➕)?\\s*(Add|New)\\b(?!\\s+to\\b)'],
  list:      ['.page-content .tracker-scroll', '.page-content .cl-grid', '.page-content .table-wrap', '.page-content .lv-table', '.page-content .card'],
  reminders: ['.pf-launch'],
  tasks:     ['.tkf-launch'],
};

/* ── Chapters ─────────────────────────────────────────────────────────────── */
export const TOUR_PAGES = {
  dashboard: {
    path: '/', label: 'Dashboard', icon: 'LayoutDashboard', group: 'tool',
    tagline: 'The live pulse of the business: sales, solutioning, delivery and finance in one view.',
    steps: [
      { target: T.nav('dashboard'), title: 'Home base', body: 'The Dashboard rolls every tracker into one screen. It refreshes after each save and every few minutes on its own.' },
      { target: T.tabs, optional: true, title: 'Switch the lens', body: 'Each tab focuses on one function: Overview, Sales, Solutioning, Operations and Finance.' },
      { target: T.kpis, optional: true, title: 'Headline numbers', body: 'Key figures for the current financial year, read straight from the live Excel trackers.' },
    ],
  },
  founder: {
    path: '/founder', label: "Founder's Desk", icon: 'Gauge', group: 'tool',
    tagline: 'One page for leadership: what needs attention, where the money is, and who is overloaded.',
    steps: [
      { target: T.nav('founder'), title: "Founder's Desk", body: 'Reads every tracker at once and answers the leadership questions: pulse, pipeline, cash, readiness and team load.' },
      { target: ['.page-content .fd-stats'], optional: true, title: 'Business Pulse', body: 'Revenue, collections, pipeline and overdue work at a glance. Each tile jumps to its section.' },
      { target: ['@button:Customise'], optional: true, title: 'Make it personal', body: 'Pick a view (Monday review, Sales, Cash…), hide or move sections and set the default period.' },
    ],
  },
  leads: {
    path: '/leads', label: 'Lead Tracker', icon: 'Magnet', group: 'journey',
    tagline: 'Where every opportunity starts: source, owner, follow-ups and the full action history.',
    steps: [
      { target: T.nav('leads'), title: 'Lead Tracker', body: 'Every incoming lead: where it came from, who shared it, who owns it and what was said each time.' },
      { target: T.kpis, optional: true, title: 'Lead health', body: 'Open leads, hot leads and conversions. The cards follow the search and filters below.' },
      { target: T.add, needs: 'create', optional: true, title: 'Capture a lead', body: 'Add a lead the moment it arrives. The Lead ID is created automatically.' },
      { target: T.list, optional: true, title: 'Log every touch', body: 'Open a lead to log calls, emails and meetings. Logging an action also moves its status and next follow-up.', viewBody: 'Open a lead to read the full action timeline: who acted, what was said, and what happens next.' },
    ],
  },
  bd: {
    path: '/bd-tracker', label: 'BD Tracker', icon: 'Target', group: 'journey',
    tagline: 'Every proposal line, its value and status — from first discussion to Won or Lost.',
    steps: [
      { target: T.nav('bd'), title: 'BD Tracker', body: 'One line per proposal version, in BD-month order. This is the sales pipeline of record.' },
      { target: T.kpis, optional: true, title: 'Pipeline at a glance', body: 'Proposals, won, in process and value, counted with the same rule as the dashboards.' },
      { target: T.search, optional: true, title: 'Find anything fast', body: 'Search by client, topic or status. Filters stack with the search.' },
      { target: T.add, needs: 'create', optional: true, title: 'New proposal', body: 'Add a BD entry. Date of Discussion and Date of Submission are required; a Won proposal needs its Ops checklist ticks.' },
    ],
  },
  solution: {
    path: '/solution', label: 'Solution Tracker', icon: 'Lightbulb', group: 'journey',
    tagline: 'The design side of each proposal: solution items, owners and solution values.',
    steps: [
      { target: T.nav('solution'), title: 'Solution Tracker', body: 'The solutioning view of the same proposals: each line expands into its solution items.' },
      { target: T.kpis, optional: true, title: 'Solutioning numbers', body: 'Counts and Solution Values only — kept separate from BD values on purpose.' },
      { target: T.list, optional: true, title: 'Expand a proposal', body: 'Open a line to add, edit or review its solution items.', viewBody: 'Open a line to see every solution item and its value.' },
    ],
  },
  engagement: {
    path: '/engagement', label: 'Engagement Calendar', icon: 'CalendarDays', group: 'journey',
    tagline: 'Every session that is sold and scheduled — the Index here links Ops, Content and Finance.',
    steps: [
      { target: T.nav('engagement'), title: 'Engagement Calendar', body: 'Every won program becomes engagements here. Each one carries a permanent Index that ties all trackers together.' },
      { target: T.tabs, optional: true, title: 'List or Calendar', body: 'Switch between month cards and a full calendar grid. Same data, no reload.' },
      { target: T.kpis, optional: true, title: 'Delivery numbers', body: 'Scheduled, delivered and revenue for the chosen period.' },
      { target: T.add, needs: 'create', optional: true, title: 'Schedule a session', body: 'Add an engagement; it gets the next Index. Then use "Add to Ops Checklist" / "Add to Content Dev Tracker" on its card.' },
    ],
  },
  ops: {
    path: '/ops', label: 'Ops Checklist', icon: 'ClipboardCheck', group: 'journey',
    tagline: 'Pre- and post-delivery readiness for every session, with due dates worked out from TAT.',
    steps: [
      { target: T.nav('ops'), title: 'Ops Checklist', body: 'One row per session with every pre- and post-delivery item and its turnaround time.' },
      { target: T.kpis, optional: true, title: 'Readiness', body: 'How many sessions are fully ready, in progress or at risk.' },
      { target: T.search, optional: true, title: 'Jump to a session', body: 'Search by company, topic or EG.ID.' },
      { target: T.list, optional: true, title: 'Tick it off', body: 'Open a session and update each checklist item. The progress bar fills as items are done.', viewBody: 'Open a session to see each checklist item, its owner and status.' },
    ],
  },
  'content-dev': {
    path: '/content-dev', label: 'Content Dev Tracker', icon: 'BookOpen', group: 'journey',
    tagline: 'Content assets, pre-work and post-work for each engagement, with deadlines.',
    steps: [
      { target: T.nav('content-dev'), title: 'Content Dev Tracker', body: 'Everything content needs to deliver: assets, pre-work and post-work, each with its own deadline.' },
      { target: T.kpis, optional: true, title: 'Content status', body: 'Open, overdue and completed content work.' },
      { target: T.list, optional: true, title: 'Work items', body: 'Open an entry to add work items with a link and deadline, and mark them done.', viewBody: 'Open an entry to see its work items, links and deadlines.' },
    ],
  },
  finance: {
    path: '/finance', label: 'Finance Tracker', icon: 'Wallet', group: 'journey',
    tagline: 'From delivered session to cash in the bank: invoices, payments and balances.',
    steps: [
      { target: T.nav('finance'), title: 'Finance Tracker', body: 'Every engagement with its invoice and payment status. The Engagement Calendar is the finance master.' },
      { target: T.kpis, optional: true, title: 'Click a stage', body: 'To Invoice, Awaiting Payment, Overdue… each card is a filter. Tap one to see just those rows.' },
      { target: T.search, optional: true, title: 'Find an invoice', body: 'Search by company, topic, EG.ID or Index.' },
      { target: T.list, optional: true, title: 'Autosave', body: 'Edit invoice date, amount received or GST and it saves on its own. Status updates automatically.', viewBody: 'Each row shows price, invoice, received amount and balance.' },
    ],
  },
  tasks: {
    path: '/tasks', label: 'Project Management', icon: 'ListChecks', group: 'tool',
    tagline: 'Projects, tasks and owners — who is doing what, and by when.',
    steps: [
      { target: T.nav('tasks'), title: 'Project Management', body: 'Create projects, assign tasks and follow progress by person, team and project.' },
      { target: T.tabs, optional: true, title: 'Four ways to look', body: 'My Tasks, Board, Projects and All tasks.' },
      { target: T.add, needs: 'create', optional: true, title: 'Start a project', body: 'A new project comes with its first task. The assignee gets an email.' },
      { target: T.tasks, optional: true, title: 'My Tasks, everywhere', body: 'This floating panel works on every page: tick tasks done, add a note, or add a quick task.' },
    ],
  },
  vendors: {
    path: '/vendors', label: 'Vendor Services', icon: 'Receipt', group: 'tool',
    tagline: 'What was bought from which vendor, for which engagement — billed, invoiced and paid.',
    steps: [
      { target: T.nav('vendors'), title: 'Vendor Services', body: 'Every vendor service linked to its engagement, with client billing and vendor payment status.' },
      { target: T.tabs, optional: true, title: 'Slice it', body: 'By service, by engagement, by vendor or by category.' },
      { target: T.add, needs: 'create', optional: true, title: 'Log a service', body: 'Pick the engagement from the calendar; amount and status fill in automatically.' },
    ],
  },
  clients: {
    path: '/clients', label: 'Client Directory', icon: 'Building2', group: 'tool',
    tagline: 'Every client account: contacts, programs, actions and the interaction history.',
    steps: [
      { target: T.nav('clients'), title: 'Client Directory', body: 'One profile per client: stakeholders, program history, open actions and every interaction.' },
      { target: T.tabs, optional: true, title: 'Clients, contacts, actions, programs', body: 'Four views of the same accounts.' },
      { target: T.list, optional: true, title: 'Open a profile', body: 'Tap a client card for the full profile, with a completeness score and next steps.' },
    ],
  },
  consultants: {
    path: '/consultants', label: 'Consultant Directory', icon: 'GraduationCap', group: 'tool',
    tagline: 'Trainers, coaches and facilitators: profiles, expertise and contract renewals.',
    steps: [
      { target: T.nav('consultants'), title: 'Consultant Directory', body: 'Profile cards for every consultant, with skills, clients and contract status.' },
      { target: T.search, optional: true, title: 'Find the right fit', body: 'Search by name, skill, industry or client.' },
      { target: T.tabs, optional: true, title: 'Contracts view', body: 'See which contracts are valid, due for renewal or expired.' },
    ],
  },
  admin: {
    path: '/admin', label: 'User Access Control', icon: 'ShieldCheck', group: 'tool', adminOnly: true,
    tagline: 'Who can see and change what — the source of every person\'s tour, too.',
    steps: [
      { target: T.nav('admin'), title: 'User Access Control', body: 'Set View / Edit / Full access per person and page. The sidebar, the emails and this tour all follow it.' },
      { target: ['.page-content .ad-tabs'], optional: true, title: 'People, matrix, setup', body: 'Edit by person, use the access matrix, or check the Excel columns.' },
    ],
  },
};

// Order of the journey line on the welcome screen
export const JOURNEY = ['leads', 'bd', 'solution', 'engagement', 'ops', 'content-dev', 'finance'];
// Order of chapters in the guided tour
export const CHAPTER_ORDER = ['dashboard', 'founder', ...JOURNEY, 'tasks', 'vendors', 'clients', 'consultants', 'admin'];
// Other tools shown as chips on the welcome screen
export const TOOLS = ['dashboard', 'founder', 'tasks', 'vendors', 'clients', 'consultants', 'admin'];

// Opening steps (before the chapters) and closing steps (after them)
export const INTRO_STEPS = [
  { target: ['.sidebar nav'], title: 'The menu is personal', body: 'Only the trackers opened for this account appear here. Access is managed in the Admin Panel.' },
  { target: ['[data-tour="tour-button"]'], title: 'Replay anytime', body: 'This Tour button restarts the walkthrough, or tours just one tracker, whenever needed.' },
];
export const OUTRO_STEPS = [
  { target: T.reminders, optional: true, title: 'Reminders never sleep', body: 'Overdue tasks, things due soon and missing fields for the page in view. Tap a chip to jump straight to the record.' },
];

/** Access label for one page: Full / Edit / View / null */
export function accessLevel(perm, page) {
  if (perm.isAdmin) return 'Full';
  if (!perm.canRead(page)) return null;
  const c = perm.canCreate(page), u = perm.canUpdate(page), d = perm.canDelete(page);
  if (c && u && d) return 'Full';
  if (c || u || d) return 'Edit';
  return 'View';
}

/** Page keys this person can open, in chapter order */
export function accessiblePages(perm) {
  return CHAPTER_ORDER.filter(p => {
    const cfg = TOUR_PAGES[p];
    if (cfg.adminOnly) return perm.isAdmin;
    if (perm.isAdmin) return true;
        return perm.canRead(p);
  });
}

/* ── Quick tour (default): ONE stop per page, in Raddy's voice ────────────────
   The detailed `steps` above play only when "Show me more" is tapped. */
const quickTarget = page => [...T.kpis, ...T.list, ...T.nav(page)];
export const QUICK = {
  dashboard:     { title: 'The whole business on one screen', body: 'Sales, solutioning, delivery and finance numbers, live from Excel. It refreshes itself every few minutes, no button-mashing needed.' },
  founder:       { title: 'The leadership cockpit', body: 'Pulse, pipeline, cash and team load in one place. Tap a tile to jump to its section, or Customise to rearrange it all.' },
  leads:         { title: 'Every lead starts here', body: 'Source, owner and next follow-up for each lead. Log a call or meeting and the status moves on by itself.', viewBody: 'Source, owner and next follow-up for each lead, plus every call and meeting logged on it.' },
  bd:            { title: 'The sales pipeline', body: 'One line per proposal version, with value and BD status. A Won deal needs its Ops checklist ticked before it saves.', viewBody: 'One line per proposal version, with value and BD status, in BD-month order.' },
  solution:      { title: 'Where proposals get designed', body: 'Open any line to see its solution items. Solution values live here, kept apart from BD values.' },
  engagement:    { title: 'Every session, scheduled', body: 'Each engagement carries a permanent Index that links Ops, Content and Finance. Flip between List and Calendar any time.' },
  ops:           { title: 'Ready before the room fills', body: 'Every pre- and post-delivery item per session, with due dates worked out from TAT. The bar fills as items get ticked.' },
  'content-dev': { title: 'Content, on deadline', body: 'Assets, pre-work and post-work for each engagement, each with its own deadline and link.' },
  finance:       { title: 'From session to cash', body: 'Each card is a filter: To Invoice, Awaiting Payment, Overdue. Edits save on their own and the status updates itself.', viewBody: 'Each card is a filter: To Invoice, Awaiting Payment, Overdue. Price, invoice and balance for every engagement.' },
  tasks:         { title: "Who's doing what, by when", body: 'Projects broken into tasks with owners and dates. The My Tasks panel follows along on every page.' },
  vendors:       { title: 'Every vendor bill, tracked', body: 'What was bought, for which engagement, and whether it is billed to the client, invoiced by the vendor and paid.' },
  clients:       { title: 'Know every account', body: 'Contacts, programs, open actions and the full interaction history, in one profile per client.' },
  consultants:   { title: 'The trainer bench', body: 'Profiles, skills and clients for every consultant, plus alerts when a contract is due for renewal.' },
  admin:         { title: 'The keys to the kingdom', body: 'View, Edit or Full access per person and page. The menu, the emails and this very tour all follow it.' },
};
export function quickStep(page) {
  const q = QUICK[page] || {};
  return { target: quickTarget(page), ...q };
}

export const GUIDE_NAME = 'Raddy';
export const QUICK_INTRO = {
  target: ['.sidebar nav'],
  title: `Hi, I'm ${GUIDE_NAME}!`,
  body: 'This menu shows only the trackers opened for this account. Follow me, one quick stop per tracker. Tap the glowing spot to keep going.',
};
export const QUICK_OUTRO = {
  target: ['[data-tour="tour-button"]'],
  title: 'Lost? Call me back',
  body: 'Tap this Tour button any time and I come running: the whole place, or just one tracker.',
};
