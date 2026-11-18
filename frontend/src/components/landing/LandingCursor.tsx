"use client";

import { useEffect, useRef, useState } from "react";

/** Applied to <html> while the custom cursor is on screen; see globals.css. */
const HIDE_CLASS = "oa-cursor-none";

/** A mouse or trackpad that can hover. Touch and pen keep the system pointer. */
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Follow spring for the position and a softer one for the tilt (stiffness, damping; mass 1). */
const FOLLOW = { k: 300, c: 25 };
const TILT = { k: 200, c: 15 };

type Spring = { x: number; v: number };

function step(s: Spring, target: number, { k, c }: { k: number; c: number }, dt: number) {
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

/**
 * The landing page's custom cursor: an accent arrow that follows the mouse on a spring, tilts
 * up to 45deg and shrinks up to 10% with speed, and replaces the system arrow while it is inside
 * the window. Only for a fine pointer that can hover. Under reduced motion it sits exactly on the
 * pointer with no spring, tilt or fade. Decorative: hidden from assistive tech, no pointer events.
 * Runs on refs and one requestAnimationFrame loop that stops when the arrow comes to rest, so a
 * mouse move never re-renders React.
 */
export function LandingCursor() {
  const [enabled, setEnabled] = useState(false);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia(FINE_POINTER);
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!enabled || !node) return;
    const root = document.documentElement;
    const reducedQuery = window.matchMedia(REDUCED_MOTION);

    const target = { x: 0, y: 0 };
    const sx: Spring = { x: 0, v: 0 };
    const sy: Spring = { x: 0, v: 0 };
    const tilt: Spring = { x: 0, v: 0 };
    let shown = false;
    let frame = 0;
    let last = 0;

    const paint = (rotate: number, scale: number) => {
      node.style.transform = `translate3d(${sx.x}px, ${sy.x}px, 0)`;
      node.style.setProperty("--oa-cursor-rotate", `${rotate}deg`);
      node.style.setProperty("--oa-cursor-scale", `${scale}`);
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      step(sx, target.x, FOLLOW, dt);
      step(sy, target.y, FOLLOW, dt);
      const speed = Math.hypot(sx.v, sy.v);
      const lean = Math.max(-45, Math.min(45, (sx.v / 1000) * 30 + (sy.v / 1000) * 30));
      step(tilt, lean, TILT, dt);
      paint(tilt.x, 1 - Math.min(speed / 2000, 0.1));
      const resting =
        Math.abs(sx.x - target.x) < 0.1 && Math.abs(sy.x - target.y) < 0.1 && speed < 1 && Math.abs(tilt.x) < 0.1;
      frame = resting ? 0 : requestAnimationFrame(tick);
    };

    const show = (on: boolean) => {
      if (shown === on) return;
      shown = on;
      root.classList.toggle(HIDE_CLASS, on);
      node.dataset.visible = on ? "true" : "false";
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      target.x = event.clientX;
      target.y = event.clientY;
      if (!shown || reducedQuery.matches) {
        // Start on the pointer, not at 0,0; under reduced motion always sit on it.
        sx.x = target.x;
        sy.x = target.y;
        sx.v = sy.v = tilt.x = tilt.v = 0;
        paint(0, 1);
      }
      show(true);
      if (!reducedQuery.matches && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.relatedTarget === null) show(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") show(false);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onLeave, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      root.classList.remove(HIDE_CLASS);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={el}
      aria-hidden
      data-slot="landing-cursor"
      data-visible="false"
      className="oa-landing-cursor pointer-events-none fixed left-0 top-0 z-[9999]"
    >
      {/* The tip of the arrow sits on the pointer: (1.8, 4.4) in a 40 unit box drawn at 24px. */}
      <svg viewBox="0 0 40 40" className="-ml-[1px] -mt-[3px] size-6 text-brand">
        <path
          d="M1.8 4.4 7 36.2c.3 1.8 2.6 2.3 3.6.8l3.9-5.7c1.7-2.5 4.5-4.1 7.5-4.3l6.9-.5c1.8-.1 2.5-2.4 1.1-3.5L5 2.5c-1.4-1.1-3.5 0-3.3 1.9Z"
          fill="currentColor"
          stroke="var(--oa-accent-fg)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
