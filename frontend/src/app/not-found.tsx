'use client';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/landing/Navbar';
import { WavyBackground } from '@/components/ui/WavyBackground';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="relative flex-1 overflow-hidden">
        <WavyBackground />
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)] px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center w-full max-w-2xl"
          >
            {/* 404 illustration — responsive */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="relative w-full max-w-md sm:max-w-lg mx-auto mb-8 md:mb-10"
            >
              <Image
                src="https://i.imgur.com/Q4THVgS.png"
                alt="Page not found"
                width={800}
                height={600}
                className="w-full h-auto drop-shadow-[0_20px_60px_rgba(168,85,247,0.3)]"
                priority
              />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-tight mb-6 md:mb-8 px-4"
            >
              We couldn't find the page<br className="hidden sm:inline" />
              <span className="sm:hidden"> </span>you were looking for
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-primary text-white font-semibold text-base hover:bg-primary/90 transition shadow-lg shadow-primary/25"
              >
                Back to Homepage
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
