/** Small prompt under the Tour button when new pages were opened for this person. */
import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { TOUR_PAGES } from '../../config/tourSteps.js';
import { TourIcon } from './tourIcons.jsx';

export default function WhatsNew({ pages, onShow, onLater }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const place = () => {
      const b = document.querySelector('[data-tour="tour-button"]')?.getBoundingClientRect();
      setPos(b ? { top: b.bottom + 10, right: Math.max(12, window.innerWidth - b.right) } : { top: 70, right: 20 });
    };
    const t = setTimeout(place, 900);
    window.addEventListener('resize', place);
    return () => { clearTimeout(t); window.removeEventListener('resize', place); };
  }, []);
  if (!pos) return null;
  return (
    <div className="tn-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="New in the CRM">
      <span className="tn-arrow" />
      <div className="tn-head"><Sparkles size={14} /> New for this account <button type="button" className="tr-x" onClick={onLater} aria-label="Later"><X size={14} /></button></div>
      <div className="tn-list">
        {pages.slice(0, 5).map((p, i) => (
          <span key={p} className="tn-item" style={{ animationDelay: `${0.15 + i * 0.08}s` }}><TourIcon name={TOUR_PAGES[p].icon} size={13} /> {TOUR_PAGES[p].label}</span>
        ))}
        {pages.length > 5 && <span className="tn-item">+{pages.length - 5} more</span>}
      </div>
      <div className="tn-actions">
        <button type="button" className="tr-btn tr-btn-ghost" onClick={onLater}>Later</button>
        <button type="button" className="tr-btn tr-btn-next" onClick={onShow}><span className="tr-next-label">Show me</span></button>
      </div>
    </div>
  );
}
