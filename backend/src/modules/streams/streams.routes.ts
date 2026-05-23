import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StreamsService } from './streams.service';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess, sendCreated, paginateMeta } from '../../utils/response';
import type { Platform, StreamStatus } from '../../types/database';

const svc = new StreamsService();

const PLATFORMS = ['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin','kick'] as const;

const createSchema = z.object({
  title:        z.string().min(3).max(150),
  description:  z.string().max(5000).optional(),
  thumbnailUrl: z.string().url().optional(),
  platforms:    z.array(z.enum(PLATFORMS)).min(1).max(8),
});

const listQuery = z.object({
  page:   z.coerce.number().min(1).default(1),
  limit:  z.coerce.number().min(1).max(50).default(20),
  status: z.enum(['scheduled','live','ended']).optional(),
});

const networkAnalysisSchema = z.object({
  uploadMbps:        z.number().min(0).max(1000),
  latencyMs:         z.number().min(0).max(10000),
  jitterMs:          z.number().min(0).max(1000).default(0),
  packetLossPercent: z.number().min(0).max(100).default(0),
  selectedPlatforms: z.array(z.enum(PLATFORMS)).default([]),
});

export async function streamsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // List streams
  fastify.get('/', {
    schema: {
      tags: ['Streams'],
      summary: 'List user streams',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'integer', default: 1 },
          limit:  { type: 'integer', default: 20 },
          status: { type: 'string', enum: ['scheduled','live','ended'] },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const q = listQuery.parse(req.query);
    const { data, total } = await svc.list(u.id, q.page, q.limit, q.status as StreamStatus | undefined);
    sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
  });

  // Create stream
  fastify.post('/', {
    schema: {
      tags: ['Streams'],
      summary: 'Create a new stream session',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['title','platforms'],
        properties: {
          title:        { type: 'string', minLength: 3, maxLength: 150 },
          description:  { type: 'string', maxLength: 5000 },
          thumbnailUrl: { type: 'string', format: 'uri' },
          platforms:    { type: 'array', items: { type: 'string', enum: PLATFORMS }, minItems: 1, maxItems: 8 },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const b = createSchema.parse(req.body);
    sendCreated(reply, await svc.create(u.id, { ...b, platforms: b.platforms as Platform[] }), 'Stream created');
  });

  // Get stream
  fastify.get('/:id', {
    schema: {
      tags: ['Streams'],
      summary: 'Get stream details + platforms + recordings',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    sendSuccess(reply, await svc.get(getAuthUser(req).id, req.params.id));
  });

  // Start stream
  fastify.post('/:id/start', {
    schema: {
      tags: ['Streams'],
      summary: 'Start stream — initialises mediasoup + notifies RTMP relay',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await svc.start(u.id, req.params.id), 'Stream started');
  });

  // End stream
  fastify.post('/:id/end', {
    schema: {
      tags: ['Streams'],
      summary: 'End live stream — triggers recording processing',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await svc.end(getAuthUser(req).id, req.params.id);
    sendSuccess(reply, null, 'Stream ended — recording is being processed');
  });

  // Network analysis
  fastify.post('/network-check', {
    schema: {
      tags: ['Streams'],
      summary: 'Network analysis — post measured values, get quality recommendation',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['uploadMbps','latencyMs'],
        properties: {
          uploadMbps:        { type: 'number', minimum: 0 },
          latencyMs:         { type: 'number', minimum: 0 },
          jitterMs:          { type: 'number', minimum: 0, default: 0 },
          packetLossPercent: { type: 'number', minimum: 0, maximum: 100, default: 0 },
          selectedPlatforms: { type: 'array', items: { type: 'string', enum: PLATFORMS } },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body   = networkAnalysisSchema.parse(req.body);
    const result = svc.analyseNetwork(body);
    sendSuccess(reply, result);
  });

  // Ping (latency measurement)
  fastify.get('/ping', {
    schema: {
      tags: ['Streams'],
      summary: 'Latency ping — measure RTT before network-check',
      security: [{ bearerAuth: [] }],
    },
  }, async (_req, reply) => {
    reply.send({ pong: true, serverTime: new Date().toISOString() });
  });

  // Upload speed test
  fastify.post('/network-upload-test', {
    schema: {
      tags: ['Streams'],
      summary: 'Upload speed test — POST a blob, measure elapsed time',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    reply.send({ received: true, bytes: req.headers['content-length'] ?? 0, serverTime: new Date().toISOString() });
  });
}
