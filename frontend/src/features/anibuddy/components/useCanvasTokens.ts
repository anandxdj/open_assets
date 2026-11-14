"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Canvas and Konva cannot read CSS variables, so drawing code reads the design
 * tokens from the document at runtime. The values are re-read whenever the
 * theme class on <html> changes (next-themes toggles `.dark`) or the system
 * colour preference flips, so bones and joints follow light and dark.
 */
const TOKENS = {
  ink: "--oa-ink",
  surface: "--oa-surface",
  accent: "--oa-accent",
  danger: "--oa-danger",
} as const;

export type CanvasTokens = Record<keyof typeof TOKENS, string>;

const KEYS = Object.keys(TOKENS) as (keyof typeof TOKENS)[];

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function snapshot(): string {
  const style = getComputedStyle(document.documentElement);
  return KEYS.map((key) => style.getPropertyValue(TOKENS[key]).trim()).join("|");
}

export function useCanvasTokens(): CanvasTokens {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => {
    const values = raw.split("|");
    return Object.fromEntries(KEYS.map((key, index) => [key, values[index] ?? ""])) as CanvasTokens;
  }, [raw]);
}

/** `#rgb` / `#rrggbb` token plus an alpha, for translucent fills on canvas. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
