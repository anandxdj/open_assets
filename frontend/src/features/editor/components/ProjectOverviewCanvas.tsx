"use client";

import { useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import type { CanvasTransform, EditorProjectPage } from "@/features/editor/services/projectApi";

export function ProjectOverviewCanvas({
  pages,
  onOpen,
  onMove,
}: {
  pages: EditorProjectPage[];
  onOpen: (pageId: string) => void;
  onMove: (pageId: string, frame: CanvasTransform) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState({ x: 80, y: 80, zoom: 0.55 });
  const [frames, setFrames] = useState(() => new Map(pages.map((page) => [page.id, page.overviewFrame])));
  const drag = useRef<null | { kind: "pan" | "move" | "resize"; pageId?: string; x: number; y: number; original?: CanvasTransform; camera?: { x: number; y: number } }>(null);

  const fit = () => {
    const el = host.current; if (!el || pages.length === 0) return;
    const values = [...frames.values()]; const minX = Math.min(...values.map((v) => v.x)); const minY = Math.min(...values.map((v) => v.y));
    const maxX = Math.max(...values.map((v) => v.x + v.width)); const maxY = Math.max(...values.map((v) => v.y + v.height));
    const zoom = Math.max(0.05, Math.min(1, (el.clientWidth - 180) / (maxX - minX), (el.clientHeight - 180) / (maxY - minY)));
    setCamera({ zoom, x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (el.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom });
  };

  return (
    <div
      ref={host}
      className="relative h-full touch-none overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing"
      onWheel={(event) => { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const cx = event.clientX - rect.left; const cy = event.clientY - rect.top; setCamera((value) => { const zoom = Math.max(0.04, Math.min(5, value.zoom * Math.exp(-event.deltaY * 0.001))); return { zoom, x: cx - ((cx - value.x) / value.zoom) * zoom, y: cy - ((cy - value.y) / value.zoom) * zoom }; }); }}
      onPointerDown={(event) => { if (event.target !== event.currentTarget) return; drag.current = { kind: "pan", x: event.clientX, y: event.clientY, camera: { x: camera.x, y: camera.y } }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => {
        const value = drag.current; if (!value) return;
        if (value.kind === "pan" && value.camera) setCamera((current) => ({ ...current, x: value.camera!.x + event.clientX - value.x, y: value.camera!.y + event.clientY - value.y }));
        if (value.pageId && value.original) {
          const dx = (event.clientX - value.x) / camera.zoom; const dy = (event.clientY - value.y) / camera.zoom;
          setFrames((current) => { const next = new Map(current); const original = value.original!; next.set(value.pageId!, value.kind === "resize" ? { ...original, width: Math.max(120, original.width + dx), height: Math.max(90, original.height + dy) } : { ...original, x: Math.round((original.x + dx) / 8) * 8, y: Math.round((original.y + dy) / 8) * 8 }); return next; });
        }
      }}
      onPointerUp={() => { const value = drag.current; if (value?.pageId) { const frame = frames.get(value.pageId); if (frame) onMove(value.pageId, frame); } drag.current = null; }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
        {pages.map((page, index) => {
          const frame = frames.get(page.id) ?? page.overviewFrame;
          return (
            <div
              key={page.id}
              className="group absolute bg-zinc-900 shadow-2xl ring-1 ring-zinc-700 hover:ring-[3px] hover:ring-orange-500"
              style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
              onPointerDown={(event) => { event.stopPropagation(); drag.current = { kind: "move", pageId: page.id, x: event.clientX, y: event.clientY, original: { ...frame } }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onDoubleClick={() => onOpen(page.id)}
            >
              {page.job?.cloudinaryUrl ? (
                <svg width="100%" height="100%" viewBox={`0 0 ${page.job.imageWidth || 1} ${page.job.imageHeight || 1}`}><image href={page.job.cloudinaryUrl} width={page.job.imageWidth || 1} height={page.job.imageHeight || 1} /></svg>
              ) : <div className="grid h-full place-items-center text-xs text-zinc-500">{page.job?.status ?? "Loading"}</div>}
              <div className="absolute -bottom-10 left-0 right-0 flex items-center justify-between font-mono text-xs">
                <span className="font-black text-zinc-200">{index + 1}. {page.name}</span><span className="text-zinc-500">{page.job?.boxes.length ?? 0} assets</span>
              </div>
              <button type="button" aria-label={`Resize ${page.name}`} className="absolute -bottom-2 -right-2 size-5 border-2 border-orange-500 bg-white opacity-0 group-hover:opacity-100" onPointerDown={(event) => { event.stopPropagation(); drag.current = { kind: "resize", pageId: page.id, x: event.clientX, y: event.clientY, original: { ...frame } }; event.currentTarget.setPointerCapture(event.pointerId); }} />
            </div>
          );
        })}
      </div>
      <button type="button" onClick={fit} className="absolute bottom-5 right-5 flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-950 px-3 text-[10px] font-bold text-zinc-300"><Maximize2 className="size-3" /> Fit all · {Math.round(camera.zoom * 100)}%</button>
      <p className="pointer-events-none absolute bottom-5 left-5 text-[10px] text-zinc-600">Drag frames to arrange · Double-click to open a page</p>
    </div>
  );
}
