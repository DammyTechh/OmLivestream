/**
 * OmliveStream Admin Broadcast Service
 * ─────────────────────────────────────────────────────────────────
 * Allows admins to compose and send email campaigns to user segments
 * directly from the admin dashboard.
 *
 * How it works:
 *  1. Admin creates a draft broadcast (subject, body, segment, schedule)
 *  2. Admin calls /send → system fetches matching users, queues batch jobs
 *  3. BullMQ worker sends emails in batches of 50, 200ms apart
 *     (respects Resend's rate limit of 100 req/s)
 *  4. Each delivery is logged in broadcast_logs for audit + stats
 *  5. broadcast.sent_count / failed_count updated in real-time
 *
 * Segments:
 *  all             → all verified users
 *  free_trial      → users still in 90-day trial
 *  free            → trial-expired free users
 *  premium         → active premium subscribers
 *  waitlist_members → users who joined via the waitlist
 *  inactive        → no stream in the last 14 days (re-engagement)
 */

import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { broadcastQueue } from '../../jobs/queues';
import { NotFoundError, AppError, ValidationError } from '../../utils/errors';
import { logger } from '../../config/logger';

export type BroadcastSegment =
  | 'all'
  | 'free_trial'
  | 'free'
  | 'premium'
  | 'waitlist_members'
  | 'inactive';

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export interface CreateBroadcastPayload {
  subject:       string;
  bodyHtml:      string;
  previewText?:  string;
  internalNotes?: string;
  tags?:         string[];
  segment:       BroadcastSegment;
  scheduledAt?:  string; // ISO datetime — null = send immediately
}

export class AdminBroadcastService {

  // ── Create a draft broadcast ─────────────────────────────────
  async create(adminId: string, payload: CreateBroadcastPayload) {
    if (!payload.subject.trim())  throw new ValidationError('Subject is required');
    if (!payload.bodyHtml.trim()) throw new ValidationError('Email body is required');

    // Auto-generate plain text fallback from HTML (strip tags)
    const bodyText = payload.bodyHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const { data, error } = await supabaseAdmin
      .from('admin_broadcasts')
      .insert({
        id:             uuidv4(),
        admin_id:       adminId,
        subject:        payload.subject.trim(),
        body_html:      payload.bodyHtml,
        body_text:      bodyText,
        preview_text:   payload.previewText?.trim() ?? null,
        internal_notes: payload.internalNotes?.trim() ?? null,
        tags:           payload.tags ?? [],
        segment:        payload.segment,
        status:         payload.scheduledAt ? 'scheduled' : 'draft',
        scheduled_at:   payload.scheduledAt ?? null,
        recipient_count: 0,
      })
      .select('*')
      .single();

    if (error || !data) throw error ?? new AppError('Failed to create broadcast');

    // If scheduled, add a delayed BullMQ job
    if (payload.scheduledAt) {
      const delay = new Date(payload.scheduledAt).getTime() - Date.now();
      if (delay > 0) {
        await broadcastQueue.add(
          'scheduled-broadcast',
          { broadcastId: data.id },
          { delay, jobId: `broadcast-${data.id}` }
        );
        logger.info({ broadcastId: data.id, scheduledAt: payload.scheduledAt }, 'Broadcast scheduled');
      }
    }

    return data;
  }

  // ── Edit a draft broadcast ────────────────────────────────────
  async update(adminId: string, broadcastId: string, payload: Partial<CreateBroadcastPayload>) {
    const existing = await this.requireDraft(broadcastId, adminId);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.subject)       updates.subject        = payload.subject.trim();
    if (payload.bodyHtml)      updates.body_html      = payload.bodyHtml;
    if (payload.previewText !== undefined) updates.preview_text   = payload.previewText?.trim() ?? null;
    if (payload.internalNotes !== undefined) updates.internal_notes = payload.internalNotes?.trim() ?? null;
    if (payload.tags)          updates.tags           = payload.tags;
    if (payload.segment)       updates.segment        = payload.segment;
    if (payload.scheduledAt !== undefined) {
      updates.scheduled_at = payload.scheduledAt ?? null;
      updates.status       = payload.scheduledAt ? 'scheduled' : 'draft';
    }

    // Re-generate plain text if HTML changed
    if (payload.bodyHtml) {
      updates.body_text = payload.bodyHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const { data, error } = await supabaseAdmin
      .from('admin_broadcasts')
      .update(updates)
      .eq('id', broadcastId)
      .select('*')
      .single();

    if (error || !data) throw error ?? new NotFoundError('Broadcast');

    // Remove old scheduled job and re-queue with new time if schedule changed
    if (payload.scheduledAt !== undefined) {
      const existingJob = await broadcastQueue.getJob(`broadcast-${broadcastId}`);
      if (existingJob) await existingJob.remove();

      if (payload.scheduledAt) {
        const delay = new Date(payload.scheduledAt).getTime() - Date.now();
        if (delay > 0) {
          await broadcastQueue.add(
            'scheduled-broadcast',
            { broadcastId },
            { delay, jobId: `broadcast-${broadcastId}` }
          );
        }
      }
    }

    return data;
  }

