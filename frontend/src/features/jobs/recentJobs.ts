import { useCallback, useSyncExternalStore } from "react";

/**
 * Recently created extraction jobs, remembered in this browser.
 *
 * The backend has no "list my jobs" endpoint yet (only GET /api/jobs/:id), so
 * the upload flow records each job it creates here. Entries are kept per user
 * because the jobs API only answers for the job's owner. Jobs expire on the
 * server 24 hours after their last update; the list itself is capped at 50.
 */

export interface RecentJob {
  id: string;
  fileName: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

export const RECENT_JOBS_LIMIT = 50;

const KEY_PREFIX = "oa:recent-jobs:";
const EMPTY: RecentJob[] = [];

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; list: RecentJob[] }>();

function storageKey(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isRecentJob(value: unknown): value is RecentJob {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.fileName === "string" && typeof v.createdAt === "number";
}

function parse(raw: string | null): RecentJob[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return value.filter(isRecentJob).slice(0, RECENT_JOBS_LIMIT);
  } catch {
    return EMPTY;
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Newest first. Returns the same array instance until the stored value changes. */
export function readRecentJobs(userId: string): RecentJob[] {
  if (typeof window === "undefined") return EMPTY;
  const key = storageKey(userId);
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.list;
  const list = parse(raw);
  cache.set(key, { raw, list });
  return list;
}

function write(userId: string, list: RecentJob[]) {
  const key = storageKey(userId);
  try {
    if (list.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(list.slice(0, RECENT_JOBS_LIMIT)));
  } catch {
    // Storage full, blocked or unavailable: the list simply is not remembered.
  }
  emit();
}

export function recordRecentJob(userId: string, job: { id: string; fileName: string; createdAt?: number }) {
  const entry: RecentJob = { id: job.id, fileName: job.fileName, createdAt: job.createdAt ?? Date.now() };
  const rest = readRecentJobs(userId).filter((j) => j.id !== job.id);
  write(userId, [entry, ...rest]);
}

export function removeRecentJob(userId: string, jobId: string) {
  write(
    userId,
    readRecentJobs(userId).filter((j) => j.id !== jobId)
  );
}

export function clearRecentJobs(userId: string) {
  write(userId, []);
}

/** Put back a list removed by clearRecentJobs (undo). */
export function restoreRecentJobs(userId: string, list: RecentJob[]) {
  const current = readRecentJobs(userId);
  const ids = new Set(current.map((j) => j.id));
  const merged = [...current, ...list.filter((j) => !ids.has(j.id))].sort((a, b) => b.createdAt - a.createdAt);
  write(userId, merged);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot() {
  return EMPTY;
}

/** The signed-in user's recent jobs, newest first, kept in sync across tabs. */
export function useRecentJobs(userId: string | null | undefined): RecentJob[] {
  const getSnapshot = useCallback(() => (userId ? readRecentJobs(userId) : EMPTY), [userId]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
