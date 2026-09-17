/**
 * AuthGuard — shows LoginPage until MSAL confirms the user is authenticated.
 * Uses MSAL's built-in token cache (localStorage) so returning users are
 * signed in silently — no redirect, no prompt, instant access.
 */
import { useMsal, AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { useEffect } from 'react';
import { loginRequest, ALLOWED_DOMAINS, ALLOWED_EMAILS } from '../config/authConfig.js';
import LoginPage from './LoginPage.jsx';

function isAllowed(email = '') {
  const em = email.toLowerCase().trim();
  if (!em) return false;
  const domain = em.split('@')[1] || '';
  if (ALLOWED_EMAILS.length > 0) return ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(em);
  if (ALLOWED_DOMAINS.length > 0) return ALLOWED_DOMAINS.map(d => d.toLowerCase()).includes(domain);
  return true;
}

// Try every known MSAL claim field that might hold the email/UPN
function getEmail(account) {
  if (!account) return '';
  return (
    account.username ||
    account.idTokenClaims?.email ||
    account.idTokenClaims?.preferred_username ||
    account.idTokenClaims?.upn ||
    ''
  );
}

// Spinner shown while MSAL is still processing the redirect or silent SSO
function LoadingScreen() {
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
        animation: 'spin 0.8s linear infinite',
      }} />
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Signing you in…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function AuthGuard({ children }) {
  const { instance, accounts, inProgress } = useMsal();

  // Restore cached active account — safe here because MsalProvider has already
  // called initialize() by the time any component renders.
  useEffect(() => {
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts]);

  // Attempt silent SSO ONLY when MSAL is fully idle (not handling a redirect).
  // This uses the existing Microsoft browser session (Outlook/Teams) to sign in
  // the user transparently — no prompt, no redirect needed.
  useEffect(() => {
    if (inProgress === InteractionStatus.None && accounts.length === 0) {
      instance.ssoSilent(loginRequest).catch(() => {
        // No active Microsoft session in this browser — user will need to click Sign In
      });
    }
  }, [inProgress]);

  // While MSAL is handling the redirect response, show a loading screen
  // instead of flashing the login page for a split second.
  if (
    inProgress === InteractionStatus.HandleRedirect ||
    inProgress === InteractionStatus.SsoSilent
  ) {
    return <LoadingScreen />;
  }

  return (
    <>
      <AuthenticatedTemplate>
        {(() => {
          const email = getEmail(accounts[0]);
          console.log('[AuthGuard] email:', email, '| allowed:', isAllowed(email));

          // Email is empty → token exchange likely failed (400 from Azure).
          // Show loading screen; the redirect or ssoSilent will retry.
          if (!email) return <LoadingScreen />;

          if (!isAllowed(email)) return <LoginPage />;

          return children;
        })()}
      </AuthenticatedTemplate>

      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  );
}
