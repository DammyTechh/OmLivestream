import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/urls';

/**
 * robots.txt, served by Next at /robots.txt.
 *
 * Two jobs. First, it points crawlers at the sitemap, which is how Google finds
 * it without anyone submitting anything by hand. Second, it keeps the crawl
 * budget on pages worth ranking.
 *
 * The disallowed paths are all authenticated or transactional. A crawler
 * reaching them gets a redirect to sign-in, so allowing them would mean Google
 * repeatedly fetching a login page under a dozen different URLs. /payment and
 * /auth/callback additionally carry references and tokens in their query
 * strings that have no business in a search index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/admin', '/onboarding', '/payment', '/auth/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
