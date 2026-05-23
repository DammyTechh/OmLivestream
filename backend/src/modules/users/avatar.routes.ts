import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { AppError, ValidationError } from '../../utils/errors';
import { supabaseAdmin } from '../../config/supabase';

interface AvatarBody { dataUrl: string; }

export async function avatarRoutes(fastify: FastifyInstance): Promise<void> {
  // Use authenticate as preHandler (no nested register — simpler & more reliable)
  fastify.post<{ Body: AvatarBody }>('/me/avatar', {
    preHandler: [authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Upload profile avatar (base64 data URL)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['dataUrl'],
        properties: {
          dataUrl: { type: 'string', minLength: 30 },
        },
      },
    },
  }, async (req: FastifyRequest<{ Body: AvatarBody }>, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { dataUrl } = req.body;

    req.log.info({ userId: u.id, dataUrlLength: dataUrl?.length }, 'Avatar upload request');

    const match = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) {
      throw new ValidationError('Please upload a PNG, JPEG or WebP image.');
    }

    const mimeType = match[1];
    const ext      = match[2] === 'jpg' ? 'jpg' : match[2];
    const base64   = match[3];
    const buffer   = Buffer.from(base64, 'base64');

    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new ValidationError('Image is too large — please keep it under 5 MB.');
    }

    const filename = `${u.id}/avatar_${Date.now()}.${ext}`;
    const { data: upload, error: uploadErr } = await supabaseAdmin
      .storage.from('avatars')
      .upload(filename, buffer, { contentType: mimeType, upsert: true });

    if (uploadErr || !upload) {
      req.log.error({ uploadErr }, 'Avatar upload to Supabase failed');
      const m = (uploadErr?.message || '').toLowerCase();
      if (m.includes('bucket') || m.includes('not found')) {
        throw new AppError(
          'Avatar storage is not set up. Run setup_avatar_bucket.sql in your Supabase SQL editor.',
          500,
        );
      }
      if (m.includes('policy') || m.includes('rls')) {
        throw new AppError(
          'Avatar storage permissions are not set up. Run setup_avatar_bucket.sql.',
          500,
        );
      }
      throw new AppError(`Could not upload your photo: ${uploadErr?.message || 'unknown error'}`, 500);
    }

    const { data: pub } = supabaseAdmin.storage.from('avatars').getPublicUrl(upload.path);

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({ avatar_url: pub.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', u.id);

    if (updateErr) {
      req.log.error({ updateErr }, 'Could not save avatar URL to user record');
      throw new AppError(`Photo uploaded but profile not updated: ${updateErr.message}`, 500);
    }

    sendSuccess(reply, { avatar_url: pub.publicUrl }, 'Profile picture updated');
  });
}
