import axios from 'axios';
import { supabaseAdmin } from '../config/supabase';
import { decrypt } from '../utils/crypto';
import { logger } from '../config/logger';

/**
 * Live comment ingestion.
 * ─────────────────────────────────────────────────────────────────
 * Pulls live chat from each connected platform and hands every new comment
 * to a callback, which the socket layer fans out to the browser.
 *
 * Platform reality, which is uneven:
 *
 *   YouTube   → liveChatMessages API. Polled. The response carries both a
 *               nextPageToken (the cursor) and pollingIntervalMillis (how
 *               long the server wants us to wait). Honouring the latter is
 *               not optional — polling faster returns the same page and
 *               burns quota, and YouTube's quota is the binding constraint
 *               on this whole feature.
 *   Facebook  → Graph /{live_video_id}/comments with a `since` cursor.
 *   Instagram → Graph comments, but live comments need a Business account
 *               and a separate permission; not wired yet.
 *   Twitch    → chat is IRC/EventSub WebSocket, not pollable. Needs its own
 *               transport; deliberately not faked here.
 *   TikTok/X/LinkedIn/Kick → no public live-comment read API.
 *
 * Design notes:
 *
 *   - Pollers are keyed by streamId+platform. Keying by streamId alone
 *     would let a stream's second platform overwrite the first, leaking
 *     its timer and silently dropping its comments.
 *   - Scheduling uses a self-rescheduling setTimeout, not setInterval, so
 *     each platform can honour a server-supplied interval that changes
 *     between polls, and so a slow request can never overlap itself.
 *   - Comment IDs are deduped per poller. Facebook's `since` cursor is
 *     inclusive at second granularity, so the boundary comment comes back
 *     on the next poll and would otherwise appear twice.
 */

export interface LiveComment {
  /** The platform's own comment id — this is what a reply is addressed to. */
  id:        string;
  platform:  string;
  author:    string;
  authorId:  string;
  text:      string;
  /** ISO 8601. */
  timestamp: string;
  /**
   * Identifier a reply must be sent to, which is not always the comment id:
   * YouTube replies go to the liveChatId, Twitch to the broadcaster id.
   */
  replyTarget: string;
}

type OnComment = (c: LiveComment) => void;

interface Poller {
  streamId: string;
  platform: string;
  timer:    NodeJS.Timeout | null;
  stopped:  boolean;
  /** Bounded set of ids already emitted, for dedupe. */
  seen:     Set<string>;
  /** Consecutive failures — used for backoff before giving up. */
  failures: number;
}

/** streamId → platform → poller. */
const pollers = new Map<string, Map<string, Poller>>();

/** Poll cadence bounds. YouTube overrides within this range. */
const MIN_POLL_MS     = 2_000;
const DEFAULT_POLL_MS = 5_000;
const MAX_POLL_MS     = 30_000;
/** Give up on a platform after this many consecutive failures. */
const MAX_FAILURES    = 5;
/** Cap the dedupe set so a long stream cannot grow it without bound. */
const SEEN_LIMIT      = 2_000;

function remember(poller: Poller, id: string): boolean {
  if (poller.seen.has(id)) return false;
  poller.seen.add(id);
  if (poller.seen.size > SEEN_LIMIT) {
    // Sets iterate in insertion order, so this drops the oldest ids.
    const excess = poller.seen.size - SEEN_LIMIT;
    let n = 0;
    for (const old of poller.seen) {
      poller.seen.delete(old);
      if (++n >= excess) break;
    }
  }
  return true;
}

async function tokenFor(userId: string, platform: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('platform_connections')
    .select('access_token_encrypted,status')
    .eq('user_id', userId)
    .eq('platform', platform)
    .single();

  if (!data?.access_token_encrypted || data.status !== 'connected') return null;
  try {
    return decrypt(data.access_token_encrypted);
  } catch (err) {
    logger.error({ err, platform }, 'Could not decrypt platform token');
    return null;
  }
}

