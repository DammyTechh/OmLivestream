import { z } from 'zod';

// ── Zod runtime validation schemas ───────────────────────────────
export const sendOtpSchema     = z.object({ email: z.string().email('Valid email required').toLowerCase().trim() });
export const verifyOtpSchema   = z.object({ email: z.string().email().toLowerCase().trim(), code: z.string().length(6).regex(/^\d+$/, 'Must be 6 digits') });
export const socialOAuthSchema = z.object({ code: z.string().min(1, 'OAuth code required') });
export const refreshSchema     = z.object({ refreshToken: z.string().min(1) });
export const logoutSchema      = z.object({ refreshToken: z.string().min(1) });

// ── Fastify/Swagger route schemas (no response: blocks — avoids serialization errors) ──

export const sendOtpJsonSchema = {
  tags:    ['Auth'],
  summary: 'Step 1 — Send 6-digit OTP to email (passwordless)',
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
  },
};

export const verifyOtpJsonSchema = {
  tags:    ['Auth'],
  summary: 'Step 2 — Verify OTP and receive JWT tokens',
  body: {
    type: 'object',
    required: ['email', 'code'],
    properties: {
      email: { type: 'string', format: 'email' },
      code:  { type: 'string', minLength: 6, maxLength: 6, pattern: '^\\d{6}$' },
    },
  },
};

export const socialUrlJsonSchema = (provider: string) => ({
  tags:    ['Auth'],
  summary: `Get ${provider} OAuth redirect URL`,
});

export const socialOAuthJsonSchema = (provider: string) => ({
  tags:    ['Auth'],
  summary: `Complete ${provider} OAuth — receive JWT tokens`,
  body: {
    type: 'object',
    required: ['code'],
    properties: {
      code:  { type: 'string' },
      state: { type: 'string' },
    },
  },
});

export const refreshJsonSchema = {
  tags:    ['Auth'],
  summary: 'Refresh access token using refresh token',
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string' },
    },
  },
};

export const logoutJsonSchema = {
  tags:     ['Auth'],
  summary:  'Logout — invalidate current session',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string' },
    },
  },
};
