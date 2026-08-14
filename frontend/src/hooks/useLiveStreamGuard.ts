'use client';
import { useEffect } from 'react';

/**
 * Guards a live broadcast against being lost by accident.
 *
 * An honest note on the ceiling here: a web page cannot actually block a
 * refresh or a tab close. Browsers removed that power deliberately, because a
 * page that could refuse to be left is a page that can hold someone hostage.
 * `beforeunload` may only *ask*, the wording is the browser's own, and Chrome
 * ignores it entirely until the visitor has interacted with the page. So the
 * refresh prompt is a speed bump, not a lock, and it can always be dismissed.
 *
 * What is fully within our control is in-app navigation — clicking a sidebar
 * link, or the back button — which is where most accidental exits actually
 * come from, and which the native dialog never covered. Those are intercepted
 * here and confirmed properly.
 *
 * The broadcast itself is not tied to the page: it runs server-side, so a
 * creator who does refresh comes back to a stream that is still live rather
 * than a dead one. That, rather than any attempt at a lock, is what makes a
 * stray refresh survivable.
 *
 * Covers:
 *  1. Refresh / close / navigate-away — native prompt (best effort)
 *  2. Pull-to-refresh on mobile
 *  3. In-app link clicks and back-button presses — confirmed
 *
 * Activates ONLY when `isLive === true`.
 */
export function useLiveStreamGuard(isLive: boolean) {
  useEffect(() => {
    if (!isLive) return;

    // ── 1. Desktop: intercept refresh / close / navigate-away ──
    const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the custom message and show their own generic text,
      // but returnValue must be set for the dialog to appear.
      e.returnValue = 'You are currently live. Leaving will end your stream. Are you sure?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // ── 2. Mobile: disable pull-to-refresh (iOS Safari + Chrome Android) ──
    const prevHtml = document.documentElement.style.overscrollBehavior;
    const prevBody = document.body.style.overscrollBehavior;
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';

    // ── 3. Also disable touchmove "pull-to-refresh" on iOS when at scroll top ──
    let startY = 0;
    const touchStart = (e: TouchEvent) => { startY = e.touches[0].clientY; };
    const touchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      // If user is at scroll top AND pulling down, block it
      if (window.scrollY === 0 && y > startY && e.cancelable) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchstart', touchStart, { passive: true });
    document.addEventListener('touchmove',  touchMove,  { passive: false });

    // ── 4. In-app navigation: links and the back button ──
    // The native dialog does not fire for client-side routing, so a sidebar
    // click would silently leave the live page. Intercept in the capture phase,
    // before the router sees the event.
    const CONFIRM = 'You are live. Leave this page anyway?';

    const linkHandler = (e: MouseEvent) => {
      // Ignore modified clicks — those open a new tab and leave this one alone.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;
      // Staying on the same page is not leaving it.
      if (href === window.location.pathname) return;
      if (!window.confirm(CONFIRM)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', linkHandler, true);

    // Back button: push a sentinel entry so the first Back lands here and can
    // be questioned, rather than leaving before we get a say.
    history.pushState(null, '', window.location.href);
    const popHandler = () => {
      if (window.confirm(CONFIRM)) history.back();
      else history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', popHandler);

    return () => {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      document.removeEventListener('click', linkHandler, true);
      window.removeEventListener('popstate', popHandler);
      document.documentElement.style.overscrollBehavior = prevHtml;
      document.body.style.overscrollBehavior = prevBody;
      document.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchmove',  touchMove);
    };
  }, [isLive]);
}
