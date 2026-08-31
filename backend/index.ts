import 'dotenv/config';
import { createApp } from './src/app';
import { connectDB } from './src/common/config/db';
import { redis } from './src/common/config/redis';
import { startDetectionWorker } from './src/modules/workers/detection.worker';
import { startCropWorker } from './src/modules/workers/crop.worker';
import { startFinalizeWorker } from './src/modules/workers/finalize.worker';
import { startAniBuddyWorkers } from './src/modules/workers/anibuddy.worker';

async function main() {
  await connectDB();
  await redis.ping();
  console.log('[Redis] Ping OK');

  startDetectionWorker();
  startCropWorker();
  startFinalizeWorker();
  startAniBuddyWorkers();

  const app = createApp();
  const port = process.env.PORT ?? 4000;
  app.listen(port, () => {
    console.log(`[Server] Running on :${port}`);
  });
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
