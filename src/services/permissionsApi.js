/**
 * permissionsApi.js — Read and write user permissions via Power Automate flows.
 *
 * EXCEL TABLE SETUP (PermissionsTable columns):
 *   Email | Name |
 *   DashCreate | DashRead | DashUpdate | DashDelete |
 *   BDCreate   | BDRead   | BDUpdate   | BDDelete   |
 *   EngCreate  | EngRead  | EngUpdate  | EngDelete  |
 *   OpsCreate  | OpsRead  | OpsUpdate  | OpsDelete  |
 *   ContentDevCreate | ContentDevRead | ContentDevUpdate | ContentDevDelete |
 *   SolCreate  | SolRead  | SolUpdate  | SolDelete
 *
 *  Values are the strings "true" or "false".
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

// Page key → Excel column prefix
const PAGE_PREFIX = {
  'dashboard':   'Dash',
  'bd':          'BD',
  'engagement':  'Eng',
  'ops':         'Ops',
  'content-dev': 'ContentDev',
  'solution':    'Sol',
};
const PAGES = Object.keys(PAGE_PREFIX);
const OPS   = ['Create', 'Read', 'Update', 'Delete'];

function emptyPageCrud() {
  return { create: false, read: false, update: false, delete: false };
}

/**
 * Fetch all permissions from Excel.
 * Returns: { [email]: { name, crud: { [page]: { create, read, update, delete } } } }
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

    const crud = {};
    for (const page of PAGES) {
      const prefix = PAGE_PREFIX[page];
      crud[page] = {
        create: BOOL(row[`${prefix}Create`] ?? false),
        read:   BOOL(row[`${prefix}Read`]   ?? false),
        update: BOOL(row[`${prefix}Update`] ?? false),
        delete: BOOL(row[`${prefix}Delete`] ?? false),
      };
    }

    perms[email] = {
      name: row.Name || row.name || email.split('@')[0],
      crud,
    };
  }
  return perms;
}

/**
 * Save ALL permissions back to Excel (overwrites existing data).
 * permsObj: { [email]: { name, crud: { [page]: { create, read, update, delete } } } }
 */
export async function savePermissions(permsObj) {
  if (!SAVE_PERMISSIONS_URL.startsWith('http')) {
    throw new Error('SAVE_PERMISSIONS_URL not configured in permissionsApi.js');
  }

  const rows = Object.entries(permsObj).map(([email, cfg]) => {
    const row = { Email: email, Name: cfg.name || email.split('@')[0] };
    for (const page of PAGES) {
      const prefix = PAGE_PREFIX[page];
      const c = cfg.crud?.[page] || emptyPageCrud();
      row[`${prefix}Create`] = String(!!c.create);
      row[`${prefix}Read`]   = String(!!c.read);
      row[`${prefix}Update`] = String(!!c.update);
      row[`${prefix}Delete`] = String(!!c.delete);
    }
    return row;
  });

  const res = await fetch(SAVE_PERMISSIONS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rows }),
  });

  if (!res.ok) throw new Error(`SAVE permissions failed: ${res.status}`);
}
