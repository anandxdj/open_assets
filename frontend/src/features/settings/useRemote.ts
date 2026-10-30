"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/features/settings/api";

type Settled<T> = { token: string; data?: T; error?: string };

export type Remote<T> = {
  /** "loading" covers the first load, a retry, and a change of `key`. */
  status: "loading" | "ready" | "error";
  /** Last successfully loaded value. Kept while a new `key` loads, so tables do not blink empty. */
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
  /** Replace the loaded value locally after a mutation, without refetching. */
  mutate: (update: (current: T) => T) => void;
};

/**
 * Loads one thing for a settings section. Sections load independently so one
 * failing request never blanks the page. Re-runs when `key` changes (page
 * number) or `reload()` is called.
 */
export function useRemote<T>(load: () => Promise<T>, key: string | number = "", fallbackError = "The server did not answer."): Remote<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const token = `${key}:${attempt}`;

  // Always call the latest `load` without making it an effect dependency.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let alive = true;
    loadRef.current().then(
      (data) => alive && setSettled({ token, data }),
      (err: unknown) => alive && setSettled({ token, error: errorMessage(err, fallbackError) }),
    );
    return () => {
      alive = false;
    };
  }, [token, fallbackError]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const mutate = useCallback((update: (current: T) => T) => {
    setSettled((s) => (s && s.data !== undefined ? { ...s, data: update(s.data) } : s));
  }, []);

  const current = settled?.token === token;
  return {
    status: current ? (settled.error !== undefined ? "error" : "ready") : "loading",
    data: settled?.data,
    error: current ? settled.error : undefined,
    reload,
    mutate,
  };
}
