import { useMsal, useAccount } from '@azure/msal-react';

const TITLES = {
  '/':           'Dashboard',
  '/bd':         'BD Pipeline',
  '/engagement': 'Engagement Calendar',
  '/ops':        'Operations Checklist',
};

export default function TopBar({ path, lastRefreshed, onRefresh, loading }) {
  const title                  = TITLES[path] ?? 'EuRadicle CRM';
  const { instance, accounts } = useMsal();
  const account                = useAccount(accounts[0] || {});

  const email       = account?.username || account?.idTokenClaims?.email || '';
  const displayName = account?.name || email.split('@')[0] || 'User';

  // Build 2-letter initials from display name or email prefix
  const initials = displayName
    .split(/[\s.\-_]+/)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')
    .slice(0, 2) || 'ER';

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">

        {lastRefreshed && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Last synced: {lastRefreshed}
          </span>
        )}

        {onRefresh && (
          <button
            className="btn btn-outline btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Re-fetch data from Excel via Power Automate"
          >
            {loading ? '⏳' : '↺'} Refresh
          </button>
        )}

        <span className="pill">Live Excel</span>

        {/* User identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', lineHeight: 1.2 }}>
              {displayName}
            </div>
            <div style={{
              fontSize: 10, color: 'var(--muted)', lineHeight: 1.2,
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {email}
            </div>
          </div>

          <div
            className="avatar"
            title={`Signed in as ${displayName} (${email})`}
            style={{ background: '#e8760a', cursor: 'default', flexShrink: 0 }}
          >
            {initials}
          </div>

          <button
            onClick={handleLogout}
            title="Sign out"
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 7, padding: '5px 10px',
              fontSize: 12, color: 'var(--muted)',
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
