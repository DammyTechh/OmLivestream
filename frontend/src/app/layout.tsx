import type { Metadata } from 'next';
import { Fraunces, DM_Sans, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import '@/styles/globals.css';

const fraunces  = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap', weight: ['400','500','600','700','800'] });
const dmSans    = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', weight: ['400','500','700'] });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap', weight: ['400','500','600'] });

export const metadata: Metadata = {
  title: 'OmliveStream — Stream Smarter. Reach Faster. Broadcast Anywhere.',
  description: 'Multi-platform live streaming. Go live on YouTube, TikTok, Instagram, Facebook, Twitch and more — all at once, from one browser tab.',
  icons: { icon: 'https://i.imgur.com/0NFlGxJ.png' },
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
