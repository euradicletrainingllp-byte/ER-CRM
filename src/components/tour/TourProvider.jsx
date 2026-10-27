/**
 * PLATFORM TOUR — engine
 * ======================
 * Phases: idle → welcome → tour → finish
 *  • Auto-opens the welcome screen the first time a person signs in (per browser, per email).
 *  • Later, when new pages are opened for them, a small "What's new" prompt appears under the Tour button.
 *  • The Tour button in the header opens the welcome screen any time (useTour().openWelcome).
 * Read-only: the tour navigates and highlights, it never clicks, types or saves anything.
 * Activity log: TOUR_STARTED / TOUR_COMPLETED / TOUR_SKIPPED (Category SYSTEM, Module tour).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { usePermissions } from '../../hooks/usePermissions.js';
import { usePermissionsContext } from '../../context/PermissionsContext.jsx';
import { logEvent } from '../../services/auditLogger.js';
import { TOUR_PAGES, TOUR_VERSION, QUICK_INTRO, QUICK_OUTRO, quickStep, accessLevel, accessiblePages } from '../../config/tourSteps.js';
import WelcomeScreen from './WelcomeScreen.jsx';
import TourOverlay from './TourOverlay.jsx';
import FinishScreen from './FinishScreen.jsx';
import WhatsNew from './WhatsNew.jsx';
import '../../styles/tour.css';

const TourCtx = createContext(null);
export function useTour() {
  return useContext(TourCtx) || { openWelcome() {}, active: false, hasNew: false };
}

/* ── Progress kept per browser + email ───────────────────────────────────── */
const keyFor = email => `ercrm.tour.${email || 'anon'}`;
function readState(email) {
  try { const v = JSON.parse(localStorage.getItem(keyFor(email)) || 'null'); return v && v.v === TOUR_VERSION ? v : null; }
  catch { return null; }
}
function writeState(email, patch) {
  try {
    const cur = readState(email) || { v: TOUR_VERSION, done: false, seen: [] };
    const next = { ...cur, ...patch, v: TOUR_VERSION, at: new Date().toISOString() };
    next.seen = [...new Set(next.seen || [])];
    localStorage.setItem(keyFor(email), JSON.stringify(next));
  } catch { /* storage blocked — tour simply shows again next time */ }
}

/* ── Step list for a run ─────────────────────────────────────────────────────
   Quick by design: intro → for each page a "travel" (auto, Raddy runs to the next
   stop) + ONE main stop → outro. The page's detailed steps sit in `more` and are
   spliced in only when "Show me more" is tapped. */
function detailSteps(p, perm, level, rights) {
  return TOUR_PAGES[p].steps
    .filter(s => !(s.needs === 'create' && !rights.create) && !(s.needs === 'edit' && !(rights.create || rights.update || rights.delete)))
    .map(s => ({ ...s, kind: 'step', detail: true, page: p, path: TOUR_PAGES[p].path, level, body: level === 'View' && s.viewBody ? s.viewBody : s.body }));
}
function buildSteps(pages, perm, { intro, outro }) {
  const out = [];
  if (intro) out.push({ ...QUICK_INTRO, kind: 'step', page: null, path: null, optional: false });
  pages.forEach((p, ci) => {
    const cfg = TOUR_PAGES[p];
    const level = accessLevel(perm, p);
    const rights = {
      create: perm.isAdmin || perm.canCreate(p),
      update: perm.isAdmin || perm.canUpdate(p),
      delete: perm.isAdmin || perm.canDelete(p),
    };
    out.push({ kind: 'travel', page: p, path: cfg.path, stop: ci + 1, stops: pages.length, level, rights });
    const q = quickStep(p);
    const more = detailSteps(p, perm, level, rights);
    const single = !intro && pages.length === 1;      // "tour this page": show the details straight away
    out.push({
      ...q, kind: 'step', page: p, path: cfg.path, level, rights,
      body: level === 'View' && q.viewBody ? q.viewBody : q.body,
      more, expanded: single,
    });
    if (single) out.push(...more);
  });
  if (outro) out.push({ ...QUICK_OUTRO, kind: 'step', page: null, path: null, outro: true });
  return out;
}

