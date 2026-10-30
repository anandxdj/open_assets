"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Tile Studio: form panel (material, art style, scene direction) and results
// (4 × 4 sheet grid with per-tile replace, platform preview).

import { useEffect, useId, useRef } from "react";
import { Download, FileArchive, Grid2x2, LoaderCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import {
  TILESET_COLS,
  TILESET_PRESETS,
  TILESET_ROWS,
  TILESET_SLOTS,
  TILESET_TILE_SIZE,
  TILE_TEMPLATE_MASK,
} from "@/features/studio/lib/tileset";
import type { TileSetRole, TileSetSlot, TileSetSlotSpec } from "@/features/studio/lib/tileset";
import {
  GeneratorLayout,
  PanelSection,
  RunFooter,
  RunHeader,
  useRunHint,
} from "@/features/studio/components/GeneratorLayout";
import {
  ArtStyleField,
  PresetSelect,
  PromptField,
  SceneBriefField,
  matchPreset,
} from "@/features/studio/components/fields";

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
    <li className="oa-checker group relative aspect-square" title={spec.hint}>
      {slot.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.imageUrl} alt={spec.hint} draggable={false} className="block h-full w-full object-contain" />
      ) : (
        <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10.5px] leading-[14px] text-ink-3">
          {spec.label}
        </span>
      )}

      {slot.generating && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
          <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-2" />
          <span className="sr-only">Generating {spec.label}</span>
        </span>
      )}

      {slot.imageUrl && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1 top-1 bg-surface px-1 text-[10px] leading-4 text-ink-2"
        >
          {spec.label}
        </span>
      )}

      {showActions && slot.imageUrl && !slot.generating && (
        <Button
          size="sm"
          icon
          onClick={onRegenerate}
          disabled={busy}
          aria-label={`Replace ${spec.label} tile`}
          title="Replace this tile with a separate call. It may not match the rest; for the best match, regenerate the whole sheet."
          className="absolute right-1 top-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <RefreshCw aria-hidden />
        </Button>
      )}
    </li>
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
      })
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
          })
      )
    ).then((loaded) => {
      if (cancelled) return;
      const imgByRole = new Map<TileSetRole, HTMLImageElement>();
      loaded.forEach(([role, img]) => {
        if (img) imgByRole.set(role, img);
      });

      // Transparent canvas over the checkerboard: only tile pixels are drawn.
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
      className="oa-checker flex w-full items-center justify-center overflow-hidden border-[1.5px] border-line p-3"
      style={{ aspectRatio: `${cols} / ${rows}` }}
    >
      <canvas
        ref={canvasRef}
        width={sheetW}
        height={sheetH}
        role="img"
        aria-label="Platform built from the current tiles"
        className="block h-auto w-full"
      />
    </div>
  );
}

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
  const ids = { preset: useId(), run: useId(), sheet: useId(), preview: useId() };
  const filledCount = tileSet.filter((s) => s.hasImage).length;
  const total = tileSet.length;
  const hasAny = filledCount > 0;
  const generatingAny = generating || tileSet.some((s) => s.generating);
  const canGenerate = !!prompt.trim();
  const runHint = useRunHint(1);
  const preset = matchPreset(TILESET_PRESETS, prompt);
  const materialName = preset?.label ?? (prompt.trim() ? "Custom material" : "Tile set");

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

  const form = (
    <>
      <PanelSection>
        <Field label="Material" htmlFor={ids.preset}>
          <PresetSelect
            id={ids.preset}
            presets={TILESET_PRESETS}
            prompt={prompt}
            setPrompt={setPrompt}
            disabled={generating}
          />
        </Field>
        <PromptField
          value={prompt}
          onChange={setPrompt}
          onSubmit={onGenerateAll}
          canSubmit={canGenerate && !generating}
          disabled={generating}
          placeholder="Weathered granite with moss along the top edge"
        />
        <ArtStyleField value={artStyle} onChange={setArtStyle} disabled={generating} />
      </PanelSection>
      <PanelSection>
        <SceneBriefField
          value={sceneBrief}
          onChange={setSceneBrief}
          loading={sceneBriefLoading}
          disabled={generating}
          placeholder="Shared palette and lighting for the whole scene"
          help="Reused from your parallax scene when you have one, so tiles match its palette and lighting."
        />
      </PanelSection>
      <PanelSection className="border-b-0">
        <p className="text-xs leading-[18px] text-ink-2">
          One call draws all {TILESET_SLOTS.length} tiles at {TILESET_TILE_SIZE} px as a{" "}
          {TILESET_COLS} × {TILESET_ROWS} sheet, ready for Unity, Godot, Phaser or Tiled.
        </p>
      </PanelSection>
    </>
  );

  const footer = (
    <RunFooter running={generating} message={progressMessage} onStop={onStop} hint={`${runHint} · 1 call`}>
      <Button variant="primary" size="lg" block onClick={onGenerateAll} disabled={!canGenerate}>
        <Sparkles aria-hidden />
        {hasAny ? "Regenerate sheet" : "Generate sheet"}
      </Button>
    </RunFooter>
  );

  return (
    <GeneratorLayout formLabel="Tile settings" form={form} footer={footer} resultsLabel="Tile results">
      {hasAny || generatingAny ? (
        <section aria-labelledby={ids.run} className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
          <RunHeader
            id={ids.run}
            title={materialName}
            meta={
              <>
                {artStyle !== "none" && <Badge>{findStyleLabel(artStyle)}</Badge>}
                <span className="text-xs text-ink-3">
                  {filledCount}/{total} tiles
                </span>
              </>
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearAll}
                  disabled={!hasAny || generating}
                  title="Clear all tiles and start over"
                >
                  <Trash2 aria-hidden />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={onDownloadZip}
                  disabled={!hasAny || generating}
                  aria-label="Download ZIP"
                  title="Tile PNGs, sheets and JSON manifest"
                >
                  <FileArchive aria-hidden />
                  ZIP
                </Button>
                <Button
                  size="sm"
                  onClick={onDownloadSheet}
                  disabled={!hasAny || generating}
                  aria-label="Download sheet PNG and manifest"
                  title="Clean and padded sheet PNGs with a JSON manifest"
                >
                  <Download aria-hidden />
                  Sheet PNG
                </Button>
              </>
            }
          />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 id={ids.sheet} className="oa-label">
                Sheet, {TILESET_COLS} × {TILESET_ROWS}
              </h3>
              <ol
                aria-labelledby={ids.sheet}
                className="grid w-full gap-px border-[1.5px] border-line bg-line"
                style={{ gridTemplateColumns: `repeat(${TILESET_COLS}, minmax(0, 1fr))` }}
              >
                {grid.flat().map((cell, i) =>
                  cell.empty || !cell.spec || !cell.slot ? (
                    <li key={`empty-${i}`} aria-hidden className="aspect-square bg-sunken" />
                  ) : (
                    <TileSlotCell
                      key={cell.spec.role}
                      slot={cell.slot}
                      spec={cell.spec}
                      onRegenerate={() => onRegenerate(cell.spec!.role)}
                      busy={generating}
                      showActions
                    />
                  )
                )}
              </ol>
            </div>
            <div className="flex flex-col gap-2">
              <h3 id={ids.preview} className="oa-label">
                Platform preview
              </h3>
              <PlatformPreview tileSet={tileSet} />
              <p className="text-xs leading-[18px] text-ink-2">
                Hover or focus a tile to replace it on its own. A single tile may drift from the
                rest; regenerate the sheet for the closest match.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <EmptyState
          className="m-auto w-full max-w-xl"
          icon={<Grid2x2 aria-hidden className="size-5" />}
          title="No tile set yet"
          description={`Pick a material or describe one, then generate. All ${TILESET_SLOTS.length} tiles arrive together as one sheet with a platform preview.`}
        />
      )}
    </GeneratorLayout>
  );
}