export class CommentIngestionService {
  /**
   * Begin ingesting comments for a stream.
   *
   * `platformRefs` carries the per-platform live identifiers captured when
   * the broadcast was created — YouTube's liveChatId, Facebook's live video
   * id. Platforms without a usable identifier are skipped rather than
   * erroring, because a stream going to six platforms should not fail
   * because one of them has no readable chat.
   */
  async start(params: {
    streamId: string;
    userId:   string;
    platformRefs: Array<{ platform: string; liveChatId?: string; liveVideoId?: string }>;
    onComment: OnComment;
  }): Promise<{ ingesting: string[]; skipped: string[] }> {
    const { streamId, userId, platformRefs, onComment } = params;

    const ingesting: string[] = [];
    const skipped:   string[] = [];

    for (const ref of platformRefs) {
      const started = await this.startOne(streamId, userId, ref, onComment);
      (started ? ingesting : skipped).push(ref.platform);
    }

    logger.info({ streamId, ingesting, skipped }, 'Comment ingestion started');
    return { ingesting, skipped };
  }

  private async startOne(
    streamId: string,
    userId: string,
    ref: { platform: string; liveChatId?: string; liveVideoId?: string },
    onComment: OnComment
  ): Promise<boolean> {
    const { platform } = ref;

    if (platform === 'youtube' && !ref.liveChatId) return false;
    if (platform === 'facebook' && !ref.liveVideoId) return false;
    if (platform !== 'youtube' && platform !== 'facebook') return false;

    const token = await tokenFor(userId, platform);
    if (!token) {
      logger.warn({ streamId, platform }, 'No usable token — not ingesting comments');
      return false;
    }

    const poller: Poller = {
      streamId, platform, timer: null, stopped: false,
      seen: new Set(), failures: 0,
    };

    if (!pollers.has(streamId)) pollers.set(streamId, new Map());
    // Replace any existing poller for this platform rather than stacking one.
    const existing = pollers.get(streamId)!.get(platform);
    if (existing) this.stopPoller(existing);
    pollers.get(streamId)!.set(platform, poller);

    if (platform === 'youtube') {
      void this.runYouTube(poller, token, ref.liveChatId!, onComment);
    } else {
      void this.runFacebook(poller, token, ref.liveVideoId!, onComment);
    }
    return true;
  }

