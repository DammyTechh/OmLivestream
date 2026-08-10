import type { Metadata } from 'next';
import { Fraunces, DM_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="font-sans bg-bg text-text antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: '#14102A', color: '#F8F5FF', border: '1px solid rgba(124,58,237,0.3)' },
            success: { iconTheme: { primary: '#A855F7', secondary: '#FFFFFF' } },
          }}
        />
      </body>
    </html>
  );
}
