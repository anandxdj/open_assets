"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobResponse, JobStatus } from "@/types";
import { lookupJob } from "./jobsApi";

export type JobState =
  | { kind: "loading" }
  | { kind: "found"; job: JobResponse }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const LOADING: JobState = { kind: "loading" };
const CONCURRENCY = 4;
const POLL_MS = 8000;

/** Statuses the pipeline moves past on its own. "detected" waits for the user. */
const IN_FLIGHT: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "uploaded",
  "queued",
  "removing_bg",
  "detecting",
  "naming",
  "cropping",
  "cropped",
  "finalizing",
]);

export function isInFlight(status: JobStatus) {
  return IN_FLIGHT.has(status);
}

async function load(jobId: string): Promise<JobState> {
  try {
    const result = await lookupJob(jobId);
    return result.kind === "found" ? result : { kind: "expired" };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "Could not load the job" };
  }
}

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift() as T;
      await run(next);
    }
  });
  await Promise.all(workers);
}

/**
 * Loads the current server state of each job id once, then keeps polling the
 * ones still moving through the pipeline (slowly, and only while the tab is
 * visible) so the list settles without a reload.
 */
export function useJobStatuses(jobIds: string[]) {
  const [states, setStates] = useState<Record<string, JobState>>({});
  const requested = useRef(new Set<string>());
  const idsKey = jobIds.join(",");

  const fetchMany = useCallback((ids: string[]) => {
    ids.forEach((id) => requested.current.add(id));
    void eachLimited(ids, CONCURRENCY, async (id) => {
      const next = await load(id);
      setStates((prev) => ({ ...prev, [id]: next }));
    });
  }, []);

  // First load for ids we have not asked about yet.
  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    const missing = ids.filter((id) => !requested.current.has(id));
    if (missing.length) fetchMany(missing);
  }, [idsKey, fetchMany]);

  // Poll jobs that are still running.
  const activeKey = jobIds
    .filter((id) => {
      const state = states[id];
      return state?.kind === "found" && isInFlight(state.job.status);
    })
    .join(",");

  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split(",");
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void eachLimited(ids, CONCURRENCY, async (id) => {
        const next = await load(id);
        if (cancelled) return;
        // A failed poll keeps the last known state instead of flashing an error.
        setStates((prev) => (next.kind === "error" ? prev : { ...prev, [id]: next }));
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeKey]);

  const retry = useCallback(
    (id: string) => {
      setStates((prev) => ({ ...prev, [id]: LOADING }));
      fetchMany([id]);
    },
    [fetchMany]
  );

  const get = useCallback((id: string): JobState => states[id] ?? LOADING, [states]);

  return { get, retry };
}
