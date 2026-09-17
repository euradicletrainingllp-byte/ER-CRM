/**
 * AdminPage — User access & permission management.
 * Only reachable by the admin email defined in permissions.js.
 */
import { useState, useEffect } from 'react';
import { usePermissions } from '../hooks/usePermissions.js';
import { ADMIN_EMAIL } from '../config/permissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGES = [
  { key: 'dashboard',    label: 'Dashboard',           icon: '📊' },
  { key: 'bd',           label: 'BD Tracker',         icon: '🎯' },
  { key: 'engagement',   label: 'Engagement',          icon: '📅' },
  { key: 'ops',          label: 'Ops Checklist',       icon: '✔'  },
  { key: 'content-dev',  label: 'Content Dev Tracker', icon: '📘' },
  { key: 'solution',     label: 'Solution Tracker',     icon: '💡' },
];

const EMPTY_PAGES = { dashboard: false, bd: false, engagement: false, ops: false, 'content-dev': false, solution: false };
const EMPTY_EDIT  = { dashboard: false, bd: false, engagement: false, ops: false, 'content-dev': false, solution: false };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function permsToUsers(permsObj) {
  return Object.entries(permsObj).map(([email, cfg]) => ({
    email,
    name:  cfg.name || email.split('@')[0],
    pages: { ...EMPTY_PAGES, ...cfg.pages },
    edit:  { ...EMPTY_EDIT,  ...cfg.edit  },
  }));
}

function usersToPerms(users) {
  return Object.fromEntries(
    users.map(u => [u.email, { name: u.name, pages: { ...u.pages }, edit: { ...u.edit } }])
  );
}

function generateCode(users) {
  const lines = users.map(u => {
    const pagesStr = PAGES.map(p => `${p.key}: ${u.pages[p.key] ? 'true ' : 'false'}`).join(', ');
    const editStr  = PAGES.map(p => `${p.key}: ${u.edit[p.key]  ? 'true ' : 'false'}`).join(', ');
    return `  '${u.email}': {\n    name:  '${u.name}',\n    pages: { ${pagesStr} },\n    edit:  { ${editStr} },\n  },`;
  }).join('\n');
  return `export const PERMISSIONS = {\n${lines}\n};`;
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        disabled={disabled} style={{ display: 'none' }} />
      <span style={{
        width: 36, height: 20, borderRadius: 10, position: 'relative', transition: 'background .2s',
        background: checked ? '#e8760a' : '#cbd5e1',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </span>
    </label>
  );
}

// ─── Access Denied (for non-admin users who somehow reach /admin) ──────────────
function AccessDenied() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 400, gap: 12, color: '#64748b',
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#1a3a5c' }}>Admin Only</div>
      <div style={{ fontSize: 13 }}>This page is restricted to the system administrator.</div>
    </div>
  );
}

