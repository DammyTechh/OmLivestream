import type { Metadata } from 'next';
import Link from 'next/link';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Terms of Service — OmliveStream',
  description:
    'The terms and conditions that govern your access to and use of the OmliveStream multi-platform live streaming service.',
};

const LAST_UPDATED = 'August 10, 2026';
const CONTACT_EMAIL = 'support@omlivestream.com';

type Section = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of These Terms',
    body: (
      <>
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) form a binding agreement between you and
          OmliveStream (&ldquo;OmliveStream,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) and govern your access to and use of the OmliveStream website,
          applications, dashboard, APIs, and related services (collectively, the
          &ldquo;Service&rdquo;).
        </p>
        <p>
          By creating an account, joining the waitlist, or otherwise accessing or using the Service,
          you confirm that you have read, understood, and agree to be bound by these Terms and by our
          Privacy Policy. If you do not agree, you must not use the Service. If you use the Service on
          behalf of an organization, you represent that you are authorized to bind that organization
          to these Terms.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: '2. Eligibility',
    body: (
      <p>
        You must be at least 18 years old, or the age of majority in your jurisdiction, to create an
        account. If you are between the minimum digital-consent age and 18, you may use the Service
        only with the involvement and consent of a parent or legal guardian. You are responsible for
        ensuring that your use of the Service is lawful where you live and where you broadcast.
      </p>
    ),
  },
  {
    id: 'description',
    title: '3. The Service',
    body: (
      <>
        <p>
          OmliveStream is a web-based platform that enables you to broadcast a single live video feed
          to multiple third-party social and streaming platforms at the same time, and to manage
          comments, analytics, recordings, and editing from one unified dashboard. Features may
          include network-adaptive resolution, a unified comment view, live analytics, automatic
          recording, and AI-assisted and manual video editing.
        </p>
        <p>
          We are continually improving the Service and may add, change, suspend, or remove features
          at any time. Some features are available only on paid plans, and some may be offered as
          previews or in beta and may change or be discontinued.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: '4. Accounts & Security',
    body: (
      <>
        <p>
          To use most features you must register for an account and provide accurate, complete
          information. You are responsible for maintaining the confidentiality of your login
          credentials and for all activity that occurs under your account.
        </p>
        <p>
          Notify us immediately at {CONTACT_EMAIL} if you suspect any unauthorized use of your
          account. We are not liable for any loss arising from unauthorized use of your account where
          you failed to keep your credentials secure.
        </p>
      </>
    ),
  },
  {
    id: 'waitlist',
    title: '5. Waitlist & Promotional Offers',
    body: (
      <>
        <p>
          From time to time we run promotional campaigns, including a launch waitlist. Benefits such
          as a free premium period, introductory discounts, or early access are offered at our
          discretion, may have eligibility conditions, and may be modified, limited, or withdrawn at
          any time before they are redeemed.
        </p>
        <p>
          Promotional benefits have no cash value, are non-transferable, and cannot be combined with
          other offers unless we say so. Any free trial or introductory period will, unless stated
          otherwise, convert to a paid subscription at the applicable rate unless you cancel before
          the period ends.
        </p>
      </>
    ),
  },
  {
    id: 'billing',
    title: '6. Subscriptions, Billing & Refunds',
    body: (
      <>
        <p>
          Paid plans are billed on a recurring subscription basis (for example, monthly) through our
          third-party payment processors. By subscribing, you authorize us and our processors to
          charge your chosen payment method on a recurring basis until you cancel.
        </p>
        <p>
          Subscriptions renew automatically at the end of each billing cycle unless cancelled before
          the renewal date. You can cancel at any time from your account settings; cancellation takes
          effect at the end of the current billing period, and you will retain paid access until then.
        </p>
        <p>
          Except where required by applicable law, payments are non-refundable and we do not provide
          refunds or credits for partial billing periods, unused features, or downgrades. Prices are
          shown in the currency stated at checkout and may change on renewal with prior notice. You
          are responsible for any applicable taxes.
        </p>
      </>
    ),
  },
  {
    id: 'third-party',
    title: '7. Third-Party Platforms & Integrations',
    body: (
      <>
        <p>
          The Service lets you connect and broadcast to third-party platforms such as YouTube,
          Facebook, Instagram, TikTok, and Twitch. OmliveStream is not affiliated with, endorsed by,
          or sponsored by these platforms, and their names and logos are the property of their
          respective owners.
        </p>
        <p>
          Your use of each connected platform is governed by that platform&rsquo;s own terms,
          policies, and community guidelines. You are solely responsible for complying with them and
          for maintaining any accounts, permissions, or eligibility they require. We are not
          responsible for a third-party platform&rsquo;s availability, changes to its APIs, rejection
          of your stream, suspension of your account, or any resulting interruption of the Service.
        </p>
      </>
    ),
  },
  {
    id: 'content',
    title: '8. Your Content',
    body: (
      <>
        <p>
          You retain all ownership rights in the video, audio, images, text, and other content you
          stream, upload, record, or create using the Service (&ldquo;Your Content&rdquo;). You grant
          OmliveStream a limited, non-exclusive, worldwide, royalty-free license to host, store,
          process, transmit, encode, reproduce, and display Your Content solely as necessary to
          operate, provide, secure, and improve the Service — including relaying your broadcast to the
          platforms you select and generating recordings, analytics, and edits at your direction.
        </p>
        <p>
          You represent and warrant that you own or have all rights, licenses, and permissions needed
          to use and distribute Your Content, including any music, footage, trademarks, or
          third-party materials it contains, and that Your Content does not infringe the rights of any
          third party or violate any law.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: '9. Acceptable Use',
    body: (
      <>
        <p>You agree not to use the Service to create, broadcast, store, or distribute content that:</p>
        <ul className="list-disc pl-5 space-y-2 marker:text-primary/60">
          <li>Is unlawful, fraudulent, defamatory, obscene, or infringes intellectual property or privacy rights;</li>
          <li>Depicts or promotes violence, hate, harassment, child sexual abuse material, or the sexual exploitation of minors;</li>
          <li>Contains malware, or is used to hack, disrupt, overload, or gain unauthorized access to the Service or others&rsquo; systems;</li>
          <li>Violates the terms or community guidelines of any connected third-party platform;</li>
          <li>Attempts to resell, sublicense, reverse-engineer, scrape, or circumvent the technical limits or protections of the Service.</li>
        </ul>
        <p>
          We may investigate suspected violations and may remove content, throttle, suspend, or
          terminate access without notice where we reasonably believe it is necessary to protect the
          Service, our users, or third parties, or to comply with law.
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    title: '10. AI-Assisted Features',
    body: (
      <p>
        Certain features use artificial intelligence to generate titles, descriptions, hashtags,
        edits, clips, and similar outputs. AI outputs are provided for convenience, may be inaccurate
        or unsuitable, and are not guaranteed. You are responsible for reviewing any AI-generated
        output before you publish or rely on it, and for ensuring it complies with these Terms,
        applicable law, and the policies of any platform where it is used.
      </p>
    ),
  },
  {
    id: 'recordings',
    title: '11. Recordings & Storage',
    body: (
      <p>
        Where enabled, the Service may automatically record your live sessions and store them so you
        can edit, export, or reuse them. Storage may be subject to plan limits and retention periods,
        and we may delete recordings after such periods or after your account is closed. You are
        responsible for downloading and keeping your own copies of any content you wish to preserve.
      </p>
    ),
  },
  {
    id: 'ip',
    title: '12. Our Intellectual Property',
    body: (
      <p>
        The Service, including its software, design, dashboard, branding, and all associated
        intellectual property, is owned by OmliveStream and its licensors and is protected by
        applicable laws. These Terms grant you a limited, non-exclusive, non-transferable, revocable
        license to use the Service for its intended purpose. No other rights are granted, and you may
        not use our names, logos, or trademarks without our prior written permission.
      </p>
    ),
  },
  {
    id: 'copyright',
    title: '13. Copyright & Takedowns',
    body: (
      <p>
        We respect intellectual property rights and expect you to do the same. If you believe content
        on the Service infringes your copyright, contact us at {CONTACT_EMAIL} with enough detail to
        identify the work and the allegedly infringing material. We may remove infringing content and
        terminate the accounts of repeat infringers.
      </p>
    ),
  },
  {
    id: 'privacy',
    title: '14. Privacy',
    body: (
      <p>
        Our{' '}
        <Link href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>{' '}
        explains how we collect, use, and protect your information. By using the Service, you consent
        to the data practices described there.
      </p>
    ),
  },
  {
    id: 'disclaimer',
    title: '15. Disclaimers',
    body: (
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
        of any kind, whether express or implied, including implied warranties of merchantability,
        fitness for a particular purpose, and non-infringement. We do not warrant that the Service
        will be uninterrupted, error-free, secure, or that streams will always reach every connected
        platform, as delivery depends on your internet connection and on third-party platforms
        outside our control.
      </p>
    ),
  },
  {
    id: 'liability',
    title: '16. Limitation of Liability',
    body: (
      <p>
        To the maximum extent permitted by law, OmliveStream and its officers, employees, and partners
        will not be liable for any indirect, incidental, special, consequential, or punitive damages,
        or for lost profits, revenue, data, or goodwill, arising from or related to your use of the
        Service. Our total aggregate liability for any claim relating to the Service will not exceed
        the amount you paid us for the Service in the twelve (12) months before the event giving rise
        to the claim.
      </p>
    ),
  },
  {
    id: 'indemnity',
    title: '17. Indemnification',
    body: (
      <p>
        You agree to indemnify and hold harmless OmliveStream and its team from any claims, damages,
        losses, liabilities, and expenses (including reasonable legal fees) arising out of Your
        Content, your use or misuse of the Service, your violation of these Terms, or your violation
        of any law or the rights of a third party or connected platform.
      </p>
    ),
  },
  {
    id: 'termination',
    title: '18. Suspension & Termination',
    body: (
      <p>
        You may stop using the Service and close your account at any time. We may suspend or terminate
        your access, with or without notice, if you breach these Terms, if required by law, or to
        protect the Service or other users. On termination, your right to use the Service ends and we
        may delete your account and associated content, subject to any retention required by law.
      </p>
    ),
  },
  {
    id: 'changes',
    title: '19. Changes to the Service & These Terms',
    body: (
      <p>
        We may update these Terms from time to time. When we make material changes, we will update the
        &ldquo;Last updated&rdquo; date and, where appropriate, provide additional notice. Your
        continued use of the Service after changes take effect constitutes acceptance of the revised
        Terms. If you do not agree, you should stop using the Service.
      </p>
    ),
  },
  {
    id: 'law',
    title: '20. Governing Law & Disputes',
    body: (
      <p>
        These Terms are governed by the laws of the Federal Republic of Nigeria, without regard to its
        conflict-of-laws rules. You agree that the competent courts located in Nigeria will have
        jurisdiction over any dispute arising out of or relating to these Terms or the Service, except
        where applicable law grants you the right to bring proceedings elsewhere.
      </p>
    ),
  },
  {
    id: 'contact',
    title: '21. Contact Us',
    body: (
      <p>
        Questions about these Terms? Reach us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Navbar />

      <section className="relative overflow-hidden py-16 lg:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent" />
        <div className="relative mx-auto max-w-3xl px-6">
          <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm text-muted">Last updated: {LAST_UPDATED}</p>
          <p className="mt-6 text-[15px] text-muted leading-relaxed">
            Please read these Terms carefully. They govern your access to and use of OmliveStream. By
            using the Service you agree to them.
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
            By continuing to use OmliveStream, you acknowledge that you have read and agree to these
            Terms of Service.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
