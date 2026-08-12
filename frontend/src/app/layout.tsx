import type { Metadata } from 'next';
import { Fraunces, DM_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ThemedToaster } from '@/components/theme/ThemedToaster';
import '@/styles/globals.css';

const fraunces  = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', weight: ['400','500','600','700','800'] });
const dmSans    = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', weight: ['400','500','700'] });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap', weight: ['400','500','600'] });

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://omlivestream.com';

const TITLE = 'OmliveStream — Stream Smarter. Reach Faster. Broadcast Anywhere.';
const DESCRIPTION =
  'Multi-platform live streaming. Go live on YouTube, TikTok, Instagram, Facebook, Twitch and more — all at once, from one browser tab.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'OmliveStream',
  // All self-hosted from public/. These were previously hot-linked from an
  // imgur URL, which put the brand — and every page's favicon — behind a
  // third party with no uptime commitment to us.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'OmliveStream',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'OmliveStream' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
};

/**
 * Applied before the browser paints anything.
 *
 * Light is the default, so it is already on :root and needs no work. This
 * exists for the returning dark-mode visitor: without it, the first frame is
 * light and the theme snaps to dark once React hydrates, which is the flash of
 * wrong theme every themed site has to solve. A blocking inline script in
 * <head> is the only thing that runs early enough.
 *
 * Deliberately not reading prefers-color-scheme — plenty of people keep their
 * OS dark without wanting every site dark, and honouring it would override the
 * product's intended default for them.
 *
 * Written as a compact string, wrapped in try/catch because localStorage
 * throws outright in some privacy modes, and an exception here would block
 * the parser.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('omls-theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above mutates <html>'s class before
    // React hydrates, so the server-rendered markup and the live DOM differ by
    // design. Scoped to this element only.
    <html
      lang="en"
      className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans bg-bg text-text antialiased">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
