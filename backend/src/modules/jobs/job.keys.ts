/**
 * Redis key names for extraction jobs. Kept apart from job.store so code that
 * only needs a key (account deletion) does not import the shared Redis client.
 */

export function jobKey(jobId: string): string {
  return `job:${jobId}`;
}

/** Sorted set of a user's job ids (member = job id, score = creation time in ms). */
export function userJobsKey(userId: string): string {
  return `user:${userId}:jobs`;
}
