'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles, Wand2, AlertCircle, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { api, getApiError, unwrap } from '@/lib/api';

interface Message { role: 'user' | 'assistant'; content: string; }

/** Must match the enum the backend accepts, or the request is rejected. */
const TITLE_PLATFORMS = [
  { id: 'youtube',   label: 'YouTube'   },
  { id: 'tiktok',    label: 'TikTok'    },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook'  },
  { id: 'twitch',    label: 'Twitch'    },
  { id: 'twitter',   label: 'X'         },
  { id: 'linkedin',  label: 'LinkedIn'  },
  { id: 'kick',      label: 'Kick'      },
] as const;

export default function AIStudioPage() {
  const [mode, setMode] = useState<'chat' | 'title'>('chat');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your AI streaming assistant. I can help you write stream titles, descriptions, hashtags, and more. What are you streaming today?" },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reopen the conversation rather than restarting it. History lives on the
  // server now, so it survives a reload — and the greeting below is only the
  // right first thing to say when there is nothing to restore.
  useEffect(() => {
    (async () => {
      try {
        const data = unwrap<{ messages: Message[] }>(await api.get('/ai/chat/history'));
        if (data.messages?.length) setMessages(data.messages);
      } catch { /* first visit, or history unavailable — keep the greeting */ }
    })();
  }, []);

  // Pin to the newest message. Without this the reply lands below the fold
  // and a long answer looks like nothing happened.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const [titlePrompt, setTitlePrompt] = useState('');
  const [titles, setTitles] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(['youtube', 'tiktok', 'instagram', 'twitch']);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      // No history in the payload: the server keeps its own record, and the
      // field it used to accept is ignored. Sending it back was how a client
      // could rewrite what the assistant had "previously said".
      const data = unwrap<{ reply: string }>(await api.post('/ai/chat', { message: userMsg }));
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const msg = getApiError(err, 'AI is unavailable right now');
      if (msg.includes('AI is temporarily unavailable')) setQuotaExhausted(true);
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally { setLoading(false); }
  };

  const generateTitles = async () => {
    if (!titlePrompt.trim()) return toast.error('Describe your stream first');
    setLoading(true);
    try {
      const data = unwrap<{ titles: string[] }>(
        await api.post('/ai/generate-title', { topic: titlePrompt, platforms }),
      );
      setTitles(data.titles || []);
      if (!data.titles?.length) toast.error('No titles came back — try describing the stream differently');
    } catch (err) {
      const msg = getApiError(err, 'Could not generate titles');
      if (msg.includes('AI is temporarily unavailable')) setQuotaExhausted(true);
      toast.error(msg);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">AI Studio</h1>
        <p className="text-muted mt-1">Your creative partner — titles, scripts, thumbnails, hashtags.</p>
      </div>

      {quotaExhausted && (
        <div className="rounded-2xl p-5 bg-warning/10 border border-warning/30 flex items-start gap-3">
          <AlertCircle size={20} className="text-warning shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">AI features are temporarily limited</div>
            <p className="text-sm text-muted mt-1">
              Our AI service has reached its usage quota. This is a platform-level limit and will reset soon. Please try again later — all other features are working normally.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setMode('chat')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${mode === 'chat' ? 'bg-primary text-white' : 'bg-veil/5 text-muted hover:bg-veil/10'}`}
        >
          <Bot size={14} className="inline mr-1.5" /> Chat
        </button>
        <button
          onClick={() => setMode('title')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${mode === 'title' ? 'bg-primary text-white' : 'bg-veil/5 text-muted hover:bg-veil/10'}`}
        >
          <Wand2 size={14} className="inline mr-1.5" /> Title Generator
        </button>
      </div>

      {mode === 'chat' ? (
        <Card className="p-0 overflow-hidden">
          <div ref={scrollRef} className="h-[500px] overflow-y-auto p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${
                  m.role === 'user' ? 'bg-primary/20' : 'bg-gradient-to-br from-primary to-accent'
                }`}>
                  {m.role === 'user'
                    ? <User size={14} className="text-primary" />
                    : <Sparkles size={14} className="text-white" />}
                </div>
                <div className={`max-w-md px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-primary/20 text-text' : 'bg-veil/5 text-text'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                  <Sparkles size={14} className="text-white animate-pulse" />
                </div>
                <div className="px-4 py-3 rounded-2xl bg-veil/5 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </span>
                </div>
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="p-4 border-t border-border flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your stream…"
              className="input flex-1"
              disabled={loading}
            />
            <Button type="submit" loading={loading} icon={<Send size={16} />}>Send</Button>
          </form>
        </Card>
      ) : (
        <Card className="space-y-5">
          <div>
            <label className="label">Describe your stream</label>
            <textarea
              value={titlePrompt}
              onChange={(e) => setTitlePrompt(e.target.value)}
              placeholder="e.g. A 2-hour Valorant ranked gameplay with chill vibes, for first-time viewers"
              rows={4}
              className="input resize-none"
            />
          </div>
          <div>
            <label className="label">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {TITLE_PLATFORMS.map((p) => {
                const on = platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatforms((prev) =>
                      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                      on ? 'bg-primary/15 border-primary/40 text-text' : 'bg-veil/5 border-veil/10 text-muted hover:bg-veil/10'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Disabled with none selected: the request would 422 on the
              server's min(1), which surfaces as an opaque failure. */}
          <Button
            onClick={generateTitles}
            loading={loading}
            disabled={platforms.length === 0}
            icon={<Wand2 size={16} />}
          >
            Generate titles
          </Button>
          {titles.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-border">
              <p className="text-xs uppercase tracking-widest text-muted">Suggested titles — click to copy</p>
              {titles.map((t, i) => (
                <button
                  key={i}
                  onClick={() => { navigator.clipboard.writeText(t); toast.success('Copied to clipboard'); }}
                  className="w-full text-left p-3 rounded-xl bg-veil/5 hover:bg-veil/10 transition border border-veil/10 hover:border-primary/30"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
