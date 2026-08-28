import 'dotenv/config';
import { z } from 'zod';

// Normalise NODE_ENV — Render sets it as "Production" (capital P)
// but our schema (and Node.js convention) expects lowercase.
if (process.env.NODE_ENV) {
  process.env.NODE_ENV = process.env.NODE_ENV.toLowerCase();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url(),

  // ── Public surfaces ───────────────────────────────────────────────
  // FRONTEND_URL is the canonical marketing site and the base for links
  // in emails. Each app surface has its own subdomain.
  FRONTEND_URL:  z.string().url(),
  DASHBOARD_URL: z.string().url().optional(),
  ADMIN_URL:     z.string().url().optional(),
  PAYMENT_URL:   z.string().url().optional(),

  // Comma-separated list of browser origins allowed to call this API.
  // Kept separate from FRONTEND_URL so the allowlist can include the
  // Vercel URL and localhost without polluting canonical email links.
  CORS_ALLOWED_ORIGINS: z.string().optional().default(''),

  // ── Official contact addresses ────────────────────────────────────
  SUPPORT_EMAIL: z.string().email().default('support@omlivestream.com'),
  SALES_EMAIL:   z.string().email().default('sales@omlivestream.com'),

  /**
   * Lets Expo Go complete social sign-in against this server.
   *
   * Expo Go has no custom scheme, so the app's OAuth return URL is
   * `exp://<your-lan-ip>:8081/--/auth/callback`. That is refused in production
   * on purpose — it carries an arbitrary host, so accepting it unconditionally
   * would be an open redirect.
   *
   * Set this to `true` only while testing on a real phone, and turn it off
   * again afterwards. It is a separate switch rather than something inferred
   * so that enabling it is always a decision somebody made on purpose.
   */
  // NOT z.coerce.boolean(): coercion follows JavaScript truthiness, so the
  // string "false" — the most natural way to switch this off in a .env file —
  // becomes `true`. A flag that cannot be turned off is worse than no flag,
  // and on a security control it is dangerous. Match the literal instead.
  ALLOW_DEV_OAUTH_RETURN: z.string().optional()
    .transform((v) => v?.toLowerCase() === 'true')
    .pipe(z.boolean()),

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

  UPSTASH_REDIS_URL:        z.string().optional().default(''),
  UPSTASH_REDIS_REST_URL:   z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_PUBLIC_KEY: z.string().min(1),
  // This is the HMAC-SHA512 signing secret from the Paystack dashboard —
  // NOT the webhook endpoint URL. Pasting the URL here is an easy mistake
  // and it fails silently: every webhook signature mismatches, so paid
  // subscriptions never activate. Reject it at boot instead.
  PAYSTACK_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .refine((v) => !/^https?:\/\//i.test(v), {
      message:
        'looks like a URL — this must be the Paystack webhook signing secret, not the endpoint URL',
    }),

  OPENAI_API_KEY: z.string().startsWith('sk-'),

  MEDIASOUP_MIN_PORT: z.coerce.number().default(40000),
  MEDIASOUP_MAX_PORT: z.coerce.number().default(49999),
  MEDIASOUP_ANNOUNCED_IP: z.string().min(1),
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),

  RTMP_RELAY_INTERNAL_URL: z.string().url(),
  RTMP_RELAY_SECRET: z.string().min(1),

  YOUTUBE_CLIENT_ID: z.string().min(1),
  YOUTUBE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_REDIRECT_URI: z.string().url(),

  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  FACEBOOK_REDIRECT_URI: z.string().url(),
  INSTAGRAM_REDIRECT_URI: z.string().url(),

  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_REDIRECT_URI: z.string().url(),

  TIKTOK_CLIENT_KEY: z.string().min(1),
  TIKTOK_CLIENT_SECRET: z.string().min(1),
  TIKTOK_REDIRECT_URI: z.string().url(),

  TWITTER_CLIENT_ID: z.string().min(1),
  TWITTER_CLIENT_SECRET: z.string().min(1),
  TWITTER_REDIRECT_URI: z.string().url(),

  LINKEDIN_CLIENT_ID: z.string().min(1),
  LINKEDIN_CLIENT_SECRET: z.string().min(1),
  LINKEDIN_REDIRECT_URI: z.string().url(),

  // ── Sign-in OAuth clients ─────────────────────────────────────────
  // Separate from the broadcast clients above on purpose. Those hold
  // publishing scopes (youtube.force-ssl, publish_video) and are reviewed by
  // the platform as a broadcasting tool; these ask only for a name, email and
  // avatar. Sharing one client means the sign-in button triggers a consent
  // screen demanding permission to publish video, which reads as a phishing
  // attempt and costs conversions — and it couples a routine credential
  // rotation on one flow to an outage in the other.
  //
  // Optional, and each falls back to its broadcast counterpart, so an existing
  // deployment keeps working unchanged until the dedicated clients exist.
  AUTH_GOOGLE_CLIENT_ID:        z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET:    z.string().optional(),
  AUTH_FACEBOOK_CLIENT_ID:      z.string().optional(),
  AUTH_FACEBOOK_CLIENT_SECRET:  z.string().optional(),
  AUTH_INSTAGRAM_CLIENT_ID:     z.string().optional(),
  AUTH_INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  AUTH_TIKTOK_CLIENT_KEY:       z.string().optional(),
  AUTH_TIKTOK_CLIENT_SECRET:    z.string().optional(),
  AUTH_TWITCH_CLIENT_ID:        z.string().optional(),
  AUTH_TWITCH_CLIENT_SECRET:    z.string().optional(),

  OTP_EXPIRY_MINUTES: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(3),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(5),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_API_MAX: z.coerce.number().default(100),
  RATE_LIMIT_API_WINDOW_MS: z.coerce.number().default(60000),
});

