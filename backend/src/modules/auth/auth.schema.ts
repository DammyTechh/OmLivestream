import { z } from 'zod';

// ── Zod runtime validation schemas ───────────────────────────────
export const sendOtpSchema     = z.object({ email: z.string().email('Valid email required').toLowerCase().trim() });
export const verifyOtpSchema   = z.object({ email: z.string().email().toLowerCase().trim(), code: z.string().length(6).regex(/^\d+$/, 'Must be 6 digits') });
export const socialOAuthSchema = z.object({ code: z.string().min(1, 'OAuth code required') });
export const socialExchangeSchema = z.object({ ticket: z.string().min(16, 'Sign-in ticket required') });
export const emailClaimRequestSchema = z.object({ email: z.string().email('Valid email required').toLowerCase().trim() });
export const emailClaimConfirmSchema = z.object({ code: z.string().length(6).regex(/^\d+$/, 'Must be 6 digits') });
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
  description: 'Returns { authUrl, state }. Send the browser to authUrl; the provider redirects back to the callback route, which forwards to the frontend with a one-time ticket.',
});

export const socialCallbackJsonSchema = (provider: string) => ({
  tags:    ['Auth'],
  summary: `${provider} OAuth callback — redirects to the frontend with a one-time ticket`,
  description: 'Called by the provider, not by the frontend. Always answers with a 302; it never returns JSON, so a failure lands the user on a page rather than on a raw error.',
  querystring: {
    type: 'object',
    properties: {
      code:              { type: 'string' },
      state:             { type: 'string' },
      error:             { type: 'string' },
      error_description: { type: 'string' },
    },
  },
});

export const socialExchangeJsonSchema = {
  tags:    ['Auth'],
  summary: 'Exchange a one-time sign-in ticket for JWT tokens',
  description: 'Tokens are handed over here rather than in the callback redirect, so a refresh token never appears in a URL, browser history, or a Referer header.',
  body: {
    type: 'object',
    required: ['ticket'],
    properties: { ticket: { type: 'string' } },
  },
};

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

export const emailClaimRequestJsonSchema = {
  tags:    ['Auth'],
  summary: 'Send a verification code to an email a social account wants to attach',
  description: 'For accounts created through Instagram or TikTok, which disclose no email. The address is verified by code rather than simply accepted — an unverified address on file would claim a mailbox the user may not own and become a login route into their account.',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object', required: ['email'],
    properties: { email: { type: 'string', format: 'email' } },
  },
};

export const emailClaimConfirmJsonSchema = {
  tags:    ['Auth'],
  summary: 'Confirm the code and attach the email to the account',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object', required: ['code'],
    properties: { code: { type: 'string', minLength: 6, maxLength: 6, pattern: '^\\d{6}$' } },
  },
};
