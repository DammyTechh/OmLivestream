import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/urls';

/**
 * Sitemap for the public site.
 *
 * Next.js serves this file at /sitemap.xml automatically — there is no static
 * file to keep in sync, and the host comes from NEXT_PUBLIC_SITE_URL so the
 * URLs are always absolute and always match the deployed domain.
 *
 * Only genuinely public, indexable pages belong here. Everything behind auth
 * (/dashboard, /admin, /onboarding, /payment) is deliberately absent: those
 * pages redirect to sign-in for a crawler, so listing them would ask Google to
 * index a login screen over and over and would dilute the pages that matter.
 * Sign-in and sign-up are omitted for the same reason — they are destinations
 * for people who already know the product, not landing pages for search.
 *
 * `lastModified` is set at build time. That is honest for marketing copy that
 * only changes when the site is redeployed, which is exactly the case here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '',          priority: 1.0, changeFrequency: 'weekly'  },
    { path: '/about',    priority: 0.8, changeFrequency: 'monthly' },
    { path: '/waitlist', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/privacy',  priority: 0.3, changeFrequency: 'yearly'  },
    { path: '/terms',    priority: 0.3, changeFrequency: 'yearly'  },
  ];

  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
