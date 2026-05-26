import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors        from '@fastify/cors';
import fastifyHelmet      from '@fastify/helmet';
import fastifyJwt         from '@fastify/jwt';
import fastifyMultipart   from '@fastify/multipart';
import fastifyRateLimit   from '@fastify/rate-limit';
import fastifySwagger     from '@fastify/swagger';
import fastifySwaggerUi   from '@fastify/swagger-ui';


import { env }            from './config/env';
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
  // Support comma-separated FRONTEND_URL list for Vercel previews
  const allowedOrigins = env.FRONTEND_URL.split(',').map((u) => u.trim()).filter(Boolean);
  await app.register(fastifyCors, {
    origin: env.NODE_ENV === 'production'
      ? (origin, cb) => {
          if (!origin || allowedOrigins.some((o) => origin.startsWith(o) || origin === o)) {
            cb(null, true);
          } else {
            cb(new Error('Not allowed by CORS'), false);
          }
        }
      : [env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // ── Rate limiting ────────────────────────────────────────────────
  await app.register(fastifyRateLimit, {
    global:     true,
    max:        env.RATE_LIMIT_API_MAX,
    timeWindow: env.RATE_LIMIT_API_WINDOW_MS,
    keyGenerator: (req) => (req.headers['x-forwarded-for'] as string) ?? req.ip,
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
        contact: { name: 'OmliveStream Dev', email: 'dev@omlivestream.com' },
        license: { name: 'MIT' },
      },
      servers: [
        { url: `${env.API_BASE_URL}/api/v1`, description: 'Current server' },
        { url: 'http://localhost:3001/api/v1', description: 'Local development' },
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
        { name: 'Analytics',  description: 'Views, impressions and engagement metrics' },
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

  // ── Health check ─────────────────────────────────────────────────
  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Server health check',
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'number' }, timestamp: { type: 'string' }, env: { type: 'string' } } } },
    },
  }, async (_req, reply) => reply.send({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), env: env.NODE_ENV }));

  // ── API v1 routes ────────────────────────────────────────────────
  await app.register(async (v1) => {
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
  }, { prefix: '/api/v1' });

  return app;
}