'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, CreditCard, TrendingUp, Radio } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { Card } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { useChartTheme } from '@/lib/theme';

interface DashboardStats {
  users?: {
    total: number;
    premium: number;
    newThisWeek: number;
    newThisMonth: number;
  };
  streams?: {
    total: number;
    live: number;
  };
  revenue?: {
    total: number;
    thisMonth: number;
    totalFormatted: string;
    thisMonthFormatted: string;
  };
}

export default function AdminDashboardPage() {
  // Recharts takes literal colours, not classes, so the chart palette has to
  // be resolved for whichever theme is on screen.
  const { palette, axis, tooltip } = useChartTheme();
  const [stats, setStats] = useState<DashboardStats>({});
  const [revenue, setRevenue] = useState<{ date: string; amount: number }[]>([]);
  const [growth, setGrowth] = useState<{ date: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, r, g] = await Promise.all([
          api.get('/admin/dashboard').then(res => res.data?.data || {}).catch(() => ({})),
          api.get('/admin/charts/revenue').then(res => res.data?.data || []).catch(() => []),
          api.get('/admin/charts/user-growth').then(res => res.data?.data || []).catch(() => []),
        ]);
        setStats(s);
        setRevenue(r);
        setGrowth(g);
      } finally { setLoading(false); }
    })();
  }, []);

  const kpiCards = [
    { label: 'Total users',  value: formatNumber(stats.users?.total ?? 0),   icon: Users,      color: palette.primary },
    { label: 'Premium',      value: formatNumber(stats.users?.premium ?? 0),  icon: TrendingUp, color: palette.success },
    { label: 'Revenue',      value: stats.revenue?.totalFormatted ?? formatCurrency(0), icon: CreditCard, color: palette.accent },
    { label: 'Live streams', value: formatNumber(stats.streams?.live ?? 0),   icon: Radio,      color: palette.warning },
  ];

  // Normalise chart keys — backend returns { date, amount } and { date, total }
  const revenueData = revenue.length
    ? revenue.map((r, i) => ({ day: `Day ${i + 1}`, amount: r.amount }))
    : Array.from({ length: 30 }, (_, i) => ({ day: `Day ${i + 1}`, amount: 0 }));

  const growthData = growth.length
    ? growth.map((g, i) => ({ day: `Day ${i + 1}`, count: g.total }))
    : Array.from({ length: 30 }, (_, i) => ({ day: `Day ${i + 1}`, count: 0 }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted mt-1">High-level platform health and performance metrics.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="p-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${s.color}22` }}>
                <s.icon size={18} style={{ color: s.color }} />
              </div>
              <div className="font-display text-3xl font-semibold tracking-tight">{loading ? '…' : s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-6">
          <h2 className="font-display text-xl font-semibold mb-4">Revenue — last 30 days</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={palette.accent} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={palette.accent} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={axis.gridDash} stroke={axis.gridStroke} />
                <XAxis dataKey="day" stroke={axis.stroke} fontSize={11} />
                <YAxis stroke={axis.stroke} fontSize={11} />
                <Tooltip contentStyle={tooltip} />
                <Area type="monotone" dataKey="amount" stroke={palette.accent} fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-xl font-semibold mb-4">User growth</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growthData}>
                <defs>
                  <linearGradient id="grw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={palette.primary} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={palette.primary} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={axis.gridDash} stroke={axis.gridStroke} />
                <XAxis dataKey="day" stroke={axis.stroke} fontSize={11} />
                <YAxis stroke={axis.stroke} fontSize={11} />
                <Tooltip contentStyle={tooltip} />
                <Area type="monotone" dataKey="count" stroke={palette.primary} fill="url(#grw)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}