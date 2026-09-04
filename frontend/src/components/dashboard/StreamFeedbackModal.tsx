'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

/**
 * Asked once, right after a broadcast ends or is cancelled.
 *
 * Timing is the whole point: somebody whose stream dropped frames will say so
 * in the thirty seconds after ending it and never again. So it opens on its
 * own rather than living behind a "send feedback" link nobody clicks.
 *
 * That only stays acceptable if it is genuinely easy to dismiss — Escape, the
 * backdrop, the close button, or "Not now" all work, and it is never shown
 * twice for the same broadcast. A rating alone is a complete answer; the tags
 * and the comment are there for people who want to say more.
 *
 * Submission is fire-and-forget from the creator's point of view. Feedback is
 * a nice-to-have, and a failed request must never look like something went
 * wrong with the broadcast itself, which is why a failure closes quietly
 * instead of trapping them in a retry loop.
 */

const ISSUE_OPTIONS = [
  { id: 'video_quality',   label: 'Video quality' },
  { id: 'audio_quality',   label: 'Audio quality' },
  { id: 'dropped_frames',  label: 'Lag or dropped frames' },
  { id: 'platform_issue',  label: 'A platform failed' },
  { id: 'comments',        label: 'Comments' },
  { id: 'setup_confusing', label: 'Setup was confusing' },
] as const;

export function StreamFeedbackModal({
  streamId,
  reason,
  open,
  onClose,
}: {
  streamId: string;
  reason: 'ended' | 'cancelled';
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const toggleIssue = (id: string) =>
    setIssues((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const submit = async () => {
    if (!rating) return toast.error('Pick a rating first.');
    setSaving(true);
    try {
      await api.post(`/streams/${streamId}/feedback`, {
        rating,
        issues,
        comment: comment.trim() || undefined,
        endedReason: reason,
      });
      toast.success('Thanks — that helps.');
    } catch {
      // Swallowed on purpose. See the note above the component.
    } finally {
      setSaving(false);
      onClose();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[110] bg-veil/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            /*
             * Centred with flexbox on a full-screen wrapper, not with
             * `left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2`.
             *
             * The transform approach breaks in two ways here: it fights the
             * entry animation, which also writes to `transform`, and combined
             * with `max-h` it clips instead of scrolling on a short viewport —
             * so the Send button ends up below the fold with no way to reach
             * it. A flex wrapper has neither problem and needs no breakpoint
             * juggling.
             *
             * `pb-[env(safe-area-inset-bottom)]` keeps the buttons clear of the
             * iPhone home indicator, which otherwise overlaps them.
             */
            className="fixed inset-0 z-[111] flex items-end sm:items-center justify-center
                       p-0 sm:p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto relative w-full sm:w-[min(92vw,460px)]
                         max-h-[92dvh] overflow-y-auto overscroll-contain
                         rounded-t-2xl sm:rounded-2xl bg-surface border border-border shadow-2xl
                         p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 text-muted hover:text-text transition"
            >
              <X size={17} />
            </button>

            <h2 id="feedback-title" className="font-display text-xl font-semibold pr-8">
              {reason === 'cancelled' ? 'You cancelled that stream' : 'How did that stream go?'}
            </h2>
            <p className="text-sm text-muted mt-1.5 leading-relaxed">
              {reason === 'cancelled'
                ? 'If something got in the way, telling us takes a few seconds and helps us fix it.'
                : 'A quick rating helps us work out what to improve next.'}
            </p>

            {/* Rating */}
            <div className="flex items-center gap-1.5 mt-5" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  aria-label={`${n} out of 5`}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    size={26}
                    strokeWidth={1.75}
                    className={(hover || rating) >= n ? 'text-primary' : 'text-muted'}
                    fill={(hover || rating) >= n ? 'currentColor' : 'none'}
                  />
                </button>
              ))}
              {rating > 0 && (
                <span className="text-xs text-muted ml-2">
                  {['Bad', 'Poor', 'Okay', 'Good', 'Great'][rating - 1]}
                </span>
              )}
            </div>

            {/* Tags — only worth asking once we know something went wrong. */}
            {rating > 0 && rating <= 3 && (
              <div className="mt-5">
                <div className="text-xs font-medium text-muted mb-2">What got in the way?</div>
                <div className="flex flex-wrap gap-2">
                  {ISSUE_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => toggleIssue(o.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                        issues.includes(o.id)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-veil/[0.03] border-border text-muted hover:text-text hover:border-veil/25'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5">
              <label htmlFor="fb-comment" className="text-xs font-medium text-muted">
                Anything else? <span className="font-normal">(optional)</span>
              </label>
              <textarea
                id="fb-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="What would have made this better?"
                className="input resize-none mt-1.5 w-full"
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-muted hover:text-text hover:bg-veil/5 transition"
              >
                Not now
              </button>
              <button
                onClick={submit}
                disabled={saving || !rating}
                className="px-5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-50"
              >
                {saving ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
