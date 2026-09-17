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

// ── Fetch with timeout + retry ───────────────────────────────────────────────
async function fetchWithRetry(url, options, timeoutMs = 90_000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      // 502 = PA gateway timeout — retry once silently
      if (res.status === 502 && attempt < retries) {
        await new Promise(r => setTimeout(r, 3000)); // wait 3s then retry
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries && (err.name === 'AbortError' || err.message?.includes('network'))) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (err.name === 'AbortError') throw new Error('Request timed out — PA flow is taking too long');
      throw err;
    }
  }
}

/**
 * Fetch all permissions from Excel.
 * Returns: { [email]: { name, crud: { [page]: { create, read, update, delete } } } }
 */
export async function fetchPermissions() {
  if (!GET_PERMISSIONS_URL.startsWith('http')) {
    throw new Error('GET_PERMISSIONS_URL not configured in permissionsApi.js');
  }

  const res = await fetchWithRetry(GET_PERMISSIONS_URL, {
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

  const res = await fetchWithRetry(SAVE_PERMISSIONS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ rows }),
  });

  if (!res.ok) {
    if (res.status === 502) throw new Error('SAVE permissions failed: 502 — PA flow timed out. Open PA and check the flow run history for errors.');
    throw new Error(`SAVE permissions failed: ${res.status}`);
  }
}
