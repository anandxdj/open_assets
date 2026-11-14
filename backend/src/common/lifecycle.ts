/**
 * Graceful shutdown.
 *
 * Resources register a closer in the order they must stop (stop taking
 * requests, let workers finish, then close queues and connections). On SIGTERM
 * or SIGINT the closers run one after another. A closer that fails or hangs is
 * logged and skipped so the rest still run, and the whole sequence is capped so
 * the process always exits before the container manager sends SIGKILL.
 */

export interface Closer {
  name: string;
  close: () => Promise<unknown> | unknown;
}

export interface ShutdownOptions {
  /** Total budget for all closers. Keep it below the platform's stop timeout (Docker: 10s by default, raised in compose). */
  timeoutMs: number;
  log?: (message: string) => void;
  /** Called once with the exit code when shutdown finishes or the budget runs out. */
  exit: (code: number) => void;
}

export interface Shutdown {
  register: (name: string, close: Closer['close']) => void;
  /** Run every closer once. Later calls return the same promise. */
  run: (reason: string, exitCode?: number) => Promise<void>;
  isShuttingDown: () => boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish in time`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createShutdown(options: ShutdownOptions): Shutdown {
  const { timeoutMs, exit } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  const closers: Closer[] = [];
  let running: Promise<void> | undefined;

  const run = (reason: string, exitCode = 0): Promise<void> => {
    if (running) return running;

    running = (async () => {
      log(`[Shutdown] ${reason}: stopping`);
      const deadline = Date.now() + timeoutMs;
      let code = exitCode;

      // Backstop: if something ignores its own timeout, still leave in time.
      const hardStop = setTimeout(() => {
        log('[Shutdown] time budget exhausted, exiting now');
        exit(1);
      }, timeoutMs + 500);
      hardStop.unref?.();

      for (const closer of closers) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          log(`[Shutdown] skipped ${closer.name}: no time left`);
          code = code || 1;
          continue;
        }
        try {
          await withTimeout(Promise.resolve().then(closer.close), remaining, closer.name);
          log(`[Shutdown] closed ${closer.name}`);
        } catch (error) {
          code = code || 1;
          log(`[Shutdown] ${closer.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      clearTimeout(hardStop);
      exit(code);
    })();

    return running;
  };

  return {
    register: (name, close) => {
      closers.push({ name, close });
    },
    run,
    isShuttingDown: () => running !== undefined,
  };
}