  /** Schedules the next tick unless the poller has been stopped. */
  private schedule(poller: Poller, fn: () => void, ms: number): void {
    if (poller.stopped) return;
    const delay = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms));
    poller.timer = setTimeout(fn, delay);
  }

  /**
   * Records a failure and decides whether to keep going.
   * Backs off exponentially so a rate-limited platform is not hammered.
   */
  private handleFailure(poller: Poller, err: unknown): number | null {
    poller.failures++;
    const status = (err as { response?: { status?: number } })?.response?.status;

    // An expired token will never recover on its own — stop immediately
    // rather than burning five retries on a guaranteed 401.
    if (status === 401 || status === 403) {
      logger.warn(
        { streamId: poller.streamId, platform: poller.platform, status },
        'Platform token rejected — stopping comment ingestion'
      );
      return null;
    }

    if (poller.failures >= MAX_FAILURES) {
      logger.error(
        { streamId: poller.streamId, platform: poller.platform, failures: poller.failures },
        'Too many consecutive polling failures — stopping comment ingestion'
      );
      return null;
    }

    logger.warn(
      { err, streamId: poller.streamId, platform: poller.platform, attempt: poller.failures },
      'Comment poll failed — backing off'
    );
    return DEFAULT_POLL_MS * 2 ** poller.failures;
  }

  // ── YouTube ────────────────────────────────────────────────────────

  private async runYouTube(
    poller: Poller,
    token: string,
    liveChatId: string,
    onComment: OnComment
  ): Promise<void> {
    let pageToken: string | undefined;

    const tick = async (): Promise<void> => {
      if (poller.stopped) return;
      try {
        const { data } = await axios.get(
          'https://www.googleapis.com/youtube/v3/liveChat/messages',
          {
            headers: { Authorization: `Bearer ${token}` },
            params:  { liveChatId, part: 'snippet,authorDetails', pageToken },
            timeout: 10_000,
          }
        );

        poller.failures = 0;
        pageToken = data.nextPageToken;

        for (const msg of data.items ?? []) {
          if (!remember(poller, msg.id)) continue;
          const snippet = msg.snippet ?? {};
          const author  = msg.authorDetails ?? {};
          onComment({
            id:          msg.id,
            platform:    'youtube',
            author:      author.displayName ?? 'YouTube viewer',
            authorId:    author.channelId ?? '',
            text:        snippet.textMessageDetails?.messageText ?? snippet.displayMessage ?? '',
            timestamp:   snippet.publishedAt ?? new Date().toISOString(),
            // A YouTube "reply" is a new message in the same chat room,
            // so replies address the chat, not the message.
            replyTarget: liveChatId,
          });
        }

        // YouTube tells us how long to wait; ignoring it wastes quota.
        this.schedule(poller, () => void tick(), data.pollingIntervalMillis ?? DEFAULT_POLL_MS);
      } catch (err) {
        const backoff = this.handleFailure(poller, err);
        if (backoff === null) return this.stopPoller(poller);
        this.schedule(poller, () => void tick(), backoff);
      }
    };

    await tick();
  }

  // ── Facebook ───────────────────────────────────────────────────────

  private async runFacebook(
    poller: Poller,
    token: string,
    liveVideoId: string,
    onComment: OnComment
  ): Promise<void> {
    let since: string | undefined;

    const tick = async (): Promise<void> => {
      if (poller.stopped) return;
      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/v19.0/${liveVideoId}/comments`,
          {
            params: {
              access_token: token,
              fields:       'id,from,message,created_time',
              order:        'chronological',
              ...(since ? { since } : {}),
            },
            timeout: 10_000,
          }
        );

        poller.failures = 0;
        const comments = data.data ?? [];

        for (const c of comments) {
          if (!remember(poller, c.id)) continue;
          onComment({
            id:          c.id,
            platform:    'facebook',
            author:      c.from?.name ?? 'Facebook viewer',
            authorId:    c.from?.id ?? '',
            text:        c.message ?? '',
            timestamp:   c.created_time ?? new Date().toISOString(),
            // Facebook comments are threaded — a reply posts as a child
            // of the comment itself.
            replyTarget: c.id,
          });
        }

        const last = comments[comments.length - 1];
        if (last?.created_time) since = new Date(last.created_time).toISOString();

        this.schedule(poller, () => void tick(), DEFAULT_POLL_MS);
      } catch (err) {
        const backoff = this.handleFailure(poller, err);
        if (backoff === null) return this.stopPoller(poller);
        this.schedule(poller, () => void tick(), backoff);
      }
    };

    await tick();
  }

  // ── Teardown ───────────────────────────────────────────────────────

  private stopPoller(poller: Poller): void {
    poller.stopped = true;
    if (poller.timer) clearTimeout(poller.timer);
    poller.timer = null;
    pollers.get(poller.streamId)?.delete(poller.platform);
    if (pollers.get(poller.streamId)?.size === 0) pollers.delete(poller.streamId);
  }

  /** Stops every poller for a stream. Safe to call when none are running. */
  stop(streamId: string): void {
    const forStream = pollers.get(streamId);
    if (!forStream) return;
    for (const poller of [...forStream.values()]) this.stopPoller(poller);
    logger.info({ streamId }, 'Comment ingestion stopped');
  }

  /** Stops everything — called during graceful shutdown. */
  stopAll(): void {
    for (const streamId of [...pollers.keys()]) this.stop(streamId);
  }

  /** Which platforms are currently being polled for a stream. */
  status(streamId: string): string[] {
    return [...(pollers.get(streamId)?.keys() ?? [])];
  }
}

export const commentIngestion = new CommentIngestionService();
