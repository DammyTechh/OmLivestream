import { Redis as UpstashRedis } from '@upstash/redis';
import { env } from './env';
import { logger } from './logger';

// ── Upstash REST client (HTTPS, works on any network) ──────────────
const upstash = new UpstashRedis({
  url:   env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Resilient Redis facade.
 *
 * Redis here is a cache and a rate-limiter — it is NOT the system of
 * record. Sessions, OTPs and users all live in Postgres. So when Upstash
 * is unreachable (deleted database, DNS failure, network blip), throwing
 * is the wrong response: it turns a degraded cache into a total outage.
 * That is exactly what happened — `redis.incr()` is the first statement
 * in sendOtp(), so an ENOTFOUND on the Upstash host produced a 500 on
 * every single login attempt.
 *
 * Every call therefore falls back to an in-process store. On one Render
 * instance that is functionally equivalent; across several instances the
 * rate-limit counters are per-instance, which is a deliberate and much
 * cheaper trade than refusing to authenticate anyone.
 *
 * Security note: the OAuth CSRF-state keys fail CLOSED regardless. A
 * write that silently lands in memory is still readable by the same
 * process on the callback; if the process died in between, `get` returns
 * null and the callback is rejected. There is no path where an outage
 * causes state validation to be skipped.
 */

type SetOpts = { ex?: number };

interface Entry { value: string; expiresAt: number | null }

const mem = new Map<string, Entry>();

const alive = (e: Entry | undefined): e is Entry => {
  if (!e) return false;
  if (e.expiresAt !== null && e.expiresAt <= Date.now()) return false;
  return true;
};

// Sweep expired keys so a long-lived process doesn't leak memory.
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of mem) {
    if (e.expiresAt !== null && e.expiresAt <= now) mem.delete(k);
  }
}, 60_000).unref();

let degraded    = false;
let lastWarnAt  = 0;

function noteFailure(op: string, err: unknown): void {
  const now = Date.now();
  // Log the transition immediately, then at most once a minute, so a
  // sustained outage doesn't flood the log with identical lines.
  if (!degraded || now - lastWarnAt > 60_000) {
    lastWarnAt = now;
    logger.warn(
      { err, op, host: safeHost(env.UPSTASH_REDIS_REST_URL) },
      'Redis unreachable — serving from in-process fallback. Rate limits are per-instance until it recovers.',
    );
  }
  degraded = true;
}

function noteSuccess(): void {
  if (degraded) {
    degraded = false;
    logger.info('Redis recovered — back on Upstash.');
  }
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return '<unparseable UPSTASH_REDIS_REST_URL>'; }
}

