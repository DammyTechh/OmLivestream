'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdmin } from '@/store/auth';
import { Spinner } from '@/components/ui/Spinner';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { admin, accessToken, hydrated, hydrate } = useAdmin();

  useEffect(() => { if (!hydrated) hydrate(); }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/admin');
  }, [hydrated, accessToken, router]);

  if (!hydrated || !accessToken) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner size={32} /></div>;
  }
  return <>{children}</>;
}
