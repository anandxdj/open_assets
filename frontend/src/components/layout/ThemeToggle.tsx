"use client";

import { useCallback, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { revealGeometry, shouldRevealTheme, type Rect } from "@/lib/theme-reveal";

const noopSubscribe = () => () => {};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
};

/**
 * Switch the theme. Where the browser supports view transitions and the person
 * has not asked for reduced motion, the new theme grows as a circle from the
 * click (or from the toggle's centre when it was a key press); see
 * `oa-theme-reveal` in globals.css. Otherwise it switches at once.
 * ThemeProvider keeps `disableTransitionOnChange`, which only silences CSS
 * transitions during the swap, so the two do not fight.
 */
export function useThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();

  const isDark = resolvedTheme === "dark";

  const switchTheme = useCallback(
    (next: "light" | "dark", origin: { pointer: { clientX: number; clientY: number; detail: number } | null; target: Rect }) => {
      const doc = document as ViewTransitionDocument;
      const reveal = shouldRevealTheme({
        hasViewTransitions: typeof doc.startViewTransition === "function",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (!reveal) {
        setTheme(next);
        return;
      }
      const root = document.documentElement;
      const { x, y, r } = revealGeometry({
        pointer: origin.pointer,
        target: origin.target,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      root.style.setProperty("--vt-x", `${x}px`);
      root.style.setProperty("--vt-y", `${y}px`);
      root.style.setProperty("--vt-r", `${r}px`);
      root.dataset.themeReveal = "";
      const cleanup = () => {
        delete root.dataset.themeReveal;
        root.style.removeProperty("--vt-x");
        root.style.removeProperty("--vt-y");
        root.style.removeProperty("--vt-r");
      };
      // flushSync so the class on <html> has changed when the browser takes the "after" snapshot.
      const transition = doc.startViewTransition!(() => {
        flushSync(() => setTheme(next));
      });
      transition.finished.then(cleanup, cleanup);
    },
    [setTheme]
  );

  /** For a click on a button: the origin is the pointer, or the button's centre for the keyboard. */
  const toggleFromClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      switchTheme(isDark ? "light" : "dark", {
        pointer: { clientX: event.clientX, clientY: event.clientY, detail: event.detail },
        target: rect,
      });
    },
    [isDark, switchTheme]
  );

  /** For a menu item, whose select event has no pointer: the origin is the item's centre. */
  const toggleFromElement = useCallback(
    (element: Element) => {
      switchTheme(isDark ? "light" : "dark", { pointer: null, target: element.getBoundingClientRect() });
    },
    [isDark, switchTheme]
  );

  return { resolvedTheme, toggleFromClick, toggleFromElement };
}

export function ThemeToggle({ size = "sm", className }: { size?: ButtonProps["size"]; className?: string }) {
  const { resolvedTheme, toggleFromClick } = useThemeSwitch();
  // false during SSR and hydration, true afterwards: avoids an icon mismatch
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Button
      variant="ghost"
      size={size}
      icon
      className={className}
      aria-label={label}
      title={label}
      onClick={toggleFromClick}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
