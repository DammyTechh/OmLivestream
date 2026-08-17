import { SITE_URL, SOCIAL_URL, SUPPORT_EMAIL, SALES_EMAIL } from '@/lib/urls';

/**
 * Organization structured data (schema.org JSON-LD) for the homepage.
 *
 * The sitemap tells Google which pages exist; this tells it what OmliveStream
 * *is* — the official name, the canonical URL, the logo to show in search
 * results, how to make contact, and which social accounts genuinely belong to
 * the brand. Without it the Schema.org validator reports "no items detected",
 * which is what prompted this.
 *
 * Decisions worth recording:
 *
 *  • Type is `Organization`. Google asks for the most specific subtype that
 *    *accurately* applies, not the most specific one available. `OnlineBusiness`
 *    exists, but it carries connotations of a storefront and adds no property
 *    used here, so the plain type is the honest choice. If OmliveStream later
 *    fits something like `SoftwareApplication` for the product itself, that
 *    belongs in separate markup rather than by relabelling the company.
 *
 *  • `@id` is a stable fragment URI on the canonical host. That is what lets
 *    other markup on the site point at the same organisation rather than
 *    implying several different ones.
 *
 *  • Everything uses the www host, matching the canonical URL, the sitemap and
 *    the redirects. Google treats www and non-www as different sites; mixing
 *    them here would split the identity between two organisations.
 *
 *  • No `founder`, `foundingDate` or company registration number. Those are
 *    accurate-or-absent fields and none has been confirmed — inventing them is
 *    exactly what Google's guidance warns against, and structured data that
 *    contradicts reality is worse than none.
 */
export function OrganizationSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'OmliveStream',
    alternateName: 'OmliveStream Made Easy',
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/logo.png`,
      caption: 'OmliveStream',
    },
    image: `${SITE_URL}/logo.png`,
    description:
      'OmliveStream lets creators broadcast live to YouTube, Facebook, Instagram, TikTok, ' +
      'Twitch, X, LinkedIn and Kick simultaneously from one stream, with unified comments, ' +
      'recording and analytics.',
    email: SUPPORT_EMAIL,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Block 56, Lugbe Estate',
      addressLocality: 'Lugbe',
      addressRegion: 'Federal Capital Territory',
      addressCountry: 'NG',
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SUPPORT_EMAIL,
        availableLanguage: ['English'],
        areaServed: 'Worldwide',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: SALES_EMAIL,
        availableLanguage: ['English'],
        areaServed: 'Worldwide',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'privacy',
        email: 'privacy@omlivestream.com',
        availableLanguage: ['English'],
      },
    ],
    // Only accounts confirmed to belong to OmliveStream. A wrong URL here
    // associates someone else's account with the brand, so this list stays
    // conservative.
    sameAs: [
      SOCIAL_URL.youtube,
      SOCIAL_URL.tiktok,
      SOCIAL_URL.instagram,
      SOCIAL_URL.facebook,
      SOCIAL_URL.x,
      SOCIAL_URL.threads,
    ],
  };

  return (
    <script
      type="application/ld+json"
      // JSON-LD is data, not markup, and React does not render <script> children
      // as text. Serialising it this way is the documented approach. The content
      // is built entirely from our own constants — no user input reaches it —
      // and the `<` escape keeps a stray sequence from closing the tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
      }}
    />
  );
}

/**
 * WebSite markup, paired with the Organization above.
 *
 * Small but worth having: it names the site, ties it to the same `@id`, and
 * gives Google an unambiguous statement of the canonical host — reinforcing the
 * www choice rather than leaving it to be inferred.
 */
export function WebSiteSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'OmliveStream',
    publisher: { '@id': `${SITE_URL}/#organization` },
    inLanguage: 'en',
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
      }}
    />
  );
}
