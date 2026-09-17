/**
 * LoginPage — one-click Microsoft SSO.
 * No OTP. No admin consent. Uses existing Microsoft/Outlook session silently.
 */
import { useState, useEffect } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest, ALLOWED_DOMAINS, ALLOWED_EMAILS } from '../config/authConfig.js';

function isAllowed(email = '') {
  const em = email.toLowerCase().trim();
  if (!em) return false;
  const domain = em.split('@')[1] || '';

  if (ALLOWED_EMAILS.length > 0) {
    return ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(em);
  }
  if (ALLOWED_DOMAINS.length > 0) {
    return ALLOWED_DOMAINS.map(d => d.toLowerCase()).includes(domain);
  }
  return true; // no restriction configured
}

/* ─── Access Denied screen ───────────────────────────────────────────────── */
function AccessDenied({ email, onLogout }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>🚫</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>
        Access Denied
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6, lineHeight: 1.6 }}>
        <strong>{email}</strong> is not authorised to access this CRM.
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24, lineHeight: 1.5 }}>
        Only{' '}
        {ALLOWED_DOMAINS.length > 0
          ? ALLOWED_DOMAINS.map(d => `@${d}`).join(', ')
          : 'authorised'}{' '}
        accounts can sign in. Contact your administrator.
      </div>
      <button
        onClick={onLogout}
        style={{
          width: '100%', padding: '12px 0', background: '#fff',
          color: '#dc2626', border: '1.5px solid #dc2626',
          borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        Sign out &amp; try a different account
      </button>
    </div>
  );
}

/* ─── Outer card wrapper ──────────────────────────────────────────────────── */
function LoginCard({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(140deg, #0f2340 0%, #1a3a5c 55%, #0f2340 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.03,
        backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
        backgroundSize: '28px 28px', pointerEvents: 'none',
      }} />
      <div style={{
        background: '#fff', borderRadius: 20,
        padding: '52px 46px', width: 420, maxWidth: '92vw',
        boxShadow: '0 28px 72px rgba(0,0,0,0.32)',
        textAlign: 'center', position: 'relative',
      }}>
        {/* Brand */}
        <div style={{ marginBottom: 30 }}>
          <div style={{
            display: 'inline-block', background: '#e8760a', color: '#fff',
            fontWeight: 800, fontSize: 18, padding: '5px 16px',
            borderRadius: 7, letterSpacing: 0.5, marginBottom: 10,
          }}>ER</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1a3a5c', marginBottom: 4 }}>
            EuRadicle CRM
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Talent &amp; Engagement Management</div>
        </div>
        <div style={{ width: 40, height: 2, background: '#e2e8f0', margin: '0 auto 28px' }} />
        {children}
      </div>
    </div>
  );
}

/* ─── Main LoginPage ──────────────────────────────────────────────────────── */
export default function LoginPage() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [accessDenied, setAccessDenied] = useState(false);
  const [deniedEmail,  setDeniedEmail]  = useState('');
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState('');

  // After redirect back from Microsoft — check domain
  useEffect(() => {
    if (isAuthenticated && accounts.length > 0) {
      const email = accounts[0].username || accounts[0].idTokenClaims?.email || '';
      if (!isAllowed(email)) {
        setDeniedEmail(email);
        setAccessDenied(true);
      }
    }
  }, [isAuthenticated, accounts]);

  // ssoSilent is handled by AuthGuard — do NOT call it here too or
  // MSAL throws "interaction_in_progress" when both run at the same time.

  const handleLogin = async () => {
    // If a redirect/silent-SSO is already in flight, wait a moment and retry once
    if (inProgress !== InteractionStatus.None) {
      setTimeout(handleLogin, 800);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await instance.loginRedirect(loginRequest);
      // Page redirects to Microsoft — no code runs after this
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('interaction_in_progress')) {
        // A previous redirect is still being processed — just wait
        setTimeout(() => { setBusy(false); setErr(''); }, 1500);
      } else {
        setErr(msg || 'Sign-in failed. Please try again.');
        setBusy(false);
      }
    }
  };

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  // Still processing the redirect response
  if (inProgress !== InteractionStatus.None && !isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0f2340',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        fontFamily: "'Segoe UI', sans-serif",
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: '#e8760a',
          borderRadius: '50%',
          animation: 'lpSpin 0.8s linear infinite',
        }} />
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Signing you in…</div>
        <style>{`@keyframes lpSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <LoginCard>
      {accessDenied ? (
        <AccessDenied email={deniedEmail} onLogout={handleLogout} />
      ) : (
        <div>
          <div style={{ fontSize: 14, color: '#475569', marginBottom: 26, lineHeight: 1.7 }}>
            Sign in with your <strong>Microsoft / Outlook account</strong>.
            If you're already signed into Outlook or Teams,
            this will complete <strong>instantly</strong>.
          </div>

          {err && (
            <div style={{
              background: '#fee2e2', color: '#991b1b', borderRadius: 8,
              padding: '10px 14px', fontSize: 13, marginBottom: 18, textAlign: 'left',
            }}>
              ⚠️ {err}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={busy}
            style={{
              width: '100%', padding: '13px 0',
              background: busy ? '#94a3b8' : '#0078d4',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 12,
              transition: 'background 0.2s',
            }}
          >
            {/* Microsoft logo squares */}
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
              <rect x="1"  y="1"  width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1"  width="9" height="9" fill="#7fba00"/>
              <rect x="1"  y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
          </button>

          <div style={{
            marginTop: 20, padding: '12px 14px',
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 8, fontSize: 12, color: '#166534', lineHeight: 1.6,
          }}>
            ✅ Already signed into <strong>Outlook or Teams</strong>?
            This completes in one click — no password, no OTP.
          </div>

          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 14, lineHeight: 1.5 }}>
            First-time users will see a one-time "Allow app" prompt from Microsoft.
            <br />No IT admin approval required.
          </div>
        </div>
      )}
    </LoginCard>
  );
}
