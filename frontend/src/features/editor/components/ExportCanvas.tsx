"use client";

import { useRef, useEffect, useState } from "react";
import type { Camera, Tool } from "../hooks/useCanvasEditor";
import type { Asset } from "@/types";
import { CursorProvider, CursorFollow } from "@/components/unlumen-ui/cursor";
import { cn } from "@/lib/utils";

const CELL = 200;
const GAP = 32;
const COLS = 6;
const LABEL_HEIGHT = 24;

function clampZoom(z: number) {
  return Math.max(0.05, Math.min(10, z));
}

function getEnclosedAssets(
  marquee: { x: number; y: number; width: number; height: number },
  assets: Asset[]
): string[] {
  const mLeft = marquee.x;
  const mRight = marquee.x + marquee.width;
  const mTop = marquee.y;
  const mBottom = marquee.y + marquee.height;

  return assets
    .filter((asset, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = col * (CELL + GAP);
      const cy = row * (CELL + LABEL_HEIGHT + GAP);

      const aLeft = cx;
      const aRight = cx + CELL;
      const aTop = cy;
      const aBottom = cy + CELL + LABEL_HEIGHT;

      return aLeft >= mLeft && aRight <= mRight && aTop >= mTop && aBottom <= mBottom;
    })
    .map((asset) => asset.id);
}

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  camera: Camera;
  onCameraChange: (c: Camera) => void;
  onToggle: (id: string) => void;
  activeTool: Tool;
  onSetActiveTool: (t: Tool) => void;
  onSetSelectedIds: (ids: Set<string>) => void;
  upscaledIds?: Set<string>;
}

