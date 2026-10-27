/**
 * Spotlight overlay: dims the page, cuts a soft hole around the current element,
 * glides between elements, and shows the step card beside it.
 * Watch mode adds an animated pointer and auto-advances.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, Play, Pause, Check, Sparkles } from 'lucide-react';
import { TOUR_PAGES } from '../../config/tourSteps.js';
import { TourIcon } from './tourIcons.jsx';
import Mascot from './Mascot.jsx';
import { GUIDE_NAME } from '../../config/tourSteps.js';

const PAD = 8;              // space around the highlighted element
const EDGE = 10;            // keep the spotlight this far from the window edge
const CARD_W = 360;

/* ── Finding elements ────────────────────────────────────────────────────── */
function isVisible(n) {
  if (!n || !n.isConnected) return false;
  const r = n.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const s = getComputedStyle(n);
  return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
}
export function resolveTarget(targets = []) {
  for (const t of targets) {
    let node = null;
    try {
      if (t.startsWith('@button:')) {
        const re = new RegExp(t.slice(8), 'i');
        node = [...document.querySelectorAll('.page-content button, .page-content a.btn')]
          .find(b => re.test((b.textContent || '').trim()) && isVisible(b)) || null;
      } else if (t.startsWith('@parent:')) {
        node = document.querySelector(t.slice(8))?.parentElement || null;
      } else {
        node = [...document.querySelectorAll(t)].find(isVisible) || null;
      }
    } catch { node = null; }
    if (node && isVisible(node)) return node;
  }
  return null;
}

/* ── Geometry ────────────────────────────────────────────────────────────── */
function viewport() { return { w: window.innerWidth, h: window.innerHeight }; }
function holeFor(el) {
  const r = el.getBoundingClientRect(); const { w, h } = viewport();
  const top = Math.max(EDGE, r.top - PAD), left = Math.max(EDGE, r.left - PAD);
  const bottom = Math.min(h - EDGE, r.bottom + PAD), right = Math.min(w - EDGE, r.right + PAD);
  if (bottom - top < 12 || right - left < 12) return null;          // scrolled out of view
  return { top, left, width: right - left, height: bottom - top };
}
function placeCard(hole, cardH) {
  const { w, h } = viewport();
  const cw = Math.min(CARD_W, w - 24);
  if (w < 640) return { left: 12, top: h - cardH - 12, mode: 'sheet' };
  if (!hole) return { left: (w - cw) / 2, top: Math.max(16, (h - cardH) / 2), mode: 'center' };
  const gap = 16;
  const clampX = x => Math.min(Math.max(12, x), w - cw - 12);
  const clampY = y => Math.min(Math.max(12, y), h - cardH - 12);
  const spaces = {
    right:  w - (hole.left + hole.width) - gap,
    left:   hole.left - gap,
    below:  h - (hole.top + hole.height) - gap,
    above:  hole.top - gap,
  };
  // Sidebar items: always to the right
  if (hole.left < 250 && hole.width < 260 && spaces.right >= cw) return { left: hole.left + hole.width + gap, top: clampY(hole.top + hole.height / 2 - cardH / 2), mode: 'right' };
  if (spaces.below >= cardH) return { left: clampX(hole.left + hole.width / 2 - cw / 2), top: hole.top + hole.height + gap, mode: 'below' };
  if (spaces.above >= cardH) return { left: clampX(hole.left + hole.width / 2 - cw / 2), top: hole.top - gap - cardH, mode: 'above' };
  if (spaces.right >= cw)    return { left: hole.left + hole.width + gap, top: clampY(hole.top), mode: 'right' };
  if (spaces.left >= cw)     return { left: hole.left - gap - cw, top: clampY(hole.top), mode: 'left' };
  return { left: w - cw - 20, top: h - cardH - 20, mode: 'inside' };   // big element: sit in its corner
}

const PERCH = 104;  // room above the card where Raddy sits
const TRAVEL_MS = 1900;
const readMs = s => Math.min(8500, 2600 + ((s.title || '').length + (s.body || '').length) * 30);
const RIGHTS = [['create', 'Add'], ['update', 'Edit'], ['delete', 'Delete']];

