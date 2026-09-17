/**
 * EURADICLE CRM — USER PERMISSIONS
 * ==================================
 * This file is the single source of truth for who can access what.
 *
 * HOW TO UPDATE:
 *  1. Open the Admin Panel in the CRM (bottom of sidebar, admin only)
 *  2. Make your changes in the UI and click "Export Code"
 *  3. Copy the generated code and paste it here (replacing the PERMISSIONS block)
 *  4. Save this file — Vite hot-reloads instantly, no restart needed
 *
 * pages : which tabs the user can see and navigate to
 * edit  : whether the user can modify data (vs read-only view)
 */

// The one hardcoded admin — always has full access to everything
export const ADMIN_EMAIL = 'revanth.ram@euradicle.com';

export const PERMISSIONS = {
  'revanth.ram@euradicle.com': {
    name:  'Revanth Ram',
    pages: { dashboard: true, bd: true, engagement: true, ops: true, 'content-dev': true, solution: true },
    edit:  { dashboard: true, bd: true, engagement: true, ops: true, 'content-dev': true, solution: true },
  },
  // ── Add team members below ──────────────────────────────────────────
  // Copy the block above, change the email, name, and toggle true/false.
  //
  // 'colleague@euradicle.com': {
  //   name:  'Colleague Name',
  //   pages: { dashboard: true,  bd: true,  engagement: false, ops: false },
  //   edit:  { dashboard: false, bd: false, engagement: false, ops: false },
  // },
};

// What a brand-new user gets if their email is NOT listed above.
// Set to true to let all authenticated euradicle.com users in by default,
// or keep false to require the admin to explicitly grant access.
export const DEFAULT_ACCESS = false;
