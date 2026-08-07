import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StreamsService } from './streams.service';
import { getBroadcastStatus } from '../webrtc/broadcast.service';
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

const replySchema = z.object({
  platform:  z.enum(PLATFORMS),
  commentId: z.string().min(1),
  text:      z.string().min(1).max(1000),
});

export async function streamsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * Binary body parser for the upload speed test.
   *
   * The measurement lives here rather than in the handler because this is
   * the only place with a reference to the body stream before anything
   * else touches it. Handing the stream through untouched and reading it
   * in the handler races with Fastify's own lifecycle.
   *
   * Nothing is buffered — we count bytes as they arrive and discard them,
   * so a 16 MB test costs no memory.
   */
  fastify.addContentTypeParser(
    'application/octet-stream',
    (_req, payload, done) => {
      const started = process.hrtime.bigint();
      let firstByteAt: bigint | null = null;
      let bytes = 0;

      payload.on('data', (chunk: Buffer) => {
        if (firstByteAt === null) firstByteAt = process.hrtime.bigint();
        bytes += chunk.length;
      });
      payload.on('end', () => {
        const finished = process.hrtime.bigint();
        // Measure from the first byte, not from request start: the gap
        // before it is handshake and header time, not throughput.
        const transferNs = Number(finished - (firstByteAt ?? started));
        done(null, { bytes, transferNs });
      });
      payload.on('error', (err: Error) => done(err, undefined));
    }
  );

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

  /**
   * Upload speed test.
   *
   * The client POSTs a binary blob and we report how long the body
   * actually took to arrive, measured server-side from first byte to last.
   * Client-side timing around fetch() includes DNS, TLS and TCP handshake,
   * which on a fresh connection is easily 200ms and would make a 1 MB
   * upload look several times slower than it is.
   *
   * bytesReceived is counted, not read from Content-Length, because that
   * header is client-declared and trivially wrong.
   *
   * Client should send Content-Type: application/octet-stream so Fastify
   * does not attempt to parse the body as JSON.
   */
  fastify.post('/network-upload-test', {
    // 24 MB ceiling: enough for a 4 s test on a 40 Mbps uplink, small
    // enough that it cannot be used to tie up the box.
    bodyLimit: 24 * 1024 * 1024,
    schema: {
      tags: ['Streams'],
      summary: 'Upload speed test — POST a binary blob, get server-measured receive time',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { bytes, transferNs } = req.body as { bytes: number; transferNs: number };
    const seconds = transferNs / 1e9;

    reply.send({
      received:      true,
      bytesReceived: bytes,
      transferMs:    Math.round(transferNs / 1e6),
      // Only meaningful for a large enough payload over a long enough
      // window; the client discards samples below its own thresholds.
      mbps:          seconds > 0 ? +((bytes * 8) / seconds / 1e6).toFixed(3) : 0,
      serverTime:    new Date().toISOString(),
    });
  });

  /**
   * Begin pushing to platforms.
   *
   * Separate from /start because mediasoup has nothing to forward until
   * the browser has produced its tracks. Call this after produce().
   */
  fastify.post('/:id/broadcast', {
    schema: {
      tags: ['Streams'],
      summary: 'Begin RTMP push to all connected platforms',
      description:
        'Call after the browser has created its send transport and produced ' +
        'video (and optionally audio). Starts the RTP→RTMP bridge.',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    const result = await svc.beginBroadcast(u.id, req.params.id);
    sendSuccess(reply, result, `Broadcasting to ${result.platforms} platform(s)`);
  });

  /** Live bridge status — is ffmpeg up, how many restarts. */
  fastify.get('/:id/broadcast', {
    schema: {
      tags: ['Streams'],
      summary: 'Get RTMP bridge status for a stream',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    sendSuccess(reply, getBroadcastStatus(req.params.id));
  });

  /**
   * Reply to a live comment, posted back to the source platform.
   *
   * This route did not exist — the frontend was POSTing here and getting
   * a 404 on every reply attempt.
   */
  fastify.post('/:id/comments/reply', {
    schema: {
      tags: ['Streams'],
      summary: 'Reply to a live comment on its source platform',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['platform', 'commentId', 'text'],
        properties: {
          platform:  { type: 'string', enum: PLATFORMS },
          commentId: { type: 'string', minLength: 1 },
          text:      { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const body = replySchema.parse(req.body);
    const u    = getAuthUser(req);
    const result = await svc.replyToComment(u.id, req.params.id, body);
    sendSuccess(reply, result, 'Reply sent');
  });

  /**
   * Comment backfill. The socket only delivers comments that arrive while
   * it is connected, so a client that joins late or reconnects mid-stream
   * needs this to fill the gap.
   */
  fastify.get('/:id/comments', {
    schema: {
      tags: ['Streams'],
      summary: 'Recent live comments for a stream',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 300, default: 100 } },
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await svc.listComments(u.id, req.params.id, req.query.limit ?? 100));
  });
}
