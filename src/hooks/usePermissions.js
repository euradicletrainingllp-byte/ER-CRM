/**
 * usePermissions — returns live access rights for the currently signed-in user.
 *
 * Usage:
 *   const { isAdmin, canAccess, canEdit, canCreate, canRead, canUpdate, canDelete, crud, email } = usePermissions();
 *
 * canAccess(page)  → alias for canRead(page)  — controls sidebar visibility / route guard
 * canEdit(page)    → true if user has Create OR Update OR Delete on that page
 * canCreate(page)  → can add new records
 * canRead(page)    → can view the page
 * canUpdate(page)  → can edit existing records
 * canDelete(page)  → can delete records
 * crud             → raw { [page]: { create, read, update, delete } } map
 */
import { useMsal } from '@azure/msal-react';
import { ADMIN_EMAIL, DEFAULT_ACCESS } from '../config/permissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';

const PAGES = ['dashboard', 'bd', 'engagement', 'ops', 'content-dev', 'solution'];

const ALL_CRUD_TRUE  = Object.fromEntries(PAGES.map(p => [p, { create: true,  read: true,  update: true,  delete: true  }]));
const ALL_CRUD_FALSE = Object.fromEntries(PAGES.map(p => [p, { create: false, read: false, update: false, delete: false }]));

function emptyCrud(readValue = false) {
  return Object.fromEntries(PAGES.map(p => [p, { create: false, read: readValue, update: false, delete: false }]));
}

export function usePermissions() {
  const { accounts } = useMsal();
  const { permissions } = usePermissionsContext();

  const account = accounts[0];
  const email = (
    account?.username ||
    account?.idTokenClaims?.preferred_username ||
    account?.idTokenClaims?.email ||
    ''
  ).toLowerCase().trim();

  // Admin always gets unrestricted access
  if (email && email === ADMIN_EMAIL.toLowerCase()) {
    return {
      email,
      isAdmin:   true,
      canAccess: () => true,
      canEdit:   () => true,
      canCreate: () => true,
      canRead:   () => true,
      canUpdate: () => true,
      canDelete: () => true,
      crud:      ALL_CRUD_TRUE,
    };
  }

  const userPerms = permissions[email];

  if (!userPerms) {
    return {
      email,
      isAdmin:   false,
      canAccess: () => DEFAULT_ACCESS,
      canEdit:   () => false,
      canCreate: () => false,
      canRead:   () => DEFAULT_ACCESS,
      canUpdate: () => false,
      canDelete: () => false,
      crud:      emptyCrud(DEFAULT_ACCESS),
    };
  }

  const c = (page, op) => !!userPerms.crud?.[page]?.[op];

  return {
    email,
    isAdmin:   false,
    canAccess: (page) => c(page, 'read'),
    canEdit:   (page) => c(page, 'create') || c(page, 'update') || c(page, 'delete'),
    canCreate: (page) => c(page, 'create'),
    canRead:   (page) => c(page, 'read'),
    canUpdate: (page) => c(page, 'update'),
    canDelete: (page) => c(page, 'delete'),
    crud:      userPerms.crud || ALL_CRUD_FALSE,
  };
}