// ─── Main AdminPage ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { isAdmin } = usePermissions();
  const { permissions, updatePermissions, loading, saveError } = usePermissionsContext();

  const [users,    setUsers]    = useState(() => permsToUsers(permissions));
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName,  setNewName]  = useState('');
  const [newPages, setNewPages] = useState({ ...EMPTY_PAGES });
  const [newEdit,  setNewEdit]  = useState({ ...EMPTY_EDIT  });
  const [addErr,   setAddErr]   = useState('');

  // Re-sync local users when Excel data finishes loading
  useEffect(() => {
    if (!loading) setUsers(permsToUsers(permissions));
  }, [loading]);

  // Push changes to context (saves to Excel via PA) and show feedback
  const applyUsers = async (nextUsers) => {
    setUsers(nextUsers);
    setSaving(true); setSaved(false);
    await updatePermissions(usersToPerms(nextUsers));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };


  if (!isAdmin) return <AccessDenied />;

  // ── Mutators ─────────────────────────────────────────────────────────────────
  const togglePage = (i, page, val) =>
    applyUsers(users.map((usr, idx) =>
      idx !== i ? usr : {
        ...usr,
        pages: { ...usr.pages, [page]: val },
        edit:  { ...usr.edit, [page]: val ? usr.edit[page] : false },
      }
    ));

  const toggleEdit = (i, page, val) =>
    applyUsers(users.map((usr, idx) =>
      idx !== i ? usr : { ...usr, edit: { ...usr.edit, [page]: val } }
    ));

  const removeUser = (i) =>
    applyUsers(users.filter((_, idx) => idx !== i));

  const addUser = () => {
    setAddErr('');
    const em = newEmail.toLowerCase().trim();
    if (!em || !em.includes('@')) { setAddErr('Enter a valid email address.'); return; }
    if (users.find(u => u.email === em)) { setAddErr('This email is already in the list.'); return; }
    applyUsers([...users, {
      email: em,
      name:  newName.trim() || em.split('@')[0],
      pages: { ...newPages },
      edit:  { ...newEdit  },
    }]);
    setNewEmail(''); setNewName('');
    setNewPages({ ...EMPTY_PAGES }); setNewEdit({ ...EMPTY_EDIT });
  };

  const copyCode = () => {
    navigator.clipboard.writeText(exportCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const nonAdminUsers = users.filter(u => u.email !== ADMIN_EMAIL.toLowerCase());
  const totalAccess   = nonAdminUsers.filter(u => Object.values(u.pages).some(Boolean)).length;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            background: '#e8760a', color: '#fff', borderRadius: 8,
            padding: '6px 12px', fontSize: 14, fontWeight: 800,
          }}>⚙️ Admin</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a5c', margin: 0 }}>
            User Access Control
          </h1>
        </div>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
          Manage who can access each page and whether they can edit data.
          Changes save instantly to your Excel <strong>PermissionsTable</strong> via Power Automate.
        </p>
        {/* Save status */}
        {saving && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#e8760a', fontWeight: 600 }}>
            ⏳ Saving to Excel…
          </div>
        )}
        {saved && !saving && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
            ✓ Saved to Excel
          </div>
        )}
        {saveError && (
          <div style={{
            marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600,
            background: '#fee2e2', padding: '6px 10px', borderRadius: 6,
          }}>
            ⚠️ {saveError} — check your PA flow URLs in permissionsApi.js
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total users',   value: nonAdminUsers.length, color: '#0f2340' },
          { label: 'With access',   value: totalAccess,          color: '#16a34a' },
          { label: 'No access yet', value: nonAdminUsers.length - totalAccess, color: '#dc2626' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
            padding: '14px 20px', minWidth: 130, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 28,
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '220px repeat(4, 1fr) 60px',
          background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
          padding: '10px 16px', gap: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>User</div>
          {PAGES.map(p => (
            <div key={p.key} style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>
              {p.icon} {p.label}
            </div>
          ))}
          <div />
        </div>

        {/* Rows */}
        {users.map((user, i) => {
          const isAdminRow = user.email === ADMIN_EMAIL.toLowerCase();
          return (
            <div key={user.email} style={{
              display: 'grid',
              gridTemplateColumns: '220px repeat(4, 1fr) 60px',
              padding: '12px 16px', gap: 8, alignItems: 'center',
              borderBottom: '1px solid #f1f5f9',
              background: isAdminRow ? '#fffbf5' : 'transparent',
            }}>
              {/* User info */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: isAdminRow ? '#e8760a' : '#1a3a5c',
                    color: '#fff', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {(user.name || user.email).split(/[\s.]+/).map(w => w[0]?.toUpperCase()).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a3a5c' }}>
                      {user.name}
                      {isAdminRow && (
                        <span style={{
                          marginLeft: 6, fontSize: 9, background: '#e8760a',
                          color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 700,
                        }}>ADMIN</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{user.email}</div>
                  </div>
                </div>
              </div>

              {/* Page toggles */}
              {PAGES.map(p => (
                <div key={p.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  {/* View access */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Toggle
                      checked={isAdminRow || !!user.pages[p.key]}
                      onChange={val => togglePage(i, p.key, val)}
                      disabled={isAdminRow}
                    />
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>View</span>
                  </div>
                  {/* Edit access — only shows if view is granted */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: (isAdminRow || user.pages[p.key]) ? 1 : 0.3 }}>
                    <Toggle
                      checked={isAdminRow || (!!user.pages[p.key] && !!user.edit[p.key])}
                      onChange={val => toggleEdit(i, p.key, val)}
                      disabled={isAdminRow || !user.pages[p.key]}
                    />
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>Edit</span>
                  </div>
                </div>
              ))}

              {/* Remove */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {!isAdminRow && (
                  <button
                    onClick={() => removeUser(i)}
                    title="Remove user"
                    style={{
                      background: 'none', border: '1px solid #fecaca', borderRadius: 6,
                      padding: '4px 8px', cursor: 'pointer', color: '#dc2626', fontSize: 13,
                    }}
                  >✕</button>
                )}
              </div>
            </div>
          );
        })}

        {users.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            No users yet. Add one below.
          </div>
        )}
      </div>

      {/* Add user */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        padding: '20px 24px', marginBottom: 28,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a5c', marginBottom: 16 }}>
          ➕ Add New User
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="email" placeholder="Email address *"
            value={newEmail} onChange={e => setNewEmail(e.target.value)}
            style={{
              flex: '1 1 220px', padding: '9px 12px', borderRadius: 8,
              border: '1px solid #cbd5e1', fontSize: 13, outline: 'none',
            }}
          />
          <input
            type="text" placeholder="Display name (optional)"
            value={newName} onChange={e => setNewName(e.target.value)}
            style={{
              flex: '1 1 160px', padding: '9px 12px', borderRadius: 8,
              border: '1px solid #cbd5e1', fontSize: 13, outline: 'none',
            }}
          />
        </div>

        {/* Page toggles for new user */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
          {PAGES.map(p => (
            <div key={p.key} style={{
              background: '#f8fafc', borderRadius: 10, padding: '12px 16px',
              border: '1px solid #e2e8f0', minWidth: 130,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1a3a5c', marginBottom: 8 }}>
                {p.icon} {p.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Toggle
                    checked={!!newPages[p.key]}
                    onChange={val => {
                      setNewPages(prev => ({ ...prev, [p.key]: val }));
                      if (!val) setNewEdit(prev => ({ ...prev, [p.key]: false }));
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>View</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: newPages[p.key] ? 1 : 0.3 }}>
                  <Toggle
                    checked={!!newPages[p.key] && !!newEdit[p.key]}
                    onChange={val => setNewEdit(prev => ({ ...prev, [p.key]: val }))}
                    disabled={!newPages[p.key]}
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>Edit</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {addErr && (
          <div style={{
            background: '#fee2e2', color: '#991b1b', borderRadius: 8,
            padding: '8px 12px', fontSize: 12, marginBottom: 12,
          }}>⚠️ {addErr}</div>
        )}

        <button
          onClick={addUser}
          style={{
            background: '#1a3a5c', color: '#fff', border: 'none',
            borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Add User
        </button>
      </div>

      {/* PA Setup Guide */}
      <div style={{
        background: '#0f2340', borderRadius: 14, padding: '20px 24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
          ⚡ Power Automate Setup (one-time)
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
          If permissions aren't saving to Excel yet, follow these steps:
        </div>
        {[
          {
            n: '1', title: 'Add PermissionsTable to Excel',
            body: 'Open your OneDrive Excel file → add a new sheet → create a Table named PermissionsTable with columns: Email | Name | Dashboard | BD | Engagement | Ops | DashEdit | BDEdit | EngEdit | OpsEdit',
          },
          {
            n: '2', title: 'Create GET Permissions flow',
            body: 'New Instant Cloud Flow → HTTP trigger → "List rows present in a table" (your file + PermissionsTable) → Response action (body: outputs of list rows, 200). Copy the HTTP trigger URL.',
          },
          {
            n: '3', title: 'Create SAVE Permissions flow',
            body: 'New Instant Cloud Flow → HTTP trigger (body schema: {rows: [{Email,Name,...}]}) → "Apply to each" row: "Delete a row" (filter by Email) then "Add a row into a table". Copy the HTTP trigger URL.',
          },
          {
            n: '4', title: 'Paste URLs into the code',
            body: 'Open src/services/permissionsApi.js → replace GET_PERMISSIONS_URL and SAVE_PERMISSIONS_URL with your flow URLs. Save — done.',
          },
        ].map(step => (
          <div key={step.n} style={{
            display: 'flex', gap: 12, marginBottom: 12,
            background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: '#e8760a', color: '#fff',
              fontSize: 11, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{step.n}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>{step.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>{step.body}</div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
