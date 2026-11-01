"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTROL_LABEL,
  CONTROL_VERB,
  controlFor,
  FINAL_FRAME,
  frameAt,
  locate,
  msUntilNextChange,
  renameText,
  sameFrame,
  shouldRun,
  type Frame,
  type RunInputs,
} from "./productShotTimeline";
import styles from "./ProductShot.module.css";

const ICONS = { pause: Pause, play: Play, replay: RotateCcw } as const;

/**
 * Plays the editor picture it wraps. The picture is rendered by the server in
 * its finished state; this component never re-renders it. A clock turns
 * `productShotTimeline`'s frames into attribute changes on the `data-ps`
 * elements and CSS transitions do the motion. React state is only the button
 * (its label follows Pause, Play and Replay).
 *
 * Stops: off-screen, tab in the background, Pause pressed, all loops played.
 * With `prefers-reduced-motion: reduce` it does nothing and shows no button.
 */
export function ProductShotPlayer({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<() => void>(() => {});
  const [motion, setMotion] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const byIndex = (selector: string) =>
      [...root.querySelectorAll<HTMLElement>(selector)].sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i));
    const boxes = byIndex('[data-ps="box"]');
    const rows = byIndex('[data-ps="row"]');
    const insps = byIndex('[data-ps="insp"]');
    const counts = [...root.querySelectorAll<HTMLElement>("[data-ps-count]")];
    const renames = [...root.querySelectorAll<HTMLElement>("[data-ps-rename]")];

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const inputs: RunInputs = {
      userPaused: false,
      offscreen: true,
      hidden: document.hidden,
      reducedMotion: reduced.matches,
      finished: false,
    };
    let played = 0; // running milliseconds so far, not counting the current stretch
    let startedAt: number | null = null; // performance.now() when the current stretch began
    let timer: number | undefined;
    let last: Frame | null = null;

    const setFlag = (el: HTMLElement, name: string, on: boolean, value = "") => {
      if (on) el.setAttribute(name, value);
      else el.removeAttribute(name);
    };

    /** Writes only what changed since the last frame. */
    const paint = (frame: Frame) => {
      const prev = last;
      if (prev && sameFrame(prev, frame)) return;
      last = frame;
      if (!prev || prev.shown !== frame.shown) {
        boxes.forEach((el, i) => setFlag(el, "data-on", i < frame.shown));
        rows.forEach((el, i) => setFlag(el, "data-on", i < frame.shown));
        for (const el of counts) {
          el.textContent = el.dataset.psCount === "pad" ? String(frame.shown).padStart(2, "0") : String(frame.shown);
        }
      }
      if (!prev || prev.selected !== frame.selected) {
        boxes.forEach((el, i) => setFlag(el, "data-selected", i === frame.selected, "true"));
        rows.forEach((el, i) => setFlag(el, "data-selected", i === frame.selected, "true"));
        // The inspector with data-i -1 is the "nothing selected" panel.
        for (const el of insps) setFlag(el, "data-selected", Number(el.dataset.i) === frame.selected, "true");
      }
      if (!prev || prev.typed !== frame.typed) {
        const text = renameText(frame.typed);
        for (const el of renames) el.textContent = text;
      }
    };

    /**
     * Print shows the finished frame whatever the clock says (the CSS makes everything visible; this puts the
     * selection, name and counts on the final frame too). The clock's frame is restored afterwards.
     */
    let printing = false;
    let beforePrint: Frame | null = null;
    const onBeforePrint = () => {
      if (printing) return;
      printing = true;
      beforePrint = last;
      paint(FINAL_FRAME);
    };
    const onAfterPrint = () => {
      if (!printing) return;
      printing = false;
      const resume = beforePrint ?? frameAt(locate(elapsed()).t);
      beforePrint = null;
      last = null;
      paint(resume);
    };

    const elapsed = () => played + (startedAt === null ? 0 : performance.now() - startedAt);

    const tick = () => {
      timer = undefined;
      const total = elapsed();
      const at = locate(total);
      if (printing) beforePrint = frameAt(at.t);
      else paint(frameAt(at.t));
      if (at.done) {
        played = total;
        startedAt = null;
        inputs.finished = true;
        setFinished(true);
        return;
      }
      const wait = msUntilNextChange(total);
      if (wait !== null) timer = window.setTimeout(tick, wait);
    };

    const stopClock = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (startedAt !== null) played += performance.now() - startedAt;
      startedAt = null;
    };

    const sync = () => {
      if (shouldRun(inputs)) {
        if (startedAt === null) {
          startedAt = performance.now();
          tick();
        }
      } else {
        stopClock();
      }
    };

    /** Start from the empty first frame and hold it until the shot is on screen. */
    const arm = () => {
      played = 0;
      last = null;
      inputs.userPaused = false;
      inputs.finished = false;
      setUserPaused(false);
      setFinished(false);
      root.setAttribute("data-anim", "on");
      paint(frameAt(0));
      setMotion(true);
    };

    /** Back to the server-rendered finished frame. */
    const disarm = () => {
      stopClock();
      root.removeAttribute("data-anim");
      paint(FINAL_FRAME);
      last = null;
      setMotion(false);
    };

    pressRef.current = () => {
      if (inputs.finished) {
        arm();
      } else {
        inputs.userPaused = !inputs.userPaused;
        setUserPaused(inputs.userPaused);
      }
      sync();
    };

    const onReducedChange = () => {
      inputs.reducedMotion = reduced.matches;
      if (reduced.matches) disarm();
      else arm();
      sync();
    };
    const onVisibility = () => {
      inputs.hidden = document.hidden;
      sync();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        inputs.offscreen = !entries[entries.length - 1].isIntersecting;
        sync();
      },
      { threshold: 0.2 }
    );

    if (!reduced.matches) arm();
    reduced.addEventListener("change", onReducedChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    observer.observe(root);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      reduced.removeEventListener("change", onReducedChange);
      pressRef.current = () => {};
      disarm();
    };
  }, []);

  const control = controlFor({ userPaused, finished });
  const Icon = ICONS[control];

  return (
    <div ref={rootRef} className={styles.root}>
      {children}
      {motion ? (
        <button
          type="button"
          aria-label={CONTROL_LABEL[control]}
          className={cn("oa-btn oa-btn-secondary oa-btn-sm", styles.control)}
          onClick={() => pressRef.current()}
        >
          <Icon aria-hidden />
          {CONTROL_VERB[control]}
        </button>
      ) : null}
    </div>
  );
}
