"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  canArmReveal,
  isRevealTarget,
  REVEAL_ROOT_MARGIN,
  REVEAL_THRESHOLD,
  staggerStep,
  startsPending,
} from "@/lib/reveal";

/** The longest a reveal can run (320ms travel plus the 180ms last stagger step) and some slack. */
const CLEAN_UP_AFTER_MS = 700;

function hashTarget(hash: string): HTMLElement | null {
  if (hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

/** The element a link to this page's own hash would scroll to, or null for any other link. */
function linkTarget(event: MouseEvent): HTMLElement | null {
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!anchor) return null;
  try {
    const url = new URL(anchor.getAttribute("href") ?? "", window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return null;
    return hashTarget(url.hash);
  } catch {
    return null;
  }
}

/**
 * Scroll-in reveal for a block, or for each child of it (`stagger`). The server renders it plain and visible.
 * After hydration, and only when the browser has IntersectionObserver and motion is not reduced, each block
 * that is below the fold gets `data-reveal="pending"` (see globals.css), then fades up once when it scrolls
 * into view. Blocks that are in view at load, a block a hash link points at, a block that receives keyboard
 * focus, and everything when the visitor switches to reduced motion appear at once. The decisions live in
 * lib/reveal.ts.
 */
export function Reveal({
  as = "div",
  stagger = false,
  className,
  children,
}: {
  as?: "div" | "ul" | "ol" | "dl" | "section";
  /** Reveal each direct child on its own, stepping children that enter together by 60ms. */
  stagger?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // One of a few block tags; typed as div because they share every prop used here.
  const Tag = as as "div";

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const armed = canArmReveal({ hasObserver: "IntersectionObserver" in window, reducedMotion: reduce.matches });
    if (!armed) return;

    const units: HTMLElement[] = stagger ? (Array.from(root.children) as HTMLElement[]) : [root];
    const pending = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, number>();

    const related = (unit: HTMLElement, target: HTMLElement | null) =>
      !!target && isRevealTarget(target.tagName) && (unit.contains(target) || target.contains(unit));

    const settle = (unit: HTMLElement) => {
      window.clearTimeout(timers.get(unit));
      timers.delete(unit);
      unit.removeAttribute("data-reveal");
      unit.style.removeProperty("--i");
    };

    const initialTarget = hashTarget(window.location.hash);
    const viewportHeight = window.innerHeight;
    for (const unit of units) {
      const rect = unit.getBoundingClientRect();
      const isPending = startsPending({
        armed,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight,
        relatedToHashTarget: related(unit, initialTarget),
      });
      if (isPending) {
        unit.setAttribute("data-reveal", "pending");
        pending.add(unit);
      }
    }
    if (pending.size === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Blocks entering in the same batch step by 60ms, in page order.
        const entering = entries
          .filter((entry) => entry.isIntersecting && pending.has(entry.target as HTMLElement))
          .map((entry) => entry.target as HTMLElement)
          .sort((a, b) => units.indexOf(a) - units.indexOf(b));
        entering.forEach((unit, position) => show(unit, position));
      },
      { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN }
    );

    /** Reveal once. With no position the block appears at once (hash link, keyboard focus, reduced motion). */
    function show(unit: HTMLElement, position?: number) {
      if (!pending.delete(unit)) return;
      observer.unobserve(unit);
      if (position === undefined) {
        settle(unit);
        return;
      }
      unit.style.setProperty("--i", String(staggerStep(position)));
      unit.setAttribute("data-reveal", "shown");
      timers.set(unit, window.setTimeout(() => settle(unit), CLEAN_UP_AFTER_MS));
    }

    const showAll = () => [...pending].forEach((unit) => show(unit));
    const showRelated = (target: HTMLElement | null) => {
      if (!target) return;
      [...pending].filter((unit) => related(unit, target)).forEach((unit) => show(unit));
    };

    const onFocusIn = (event: FocusEvent) => {
      const unit = units.find((candidate) => candidate.contains(event.target as Node));
      if (unit) show(unit);
    };
    const onClick = (event: MouseEvent) => showRelated(linkTarget(event));
    const onHashChange = () => showRelated(hashTarget(window.location.hash));
    const onMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) showAll();
    };

    pending.forEach((unit) => observer.observe(unit));
    root.addEventListener("focusin", onFocusIn);
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHashChange);
    reduce.addEventListener("change", onMotionChange);

    return () => {
      observer.disconnect();
      root.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHashChange);
      reduce.removeEventListener("change", onMotionChange);
      units.forEach(settle);
    };
  }, [stagger]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
