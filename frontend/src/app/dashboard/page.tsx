'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Radio, Eye, Heart, TrendingUp, Plus, Clock, Sparkles, ArrowRight, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/store/auth';
import { formatNumber, timeAgo } from '@/lib/utils';

/**
 * GET /analytics/overview. camelCase, matching what the route sends
 * (analytics.routes.ts:50). The previous snake_case declaration matched no
 * field on the response, so all three cards were permanently zero.
 */
interface Overview {
  totalViews?:    number;
  peakViewers?:   number;
  totalComments?: number;
}

interface Stream {
  id: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
}

interface OnboardingStatus {
  complete: boolean;
  profileComplete: boolean;
  surveyComplete: boolean;
}

export default function DashboardHomePage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview>({});
  const [recent, setRecent] = useState<Stream[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [showPrompt, setShowPrompt] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [o, s, onb] = await Promise.all([
          api.get('/analytics/overview').then(r => r.data?.data || {}).catch(() => ({})),
          api.get('/streams?limit=5').then(r => r.data?.data || []).catch(() => []),
          api.get('/users/onboarding/status').then(r => r.data?.data as OnboardingStatus).catch(() => null),
        ]);
        setOverview(o);
        setRecent(s as Stream[]);
        setOnboarding(onb);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = [
    { label: 'Total views',     value: overview.totalViews ?? 0,         icon: Eye,        color: 'from-primary to-accent' },
    // Peak concurrent audience, not impressions: no live API this app reads
    // reports impressions, so that card could only ever have shown zero.
    { label: 'Peak audience',   value: overview.peakViewers ?? 0,        icon: TrendingUp, color: 'from-blue-500 to-primary' },
    { label: 'Comments',        value: overview.totalComments ?? 0,      icon: Heart,      color: 'from-accent to-danger' },
    // The streams endpoint returns at most 5; counting the array here would
    // show "5" for any account with more. The overview RPC does not return a
    // stream count, so label this card for what it is.
    { label: 'Recent streams',  value: recent.length,                    icon: Radio,      color: 'from-primary-deep to-primary' },
  ];

  return (
    <div className="space-y-6">
      {/* Onboarding incomplete banner */}
      {onboarding && !onboarding.complete && showPrompt && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/30 p-6"
        >
          <button
            onClick={() => setShowPrompt(false)}
            className="absolute top-4 right-4 text-muted hover:text-text transition"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
          <div className="flex items-start gap-4 pr-8">
            <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
              <Sparkles size={20} className="text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg font-semibold mb-1">Finish setting up your profile</h3>
              <p className="text-sm text-muted mb-4">
                You're almost there — complete a quick survey so we can tailor your experience.
                {!onboarding.profileComplete && ' Add your name and details.'}
                {!onboarding.surveyComplete && ' Tell us what you stream.'}
              </p>
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
              >
                Continue setup <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
            Welcome back, <span className="italic text-primary">{user?.full_name?.split(' ')[0] ?? 'Creator'}</span>
          </h1>
          <p className="text-muted mt-1">Here's what's happening with your streams today.</p>
        </div>
        <Link href="/dashboard/streams/new">
          <Button icon={<Plus size={16} />}>Go Live</Button>
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="p-5">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-4`}>
                <s.icon size={18} className="text-white" />
              </div>
              <div className="font-display text-3xl font-semibold tracking-tight">
                {loading
                  ? <span className="inline-block w-16 h-8 rounded bg-veil/5 animate-pulse align-middle" />
                  : formatNumber(s.value)}
              </div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Recent streams */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold">Recent streams</h2>
          <Link href="/dashboard/streams" className="text-sm text-primary hover:underline">View all →</Link>
        </div>

        {loading ? (
          <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
        ) : recent.length === 0 ? (
          <Card className="py-14 text-center">
            <Radio size={40} className="text-muted mx-auto mb-4" />
            <h3 className="font-display text-xl font-semibold mb-2">No streams yet</h3>
            <p className="text-muted mb-6">Start your first broadcast — go live on up to 8 platforms at once.</p>
            <Link href="/dashboard/streams/new">
              <Button icon={<Plus size={16} />}>Start a stream</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-3">
            {recent.map((s) => (
              <Link key={s.id} href={`/dashboard/streams/${s.id}`}>
                <Card className="p-5 hover:border-primary/30 transition group cursor-pointer">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        s.status === 'live' ? 'bg-danger/20' : s.status === 'scheduled' ? 'bg-primary/20' : 'bg-veil/5'
                      }`}>
                        <Radio size={18} className={
                          s.status === 'live' ? 'text-danger animate-pulse' :
                          s.status === 'scheduled' ? 'text-primary' : 'text-muted'
                        } />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                          <Clock size={11} /> {timeAgo(s.created_at)}
                          <span>·</span>
                          <span className="capitalize">{s.status}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-muted group-hover:text-text transition">→</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
