import { FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../config/supabase';
import { redis } from '../config/redis';
import { sendError } from '../utils/response';
import type { AdminRole } from '../types/database';

interface AdminJwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
  isAdmin: true;
}

/**
 * How long an "is this admin still active?" answer is trusted.
 *
 * Short on purpose. This check exists so that deactivating an admin takes
 * effect before their JWT expires, and any cache lengthens that window —
 * 30 seconds keeps revocation effectively immediate while removing the
 * per-request round trip from every page of the admin dashboard, which
 * issues a dozen or more requests on a single load.
 *
 * Only the active state is cached, never the inactive one: a revoked admin
 * must be locked out on the very next request, so a negative result is
 * always re-read from Postgres.
 */
const ADMIN_ACTIVE_TTL_SEC = 30;

const activeKey = (adminId: string): string => `admin:active:${adminId}`;

export async function authenticateAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    sendError(reply, 'UNAUTHORIZED', 'Invalid or expired admin token', 401);
    return;
  }

  const payload = request.user as AdminJwtPayload;
  if (!payload.isAdmin) {
    sendError(reply, 'FORBIDDEN', 'Admin access required', 403);
    return;
  }

  // Upstash's REST client parses JSON on read, so a stored '1' can come
  // back as either the string or the number. Normalise before comparing.
  const cached = await redis.get<string | number>(activeKey(payload.sub));
  if (String(cached) === '1') return;

  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('id, is_active, role')
    .eq('id', payload.sub)
    .single();

  if (!data || !data.is_active) {
    sendError(reply, 'FORBIDDEN', 'Admin account is inactive', 403);
    return;
  }

  // Not awaited: the request has already been authorised, and a slow cache
  // write should not sit in front of the handler.
  void redis.set(activeKey(payload.sub), '1', { ex: ADMIN_ACTIVE_TTL_SEC });
}

/**
 * Drops the cached active flag for an admin.
 *
 * Nothing calls this yet, because there is no endpoint that deactivates an
 * admin — today it is a manual `update admin_users set is_active = false`
 * in the Supabase editor, which this process cannot observe. That is why
 * ADMIN_ACTIVE_TTL_SEC is 30 seconds and not 30 minutes: the TTL *is* the
 * revocation bound for a manual change.
 *
 * When a deactivation endpoint is added, call this from it and revocation
 * becomes immediate.
 */
export async function invalidateAdminCache(adminId: string): Promise<void> {
  await redis.del(activeKey(adminId));
}

export function requireRole(...roles: AdminRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const payload = request.user as AdminJwtPayload;
    if (!roles.includes(payload.role)) {
      sendError(reply, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`, 403);
    }
  };
}

export function getAdminUser(request: FastifyRequest): AdminJwtPayload {
  return request.user as AdminJwtPayload;
}
