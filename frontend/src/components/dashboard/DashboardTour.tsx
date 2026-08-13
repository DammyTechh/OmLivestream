'use client';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { TOUR_STEPS, type TourStep } from './tour-steps';

/**
 * First-run dashboard walkthrough.
 *
 * It plays for a user's first three login sessions — sign-up plus the next two
 * logins — and then retires itself. The count is the source of truth on the
 * server (`user.tour_views`, bumped once per session via POST
 * /users/me/tour/viewed and capped at 3), so it carries across devices; a
 * localStorage mirror is kept purely as a ceiling so the tour still stops after
 * three even if that call never lands. Within an active session each page plays
 * its steps once, tracked in sessionStorage so navigating back doesn't repeat
 * them. "Skip all tips" pins the server count to its cap and ends it everywhere.
 *
 * Lives in the dashboard layout, spotlights an element when it can find one and
 * otherwise centres a card, and reflows to a bottom sheet on small screens.
 */

const CAP          = 3;
const PAD          = 8;
const START_DELAY  = 450;

// sessionStorage — reset each browser session, which is our proxy for "a login".
const SS_DECIDED = 'omlive_tour_session_decided';
const SS_ACTIVE  = 'omlive_tour_session_active';
const SS_SHOWN   = 'omlive_tour_session_shown';
// localStorage — a device-local ceiling, in case the server bump can't persist.
const LS_VIEWS   = 'omlive_tour_local_views';

