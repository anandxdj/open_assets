"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Tile Studio UI: 4×4 sprite-sheet grid + platform preview + prompt rail.

import { useEffect, useRef } from "react";
import { Download, Layers, Loader2, Sparkles, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";
import {
  TILESET_COLS,
  TILESET_PRESETS,
  TILESET_ROWS,
  TILESET_SLOTS,
  TILE_TEMPLATE_MASK,
} from "@/features/studio/lib/tileset";
import type { TileSetRole, TileSetSlot, TileSetSlotSpec } from "@/features/studio/lib/tileset";

const CHECKER =
  "bg-[repeating-conic-gradient(#80808033_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]";

export function TileSlotCell({
  slot,
  spec,
  onRegenerate,
  busy,
  showActions,
}: {
  slot: TileSetSlot;
  spec: TileSetSlotSpec;
  onRegenerate: () => void;
  busy: boolean;
  showActions: boolean;
}) {
  return (
    <div
      className={cn("group relative overflow-hidden border border-zinc-300 dark:border-zinc-700 aspect-square", CHECKER)}
      title={spec.hint}
    >
      {slot.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slot.imageUrl}
          alt={spec.hint}
          draggable={false}
          className="block h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-mono text-[9px] uppercase text-muted-foreground">
          {spec.label}
        </div>
      )}

      {slot.generating && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <Loader2 size={18} className="animate-spin text-white" />
        </div>
      )}

      <div className="pointer-events-none absolute left-1 top-1 bg-black/55 px-1 py-px font-mono text-[8px] uppercase text-white backdrop-blur">
        {spec.label}
      </div>

      {showActions && slot.imageUrl && !slot.generating && (
        <button
          onClick={onRegenerate}
          disabled={busy}
          className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur"
          title="Replace this tile (separate call — may not match the rest). For best consistency, re-roll the whole sheet instead."
        >
          <Sparkles size={11} />
        </button>
      )}
    </div>
  );
}

/** Platform preview — resolves each occupied mask cell to a tile role from
 * its neighbors (mirrors a simple autotile importer), composited on one
 * canvas so fractional CSS grids can't leak hairline seams. */
export function PlatformPreview({ tileSet }: { tileSet: TileSetSlot[] }) {
  const byRole = (role: TileSetRole) => tileSet.find((s) => s.role === role)?.imageUrl ?? null;
  const previewMask = TILE_TEMPLATE_MASK;
  const rows = previewMask.length;
  const cols = previewMask[0]?.length ?? 0;
  const isSolid = (x: number, y: number): boolean =>
    y >= 0 && y < rows && x >= 0 && x < cols && previewMask[y][x] === "#";

  const roleForCell = (x: number, y: number): TileSetRole | null => {
    if (!isSolid(x, y)) return null;
    const top = !isSolid(x, y - 1);
    const bottom = !isSolid(x, y + 1);
    const left = !isSolid(x - 1, y);
    const right = !isSolid(x + 1, y);

    if (top && left) return "tl_outer";
    if (top && right) return "tr_outer";
    if (bottom && left) return "bl_outer";
    if (bottom && right) return "br_outer";
    if (top) return "top";
    if (bottom) return "bottom";
    if (left) return "left";
    if (right) return "right";

    if (!isSolid(x - 1, y - 1)) return "tl_inner";
    if (!isSolid(x + 1, y - 1)) return "tr_inner";
    if (!isSolid(x - 1, y + 1)) return "bl_inner";
    if (!isSolid(x + 1, y + 1)) return "br_inner";

    return "body";
  };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const CELL_PX = 96;
  const sheetW = cols * CELL_PX;
  const sheetH = rows * CELL_PX;

  const renderKey = previewMask
    .flatMap((row, y) =>
      Array.from(row).map((_, x) => {
        const role = roleForCell(x, y);
        return `${role ?? "-"}:${role && byRole(role) ? byRole(role)!.length : 0}`;
      }),
    )
    .join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    const roleSrcs = new Map<TileSetRole, string>();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const role = roleForCell(x, y);
        if (!role) continue;
        const src = byRole(role);
        if (src) roleSrcs.set(role, src);
      }
    }

    Promise.all(
      Array.from(roleSrcs.entries()).map(
        ([role, src]) =>
          new Promise<[TileSetRole, HTMLImageElement | null]>((resolve) => {
            const img = new Image();
            img.onload = () => resolve([role, img]);
            img.onerror = () => resolve([role, null]);
            img.src = src;
          }),
      ),
    ).then((loaded) => {
      if (cancelled) return;
      const imgByRole = new Map<TileSetRole, HTMLImageElement>();
      loaded.forEach(([role, img]) => {
        if (img) imgByRole.set(role, img);
      });

      ctx.clearRect(0, 0, sheetW, sheetH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const role = roleForCell(x, y);
          if (!role) continue;
          const img = imgByRole.get(role);
          if (!img) continue;
          ctx.drawImage(img, x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        }
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, cols, rows, sheetW, sheetH]);

  return (
    <div
      className="flex w-full items-center justify-center overflow-hidden border-2 border-zinc-950 dark:border-zinc-700 bg-gradient-to-b from-sky-300/20 to-blue-900/30 p-3"
      style={{ aspectRatio: `${cols} / ${rows}` }}
    >
      <canvas ref={canvasRef} width={sheetW} height={sheetH} className="block h-auto w-full" />
    </div>
  );
}