export const redis = {
  async get<T = string>(key: string): Promise<T | null> {
    try {
      const v = await upstash.get<T>(key);
      noteSuccess();
      return v;
    } catch (err) {
      noteFailure('get', err);
      const e = mem.get(key);
      return alive(e) ? (e.value as unknown as T) : null;
    }
  },

  async set(key: string, value: string | number, opts?: SetOpts): Promise<void> {
    try {
      // Split the call rather than passing `opts` through: the Upstash types
      // model `ex` as a discriminated union, so an optional `ex?: number`
      // doesn't narrow to any member.
      if (opts?.ex !== undefined) await upstash.set(key, value, { ex: opts.ex });
      else                        await upstash.set(key, value);
      noteSuccess();
    } catch (err) {
      noteFailure('set', err);
    }
    // Mirror locally either way, so a mid-flight failover still resolves
    // the OAuth state written moments earlier.
    mem.set(key, {
      value:     String(value),
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
    });
  },

  async incr(key: string): Promise<number> {
    try {
      const n = await upstash.incr(key);
      noteSuccess();
      return n;
    } catch (err) {
      noteFailure('incr', err);
      const e   = mem.get(key);
      const cur = alive(e) ? parseInt(e.value, 10) || 0 : 0;
      const next = cur + 1;
      mem.set(key, { value: String(next), expiresAt: alive(e) ? e.expiresAt : null });
      return next;
    }
  },

  async decr(key: string): Promise<number> {
    try {
      const n = await upstash.decr(key);
      noteSuccess();
      return n;
    } catch (err) {
      noteFailure('decr', err);
      const e   = mem.get(key);
      const cur = alive(e) ? parseInt(e.value, 10) || 0 : 0;
      const next = cur - 1;
      mem.set(key, { value: String(next), expiresAt: alive(e) ? e.expiresAt : null });
      return next;
    }
  },

  /**
   * Atomic set-if-absent, for locks that must hold across instances.
   *
   * Returns null — not false — when Upstash is unreachable, because the
   * in-process fallback genuinely cannot answer this question: each instance
   * has its own Map, so every instance would "acquire" the same lock and the
   * guarantee the caller wanted would silently evaporate. Callers must decide
   * what that ambiguity means for them. This is the same reasoning as the
   * OAuth state keys above: where a wrong answer is worse than no answer,
   * the facade declines to guess.
   */
  async setnx(key: string, value: string | number, ttlSec: number): Promise<boolean | null> {
    try {
      const res = await upstash.set(key, value, { nx: true, ex: ttlSec });
      noteSuccess();
      return res === 'OK';
    } catch (err) {
      noteFailure('setnx', err);
      return null;
    }
  },

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await upstash.expire(key, seconds);
      noteSuccess();
    } catch (err) {
      noteFailure('expire', err);
      const e = mem.get(key);
      if (e) e.expiresAt = Date.now() + seconds * 1000;
    }
  },

  async del(key: string): Promise<void> {
    try {
      await upstash.del(key);
      noteSuccess();
    } catch (err) {
      noteFailure('del', err);
    }
    mem.delete(key);
  },

  async rpush(key: string, value: string): Promise<void> {
    try {
      await upstash.rpush(key, value);
      noteSuccess();
    } catch (err) {
      // Deliberately NOT mirrored in memory: this carries base64 recording
      // chunks and would grow without bound. Dropping a chunk degrades the
      // recording; buffering it would OOM the process.
      noteFailure('rpush', err);
    }
  },

  /** True when calls are being served from the in-process fallback. */
  get isDegraded(): boolean { return degraded; },

  /** Round-trip check used by the health endpoint. */
  async ping(): Promise<boolean> {
    try {
      await upstash.set('health:ping', Date.now(), { ex: 30 });
      noteSuccess();
      return true;
    } catch (err) {
      noteFailure('ping', err);
      return false;
    }
  },
};

logger.info({ host: safeHost(env.UPSTASH_REDIS_REST_URL) }, 'Redis (Upstash REST) initialised');


/**
 * TLS options for a TCP Redis URL — `{}` when the URL is not `rediss://`.
 *
 * ioredis applies a `tls` option unconditionally when present, so passing it
 * against a plaintext `redis://` server makes the connection fail the TLS
 * handshake with ERR_SSL_WRONG_VERSION_NUMBER. Upstash is `rediss://` so
 * production was unaffected, but a local or self-hosted plaintext Redis lost
 * every TCP client — and because the Socket.io adapter degrades on purpose,
 * that showed up as rooms quietly not spanning instances rather than as a
 * startup failure.
 */
function tlsFor(url: string): { tls?: { rejectUnauthorized: boolean } } {
  return url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {};
}

// ── BullMQ connection — only created if TCP Redis URL is configured
// If UPSTASH_REDIS_URL is empty (local dev without TCP access), returns null
// Queues/workers check for null and skip registration
export function createBullConnection() {
  if (!env.UPSTASH_REDIS_URL) return null;

  const IORedis = require('ioredis');
  const client = new IORedis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    ...tlsFor(env.UPSTASH_REDIS_URL),
    lazyConnect:          true,
    connectTimeout:       5000,
    retryStrategy:        (times: number) => (times > 3 ? null : Math.min(times * 1000, 3000)),
  });
  client.on('error', () => {}); // silent
  return client;
}

/** Is BullMQ available? Workers/queues should check this before registering. */
export const BULLMQ_ENABLED = !!env.UPSTASH_REDIS_URL;

