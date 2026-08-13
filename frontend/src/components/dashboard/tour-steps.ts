/**
 * Walkthrough content, one short sequence per dashboard route.
 *
 * `target` is an optional CSS selector (or list of selectors — the first one
 * that exists and is visible wins, which is how a step points at the mobile
 * hamburger on phones and the desktop rail on wide screens without branching).
 * When no target resolves, the step renders as a centred card, so a page with
 * no anchor still gets a walkthrough rather than a blank overlay.
 *
 * Most page steps target `main h1`, the heading every dashboard page already
 * renders — that keeps the tour working without sprinkling data attributes
 * through eight separate page files.
 */
export interface TourStep {
  target?: string | string[];
  title: string;
  body: string;
}

const NAV_TARGET = ['[data-tour="mobile-nav"]', '[data-tour="desktop-nav"]'];

export const TOUR_STEPS: Record<string, TourStep[]> = {
  '/dashboard': [
    {
      title: 'Welcome to OmliveStream 👋',
      body: 'Here’s a 20-second tour of your dashboard. You can skip it anytime — it won’t show again once you’ve seen it.',
    },
    {
      target: NAV_TARGET,
      title: 'Your navigation',
      body: 'Move between Go Live, Recordings, Platforms, Analytics and more from here. On a phone, tap the menu button to open it.',
    },
    {
      target: 'main h1',
      title: 'Your Overview',
      body: 'This home screen gives you streaming stats and quick actions at a glance every time you sign in.',
    },
    {
      target: '[data-tour="profile"]',
      title: 'Your account',
      body: 'Profile, billing and logout all live under your avatar in the top-right.',
    },
  ],
  '/dashboard/streams': [
    {
      target: 'main h1',
      title: 'Go Live',
      body: 'Create a stream, choose your platforms, and broadcast to all of them at once from a single camera.',
    },
  ],
  '/dashboard/recordings': [
    {
      target: 'main h1',
      title: 'Recordings',
      body: 'Every broadcast is saved here automatically — download it, polish it with AI editing, or publish it back out.',
    },
  ],
  '/dashboard/platforms': [
    {
      target: 'main h1',
      title: 'Platforms',
      body: 'Connect YouTube, Facebook, Instagram, TikTok, Twitch and more so you can stream to them. Connect at least one before going live.',
    },
  ],
  '/dashboard/analytics': [
    {
      target: 'main h1',
      title: 'Analytics',
      body: 'Track views, peak audience and engagement across every platform you broadcast to, all in one place.',
    },
  ],
  '/dashboard/ai': [
    {
      target: 'main h1',
      title: 'AI Studio',
      body: 'Generate stream titles, get help planning a broadcast, and edit your recordings — all powered by AI.',
    },
  ],
  '/dashboard/billing': [
    {
      target: 'main h1',
      title: 'Billing & Plan',
      body: 'See your current plan, review invoices, and upgrade to stream to all 8 platforms whenever you’re ready.',
    },
  ],
  '/dashboard/settings': [
    {
      target: 'main h1',
      title: 'Settings',
      body: 'Update your profile, manage security and devices, and control your account preferences here.',
    },
  ],
};
