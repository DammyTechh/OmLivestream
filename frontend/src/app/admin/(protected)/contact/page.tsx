'use client';
import { useEffect, useState } from 'react';
import { MessageSquare, Mail, Check, Send, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { api, getApiError } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/utils';

interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  message: string;
  status: 'unread' | 'read' | 'replied';
  ip_address: string | null;
  read_at: string | null;
  replied_at: string | null;
  created_at: string;
}

function ContactInboxContent() {
  const [items, setItems] = useState<ContactSubmission[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read' | 'replied'>('all');
  const [selected, setSelected] = useState<ContactSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ unread: 0, read: 0, replied: 0 });

  useEffect(() => { fetchItems(); }, [filter]);

  async function fetchItems() {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/contact/admin/list?limit=100' : `/contact/admin/list?status=${filter}&limit=100`;
      const res = await api.get(url);
      const data = (res.data?.data || []) as ContactSubmission[];
      setItems(data);

      // Also fetch counts (by calling with each status) — for badges
      if (filter === 'all') {
        const c = { unread: 0, read: 0, replied: 0 };
        data.forEach(x => { c[x.status as 'unread' | 'read' | 'replied']++; });
        setCounts(c);
      }
    } finally { setLoading(false); }
  }

  const open = async (item: ContactSubmission) => {
    setSelected(item);
    if (item.status === 'unread') {
      try {
        await api.patch(`/contact/admin/${item.id}/read`);
        setItems(items.map(x => x.id === item.id ? { ...x, status: 'read' as const, read_at: new Date().toISOString() } : x));
        setCounts(c => ({ ...c, unread: Math.max(0, c.unread - 1), read: c.read + 1 }));
      } catch { /* non-fatal */ }
    }
  };

  const markReplied = async (id: string) => {
    try {
      await api.patch(`/contact/admin/${id}/replied`);
      setItems(items.map(x => x.id === id ? { ...x, status: 'replied' as const, replied_at: new Date().toISOString() } : x));
      setSelected(null);
      toast.success('Marked as replied');
    } catch (err) { toast.error(getApiError(err)); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this submission permanently?')) return;
    try {
      await api.delete(`/contact/admin/${id}`);
      setItems(items.filter(x => x.id !== id));
      if (selected?.id === id) setSelected(null);
      toast.success('Deleted');
    } catch (err) { toast.error(getApiError(err)); }
  };

  const statusBadge = (s: ContactSubmission['status']) => (
    s === 'unread'  ? 'bg-primary/20 text-primary'   :
    s === 'read'    ? 'bg-white/5 text-muted'        :
                      'bg-success/20 text-success'
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Contact Inbox</h1>
          <p className="text-muted mt-1">Messages from the landing page contact form.</p>
        </div>
        {counts.unread > 0 && (
          <span className="px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-sm text-primary font-medium">
            {counts.unread} unread
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'unread', 'read', 'replied'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition ${
              filter === f ? 'bg-primary text-white' : 'bg-white/5 text-muted hover:bg-white/10'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4 min-h-[calc(100vh-300px)]">
        {/* List */}
        <div className="space-y-2 overflow-y-auto">
          {loading ? (
            <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
          ) : items.length === 0 ? (
            <Card className="py-14 text-center">
              <MessageSquare size={36} className="text-muted mx-auto mb-3" />
              <p className="text-muted">No {filter !== 'all' ? filter : ''} messages</p>
            </Card>
          ) : items.map((item) => (
            <button
              key={item.id}
              onClick={() => open(item)}
              className={`w-full text-left p-4 rounded-2xl border transition-all ${
                selected?.id === item.id
                  ? 'bg-primary/10 border-primary/40'
                  : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04] hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium truncate">{item.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${statusBadge(item.status)}`}>
                  {item.status}
                </span>
              </div>
              <div className="text-xs text-muted mb-2 truncate">{item.email}</div>
              <div className="text-sm text-muted line-clamp-2">{item.message}</div>
              <div className="text-[11px] text-subtle mt-2">{timeAgo(item.created_at)}</div>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="lg:sticky lg:top-6 h-fit"
            >
              <Card className="p-6">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="font-display text-2xl font-semibold">{selected.name}</h3>
                    <a href={`mailto:${selected.email}?subject=Re: Your OmliveStream inquiry`}
                       className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 mt-0.5">
                      <Mail size={13} /> {selected.email}
                    </a>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-muted hover:text-text">
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-2 mb-6 text-xs text-muted border-b border-border pb-4">
                  <div className="flex justify-between"><span>Received</span><span>{formatDateTime(selected.created_at)}</span></div>
                  {selected.read_at    && <div className="flex justify-between"><span>Read</span><span>{formatDateTime(selected.read_at)}</span></div>}
                  {selected.replied_at && <div className="flex justify-between"><span>Replied</span><span>{formatDateTime(selected.replied_at)}</span></div>}
                  {selected.ip_address && <div className="flex justify-between"><span>IP</span><span className="font-mono">{selected.ip_address}</span></div>}
                </div>

                <div className="mb-6">
                  <div className="text-xs uppercase tracking-widest text-muted mb-2">Message</div>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{selected.message}</p>
                </div>

                <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
                  <a
                    href={`mailto:${selected.email}?subject=Re: Your OmliveStream inquiry&body=Hi ${selected.name},%0D%0A%0D%0A`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-accent text-white text-sm font-medium hover:shadow-lg hover:shadow-primary/30 transition"
                  >
                    <Send size={14} /> Reply via email
                  </a>
                  {selected.status !== 'replied' && (
                    <button
                      onClick={() => markReplied(selected.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-success/10 border border-success/30 text-success text-sm font-medium hover:bg-success/20 transition"
                    >
                      <Check size={14} /> Mark replied
                    </button>
                  )}
                  <button
                    onClick={() => remove(selected.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/20 transition ml-auto"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </Card>
            </motion.div>
          ) : (
            <Card className="flex items-center justify-center text-center py-20">
              <div>
                <MessageSquare size={44} className="text-muted mx-auto mb-4" />
                <p className="font-display text-lg mb-1">Select a message</p>
                <p className="text-sm text-muted">Click any submission to view the full message and respond.</p>
              </div>
            </Card>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function Page() { return <ContactInboxContent />; }
