"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobStatus, JobSummary } from "@/types";
import { clearJobHistory, JOB_LIST_MAX, listJobs, removeJobFromHistory } from "./jobsApi";

/** Rows per request on the History page. */
export const HISTORY_PAGE_SIZE = 50;

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

export type JobList =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; jobs: JobSummary[]; hasMore: boolean };

type Loaded =
  | { key: string; kind: "ready"; jobs: JobSummary[]; nextCursor: string | null }
  | { key: string; kind: "error"; message: string };

const LOADING: JobList = { kind: "loading" };

/**
 * The signed-in user's extraction jobs from the server, newest first. The
 * server forgets a job 24 hours after its last change, so jobs also drop out of
 * the list.
 *
 * The list reloads quietly when the tab becomes visible again (jobs started in
 * another tab show up) and every few seconds while a job is still moving
 * through the pipeline, so its status settles without a reload. One list
 * request covers every row, however many are in flight. A failed quiet reload
 * keeps the list that is on screen.
 */
export function useJobList(userId: string | null | undefined, pageSize = HISTORY_PAGE_SIZE) {
  // Results are keyed by user and page size, so a stale list never shows for another one.
  const key = userId ? `${userId}:${pageSize}` : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [generation, setGeneration] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const current = loaded && loaded.key === key ? loaded : null;
  const nextCursor = current?.kind === "ready" ? current.nextCursor : null;
  const polling = current?.kind === "ready" && current.jobs.some((job) => isInFlight(job.status));

  // A reload asks for at least as many rows as are on screen, so pages already
  // loaded with "Load more" do not collapse back to the first one.
  const shown = useRef(0);
  useEffect(() => {
    shown.current = current?.kind === "ready" ? current.jobs.length : 0;
  });

  const fetchList = useCallback(
    (isStale: () => boolean) => {
      if (!key) return;
      const limit = Math.min(Math.max(pageSize, shown.current), JOB_LIST_MAX);
      listJobs({ limit }).then(
        (page) => {
          if (!isStale()) setLoaded({ key, kind: "ready", jobs: page.jobs, nextCursor: page.nextCursor });
        },
        (err: unknown) => {
          if (isStale()) return;
          const message = err instanceof Error ? err.message : "The server did not answer.";
          setLoaded((prev) => (prev?.key === key && prev.kind === "ready" ? prev : { key, kind: "error", message }));
        }
      );
    },
    [key, pageSize]
  );

  // Load now, after a change (generation) and whenever the tab comes back.
  useEffect(() => {
    let stale = false;
    const isStale = () => stale;
    fetchList(isStale);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchList(isStale);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stale = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchList, generation]);

  // Keep polling while something is still being processed (and the tab is in view).
  useEffect(() => {
    if (!polling) return;
    let stale = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchList(() => stale);
    }, POLL_MS);
    return () => {
      stale = true;
      window.clearInterval(timer);
    };
  }, [polling, fetchList]);

  const list: JobList = !current
    ? LOADING
    : current.kind === "error"
      ? { kind: "error", message: current.message }
      : { kind: "ready", jobs: current.jobs, hasMore: current.nextCursor !== null };

  /** Shows the loading state and fetches again, e.g. after an error. */
  const reload = useCallback(() => {
    setLoaded(null);
    setGeneration((g) => g + 1);
  }, []);

  /** Appends the next page. Rejects when the server could not be reached. */
  const loadMore = useCallback(async () => {
    if (!key || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listJobs({ limit: pageSize, cursor: nextCursor });
      setLoaded((prev) => {
        if (prev?.key !== key || prev.kind !== "ready") return prev;
        const have = new Set(prev.jobs.map((job) => job.jobId));
        const jobs = [...prev.jobs, ...page.jobs.filter((job) => !have.has(job.jobId))];
        return { ...prev, jobs, nextCursor: page.nextCursor };
      });
    } finally {
      setLoadingMore(false);
    }
  }, [key, nextCursor, pageSize]);

  /**
   * Removes the job from the list right away, then from the server. Either way
   * the list reloads quietly afterwards: to fill the freed row, or to put the
   * job back if the server refused. Rejects when the server refused.
   */
  const remove = useCallback(async (jobId: string) => {
    setLoaded((prev) =>
      prev?.kind === "ready" ? { ...prev, jobs: prev.jobs.filter((job) => job.jobId !== jobId) } : prev
    );
    try {
      await removeJobFromHistory(jobId);
    } finally {
      setGeneration((g) => g + 1);
    }
  }, []);

  /** Empties the list on the server, then here. Rejects when the server refused. */
  const clear = useCallback(async () => {
    await clearJobHistory();
    setLoaded((prev) => (prev?.kind === "ready" ? { ...prev, jobs: [], nextCursor: null } : prev));
    // A reload that was already on its way may carry the old rows; ask again.
    setGeneration((g) => g + 1);
  }, []);

  return { list, loadingMore, reload, loadMore, remove, clear };
}
