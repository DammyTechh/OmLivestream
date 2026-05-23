import http from 'http';
import { buildApp }         from './app';
import { env }              from './config/env';
import { logger }           from './config/logger';
import { redis }            from './config/redis';
import { initWorkers }      from './modules/webrtc/webrtc.service';
import { initSocketIO }     from './websocket/socket';
import { startCronJobs }    from './jobs/crons';

async function main(): Promise<void> {
  logger.info('Starting OmliveStream backend…');

  // Redis connects automatically on import — no manual .connect() needed
  logger.info('✅ Redis ready');

  // Build Fastify app
  const app = await buildApp();

  // Wrap in raw http.Server so Socket.io can share it
  const httpServer = http.createServer(app.server);

  // Attach Socket.io
  initSocketIO(httpServer);
  logger.info('✅ Socket.io ready');

  // Spin up mediasoup Workers (one per CPU core, max 4)
  await initWorkers();
  logger.info('✅ mediasoup workers ready');

  // Start cron jobs
  startCronJobs();
  logger.info('✅ Cron jobs scheduled');

  // Start listening
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`🚀 OmliveStream API  →  http://${env.HOST}:${env.PORT}`);
  logger.info(`📖 Swagger docs      →  http://localhost:${env.PORT}/api/docs`);
  logger.info(`❤️  Health check      →  http://localhost:${env.PORT}/health`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully…');
    await app.close();
    // redis REST client has no quit() — connections are stateless HTTP
    logger.info('Server shut down cleanly. Goodbye.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

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