/* typewriter for Raddy's speech */
function useTyped(text, key) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!text) { setN(0); return undefined; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return undefined; }
    setN(0);
    let i = 0;
    const iv = setInterval(() => { i += 2; setN(Math.min(i, text.length)); if (i >= text.length) clearInterval(iv); }, 18);
    return () => clearInterval(iv);
  }, [text, key]);
  return { shown: (text || '').slice(0, n), done: n >= (text || '').length, finish: () => setN((text || '').length) };
}

export default function TourOverlay({ steps, index, onIndex, onExpand, watch, onWatch, onFinish, onExit }) {
  const step = steps[index];
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef(null);
  const elRef = useRef(null);
  const dirRef = useRef(1);
  const idxRef = useRef(index); idxRef.current = index;

  const [status, setStatus] = useState('seeking');      // seeking | ready
  const [hole, setHole] = useState(null);
  const [cardH, setCardH] = useState(200);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [burst, setBurst] = useState(0);                 // sparkle when the glowing spot is tapped

  const cfg = step.page ? TOUR_PAGES[step.page] : null;
  const isTravel = step.kind === 'travel';
  const last = index === steps.length - 1;

  // Main stops (what the counter and passport count)
  const mains = steps.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'step' && !x.s.detail);
  const mainNo = mains.filter(x => x.i <= index).length;
  const stops = steps.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'travel');
  const typed = useTyped(status === 'ready' && !isTravel ? step.body : '', index);

  const go = useCallback(d => {
    dirRef.current = d;
    const next = idxRef.current + d;
    if (next >= steps.length) { onFinish(); return; }
    if (next < 0) return;
    onIndex(next);
  }, [steps.length, onIndex, onFinish]);
  const jump = i => { dirRef.current = i >= idxRef.current ? 1 : -1; onIndex(i); };

  /* 1 · open the right page (travel steps open it while Raddy runs) */
  useEffect(() => {
    if (step.path && location.pathname !== step.path) navigate(step.path);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 2 · travel: auto-continue (backwards it is skipped straight away) */
  useEffect(() => {
    if (!isTravel) return undefined;
    if (dirRef.current < 0) { if (index > 0) go(-1); else go(1); return undefined; }
    const t = setTimeout(() => go(1), TRAVEL_MS);
    return () => clearTimeout(t);
  }, [index, isTravel]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 3 · find the element (pages load data, so wait a little) */
  useEffect(() => {
    let cancelled = false, timer;
    setProgress(0); elRef.current = null;
    if (isTravel) return undefined;
    setStatus('seeking');
    if (!step.target) { setHole(null); setStatus('ready'); return undefined; }
    const started = Date.now();
    const limit = step.optional ? 3000 : 4500;
    const tick = () => {
      if (cancelled) return;
      const found = resolveTarget(step.target);
      if (found) {
        const r = found.getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 20) found.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: 'smooth' });
        timer = setTimeout(() => { if (!cancelled) { elRef.current = found; setHole(holeFor(found)); setStatus('ready'); } }, 300);
        return;
      }
      if (Date.now() - started > limit) {
        if (step.optional && idxRef.current + dirRef.current >= 0) { go(dirRef.current); return; }
        setHole(null); setStatus('ready'); return;
      }
      timer = setTimeout(tick, 140);
    };
    timer = setTimeout(tick, 60);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [index, steps]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 4 · follow the element while the page scrolls / resizes / re-renders */
  useEffect(() => {
    if (status !== 'ready' || isTravel || !step.target) return undefined;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let el = elRef.current;
        if (!el || !el.isConnected) { el = resolveTarget(step.target); elRef.current = el; }
        const h = el ? holeFor(el) : null;
        setHole(prev => (prev && h && Math.abs(prev.top - h.top) < 1 && Math.abs(prev.left - h.left) < 1
          && Math.abs(prev.width - h.width) < 1 && Math.abs(prev.height - h.height) < 1) ? prev : h);
      });
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const iv = setInterval(measure, 400);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); clearInterval(iv); cancelAnimationFrame(raf); };
  }, [status, index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 5 · card height for placement */
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight || 200);
  }, [index, status, hole?.width, watch, typed.done]);

  /* 6 · auto-play */
  useEffect(() => {
    if (!watch || isTravel || status !== 'ready' || paused) return undefined;
    const total = readMs(step);
    let startAt = Date.now() - progress * total;
    const iv = setInterval(() => {
      if (document.hidden) { startAt += 100; return; }
      const p = Math.min(1, (Date.now() - startAt) / total);
      setProgress(p);
      if (p >= 1) { clearInterval(iv); go(1); }
    }, 100);
    return () => clearInterval(iv);
  }, [watch, status, paused, index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 7 · keyboard */
  const next = useCallback(() => { if (!typed.done) typed.finish(); else go(1); }, [typed, go]);
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onExit(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (isTravel) go(1); else next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === ' ') { e.preventDefault(); onWatch(w => !w); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, next, onExit, onWatch, isTravel]);

  const tapSpot = () => { setBurst(b => b + 1); setTimeout(() => go(1), 650); };   // let Raddy celebrate first

  // Raddy looks toward the spotlight
  const pos = placeCard(hole, cardH + PERCH);
  const cardTop = pos.mode === 'sheet' ? undefined : pos.top + PERCH;
  const faceLeft = hole ? (hole.left + hole.width / 2) < pos.left + 40 : false;
  const canMore = !!step.more?.length && !step.expanded;
  const pose = status === 'seeking' ? 'sniff' : !typed.done ? 'talk' : step.outro ? 'wave' : index === 0 ? 'wave' : 'idle';

  return (
    <div className="tr-root" role="dialog" aria-modal="true" aria-label="Platform tour">
      <div className="tr-catcher" onClick={() => setNudge(n => n + 1)} />

      {/* spotlight */}
      <div
        className={`tr-spot${hole && !isTravel ? '' : ' tr-spot-off'}${isTravel ? ' tr-spot-deep' : ''}`}
        style={hole && !isTravel
          ? { top: hole.top, left: hole.left, width: hole.width, height: hole.height }
          : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 }}
      >
        {hole && !isTravel && <span className="tr-ring" key={`r${index}`} />}
        {burst > 0 && hole && <span className="tr-burst" key={`b${burst}`}>{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${i * 36}deg` }} />)}</span>}
      </div>
      {/* the glowing spot itself is a button: tap it to keep going (the page underneath is never touched) */}
      {hole && !isTravel && status === 'ready' && (
        <button type="button" className="tr-hit" aria-label="Continue" onClick={tapSpot}
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      )}

      {/* passport: one stamp per tracker, tap to jump */}
      {stops.length > 1 && (
        <div className="tr-passport">
          {stops.map(({ s, i }) => {
            const state = i < index ? 'done' : (i === index || (steps[index].page === s.page)) ? 'now' : '';
            return (
              <button type="button" key={s.page} className={`tr-stamp ${state}`} onClick={() => jump(i)} title={TOUR_PAGES[s.page].label}>
                <TourIcon name={TOUR_PAGES[s.page].icon} size={13} />
                {state === 'done' && <Check className="tr-stamp-tick" size={9} strokeWidth={3} />}
              </button>
            );
          })}
          <button type="button" className="tr-x tr-x-light tr-passport-x" onClick={onExit} aria-label="Close tour"><X size={14} /></button>
        </div>
      )}

      {isTravel ? (
        <Travel step={step} onSkip={() => go(1)} />
      ) : (
        <div
          className={`tr-card tr-pos-${pos.mode}${nudge ? ' tr-nudge' : ''}`} ref={cardRef}
          key={nudge ? `n${nudge}` : 'card'}
          style={pos.mode === 'sheet' ? undefined : { left: pos.left, top: cardTop }}
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        >
          <div className="tr-perch" key={`m${index}`}>
            <Mascot pose={pose} talking={!typed.done && status === 'ready'} size={window.innerWidth < 640 ? 96 : 124} flip={!!hole && !faceLeft} react={burst} sleepAfter={watch ? 0 : 20000} />
          </div>
          <div className="tr-card-head">
            <span className="tr-chip">
              {cfg ? <TourIcon name={cfg.icon} size={13} /> : <TourIcon name="Compass" size={13} />}
              {cfg ? cfg.label : GUIDE_NAME}
              {step.level && <b className={`tr-level tr-level-${step.level.toLowerCase()}`}>{step.level}</b>}
            </span>
            <span className="tr-count">{step.detail ? 'Extra' : `${mainNo} / ${mains.length}`}</span>
            <button type="button" className="tr-x" onClick={onExit} aria-label="Close tour"><X size={15} /></button>
          </div>
          <div key={`t${index}`}>
            {status === 'seeking' ? (
              <div className="tr-seeking"><span className="tr-dots"><i /><i /><i /></span>{GUIDE_NAME} is sniffing out {cfg?.label || 'the page'}…</div>
            ) : (
              <>
                <div className="tr-title">{step.title}</div>
                <div className="tr-body" onClick={typed.finish}>{typed.shown}{!typed.done && <span className="tr-typing" />}</div>
                {typed.done && (canMore || (hole && !isTravel)) && (
                  <div className="tr-extras">
                    {hole && <span className="tr-hint"><Sparkles size={12} /> Tap the glowing spot</span>}
                    {canMore && <button type="button" className="tr-more" onClick={() => onExpand(index)}>Show me more ({step.more.length}) <ChevronRight size={12} /></button>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="tr-bar"><span style={{ width: `${Math.round(((mainNo - 1 + (watch ? progress : 0) + 1) / mains.length) * 100)}%` }} /></div>
          <div className="tr-foot">
            <button type="button" className="tr-btn tr-btn-ghost" onClick={() => go(-1)} disabled={index === 0}><ChevronLeft size={15} /> Back</button>
            <button type="button" className={`tr-play${watch ? ' on' : ''}`} onClick={() => onWatch(w => !w)} title={watch ? 'Pause auto-play (Space)' : 'Auto-play (Space)'}>
              {watch && !paused ? <Pause size={13} /> : <Play size={13} />}
              <span>{watch ? (paused ? 'Paused' : 'Playing') : 'Auto-play'}</span>
            </button>
            <button type="button" className="tr-btn tr-btn-next" onClick={next}>
              {watch && <span className="tr-next-fill" style={{ width: `${Math.round(progress * 100)}%` }} />}
              <span className="tr-next-label">{last ? 'Finish' : 'Next'} {last ? <Check size={15} /> : <ChevronRight size={15} />}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Raddy runs across to the next tracker; a stamp slams onto the banner */
function Travel({ step, onSkip }) {
  const cfg = TOUR_PAGES[step.page];
  return (
    <div className="tt-wrap" onClick={onSkip} title="Tap to skip">
      <div className="tt-banner">
        <div className="tt-eyebrow">Stop {step.stop} of {step.stops}</div>
        <div className="tt-stamp"><TourIcon name={cfg.icon} size={30} /></div>
        <div className="tt-title">{cfg.label}</div>
        <div className="tt-tag">{cfg.tagline}</div>
        <div className="tt-rights">
          <span className="on"><Check size={11} /> View</span>
          {RIGHTS.map(([k, l], i) => (
            <span key={k} className={step.rights?.[k] ? 'on' : ''} style={{ animationDelay: `${0.5 + i * 0.1}s` }}>{step.rights?.[k] && <Check size={11} />} {l}</span>
          ))}
        </div>
      </div>
      <div className="tt-track">
        <span className="tt-dust" />
        <div className="tt-runner"><Mascot pose="run" size={124} pettable={false} tricks={false} followEyes={false} /></div>
      </div>
    </div>
  );
}
