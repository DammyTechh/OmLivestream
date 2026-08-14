'use client';
import { useEffect, useState } from 'react';
import { Eye, TrendingUp, Heart, Users, BarChart3 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Card } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { useChartTheme } from '@/lib/theme';

/**
 * Shape of GET /analytics/overview. These are camelCase because that is what
 * the route actually sends (analytics.routes.ts:57) — the page previously
 * declared them as total_views/total_impressions/total_engagement, which are
 * not fields on the response, so every stat card rendered its `?? 0` fallback.
 * The randomised trend chart below them made a page of zeros look alive.
 *
 * peakViewers replaces the old impressions figure. Nothing reports impressions
 * for a live broadcast — not the YouTube Data API, not the Graph API — so the
 * card could only ever have shown zero.
 */
interface Overview {
  totalViews?:   number;
  peakViewers?:  number;
  totalComments?: number;
  byPlatform?: Record<string, { views: number; peakViewers: number; comments: number }>;
}

/** One pre-aggregated period row from GET /analytics/platforms. */
interface PlatformRow {
  platform: string;
  period: string;
  total_views: number;
  total_engagement: number;
  recorded_at: string;
}

export default function AnalyticsPage() {
  // Recharts takes literal colours, not classes, so the chart palette has to
  // be resolved for whichever theme is on screen.
  const { palette, axis, tooltip } = useChartTheme();
  const [overview, setOverview] = useState<Overview>({});
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [o, p] = await Promise.all([
          api.get('/analytics/overview').then(r => r.data?.data || {}).catch(() => ({})),
          api.get('/analytics/platforms').then(r => r.data?.data || []).catch(() => []),
        ]);
        setOverview(o as Overview);
        setRows(p as PlatformRow[]);
      } finally { setLoading(false); }
    })();
  }, []);

  // The route returns one row per platform per period, newest first. The bar
  // chart wants one bar per platform, so fold the periods together here rather
  // than plotting the raw rows — which would draw the same platform once per
  // period and read as duplicate bars.
  //
  // Peak is not folded from these rows: platform_analytics stores no peak
  // column, and a max over daily view totals would not be one. It comes from
  // the overview response, which takes it from the metrics series — the same
  // 30-day window, so the two sides line up.
  const byPlatform = Object.values(
    rows.reduce<Record<string, { platform: string; views: number; peakViewers: number; engagement: number }>>((acc, r) => {
      const k = r.platform;
      acc[k] ??= { platform: k, views: 0, peakViewers: overview.byPlatform?.[k]?.peakViewers ?? 0, engagement: 0 };
      acc[k].views      += Number(r.total_views)      || 0;
      acc[k].engagement += Number(r.total_engagement) || 0;
      return acc;
    }, {}),
  );

  // Daily totals, oldest to newest, from the same rows. This replaces a
  // 14-point Math.random() series that was labelled "Day 1..14" and presented
  // as the user's own performance. A chart of invented numbers is worse than
  // no chart: it is indistinguishable from real data and cannot be acted on.
  const trendData = Object.entries(
    rows.reduce<Record<string, { views: number }>>((acc, r) => {
      const day = (r.recorded_at ?? '').slice(0, 10);
      if (!day) return acc;
      acc[day] ??= { views: 0 };
      acc[day].views += Number(r.total_views) || 0;
      return acc;
    }, {}),
  )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day: new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...v,
    }));

  const totalViews = overview.totalViews ?? 0;

  const stats = [
    { label: 'Total views',   value: totalViews,                     icon: Eye,        color: palette.primary },
    // Peak concurrent audience across the period — the only honest number for
    // a live platform. The old card claimed "Impressions", which no API this
    // app holds a token for reports for a live broadcast.
    { label: 'Peak audience', value: overview.peakViewers ?? 0,       icon: TrendingUp, color: palette.primaryDeep },
    { label: 'Comments',      value: overview.totalComments ?? 0,     icon: Heart,      color: palette.accent },
    // Averaged over the days that actually reported, not a hardcoded 7. With
    // the old divisor a user who streamed twice saw their views quietly cut
    // to a seventh and labelled an average.
    {
      label: 'Avg views / day',
      value: trendData.length ? Math.round(totalViews / trendData.length) : 0,
      icon: Users,
      color: palette.success,
    },
  ];

  const hasData = rows.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted mt-1">Last 30 days of performance across all your platforms.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            {/* Matches the Overview treatment: a quiet outlined glyph rather
                than a tinted chip per metric. Four differently-coloured tiles
                implied a colour coding that never existed. */}
            <s.icon size={17} strokeWidth={1.75} className="text-muted mb-3" />
            <div className="font-display text-3xl font-semibold">
              {loading ? <span className="inline-block w-16 h-8 rounded bg-veil/5 animate-pulse align-middle" /> : formatNumber(s.value)}
            </div>
            <div className="text-xs text-muted mt-1">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Trend chart */}
      <Card className="p-6">
        <h2 className="font-display text-xl font-semibold mb-4">Views over time</h2>
        {loading ? (
          <div className="h-72 rounded-xl bg-veil/[0.03] animate-pulse" />
        ) : trendData.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-center">
            <BarChart3 size={30} className="text-muted opacity-40 mb-3" />
            <p className="text-sm text-muted">Nothing to chart yet.</p>
            <p className="text-xs text-subtle mt-1">Your first broadcast starts collecting these numbers.</p>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.primary} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={palette.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={axis.gridDash} stroke={axis.gridStroke} />
                <XAxis dataKey="day" stroke={axis.stroke} fontSize={12} />
                <YAxis stroke={axis.stroke} fontSize={12} />
                <Tooltip contentStyle={tooltip} />
                <Area type="monotone" dataKey="views" stroke={palette.primary} fill="url(#v)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Platform breakdown */}
      <Card className="p-6">
        <h2 className="font-display text-xl font-semibold mb-4">Platform breakdown</h2>
        {loading ? (
          <div className="h-72 rounded-xl bg-veil/[0.03] animate-pulse" />
        ) : !hasData ? (
          <div className="h-40 flex items-center justify-center text-muted text-sm">No data yet — go live to start collecting.</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPlatform}>
                <CartesianGrid strokeDasharray={axis.gridDash} stroke={axis.gridStroke} />
                <XAxis dataKey="platform" stroke={axis.stroke} fontSize={12} />
                <YAxis stroke={axis.stroke} fontSize={12} />
                <Tooltip contentStyle={tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="views"       fill={palette.primary}     radius={[6, 6, 0, 0]} name="Views" />
                <Bar dataKey="peakViewers" fill={palette.primaryDeep} radius={[6, 6, 0, 0]} name="Peak audience" />
                <Bar dataKey="engagement"  fill={palette.accent}      radius={[6, 6, 0, 0]} name="Comments" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
