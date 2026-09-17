import { useLocation, useNavigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions.js';

const NAV = [
  { path: '/',            page: 'dashboard',  icon: '📊', label: 'Dashboard'           },
  { path: '/bd-tracker',  page: 'bd',         icon: '🎯', label: 'BD Tracker'          },
  { path: '/solution',    page: 'solution',   icon: '💡', label: 'Solution Tracker'    },
  { path: '/engagement',  page: 'engagement', icon: '📅', label: 'Engagement Calendar' },
  { path: '/ops',         page: 'ops',        icon: '✔',  label: 'Ops Checklist'       },
  { path: '/content-dev', page: 'content-dev',icon: '📘', label: 'Content Dev Tracker' },
  { path: '/er-calendar',  page: 'engagement',  icon: '🗓️', label: 'ER Calendar'         },
];

export default function Sidebar() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isAdmin, canAccess } = usePermissions();

  // Only show pages the current user has access to
  const visibleNav = NAV.filter(n => isAdmin || canAccess(n.page));

  return (
    <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="sidebar-logo">
        <img
          src="/ER_Logo.jpg"
          alt="EuRadicle"
          style={{
            width: '100%',
            maxWidth: 160,
            height: 'auto',
            display: 'block',
            borderRadius: 8,
            objectFit: 'contain',
            marginBottom: 8,
          }}
        />
        <div className="logo-sub">CRM · Live Excel Connect</div>
      </div>

      <div className="sidebar-section-label">Main Menu</div>

      <nav>
        {visibleNav.length === 0 ? (
          <div style={{
            padding: '16px 20px',
            fontSize: 12,
            color: 'rgba(255,255,255,0.35)',
            lineHeight: 1.6,
          }}>
            No dashboards assigned.<br />Contact your admin.
          </div>
        ) : (
          visibleNav.map(n => (
            <div
              key={n.path}
              className={`nav-item ${location.pathname === n.path ? 'active' : ''}`}
              onClick={() => navigate(n.path)}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </div>
          ))
        )}
      </nav>

      {/* Push admin section to bottom */}
      <div style={{ flex: 1 }} />

      {/* Admin panel — only visible to the admin user */}
      {isAdmin && (
        <>
          <div className="sidebar-section-label">Admin</div>
          <nav>
            <div
              className={`nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              <span className="nav-icon">⚙️</span>
              <span>User Access Control</span>
            </div>
          </nav>
        </>
      )}

      <div className="sidebar-footer">
        <div>v1.0 · EuRadicle CRM</div>
        <div style={{ marginTop: 4, fontSize: 10 }}>Powered by Power Automate</div>
      </div>
    </aside>
  );
}
