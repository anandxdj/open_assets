"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Live multi-layer composite: each populated layer scrolls at its own speed
// via repeat-x backgrounds animated in a single RAF loop.

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play, X } from "lucide-react";
import type { ParallaxLayer } from "@/features/studio/lib/parallax";

export function ParallaxPreview({
  layers,
  previewHeight = 140,
}: {
  layers: ParallaxLayer[];
  previewHeight?: number;
}) {
  const [playing, setPlaying] = useState(true);
  /** px/sec of a 1.0× layer; others scroll at base × layer.scrollSpeed. */
  const [basePxPerSec, setBasePxPerSec] = useState(120);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(0.55);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fullscreenStageRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(previewHeight);
  const [fullscreenStageHeight, setFullscreenStageHeight] = useState(0);
  const offsetsRef = useRef<Record<string, number>>({});
  const lastTimeRef = useRef<number | null>(null);
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-2" style={{ minWidth: 78 }}>
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        Composite
      </span>
      <button
        onClick={() => setPlaying((p) => !p)}
        className="flex h-7 w-7 items-center justify-center border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground"
        aria-label={playing ? "Pause preview" : "Play preview"}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {Math.round(basePxPerSec)} px/s
      </span>
      <input
        type="range"
        min={20}
        max={300}
        value={basePxPerSec}
        onChange={(e) => setBasePxPerSec(Number(e.target.value))}
        aria-label="Camera scroll speed"
        className="w-full"
      />
      {fullscreen && (
        <>
          <div className="my-1 w-full border-t border-border" aria-hidden />
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Camera
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {Math.round(fullscreenZoom * 100)}%
          </span>
          <input
            type="range"
            min={25}
            max={100}
            value={Math.round(fullscreenZoom * 100)}
            onChange={(e) => setFullscreenZoom(Number(e.target.value) / 100)}
            aria-label="Fullscreen camera zoom"
            title="Pull the camera back to fit more horizontal scene on screen"
            className="w-full"
          />
        </>
      )}
    </div>
  );

  const fullscreenViewportHeight =
    fullscreenStageHeight > 0
      ? Math.max(120, Math.round(fullscreenStageHeight * fullscreenZoom))
      : undefined;

  const viewport = (
    <div
      ref={viewportRef}
      className="relative w-full overflow-hidden border border-zinc-300 dark:border-zinc-700 bg-gradient-to-b from-zinc-900 to-zinc-800"
      style={{
        height: fullscreen
          ? fullscreenViewportHeight
            ? `${fullscreenViewportHeight}px`
            : "55%"
          : `${previewHeight}px`,
      }}
    >
      {populated.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase text-zinc-400">
          Generate or upload at least one layer to preview the parallax
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
      <button
        type="button"
        onClick={() => setFullscreen((f) => !f)}
        className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center border border-zinc-600 bg-black/70 text-zinc-300 hover:text-white backdrop-blur"
        aria-label={fullscreen ? "Exit fullscreen preview" : "Fullscreen preview"}
        title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen preview"}
      >
        {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );

  const previewShell = (
    <div className={`flex w-full items-stretch gap-2 ${fullscreen ? "h-full min-h-0" : ""}`}>
      {controls}
      <div
        ref={fullscreen ? fullscreenStageRef : undefined}
        className={`relative flex min-h-0 flex-1 ${fullscreen ? "h-full items-center justify-center" : ""}`}
      >
        {viewport}
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col bg-black/95 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label="Parallax scene preview"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6">
          <div>
            <h2 className="text-xs font-black uppercase tracking-widest text-white">Scene preview</h2>
            <p className="text-[10px] uppercase text-zinc-500">Live parallax composite · Esc to exit</p>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase text-zinc-400 hover:text-white"
          >
            <X size={14} />
            Close
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4 text-white">
          <div className="flex min-h-0 flex-1 border-2 border-zinc-700 p-2">{previewShell}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-stretch gap-2 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1.5 font-mono">
      {previewShell}
    </div>
  );
}