export function ExportCanvas({
  assets,
  selectedIds,
  camera,
  onCameraChange,
  onToggle,
  activeTool,
  onSetActiveTool,
  onSetSelectedIds,
  upscaledIds,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spaceHeldRef = useRef(false);
  const panStateRef = useRef<{ startScreen: { x: number; y: number }; startCam: { x: number; y: number } } | null>(null);

  const [marqueeBox, setMarqueeBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const marqueeDragRef = useRef<{ startWorld: { x: number; y: number } } | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear idle timeout on unmount
  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, []);

  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  const onToggleRef = useRef(onToggle);
  const activeToolRef = useRef(activeTool);
  const onSetSelectedIdsRef = useRef(onSetSelectedIds);
  const marqueeBoxRef = useRef(marqueeBox);

  useEffect(() => { cameraRef.current = camera; });
  useEffect(() => { onCameraChangeRef.current = onCameraChange; });
  useEffect(() => { onToggleRef.current = onToggle; });
  useEffect(() => { activeToolRef.current = activeTool; });
  useEffect(() => { onSetSelectedIdsRef.current = onSetSelectedIds; });
  useEffect(() => { marqueeBoxRef.current = marqueeBox; });

  function getSvgScreenPos(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { sx: 0, sy: 0 };
    const r = svg.getBoundingClientRect();
    return { sx: clientX - r.left, sy: clientY - r.top };
  }

  function screenToWorld(sx: number, sy: number) {
    const cam = cameraRef.current;
    return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
  }

  function getBaseCursor(): string {
    if (spaceHeldRef.current) return "grab";
    const tool = activeToolRef.current;
    if (tool === "hand") return "grab";
    return "default";
  }

  function updateCursor(cursor: string) {
    if (containerRef.current) containerRef.current.style.cursor = cursor;
  }

  // Space bar pan mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || spaceHeldRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      spaceHeldRef.current = true;
      updateCursor("grab");
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      updateCursor(getBaseCursor());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Update cursor when activeTool prop changes
  useEffect(() => {
    if (!spaceHeldRef.current) updateCursor(getBaseCursor());
  }, [activeTool]);

  // Global mousemove + mouseup for pan and marquee selection
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      setIsIdle(false);
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = setTimeout(() => {
        setIsIdle(true);
      }, 1000);

      const { sx, sy } = getSvgScreenPos(e.clientX, e.clientY);

      if (panStateRef.current) {
        const dx = sx - panStateRef.current.startScreen.x;
        const dy = sy - panStateRef.current.startScreen.y;
        onCameraChangeRef.current({
          ...cameraRef.current,
          x: panStateRef.current.startCam.x + dx,
          y: panStateRef.current.startCam.y + dy,
        });
        return;
      }

      if (marqueeDragRef.current) {
        const world = screenToWorld(sx, sy);
        const start = marqueeDragRef.current.startWorld;
        setMarqueeBox({
          x: Math.min(start.x, world.x),
          y: Math.min(start.y, world.y),
          width: Math.abs(world.x - start.x),
          height: Math.abs(world.y - start.y),
        });
      }
    }

    function onMouseUp() {
      if (panStateRef.current) {
        panStateRef.current = null;
        updateCursor(spaceHeldRef.current ? "grab" : getBaseCursor());
        return;
      }

      if (marqueeDragRef.current) {
        marqueeDragRef.current = null;
        const draft = marqueeBoxRef.current;
        if (draft && draft.width >= 4 && draft.height >= 4) {
          const enclosedIds = getEnclosedAssets(draft, assets);
          if (onSetSelectedIdsRef.current) {
            onSetSelectedIdsRef.current(new Set(enclosedIds));
          }
        }
        setMarqueeBox(null);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [assets]);

  // Scroll wheel pan & zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const cam = cameraRef.current;

      if (e.ctrlKey) {
        // Zoom on Ctrl + Scroll
        const r = svg!.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = clampZoom(cam.zoom * factor);
        const wx = (sx - cam.x) / cam.zoom;
        const wy = (sy - cam.y) / cam.zoom;
        onCameraChangeRef.current({ zoom: newZoom, x: sx - wx * newZoom, y: sy - wy * newZoom });
      } else {
        // Pan on normal Scroll (vertical) / Shift + Scroll (horizontal)
        let dx = e.deltaX;
        let dy = e.deltaY;

        if (e.shiftKey && dy !== 0 && dx === 0) {
          dx = dy;
          dy = 0;
        }

        onCameraChangeRef.current({
          ...cam,
          x: cam.x - dx,
          y: cam.y - dy,
        });
      }
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function handleSvgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const { sx, sy } = getSvgScreenPos(e.clientX, e.clientY);
    const tool = activeToolRef.current;
    const cam = cameraRef.current;

    const isPan = tool === "hand" || spaceHeldRef.current;

    if (isPan) {
      e.preventDefault();
      panStateRef.current = { startScreen: { x: sx, y: sy }, startCam: { x: cam.x, y: cam.y } };
      updateCursor("grabbing");
      return;
    }

    if (tool === "select") {
      const target = e.target as SVGElement;
      const isBackground =
        target === svgRef.current ||
        target.getAttribute("data-bg") === "true";

      if (isBackground) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          onSetSelectedIdsRef.current(new Set());
        }
        const world = screenToWorld(sx, sy);
        marqueeDragRef.current = { startWorld: world };
      }
    }
  }

  const totalCols = Math.min(assets.length, COLS);
  const rows = Math.ceil(assets.length / COLS);
  const contentW = totalCols * CELL + (totalCols - 1) * GAP;
  const contentH = rows * (CELL + LABEL_HEIGHT) + (rows - 1) * GAP;

  const transform = `translate(${camera.x},${camera.y}) scale(${camera.zoom})`;
  const strokeW = 2 / camera.zoom;
  const zoomPercent = Math.round(camera.zoom * 100);

  const isDraggingMarquee = !!marqueeBox;
  const isPanning = !!panStateRef.current;
  const enclosedCount = marqueeBox ? getEnclosedAssets(marqueeBox, assets).length : 0;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#050506]">
      <CursorProvider global={false} className="w-full h-full relative block">
        {/* Dot grid backdrop */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff08 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={handleSvgMouseDown}
      >
        <defs>
          <pattern id="checker" patternUnits="userSpaceOnUse" width={12} height={12}>
            <rect width={12} height={12} fill="#0c0c0e" />
            <rect width={6} height={6} fill="#141416" />
            <rect x={6} y={6} width={6} height={6} fill="#141416" />
          </pattern>
        </defs>

        {/* Background click catcher */}
        <rect
          data-bg="true"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0)"
        />

        <g transform={transform}>
          {assets.map((asset, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const cx = col * (CELL + GAP);
            const cy = row * (CELL + LABEL_HEIGHT + GAP);
            const selected = selectedIds.has(asset.id);
            const upscaled = upscaledIds?.has(asset.id) ?? false;

            return (
              <g
                key={asset.id}
                onClick={() => !spaceHeldRef.current && onToggleRef.current(asset.id)}
                style={{ cursor: spaceHeldRef.current ? undefined : "pointer" }}
              >
                {/* Checkered background */}
                <rect
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill="#0c0c0e"
                />
                <rect
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill="url(#checker)"
                />

                {/* Asset image */}
                <image
                  href={asset.cropped_url}
                  x={cx + 16}
                  y={cy + 16}
                  width={CELL - 32}
                  height={CELL - 32}
                  preserveAspectRatio="xMidYMid meet"
                />

                {/* Selection border */}
                <rect
                  x={cx}
                  y={cy}
                  width={CELL}
                  height={CELL}
                  fill="none"
                  stroke={selected ? "#ffffff" : "#3f3f46"}
                  strokeWidth={selected ? strokeW * 2 : strokeW}
                  style={{ transition: "stroke 0.1s" }}
                />

                {/* Selection glow overlay */}
                {selected && (
                  <rect
                    x={cx}
                    y={cy}
                    width={CELL}
                    height={CELL}
                    fill="#ffffff08"
                    pointerEvents="none"
                  />
                )}

                {/* Checkmark badge */}
                <rect
                  x={cx + CELL - 24}
                  y={cy + 8}
                  width={16}
                  height={16}
                  rx={3}
                  fill={selected ? "#ffffff" : "#09090b"}
                  stroke={selected ? "#ffffff" : "#52525b"}
                  strokeWidth={strokeW}
                />
                {selected && (
                  <polyline
                    points={`${cx + CELL - 21},${cy + 16} ${cx + CELL - 18},${cy + 19} ${cx + CELL - 12},${cy + 13}`}
                    fill="none"
                    stroke="#000"
                    strokeWidth={2 / camera.zoom}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )}

                {/* Upscaled badge (top-left) — shown once cloud upscale completes */}
                {upscaled && (
                  <>
                    <rect
                      x={cx + 8}
                      y={cy + 8}
                      width={26}
                      height={16}
                      rx={3}
                      fill="#00ff66"
                    />
                    <text
                      x={cx + 8 + 13}
                      y={cy + 8 + 12}
                      textAnchor="middle"
                      fill="#000"
                      fontSize={11}
                      fontFamily="monospace"
                      fontWeight="bold"
                      pointerEvents="none"
                    >
                      2×
                    </text>
                  </>
                )}

                {/* Asset name label */}
                <rect
                  x={cx}
                  y={cy + CELL}
                  width={CELL}
                  height={LABEL_HEIGHT}
                  fill="#09090b"
                />
                <text
                  x={cx + CELL / 2}
                  y={cy + CELL + LABEL_HEIGHT / 2 + 4}
                  textAnchor="middle"
                  fill={selected ? "#f4f4f5" : "#71717a"}
                  fontSize={10 / camera.zoom}
                  fontFamily="monospace"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {asset.name.length > 20 ? asset.name.slice(0, 18) + "…" : asset.name}
                </text>
              </g>
            );
          })}

          {/* Marquee selection box */}
          {marqueeBox && marqueeBox.width > 0 && marqueeBox.height > 0 && (
            <rect
              x={marqueeBox.x}
              y={marqueeBox.y}
              width={marqueeBox.width}
              height={marqueeBox.height}
              fill="rgba(255, 255, 255, 0.08)"
              stroke="#ffffff"
              strokeWidth={1.5 / camera.zoom}
              strokeDasharray={`${6 / camera.zoom} ${3 / camera.zoom}`}
              style={{ pointerEvents: "none" }}
            />
          )}
        </g>

        {/* Hidden rect to carry canvas dimensions for fitToScreen callers */}
        <rect
          id="export-canvas-content"
          data-w={contentW}
          data-h={contentH + rows * LABEL_HEIGHT}
          width={0}
          height={0}
          fill="none"
        />
      </svg>

      {/* Floating HUD info that follows the cursor inside the canvas */}
      <CursorFollow
        className={cn(
          "font-mono text-[8px] bg-zinc-950/90 border border-zinc-800/80 text-zinc-400 py-0.5 px-2 uppercase font-bold tracking-wider rounded-full flex items-center gap-1 backdrop-blur-sm select-none shadow-md pointer-events-none z-50 transition-all duration-300",
          isIdle && !isDraggingMarquee && !isPanning ? "opacity-0 scale-95" : "opacity-100 scale-100"
        )}
      >
        <span
          className={cn(
            "text-[6px] font-black transition-colors duration-200",
            isDraggingMarquee ? "text-[#00ff66] animate-pulse" : "text-[#ff7c00]"
          )}
        >
          ●
        </span>
        <span>
          {isDraggingMarquee
            ? `SELECTING | ${enclosedCount} SLICE${enclosedCount !== 1 ? "S" : ""}`
            : isPanning
            ? "PANNING"
            : selectedIds.size > 0
            ? `SELECTED | ${selectedIds.size}`
            : activeTool === "hand"
            ? "PAN"
            : "SELECT"}
        </span>
      </CursorFollow>
    </CursorProvider>
  </div>
  );
}

export { CELL, GAP, COLS, LABEL_HEIGHT };

