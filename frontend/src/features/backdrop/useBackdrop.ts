"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  analyzePixels,
  decideAuto,
  describeBackdrop,
  resolveBackdrop,
  type AutoDecision,
  type Backdrop,
  type BackdropMode,
  type PixelStats,
  type ThemeName,
} from "./lib/decide";
import { readBackdropMode, writeBackdropMode } from "./lib/prefs";

// ---- The remembered mode ---------------------------------------------------
// The in-memory value keeps the choice working for this visit when localStorage is blocked.
let memoryMode: BackdropMode | null = null;
const modeListeners = new Set<() => void>();

function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useBackdropMode(): [BackdropMode, (mode: BackdropMode) => void] {
  const mode = useSyncExternalStore(
    subscribeMode,
    () => memoryMode ?? readBackdropMode(),
    () => "auto" as BackdropMode,
  );
  const set = useCallback((next: BackdropMode) => {
    memoryMode = next;
    writeBackdropMode(next);
    modeListeners.forEach((listener) => listener());
  }, []);
  return [mode, set];
}

// ---- Reading an image's pixels, once per address ----------------------------
type Entry = PixelStats | "unreadable";
const cache = new Map<string, Entry>();
const queued = new Set<string>();
const cacheListeners = new Set<() => void>();
const waiting: string[] = [];
let running = 0;
const MAX_PARALLEL = 4;
const SAMPLE_EDGE = 128;

function notifyCache() {
  cacheListeners.forEach((listener) => listener());
}

function sample(src: string): Promise<Entry> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, SAMPLE_EDGE / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve("unreadable");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(analyzePixels(ctx.getImageData(0, 0, w, h).data));
      } catch {
        // A tainted canvas (no CORS headers) throws on read.
        resolve("unreadable");
      }
    };
    img.onerror = () => resolve("unreadable");
    img.src = src;
  });
}

function pump() {
  while (running < MAX_PARALLEL && waiting.length > 0) {
    const src = waiting.shift() as string;
    running += 1;
    sample(src).then((entry) => {
      cache.set(src, entry);
      running -= 1;
      notifyCache();
      pump();
    });
  }
}

function request(src: string) {
  if (cache.has(src) || queued.has(src)) return;
  queued.add(src);
  waiting.push(src);
  pump();
}

function subscribeCache(listener: () => void) {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

/** Pixel stats of an image, read in the browser: "pending" until done, null when unreadable. */
export function useImageStats(src: string | null | undefined, enabled = true): PixelStats | null | "pending" {
  const entry = useSyncExternalStore(
    subscribeCache,
    () => (src ? cache.get(src) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (enabled && src) request(src);
  }, [enabled, src]);
  if (!src) return "pending";
  if (entry === undefined) return "pending";
  return entry === "unreadable" ? null : entry;
}

// ---- Putting it together ----------------------------------------------------
export interface BackdropState {
  mode: BackdropMode;
  setMode: (mode: BackdropMode) => void;
  decision: AutoDecision;
  /** What to draw: a forced backdrop, or null for the theme's own checkerboard. */
  backdrop: Backdrop | null;
  /** One sentence for the menu. */
  summary: string;
  theme: ThemeName;
}

function useThemeName(): ThemeName {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : "light";
}

/** The Backdrop for one image (a sheet, or a single asset). */
export function useBackdrop(src: string | null | undefined, enabled = true): BackdropState {
  const [mode, setMode] = useBackdropMode();
  const theme = useThemeName();
  const stats = useImageStats(src, enabled && mode === "auto");
  const decision = useMemo(() => decideAuto(stats, theme), [stats, theme]);
  return {
    mode,
    setMode,
    decision,
    backdrop: resolveBackdrop(mode, decision),
    summary: describeBackdrop(mode, decision),
    theme,
  };
}

/** A sheet's Backdrop shared with the panels that show crops of it, so they need no props. */
export const SheetBackdropContext = createContext<Backdrop | null | undefined>(undefined);

export function useSheetBackdrop(): Backdrop | null | undefined {
  return useContext(SheetBackdropContext);
}
