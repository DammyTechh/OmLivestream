'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Eye, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, getApiError, unwrap } from '@/lib/api';

const SEGMENTS = [
  { id: 'all',              label: 'All users' },
  { id: 'free_trial',       label: 'Free trial users' },
  { id: 'free',             label: 'Free plan users' },
  { id: 'premium',          label: 'Premium subscribers' },
  { id: 'waitlist_members', label: 'Waitlist members' },
  { id: 'inactive',         label: 'Inactive (5+ days)' },
];

function ComposerContent() {
  const router = useRouter();
  const [form, setForm] = useState({
    subject: '',
    segment: 'all',
    body_html: '',
    preview_text: '',
    scheduled_at: '',
  });
  const [estimate, setEstimate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/admin/broadcasts/estimate?segment=${form.segment}`);
        setEstimate(res.data?.data?.count ?? 0);
      } catch { setEstimate(null); }
    })();
  }, [form.segment]);

  const saveDraft = async () => {
    if (!form.subject.trim() || !form.body_html.trim()) return toast.error('Subject and body required');
    setSaving(true);
    try {
      await api.post('/admin/broadcasts', { ...form, scheduled_at: form.scheduled_at || null });
      toast.success('Draft saved');
      router.push('/admin/broadcasts');
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSaving(false); }
  };

  const sendNow = async () => {
    if (!form.subject.trim() || !form.body_html.trim()) return toast.error('Subject and body required');
    if (!confirm(`Send this broadcast to ${estimate ?? 'all'} users? This cannot be undone.`)) return;
    setSending(true);
    try {
      const res = unwrap<{ id: string }>(await api.post('/admin/broadcasts', { ...form, scheduled_at: null }));
      await api.post(`/admin/broadcasts/${res.id}/send`);
      toast.success('Broadcast queued for sending');
      router.push('/admin/broadcasts');
    } catch (err) { toast.error(getApiError(err)); }
    finally { setSending(false); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/admin/broadcasts" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} /> Back
      </Link>

      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Compose Broadcast</h1>
        <p className="text-muted mt-1">Create and send targeted email campaigns.</p>
      </div>

      <Card className="space-y-5">
        <Input label="Subject *" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
          placeholder="A great new feature just landed…" />

        <Input label="Preview text" value={form.preview_text} onChange={(e) => setForm({ ...form, preview_text: e.target.value })}
          placeholder="Short preview shown in inbox" />

        <div>
          <label className="label">Audience segment</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setForm({ ...form, segment: s.id })}
                className={`p-3 rounded-xl border text-sm text-left transition ${
                  form.segment === s.id
                    ? 'border-primary bg-primary/10 text-text'
                    : 'border-white/10 bg-white/[0.02] text-muted hover:border-white/20'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {estimate !== null && (
            <p className="text-xs text-muted mt-2 flex items-center gap-1.5">
              <Users size={12} /> Will reach approximately <strong className="text-text">{estimate.toLocaleString()}</strong> users
            </p>
          )}
        </div>

        <div>
          <label className="label">Email body (HTML supported)</label>
          <textarea
            value={form.body_html}
            onChange={(e) => setForm({ ...form, body_html: e.target.value })}
            rows={14}
            placeholder={`<p>Hi there,</p>\n<p>We just launched an amazing new feature…</p>`}
            className="input resize-none font-mono text-sm"
          />
        </div>

        <div>
          <label className="label">Schedule for later (optional)</label>
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
            className="input"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t border-border">
          <Button variant="secondary" onClick={saveDraft} loading={saving}>Save draft</Button>
          <Button onClick={sendNow} loading={sending} icon={<Send size={16} />}>
            {form.scheduled_at ? 'Schedule' : 'Send now'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function Page() { return <ComposerContent />; }
