/**
 * ENGAGEMENT CALENDAR — one page, two views
 * =========================================
 *   List     → cards grouped by month (add / edit / delete, KPIs)
 *   Calendar → month grids (ERCalendar.jsx → CalendarView), colour per client, click for details / edit
 * Both views live inside EngagementCalendar.jsx and share its loaded rows, period and filters —
 * switching never reloads anything.
 *
 * The view is kept in the URL (?view=calendar) so links and refresh keep it, and the last
 * choice is remembered in this browser. The old /er-calendar address redirects here.
 */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { List, CalendarDays } from 'lucide-react';
import EngagementCalendar from './EngagementCalendar.jsx';
import '../styles/leadsVendors.css';

const LS_KEY = 'ercrm.engagement.view';
const VIEWS = [['list', 'List', List], ['calendar', 'Calendar', CalendarDays]];
const remembered = () => { try { return localStorage.getItem(LS_KEY) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } };

export default function EngagementPage({ onRefreshed }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const view = asked === 'calendar' || asked === 'list' ? asked : remembered();

  useEffect(() => { try { localStorage.setItem(LS_KEY, view); } catch { /* storage blocked */ } }, [view]);

  const pick = v => {
    if (v === view) return;
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };

  const viewSwitch = (
    <div className="lv-tabs" role="tablist" aria-label="Engagement Calendar view">
      {VIEWS.map(([k, label, Icon]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''}
          onClick={() => pick(k)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon size={13} />{label}
        </button>
      ))}
    </div>
  );

  // One page, one data load: the view only changes how the same rows are drawn
  return <EngagementCalendar onRefreshed={onRefreshed} view={view} viewSwitch={viewSwitch} />;
}
