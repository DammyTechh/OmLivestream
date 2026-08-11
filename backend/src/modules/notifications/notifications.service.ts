import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';
import { getIO } from '../../websocket/socket';
import { NotFoundError } from '../../utils/errors';

/**
 * In-app notifications.
 *
 * The bell in the dashboard header has shipped since the first release,
 * polling `GET /notifications` every sixty seconds. Nothing ever answered it:
 * there was no route and no table, so every poll 404'd into the component's
 * silent catch and the bell read "You're all caught up" forever. This module
 * is the other half.
 *
 * Delivery is Socket.io, not Web Push. The dashboard already holds an
 * authenticated socket open for viewer counts and comments, so pushing a
 * notification down it costs nothing extra and needs no VAPID keys, no
 * service worker, and no subscription table. The trade is that a user with
 * the tab closed sees the notification when they next open it rather than on
 * their lock screen — which is the right trade here, because everything that
 * genuinely needs to reach a closed tab (receipts, recording ready, trial
 * ending) already goes out by email.
 */

export type NotificationType = 'stream' | 'platform' | 'billing' | 'system' | 'ai' | 'promo';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Where clicking the notification should land. Relative to the app root. */
  link?: string | null;
}

/** How many rows the bell renders. It has no paging, so this is the whole list. */
const LIST_LIMIT = 30;

/** Per-user Socket.io room. Mirrors the `stream:` room naming in socket.ts. */
export const userRoom = (userId: string): string => `user:${userId}`;

export class NotificationsService {
  /**
   * Record a notification and push it to any socket the user has open.
   *
   * Deliberately never throws. Every call site is inside something the user
   * actually asked for — going live, a Paystack webhook, a finished
   * recording — and none of those should fail because a notification insert
   * did. A dropped notification is a cosmetic loss; a failed webhook means a
   * paid subscription that never activates.
   */
  async notify(input: NotifyInput): Promise<NotificationRow | null> {
    try {
      const row = {
        id:         uuidv4(),
        user_id:    input.userId,
        type:       input.type,
        title:      input.title,
        body:       input.body,
        link:       input.link ?? null,
        read_at:    null,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabaseAdmin.from('notifications').insert(row);
      if (error) throw error;

      const { user_id, ...payload } = row;
      // Fire-and-forget: getIO() is null in the worker process, which imports
      // these services but never calls initSocketIO.
      getIO()?.to(userRoom(input.userId)).emit('notification:new', payload);

      return payload as NotificationRow;
    } catch (err) {
      logger.warn({ err, userId: input.userId, type: input.type }, 'Notification not delivered');
      return null;
    }
  }

  /**
   * The bell's payload: newest notifications plus the unread badge count.
   *
   * The count is a separate `head: true` query rather than a filter over the
   * returned page. Counting only the rows in the page would under-report the
   * moment a user has more than LIST_LIMIT unread — the badge would say 30
   * while the list scrolled past it.
   */
  async list(userId: string): Promise<{ items: NotificationRow[]; unreadCount: number }> {
    const [listRes, countRes] = await Promise.all([
      supabaseAdmin
        .from('notifications')
        .select('id,type,title,body,link,read_at,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT),
      supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
    ]);

    if (listRes.error) throw listRes.error;

    return {
      items:       (listRes.data ?? []) as NotificationRow[],
      unreadCount: countRes.count ?? 0,
    };
  }

  /**
   * Mark one notification read.
   *
   * The user_id predicate is what stops one account marking another's rows
   * read — the id alone is a guessable-shaped uuid arriving from the client.
   */
  async markRead(userId: string, id: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('read_at', null)      // already-read is a no-op, not a second write
      .select('id');

    if (error) throw error;

    // Nothing updated means either it is not this user's row or it was
    // already read. Distinguishing the two would leak whether the id exists,
    // so verify ownership separately and stay quiet about the rest.
    if (!data?.length) {
      const { data: exists } = await supabaseAdmin
        .from('notifications').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
      if (!exists) throw new NotFoundError('Notification');
    }
  }

  /** Clear the badge. Returns how many rows it actually cleared. */
  async markAllRead(userId: string): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id');

    if (error) throw error;
    return data?.length ?? 0;
  }
}

/**
 * Shared instance.
 *
 * The service is stateless, and the trigger sites are scattered across the
 * stream, billing and recording paths — each constructing its own would be
 * noise.
 */
export const notifications = new NotificationsService();
