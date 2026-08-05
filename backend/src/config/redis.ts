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


// ── BullMQ connection — only created if TCP Redis URL is configured
// If UPSTASH_REDIS_URL is empty (local dev without TCP access), returns null
// Queues/workers check for null and skip registration
export function createBullConnection() {
  if (!env.UPSTASH_REDIS_URL) return null;

  const IORedis = require('ioredis');
  const client = new IORedis(env.UPSTASH_REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    tls:                  { rejectUnauthorized: false },
    lazyConnect:          true,
    connectTimeout:       5000,
    retryStrategy:        (times: number) => (times > 3 ? null : Math.min(times * 1000, 3000)),
  });
  client.on('error', () => {}); // silent
  return client;
}

/** Is BullMQ available? Workers/queues should check this before registering. */
export const BULLMQ_ENABLED = !!env.UPSTASH_REDIS_URL;

export const REDIS_KEYS = {
  OTP_ATTEMPTS:     (userId: string)      => `otp:attempts:${userId}`,
  OTP_RATE:         (email: string)       => `otp:rate:${email}`,
  OAUTH_STATE:      (state: string)       => `oauth:state:${state}`,
  STREAM_VIEWERS:   (streamId: string)    => `stream:viewers:${streamId}`,
  STREAM_BITRATE:   (streamId: string)    => `stream:bitrate:${streamId}`,
  WEBRTC_TRANSPORT: (transportId: string) => `webrtc:transport:${transportId}`,
} as const;