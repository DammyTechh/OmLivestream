import { redirect } from 'next/navigation';

/**
 * The waitlist is closed — OmliveStream is live.
 *
 * A redirect rather than a deleted route: this URL was shared on social media
 * and sits in old emails, and everyone following one of those links is exactly
 * who we want signing up. Sending them to sign-up converts that traffic
 * instead of losing it to a 404.
 *
 * `redirect()` issues a 307, not a permanent 308, on purpose — a 308 is cached
 * by browsers and CDNs indefinitely, which would make this impossible to undo
 * if a waitlist is ever run again.
 */
export default function WaitlistClosedPage() {
  redirect('/auth/signup');
}
