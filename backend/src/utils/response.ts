import { FastifyReply } from 'fastify';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string; details?: unknown };
  meta?: { page?: number; limit?: number; total?: number; hasMore?: boolean };
}

export function sendSuccess<T>(reply: FastifyReply, data: T, message?: string, statusCode = 200, meta?: ApiResponse['meta']): FastifyReply {
  const res: ApiResponse<T> = { success: true, data };
  if (message) res.message = message;
  if (meta) res.meta = meta;
  return reply.status(statusCode).send(res);
}

export function sendCreated<T>(reply: FastifyReply, data: T, message?: string): FastifyReply {
  return sendSuccess(reply, data, message, 201);
}

export function sendNoContent(reply: FastifyReply): FastifyReply {
  return reply.status(204).send();
}

export function sendError(reply: FastifyReply, code: string, message: string, statusCode = 500, details?: unknown): FastifyReply {
  return reply.status(statusCode).send({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}

export function paginateMeta(total: number, page: number, limit: number) {
  return { page, limit, total, hasMore: page * limit < total };
}