/**
 * Strip surrounding quotes and trailing whitespace from every value before
 * validation.
 *
 * Pasting a value into a dashboard field very easily carries a trailing
 * newline, and some hosts round-trip that as a literal backslash-n. Neither
 * is visible on screen, and the failures are baffling:
 *   - `SUPPORT_EMAIL` fails `.email()` and the process exits at boot
 *   - a URL still passes `.url()` (WHATWG tolerates trailing whitespace)
 *     but then string-concatenates into a broken link
 * Normalising once here is much cheaper than debugging it per-variable.
 */
function clean(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    out[k] = v
      .replace(/^\s*(['"])([\s\S]*)\1\s*$/, '$2') // drop wrapping quotes
      .replace(/(?:\\[rn])+$/g, '')               // literal "\n" / "\r"
      .trim();
  }
  return out;
}

const parsed = envSchema.safeParse(clean(process.env));

if (!parsed.success) {
  console.error('\nOmliveStream — invalid environment variables:\n');
  Object.entries(parsed.error.flatten().fieldErrors).forEach(([key, msgs]) => {
    console.error(`   ${key}: ${msgs?.join(', ')}`);
  });
  console.error('\nFix your .env file and restart.\n');
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

// ── Derived URLs ────────────────────────────────────────────────────
// The subdomain vars are optional so local dev keeps working with a
// single localhost origin. Fall back to FRONTEND_URL when unset.
export const urls = {
  site:      env.FRONTEND_URL,
  dashboard: env.DASHBOARD_URL ?? env.FRONTEND_URL,
  admin:     env.ADMIN_URL     ?? env.FRONTEND_URL,
  payment:   env.PAYMENT_URL   ?? env.FRONTEND_URL,
} as const;

// ── CORS allowlist ──────────────────────────────────────────────────
// Every browser-facing origin that may call this API. Built from the
// explicit CORS_ALLOWED_ORIGINS list plus all known app surfaces, so a
// missing entry in one place can't silently break a subdomain.
export const corsAllowedOrigins: string[] = Array.from(
  new Set(
    [
      ...env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
      env.FRONTEND_URL,
      env.DASHBOARD_URL,
      env.ADMIN_URL,
      env.PAYMENT_URL,
      ...(env.NODE_ENV !== 'production'
        ? ['http://localhost:3000', 'http://localhost:3001']
        : []),
    ]
      .filter((o): o is string => Boolean(o))
      // Normalise: origins never carry a trailing slash or a path.
      .map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  ),
);