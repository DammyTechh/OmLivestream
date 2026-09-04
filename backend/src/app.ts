import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors        from '@fastify/cors';
import fastifyHelmet      from '@fastify/helmet';
import fastifyJwt         from '@fastify/jwt';
import fastifyMultipart   from '@fastify/multipart';
import fastifyRateLimit   from '@fastify/rate-limit';
import fastifySwagger     from '@fastify/swagger';
import fastifySwaggerUi   from '@fastify/swagger-ui';


import { env, corsAllowedOrigins } from './config/env';
import { redis, createRateLimitRedis } from './config/redis';
import { logger }         from './config/logger';
import { AppError }       from './utils/errors';
import { sendError }      from './utils/response';

import { avatarRoutes } from './modules/users/avatar.routes';
import { authRoutes }       from './modules/auth/auth.routes';
import { usersRoutes }      from './modules/users/users.routes';
import { platformsRoutes }  from './modules/platforms/platforms.routes';
import { streamsRoutes }    from './modules/streams/streams.routes';
import { recordingsRoutes } from './modules/recordings/recordings.routes';
import { analyticsRoutes }  from './modules/analytics/analytics.routes';
import { billingRoutes }    from './modules/billing/billing.routes';
import { feedbackRoutes }   from './modules/feedback/feedback.routes';
import { adminRoutes }      from './modules/admin/admin.routes';
import { plansRoutes }      from './modules/plans/plans.routes';
import { waitlistRoutes }   from './modules/waitlist/waitlist.routes';
import { webrtcRoutes }     from './modules/webrtc/webrtc.routes';
import { aiRoutes }         from './modules/ai/ai.routes';
import { contactRoutes }    from './modules/contact/contact.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:     false,        // using pino directly
    trustProxy: true,
    ajv: {
      customOptions: {
        removeAdditional: true,
        useDefaults:      true,
        coerceTypes:      true,
        allErrors:        false,
        strict:           false,  // allows 'example', 'description' in schemas
      },
    },
  });

  // ── Security headers ─────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'wss:', 'ws:'],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  // ── CORS ─────────────────────────────────────────────────────────
  // Origins come from config/env (CORS_ALLOWED_ORIGINS + every known
  // app subdomain), already normalised to scheme://host[:port].
  //
  // Two things matter here:
  //  1. Never pass an Error to the callback. Doing so makes @fastify/cors
  //     throw into the global error handler, which answers the OPTIONS
  //     preflight with 500 and no CORS headers — the browser then reports
  //     a generic "CORS error" that looks nothing like the real cause.
  //     Rejecting is `cb(null, false)`: no headers, clean 200 preflight.
  //  2. Match origins exactly. `origin.startsWith(allowed)` would let
  //     https://omlivestream.com.attacker.test through.
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Same-origin/non-browser callers (curl, health checks, server-to-
      // server) send no Origin header — nothing to authorise.
      if (!origin) return cb(null, true);
      cb(null, corsAllowedOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    // Cache the preflight for 24h so the browser stops re-asking.
    maxAge: 86400,
  });

  // ── Response compression ─────────────────────────────────────────
  // Registered after CORS so preflights are answered before we bother
  // negotiating an encoding, and before the routes so every JSON payload
  // passes through it. The analytics and dashboard responses are the ones
  // that matter: highly repetitive JSON, which gzip takes down by roughly
  // an order of magnitude. On a metered egress plan with thousands of
  // dashboard polls that is the single cheapest win available.
  //
  // Loaded defensively so a missing dependency degrades to uncompressed
  // responses instead of refusing to boot.
  try {
    const fastifyCompress = require('@fastify/compress');
    await app.register(fastifyCompress, {
      global:    true,
      encodings: ['gzip', 'deflate'],
      /**
       * Effectively disabled.
       *
       * On this deployment, compression produced responses with
       * `content-encoding: gzip` and `content-length: 0` — a 200 with no body
       * at all, captured straight from Node before nginx. Every response over
       * the threshold came back empty, which is why the streams list,
       * recordings, analytics and comments all rendered as "nothing yet" while
       * single-item pages worked: those were small enough to slip under it.
       *
       * The cause has not been identified, and a compression layer that
       * silently discards response bodies is far more expensive than the
       * bandwidth it saves. Raising the threshold above any realistic payload
       * turns it off in practice without removing the plugin, so it can be
       * re-enabled by changing one number once the root cause is understood.
       */
      threshold: 10 * 1024 * 1024,
    });
  } catch (err) {
    logger.warn({ err }, 'Response compression unavailable — run `npm install`. Serving uncompressed.');
  }

  // ── Rate limiting ────────────────────────────────────────────────
  // Backed by Redis when a TCP URL is available, so the limit is shared
  // across instances. With the default in-process store, N instances behind
  // a load balancer each keep their own counter and the effective limit
  // becomes N × the configured value — which is exactly the point at which
  // a rate limit stops being one. The store also stops per-IP counters from
  // accumulating in each instance's heap.
  const rateLimitRedis = createRateLimitRedis();
  if (!rateLimitRedis) {
    logger.warn(
      'Rate limiting is per-instance (UPSTASH_REDIS_URL unset). Running multiple ' +
      'instances multiplies every configured limit by the instance count.',
    );
  }

  await app.register(fastifyRateLimit, {
    global:     true,
    max:        env.RATE_LIMIT_API_MAX,
    timeWindow: env.RATE_LIMIT_API_WINDOW_MS,
    ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
    // Namespaced so rate-limit keys cannot collide with BullMQ's or the
    // Socket.io adapter's keys in the same database.
    nameSpace: 'omls-rl:',
    // A spoofable header, but it is the only way to see the real client
    // behind Render's proxy. Take the first hop — the proxy appends, so
    // later entries are attacker-controlled.
    keyGenerator: (req) => {
      const xff = req.headers['x-forwarded-for'];
      const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
      return first?.trim() || req.ip;
    },
    errorResponseBuilder: (_req, ctx) => ({
      success: false,
      error: { code: 'TOO_MANY_REQUESTS', message: `Rate limit hit. Retry in ${Math.ceil(ctx.ttl / 1000)}s.` },
    }),
  });

  // ── JWT ──────────────────────────────────────────────────────────
  await app.register(fastifyJwt, {
    secret:    env.JWT_SECRET,
    sign:      { expiresIn: env.JWT_EXPIRES_IN },
    decode:    { complete: true },
  });

  // ── Multipart (thumbnail uploads, max 5 MB) ───────────────────────
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  // ── Swagger ──────────────────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title:       'OmliveStream API',
        version:     '1.0.0',
        description: `
## OmliveStream REST API

Multi-platform live streaming SaaS backend — stream to 8+ platforms simultaneously.

### Authentication
1. **POST** \`/api/v1/auth/send-otp\` — sends a 6-digit code to your email
2. **POST** \`/api/v1/auth/verify-otp\` — returns \`accessToken\` + \`refreshToken\`
3. Pass \`Authorization: Bearer <accessToken>\` on every protected request
4. Access tokens expire in **15 min** — refresh via **POST** \`/api/v1/auth/refresh\`

### Go Live Flow
1. \`POST /streams\` — create stream, pick platforms
2. \`POST /streams/:id/start\` — get \`rtpCapabilities\`
3. \`POST /webrtc/create-transport\` → \`POST /webrtc/connect-transport\` → \`POST /webrtc/produce\`
4. Connect Socket.io → \`join:stream\` → stream live comments & viewer counts in real-time
5. \`POST /streams/:id/end\` — ends stream, triggers recording processing

### Rate Limits
- Auth endpoints: **5 req / 15 min** per IP
- API endpoints: **100 req / min** per user
        `,
        contact: { name: 'OmliveStream Support', email: env.SUPPORT_EMAIL, url: env.FRONTEND_URL },
        license: { name: 'MIT' },
      },
      servers: [
        { url: `${env.API_BASE_URL}/api/v1`, description: 'Current server' },
        // Only offered off-production. Listing it in prod lets "Try it out"
        // fire at http://localhost:3001 from a page served over HTTPS, which
        // the browser blocks as mixed content and reports as a CORS failure.
        ...(env.NODE_ENV !== 'production'
          ? [{ url: 'http://localhost:3001/api/v1', description: 'Local development' }]
          : []),
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
        schemas: {
          Unauthorized:    { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'UNAUTHORIZED' }, message: { type: 'string' } } } } },
          Forbidden:       { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'PREMIUM_REQUIRED' }, message: { type: 'string' } } } } },
          NotFound:        { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'NOT_FOUND' }, message: { type: 'string' } } } } },
          ValidationError: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } } },
          TooManyRequests: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'TOO_MANY_REQUESTS' }, message: { type: 'string' } } } } },
        },
      },
      tags: [
        { name: 'Auth',       description: 'Passwordless OTP + social OAuth — token issuance and refresh' },
        { name: 'Users',      description: 'Profile, onboarding, subscription, login history, session/device management, account deletion' },
        { name: 'Platforms',  description: 'Connect streaming platforms via OAuth or manual RTMP' },
        { name: 'Streams',    description: 'Stream lifecycle — create, start, end' },
        { name: 'WebRTC',     description: 'mediasoup transport + producer — required before going live' },
        { name: 'Recordings', description: 'Auto-saved recordings, AI editing, platform publishing' },
        { name: 'Analytics',  description: 'Views, peak audience and engagement metrics' },
        { name: 'Billing',    description: 'Paystack subscriptions, invoices, webhooks' },
        { name: 'AI',         description: 'AI assistant chat and stream title generator' },
        { name: 'Feedback',   description: 'User feedback and feature update notifications' },
        { name: 'Admin',      description: 'Admin dashboard — user management, revenue charts, subscriptions, security intelligence. Requires admin JWT from POST /admin/auth/login.' },
        { name: 'Admin Broadcasts', description: 'Admin email broadcast campaigns — compose, schedule, and send emails to user segments from the dashboard.' },
        { name: 'Plans',      description: 'Plan limits, upgrade popup config, discount codes. Call GET /plans/my-plan on every dashboard load.' },
        { name: 'Contact',    description: 'Public contact form from landing page — submissions visible in admin dashboard.' },
        { name: 'Waitlist',   description: 'Public waitlist join — no auth needed. Rewards auto-applied on registration.' },
        { name: 'Health',     description: 'Server health check' },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig:    { docExpansion: 'list', deepLinking: true, persistAuthorization: true, displayRequestDuration: true },
    transformSpecificationClone: true,
  });

  // ── Global error handler ─────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, method: request.method, url: request.url }, 'Request error');

    if (error instanceof AppError) return sendError(reply, error.code, error.message, error.statusCode);

    // Zod errors (.parse() throws ZodError)
    if (error.name === 'ZodError') {
      const ze = error as unknown as { issues: { path: string[]; message: string }[] };
      return sendError(reply, 'VALIDATION_ERROR', 'Validation failed', 422, ze.issues);
    }

    // Fastify schema validation
    if (error.validation) return sendError(reply, 'VALIDATION_ERROR', error.message, 400, error.validation);

    // JWT plugin errors
    if ((error as { code?: string }).code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED')
      return sendError(reply, 'TOKEN_EXPIRED', 'Access token expired — refresh it', 401);
    if ((error as { code?: string }).code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER')
      return sendError(reply, 'UNAUTHORIZED', 'Authorization header missing', 401);

    const msg = env.NODE_ENV === 'production' ? 'Internal server error' : error.message;
    return sendError(reply, 'INTERNAL_ERROR', msg, 500);
  });

  // ── 404 handler ──────────────────────────────────────────────────
  app.setNotFoundHandler((req, reply) =>
    sendError(reply, 'NOT_FOUND', `${req.method} ${req.url} not found`, 404));

  // ── Health check (root — for Render's port scanner & uptime monitors) ──
  app.get('/health', {
    schema: { hide: true },
  }, async (_req, reply) => reply.send({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), env: env.NODE_ENV }));

  // ── API v1 routes ────────────────────────────────────────────────
  await app.register(async (v1) => {
    // Health inside v1 so Swagger "Try it out" works
    v1.get('/health', {
      schema: {
        tags: ['Health'],
        summary: 'Server health check',
        response: { 200: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'number' }, timestamp: { type: 'string' }, env: { type: 'string' }, redis: { type: 'string' } } } },
      },
      // Dependency probe, so this must not be cached or rate-limited away.
    }, async (_req, reply) => reply.send({
      status:    'ok',
      uptime:    process.uptime(),
      timestamp: new Date().toISOString(),
      env:       env.NODE_ENV,
      redis:     (await redis.ping()) ? 'ok' : 'degraded',
    }));
    await v1.register(authRoutes,       { prefix: '/auth' });
    await v1.register(usersRoutes,      { prefix: '/users' });
    await v1.register(avatarRoutes,     { prefix: '/users' });
    await v1.register(platformsRoutes,  { prefix: '/platforms' });
    await v1.register(streamsRoutes,    { prefix: '/streams' });
    await v1.register(webrtcRoutes,     { prefix: '/webrtc' });
    await v1.register(recordingsRoutes, { prefix: '/recordings' });
    await v1.register(analyticsRoutes,  { prefix: '/analytics' });
    await v1.register(billingRoutes,    { prefix: '/billing' });
    await v1.register(aiRoutes,         { prefix: '/ai' });
    await v1.register(feedbackRoutes,   { prefix: '/feedback' });
    await v1.register(adminRoutes,      { prefix: '/admin' });
    await v1.register(plansRoutes,      { prefix: '/plans' });
    await v1.register(waitlistRoutes,   { prefix: '/waitlist' });
    await v1.register(contactRoutes,    { prefix: '/contact' });
    await v1.register(notificationsRoutes, { prefix: '/notifications' });
  }, { prefix: '/api/v1' });

  return app;
}