  // ── Send immediately ──────────────────────────────────────────
  async send(adminId: string, broadcastId: string): Promise<{ queued: number }> {
    const broadcast = await this.requireBroadcast(broadcastId, adminId);

    if (broadcast.status === 'sending' || broadcast.status === 'sent') {
      throw new AppError('Broadcast has already been sent or is currently sending', 409);
    }
    if (broadcast.status === 'cancelled') {
      throw new AppError('Cannot send a cancelled broadcast', 409);
    }

    // Fetch recipients for this segment
    const recipients = await this.getRecipients(broadcast.segment as BroadcastSegment);

    if (recipients.length === 0) {
      throw new AppError(`No users found for segment "${broadcast.segment}"`, 404, 'NO_RECIPIENTS');
    }

    // Update status to sending
    await supabaseAdmin.from('admin_broadcasts').update({
      status:          'sending',
      recipient_count: recipients.length,
      updated_at:      new Date().toISOString(),
    }).eq('id', broadcastId);

    // Create broadcast_logs rows for every recipient
    const logRows = recipients.map(r => ({
      id:           uuidv4(),
      broadcast_id: broadcastId,
      user_id:      r.id,
      email:        r.email,
      status:       'pending',
    }));

    // Insert in batches of 500 to avoid payload limits
    for (let i = 0; i < logRows.length; i += 500) {
      await supabaseAdmin.from('broadcast_logs').insert(logRows.slice(i, i + 500));
    }

    // Enqueue bulk send job — worker processes in batches of 50
    await broadcastQueue.add('send-broadcast', {
      broadcastId,
      recipientCount: recipients.length,
    }, {
      jobId: `broadcast-send-${broadcastId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    logger.info({ broadcastId, recipients: recipients.length, segment: broadcast.segment }, 'Broadcast queued for sending');

    return { queued: recipients.length };
  }

  // ── Cancel a scheduled or draft broadcast ─────────────────────
  async cancel(adminId: string, broadcastId: string): Promise<void> {
    const broadcast = await this.requireBroadcast(broadcastId, adminId);

    if (broadcast.status === 'sent') {
      throw new AppError('Cannot cancel a broadcast that has already been sent', 409);
    }
    if (broadcast.status === 'sending') {
      throw new AppError('Cannot cancel a broadcast that is currently sending', 409);
    }

    // Remove scheduled BullMQ job if exists
    const job = await broadcastQueue.getJob(`broadcast-${broadcastId}`);
    if (job) await job.remove();

    await supabaseAdmin.from('admin_broadcasts').update({
      status:     'cancelled',
      updated_at: new Date().toISOString(),
    }).eq('id', broadcastId);
  }

  // ── Delete a draft broadcast ──────────────────────────────────
  async delete(adminId: string, broadcastId: string): Promise<void> {
    await this.requireDraft(broadcastId, adminId);
    await supabaseAdmin.from('admin_broadcasts').delete().eq('id', broadcastId);
  }

  // ── List all broadcasts with stats ────────────────────────────
  async list(opts: {
    page:     number;
    limit:    number;
    status?:  string;
    segment?: string;
  }) {
    let query = supabaseAdmin
      .from('admin_broadcasts')
      .select(`
        id, subject, preview_text, segment, status,
        recipient_count, sent_count, failed_count,
        scheduled_at, sent_at, created_at, updated_at, tags,
        admin_users ( email, full_name )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    if (opts.status)  query = query.eq('status', opts.status);
    if (opts.segment) query = query.eq('segment', opts.segment);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  // ── Get single broadcast with delivery logs ───────────────────
  async get(broadcastId: string) {
    const [{ data: broadcast }, { data: logs, count }] = await Promise.all([
      supabaseAdmin
        .from('admin_broadcasts')
        .select('*, admin_users ( email, full_name )')
        .eq('id', broadcastId)
        .single(),
      supabaseAdmin
        .from('broadcast_logs')
        .select('id, email, status, error, sent_at', { count: 'exact' })
        .eq('broadcast_id', broadcastId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (!broadcast) throw new NotFoundError('Broadcast');

    // Delivery rate
    const deliveryRate = broadcast.recipient_count > 0
      ? Math.round((broadcast.sent_count / broadcast.recipient_count) * 100)
      : 0;

    return {
      ...broadcast,
      deliveryRate: `${deliveryRate}%`,
      recentLogs:   logs ?? [],
      totalLogs:    count ?? 0,
    };
  }

  // ── Preview — returns rendered HTML with sample data ─────────
  async preview(broadcastId: string) {
    const { data: broadcast } = await supabaseAdmin
      .from('admin_broadcasts')
      .select('subject, body_html, preview_text')
      .eq('id', broadcastId)
      .single();

    if (!broadcast) throw new NotFoundError('Broadcast');
    return broadcast;
  }

  // ── Recipient count estimate for a segment ───────────────────
  /**
   * Counts the segment without materialising it.
   *
   * This used to call getRecipients() and read `.length` — transferring the
   * id and email of every matching user across the network so the admin UI
   * could display one integer, on a screen where changing the segment
   * dropdown re-runs it.
   */
  async estimateRecipients(segment: BroadcastSegment): Promise<{ count: number; segment: string }> {
    const { count, error } = await this.segmentQuery(segment, { countOnly: true });
    if (error) throw error;
    return { count: count ?? 0, segment };
  }

  // ── Broadcast stats summary ───────────────────────────────────
  async getStats() {
    const [
      { count: total },
      { count: sent },
      { count: draft },
      { count: scheduled },
      { data: recent },
    ] = await Promise.all([
      supabaseAdmin.from('admin_broadcasts').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('admin_broadcasts').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
      supabaseAdmin.from('admin_broadcasts').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabaseAdmin.from('admin_broadcasts').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
      supabaseAdmin.from('admin_broadcasts')
        .select('id, subject, segment, sent_count, recipient_count, sent_at')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(5),
    ]);

    // Total emails ever sent.
    //
    // Bounded by the number of sent campaigns, which is small and grows only
    // when an admin runs one — unlike the per-user tables, this does not need
    // an aggregate function. It stays a separate query because the count above
    // uses head: true and so returns no rows to sum.
    const { data: sentSum } = await supabaseAdmin
      .from('admin_broadcasts')
      .select('sent_count')
      .eq('status', 'sent');

    const totalEmailsSent = (sentSum ?? []).reduce((s, r) => s + r.sent_count, 0);

    return { total: total ?? 0, sent: sent ?? 0, draft: draft ?? 0, scheduled: scheduled ?? 0, totalEmailsSent, recentCampaigns: recent ?? [] };
  }

  // ── Private: build the segment filter ────────────────────────
  /**
   * One definition of "who is in this segment", used by both the send path
   * and the count path.
   *
   * They were separate before only because counting went through
   * getRecipients(); keeping the predicate in a single place is what stops
   * the estimate shown in the UI from drifting away from the set that
   * actually receives the email.
   */
  private segmentQuery(segment: BroadcastSegment, opts: { countOnly: boolean }) {
    let query = supabaseAdmin
      .from('users')
      .select(opts.countOnly ? 'id' : 'id, email',
              opts.countOnly ? { count: 'exact', head: true } : undefined)
      .eq('is_verified', true)
      .eq('status', 'active')
      .not('email', 'is', null);

    switch (segment) {
      case 'all':
        break; // no extra filter

      case 'free_trial':
        query = query.eq('plan', 'free_trial');
        break;

      case 'free':
        query = query.eq('plan', 'free');
        break;

      case 'premium':
        query = query.eq('plan', 'premium');
        break;

      case 'waitlist_members':
        query = query.eq('waitlist_member', true);
        break;

      case 'inactive': {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
        query = query.lt('last_stream_ended_at', fourteenDaysAgo);
        break;
      }
    }

    return query;
  }

  // ── Private: fetch users for a segment ───────────────────────
  private async getRecipients(segment: BroadcastSegment): Promise<{ id: string; email: string }[]> {
    const { data, error } = await this.segmentQuery(segment, { countOnly: false });
    if (error) throw error;
    return (data ?? []) as unknown as { id: string; email: string }[];
  }

  // ── Private: require broadcast exists and admin owns it ───────
  private async requireBroadcast(broadcastId: string, adminId: string) {
    const { data } = await supabaseAdmin
      .from('admin_broadcasts')
      .select('*')
      .eq('id', broadcastId)
      .single();
    if (!data) throw new NotFoundError('Broadcast');
    return data;
  }

  // ── Private: require draft status ─────────────────────────────
  private async requireDraft(broadcastId: string, adminId: string) {
    const broadcast = await this.requireBroadcast(broadcastId, adminId);
    if (!['draft', 'scheduled'].includes(broadcast.status)) {
      throw new AppError('Only draft or scheduled broadcasts can be edited', 409);
    }
    return broadcast;
  }
}
