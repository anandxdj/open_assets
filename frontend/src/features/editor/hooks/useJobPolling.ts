"use client";

import { useState, useEffect, useRef } from "react";
import { getJob } from "@/features/upload/services/uploadApi";
import type { JobResponse } from "@/types";

const MAX_NOT_FOUND_RETRIES = 60; // 120s — covers bg-removal + detection on large images
const MAX_AUTH_RETRIES = 5;       // 10s grace window for token restore race

export function useJobPolling(jobId: string) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notFoundCount = useRef(0);
  const authRetryCount = useRef(0);

  useEffect(() => {
    async function poll() {
      try {
        const data = await getJob(jobId);
        notFoundCount.current = 0;
        authRetryCount.current = 0;
        setJob(data);
        // First successful fetch resolves the initial loading gate, regardless of
        // status — screens then branch on `job.status` themselves.
        setLoading(false);
        // Keep polling through intermediate states (detected → naming → cropping →
        // cropped → finalizing); stop only at terminal states.
        if (data.status === "ready" || data.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const isAuthError =
          /token|authenticated|unauthorized/i.test(msg) || msg === "HTTP 401";

        if (isAuthError && authRetryCount.current < MAX_AUTH_RETRIES) {
          authRetryCount.current += 1;
          return;
        }

        if (msg === "Job not found") {
          notFoundCount.current += 1;
          if (notFoundCount.current >= MAX_NOT_FOUND_RETRIES) {
            setError("Job not found. It may have expired or failed to start.");
            setLoading(false);
            if (intervalRef.current) clearInterval(intervalRef.current);
          }
          return;
        }

        setError(msg || "Failed to load job");
        setLoading(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId]);

  return { job, loading, error };
}