/**
 * Dedicated TCP client pair for the Socket.io Redis adapter.
 *
 * Not shared with the BullMQ connection, and not one client reused twice:
 * a Redis client that has issued SUBSCRIBE enters subscriber mode and will
 * refuse every other command, so sharing would silently break job queueing
 * the moment the adapter subscribed.
 *
 * Returns null when UPSTASH_REDIS_URL is unset. The REST client the rest of
 * this file uses cannot carry pub/sub — it is request/response only — so
 * without a TCP URL there is no adapter and the process must run as a single
 * instance. The caller is responsible for saying so out loud.
 */
export function createSocketAdapterClients(): { pub: any; sub: any } | null {
  if (!env.UPSTASH_REDIS_URL) return null;

  const IORedis = require('ioredis');
  const opts = {
    maxRetriesPerRequest: null,   // required: the adapter must not fail fast
    enableReadyCheck:     false,
    ...tlsFor(env.UPSTASH_REDIS_URL),
    connectTimeout:       5000,
  };
  const pub = new IORedis(env.UPSTASH_REDIS_URL, opts);
  const sub = pub.duplicate();

  // Log rather than swallow: a dead adapter means rooms stop spanning
  // instances, and viewers silently miss comments. That must be visible.
  pub.on('error', (err: Error) => logger.error({ err }, 'Socket.io Redis adapter (pub) error'));
  sub.on('error', (err: Error) => logger.error({ err }, 'Socket.io Redis adapter (sub) error'));

  return { pub, sub };
}

/**
 * Client for @fastify/rate-limit's Redis store.
 *
 * Separate from both the BullMQ and the Socket.io adapter connections, and
 * deliberately configured to fail fast: `connectTimeout` is short and
 * `enableOfflineQueue` is false, because a request must never sit waiting on
 * the rate limiter. When Redis is down the plugin falls back to its local
 * store, which is a far better outcome than a stalled API.
 *
 * Returns null when no TCP URL is configured — the REST client cannot serve
 * this, as the plugin needs a node_redis/ioredis-compatible interface.
 */
export function createRateLimitRedis(): any {
  if (!env.UPSTASH_REDIS_URL) return null;

  const IORedis = require('ioredis');
  const client = new IORedis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck:     false,
    // `enableOfflineQueue: false` means "fail fast rather than queue during an
    // outage", which is right for a rate limiter — a limiter that blocks is
    // worse than one that lets a request through.
    //
    // But it was paired with `lazyConnect: true`, and together they are broken:
    // lazy means no connection is opened until the first command, and that
    // first command then hits a socket that is still handshaking and throws
    //
    //     Stream isn't writeable and enableOfflineQueue options is false
    //
    // On a TLS endpoint the handshake takes long enough that this fires on
    // essentially every cold start, so the first requests after every deploy
    // returned 500 instead of being rate-limited.
    //
    // Connecting eagerly fixes it: by the time a request arrives the socket is
    // ready, and any genuine failure is caught by the error handler below,
    // where the plugin degrades to per-instance counters as intended.
    enableOfflineQueue:   false,
    ...tlsFor(env.UPSTASH_REDIS_URL),
    connectTimeout:       3000,
    lazyConnect:          false,
  });
  // Warn, don't crash: the plugin degrades to its in-process store by itself.
  client.on('error', (err: Error) =>
    logger.warn({ err }, 'Rate-limit Redis error — falling back to per-instance counters'));
  return client;
}

export const REDIS_KEYS = {
  OTP_ATTEMPTS:     (userId: string)      => `otp:attempts:${userId}`,
  OTP_RATE:         (email: string)       => `otp:rate:${email}`,
  OAUTH_STATE:      (state: string)       => `oauth:state:${state}`,
  OAUTH_STATE_V2:   (state: string)       => `oauth:auth:state:${state}`,
  CRON_LOCK:        (job: string, day: string) => `cron:lock:${job}:${day}`,
  STREAM_VIEWERS:   (streamId: string)    => `stream:viewers:${streamId}`,
  STREAM_LIVE:      (streamId: string)    => `stream:live:${streamId}`,
  STREAM_BITRATE:   (streamId: string)    => `stream:bitrate:${streamId}`,
  WEBRTC_TRANSPORT: (transportId: string) => `webrtc:transport:${transportId}`,
} as const;