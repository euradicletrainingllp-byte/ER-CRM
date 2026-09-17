/**
 * permissionsApi.js — Read and write user permissions via Power Automate flows.
 *
 * EXCEL TABLE SETUP (one-time, if not already done):
 *  Add a Table named "PermissionsTable" with these columns:
 *    Email | Name | Dashboard | BD | Engagement | Ops | ContentDev | Solution |
 *    DashEdit | BDEdit | EngEdit | OpsEdit | ContentDevEdit | SolutionEdit
 *  Values are the strings "true" or "false".
 *
 *  Note: If your table still has the old "Solutioning" / "SolEdit" columns,
 *  rename them to "ContentDev" / "ContentDevEdit" — the app will still fall
 *  back to the old names so no data is lost during the transition.
 *
 * Flow setup:
 *  1. Create a GET flow  → paste its HTTP trigger URL as GET_PERMISSIONS_URL.
 *  2. Create a SAVE flow → paste its HTTP trigger URL as SAVE_PERMISSIONS_URL.
 */

// ── Paste your Power Automate flow URLs here ────────────────────────────────
const GET_PERMISSIONS_URL  = 'https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/28/workflows/ed155099fdf7435a83d22fbafc48d847/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=uN77XTW7kkQgvgpCWidW7N0xCg9rMORHzaHPVFnnLss';
const SAVE_PERMISSIONS_URL = 'https://default018223f9187e4f9091b8a53275307c.d9.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/01/workflows/db70b4afa0264a2e9048cfa65aa0448d/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=XAMFYLFLeUZpkh2jtN3zyNDyRJ8tgM9qWXZctdxWnwk';
// ─────────────────────────────────────────────────────────────────────────────

const BOOL = v => String(v).toLowerCase() === 'true';

/**
 * Fetch all permissions from Excel.
 * Returns: { [email]: { name, pages: {...}, edit: {...} } }
 */
export async function fetchPermissions() {
  if (!GET_PERMISSIONS_URL.startsWith('http')) {
    throw new Error('GET_PERMISSIONS_URL not configured in permissionsApi.js');
  }

  const res = await fetch(GET_PERMISSIONS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`GET permissions failed: ${res.status}`);

  const rows = await res.json();
  const perms = {};

  for (const row of Array.isArray(rows) ? rows : (rows.value || [])) {
    const email = (row.Email || row.email || '').toLowerCase().trim();
    if (!email) continue;

    perms[email] = {
      name: row.Name || row.name || email.split('@')[0],
      pages: {
        dashboard:    BOOL(row.Dashboard   ?? row.dashboard   ?? false),
        bd:           BOOL(row.BD          ?? row.bd          ?? false),
        engagement:   BOOL(row.Engagement  ?? row.engagement  ?? false),
        ops:          BOOL(row.Ops         ?? row.ops         ?? false),
        // 'ContentDev' is the current column name; falls back to old 'Solutioning' column
        'content-dev': BOOL(row.ContentDev  ?? row.contentDev  ?? row.Solutioning ?? row.solutioning ?? false),
        solution:     BOOL(row.Solution    ?? row.solution    ?? false),
      },
      edit: {
        dashboard:    BOOL(row.DashEdit        ?? row.dashEdit        ?? false),
        bd:           BOOL(row.BDEdit          ?? row.bdEdit          ?? false),
        engagement:   BOOL(row.EngEdit         ?? row.engEdit         ?? false),
        ops:          BOOL(row.OpsEdit         ?? row.opsEdit         ?? false),
        // 'ContentDevEdit' is the current column name; falls back to old 'SolEdit'
        'content-dev': BOOL(row.ContentDevEdit ?? row.contentDevEdit  ?? row.SolEdit ?? row.solEdit ?? false),
        solution:     BOOL(row.SolutionEdit    ?? row.solutionEdit    ?? false),
      },
    };
  }
  return perms;
}

/**
 * Save ALL permissions back to Excel (overwrites existing data).
 * permsObj: { [email]: { name, pages: {...}, edit: {...} } }
 */
export async function savePermissions(permsObj) {
  if (!SAVE_PERMISSIONS_URL.startsWith('http')) {
    throw new Error('SAVE_PERMISSIONS_URL not configured in permissionsApi.js');
  }

  const rows = Object.entries(permsObj).map(([email, cfg]) => ({
    Email:          email,
    Name:           cfg.name || email.split('@')[0],
    Dashboard:      String(!!cfg.pages?.dashboard),
    BD:             String(!!cfg.pages?.bd),
    Engagement:     String(!!cfg.pages?.engagement),
    Ops:            String(!!cfg.pages?.ops),
    ContentDev:     String(!!cfg.pages?.['content-dev']),
    Solution:       String(!!cfg.pages?.solution),
    DashEdit:       String(!!cfg.edit?.dashboard),
    BDEdit:         String(!!cfg.edit?.bd),
    EngEdit:        String(!!cfg.edit?.engagement),
    OpsEdit:        String(!!cfg.edit?.ops),
    ContentDevEdit: String(!!cfg.edit?.['content-dev']),
    SolutionEdit:   String(!!cfg.edit?.solution),
  }));

  const res = await fetch(SAVE_PERMISSIONS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rows }),
  });

  if (!res.ok) throw new Error(`SAVE permissions failed: ${res.status}`);
}
