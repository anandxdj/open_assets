"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useJobPolling } from "@/features/editor/hooks/useJobPolling";
import { cn } from "@/lib/utils";

const ARTBOARD_WIDTH = 420;
const ARTBOARD_HEIGHT = 320;
const LABEL_HEIGHT = 44;
const GAP = 100;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function BatchArtboard({
  jobId,
  index,
  x,
  y,
  active,
  onSelect,
  onOpen,
}: {
  jobId: string;
  index: number;
  x: number;
  y: number;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { job, loading, error } = useJobPolling(jobId);

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ left: x, top: y, width: ARTBOARD_WIDTH, height: ARTBOARD_HEIGHT + LABEL_HEIGHT }}
      className="group absolute text-left outline-none"
      aria-label={`Select image ${index + 1}`}
    >
      <div
        className={cn(
          "relative h-[320px] overflow-hidden bg-[linear-gradient(45deg,#171717_25%,transparent_25%),linear-gradient(-45deg,#171717_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#171717_75%),linear-gradient(-45deg,transparent_75%,#171717_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition-shadow",
          active
            ? "ring-4 ring-orange-500 ring-offset-4 ring-offset-zinc-950"
            : "ring-1 ring-zinc-700 group-hover:ring-2 group-hover:ring-zinc-400",
        )}
      >
        {job?.cloudinaryUrl ? (
          <svg width="100%" height="100%" viewBox={`0 0 ${job.imageWidth || 1} ${job.imageHeight || 1}`}>
            <image
              href={job.cloudinaryUrl}
              width={job.imageWidth || 1}
              height={job.imageHeight || 1}
              preserveAspectRatio="xMidYMid meet"
            />
          </svg>
        ) : (
          <div className="grid h-full place-items-center bg-zinc-900 text-xs text-zinc-500">
            {error ? "Image failed to load" : loading ? "Loading original…" : "Processing…"}
          </div>
        )}
      </div>
      <div className="flex h-11 items-center justify-between gap-3 pt-3 font-mono">
        <span className={cn("text-[11px] font-black uppercase tracking-wider", active ? "text-orange-400" : "text-zinc-300")}>
          Image {index + 1}
        </span>
        <span className="text-[10px] text-zinc-500">
          {job?.imageWidth && job?.imageHeight ? `${job.imageWidth} × ${job.imageHeight}px` : job?.status ?? "Loading"}
        </span>
      </div>
    </button>
  );
}

export function BatchOverviewCanvas({
  jobIds,
  activeIndex,
  onSelect,
  onOpen,
}: {
  jobIds: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const movedRef = useRef(false);
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 0.65 });

  const layout = useMemo(() => {
    const columns = Math.ceil(Math.sqrt(jobIds.length));
    const rows = Math.ceil(jobIds.length / columns);
    return {
      columns,
      rows,
      width: columns * ARTBOARD_WIDTH + (columns - 1) * GAP,
      height: rows * (ARTBOARD_HEIGHT + LABEL_HEIGHT) + (rows - 1) * GAP,
    };
  }, [jobIds.length]);

  const fitAll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const padding = 80;
    const zoom = Math.max(
      0.08,
      Math.min(1, (container.clientWidth - padding * 2) / layout.width, (container.clientHeight - padding * 2) / layout.height),
    );
    setCamera({
      zoom,
      x: (container.clientWidth - layout.width * zoom) / 2,
      y: (container.clientHeight - layout.height * zoom) / 2,
    });
  }, [layout]);

  useEffect(() => {
    fitAll();
  }, [fitAll]);

  const zoomAtCenter = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    setCamera((current) => {
      const zoom = Math.max(0.05, Math.min(4, current.zoom * factor));
      const worldX = (cx - current.x) / current.zoom;
      const worldY = (cy - current.y) / current.zoom;
      return { zoom, x: cx - worldX * zoom, y: cy - worldY * zoom };
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full touch-none overflow-hidden bg-[#09090b] cursor-grab active:cursor-grabbing"
      onWheel={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const cx = event.clientX - bounds.left;
        const cy = event.clientY - bounds.top;
        setCamera((current) => {
          const zoom = Math.max(0.05, Math.min(4, current.zoom * Math.exp(-event.deltaY * 0.001)));
          const worldX = (cx - current.x) / current.zoom;
          const worldY = (cy - current.y) / current.zoom;
          return { zoom, x: cx - worldX * zoom, y: cy - worldY * zoom };
        });
      }}
      onPointerDown={(event) => {
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
        movedRef.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
        setCamera((current) => ({ ...current, x: drag.cameraX + dx, y: drag.cameraY + dy }));
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {jobIds.map((jobId, index) => {
          const column = index % layout.columns;
          const row = Math.floor(index / layout.columns);
          return (
            <BatchArtboard
              key={jobId}
              jobId={jobId}
              index={index}
              x={column * (ARTBOARD_WIDTH + GAP)}
              y={row * (ARTBOARD_HEIGHT + LABEL_HEIGHT + GAP)}
              active={index === activeIndex}
              onSelect={() => { if (!movedRef.current) onSelect(index); }}
              onOpen={() => { if (!movedRef.current) onOpen(index); }}
            />
          );
        })}
      </div>

      <div className="absolute bottom-5 right-5 flex items-center border border-zinc-700 bg-zinc-950/95 text-zinc-300 shadow-xl">
        <button type="button" aria-label="Zoom out" onClick={() => zoomAtCenter(0.8)} className="grid size-9 place-items-center hover:bg-zinc-800">
          <Minus className="size-4" />
        </button>
        <button type="button" onClick={fitAll} className="flex h-9 min-w-16 items-center justify-center gap-1 border-x border-zinc-700 px-2 text-[10px] font-bold">
          <Maximize2 className="size-3" /> {Math.round(camera.zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAtCenter(1.25)} className="grid size-9 place-items-center hover:bg-zinc-800">
          <Plus className="size-4" />
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-5 left-5 text-[10px] font-medium text-zinc-600">
        Drag to pan · Scroll to zoom · Double-click an image to focus
      </p>
    </div>
  );
}
