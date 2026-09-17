/**
 * PermissionsContext
 *
 * On mount: loads permissions from Excel via Power Automate GET flow.
 * Falls back to the hardcoded permissions.js config if the flow isn't
 * configured yet (so the app still works during initial setup).
 *
 * updatePermissions(): saves to PA immediately AND keeps local state
 * in sync so the UI reflects changes without a reload.
 */
import { createContext, useContext, useState, useEffect } from 'react';
import { PERMISSIONS } from '../config/permissions.js';
import { fetchPermissions, savePermissions } from '../services/permissionsApi.js';

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const [permissions, setPermissions] = useState(PERMISSIONS); // seed from hardcoded config
  const [loading,     setLoading]     = useState(true);
  const [saveError,   setSaveError]   = useState('');

  // Load from Excel on mount
  useEffect(() => {
    fetchPermissions()
      .then(perms => {
        if (Object.keys(perms).length > 0) setPermissions(perms);
      })
      .catch(() => {
        // Flow not configured yet or network error — use hardcoded config silently
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Update permissions in state AND push to Excel via PA.
   * Returns a promise so AdminPage can show a saving indicator.
   */
  const updatePermissions = async (newPerms) => {
    setPermissions(newPerms);   // update UI instantly
    setSaveError('');
    try {
      await savePermissions(newPerms);
    } catch (err) {
      setSaveError(err.message || 'Failed to save to Excel');
    }
  };

  return (
    <PermissionsContext.Provider value={{ permissions, updatePermissions, loading, saveError }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissionsContext() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissionsContext must be inside PermissionsProvider');
  return ctx;
}
