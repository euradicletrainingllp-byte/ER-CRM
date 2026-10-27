/**
 * Welcome screen: animated greeting, the customer journey with the person's own
 * access lit up, the other tools they have, and the ways to start.
 * Every lit tracker is clickable → a short tour of just that tracker.
 */
import { useEffect, useMemo, useState } from 'react';
import { Lock, Play, ArrowRight, MapPin, X, Clock } from 'lucide-react';
import { TOUR_PAGES, JOURNEY, TOOLS } from '../../config/tourSteps.js';
import { TourIcon } from './tourIcons.jsx';
import Mascot from './Mascot.jsx';
import { GUIDE_NAME } from '../../config/tourSteps.js';

function useTyped(text, speed = 45, delay = 350) {
  const [out, setOut] = useState('');
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setOut(text); return undefined; }
    let i = 0, iv;
    const t = setTimeout(() => { iv = setInterval(() => { i += 1; setOut(text.slice(0, i)); if (i >= text.length) clearInterval(iv); }, speed); }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [text, speed, delay]);
  return out;
}

function useCount(target, ms = 900, delay = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf, start;
    const t = setTimeout(() => {
      const step = ts => { start ??= ts; const p = Math.min(1, (ts - start) / ms); setN(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [target, ms, delay]);
  return n;
}

export default function WelcomeScreen({ firstName, pages, levels, currentPage, onStart, onPage, onClose }) {
  // Raddy waves hello, then settles into idle (tricks, petting, eyes follow the mouse)
  const [guidePose, setGuidePose] = useState('wave');
  useEffect(() => { const t = setTimeout(() => setGuidePose('idle'), 2800); return () => clearTimeout(t); }, []);
  const greeting = useTyped(firstName ? `Welcome, ${firstName}` : 'Welcome aboard');
  const journeyOpen = JOURNEY.filter(p => pages.includes(p)).length;
  const tools = TOOLS.filter(p => pages.includes(p));
  const editCount = pages.filter(p => levels[p] === 'Edit' || levels[p] === 'Full').length;
  const nJourney = useCount(journeyOpen, 800, 1100);
  const nTools = useCount(tools.length, 800, 1250);
  const nEdit = useCount(editCount, 800, 1400);
  const minutes = useMemo(() => Math.max(1, Math.round((pages.length * 8 + 12) / 60)), [pages]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="tw-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to the EuRadicle CRM">
      <div className="tw-card">
        <button type="button" className="tr-x tr-x-light tw-close" onClick={onClose} aria-label="Close"><X size={16} /></button>

        {/* Hero */}
        <div className="tw-hero">
          <span className="tw-orb tw-orb1" /><span className="tw-orb tw-orb2" /><span className="tw-orb tw-orb3" />
          <div className="tw-guide">
            <Mascot pose={guidePose} talking={guidePose === 'wave'} size={150} sleepAfter={25000} />
            <div className="tw-bubble">Hi, I'm {GUIDE_NAME}! Tap me for a pat, then let's go. One quick stop per tracker, about {minutes} min.</div>
          </div>
          <div className="tw-eyebrow"><MapPin size={12} /> Platform tour</div>
          <h1 className="tw-title">{greeting}<span className="tw-caret" /></h1>
          <p className="tw-sub">The EuRadicle CRM, laid out around the trackers opened for this account. A quick look before diving in.</p>
          <div className="tw-stats">
            <div><b>{nJourney}</b><span>journey trackers</span></div>
            <div><b>{nTools}</b><span>workspace tools</span></div>
            <div><b>{nEdit}</b><span>with edit rights</span></div>
          </div>
        </div>

        {/* Journey */}
        <div className="tw-body">
          <div className="tw-label">The customer journey <em>· tap any lit tracker for a quick tour of it</em></div>
          <div className="tw-journey">
            <div className="tw-line"><span className="tw-line-fill" /><span className="tw-runner" /></div>
            {JOURNEY.map((p, i) => {
              const cfg = TOUR_PAGES[p]; const lvl = levels[p];
              const delay = 0.55 + i * 0.13;
              return (
                <button
                  key={p} type="button" disabled={!lvl}
                  className={`tw-node${lvl ? ' on' : ''}${p === currentPage ? ' here' : ''}`}
                  style={{ animationDelay: `${delay}s` }}
                  onClick={() => lvl && onPage(p)}
                  title={lvl ? `Tour the ${cfg.label}` : `${cfg.label}: not opened for this account`}
                >
                  <span className="tw-node-dot">{lvl ? <TourIcon name={cfg.icon} size={20} /> : <Lock size={16} />}</span>
                  <span className="tw-node-step">{String(i + 1).padStart(2, '0')}</span>
                  <span className="tw-node-name">{cfg.label}</span>
                  {lvl ? <span className={`tr-level tr-level-${lvl.toLowerCase()}`}>{lvl}</span> : <span className="tw-node-off">No access</span>}
                </button>
              );
            })}
          </div>

          {tools.length > 0 && (
            <>
              <div className="tw-label tw-label-2">Workspace tools</div>
              <div className="tw-tools">
                {tools.map((p, i) => (
                  <button key={p} type="button" className={`tw-tool${p === currentPage ? ' here' : ''}`} style={{ animationDelay: `${1.5 + i * 0.08}s` }} onClick={() => onPage(p)} title={`Tour ${TOUR_PAGES[p].label}`}>
                    <TourIcon name={TOUR_PAGES[p].icon} size={15} />
                    <span>{TOUR_PAGES[p].label}</span>
                    <b className={`tr-level tr-level-${levels[p].toLowerCase()}`}>{levels[p]}</b>
                  </button>
                ))}
              </div>
            </>
          )}
          {!journeyOpen && !tools.length && (
            <div className="tw-empty">No trackers are opened for this account yet. Ask the admin for access in User Access Control.</div>
          )}
        </div>

        {/* Actions */}
        <div className="tw-foot">
          <div className="tw-time"><Clock size={13} /> About {minutes} min · {pages.length} stops · Esc to close</div>
          <div className="tw-actions">
            <button type="button" className="tw-link" onClick={onClose}>Skip for now</button>
            {currentPage && (
              <button type="button" className="tr-btn tr-btn-ghost tw-btn" onClick={() => onPage(currentPage)}>Tour this page</button>
            )}
            <button type="button" className="tr-btn tr-btn-ghost tw-btn" onClick={() => onStart(true)} disabled={!pages.length}><Play size={14} /> Watch it play</button>
            <button type="button" className="tr-btn tr-btn-next tw-btn tw-go" onClick={() => onStart(false)} disabled={!pages.length}>
              <span className="tr-next-label">Start guided tour <ArrowRight size={15} /></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
