import { Redis as UpstashRedis } from '@upstash/redis';
import { env } from './env';

// ── Main Redis client — Upstash REST (HTTPS, works on any network)
export const redis = new UpstashRedis({
  url:   env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

console.log('✅ Redis (Upstash REST) initialised');

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