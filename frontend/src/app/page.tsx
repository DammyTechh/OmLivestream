import { Navbar }     from '@/components/landing/Navbar';
import { Hero }       from '@/components/landing/Hero';
import { Features }   from '@/components/landing/Features';
import { AIFeatures } from '@/components/landing/AIFeatures';
import { Pricing }    from '@/components/landing/Pricing';
import { Contact }    from '@/components/landing/Contact';
import { Footer }     from '@/components/landing/Footer';

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Navbar />
      <Hero />
      <Features />
      <AIFeatures />
      <Pricing />
      <Contact />
      <Footer />
    </main>
  );
}