const ghostBtn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase border border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:text-foreground hover:border-zinc-500 disabled:opacity-40 rounded-none";

export function TileStudio({
  tileSet,
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  onGenerateAll,
  onStop,
  onRegenerate,
  onClearAll,
  onDownloadSheet,
  onDownloadZip,
}: {
  tileSet: TileSetSlot[];
  prompt: string;
  setPrompt: (v: string) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  progressMessage?: string | null;
  sceneBrief: string;
  setSceneBrief: (v: string) => void;
  sceneBriefLoading: boolean;
  onGenerateAll: () => void;
  onStop: () => void;
  onRegenerate: (role: TileSetRole) => void;
  onClearAll: () => void;
  onDownloadSheet: () => void;
  onDownloadZip: () => void;
}) {
  const filledCount = tileSet.filter((s) => s.hasImage).length;
  const total = tileSet.length;
  const hasAny = filledCount > 0;

  type GridCell = { spec?: TileSetSlotSpec; slot?: TileSetSlot; empty?: boolean };
  const grid: GridCell[][] = [];
  for (let r = 0; r < TILESET_ROWS; r++) {
    const row: GridCell[] = [];
    for (let c = 0; c < TILESET_COLS; c++) {
      const spec = TILESET_SLOTS.find((s) => s.col === c && s.row === r);
      if (!spec) {
        row.push({ empty: true });
      } else {
        const slot = tileSet.find((s) => s.role === spec.role);
        row.push({ spec, slot });
      }
    }
    grid.push(row);
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3 font-mono sm:px-6">
      <div className="flex items-center justify-center gap-2 text-[11px] uppercase">
        <Layers size={14} />
        <span className="text-muted-foreground">
          Tile-set mode — one AI call generates all 13 tiles as a single sprite-sheet.
          Drop into Unity, Phaser, Godot, or Tiled.
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {generating ? (
          <button
            onClick={onStop}
            className="inline-flex items-center gap-1.5 border border-destructive px-3 py-1.5 text-[11px] font-bold uppercase text-destructive rounded-none"
            title="Stop the current generation"
          >
            <Square size={12} />
            Stop
          </button>
        ) : (
          <button
            onClick={onGenerateAll}
            disabled={!prompt.trim()}
            className="inline-flex items-center gap-1.5 bg-zinc-950 text-white dark:bg-white dark:text-black border border-zinc-950 dark:border-white px-3 py-1.5 text-[11px] font-black uppercase rounded-none disabled:opacity-40 hover:bg-transparent hover:text-zinc-950 dark:hover:bg-transparent dark:hover:text-white transition-colors"
            title="Generate the full 4×4 sprite sheet in one AI call"
          >
            <Sparkles size={14} />
            {hasAny ? "Re-roll sheet" : "Generate sheet (1 call)"}
          </button>
        )}
        <button
          onClick={onDownloadSheet}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export clean + padded sprite-sheet PNGs with a JSON manifest"
        >
          <Download size={14} />
          Sheets + manifest
        </button>
        <button
          onClick={onDownloadZip}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Export individual PNGs + sheets + manifest as a ZIP"
        >
          <Layers size={14} />
          ZIP
        </button>
        <button
          onClick={onClearAll}
          disabled={!hasAny || generating}
          className={ghostBtn}
          title="Clear all tiles and start over"
        >
          <Trash2 size={14} />
          Clear
        </button>
        <div className="border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filledCount}/{total} tiles
          {progressMessage ? ` · ${progressMessage}` : ""}
        </div>
      </div>

      {/* Grid + preview */}
      <div className="grid w-full flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Sprite sheet (4×4)
          </div>
          <div
            className="grid w-full gap-1.5"
            style={{ gridTemplateColumns: `repeat(${TILESET_COLS}, 1fr)` }}
          >
            {grid.flat().map((cell, i) =>
              cell.empty || !cell.spec || !cell.slot ? (
                <div
                  key={`empty-${i}`}
                  className="aspect-square border border-dashed border-zinc-200 dark:border-zinc-800"
                />
              ) : (
                <TileSlotCell
                  key={cell.spec.role}
                  slot={cell.slot}
                  spec={cell.spec}
                  onRegenerate={() => onRegenerate(cell.spec!.role)}
                  busy={generating}
                  showActions
                />
              ),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <span>Platform preview</span>
            <span className="font-mono normal-case tracking-normal">How tiles fit together</span>
          </div>
          <PlatformPreview tileSet={tileSet} />
          <div className="text-[10px] uppercase text-muted-foreground">
            Hover a tile and click the spark to replace it (separate call, may drift). For best
            consistency, re-roll the whole sheet.
          </div>
        </div>
      </div>

      {/* Command rail */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div className="border-2 border-zinc-950 dark:border-zinc-700 bg-background p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Scene direction
            </label>
            {sceneBriefLoading && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
                <Loader2 size={10} className="animate-spin" />
                Updating…
              </span>
            )}
          </div>
          <textarea
            value={sceneBrief}
            onChange={(e) => setSceneBrief(e.target.value)}
            disabled={generating || sceneBriefLoading}
            placeholder="Optional shared art direction. If you built a parallax scene, the brief is reused here so tiles match palette and lighting."
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] leading-relaxed focus:outline-none"
          />
        </div>

        {/* Material presets */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Quick start
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TILESET_PRESETS.map((preset) => {
              const active = prompt.trim() === preset.prompt;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  disabled={generating}
                  className={cn(
                    "border px-2.5 py-1 text-[10px] font-bold uppercase transition-colors rounded-none disabled:opacity-50",
                    active
                      ? "border-zinc-950 dark:border-white bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border-zinc-300 dark:border-zinc-700 text-muted-foreground hover:border-zinc-500 hover:text-foreground",
                  )}
                  title={preset.prompt}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-full items-stretch gap-2 border-2 border-zinc-950 dark:border-zinc-700 bg-background p-1.5">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && prompt.trim() && !generating) {
                e.preventDefault();
                onGenerateAll();
              }
            }}
            placeholder="Describe the material — or pick a quick start above"
            className="flex-1 bg-transparent px-3 py-2.5 text-[13px] focus:outline-none"
          />
          <div className="hidden items-center border-l border-border sm:flex">
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              disabled={generating}
              className="cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[12px] uppercase font-bold text-muted-foreground focus:outline-none"
              title="Art style for the tile-set"
            >
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === "Match original" ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    {group.options[0].label}
                  </option>
                ) : (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
