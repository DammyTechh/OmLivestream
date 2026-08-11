import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { notifications } from './notifications.service';

const idParam = z.object({ id: z.string().uuid('Not a valid notification id') });

/**
 * The three endpoints the dashboard bell has been calling since launch.
 *
 * Paths and response shapes are taken from the component rather than chosen
 * fresh — NotificationBell reads `data.items` and `data.unreadCount`, so
 * renaming either here would leave the badge permanently at zero.
 */
export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', {
    schema: {
      tags: ['Notifications'],
      summary: 'Recent notifications with unread count',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await notifications.list(u.id));
  });

  fastify.patch('/:id/read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark one notification read',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { id } = idParam.parse(req.params);
    await notifications.markRead(u.id, id);
    sendSuccess(reply, { id, read: true });
  });

  fastify.post('/read-all', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark every notification read',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, { cleared: await notifications.markAllRead(u.id) });
  });
}
