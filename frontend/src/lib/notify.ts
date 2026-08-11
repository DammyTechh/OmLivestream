'use client';

/**
 * Desktop notifications for events that arrive over the socket.
 *
 * The browser Notification API, not Web Push. Web Push would need VAPID keys,
 * a service worker and a subscription table to deliver to a closed tab —
 * and everything that genuinely has to reach a closed tab (receipts, trial
 * ending, recording ready) already goes out by email. What was actually
 * missing was the in-product surface, which is the bell plus this.
 */

const PROMPTED_KEY = 'omlive_notify_prompted';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function notifyPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/** Have we already asked this browser? Asking twice after a dismissal is noise. */
export function alreadyPrompted(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(PROMPTED_KEY) === '1';
}

export function markPrompted(): void {
  if (typeof window !== 'undefined') localStorage.setItem(PROMPTED_KEY, '1');
}

/**
 * Ask for permission.
 *
 * Only ever call this from a click handler. Chrome ignores — and Firefox
 * outright blocks — a permission prompt that is not tied to a user gesture,
 * so requesting it on mount both fails and burns the one chance to ask.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() === 'unsupported') return 'unsupported';
  markPrompted();
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return 'denied';
  }
}

/**
 * Show a desktop notification, if we're allowed to.
 *
 * Silent no-op when permission was never granted or the tab is already in
 * front — a toast-style popup for something the user is looking at is just
 * clutter, and the bell badge already covers it.
 */
export function showDesktopNotification(
  title: string,
  body: string,
  link?: string | null,
): void {
  if (notifyPermission() !== 'granted') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  try {
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      // Collapses repeats: eight platform events from one go-live replace each
      // other in the tray instead of stacking into a wall of popups.
      tag: link ?? title,
    });
    n.onclick = () => {
      window.focus();
      if (link) window.location.href = link;
      n.close();
    };
  } catch {
    /* Some browsers throw on construction when the page is not visible. */
  }
}
