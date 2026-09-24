/**
 * AdminPage — User access & CRUD permission management.
 * Only reachable by the admin email defined in permissions.js.
 *
 * Permission model: 4 individual operations per page per user.
 *   C = Create   R = Read   U = Update   D = Delete
 */
import { useState, useEffect } from 'react';
import { usePermissions } from '../hooks/usePermissions.js';
import { DeleteButton } from '../components/ActionButtons.jsx';
import { ADMIN_EMAIL } from '../config/permissions.js';
import { usePermissionsContext } from '../context/PermissionsContext.jsx';

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGES = [
  { key: 'dashboard',   label: 'Dashboard',           icon: '📊' },
  { key: 'bd',          label: 'BD Tracker',          icon: '🎯' },
  { key: 'engagement',  label: 'Engagement',           icon: '📅' },
  { key: 'ops',         label: 'Ops Checklist',        icon: '✔'  },
  { key: 'content-dev', label: 'Content Dev',          icon: '📘' },
  { key: 'solution',    label: 'Solution',             icon: '💡' },
];

const OPS = [
  { key: 'create', label: 'Create', short: 'C', color: '#16a34a' },
  { key: 'read',   label: 'Read',   short: 'R', color: '#2563eb' },
  { key: 'update', label: 'Update', short: 'U', color: '#d97706' },
  { key: 'delete', label: 'Delete', short: 'D', color: '#dc2626' },
];

