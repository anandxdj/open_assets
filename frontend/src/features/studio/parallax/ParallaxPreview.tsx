"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Live multi-layer composite: each populated layer scrolls at its own speed
// via repeat-x backgrounds animated in a single RAF loop. Play/pause, camera
// speed, fullscreen (Esc exits) and, in fullscreen, camera zoom.

import { useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Range } from "@/components/ui/controls";
import type { ParallaxLayer } from "@/features/studio/lib/parallax";

export function ParallaxPreview({
  layers,
  previewHeight = 140,
}: {
  layers: ParallaxLayer[];
  previewHeight?: number;
}) {
  // Starts paused when the visitor asks for reduced motion; the play button is still there.
  const [playing, setPlaying] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  /** px/sec of a 1.0× layer; others scroll at base × layer.scrollSpeed. */
  const [basePxPerSec, setBasePxPerSec] = useState(120);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(0.55);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fullscreenStageRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(previewHeight);
  const [fullscreenStageHeight, setFullscreenStageHeight] = useState(0);
  const offsetsRef = useRef<Record<string, number>>({});
  const lastTimeRef = useRef<number | null>(null);
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const titleId = useId();

  const populated = layers.filter((l) => l.imageUrl);
  const layersKey = layers.map((l) => l.id + ":" + l.imageUrl).join("|");

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewportHeight(Math.max(1, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen, previewHeight]);

  useEffect(() => {
    if (!fullscreen) return;
    const el = fullscreenStageRef.current;
    if (!el) return;
    const update = () => setFullscreenStageHeight(Math.max(1, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  // Move focus into the fullscreen view and back to its opener on exit.
  useEffect(() => {
    if (fullscreen) closeRef.current?.focus();
    else if (wasFullscreen.current) openerRef.current?.focus();
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);

  // Reset offsets when the layer set or preview height changes.
  useEffect(() => {
    offsetsRef.current = {};
  }, [layersKey, viewportHeight]);

  useEffect(() => {
    if (!playing) {
      lastTimeRef.current = null;
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      if (lastTimeRef.current == null) lastTimeRef.current = t;
      const dt = (t - lastTimeRef.current) / 1000;
      lastTimeRef.current = t;

      for (const layer of layers) {
        if (!layer.imageUrl || !layer.width || !layer.height) continue;
        const layerScale = layer.height > 0 ? viewportHeight / layer.height : 1;
        const layerDisplayWidth = Math.max(1, layer.width * layerScale);
        const speed = basePxPerSec * layer.scrollSpeed;
        const cur = offsetsRef.current[layer.id] ?? 0;
        const next = (cur + speed * dt) % layerDisplayWidth;
        offsetsRef.current[layer.id] = next;
        const el = layerRefs.current[layer.id];
        if (el) el.style.backgroundPositionX = `${-next}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastTimeRef.current = null;
    };
  }, [playing, basePxPerSec, layers, viewportHeight]);

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[1.5px] border-line bg-surface px-2.5 py-2">
      <Button
        variant="ghost"
        size="sm"
        icon
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause preview" : "Play preview"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <div className="flex min-w-[180px] flex-1 items-center gap-2">
        <span aria-hidden className="oa-label">
          Speed
        </span>
        <Range
          min={20}
          max={300}
          value={basePxPerSec}
          onChange={(e) => setBasePxPerSec(Number(e.target.value))}
          aria-label="Camera scroll speed"
          aria-valuetext={`${Math.round(basePxPerSec)} pixels per second`}
          className="min-w-0 flex-1"
        />
        <span className="oa-value w-[60px] flex-none text-right text-ink-2">
          {Math.round(basePxPerSec)} px/s
        </span>
      </div>
      {fullscreen && (
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <span aria-hidden className="oa-label">
            Zoom
          </span>
          <Range
            min={25}
            max={100}
            value={Math.round(fullscreenZoom * 100)}
            onChange={(e) => setFullscreenZoom(Number(e.target.value) / 100)}
            aria-label="Camera zoom"
            aria-valuetext={`${Math.round(fullscreenZoom * 100)} percent`}
            title="Pull the camera back to fit more of the scene"
            className="min-w-0 flex-1"
          />
          <span className="oa-value w-[60px] flex-none text-right text-ink-2">
            {Math.round(fullscreenZoom * 100)}%
          </span>
        </div>
      )}
      <Button
        ref={fullscreen ? closeRef : openerRef}
        size="sm"
        onClick={() => setFullscreen((f) => !f)}
        title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen preview"}
      >
        {fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
      </Button>
    </div>
  );

  const fullscreenViewportHeight =
    fullscreenStageHeight > 0
      ? Math.max(120, Math.round(fullscreenStageHeight * fullscreenZoom))
      : undefined;

  const viewport = (
    <div
      ref={viewportRef}
      role="img"
      aria-label={
        populated.length
          ? `Parallax composite of ${populated.length} layer${populated.length === 1 ? "" : "s"}`
          : "Parallax composite, no layers yet"
      }
      className="oa-checker relative w-full overflow-hidden"
      style={{
        height: fullscreen
          ? fullscreenViewportHeight
            ? `${fullscreenViewportHeight}px`
            : "55%"
          : `${previewHeight}px`,
      }}
    >
      {populated.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <p className="bg-surface px-2 text-center text-xs leading-[18px] text-ink-2">
            Generate or upload a layer to preview the parallax.
          </p>
        </div>
      )}
      {layers.map((layer) => {
        if (!layer.imageUrl || !layer.width || !layer.height) return null;
        const layerScale = viewportHeight / layer.height;
        const layerDisplayWidth = Math.max(1, layer.width * layerScale);
        return (
          <div
            key={layer.id}
            ref={(el) => {
              layerRefs.current[layer.id] = el;
            }}
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${layer.imageUrl}")`,
              backgroundRepeat: "repeat-x",
              backgroundSize: `${layerDisplayWidth}px ${viewportHeight}px`,
              backgroundPositionX: 0,
              backgroundPositionY: "bottom",
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );

  // Keep Tab inside the fullscreen view while it covers the page.
  const trapFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-page"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapFocus}
      >
        <div className="flex h-14 flex-none items-center justify-between gap-3 border-b-[1.5px] border-line px-4 sm:px-6">
          <div className="flex min-w-0 flex-col">
            <h2 id={titleId} className="oa-h3">
              Scene preview
            </h2>
            <p className="truncate text-xs leading-[18px] text-ink-2">
              Live parallax composite. Press Esc to exit.
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
          <div className="flex min-h-0 flex-1 flex-col border-[1.5px] border-line-strong">
            <div
              ref={fullscreenStageRef}
              className="oa-stage flex min-h-0 flex-1 items-center justify-center"
            >
              {viewport}
            </div>
            {controls}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col border-[1.5px] border-line bg-surface">
      {viewport}
      {controls}
    </div>
  );
}
