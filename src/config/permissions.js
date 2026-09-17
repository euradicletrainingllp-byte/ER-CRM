/**
 * EURADICLE CRM — USER PERMISSIONS
 * ==================================
 * This file is the fallback permission config.
 * Live permissions are loaded from Excel via Power Automate.
 *
 * Permission model: 4 CRUD operations per page per user.
 *   create : can add new records
 *   read   : can view / access the page
 *   update : can edit existing records
 *   delete : can remove records
 *
 * HOW TO UPDATE:
 *  Use the Admin Panel in the CRM to manage permissions via the UI.
 *  Changes auto-save to Excel (Power Automate) and sync in real time.
 */

// The one hardcoded admin — always has full access to everything
export const ADMIN_EMAIL = 'revanth.ram@euradicle.com';

const ALL_CRUD = { create: true, read: true, update: true, delete: true };

export const PERMISSIONS = {
  'revanth.ram@euradicle.com': {
    name: 'Revanth Ram',
    crud: {
      dashboard:     { ...ALL_CRUD },
      bd:            { ...ALL_CRUD },
      engagement:    { ...ALL_CRUD },
      ops:           { ...ALL_CRUD },
      'content-dev': { ...ALL_CRUD },
      solution:      { ...ALL_CRUD },
    },
  },
  // ── Add team members below (or manage via Admin Panel) ──────────────────
  // 'colleague@euradicle.com': {
  //   name: 'Colleague Name',
  //   crud: {
  //     dashboard:  { create: false, read: true,  update: false, delete: false },
  //     bd:         { create: true,  read: true,  update: true,  delete: false },
  //     engagement: { create: false, read: false, update: false, delete: false },
  //     ops:        { create: false, read: false, update: false, delete: false },
  //     'content-dev': { create: false, read: false, update: false, delete: false },
  //     solution:   { create: false, read: false, update: false, delete: false },
  //   },
  // },
};

// What a brand-new user gets if their email is NOT listed.
// false = admin must explicitly grant access.
export const DEFAULT_ACCESS = false;
