import { useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
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
import './styles/index.css';

/**
 * PermissionRoute — wraps a page with an access check.
 * Shows NoAccessPage if the signed-in user lacks access to that page key.
 * Admins always pass through.
 */
function PermissionRoute({ page, children }) {
  const { isAdmin, canAccess } = usePermissions();
  if (isAdmin || canAccess(page)) return children;
  return <NoAccessPage page={page} />;
}

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

function Shell() {
  const location = useLocation();
  const [lastRefreshed, setLastRefreshed] = useState('');
  const [loading,       setLoading]       = useState(false);

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
