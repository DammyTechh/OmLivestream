import http from 'http';
import { buildApp }          from './app';
import { env }               from './config/env';
import { logger }            from './config/logger';
import { initWorkers }       from './modules/webrtc/webrtc.service';
import { stopAllBroadcasts } from './modules/webrtc/broadcast.service';
import { initSocketIO, closeSocketAdapter } from './websocket/socket';
import { commentIngestion }  from './websocket/comment-ingestion.service';
import { flushAllComments }  from './modules/streams/comment-buffer';
import { startCronJobs }     from './jobs/crons';

async function main(): Promise<void> {
  logger.info('Starting OmliveStream backend');

  // Redis connects automatically on import — no manual .connect() needed
  logger.info('Redis ready');

  // Build Fastify app
  const app = await buildApp();

  // Wrap in raw http.Server so Socket.io can share it
  const httpServer = http.createServer(app.server);

  // Attach Socket.io
  initSocketIO(httpServer);
  logger.info('Socket.io ready');

  // Spin up mediasoup Workers (one per CPU core, max 4)
  await initWorkers();
  logger.info('mediasoup workers ready');

  // Start cron jobs
  startCronJobs();
  logger.info('Cron jobs scheduled');

  // Start listening
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`OmliveStream API  ->  http://${env.HOST}:${env.PORT}`);
  logger.info(`Swagger docs      ->  ${env.API_BASE_URL}/docs`);
  logger.info(`Health check      ->  ${env.API_BASE_URL}/health`);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    // A second Ctrl-C must not re-enter and SIGKILL ffmpeg mid-flush.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down gracefully');

    // Stop the RTMP pushes first. This sends an end-of-stream to every
    // platform so they mark the broadcast as ended rather than showing it
    // as live-but-frozen until their own timeout fires (up to 2 minutes on
    // YouTube). Everything else can wait those few seconds.
    await stopAllBroadcasts().catch((err) =>
      logger.error({ err }, 'Error stopping broadcasts during shutdown')
    );

    // Clear the chat pollers' timers so nothing keeps the event loop alive
    // and no in-flight poll resolves against a closing process.
    commentIngestion.stopAll();

    // Then write out whatever they had buffered. Order matters: stopping the
    // pollers first means nothing can arrive after the flush and be lost.
    await flushAllComments().catch((err) =>
      logger.error({ err }, 'Error flushing buffered comments during shutdown')
    );

    await app.close();

    // After app.close(), so the adapter is still able to fan out the
    // disconnect-driven viewer-count updates the closing sockets trigger.
    // redis REST client itself has no quit() — those connections are
    // stateless HTTP — but the adapter's TCP pair does.
    await closeSocketAdapter().catch((err) =>
      logger.error({ err }, 'Error closing Socket.io Redis adapter')
    );

    logger.info('Server shut down cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT');  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection — exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});