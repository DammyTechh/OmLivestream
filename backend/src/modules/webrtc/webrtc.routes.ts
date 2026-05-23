import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import {
  createWebRtcTransport,
  connectTransport,
  createProducer,
  getStreamStats,
} from './webrtc.service';

// ── Schemas ────────────────────────────────────────────────────────
const createTransportSchema = z.object({ streamId: z.string().uuid() });

const connectTransportSchema = z.object({
  transportId: z.string().min(1),
  dtlsParameters: z.object({
    role: z.enum(['auto', 'client', 'server']).optional(),
    fingerprints: z.array(z.object({ algorithm: z.string(), value: z.string() })),
  }),
});

const produceSchema = z.object({
  transportId: z.string().min(1),
  kind: z.enum(['video', 'audio']),
  rtpParameters: z.object({
    mid: z.string().optional(),
    codecs: z.array(z.any()),
    headerExtensions: z.array(z.any()).optional(),
    encodings: z.array(z.any()).optional(),
    rtcp: z.any().optional(),
  }),
});

// ── Routes ─────────────────────────────────────────────────────────
export async function webrtcRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /webrtc/create-transport
   * Creates a server-side WebRtcTransport for the browser to connect to.
   * Call once for the send direction before producing tracks.
   */
  fastify.post('/create-transport', {
    schema: {
      tags: ['WebRTC'],
      summary: 'Create WebRTC send transport',
      description: 'Creates a mediasoup WebRtcTransport. Returns ICE/DTLS params needed by mediasoup-client on the frontend.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['streamId'],
        properties: { streamId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { streamId } = createTransportSchema.parse(req.body);
    const params = await createWebRtcTransport(streamId);
    sendSuccess(reply, params);
  });

  /**
   * POST /webrtc/connect-transport
   * Finalises DTLS handshake between browser and server transport.
   * Call after device.load() and createSendTransport() on the frontend.
   */
  fastify.post('/connect-transport', {
    schema: {
      tags: ['WebRTC'],
      summary: 'Connect WebRTC transport (DTLS handshake)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['transportId', 'dtlsParameters'],
        properties: {
          transportId: { type: 'string' },
          dtlsParameters: { type: 'object' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { transportId, dtlsParameters } = connectTransportSchema.parse(req.body);
    await connectTransport(transportId, dtlsParameters as never);
    sendSuccess(reply, null, 'Transport connected');
  });

  /**
   * POST /webrtc/produce
   * Tells the server to start receiving a media track from the browser.
   * Call separately for video and audio tracks.
   * Returns producerId — store this and send to /streams/:id/start payload.
   */
  fastify.post('/produce', {
    schema: {
      tags: ['WebRTC'],
      summary: 'Start producing a media track (video or audio)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['transportId', 'kind', 'rtpParameters'],
        properties: {
          transportId: { type: 'string' },
          kind: { type: 'string', enum: ['video', 'audio'] },
          rtpParameters: { type: 'object' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { transportId, kind, rtpParameters } = produceSchema.parse(req.body);
    const result = await createProducer(transportId, kind, rtpParameters as never);
    sendSuccess(reply, result);
  });

  /**
   * GET /webrtc/stats/:streamId
   * Returns current mediasoup Router/Producer/Transport counts for a stream.
   */
  fastify.get('/stats/:streamId', {
    schema: {
      tags: ['WebRTC'],
      summary: 'Get mediasoup stats for a stream',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { streamId: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { streamId: string } }>, reply: FastifyReply) => {
    const stats = await getStreamStats(req.params.streamId);
    sendSuccess(reply, stats);
  });
}
