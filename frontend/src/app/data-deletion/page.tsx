import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { DASHBOARD_URL } from '@/lib/urls';

/**
 * Data deletion instructions.
 *
 * Meta requires every app to publish either a data deletion *callback* endpoint
 * or a public *instructions* URL before App Review will pass. This is the
 * instructions page, which is the right choice here: deletion in OmliveStream
 * is self-service and immediate, so a page that points at the button is more
 * honest than a callback that would only queue a request.
 *
 * What is described below is what the code actually does — see
 * `UsersService.deleteAccount`: the Paystack subscription is cancelled, every
 * recording file is removed from storage, and the user row is deleted, which
 * cascades to all child records. Deliberately not overstated: a deletion page
 * that promises more than the system performs is worse than no page, both for
 * users and under review.
 */

export const metadata: Metadata = {
  title: 'Data Deletion — OmliveStream',
  description:
    'How to delete your OmliveStream account and all associated data, including recordings, ' +
    'connected platform credentials, and analytics.',
  alternates: { canonical: '/data-deletion' },
};

const CONTACT_EMAIL = 'privacy@omlivestream.com';
const LAST_UPDATED = 'August 15, 2026';

export default function DataDeletionPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-28 pb-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary mb-4">
            Data &amp; Privacy
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mb-3">
            Deleting your data
          </h1>
          <p className="text-muted leading-relaxed mb-2">
            You can delete your OmliveStream account and everything associated with it at any time.
            You do not need to contact us first, and you do not need to give a reason.
          </p>
          <p className="text-xs text-muted mb-10">Last updated {LAST_UPDATED}</p>

          {/* ── Self-service ─────────────────────────────────────── */}
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">
              Option 1 — Delete it yourself (immediate)
            </h2>
            <ol className="space-y-3 text-[15px] leading-relaxed text-muted list-decimal pl-5">
              <li>
                Sign in and open{' '}
                <Link href={`${DASHBOARD_URL || ''}/dashboard/settings`} className="text-primary hover:underline">
                  Settings
                </Link>{' '}
                in your dashboard.
              </li>
              <li>Scroll to the bottom, to the <strong className="text-text">Danger zone</strong>.</li>
              <li>Select <strong className="text-text">Delete Account</strong> and confirm.</li>
            </ol>
            <p className="text-[15px] leading-relaxed text-muted mt-4">
              Deletion runs immediately and cannot be undone.
            </p>
          </section>

          {/* ── By request ───────────────────────────────────────── */}
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">
              Option 2 — Ask us to delete it
            </h2>
            <p className="text-[15px] leading-relaxed text-muted">
              If you cannot access your account, email{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
                {CONTACT_EMAIL}
              </a>{' '}
              from the address registered to the account, with the subject{' '}
              <strong className="text-text">Delete my account</strong>. We verify the request comes
              from the account holder, then complete deletion within 30 days and confirm by email.
            </p>
          </section>

          {/* ── What goes ────────────────────────────────────────── */}
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">What is deleted</h2>
            <ul className="space-y-2 text-[15px] leading-relaxed text-muted list-disc pl-5">
              <li>Your profile: name, email address, date of birth, location and avatar.</li>
              <li>
                Every connected platform credential — the access and refresh tokens for YouTube,
                Facebook, Instagram, TikTok, Twitch, X, LinkedIn and Kick, and any stream keys you
                entered manually.
              </li>
              <li>All stream records, titles, descriptions and thumbnails.</li>
              <li>All recordings, including the underlying video files in storage.</li>
              <li>All analytics, viewer figures and collected comments.</li>
              <li>All notifications, AI assistant history and feedback you submitted.</li>
              <li>Your active subscription, which is cancelled with our payment provider.</li>
            </ul>
          </section>

          {/* ── What we keep, and why ────────────────────────────── */}
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">What we keep, and why</h2>
            <p className="text-[15px] leading-relaxed text-muted mb-3">
              Two things survive deletion, for reasons outside our control:
            </p>
            <ul className="space-y-2 text-[15px] leading-relaxed text-muted list-disc pl-5">
              <li>
                <strong className="text-text">Payment and invoice records.</strong> Financial
                regulations require us and our payment provider to retain transaction records for a
                statutory period. These are held by Paystack and contain no streaming content.
              </li>
              <li>
                <strong className="text-text">Content already published to other platforms.</strong>{' '}
                A broadcast that went out to YouTube, Facebook, Instagram, TikTok, Twitch, X,
                LinkedIn or Kick lives on that platform, under that platform&rsquo;s own terms.
                Deleting your OmliveStream account removes our access to those accounts but cannot
                remove content from them. To delete that content, use each platform directly.
              </li>
            </ul>
          </section>

          {/* ── Disconnect only ──────────────────────────────────── */}
          <section className="mb-10">
            <h2 className="font-display text-xl font-semibold mb-3">
              Disconnecting one platform instead
            </h2>
            <p className="text-[15px] leading-relaxed text-muted">
              If you only want to revoke our access to a single account rather than delete
              everything, open <strong className="text-text">Platforms</strong> in your dashboard and
              select <strong className="text-text">Disconnect</strong> on that platform. Its stored
              credentials are deleted immediately and we lose all access to that account. Your
              OmliveStream account and everything else stay as they are.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold mb-3">Questions</h2>
            <p className="text-[15px] leading-relaxed text-muted">
              Write to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
                {CONTACT_EMAIL}
              </a>
              . See also our{' '}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link href="/terms" className="text-primary hover:underline">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
