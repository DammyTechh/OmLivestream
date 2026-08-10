import type { Metadata } from 'next';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { AboutContent } from '@/components/landing/AboutContent';

export const metadata: Metadata = {
  title: 'About — OmliveStream | Stream to Every Platform at Once',
  description:
    'OmliveStream is a web-based live streaming platform that lets you broadcast to Facebook, TikTok, Instagram, Twitch, YouTube and more simultaneously from one unified dashboard.',
};

export default function AboutPage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Navbar />
      <AboutContent />
      <Footer />
    </main>
  );
}
