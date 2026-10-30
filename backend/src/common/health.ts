import type { Request, Response } from 'express';

/**
 * `GET /health`: reports whether this instance can do its job.
 *
 * 200 `{ status: "ok" }` when every dependency answers, 503 otherwise
 * (`degraded` when a dependency is down, `shutting_down` while draining so load
 * balancers stop routing here). Only fixed words are returned, never error
 * messages, because the endpoint is public.
 *
 * Dependencies are injected so this file has no connections of its own and can
 * be tested without Mongo or Redis.
 */

export interface HealthCheck {
  name: string;
  /** Resolves when the dependency is healthy, rejects (or never settles) when it is not. */
  run: () => Promise<unknown>;
}

export type CheckState = { status: 'up' | 'down'; latencyMs: number };

export interface HealthReport {
  status: 'ok' | 'degraded' | 'shutting_down';
  uptimeSeconds: number;
  checks: Record<string, CheckState>;
}

export interface HealthOptions {
  checks: HealthCheck[];
  /** Give up on a check after this long. Redis and Mongo clients otherwise queue commands while down. */
  timeoutMs?: number;
  isShuttingDown?: () => boolean;
  /** Called with the check name and the failure for every failed check (the failure never reaches the response). */
  onFailure?: (check: string, error: unknown) => void;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function runHealthChecks(options: HealthOptions): Promise<HealthReport> {
  const { checks, timeoutMs = DEFAULT_TIMEOUT_MS, isShuttingDown, onFailure, now = Date.now } = options;

  const entries = await Promise.all(
    checks.map(async (check): Promise<[string, CheckState]> => {
      const started = now();
      try {
        await withTimeout(Promise.resolve().then(check.run), timeoutMs);
        return [check.name, { status: 'up', latencyMs: now() - started }];
      } catch (error) {
        onFailure?.(check.name, error);
        return [check.name, { status: 'down', latencyMs: now() - started }];
      }
    }),
  );

  const results = Object.fromEntries(entries);
  const allUp = entries.every(([, state]) => state.status === 'up');
  const status = isShuttingDown?.() ? 'shutting_down' : allUp ? 'ok' : 'degraded';

  return { status, uptimeSeconds: Math.round(process.uptime()), checks: results };
}

export function createHealthHandler(options: HealthOptions) {
  // Log when a dependency goes down, not on every poll while it stays down.
  const last = new Map<string, 'up' | 'down'>();
  const onFailure: NonNullable<HealthOptions['onFailure']> =
    options.onFailure ??
    ((check, error) => {
      if (last.get(check) !== 'down') {
        console.warn(`[Health] ${check} check failed:`, error instanceof Error ? error.message : error);
      }
    });

  return async (_req: Request, res: Response): Promise<void> => {
    const report = await runHealthChecks({ ...options, onFailure });
    for (const [name, state] of Object.entries(report.checks)) last.set(name, state.status);
    res.setHeader('Cache-Control', 'no-store');
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  };
}
