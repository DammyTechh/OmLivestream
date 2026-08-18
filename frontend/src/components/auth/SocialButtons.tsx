'use client';
import { api, unwrap, getApiError } from '@/lib/api';
import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';
import { GoogleIcon, FacebookIcon, InstagramIcon, TwitchIcon, TikTokIcon } from '@/components/ui/BrandIcons';

type Provider = 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch';

/**
 * No per-provider tile colour. Every one of these marks is already
 * self-sufficient — Facebook and Instagram carry their own filled backing,
 * Google and Twitch are drawn in brand colour on transparent, and TikTok's
 * monochrome glyph now inherits `currentColor` — so a single themed tile works
 * on either polarity. The previous map hardcoded #14102A for four of the five,
 * which put four navy squares on a white sign-in page.
 */
const PROVIDERS: Record<Provider, { label: string; Icon: React.FC<{ size?: number }> }> = {
  google:    { label: 'Google',    Icon: GoogleIcon    },
  facebook:  { label: 'Facebook',  Icon: FacebookIcon  },
  instagram: { label: 'Instagram', Icon: InstagramIcon },
  tiktok:    { label: 'TikTok',    Icon: TikTokIcon    },
  twitch:    { label: 'Twitch',    Icon: TwitchIcon    },
};

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5',
};

/**
 * Shown for the moment before the API replies with the real list.
 *
 * Kept in step with the server's PROVIDERS list — TikTok and Twitch are no
 * longer sign-in options, so listing them here would flash two buttons that
 * vanish a beat later, and any click landing in that window would open a
 * provider error page.
 */
const OPTIMISTIC: Provider[] = ['google', 'facebook', 'instagram'];

export function SocialButtons({ label = 'or continue with' }: { label?: string }) {
  const [loading, setLoading]   = useState<Provider | null>(null);
  const [enabled, setEnabled]   = useState<Provider[]>(OPTIMISTIC);

  // A provider without configured credentials returns 503 from the URL route,
  // so rendering its button would advertise a dead end. Ask the API which
  // ones are live rather than hard-coding a list that drifts from the deploy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = unwrap<{ id: Provider }[]>(await api.get('/auth/social/providers'));
        if (!cancelled && list.length) setEnabled(list.map((p) => p.id));
      } catch {
        // Keep the optimistic set — a failed probe is not a reason to strip
        // the sign-in options off the page.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = async (provider: Provider) => {
    setLoading(provider);
    try {
      // The API records the state server-side and verifies it in the
      // callback, so there is nothing for the browser to remember here. The
      // old sessionStorage round-trip could not survive the provider
      // redirecting to a different origin anyway.
      const data = unwrap<{ authUrl: string }>(await api.get(`/auth/social/${provider}/url`));
      window.location.href = data.authUrl;
    } catch (err) {
      toast.error(getApiError(err, `${PROVIDERS[provider].label} sign-in unavailable`));
      setLoading(null);
    }
  };

  if (!enabled.length) return null;

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted">{label}</p>
      {/* Written out rather than interpolated: Tailwind scans source text for
          complete class names, so `'grid-cols-' + n` compiles to nothing and
          the buttons stack in one column. */}
      <div className={`grid gap-3 ${GRID_COLS[Math.min(enabled.length, 5)] ?? 'grid-cols-4'}`}>
        {enabled.map((id) => {
          const p = PROVIDERS[id];
          if (!p) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => start(id)}
              disabled={loading !== null}
              className="h-14 rounded-xl flex items-center justify-center transition hover:scale-105 bg-surface text-text border border-border hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`Continue with ${p.label}`}
              title={`Continue with ${p.label}`}
            >
              {loading === id ? (
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              ) : (
                <p.Icon size={24} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
