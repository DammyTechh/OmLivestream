import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  ENCRYPTION_KEY: z.string().min(32),

  RESEND_API_KEY: z.string().startsWith('re_'),
  EMAIL_FROM: z.string().min(1),

  UPSTASH_REDIS_URL:        z.string().optional().default(''),   // rediss:// TCP URL for BullMQ (optional locally)
  UPSTASH_REDIS_REST_URL:   z.string().url(),     // https:// REST URL for general use
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),    // REST token

  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_PUBLIC_KEY: z.string().min(1),
  PAYSTACK_WEBHOOK_SECRET: z.string().min(1),

  OPENAI_API_KEY: z.string().startsWith('sk-'),

  MEDIASOUP_MIN_PORT: z.coerce.number().default(40000),
  MEDIASOUP_MAX_PORT: z.coerce.number().default(49999),
  MEDIASOUP_ANNOUNCED_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),

  RTMP_RELAY_INTERNAL_URL: z.string().url(),
  RTMP_RELAY_SECRET: z.string().min(1),

  // OAuth keys are optional at startup — platform connect will fail gracefully if empty
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/youtube'),

  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  FACEBOOK_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/facebook'),
  INSTAGRAM_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/instagram'),

  TWITCH_CLIENT_ID: z.string().default(''),
  TWITCH_CLIENT_SECRET: z.string().default(''),
  TWITCH_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/twitch'),

  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  TIKTOK_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/tiktok'),

  TWITTER_CLIENT_ID: z.string().default(''),
  TWITTER_CLIENT_SECRET: z.string().default(''),
  TWITTER_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/twitter'),

  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  LINKEDIN_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/platforms/oauth/callback/linkedin'),

  OTP_EXPIRY_MINUTES: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(3),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(5),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_API_MAX: z.coerce.number().default(100),
  RATE_LIMIT_API_WINDOW_MS: z.coerce.number().default(60000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌  OmliveStream — Invalid environment variables:\n');
  Object.entries(parsed.error.flatten().fieldErrors).forEach(([key, msgs]) => {
    console.error(`   ${key}: ${msgs?.join(', ')}`);
  });
  console.error('\nFix your .env file and restart.\n');
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