function ss(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function ssSet(key: string, val: string) {
  try { sessionStorage.setItem(key, val); } catch { /* ignore */ }
}
function readShown(): string[] {
  try { return JSON.parse(ss(SS_SHOWN) || '[]'); } catch { return []; }
}
function localViews(): number {
  try { const n = parseInt(localStorage.getItem(LS_VIEWS) || '0', 10); return Number.isFinite(n) ? n : 0; }
  catch { return 0; }
}
function setLocalViews(n: number) {
  try { localStorage.setItem(LS_VIEWS, String(n)); } catch { /* ignore */ }
}

function resolveTarget(target?: string | string[]): HTMLElement | null {
  if (!target) return null;
  const selectors = Array.isArray(target) ? target : [target];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      const r = el.getBoundingClientRect();
      if (el.offsetParent !== null && r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

interface Rect { top: number; left: number; width: number; height: number; }

export function DashboardTour() {
  const pathname = usePathname();
  const { user, hydrated, setUser } = useAuth();

  const [enabled, setEnabled] = useState(false);   // tour runs this session
  const [active, setActive]   = useState(false);   // overlay visible right now
  const [index, setIndex]     = useState(0);
  const [rect, setRect]       = useState<Rect | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const decidedRef = useRef(false);

  const steps: TourStep[] = TOUR_STEPS[pathname] ?? [];
  const step = steps[index];

  // -- Decide once per session whether the tour should run ----------
  useEffect(() => {
    if (!hydrated || !user || decidedRef.current) return;
    decidedRef.current = true;

    // Already decided earlier this session -- just honour it.
    if (ss(SS_DECIDED) === '1') { setEnabled(ss(SS_ACTIVE) === '1'); return; }

    const serverViews = typeof user.tour_views === 'number' ? user.tour_views : null;
    const views = serverViews !== null ? Math.max(serverViews, localViews()) : localViews();

    ssSet(SS_DECIDED, '1');

    if (views >= CAP) { ssSet(SS_ACTIVE, '0'); setEnabled(false); return; }

    // Run this session. Count it once -- locally for certainty and on the
    // server for cross-device truth (best-effort; a failure just means the
    // local ceiling does the capping).
    ssSet(SS_ACTIVE, '1');
    setEnabled(true);
    setLocalViews(views + 1);
    api.post('/users/me/tour/viewed')
      .then((res) => {
        const next = unwrap<{ tour_views: number }>(res)?.tour_views;
        if (typeof next === 'number' && user) setUser({ ...user, tour_views: next });
      })
      .catch(() => { /* offline / pre-migration -- local ceiling still applies */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user]);

  // -- Track viewport size (mobile => bottom-sheet card) ------------
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // -- Start the current page's steps once per session --------------
  useEffect(() => {
    if (!enabled || steps.length === 0) return;
    if (readShown().includes(pathname)) return;
    const t = setTimeout(() => { setIndex(0); setActive(true); }, START_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pathname]);

  // -- Position the spotlight for the current step ------------------
  const measure = useCallback(() => {
    if (!active || !step) return;
    const el = resolveTarget(step.target);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [active, step]);

  useEffect(() => {
    if (!active || !step) return;
    const el = resolveTarget(step.target);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(measure, 320);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, index, step, measure]);

  const close = useCallback(() => { setActive(false); setRect(null); }, []);

  // Finishing/skipping a page: remember it for this session so it doesn't
  // replay on back-navigation, then close. The session was already counted.
  const finishRoute = useCallback(() => {
    const shown = readShown();
    if (!shown.includes(pathname)) { shown.push(pathname); ssSet(SS_SHOWN, JSON.stringify(shown)); }
    close();
  }, [pathname, close]);

  const skipAll = useCallback(() => {
    ssSet(SS_ACTIVE, '0');
    setEnabled(false);
    setLocalViews(CAP);
    if (user) setUser({ ...user, tour_views: CAP });
    api.post('/users/me/tour/dismiss').catch(() => { /* local ceiling still applies */ });
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, close]);

  const next = useCallback(() => {
    if (index < steps.length - 1) setIndex((i) => i + 1);
    else finishRoute();
  }, [index, steps.length, finishRoute]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishRoute();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, back, finishRoute]);

  if (!active || !step) return null;

  const isLast  = index === steps.length - 1;
  const spotlit = rect !== null;

  let cardStyle: React.CSSProperties;
  if (isMobile) {
    cardStyle = { left: 16, right: 16, bottom: 16 };
  } else if (spotlit && rect) {
    const CARD_W = 340, EST_H = 190, M = 12;
    const below = rect.top + rect.height + M;
    const placeBelow = below + EST_H < window.innerHeight;
    const top = placeBelow ? below : Math.max(M, rect.top - EST_H - M);
    const left = Math.min(Math.max(M, rect.left), window.innerWidth - CARD_W - M);
    cardStyle = { top, left, width: CARD_W };
  } else {
    cardStyle = { top: '50%', left: '50%', width: 'min(92vw, 380px)', transform: 'translate(-50%, -50%)' };
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60]" aria-live="polite" role="dialog" aria-modal="true">
        {/* Transparent blocker so the dimmed page behind can't be clicked mid-tour. */}
        <div className="absolute inset-0" />

        {spotlit && rect ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute rounded-2xl ring-2 ring-primary pointer-events-none"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: '0 0 0 9999px rgba(10, 8, 24, 0.62)',
            }}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
            style={{ background: 'rgba(10, 8, 24, 0.62)' }}
          />
        )}

        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="fixed rounded-2xl bg-surface border border-border shadow-2xl p-5"
          style={cardStyle}
        >
          <button
            onClick={finishRoute}
            aria-label="Close walkthrough"
            className="absolute top-3 right-3 text-muted hover:text-text transition"
          >
            <X size={16} />
          </button>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1.5">
            Step {index + 1} of {steps.length}
          </div>
          <h3 className="font-display text-lg font-semibold leading-snug pr-6">{step.title}</h3>
          <p className="text-sm text-muted mt-1.5 leading-relaxed">{step.body}</p>

          <div className="flex items-center justify-between gap-3 mt-5">
            <button
              onClick={skipAll}
              className="text-xs text-muted hover:text-text transition"
            >
              Skip all tips
            </button>

            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  onClick={back}
                  className="px-3 py-1.5 rounded-xl text-sm font-medium text-muted hover:text-text hover:bg-veil/5 transition"
                >
                  Back
                </button>
              )}
              <button
                onClick={next}
                className="px-4 py-1.5 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition shadow-brand"
              >
                {isLast ? 'Got it' : 'Next'}
              </button>
            </div>
          </div>

          {steps.length > 1 && (
            <div className="flex items-center gap-1.5 mt-4">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? 'w-5 bg-primary' : 'w-1.5 bg-veil/20'
                  }`}
                />
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