function emptyCrudPage() {
  return { create: false, read: false, update: false, delete: false };
}
function emptyUserCrud() {
  return Object.fromEntries(PAGES.map(p => [p.key, emptyCrudPage()]));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function permsToUsers(permsObj) {
  return Object.entries(permsObj).map(([email, cfg]) => ({
    email,
    name: cfg.name || email.split('@')[0],
    crud: Object.fromEntries(
      PAGES.map(p => [p.key, { ...emptyCrudPage(), ...cfg.crud?.[p.key] }])
    ),
  }));
}

function usersToPerms(users) {
  return Object.fromEntries(
    users.map(u => [u.email, { name: u.name, crud: { ...u.crud } }])
  );
}

// ─── Mini CRUD toggle (colored checkbox-style) ────────────────────────────────
function CrudBit({ op, checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      title={`${op.label}: ${checked ? 'ON' : 'OFF'}`}
      style={{
        width: 28, height: 22, borderRadius: 5,
        border: checked ? `2px solid ${op.color}` : '2px solid #cbd5e1',
        background: checked ? op.color : '#f8fafc',
        color: checked ? '#fff' : '#94a3b8',
        fontSize: 10, fontWeight: 800, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all .15s', outline: 'none',
        userSelect: 'none',
      }}
    >
      {op.short}
    </button>
  );
}

// ─── 2×2 CRUD grid for a single page ─────────────────────────────────────────
function CrudCell({ crud, onToggle, disabled }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, justifyItems: 'center' }}>
      {OPS.map(op => (
        <CrudBit
          key={op.key}
          op={op}
          checked={disabled || !!crud[op.key]}
          onChange={val => onToggle(op.key, val)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

// ─── Toggle switch (used for "select all" helpers) ────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        disabled={disabled} style={{ display: 'none' }} />
      <span style={{
        width: 34, height: 18, borderRadius: 9, position: 'relative', transition: 'background .2s',
        background: checked ? '#e8760a' : '#cbd5e1',
        opacity: disabled ? 0.4 : 1, flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 1, left: checked ? 17 : 1,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </span>
    </label>
  );
}

// ─── Access Denied ─────────────────────────────────────────────────────────────
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
  const [newCrud,  setNewCrud]  = useState(emptyUserCrud);
  const [addErr,   setAddErr]   = useState('');

  useEffect(() => {
    if (!loading) setUsers(permsToUsers(permissions));
  }, [loading]);

  const applyUsers = async (nextUsers) => {
    setUsers(nextUsers);
    setSaving(true); setSaved(false);
    await updatePermissions(usersToPerms(nextUsers));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!isAdmin) return <AccessDenied />;

  // ── Mutators ──────────────────────────────────────────────────────────────
  const toggleCrud = (i, page, op, val) =>
    applyUsers(users.map((usr, idx) =>
      idx !== i ? usr : {
        ...usr,
        crud: { ...usr.crud, [page]: { ...usr.crud[page], [op]: val } },
      }
    ));

  const setAllOpsForPage = (i, page, val) =>
    applyUsers(users.map((usr, idx) =>
      idx !== i ? usr : {
        ...usr,
        crud: { ...usr.crud, [page]: { create: val, read: val, update: val, delete: val } },
      }
    ));

  const removeUser = (i) => applyUsers(users.filter((_, idx) => idx !== i));

  const addUser = () => {
    setAddErr('');
    const em = newEmail.toLowerCase().trim();
    if (!em || !em.includes('@')) { setAddErr('Enter a valid email address.'); return; }
    if (users.find(u => u.email === em)) { setAddErr('This email is already in the list.'); return; }
    applyUsers([...users, {
      email: em, name: newName.trim() || em.split('@')[0],
      crud: { ...newCrud },
    }]);
    setNewEmail(''); setNewName(''); setNewCrud(emptyUserCrud());
  };

  const nonAdminUsers = users.filter(u => u.email !== ADMIN_EMAIL.toLowerCase());
  const totalAccess   = nonAdminUsers.filter(u => PAGES.some(p => u.crud[p.key]?.read)).length;

  // grid: user-col + 6 page-cols + action-col
  const GRID = `200px repeat(${PAGES.length}, 100px) 44px`;

  return (
    <div style={{ padding: '28px 24px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
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
          Grant <strong>Create · Read · Update · Delete</strong> permissions per page per user.
          Changes auto-save to your Excel <strong>PermissionsTable</strong> via Power Automate.
        </p>

        {/* CRUD legend */}
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          {OPS.map(op => (
            <div key={op.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 22, height: 18, borderRadius: 4, background: op.color,
                color: '#fff', fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{op.short}</div>
              <span style={{ fontSize: 11, color: '#64748b' }}>{op.label}</span>
            </div>
          ))}
        </div>

        {saving && <div style={{ marginTop: 8, fontSize: 12, color: '#e8760a', fontWeight: 600 }}>⏳ Saving to Excel…</div>}
        {saved && !saving && <div style={{ marginTop: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Saved to Excel</div>}
        {saveError && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626', background: '#fee2e2', padding: '6px 10px', borderRadius: 6 }}>
            ⚠️ {saveError} — check your PA flow URLs in permissionsApi.js
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total users',   value: nonAdminUsers.length,                         color: '#0f2340' },
          { label: 'With read access', value: totalAccess,                               color: '#16a34a' },
          { label: 'No access yet', value: nonAdminUsers.length - totalAccess,           color: '#dc2626' },
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

      {/* ── Permissions Table ─────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 28,
      }}>
        {/* scrollable wrapper */}
        <div style={{ overflowX: 'auto' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: GRID,
            background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
            padding: '10px 16px', gap: 6,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>User</div>
            {PAGES.map(p => (
              <div key={p.key} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1a3a5c', textTransform: 'uppercase' }}>
                  {p.icon} {p.label}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                  {OPS.map(op => (
                    <div key={op.key} style={{
                      width: 28, height: 16, borderRadius: 3, background: op.color,
                      color: '#fff', fontSize: 9, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{op.short}</div>
                  ))}
                </div>
              </div>
            ))}
            <div />
          </div>

          {/* User rows */}
          {users.map((user, i) => {
            const isAdminRow = user.email === ADMIN_EMAIL.toLowerCase();
            return (
              <div key={user.email} style={{
                display: 'grid', gridTemplateColumns: GRID,
                padding: '12px 16px', gap: 8, alignItems: 'center',
                borderBottom: '1px solid #f1f5f9',
                background: isAdminRow ? '#fffbf5' : 'transparent',
                minWidth: 900,
              }}>
                {/* User info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: isAdminRow ? '#e8760a' : '#1a3a5c',
                    color: '#fff', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {(user.name || user.email).split(/[\s.]+/).map(w => w[0]?.toUpperCase()).join('').slice(0, 2)}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a3a5c', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {user.name}
                      {isAdminRow && (
                        <span style={{
                          fontSize: 9, background: '#e8760a', color: '#fff',
                          borderRadius: 4, padding: '1px 5px', fontWeight: 700,
                        }}>ADMIN</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.email}
                    </div>
                  </div>
                </div>

                {/* CRUD cells */}
                {PAGES.map(p => (
                  <div key={p.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <CrudCell
                      crud={user.crud[p.key]}
                      onToggle={(op, val) => toggleCrud(i, p.key, op, val)}
                      disabled={isAdminRow}
                    />
                    {/* "All" shortcut */}
                    {!isAdminRow && (
                      <button
                        onClick={() => {
                          const allOn = OPS.every(op => user.crud[p.key][op.key]);
                          setAllOpsForPage(i, p.key, !allOn);
                        }}
                        title={OPS.every(op => user.crud[p.key][op.key]) ? 'Remove all' : 'Grant all'}
                        style={{
                          fontSize: 9, color: '#94a3b8', background: 'none', border: 'none',
                          cursor: 'pointer', textDecoration: 'underline', padding: 0,
                        }}
                      >
                        {OPS.every(op => user.crud[p.key][op.key]) ? 'none' : 'all'}
                      </button>
                    )}
                  </div>
                ))}

                {/* Remove */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {!isAdminRow && (
                    <DeleteButton iconOnly title="Remove user" onClick={() => removeUser(i)} />
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
      </div>

      {/* ── Add User ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
        padding: '20px 24px', marginBottom: 28,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a3a5c', marginBottom: 14 }}>
          ➕ Add New User
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            type="email" placeholder="Email address *"
            value={newEmail} onChange={e => setNewEmail(e.target.value)}
            style={{ flex: '1 1 220px', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
          />
          <input
            type="text" placeholder="Display name (optional)"
            value={newName} onChange={e => setNewName(e.target.value)}
            style={{ flex: '1 1 160px', padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
          />
        </div>

        {/* CRUD cards for new user */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {PAGES.map(p => (
            <div key={p.key} style={{
              background: '#f8fafc', borderRadius: 10, padding: '12px 14px',
              border: '1px solid #e2e8f0', minWidth: 128,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a5c', marginBottom: 8 }}>
                {p.icon} {p.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {OPS.map(op => (
                  <div key={op.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CrudBit
                      op={op}
                      checked={!!newCrud[p.key]?.[op.key]}
                      onChange={val => setNewCrud(prev => ({
                        ...prev, [p.key]: { ...prev[p.key], [op.key]: val },
                      }))}
                    />
                    <span style={{ fontSize: 10, color: '#64748b' }}>{op.label}</span>
                  </div>
                ))}
              </div>
              {/* Grant all shortcut */}
              <button
                onClick={() => {
                  const allOn = OPS.every(op => newCrud[p.key]?.[op.key]);
                  setNewCrud(prev => ({
                    ...prev,
                    [p.key]: { create: !allOn, read: !allOn, update: !allOn, delete: !allOn },
                  }));
                }}
                style={{
                  marginTop: 6, fontSize: 10, color: '#e8760a', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0,
                }}
              >
                {OPS.every(op => newCrud[p.key]?.[op.key]) ? 'Remove all' : 'Grant all'}
              </button>
            </div>
          ))}
        </div>

        {addErr && (
          <div style={{
            background: '#fee2e2', color: '#991b1b', borderRadius: 8,
            padding: '8px 12px', fontSize: 12, marginBottom: 12,
          }}>⚠️ {addErr}</div>
        )}

        <button onClick={addUser} style={{
          background: '#1a3a5c', color: '#fff', border: 'none',
          borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>
          Add User
        </button>
      </div>

      {/* ── PA Setup Guide ────────────────────────────────────────────────── */}
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
            n: '1', title: 'Update PermissionsTable columns in Excel',
            body: 'Add these 24 columns to your PermissionsTable (after Email & Name): DashCreate | DashRead | DashUpdate | DashDelete | BDCreate | BDRead | BDUpdate | BDDelete | EngCreate | EngRead | EngUpdate | EngDelete | OpsCreate | OpsRead | OpsUpdate | OpsDelete | ContentDevCreate | ContentDevRead | ContentDevUpdate | ContentDevDelete | SolCreate | SolRead | SolUpdate | SolDelete. Use the provided Excel template.',
          },
          {
            n: '2', title: 'Update GET Permissions flow',
            body: 'The GET flow returns all Excel rows as JSON — no changes needed if it already returns all columns. Just make sure the flow body includes the new CRUD columns.',
          },
          {
            n: '3', title: 'Update SAVE Permissions flow',
            body: 'Update the SAVE flow body schema to accept the 24 new CRUD columns. The "Apply to each" upsert logic stays the same — just add the new column names to the "Add a row" action.',
          },
          {
            n: '4', title: 'Paste URLs into the code',
            body: 'Open src/services/permissionsApi.js → replace GET_PERMISSIONS_URL and SAVE_PERMISSIONS_URL with your flow URLs (already set if migrating from the old 2-level system).',
          },
        ].map(step => (
          <div key={step.n} style={{
            display: 'flex', gap: 12, marginBottom: 12,
            background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: '#e8760a', color: '#fff', fontSize: 11, fontWeight: 800,
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
