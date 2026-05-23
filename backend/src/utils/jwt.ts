import { FastifyRequest } from 'fastify';
import type { JwtPayload, AuthUser } from '../types/database';

export function getAuthUser(request: FastifyRequest): AuthUser {
  const payload = request.user as JwtPayload;
  return { id: payload.sub, email: payload.email, plan: payload.plan };
}
