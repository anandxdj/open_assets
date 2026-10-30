import { useSyncExternalStore } from "react";

/*
 * A shared clock for relative times ("12 min ago"). Reading Date.now() during
 * render is impure, so components subscribe to this ticking value instead.
 */

const TICK_MS = 30_000;
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  if (now === 0) now = Date.now();
  return now;
}

function getServerSnapshot() {
  return 0;
}

/** Current time in ms, refreshed every 30 s. 0 during server rendering. */
export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "Oct 27". */
export function formatRelativeTime(timestamp: number, nowMs: number): string {
  if (!Number.isFinite(timestamp)) return "—";
  if (!nowMs) return shortDate.format(timestamp);
  const diff = nowMs - timestamp;
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "Yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  const sameYear = new Date(timestamp).getFullYear() === new Date(nowMs).getFullYear();
  return (sameYear ? shortDate : longDate).format(timestamp);
}

/** Full date and time, for the title of a <time> element. */
export function formatFullDate(timestamp: number): string {
  return Number.isFinite(timestamp) ? fullDate.format(timestamp) : "";
}
