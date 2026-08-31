"use client";

// Playback: one requestAnimationFrame loop, started once.
//
// The v3 animate step listed `frame` in its effect dependencies while calling
// setFrame inside the loop, so every displayed frame tore the loop down and built
// a new one -- a cancelAnimationFrame, a closure allocation and an effect
// teardown per frame, plus a fresh `last` timestamp that made the real frame rate
// whatever React's render latency happened to be rather than the clip's fps.
//
// Here the loop depends on `playing` alone. fps and frame count are read through
// refs, so changing either re-times the NEXT tick instead of restarting the loop,
// and the elapsed-time accounting carries its remainder forward so a slow tab
// drops frames rather than drifting behind the clock.

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorConstants } from "./editor.constants";

export interface PlaybackController {
  frame: number;
  playing: boolean;
  setFrame: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  toggle: () => void;
  /** Step one frame, wrapping. Used by the timeline's nudge controls. */
  step: (delta: number) => void;
}

export function usePlayback(options: { fps: number; frameCount: number }): PlaybackController {
  const [rawFrame, setFrameState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fpsRef = useRef(options.fps);
  const frameCountRef = useRef(options.frameCount);

  const frameCount = Math.max(EditorConstants.MIN_FRAMES, options.frameCount);
  // A clip that shrinks under the playhead is clamped on the way OUT rather than by
  // writing state back from an effect. Storing the clamp would mean a render where
  // the timeline draws a playhead past the end of the strip, and it would lose the
  // original frame if the clip grew again.
  const frame = Math.min(rawFrame, frameCount - 1);

  useEffect(() => {
    fpsRef.current = Math.max(1, options.fps);
    frameCountRef.current = Math.max(EditorConstants.MIN_FRAMES, options.frameCount);
  }, [options.fps, options.frameCount]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const interval = 1000 / fpsRef.current;
      if (last === 0) last = now;
      const elapsed = now - last;
      if (elapsed >= interval) {
        const steps = Math.floor(elapsed / interval);
        // Advance `last` by whole intervals only, so the leftover fraction is not
        // thrown away and playback stays locked to the clip's fps.
        last += steps * interval;
        const count = frameCountRef.current;
        setFrameState((current) => (current + steps) % count);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const setFrame = useCallback((next: number) => {
    const count = frameCountRef.current;
    setFrameState(Math.max(0, Math.min(count - 1, Math.round(next))));
  }, []);

  const step = useCallback((delta: number) => {
    const count = frameCountRef.current;
    setFrameState((current) => (((current + delta) % count) + count) % count);
  }, []);

  const toggle = useCallback(() => setPlaying((current) => !current), []);

  return { frame, playing, setFrame, setPlaying, toggle, step };
}
