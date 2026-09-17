/**
 * NoAccessPage
 * Shown when a signed-in user has no permission for a specific page,
 * or has no access to any dashboard at all.
 */
import { usePermissions } from '../hooks/usePermissions.js';

const LockIcon = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none"
    stroke="#AA78A6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

export default function NoAccessPage({ page }) {
  const { email } = usePermissions();

  const pageLabel = {
    dashboard:  'Dashboard',
    bd:         'BD Pipeline',
    engagement: 'Engagement Calendar',
    ops:        'Ops Checklist',
  }[page] || 'this page';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '40px 24px',
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: '48px 56px',
        maxWidth: 480,
        boxShadow: '0 2px 8px rgba(45,48,71,0.08)',
      }}>
        <div style={{ marginBottom: 20 }}>
          <LockIcon />
        </div>

        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#2D3047',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
        }}>
          Access Restricted
        </h2>

        <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.7, marginBottom: 8 }}>
          You don't have access to the <strong>{pageLabel}</strong>.
        </p>

        {email && (
          <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 20 }}>
            Signed in as <strong>{email}</strong>
          </p>
        )}

        <div style={{
          background: '#F2F2F2',
          borderRadius: 10,
          padding: '14px 20px',
          fontSize: 13,
          color: '#6B7280',
          lineHeight: 1.6,
        }}>
          Please contact your administrator at{' '}
          <a href="mailto:revanth.ram@euradicle.com"
            style={{ color: '#3E3264', fontWeight: 600, textDecoration: 'none' }}>
            revanth.ram@euradicle.com
          </a>{' '}
          to request access.
        </div>
      </div>
    </div>
  );
}
