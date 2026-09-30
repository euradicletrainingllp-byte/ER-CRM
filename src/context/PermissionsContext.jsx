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
import { logEvent } from '../services/auditLogger.js';

// Activity log: one row per user whose access changed
function logPermissionChanges(oldPerms = {}, newPerms = {}, error) {
  try {
    const result = error ? { Result: 'FAILED', ErrorMessage: String(error.message || error) } : {};
    const emails = new Set([...Object.keys(oldPerms), ...Object.keys(newPerms)]);
    for (const email of emails) {
      const a = oldPerms[email], b = newPerms[email];
      const base = { Category: 'ADMIN', Module: 'permissions', RecordId: email, RecordLabel: (b || a)?.name || email, ...result };
      if (!a && b) { logEvent({ ...base, Action: 'PERMISSION_USER_ADDED', NewValues: b.crud }); continue; }
      if (a && !b) { logEvent({ ...base, Action: 'PERMISSION_USER_REMOVED', OldValues: a.crud }); continue; }
      const changed = [], OldValues = {}, NewValues = {};
      const pages = new Set([...Object.keys(a.crud || {}), ...Object.keys(b.crud || {})]);
      for (const page of pages) {
        for (const op of ['create', 'read', 'update', 'delete']) {
          const x = !!a.crud?.[page]?.[op], y = !!b.crud?.[page]?.[op];
          if (x !== y) { const k = `${page}.${op}`; changed.push(k); OldValues[k] = x; NewValues[k] = y; }
        }
      }
      if (changed.length) logEvent({ ...base, Action: 'PERMISSION_CHANGE', ChangedFields: changed.join(', '), OldValues, NewValues });
    }
  } catch { /* ignore */ }
}

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
    const oldPerms = permissions;   // for the activity log
    setPermissions(newPerms);   // update UI instantly
    setSaveError('');
    try {
      await savePermissions(newPerms);
      logPermissionChanges(oldPerms, newPerms, null);
    } catch (err) {
      setSaveError(err.message || 'Failed to save to Excel');
      logPermissionChanges(oldPerms, newPerms, err);
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
