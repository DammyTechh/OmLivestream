import { FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../config/supabase';
import { sendError } from '../utils/response';
import type { AdminRole } from '../types/database';

interface AdminJwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
  isAdmin: true;
}

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

  // Verify admin still active in DB
  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('id, is_active, role')
    .eq('id', payload.sub)
    .single();

  if (!data || !data.is_active) {
    sendError(reply, 'FORBIDDEN', 'Admin account is inactive', 403);
  }
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
