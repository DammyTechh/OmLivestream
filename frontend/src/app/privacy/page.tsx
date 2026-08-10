import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Privacy Policy — OmliveStream',
  description:
    'How OmliveStream collects, uses, shares, and protects your personal information when you use our multi-platform live streaming service.',
};

const LAST_UPDATED = 'August 10, 2026';
const CONTACT_EMAIL = 'privacy@omlivestream.com';

type Section = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: '1. Introduction',
    body: (
      <>
        <p>
          This Privacy Policy explains how OmliveStream (&ldquo;OmliveStream,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, shares, and protects your personal
          information when you access or use our website, applications, dashboard, and related
          services (collectively, the &ldquo;Service&rdquo;).
        </p>
        <p>
          By using the Service, you agree to the practices described in this Policy. This Policy should
          be read together with our{' '}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
          . If you do not agree with this Policy, please do not use the Service.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    title: '2. Information We Collect',
    body: (
      <>
        <p>We collect information in three ways:</p>
        <p className="text-text/90 font-medium">a. Information you provide to us</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Account details such as your name, email address, password, and profile information.</li>
          <li>Waitlist information, such as the email address you submit to register interest.</li>
          <li>Billing information you provide when you subscribe (processed by our payment providers).</li>
          <li>Content you stream, upload, record, or create using the Service, and comments you manage through it.</li>
          <li>Communications you send us, including support requests and feedback.</li>
        </ul>
        <p className="text-text/90 font-medium">b. Information collected automatically</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Device and connection data such as IP address, browser type, operating system, and device identifiers.</li>
          <li>Usage data such as pages viewed, features used, stream sessions, and timestamps.</li>
          <li>Network-quality signals (for example, upload speed and bitrate) used to optimize your broadcast.</li>
          <li>Cookies and similar technologies, as described below.</li>
        </ul>
        <p className="text-text/90 font-medium">c. Information from third parties</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Data from connected platforms (YouTube, Facebook, Instagram, TikTok, Twitch) that you authorize us to access, such as channel identifiers, stream status, and comments.</li>
          <li>Information from authentication or single-sign-on providers when you use them to log in.</li>
          <li>Analytics and payment data from the service providers we work with.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'use',
    title: '3. How We Use Your Information',
    body: (
      <>
        <p>We use your information to:</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Provide, operate, and maintain the Service, including relaying your broadcast to the platforms you select.</li>
          <li>Create and manage your account and process your subscription and payments.</li>
          <li>Detect your network conditions and automatically adjust stream quality.</li>
          <li>Record sessions, generate analytics, and power AI-assisted and manual editing at your direction.</li>
          <li>Aggregate comments and engagement across your connected platforms in one dashboard.</li>
          <li>Send you service messages, security alerts, and — where permitted — waitlist and marketing communications you can opt out of.</li>
          <li>Improve, personalize, and develop new features, and keep the Service secure.</li>
          <li>Comply with legal obligations and enforce our Terms.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'legal-basis',
    title: '4. Legal Bases for Processing',
    body: (
      <p>
        Where applicable data-protection law requires it, we process your personal information on the
        following legal bases: to perform our contract with you (providing the Service); with your
        consent (for example, connecting a third-party platform or receiving marketing); for our
        legitimate interests (such as securing and improving the Service), balanced against your
        rights; and to comply with legal obligations. You may withdraw consent at any time where
        processing is based on consent.
      </p>
    ),
  },
  {
    id: 'third-party-platforms',
    title: '5. Connected Third-Party Platforms',
    body: (
      <p>
        When you connect a third-party platform, you authorize us to access and use certain data from
        that platform to provide the Service — for example, to publish your live stream, read comments,
        and display analytics. Your use of each platform is also governed by that platform&rsquo;s own
        privacy policy, and we are not responsible for their practices. You can disconnect a platform at
        any time from your account settings, which stops future access to that platform&rsquo;s data.
      </p>
    ),
  },
  {
    id: 'cookies',
    title: '6. Cookies & Tracking Technologies',
    body: (
      <p>
        We use cookies and similar technologies to keep you signed in, remember your preferences,
        understand how the Service is used, and improve performance. You can control cookies through
        your browser settings; disabling some cookies may affect how the Service functions. Where
        required by law, we will ask for your consent before setting non-essential cookies.
      </p>
    ),
  },
  {
    id: 'share',
    title: '7. How We Share Information',
    body: (
      <>
        <p>We do not sell your personal information. We share it only as follows:</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li><span className="text-text/90">Service providers</span> — hosting, streaming infrastructure, payment processing, analytics, and email delivery, acting on our instructions.</li>
          <li><span className="text-text/90">Connected platforms</span> — the third-party platforms you choose to broadcast to, so your content can reach them.</li>
          <li><span className="text-text/90">Legal and safety</span> — where required by law, to enforce our Terms, or to protect the rights, property, or safety of OmliveStream, our users, or the public.</li>
          <li><span className="text-text/90">Business transfers</span> — in connection with a merger, acquisition, or sale of assets, subject to this Policy.</li>
          <li><span className="text-text/90">With your consent</span> — for any other purpose you approve.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: '8. Data Retention',
    body: (
      <p>
        We keep your personal information for as long as your account is active or as needed to provide
        the Service, and afterward only as necessary to comply with legal obligations, resolve disputes,
        and enforce our agreements. Recordings and other content may be subject to plan-based storage
        limits and retention periods, after which they may be deleted. You are responsible for keeping
        your own copies of content you wish to preserve.
      </p>
    ),
  },
  {
    id: 'security',
    title: '9. Data Security',
    body: (
      <p>
        We use reasonable technical and organizational measures — such as encryption in transit, access
        controls, and secure infrastructure — to protect your information. However, no method of
        transmission or storage is completely secure, and we cannot guarantee absolute security. You are
        responsible for keeping your login credentials confidential and for notifying us of any suspected
        unauthorized access.
      </p>
    ),
  },
  {
    id: 'rights',
    title: '10. Your Rights & Choices',
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access, correct, delete, or receive a
          copy of your personal information; to object to or restrict certain processing; and to withdraw
          consent. You can:
        </p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Update your profile and account information from your account settings.</li>
          <li>Disconnect linked platforms at any time.</li>
          <li>Opt out of marketing emails using the unsubscribe link, while still receiving essential service messages.</li>
          <li>Contact us at {CONTACT_EMAIL} to exercise your data-protection rights.</li>
        </ul>
        <p>
          We will respond to verified requests as required by applicable law. You may also have the right
          to lodge a complaint with your local data-protection authority.
        </p>
      </>
    ),
  },
  {
    id: 'transfers',
    title: '11. International Data Transfers',
    body: (
      <p>
        We may process and store your information in countries other than the one in which you live. Where
        we transfer personal information across borders, we take steps to ensure it receives an adequate
        level of protection consistent with applicable law and this Policy.
      </p>
    ),
  },
  {
    id: 'children',
    title: '12. Children&rsquo;s Privacy',
    body: (
      <p>
        The Service is not directed to children under the age required to consent to online services in
        their jurisdiction, and we do not knowingly collect personal information from them. If you believe
        a child has provided us with personal information, please contact us and we will take appropriate
        steps to delete it.
      </p>
    ),
  },
  {
    id: 'links',
    title: '13. Third-Party Links',
    body: (
      <p>
        The Service may contain links to third-party websites or services that we do not control. This
        Policy does not apply to those third parties, and we encourage you to review their privacy
        policies before providing them with any information.
      </p>
    ),
  },
  {
    id: 'changes',
    title: '14. Changes to This Policy',
    body: (
      <p>
        We may update this Privacy Policy from time to time. When we make material changes, we will update
        the &ldquo;Last updated&rdquo; date and, where appropriate, provide additional notice. Your
        continued use of the Service after changes take effect constitutes acceptance of the updated
        Policy.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '15. Contact Us',
    body: (
      <p>
        If you have questions about this Privacy Policy or how we handle your information, contact us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Navbar />

      <section className="relative overflow-hidden py-16 lg:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent" />
        <div className="relative mx-auto max-w-3xl px-6">
          <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm text-muted">Last updated: {LAST_UPDATED}</p>
          <p className="mt-6 text-[15px] text-muted leading-relaxed">
            Your privacy matters to us. This Policy explains what information we collect, how we use it,
            and the choices you have when you use OmliveStream.
          </p>
        </div>
      </section>

      <section className="relative pb-24">
        <div className="mx-auto max-w-3xl px-6">
          {/* Quick navigation */}
          <nav className="mb-12 rounded-2xl bg-[#14102A]/60 border border-primary/15 p-6">
            <p className="text-xs uppercase tracking-widest text-muted mb-4">On this page</p>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-muted hover:text-primary transition">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-12">
            {SECTIONS.map((s) => (
              <div key={s.id} id={s.id} className="scroll-mt-24">
                <h2 className="font-display text-xl md:text-2xl font-semibold tracking-tight mb-4">
                  {s.title}
                </h2>
                <div className="space-y-4 text-[15px] text-muted leading-relaxed">{s.body}</div>
              </div>
            ))}
          </div>

          <p className="mt-16 text-sm text-muted">
            By using OmliveStream, you acknowledge that you have read and understood this Privacy Policy.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
