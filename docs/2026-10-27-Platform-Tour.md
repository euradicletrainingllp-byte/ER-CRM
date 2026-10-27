# Platform Tour (2026-10-27)

## v3 (same day): Raddy bigger + "aww" moments
- Size: 124 px on the stop card (96 px on phones), 150 px on the welcome and finish screens, 124 px when running between trackers.
- Eyes follow the mouse. Tap/click Raddy to pet: happy ^^ eyes, blush, tongue out, wiggle, floating hearts and a "Hehe!" / "Aww!" pop.
- Random tricks when idle (every 4–8 s): tail-chase spin, back-paw ear scratch, play bow, yawn, sneeze with sparkles, "Woof!", head tilt "?", hearts.
- Naps with floating Zzz after 20 s of no activity (25 s on the welcome screen); wakes with a jump when the mouse moves.
- Tapping a glowing spot makes Raddy jump "Yay!" with hearts before moving on. Finish screen: cheering with a new heart burst every 2 s.
- All in `Mascot.jsx` + `tour.css` (.rd-*). Backup of v2: `Claude outputs/backup-2026-10-27-platform-tour-v2/`.

## v2 (same day): Raddy the guide + quick stops
- **One stop per tracker** (QUICK in tourSteps.js): admin = 16 stops instead of 64 steps; a person with 4 trackers = 6 stops (about 1 min). Detailed steps play only on "Show me more (n)" inside a stop. "Tour this page" still shows the details straight away.
- **Raddy** (`Mascot.jsx`, original SVG puppy in brand colours): sits on top of the speech card and hops in at every stop, talks while the text types out, sniffs while a page loads, waves on the welcome screen, runs across the screen between trackers, jumps on the finish screen. Faces the highlighted element.
- **Travel scenes** between trackers (auto, 1.9 s, tap to skip): Raddy runs across, the tracker's stamp slams onto the banner with the person's rights.
- **Passport** bar at the top: one stamp per tracker, fills as each is visited; tap any stamp to jump there.
- **Tap the glowing spot** to continue (sparkle burst); the page underneath is still never clicked.
- Backup of v1: `Claude outputs/backup-2026-10-27-platform-tour-v1/`.


Interactive, permission-aware walkthrough of the CRM. Code done, not pushed. No Excel / flow / permission changes needed.

## What people see
- **Welcome screen** (auto-opens ~1.5 s after the first sign-in, per browser + email): typed greeting, animated counters, the customer journey (Lead → BD → Solution → Engagement → Ops → Content Dev → Finance) drawn as a line with a travelling light; trackers the person can open light up with a View / Edit / Full badge, the rest stay greyed with a lock. Workspace tools (Dashboard, Founder's Desk, Project Management, Vendors, Clients, Consultants, Admin) appear as chips. Buttons: Start guided tour · Watch it play · Tour this page · Skip for now. Tapping any lit tracker or tool runs a short tour of just that page.
- **Guided tour**: opening steps (menu, Tour button) → one chapter per accessible page → Reminders. Each chapter opens with an animated chapter card (icon, tagline, the person's rights: View / Add new / Edit / Delete), then the CRM opens that page and a spotlight glides between the menu item, KPI cards, search/filters, Add button (only with Create rights), the list, and floating panels. View-only people get view-only wording.
- **Watch mode** (auto-play): animated pointer glides to each element and "clicks", Next button fills as a timer, auto-advances; pauses on hover; Space toggles.
- Keys: → / Enter next, ← back, Esc close. "Skip to <next tracker>" link on long tours.
- **Finish screen**: drawn check mark + brand-colour confetti, chips of the pages covered, Replay / Start working.
- **Header "Tour" button** (compass icon, next to "Live Excel"): opens the welcome screen any time.
- **What's new**: if pages are opened for someone after they finished the tour, a small prompt appears under the Tour button (and a pulsing dot on it) with "Show me" → tour of only the new pages.

## Safety
Read-only: the overlay blocks clicks on the page; the tour only navigates and highlights. Elements that are missing (no data yet, no rights) are skipped quietly.
Activity log: TOUR_STARTED / TOUR_COMPLETED / TOUR_SKIPPED (Category SYSTEM, Module tour) — no emails.
Progress: localStorage `ercrm.tour.<email>`; bump `TOUR_VERSION` in tourSteps.js to show the tour to everyone again.

## Files
- New: `src/config/tourSteps.js` (all text + targets per page), `src/components/tour/` (TourProvider, TourOverlay, WelcomeScreen, FinishScreen, WhatsNew, tourIcons), `src/styles/tour.css`
- Changed: `App.jsx` (TourProvider around Shell), `TopBar.jsx` (Tour button), `Sidebar.jsx` (`data-tour-nav` on menu items)
- Backup: `Claude outputs/backup-2026-10-27-platform-tour/`

## Adding a new page to the tour
Add a block to `TOUR_PAGES` (path, label, icon, tagline, steps), its key to `CHAPTER_ORDER` (and `JOURNEY` or `TOOLS`), and the icon to `tourIcons.jsx`.
