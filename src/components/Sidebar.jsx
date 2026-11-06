import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

const SB_KEY = 'ercrm.sidebar.collapsed.v1';
import { usePermissions } from '../hooks/usePermissions.js';

const NAV = [
  { path: '/',            page: 'dashboard',  icon: '📊', label: 'Dashboard'           },
  // Founder's Desk shows money too, so it needs Dashboard AND Finance view access
  { path: '/founder',     page: 'founder',    icon: '🧭', label: "Founder's Desk" },
  { path: '/tasks',       page: 'tasks',      icon: '✅', label: 'Project Management'  },
  { path: '/leads',       page: 'leads',      icon: '🧲', label: 'Lead Tracker'        },
  { path: '/bd-tracker',  page: 'bd',         icon: '🎯', label: 'BD Tracker'          },
  { path: '/solution',    page: 'solution',   icon: '💡', label: 'Solution Tracker'    },
  { path: '/engagement',  page: 'engagement', icon: '📅', label: 'Engagement Calendar' },
  { path: '/ops',         page: 'ops',        icon: '✔',  label: 'Ops Checklist'       },
  { path: '/finance',     page: 'finance',    icon: '💰', label: 'Finance Tracker'     },
  { path: '/content-dev', page: 'content-dev',icon: '📘', label: 'Content Dev Tracker' },
  { path: '/vendors',     page: 'vendors',    icon: '🧾', label: 'Vendor Services'     },
  { path: '/clients',     page: 'clients',    icon: '🏢', label: 'Client Directory'    },
  { path: '/po',          page: 'po',         icon: '🧾', label: 'PO Tracker' },
  { path: '/consultants', page: 'consultants',icon: '🧑‍🏫', label: 'Consultant Directory' },
];

export default function Sidebar() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isAdmin, canAccess } = usePermissions();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SB_KEY) === '1'; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('sb-collapsed', collapsed);
    try { localStorage.setItem(SB_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;

  // Only show pages the current user has access to
  const visibleNav = NAV.filter(n => isAdmin || (canAccess(n.page) && (n.also || []).every(p => canAccess(p))));

  return (
    <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="sidebar-logo">
        <button type="button" className="sb-toggle" onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
          <Toggle size={18} strokeWidth={1.75} />
        </button>
        <img
          src="/ER_Logo.png"
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
        <div className="logo-sub">Customer Relationship Management</div>
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
              data-tour-nav={n.page}
              className={`nav-item ${location.pathname === n.path ? 'active' : ''}`}
              onClick={() => navigate(n.path)}
              title={collapsed ? n.label : undefined}
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
              data-tour-nav="admin"
              className={`nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
              onClick={() => navigate('/admin')}
              title={collapsed ? 'User Access Control' : undefined}
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
