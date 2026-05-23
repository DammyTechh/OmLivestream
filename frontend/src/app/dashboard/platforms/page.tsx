'use client';
import { useEffect, useState } from 'react';
import { Link2, Check, X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { api, getApiError, unwrap } from '@/lib/api';

const PLATFORMS = [
  { id: 'youtube',   label: 'YouTube',   color: '#FF0000', oauth: true  },
  { id: 'facebook',  label: 'Facebook',  color: '#1877F2', oauth: true  },
  { id: 'instagram', label: 'Instagram', color: '#E4405F', oauth: true  },
  { id: 'twitch',    label: 'Twitch',    color: '#9146FF', oauth: true  },
  { id: 'tiktok',    label: 'TikTok',    color: '#ff0050', oauth: true  },
  { id: 'twitter',   label: 'X',         color: '#FFFFFF', oauth: true  },
  { id: 'linkedin',  label: 'LinkedIn',  color: '#0A66C2', oauth: true  },
  { id: 'kick',      label: 'Kick',      color: '#53FC18', oauth: false },
];

interface Connection {
  id: string;
  platform: string;
  status: string;
  platform_username: string | null;
}

export default function PlatformsPage() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchConns(); }, []);

  async function fetchConns() {
    try {
      const res = await api.get('/platforms');
      setConns(res.data?.data || []);
    } finally { setLoading(false); }
  }

  const isConnected = (id: string) => conns.some(c => c.platform === id && c.status === 'connected');

  const connect = async (platform: string) => {
    try {
      const data = unwrap<{ authUrl: string }>(await api.get(`/platforms/oauth/${platform}/url`));
      window.location.href = data.authUrl;
    } catch (err) { toast.error(getApiError(err)); }
  };

  const disconnect = async (platform: string) => {
    const c = conns.find(x => x.platform === platform);
    if (!c || !confirm(`Disconnect ${platform}?`)) return;
    try {
      await api.delete(`/platforms/${c.id}`);
      await fetchConns();
      toast.success('Disconnected');
    } catch (err) { toast.error(getApiError(err)); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Connected Platforms</h1>
        <p className="text-muted mt-1">Link your streaming accounts — then broadcast to them all at once.</p>
      </div>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {PLATFORMS.map((p) => {
            const connected = isConnected(p.id);
            const conn = conns.find(c => c.platform === p.id);
            return (
              <Card key={p.id} className="p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold"
                       style={{ background: p.color }}>
                    {p.label[0]}
                  </div>
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs text-muted">
                      {connected ? (
                        <span className="text-success">● {conn?.platform_username || 'Connected'}</span>
                      ) : (
                        <span>Not connected</span>
                      )}
                    </div>
                  </div>
                </div>
                {connected ? (
                  <Button variant="secondary" size="sm" onClick={() => disconnect(p.id)} icon={<X size={14} />}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => connect(p.id)} icon={<Plus size={14} />}>
                    Connect
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
