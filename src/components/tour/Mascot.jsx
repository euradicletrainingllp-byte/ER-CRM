/**
 * Raddy — the tour guide puppy (original SVG, brand palette).
 *
 * Poses (prop): idle · talk · wave · run · sniff · cheer
 * Built-in life:
 *   • eyes follow the mouse
 *   • tap / click to pet → happy eyes, blush, floating hearts, a little "Hehe!"
 *   • random tricks while idle: tail-chase spin, ear scratch, play bow, yawn, sneeze, bark, hearts
 *   • naps with Zzz after `sleepAfter` ms of no activity, wakes with a startled hop
 *   • `react` (number): change it to make Raddy celebrate (e.g. when a glowing spot is tapped)
 * All motion is CSS (tour.css .rd-*) and respects reduced-motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const TRICKS = ['spin', 'scratch', 'bow', 'yawn', 'sneeze', 'bark', 'hearts', 'tilt'];
const TRICK_MS = { spin: 1300, scratch: 1600, bow: 1500, yawn: 1800, sneeze: 1100, bark: 1200, hearts: 1600, tilt: 1400, pet: 1500, wake: 900, yay: 1300 };
const SAY = { bark: 'Woof!', sneeze: 'Achoo!', wake: '!', yay: 'Yay!', tilt: '?' };
const PET_SAY = ['Hehe!', 'More!', 'Aww!', 'Yay!', '♥'];

export default function Mascot({
  pose = 'idle', talking = false, size = 92, flip = false, className = '',
  pettable = true, tricks = true, followEyes = true, sleepAfter = 0, react = 0,
}) {
  const rootRef = useRef(null);
  const pupilRef = useRef(null);
  const asleepRef = useRef(false);
  const timerRef = useRef(null);
  const [trick, setTrick] = useState(null);
  const [say, setSay] = useState('');
  const [hearts, setHearts] = useState(0);
  const [asleep, setAsleep] = useState(false);

  const play = useCallback((name, text) => {
    clearTimeout(timerRef.current);
    setTrick(name);
    setSay(text ?? SAY[name] ?? '');
    if (name === 'hearts' || name === 'pet' || name === 'yay') setHearts(h => h + 1);
    timerRef.current = setTimeout(() => { setTrick(null); setSay(''); }, TRICK_MS[name] || 1200);
  }, []);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // celebrate when the parent says so
  const firstReact = useRef(true);
  useEffect(() => {
    if (firstReact.current) { firstReact.current = false; return; }
    play('yay');
  }, [react, play]);

  // random tricks while idle
  const busy = pose !== 'idle' || talking || asleep;
  useEffect(() => {
    if (!tricks || busy) return undefined;
    let t;
    const loop = () => {
      t = setTimeout(() => {
        play(TRICKS[Math.floor(Math.random() * TRICKS.length)]);
        loop();
      }, 4200 + Math.random() * 3800);
    };
    loop();
    return () => clearTimeout(t);
  }, [tricks, busy, play]);

  // eyes follow the mouse
  useEffect(() => {
    if (!followEyes) return undefined;
    let raf = 0;
    const onMove = e => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = rootRef.current, p = pupilRef.current;
        if (!el || !p) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width * 0.46), dy = e.clientY - (r.top + r.height * 0.4);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 180);
        let x = (dx / d) * 2.4 * k; const y = (dy / d) * 2.1 * k;
        if (flip) x = -x;
        p.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf); };
  }, [followEyes, flip]);

  // nap after a while with nothing happening
  useEffect(() => {
    if (!sleepAfter) return undefined;
    let t;
    const reset = () => {
      clearTimeout(t);
      if (asleepRef.current) { asleepRef.current = false; setAsleep(false); play('wake'); }
      t = setTimeout(() => { asleepRef.current = true; setAsleep(true); }, sleepAfter);
    };
    reset();
    const evs = ['mousemove', 'keydown', 'pointerdown', 'wheel'];
    evs.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    return () => { clearTimeout(t); evs.forEach(ev => window.removeEventListener(ev, reset)); };
  }, [sleepAfter, play]);

  const pet = e => {
    if (!pettable) return;
    e.stopPropagation();
    play('pet', PET_SAY[Math.floor(Math.random() * PET_SAY.length)]);
  };

  const cls = [
    'rd', `rd--${asleep ? 'sleep' : pose}`,
    talking && !asleep ? 'rd--talking' : '',
    trick && !asleep ? `rd-t-${trick}` : '',
    pettable ? 'rd-pettable' : '', className,
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={cls} style={{ width: size, height: size }}
      onClick={pet} title={pettable ? 'Pet Raddy' : undefined} aria-hidden="true">
      <div className="rd-flip" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        <svg viewBox="0 0 120 120" width={size} height={size}>
          <ellipse className="rd-shadow" cx="62" cy="113" rx="30" ry="4.5" fill="rgba(45,48,71,0.18)" />
          <g className="rd-all">
            <g className="rd-tail">
              <path d="M86 84 C98 80 104 70 101 60" fill="none" stroke="#2D3047" strokeWidth="9" strokeLinecap="round" />
              <path d="M86 84 C98 80 104 70 101 60" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
            </g>
            <g className="rd-leg rd-leg-b1"><rect x="74" y="92" width="11" height="17" rx="5.5" fill="#fff" stroke="#2D3047" strokeWidth="3" /></g>
            <g className="rd-leg rd-leg-b2"><rect x="63" y="94" width="11" height="15" rx="5.5" fill="#fff" stroke="#2D3047" strokeWidth="3" /></g>
            <ellipse className="rd-body" cx="64" cy="86" rx="27" ry="19" fill="#fff" stroke="#2D3047" strokeWidth="3" />
            <ellipse cx="72" cy="82" rx="9" ry="7" fill="#EDE3EC" />
            <g className="rd-leg rd-leg-f1"><rect x="40" y="93" width="11" height="17" rx="5.5" fill="#fff" stroke="#2D3047" strokeWidth="3" /></g>
            <g className="rd-paw"><rect x="51" y="93" width="11" height="17" rx="5.5" fill="#fff" stroke="#2D3047" strokeWidth="3" /></g>
            <g className="rd-head">
              <g className="rd-ear rd-ear-l"><path d="M30 34 C18 38 16 60 26 68 C34 72 38 58 38 46 Z" fill="#3E3264" stroke="#2D3047" strokeWidth="2.5" strokeLinejoin="round" /></g>
              <g className="rd-ear rd-ear-r"><path d="M80 34 C92 38 94 60 84 68 C76 72 72 58 72 46 Z" fill="#3E3264" stroke="#2D3047" strokeWidth="2.5" strokeLinejoin="round" /></g>
              <circle cx="55" cy="50" r="27" fill="#fff" stroke="#2D3047" strokeWidth="3" />
              <ellipse cx="66" cy="44" rx="10" ry="9" fill="#EDE3EC" />
              {/* eyes: open (pupils follow the mouse) · happy ^^ · closed */}
              <g className="rd-eyes">
                <g ref={pupilRef} className="rd-pupils">
                  <circle cx="45" cy="47" r="4.6" fill="#2D3047" /><circle cx="46.6" cy="45.4" r="1.6" fill="#fff" /><circle cx="43.6" cy="48.8" r=".7" fill="#fff" />
                  <circle cx="65" cy="47" r="4.6" fill="#2D3047" /><circle cx="66.6" cy="45.4" r="1.6" fill="#fff" /><circle cx="63.6" cy="48.8" r=".7" fill="#fff" />
                </g>
              </g>
              <g className="rd-eyes-happy" fill="none" stroke="#2D3047" strokeWidth="2.6" strokeLinecap="round">
                <path d="M40.5 48.5 Q45 42.5 49.5 48.5" /><path d="M60.5 48.5 Q65 42.5 69.5 48.5" />
              </g>
              <g className="rd-eyes-closed" fill="none" stroke="#2D3047" strokeWidth="2.4" strokeLinecap="round">
                <path d="M40.5 46.5 Q45 50.5 49.5 46.5" /><path d="M60.5 46.5 Q65 50.5 69.5 46.5" />
              </g>
              <g className="rd-blush">
                <circle cx="38" cy="58" r="4" fill="#F3C6C0" /><circle cx="72" cy="58" r="4" fill="#F3C6C0" />
              </g>
              <ellipse cx="55" cy="61" rx="11" ry="8" fill="#F8F3F8" />
              <ellipse className="rd-nose" cx="55" cy="57" rx="4.6" ry="3.3" fill="#2D3047" />
              <path className="rd-smile" d="M49 63 Q55 68 61 63" fill="none" stroke="#2D3047" strokeWidth="2.2" strokeLinecap="round" />
              <g className="rd-mouth">
                <path d="M49 63 Q55 74 61 63 Z" fill="#2D3047" />
                <ellipse cx="55" cy="68.5" rx="3.6" ry="2.6" fill="#E98272" />
              </g>
              <g className="rd-pant">
                <path d="M49 63 Q55 70 61 63" fill="#2D3047" stroke="#2D3047" strokeWidth="1.5" strokeLinejoin="round" />
                <path className="rd-tongue" d="M51.5 65 Q51.5 74 55 74 Q58.5 74 58.5 65 Z" fill="#E98272" stroke="#2D3047" strokeWidth="1.4" />
              </g>
              <path d="M36 72 Q55 84 74 72" fill="none" stroke="#AA78A6" strokeWidth="5" strokeLinecap="round" />
              <circle className="rd-tag" cx="55" cy="81" r="4.2" fill="#D0A616" stroke="#2D3047" strokeWidth="1.5" />
            </g>
          </g>
        </svg>
      </div>

      {/* floating hearts */}
      {hearts > 0 && (
        <span className="rd-hearts" key={hearts}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <i key={i} style={{ '--x': `${(i - 2.5) * 13 + (i % 2 ? 5 : -5)}px`, '--d': `${i * 0.09}s`, '--s': `${0.7 + (i % 3) * 0.22}` }}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.3 3.2 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.7 0 6 3.8 4.5 7.3C19.5 16.4 12 21 12 21z" fill={i % 2 ? '#AA78A6' : '#E98272'} /></svg>
            </i>
          ))}
        </span>
      )}
      {/* speech pop */}
      {say && <span className="rd-say" key={say + trick}>{say}</span>}
      {/* nap */}
      {asleep && <span className="rd-zzz"><b>z</b><b>z</b><b>Z</b></span>}
      {/* sneeze sparkle */}
      {trick === 'sneeze' && <span className="rd-sparkle"><i /><i /><i /><i /></span>}
    </div>
  );
}
