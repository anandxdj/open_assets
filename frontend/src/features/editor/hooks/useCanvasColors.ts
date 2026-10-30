"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Canvas drawing reads the design tokens at runtime so boxes follow the theme.
const TOKENS = {
  ink: "--oa-ink",
  paper: "--oa-bg",
  surface: "--oa-surface",
  line: "--oa-border",
  accent: "--oa-accent",
  accentFg: "--oa-accent-fg",
  checkerA: "--oa-checker-a",
  checkerB: "--oa-checker-b",
} as const;

export type CanvasColors = Record<keyof typeof TOKENS, string>;

const KEYS = Object.keys(TOKENS) as (keyof typeof TOKENS)[];

// Before the first read (and during SSR) the CSS variables themselves stand in.
const FALLBACK = Object.fromEntries(KEYS.map((key) => [key, `var(${TOKENS[key]})`])) as CanvasColors;

function readColors(): CanvasColors {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    KEYS.map((key) => [key, style.getPropertyValue(TOKENS[key]).trim() || FALLBACK[key]])
  ) as CanvasColors;
}

export function useCanvasColors(): CanvasColors {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<CanvasColors>(FALLBACK);

  useEffect(() => {
    // next-themes swaps the root class in its own effect, which runs after ours,
    // so read on the next frame once the new theme is on the document.
    const frame = requestAnimationFrame(() => setColors(readColors()));
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return colors;
}
