import { Queue } from 'bullmq';
import { redis } from './redis';
import { AniBuddyConstants } from '../../modules/anibuddy/anibuddy.constants';

export const detectionQueue = new Queue('detection', { connection: redis });
export const cropQueue = new Queue('crop', { connection: redis });
export const finalizeQueue = new Queue('finalize', { connection: redis });

export const anibuddyDecomposeQueue = new Queue(AniBuddyConstants.queueByStage.decompose, {
  connection: redis,
});
export const anibuddyRigQueue = new Queue(AniBuddyConstants.queueByStage.rig, {
  connection: redis,
});
export const anibuddyAnimateQueue = new Queue(AniBuddyConstants.queueByStage.animate, {
  connection: redis,
});
export const anibuddyRenderQueue = new Queue(AniBuddyConstants.queueByStage.render, {
  connection: redis,
});
/**
 * The closed critique loop's own queue.
 *
 * Not derived from `queueByStage` because critique is not a queued STAGE: one job is
 * a bounded loop over render and vision passes with its own billing and its own
 * three stop conditions, driven by `AniBuddyCritiqueService` rather than by
 * `processStageJob`. The name still comes from the constants table.
 */
export const anibuddyCritiqueQueue = new Queue(AniBuddyConstants.critique.queueName, {
  connection: redis,
});

detectionQueue.on('error', (err) => console.error('[Queue] detection error:', err));
cropQueue.on('error', (err) => console.error('[Queue] crop error:', err));
finalizeQueue.on('error', (err) => console.error('[Queue] finalize error:', err));
anibuddyDecomposeQueue.on('error', (err) => console.error('[Queue] anibuddy-decompose error:', err));
anibuddyRigQueue.on('error', (err) => console.error('[Queue] anibuddy-rig error:', err));
anibuddyAnimateQueue.on('error', (err) => console.error('[Queue] anibuddy-animate error:', err));
anibuddyRenderQueue.on('error', (err) => console.error('[Queue] anibuddy-render error:', err));
anibuddyCritiqueQueue.on('error', (err) => console.error('[Queue] anibuddy-critique error:', err));
