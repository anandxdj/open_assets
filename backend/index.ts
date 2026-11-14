import 'dotenv/config';
// Must stay second: validates the environment before any module reads it while loading.
import './src/common/config/env.bootstrap';
import mongoose from 'mongoose';
import { createApp } from './src/app';
import { getConfig } from './src/common/config/env';
import { connectDB } from './src/common/config/db';
import { redis } from './src/common/config/redis';
import { queues } from './src/common/config/bullmq';
import { createShutdown } from './src/common/lifecycle';
import { startDetectionWorker } from './src/modules/workers/detection.worker';
import { startCropWorker } from './src/modules/workers/crop.worker';
import { startFinalizeWorker } from './src/modules/workers/finalize.worker';
import { startEnhanceWorker } from './src/modules/workers/enhance.worker';

async function main() {
  const config = getConfig();

  const shutdown = createShutdown({
    timeoutMs: config.shutdownTimeoutMs,
    exit: (code) => process.exit(code),
  });

  await connectDB();
  await redis.ping();
  console.log('[Redis] Ping OK');

  const workers = [startDetectionWorker(), startCropWorker(), startFinalizeWorker(), startEnhanceWorker()];

  const app = createApp({ isShuttingDown: shutdown.isShuttingDown });
  const server = app.listen(config.port, () => {
    console.log(`[Server] Running on :${config.port} (${config.nodeEnv})`);
  });
  // Reverse proxies (Traefik, nginx) keep upstream connections open longer than
  // Node's 5s default, which otherwise shows up as sporadic 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Order matters: stop taking requests, let running jobs finish, then close what they use.
  shutdown.register('http server', () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    }),
  );
  shutdown.register('workers', () => Promise.all(workers.map((worker) => worker.close())));
  shutdown.register('queues', () => Promise.all(queues.map((queue) => queue.close())));
  shutdown.register('redis', () => redis.quit());
  shutdown.register('mongo', () => mongoose.disconnect());

  process.once('SIGTERM', () => void shutdown.run('SIGTERM'));
  process.once('SIGINT', () => void shutdown.run('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled rejection:', reason);
    void shutdown.run('unhandled rejection', 1);
  });
  process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught exception:', error);
    void shutdown.run('uncaught exception', 1);
  });
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
