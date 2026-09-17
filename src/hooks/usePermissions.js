/**
 * usePermissions — returns live access rights for the currently signed-in user.
 * Reads from PermissionsContext (updated by AdminPage in real-time).
 *
 * Usage:
 *   const { isAdmin, canAccess, canEdit, email } = usePermissions();
 */
import { useMsal } from '@azure/msal-react';
import { ADMIN_EMAIL, DEFAULT_ACCESS } from '../config/permissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';

const PAGES      = ['dashboard', 'bd', 'engagement', 'ops', 'content-dev', 'solution'];
const ALL_TRUE   = Object.fromEntries(PAGES.map(p => [p, true]));
const ALL_FALSE  = Object.fromEntries(PAGES.map(p => [p, false]));

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
      pages:     ALL_TRUE,
      edit:      ALL_TRUE,
    };
  }

  const userPerms = permissions[email];

  if (!userPerms) {
    return {
      email,
      isAdmin:   false,
      canAccess: () => DEFAULT_ACCESS,
      canEdit:   () => false,
      pages:     Object.fromEntries(PAGES.map(p => [p, DEFAULT_ACCESS])),
      edit:      ALL_FALSE,
    };
  }

  return {
    email,
    isAdmin:   false,
    canAccess: (page) => !!userPerms.pages?.[page],
    canEdit:   (page) => !!userPerms.edit?.[page],
    pages:     userPerms.pages || ALL_FALSE,
    edit:      userPerms.edit  || ALL_FALSE,
  };
}
