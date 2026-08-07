/**
 * Batched writer for ingested live comments.
 * ─────────────────────────────────────────────────────────────────
 * The chat pollers are the highest-frequency write path in the system: every
 * live stream polls every connected platform every few seconds, and a busy
 * broadcast returns comments in bursts. Inserting them one row at a time
 * meant one Postgres round trip per comment, which is both the slowest and
 * the most expensive way to store them — and it scaled with audience size
 * rather than with broadcaster count.
 *
 * Rows are collected per stream and flushed on whichever comes first: a short
 * timer, or a full buffer. The delay is invisible to viewers because the
 * socket emit does not wait for the write — persistence exists so that a
 * late-joining client can backfill and so replies have a stable id to
 * address, neither of which is on the live path.
 *
 * Writes go through upsert rather than insert. This is load-bearing for
 * batching: a single duplicate would abort an entire multi-row insert, and
 * duplicates are expected, not exceptional — Facebook's `since` cursor is
 * inclusive at second granularity, so the boundary comment re-delivers on
 * every poll. `ignoreDuplicates` turns that into a no-op for the one row
 * instead of losing the other 199.
 */

import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';

export interface CommentRow {
  id:                  string;
  stream_id:           string;
  platform:            string;
  platform_comment_id: string;
  reply_target:        string | null;
  author_name:         string | null;
  author_platform_id:  string | null;
  text:                string;
  posted_at:           string;
}

/** How long a row may sit unwritten. Well under a viewer's tolerance for backfill. */
const FLUSH_INTERVAL_MS = 500;

/**
 * Flush early at this many rows. Keeps a single statement comfortably within
 * Postgres parameter limits and bounds the memory a viral stream can pin.
 */
const MAX_BATCH = 200;

/**
 * Hard ceiling on a stream's pending buffer. Reached only if the database is
 * unreachable, in which case dropping the oldest comments is the correct
 * failure: they are already delivered to viewers over the socket, and an
 * unbounded buffer would take the process down instead.
 */
const MAX_PENDING = 2_000;

class StreamBuffer {
  private rows: CommentRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Serialises flushes so two timers cannot write the same rows twice. */
  private flushing: Promise<void> = Promise.resolve();

  add(row: CommentRow): void {
    if (this.rows.length >= MAX_PENDING) {
      this.rows.shift();
      logger.warn({ streamId: row.stream_id }, 'Comment buffer full — dropping oldest unwritten comment');
    }
    this.rows.push(row);

    if (this.rows.length >= MAX_BATCH) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush(); }, FLUSH_INTERVAL_MS);
      // Don't hold the event loop open on shutdown.
      this.timer.unref();
    }
  }

  get size(): number { return this.rows.length; }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Chain, so concurrent callers queue behind the in-flight write.
    this.flushing = this.flushing.then(() => this.write());
    return this.flushing;
  }

  private async write(): Promise<void> {
    if (!this.rows.length) return;

    // Take the whole buffer before awaiting, so rows arriving during the
    // write land in a fresh batch rather than being written twice.
    const batch = this.rows;
    this.rows = [];

    const { error } = await supabaseAdmin
      .from('stream_comments')
      .upsert(batch, { onConflict: 'platform,platform_comment_id', ignoreDuplicates: true });

    if (error) {
      // Deliberately not re-queued. These comments already reached viewers
      // over the socket; retrying a failing batch forever would grow the
      // buffer until the process died, trading a cosmetic gap in backfill
      // for an outage.
      logger.error(
        { err: error, streamId: batch[0]?.stream_id, dropped: batch.length },
        'Could not persist live comment batch',
      );
    }
  }
}

const buffers = new Map<string, StreamBuffer>();

/** Queue a comment for persistence. Returns immediately. */
export function bufferComment(row: CommentRow): void {
  let buf = buffers.get(row.stream_id);
  if (!buf) {
    buf = new StreamBuffer();
    buffers.set(row.stream_id, buf);
  }
  buf.add(row);
}

/**
 * Write out and forget a stream's buffer. Call when a stream ends, so the
 * last few comments are not lost and the map does not grow for the lifetime
 * of the process.
 */
export async function flushComments(streamId: string): Promise<void> {
  const buf = buffers.get(streamId);
  if (!buf) return;
  buffers.delete(streamId);
  await buf.flush();
}

/** Write out every pending buffer. Called on shutdown. */
export async function flushAllComments(): Promise<void> {
  const pending = [...buffers.values()];
  buffers.clear();
  await Promise.allSettled(pending.map(b => b.flush()));
}
