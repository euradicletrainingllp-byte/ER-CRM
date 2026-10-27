/** Finish screen: a short celebration, what was covered, and how to replay. */
import { useEffect, useMemo, useState } from 'react';
import { Compass, RotateCcw, X } from 'lucide-react';
import { TOUR_PAGES } from '../../config/tourSteps.js';
import { TourIcon } from './tourIcons.jsx';
import Mascot from './Mascot.jsx';

const COLORS = ['#2D3047', '#3E3264', '#AA78A6', '#00CED1', '#D0A616'];

export default function FinishScreen({ firstName, pages, mode, onReplay, onClose }) {
  const bits = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    x: (Math.random() * 2 - 1) * 320, y: -(140 + Math.random() * 260), r: Math.random() * 540 - 270,
    d: 0.1 + Math.random() * 0.35, c: COLORS[i % COLORS.length], w: 5 + Math.random() * 6, round: i % 3 === 0,
  })), []);

  // a fresh burst of hearts every couple of seconds
  const [love, setLove] = useState(0);
  useEffect(() => { const iv = setInterval(() => setLove(n => n + 1), 1900); setLove(1); return () => clearInterval(iv); }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = mode === 'full' ? (firstName ? `All set, ${firstName}` : 'All set')
    : mode === 'new' ? 'New pages covered' : `${TOUR_PAGES[pages[0]]?.label || 'Page'} covered`;

  return (
    <div className="tw-backdrop" role="dialog" aria-modal="true" aria-label="Tour complete" onClick={onClose}>
      <div className="tf-card" onClick={e => e.stopPropagation()}>
        <div className="tf-burst" aria-hidden="true">
          {bits.map((b, i) => (
            <i key={i} style={{
              '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.r}deg`, animationDelay: `${b.d}s`,
              background: b.c, width: b.w, height: b.round ? b.w : b.w * 0.45, borderRadius: b.round ? '50%' : 2,
            }} />
          ))}
        </div>
        <button type="button" className="tr-x tf-close" onClick={onClose} aria-label="Close"><X size={15} /></button>
        <div className="tf-guide">
          <Mascot pose="cheer" size={150} react={love} tricks={false} />
          <svg className="tf-check" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="28" />
            <path d="M20 33l8 8 16-17" />
          </svg>
        </div>
        <div className="tf-title">{title}</div>
        <div className="tf-sub">Passport stamped! Everything shown is live, so the best next step is to open a tracker and start working.</div>
        <div className="tf-chips">
          {pages.map((p, i) => (
            <span key={p} className="tf-chip" style={{ animationDelay: `${0.5 + i * 0.07}s` }}>
              <TourIcon name={TOUR_PAGES[p].icon} size={13} /> {TOUR_PAGES[p].label}
            </span>
          ))}
        </div>
        <div className="tf-tip"><Compass size={15} /><span>Replay anytime from the <b>Tour</b> button at the top right, or tour a single tracker from there.</span></div>
        <div className="tf-actions">
          <button type="button" className="tr-btn tr-btn-ghost" onClick={onReplay}><RotateCcw size={14} /> Replay</button>
          <button type="button" className="tr-btn tr-btn-next" onClick={onClose}><span className="tr-next-label">Start working</span></button>
        </div>
      </div>
    </div>
  );
}
