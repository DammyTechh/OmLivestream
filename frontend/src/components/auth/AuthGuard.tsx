'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { TOKEN_KEYS } from '@/lib/api';
import { Spinner } from '@/components/ui/Spinner';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, hydrate, refreshProfile } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEYS.ACCESS) : null;
    if (!token) {
      router.replace('/auth/signin');
      return;
    }
    // Hydrate store then fetch fresh profile before marking ready
    hydrate();
    refreshProfile().finally(() => setReady(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After profile loads, check if onboarding is needed
  useEffect(() => {
    if (!ready) return;
    if (user && user.onboarding_completed === false) {
      router.replace('/onboarding');
    }
  }, [ready, user, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return <>{children}</>;
}