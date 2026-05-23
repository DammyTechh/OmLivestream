'use client';
import { useEffect } from 'react';

/**
 * Prevents the user from accidentally losing their live stream by:
 * 1. Triggering the browser's native "Leave site?" dialog on refresh/close/back
 * 2. Disabling pull-to-refresh on mobile via CSS overscroll-behavior
 * 3. Warning on route changes inside the SPA
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

    return () => {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      document.documentElement.style.overscrollBehavior = prevHtml;
      document.body.style.overscrollBehavior = prevBody;
      document.removeEventListener('touchstart', touchStart);
      document.removeEventListener('touchmove',  touchMove);
    };
  }, [isLive]);
}
