'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Lock, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { api, unwrap, getApiError } from '@/lib/api';
import { useAdmin } from '@/store/auth';

export default function AdminLoginPage() {
  const router = useRouter();
  const { setTokens, setAdmin, hydrate, hydrated, accessToken } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!hydrated) hydrate(); }, [hydrated, hydrate]);
  useEffect(() => { if (hydrated && accessToken) router.replace('/admin/dashboard'); }, [hydrated, accessToken, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return toast.error('Fill all fields');
    setLoading(true);
    try {
      const data = unwrap<{ accessToken: string; refreshToken: string; admin: any }>(
        await api.post('/admin/auth/login', { email, password })
      );
      setTokens(data.accessToken, data.refreshToken);
      setAdmin(data.admin);
      toast.success('Welcome back');
      router.push('/admin/dashboard');
    } catch (err) {
      toast.error(getApiError(err, 'Login failed'));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="aurora" />
      <div className="absolute inset-0 noise-overlay" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="flex justify-between items-center mb-8">
          <Logo />
          <Link href="/" className="text-xs text-muted hover:text-text">← Home</Link>
        </div>

        <Card className="p-8">
          <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full bg-primary/10 border border-border text-xs text-primary">
            <ShieldCheck size={12} /> Admin Portal
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight mb-2">Admin Sign In</h1>
          <p className="text-muted mb-6 text-sm">Restricted access — authorised administrators only.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Admin Email"
              type="email"
              icon={<Mail size={18} />}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@omlivestream.com"
            />
            <Input
              label="Password"
              type="password"
              icon={<Lock size={18} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-subtle">
          For security, all admin actions are logged and audited.
        </p>
      </motion.div>
    </div>
  );
}
