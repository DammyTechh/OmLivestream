import { Queue } from 'bullmq';
import { createBullConnection, BULLMQ_ENABLED } from '../config/redis';

// Only create actual queues if BullMQ is enabled (UPSTASH_REDIS_URL is set)
// Otherwise export no-op stubs that silently accept .add() calls
type MaybeQueue = Queue | { add: (...args: unknown[]) => Promise<null>; getJob: () => Promise<null> };

function makeQueue(name: string): MaybeQueue {
  if (!BULLMQ_ENABLED) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`⚠️  BullMQ queue '${name}' disabled (UPSTASH_REDIS_URL not set — local dev)`);
    }
    // No-op stub — .add() silently returns null, no errors
    return {
      add:    async () => null,
      getJob: async () => null,
    };
  }

  const conn = createBullConnection();
  const queue = new Queue(name, { connection: conn! });
  queue.on('error', () => {}); // suppress connection errors
  return queue;
}

export const videoEditQueue    = makeQueue('video-edit');
export const videoPublishQueue = makeQueue('video-publish');
export const broadcastQueue    = makeQueue('broadcast-email');