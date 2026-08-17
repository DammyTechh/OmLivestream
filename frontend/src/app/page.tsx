import { Navbar }     from '@/components/landing/Navbar';
import { Hero }       from '@/components/landing/Hero';
import { Features }   from '@/components/landing/Features';
import { AIFeatures } from '@/components/landing/AIFeatures';
import { Pricing }    from '@/components/landing/Pricing';
import { Contact }    from '@/components/landing/Contact';
import { Footer }     from '@/components/landing/Footer';
import { OrganizationSchema, WebSiteSchema } from '@/components/seo/OrganizationSchema';

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      {/* Organization identity for search engines. Google's guidance is to put
          this on the homepage or the About page; it renders nothing visible. */}
      <OrganizationSchema />
      <WebSiteSchema />
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
