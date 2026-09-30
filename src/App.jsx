import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType, InteractionType } from '@azure/msal-browser';
import { msalConfig } from './config/authConfig.js';
import AuthGuard          from './components/AuthGuard.jsx';
import Sidebar            from './components/Sidebar.jsx';
import TopBar             from './components/TopBar.jsx';
import Dashboard          from './pages/Dashboard.jsx';
import EngagementCalendar from './pages/EngagementCalendar.jsx';
import OpsChecklist          from './pages/OpsChecklist.jsx';
import ContentDevelopmentTracker from './pages/ContentDevelopmentTracker.jsx';
import SolutionTracker        from './pages/SolutionTracker.jsx';
import AdminPage             from './pages/AdminPage.jsx';
import ERCalendar            from './pages/ERCalendar.jsx';
import NoAccessPage       from './pages/NoAccessPage.jsx';
import { PermissionsProvider } from './context/PermissionsContext.jsx';
import { usePermissions } from './hooks/usePermissions.js';
import { logEvent, setAuditUser, firstTimeThisSession, AUDIT_OPTIONS } from './services/auditLogger.js';
import './styles/index.css';

/**
 * PermissionRoute — wraps a page with an access check.
 * Shows NoAccessPage if the signed-in user lacks access to that page key.
 * Admins always pass through.
 */
function PermissionRoute({ page, children }) {
  const { isAdmin, canAccess } = usePermissions();
  if (isAdmin || canAccess(page)) return children;
  return <DeniedPage page={page} />;
}

// Activity log: record the blocked page, then show the normal No Access page
function DeniedPage({ page }) {
  useEffect(() => {
    logEvent({ Category: 'ACCESS', Action: 'PAGE_DENIED', Module: page, RecordLabel: window.location.pathname, Result: 'FAILED' });
  }, [page]);
  return <NoAccessPage page={page} />;
}

// Activity log: page key for each route (used for PAGE_VIEW rows)
const ROUTE_MODULE = {
  '/': 'dashboard', '/bd-tracker': 'bd', '/engagement': 'engagement', '/ops': 'ops',
  '/content-dev': 'content-dev', '/solution': 'solution', '/er-calendar': 'engagement', '/admin': 'permissions',
};

// Initialise MSAL once at module level.
// IMPORTANT: Do NOT call getAllAccounts() or any other MSAL method here —
// the instance is not initialized yet. MsalProvider calls initialize()
// internally. Account restoration happens inside AuthGuard via useEffect.
const msalInstance = new PublicClientApplication(msalConfig);

// addEventCallback is safe before initialize() — it just queues the listener.
msalInstance.addEventCallback(event => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload?.account) {
    msalInstance.setActiveAccount(event.payload.account);
  }
});

// Activity log: sign-in success / failure (never affects sign-in itself)
msalInstance.addEventCallback(event => {
  try {
    if (event.eventType === EventType.LOGIN_SUCCESS) {
      setAuditUser(event.payload?.account || event.payload);
      firstTimeThisSession('start');   // so AuthGuard does not also log SESSION_RESUMED
      logEvent({
        Category: 'AUTH', Module: 'auth',
        Action: event.interactionType === InteractionType.Silent ? 'LOGIN_SSO' : 'LOGIN',
      });
    } else if (
      event.eventType === EventType.ACQUIRE_TOKEN_FAILURE &&
      event.interactionType !== InteractionType.Silent      // silent SSO misses are normal
    ) {
      logEvent({
        Category: 'AUTH', Action: 'LOGIN_FAILED', Module: 'auth', Result: 'FAILED',
        ErrorMessage: event.error?.errorCode || event.error?.message || 'Sign-in failed',
      });
    }
  } catch { /* ignore */ }
});

function Shell() {
  const location = useLocation();
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [loading,       setLoading]       = useState(false);

  // Activity log: one PAGE_VIEW row per page opened
  useEffect(() => {
    if (!AUDIT_OPTIONS.logPageViews) return;
    logEvent({ Category: 'ACCESS', Action: 'PAGE_VIEW', Module: ROUTE_MODULE[location.pathname] || 'other', RecordLabel: location.pathname });
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <TopBar path={location.pathname} lastRefreshed={lastRefreshed} loading={loading} />
        <main className="page-content">
          <Routes>
            <Route path="/" element={
              <PermissionRoute page="dashboard">
                <Dashboard onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/bd-tracker" element={
              <PermissionRoute page="bd">
                <SolutionTracker view="bd" onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/engagement" element={
              <PermissionRoute page="engagement">
                <EngagementCalendar onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/ops" element={
              <PermissionRoute page="ops">
                <OpsChecklist onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/content-dev" element={
              <PermissionRoute page="content-dev">
                <ContentDevelopmentTracker onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/solution" element={
              <PermissionRoute page="solution">
                <SolutionTracker view="sol" onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/er-calendar" element={
              <PermissionRoute page="engagement">
                <ERCalendar onRefreshed={setLastRefreshed} />
              </PermissionRoute>
            } />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <BrowserRouter>
        <AuthGuard>
          <PermissionsProvider>
            <Shell />
          </PermissionsProvider>
        </AuthGuard>
      </BrowserRouter>
    </MsalProvider>
  );
}
