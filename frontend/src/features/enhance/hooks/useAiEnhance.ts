"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AiEnhanceError,
  fetchAiCapabilities,
  fetchAiEnhanceResult,
  getAiEnhanceJob,
  submitAiEnhance,
  type AiCapabilities,
  type AiEnhanceJob,
  type AiEnhanceOptions,
} from "@/features/enhance/aiEnhanceApi";

// ── capabilities ────────────────────────────────────────────────────────────

export type CapabilitiesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AiCapabilities };

/** Asks the server what AI enhance can do, so the page can degrade before an upload. */
export function useAiCapabilities() {
  const [state, setState] = useState<CapabilitiesState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchAiCapabilities(abort.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Couldn't check what AI enhance supports.",
        });
      });
    return () => abort.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

// ── a run: upload, wait for the provider, fetch the PNG ─────────────────────

/**
 * idle → uploading (bytes leaving the browser, real progress) → storing (bytes
 * sent, server validating and storing the image) → working (the provider is
 * producing the result; polled) → ready. Any failure lands in failed.
 */
export type AiPhase = "idle" | "uploading" | "storing" | "working" | "ready" | "failed";

export interface AiRunError {
  message: string;
  code?: string;
}

export interface AiRunResult {
  url: string;
  job: AiEnhanceJob;
}

const POLL_FAST_MS = 1500;
const POLL_SLOW_MS = 3000;
const SLOW_AFTER_MS = 30_000;
/** The server gives up on a provider after 2 minutes; this leaves room for queueing. */
const GIVE_UP_MS = 5 * 60_000;
const MAX_POLL_FAILURES = 4;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useAiEnhance() {
  const [phase, setPhase] = useState<AiPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<AiRunError | null>(null);
  const [result, setResult] = useState<AiRunResult | null>(null);

  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  const startedAt = useRef(0);
  // The object URL is revoked when it is replaced and when the page unmounts.
  const objectUrl = useRef<string | null>(null);

  const dropResult = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setResult(null);
  }, []);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    []
  );

  const busy = phase === "uploading" || phase === "storing" || phase === "working";

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const run = useCallback(
    async (file: File, options: AiEnhanceOptions): Promise<AiRunError | null> => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++runId.current;
      const current = () => runId.current === id && !abort.signal.aborted;

      dropResult();
      setError(null);
      setUploadProgress(0);
      setElapsed(0);
      startedAt.current = Date.now();
      setPhase("uploading");

      try {
        let job = await submitAiEnhance(
          file,
          options,
          (fraction) => {
            if (!current()) return;
            setUploadProgress(Math.round(fraction * 100));
            if (fraction >= 1) setPhase("storing");
          },
          abort.signal
        );
        if (!current()) return null;
        setPhase("working");

        const waitStart = Date.now();
        let failures = 0;
        while (job.status !== "ready" && job.status !== "failed") {
          const waited = Date.now() - waitStart;
          if (waited > GIVE_UP_MS) {
            throw new AiEnhanceError(
              "This is taking longer than expected. Try again, or try a smaller image or a lower scale.",
              0,
              "CLIENT_TIMEOUT"
            );
          }
          await sleep(waited > SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS, abort.signal);
          try {
            job = await getAiEnhanceJob(job.jobId, abort.signal);
            failures = 0;
          } catch (pollError) {
            // A dropped request is retried; a job that's gone or isn't ours is final.
            const final = pollError instanceof AiEnhanceError && [403, 404].includes(pollError.status);
            if (abort.signal.aborted || final || ++failures >= MAX_POLL_FAILURES) throw pollError;
          }
        }

        if (job.status === "failed") {
          throw new AiEnhanceError(job.error ?? "The image couldn't be enhanced.", 200, job.errorCode);
        }

        const blob = await fetchAiEnhanceResult(job.jobId, abort.signal);
        if (!current()) return null;
        const url = URL.createObjectURL(blob);
        objectUrl.current = url;
        setResult({ url, job });
        setPhase("ready");
        return null;
      } catch (caught) {
        // Cancelled or superseded by a newer run: stay quiet.
        if (!current()) return null;
        const failure: AiRunError =
          caught instanceof AiEnhanceError
            ? { message: caught.message, code: caught.code }
            : { message: "Couldn't enhance the image. Try again." };
        setError(failure);
        setPhase("failed");
        return failure;
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    [dropResult]
  );

  /**
   * Stop waiting. An upload is abandoned; a job already queued keeps running on
   * the server, but its result is no longer shown.
   */
  const cancel = useCallback(() => {
    runId.current += 1;
    controller.current?.abort();
    controller.current = null;
    setPhase("idle");
  }, []);

  /** Back to a blank slate: cancel anything running and drop the result and error. */
  const reset = useCallback(() => {
    cancel();
    dropResult();
    setError(null);
  }, [cancel, dropResult]);

  return { phase, busy, uploadProgress, elapsed, error, result, run, cancel, reset };
}