export function TourProvider({ children }) {
  const perm = usePermissions();
  const { loading } = usePermissionsContext();
  const { accounts } = useMsal();
  const location = useLocation();
  const email = perm.email;
  const fullName = accounts[0]?.name || email.split('@')[0] || '';
  const firstName = (fullName.split(/[\s.]+/)[0] || '').replace(/^\w/, c => c.toUpperCase());

  const pages = useMemo(() => accessiblePages(perm), [perm.isAdmin, perm.crud]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = useMemo(() => Object.fromEntries(Object.keys(TOUR_PAGES).map(p => [p, pages.includes(p) ? accessLevel(perm, p) : null])),
    [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const [phase, setPhase] = useState('idle');           // idle | welcome | tour | finish
  const [run, setRun]     = useState(null);             // { steps, mode, pages }
  const [index, setIndex] = useState(0);
  const [watch, setWatch] = useState(false);
  const [newPages, setNewPages] = useState([]);         // for "What's new"
  const autoDone = useRef(false);

  // First sign-in → welcome; returning person with new pages → "What's new"
  useEffect(() => {
    if (autoDone.current || loading || !email || !pages.length) return;
    autoDone.current = true;
    const st = readState(email);
    if (!st) {
      const t = setTimeout(() => setPhase(p => (p === 'idle' ? 'welcome' : p)), 1400);
      return () => clearTimeout(t);
    }
    const fresh = pages.filter(p => !(st.seen || []).includes(p));
    if (fresh.length) setNewPages(fresh);
  }, [loading, email, pages]);

  const openWelcome = useCallback(() => { setNewPages([]); setPhase('welcome'); }, []);

  const start = useCallback(({ pages: list, mode = 'full', watch: w = false }) => {
    const steps = buildSteps(list, perm, { intro: mode === 'full', outro: mode === 'full' });
    if (!steps.length) return;
    setRun({ steps, mode, pages: list });
    setIndex(0);
    setWatch(w);
    setNewPages([]);
    setPhase('tour');
    logEvent({ Category: 'SYSTEM', Action: 'TOUR_STARTED', Module: 'tour', RecordLabel: `${mode}${w ? ' · watch' : ''} · ${list.join(', ')}` });
  }, [perm]);

  // "Show me more": splice the page's detailed steps in right after the current stop
  const expand = useCallback(i => {
    setRun(r => {
      if (!r) return r;
      const cur = r.steps[i];
      if (!cur?.more?.length || cur.expanded) return r;
      const steps = [...r.steps.slice(0, i), { ...cur, expanded: true }, ...cur.more, ...r.steps.slice(i + 1)];
      return { ...r, steps };
    });
    setIndex(i + 1);
  }, []);

  const finish = useCallback(() => {
    const st = readState(email);
    writeState(email, { done: true, seen: [...(st?.seen || []), ...(run?.mode === 'full' ? pages : run?.pages || [])] });
    logEvent({ Category: 'SYSTEM', Action: 'TOUR_COMPLETED', Module: 'tour', RecordLabel: `${run?.mode} · ${run?.steps.length} steps` });
    setPhase('finish');
  }, [email, run, pages]);

  const exitTour = useCallback(() => {
    const st = readState(email);
    writeState(email, { done: true, seen: [...(st?.seen || []), ...(run?.mode === 'full' ? pages : run?.pages || [])] });
    logEvent({ Category: 'SYSTEM', Action: 'TOUR_SKIPPED', Module: 'tour', RecordLabel: `${run?.mode} · stopped at step ${index + 1} of ${run?.steps.length}` });
    setPhase('idle');
  }, [email, run, index, pages]);

  const skipWelcome = useCallback(() => {
    const st = readState(email);
    if (!st) {
      writeState(email, { done: true, seen: pages });
      logEvent({ Category: 'SYSTEM', Action: 'TOUR_SKIPPED', Module: 'tour', RecordLabel: 'welcome screen' });
    }
    setPhase('idle');
  }, [email, pages]);

  const dismissNew = useCallback(() => {
    const st = readState(email);
    writeState(email, { done: true, seen: [...(st?.seen || []), ...newPages] });
    setNewPages([]);
  }, [email, newPages]);

  const currentPage = useMemo(() => {
    const hit = Object.entries(TOUR_PAGES).find(([, c]) => c.path === location.pathname);
    return hit && pages.includes(hit[0]) ? hit[0] : null;
  }, [location.pathname, pages]);

  const value = useMemo(() => ({ openWelcome, active: phase !== 'idle', hasNew: newPages.length > 0 }), [openWelcome, phase, newPages.length]);

  return (
    <TourCtx.Provider value={value}>
      {children}

      {phase === 'welcome' && (
        <WelcomeScreen
          firstName={firstName} pages={pages} levels={levels} currentPage={currentPage}
          onStart={w => start({ pages, mode: 'full', watch: w })}
          onPage={p => start({ pages: [p], mode: 'page' })}
          onClose={skipWelcome}
        />
      )}

      {phase === 'tour' && run && (
        <TourOverlay
          steps={run.steps} index={index} onIndex={setIndex} onExpand={expand}
          watch={watch} onWatch={setWatch}
          onFinish={finish} onExit={exitTour}
        />
      )}

      {phase === 'finish' && run && (
        <FinishScreen
          firstName={firstName} pages={run.pages} mode={run.mode}
          onReplay={() => start({ pages: run.pages, mode: run.mode })}
          onClose={() => setPhase('idle')}
        />
      )}

      {phase === 'idle' && newPages.length > 0 && (
        <WhatsNew
          pages={newPages}
          onShow={() => start({ pages: newPages, mode: 'new' })}
          onLater={dismissNew}
        />
      )}
    </TourCtx.Provider>
  );
}
