import { Queue } from 'bullmq';
import { redis } from './redis';

export const detectionQueue = new Queue('detection', { connection: redis });
export const cropQueue = new Queue('crop', { connection: redis });
export const finalizeQueue = new Queue('finalize', { connection: redis });
export const enhanceQueue = new Queue('enhance', { connection: redis });

detectionQueue.on('error', (err) => console.error('[Queue] detection error:', err));
cropQueue.on('error', (err) => console.error('[Queue] crop error:', err));
finalizeQueue.on('error', (err) => console.error('[Queue] finalize error:', err));
enhanceQueue.on('error', (err) => console.error('[Queue] enhance error:', err));
