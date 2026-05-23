'use client';
import { api, unwrap, getApiError } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { GoogleIcon, FacebookIcon, InstagramIcon, TwitchIcon } from '@/components/ui/BrandIcons';

type Provider = 'google' | 'facebook' | 'instagram' | 'twitch';

const PROVIDERS: { id: Provider; label: string; Icon: React.FC<{ size?: number }>; bg: string }[] = [
  { id: 'google',    label: 'Google',    Icon: GoogleIcon,    bg: '#FFFFFF' },
  { id: 'facebook',  label: 'Facebook',  Icon: FacebookIcon,  bg: '#14102A' },
  { id: 'instagram', label: 'Instagram', Icon: InstagramIcon, bg: '#14102A' },
  { id: 'twitch',    label: 'Twitch',    Icon: TwitchIcon,    bg: '#14102A' },
];

export function SocialButtons({ label = 'or continue with' }: { label?: string }) {
  const [loading, setLoading] = useState<Provider | null>(null);

  const start = async (provider: Provider) => {
    setLoading(provider);
    try {
      const data = unwrap<{ authUrl: string; state: string }>(await api.get(`/auth/social/${provider}/url`));
      sessionStorage.setItem('oauth_state', data.state);
      sessionStorage.setItem('oauth_provider', provider);
      window.location.href = data.authUrl;
    } catch (err) {
      toast.error(getApiError(err, `${provider} sign-in unavailable`));
      setLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted">{label}</p>
      <div className="grid grid-cols-4 gap-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => start(p.id)}
            disabled={loading !== null}
            className="h-14 rounded-xl flex items-center justify-center transition hover:scale-105 border border-white/10 hover:border-white/30 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: p.bg }}
            aria-label={p.label}
            title={`Continue with ${p.label}`}
          >
            {loading === p.id ? (
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <p.Icon size={24} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
