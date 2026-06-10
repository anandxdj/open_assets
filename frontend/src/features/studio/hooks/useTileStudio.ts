"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Tile-set mode: one AI call paints a template-guided sheet → align → slice →
// per-role post-process (chroma key, tileability) → deterministic corner
// reconciliation → vision QA loop with keep-best commit.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  CORNER_GRAFTS,
  ENABLE_CORNER_RECONCILE,
  TILESET_ATLAS_EXTRUDE_PX,
  TILESET_BY_ROLE,
  TILESET_COLS,
  TILESET_PADDED_SHEET_H,
  TILESET_PADDED_SHEET_W,
  TILESET_PADDED_STRIDE,
  TILESET_ROWS,
  TILESET_SHEET_H,
  TILESET_SHEET_W,
  TILESET_SLOTS,
  TILESET_TILE_SIZE,
  TILE_TEMPLATE_CELL,
  TILE_TEMPLATE_COLS,
  TILE_TEMPLATE_H,
  TILE_TEMPLATE_ROWS,
  TILE_TEMPLATE_SAMPLES,
  TILE_TEMPLATE_W,
  alignAiOutputToTemplate,
  applyFeatheredRoleMask,
  buildTileSheetGuideDataUrl,
  createEmptyTileSet,
  rebuildCornerTile,
  reconcileAllCorners,
  templateRoleForCell,
} from "@/features/studio/lib/tileset";
import type { TileSetRole, TileSetSlot } from "@/features/studio/lib/tileset";
import {
  chromaKeyToAlpha,
  makeHorizontallyTileable,
  makeTileable2D,
  makeVerticallyTileable,
  sliceImageGrid,
} from "@/features/studio/lib/imageProcessor";
import { skipsArtDirectorReview } from "@/features/studio/lib/models";
import { StudioApiError, studioPost } from "@/features/studio/api/studioClient";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { useSceneBrief } from "@/features/studio/hooks/useSceneBrief";

// Aggressive chroma-key tuning for tile materials (no natural magenta cast).
const TILE_CHROMA_KEY_OPTS = {
  castThreshold: 40,
  castSoftness: 35,
  despill: 1,
  despillGreenBoost: 0.6,
};

export function useTileStudio() {
  const { apiKey, selectedModel, debugMode, refreshCredits } = useStudioSettings();
  const { sceneBrief, setSceneBrief, sceneBriefLoading } = useSceneBrief();

  const [tileSet, setTileSet] = useState<TileSetSlot[]>(() => createEmptyTileSet());
  const [tilePrompt, setTilePrompt] = useState("");
  const [artStyle, setArtStyle] = useState("none");
  const [generating, setGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const stopRef = useRef(false);

  const reportError = useCallback((err: unknown) => {
    if (err instanceof StudioApiError && err.code) {
      toast.error(
        err.code === "AUTH_REQUIRED"
          ? "Sign in for free credits, or add your OpenRouter key in Studio settings (gear icon)."
          : "Out of free credits. Add your own OpenRouter key in Studio settings to keep going.",
      );
      return;
    }
    toast.error(err instanceof Error ? err.message : "An error occurred");
  }, []);

  const patchTileSlot = useCallback((role: TileSetRole, patch: Partial<TileSetSlot>) => {
    setTileSet((prev) => prev.map((s) => (s.role === role ? { ...s, ...patch } : s)));
  }, []);

  // ── Post-processing ──────────────────────────────────────────────────────

  const enforceTileRoleMask = useCallback(
    async (role: TileSetRole, imageUrl: string): Promise<string> => {
      if (role === "body") return imageUrl;
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const w = img.width;
          const h = img.height;
          const qx = Math.round(w / 4);
          const qy = Math.round(h / 4);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get tile mask canvas context"));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          applyFeatheredRoleMask(imageData.data, w, h, role, qx, qy);
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => reject(new Error("Failed to load tile for mask enforcement"));
        img.src = imageUrl;
      });
    },
    [],
  );

  const postProcessTile = useCallback(
    async (role: TileSetRole, rawImageUrl: string): Promise<string> => {
      if (role === "body") {
        // Despill-only pass (nothing becomes transparent), then a strong 2D
        // tileable pass — body repeats everywhere, so drift reads as grid lines.
        const despilled = await chromaKeyToAlpha(rawImageUrl, {
          castThreshold: 256,
          castSoftness: 0,
          despill: 1,
          despillGreenBoost: 0.6,
        });
        return makeTileable2D(despilled, {
          equalizeStrength: 1,
          blendWidthPx: Math.round(TILESET_TILE_SIZE * 0.22),
          verticalBlendHeightPx: Math.round(TILESET_TILE_SIZE * 0.22),
        });
      }
      if (role === "top" || role === "bottom") {
        const tiled = await makeHorizontallyTileable(rawImageUrl);
        const keyed = await chromaKeyToAlpha(tiled, TILE_CHROMA_KEY_OPTS);
        return enforceTileRoleMask(role, keyed);
      }
      if (role === "left" || role === "right") {
        const tiled = await makeVerticallyTileable(rawImageUrl);
        const keyed = await chromaKeyToAlpha(tiled, TILE_CHROMA_KEY_OPTS);
        return enforceTileRoleMask(role, keyed);
      }
      const keyed = await chromaKeyToAlpha(rawImageUrl, TILE_CHROMA_KEY_OPTS);
      return enforceTileRoleMask(role, keyed);
    },
    [enforceTileRoleMask],
  );

  // ── Preview composites (for the QA art director) ─────────────────────────

  const buildTilePreviewCompositeDataUrl = useCallback(
    async (map: Partial<Record<TileSetRole, string>>): Promise<string | null> => {
      const rows = TILE_TEMPLATE_ROWS;
      const cols = TILE_TEMPLATE_COLS;
      const CELL = 96;
      const canvas = document.createElement("canvas");
      canvas.width = cols * CELL;
      canvas.height = rows * CELL;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, "#8cc3eb");
      g.addColorStop(1, "#28466e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const need = new Map<TileSetRole, string>();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const role = templateRoleForCell(x, y);
          if (role && map[role]) need.set(role, map[role] as string);
        }
      }
      const imgByRole = new Map<TileSetRole, HTMLImageElement>();
      await Promise.all(
        Array.from(need.entries()).map(
          ([role, src]) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                imgByRole.set(role, img);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = src;
            }),
        ),
      );
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const role = templateRoleForCell(x, y);
          if (!role) continue;
          const img = imgByRole.get(role);
          if (img) ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL);
        }
      }
      return canvas.toDataURL("image/png");
    },
    [],
  );

  const buildSheetFromMapDataUrl = useCallback(
    async (map: Partial<Record<TileSetRole, string>>): Promise<string | null> => {
      const entries = TILESET_SLOTS.filter((s) => map[s.role]);
      if (entries.length === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = TILESET_SHEET_W;
      canvas.height = TILESET_SHEET_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;
      await Promise.all(
        entries.map(
          (spec) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(
                  img,
                  spec.col * TILESET_TILE_SIZE,
                  spec.row * TILESET_TILE_SIZE,
                  TILESET_TILE_SIZE,
                  TILESET_TILE_SIZE,
                );
                resolve();
              };
              img.onerror = () => resolve();
              img.src = map[spec.role] as string;
            }),
        ),
      );
      return canvas.toDataURL("image/png");
    },
    [],
  );

  /** QA review — returns null (≈ approve) on any failure so a flaky critic
   * never blocks the user. */
  const fetchTileReview = useCallback(
    async (
      previewImage: string,
      sheetImage: string | null,
    ): Promise<{ ok: boolean; issues: string[]; fix: string } | null> => {
      try {
        const data = await studioPost<{ ok: boolean; issues: string[]; fix: string }>(
          "/api/studio/tile-review",
          {
            prompt: tilePrompt,
            sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
            model: undefined,
            previewImage,
            sheetImage: sheetImage || undefined,
          },
        );
        if (typeof data?.ok !== "boolean") return null;
        return data;
      } catch {
        return null;
      }
    },
    [tilePrompt, sceneBrief],
  );

  // ── Generate all ─────────────────────────────────────────────────────────

  const handleGenerateTileSet = useCallback(async () => {
    if (generating) return;
    if (!tilePrompt.trim()) {
      toast.error("Describe the material you want — e.g. mossy stone floor.");
      return;
    }
    stopRef.current = false;
    setGenerating(true);
    const startedAt = Date.now();
    const MAX_TILE_REVIEW_PASSES = 2;
    const skipReview = skipsArtDirectorReview(selectedModel);

    setTileSet((prev) => prev.map((s) => ({ ...s, generating: true })));

    let phase = "Generating sheet";
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setProgressMsg(`${phase} · ${elapsed}s`);
    }, 1000);

    const renderSheetOnce = async (
      fixNotes?: string,
    ): Promise<Partial<Record<TileSetRole, string>> | null> => {
      const tileGuideImage = buildTileSheetGuideDataUrl();
      const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
        prompt: tilePrompt,
        width: TILE_TEMPLATE_W,
        height: TILE_TEMPLATE_H,
        artStyle: artStyle !== "none" ? artStyle : undefined,
        model: selectedModel,
        tileSheet: true,
        tileGuideImage,
        tileFixNotes: fixNotes,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      });
      if (!data.imageUrl) throw new Error("No image returned from API");
      if (stopRef.current) return null;

      phase = "Aligning to template";
      const aligned = await alignAiOutputToTemplate(data.imageUrl);
      if (stopRef.current) return null;

      phase = "Slicing template";
      const cells = await sliceImageGrid(aligned, {
        cols: TILE_TEMPLATE_COLS,
        rows: TILE_TEMPLATE_ROWS,
        cellSize: TILE_TEMPLATE_CELL,
      });
      if (stopRef.current) return null;

      phase = "Processing tiles";
      const processed = await Promise.all(
        TILESET_SLOTS.map(async (spec) => {
          const sample = TILE_TEMPLATE_SAMPLES[spec.role];
          const cellIdx = sample.row * TILE_TEMPLATE_COLS + sample.col;
          const raw = cells[cellIdx];
          if (!raw) return { role: spec.role, imageUrl: null as string | null };
          try {
            const out = await postProcessTile(spec.role, raw);
            return { role: spec.role, imageUrl: out as string | null };
          } catch (err) {
            console.warn(`Post-process failed for ${spec.role}:`, err);
            return { role: spec.role, imageUrl: raw as string | null };
          }
        }),
      );

      phase = "Reconciling corners";
      const byRoleUrl: Partial<Record<TileSetRole, string>> = {};
      processed.forEach((p) => {
        if (p.imageUrl) byRoleUrl[p.role] = p.imageUrl;
      });
      let reconciled = byRoleUrl;
      try {
        reconciled = await reconcileAllCorners(byRoleUrl);
      } catch (err) {
        console.warn("Corner reconcile failed; using raw corners:", err);
      }
      return reconciled;
    };

    const applyMap = (map: Partial<Record<TileSetRole, string>>, reviewing: boolean) =>
      setTileSet((prev) =>
        prev.map((slot) => {
          const url = map[slot.role] ?? null;
          return {
            role: slot.role,
            imageUrl: url,
            hasImage: !!url,
            generating: reviewing && !!url,
          };
        }),
      );

    try {
      let fixNotes: string | undefined;
      // Keep-best across passes: the review loop can only improve on, never
      // regress, the first generation. score -1 = approved; else issue count.
      let best: { map: Partial<Record<TileSetRole, string>>; score: number } | null = null;

      for (let pass = 0; pass <= MAX_TILE_REVIEW_PASSES; pass++) {
        phase = pass === 0 ? "Generating sheet" : `Repainting (pass ${pass + 1})`;
        const reconciled = await renderSheetOnce(fixNotes);
        if (stopRef.current || !reconciled) return;

        applyMap(reconciled, true);

        if (skipReview) {
          if (debugMode) console.log("🧱 Skipping art director review for GPT image model");
          best = { map: reconciled, score: -1 };
          break;
        }

        phase = "Art director reviewing";
        setProgressMsg("Art director reviewing…");
        const [previewImage, sheetImage] = await Promise.all([
          buildTilePreviewCompositeDataUrl(reconciled),
          buildSheetFromMapDataUrl(reconciled),
        ]);
        if (stopRef.current) return;

        const review = previewImage ? await fetchTileReview(previewImage, sheetImage) : null;
        if (stopRef.current) return;

        const approved = !review || review.ok;
        const score = approved ? -1 : review.issues?.length || 1;
        if (!best || score < best.score) best = { map: reconciled, score };

        if (approved) {
          if (debugMode && review) console.log("🧱 QA approved the tileset");
          break;
        }

        fixNotes = review.fix || review.issues.join("; ");
        if (!fixNotes || pass === MAX_TILE_REVIEW_PASSES) break;

        if (debugMode) console.log("🧱 QA rejected, repainting with notes:", fixNotes);
        setProgressMsg("Issues found — repainting…");
      }

      if (best) applyMap(best.map, false);
    } catch (err) {
      setTileSet((prev) => prev.map((s) => ({ ...s, generating: false })));
      reportError(err);
    } finally {
      clearInterval(tickHandle);
      setGenerating(false);
      setProgressMsg(null);
      if (!apiKey) void refreshCredits();
      if (debugMode) {
        console.log(`🧱 Tile-set generated in ${Math.floor((Date.now() - startedAt) / 1000)}s`);
      }
    }
  }, [generating, tilePrompt, artStyle, selectedModel, sceneBrief, debugMode, postProcessTile, buildTilePreviewCompositeDataUrl, buildSheetFromMapDataUrl, fetchTileReview, reportError, apiKey, refreshCredits]);

  const handleStopTileSet = useCallback(() => {
    stopRef.current = true;
  }, []);

  // ── Single-tile regenerate ───────────────────────────────────────────────

  const handleRegenerateTile = useCallback(
    async (role: TileSetRole) => {
      if (generating) return;
      if (!tilePrompt.trim()) {
        toast.error("Describe the material you want before regenerating tiles.");
        return;
      }
      setGenerating(true);
      const slot = TILESET_BY_ROLE[role];
      const labelLower = slot.label.toLowerCase();
      setProgressMsg(`Generating ${labelLower}…`);
      patchTileSlot(role, { generating: true });

      try {
        const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
          prompt: tilePrompt,
          width: TILESET_TILE_SIZE,
          height: TILESET_TILE_SIZE,
          artStyle: artStyle !== "none" ? artStyle : undefined,
          model: selectedModel,
          tileMode: true,
          tileRole: role,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        });
        if (!data.imageUrl) throw new Error("No image returned from API");

        setProgressMsg(`Processing ${labelLower}…`);
        const processed = await postProcessTile(role, data.imageUrl);

        const neighborUrls: Partial<Record<TileSetRole, string>> = {};
        tileSet.forEach((s) => {
          if (s.imageUrl && s.role !== role) neighborUrls[s.role] = s.imageUrl;
        });

        const isCorner = !!CORNER_GRAFTS[role];
        if (ENABLE_CORNER_RECONCILE && isCorner) {
          let finalUrl = processed;
          try {
            finalUrl = await rebuildCornerTile(role, processed, neighborUrls);
          } catch {
            /* fall back to the raw corner */
          }
          patchTileSlot(role, { imageUrl: finalUrl, hasImage: true, generating: false });
          return;
        }

        patchTileSlot(role, { imageUrl: processed, hasImage: true, generating: false });

        // Edge/body changed → rebuild every corner against the new neighbor.
        const affectsCorners =
          role === "top" || role === "bottom" || role === "left" || role === "right" || role === "body";
        if (affectsCorners && ENABLE_CORNER_RECONCILE) {
          const updatedNeighbors = { ...neighborUrls, [role]: processed };
          await Promise.all(
            (Object.keys(CORNER_GRAFTS) as TileSetRole[]).map(async (cRole) => {
              const cUrl = tileSet.find((s) => s.role === cRole)?.imageUrl;
              if (!cUrl) return;
              try {
                const rebuilt = await rebuildCornerTile(cRole, cUrl, updatedNeighbors);
                patchTileSlot(cRole, { imageUrl: rebuilt });
              } catch {
                /* leave the corner as-is on failure */
              }
            }),
          );
        }
      } catch (err) {
        patchTileSlot(role, { generating: false });
        reportError(err);
      } finally {
        setGenerating(false);
        setProgressMsg(null);
        if (!apiKey) void refreshCredits();
      }
    },
    [generating, tilePrompt, artStyle, selectedModel, sceneBrief, tileSet, postProcessTile, patchTileSlot, reportError, apiKey, refreshCredits],
  );

  const handleClearTileSet = useCallback(() => {
    setTileSet(createEmptyTileSet());
    setTilePrompt("");
    setProgressMsg(null);
    stopRef.current = false;
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────

  const buildTileSheetDataUrl = useCallback(async (): Promise<string | null> => {
    const map: Partial<Record<TileSetRole, string>> = {};
    tileSet.forEach((s) => {
      if (s.imageUrl) map[s.role] = s.imageUrl;
    });
    return buildSheetFromMapDataUrl(map);
  }, [tileSet, buildSheetFromMapDataUrl]);

  const buildPaddedTileSheetDataUrl = useCallback(async (): Promise<string | null> => {
    const populated = tileSet.filter((s) => s.imageUrl);
    if (populated.length === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = TILESET_PADDED_SHEET_W;
    canvas.height = TILESET_PADDED_SHEET_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    await Promise.all(
      populated.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            if (!slot.imageUrl) {
              resolve();
              return;
            }
            const spec = TILESET_BY_ROLE[slot.role];
            const img = new Image();
            img.onload = () => {
              const x = spec.col * TILESET_PADDED_STRIDE;
              const y = spec.row * TILESET_PADDED_STRIDE;
              const p = TILESET_ATLAS_EXTRUDE_PX;

              ctx.drawImage(img, x + p, y + p, TILESET_TILE_SIZE, TILESET_TILE_SIZE);
              // Extruded edges.
              ctx.drawImage(img, 0, 0, TILESET_TILE_SIZE, 1, x + p, y, TILESET_TILE_SIZE, p);
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE, 1, x + p, y + p + TILESET_TILE_SIZE, TILESET_TILE_SIZE, p);
              ctx.drawImage(img, 0, 0, 1, TILESET_TILE_SIZE, x, y + p, p, TILESET_TILE_SIZE);
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, TILESET_TILE_SIZE, x + p + TILESET_TILE_SIZE, y + p, p, TILESET_TILE_SIZE);
              // Extruded corners.
              ctx.drawImage(img, 0, 0, 1, 1, x, y, p, p);
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, 1, x + p + TILESET_TILE_SIZE, y, p, p);
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, 1, 1, x, y + p + TILESET_TILE_SIZE, p, p);
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE - 1, 1, 1, x + p + TILESET_TILE_SIZE, y + p + TILESET_TILE_SIZE, p, p);
              resolve();
            };
            img.onerror = () => reject(new Error(`Failed to load ${spec.role}`));
            img.src = slot.imageUrl;
          }),
      ),
    );

    return canvas.toDataURL("image/png");
  }, [tileSet]);

  const buildTileSetManifest = useCallback(
    () => ({
      version: 1,
      tileSize: TILESET_TILE_SIZE,
      cols: TILESET_COLS,
      rows: TILESET_ROWS,
      sheetWidth: TILESET_SHEET_W,
      sheetHeight: TILESET_SHEET_H,
      productionAtlas: {
        fileName: "sheet_padded.png",
        tileSize: TILESET_TILE_SIZE,
        extrudePx: TILESET_ATLAS_EXTRUDE_PX,
        stride: TILESET_PADDED_STRIDE,
        sheetWidth: TILESET_PADDED_SHEET_W,
        sheetHeight: TILESET_PADDED_SHEET_H,
        importNote:
          "Use each tile source rect at paddedX/paddedY with width/height tileSize. Keep the surrounding extruded pixels in the atlas to prevent filtering seams.",
      },
      prompt: tilePrompt,
      sceneBrief: sceneBrief.trim() || null,
      artStyle: artStyle !== "none" ? artStyle : null,
      tiles: TILESET_SLOTS.map((spec) => {
        const slot = tileSet.find((s) => s.role === spec.role);
        return {
          role: spec.role,
          label: spec.label,
          col: spec.col,
          row: spec.row,
          index: spec.row * TILESET_COLS + spec.col,
          fileName: `${spec.fileName}.png`,
          present: !!slot?.imageUrl,
          sourceX: spec.col * TILESET_TILE_SIZE,
          sourceY: spec.row * TILESET_TILE_SIZE,
          paddedX: spec.col * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
          paddedY: spec.row * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
        };
      }),
    }),
    [tileSet, tilePrompt, sceneBrief, artStyle],
  );

  const handleDownloadTileSheet = useCallback(async () => {
    try {
      const sheet = await buildTileSheetDataUrl();
      if (!sheet) {
        toast.error("Generate at least one tile before downloading the sheet.");
        return;
      }
      const baseName = (tilePrompt.trim().slice(0, 24) || "tileset").replace(/[^a-z0-9]+/gi, "_");
      const link = document.createElement("a");
      link.href = sheet;
      link.download = `${baseName}_sheet_${TILESET_SHEET_W}x${TILESET_SHEET_H}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const paddedSheet = await buildPaddedTileSheetDataUrl();
      if (paddedSheet) {
        const linkPadded = document.createElement("a");
        linkPadded.href = paddedSheet;
        linkPadded.download = `${baseName}_sheet_padded_${TILESET_PADDED_SHEET_W}x${TILESET_PADDED_SHEET_H}.png`;
        document.body.appendChild(linkPadded);
        linkPadded.click();
        document.body.removeChild(linkPadded);
      }

      const json = JSON.stringify(buildTileSetManifest(), null, 2);
      const jsonUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const linkJson = document.createElement("a");
      linkJson.href = jsonUrl;
      linkJson.download = `${baseName}_manifest.json`;
      document.body.appendChild(linkJson);
      linkJson.click();
      document.body.removeChild(linkJson);
      URL.revokeObjectURL(jsonUrl);
    } catch (err) {
      reportError(err);
    }
  }, [buildTileSheetDataUrl, buildPaddedTileSheetDataUrl, buildTileSetManifest, tilePrompt, reportError]);

  const handleDownloadTileSetZip = useCallback(async () => {
    try {
      const populated = tileSet.filter((s) => s.imageUrl);
      if (populated.length === 0) {
        toast.error("Generate at least one tile before exporting the ZIP.");
        return;
      }
      const zip = new JSZip();
      for (const slot of populated) {
        if (!slot.imageUrl) continue;
        const spec = TILESET_BY_ROLE[slot.role];
        const base64 = slot.imageUrl.split(",")[1];
        if (base64) zip.file(`${spec.fileName}.png`, base64, { base64: true });
      }
      const sheet = await buildTileSheetDataUrl();
      if (sheet) {
        const base64 = sheet.split(",")[1];
        if (base64) zip.file("sheet.png", base64, { base64: true });
      }
      const paddedSheet = await buildPaddedTileSheetDataUrl();
      if (paddedSheet) {
        const base64 = paddedSheet.split(",")[1];
        if (base64) zip.file("sheet_padded.png", base64, { base64: true });
      }
      zip.file("manifest.json", JSON.stringify(buildTileSetManifest(), null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const baseName = (tilePrompt.trim().slice(0, 24) || "tileset").replace(/[^a-z0-9]+/gi, "_");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}_tileset.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      reportError(err);
    }
  }, [tileSet, buildTileSheetDataUrl, buildPaddedTileSheetDataUrl, buildTileSetManifest, tilePrompt, reportError]);

  return {
    tileSet,
    tilePrompt,
    setTilePrompt,
    artStyle,
    setArtStyle,
    generating,
    progressMsg,
    sceneBrief,
    setSceneBrief,
    sceneBriefLoading,
    handleGenerateTileSet,
    handleStopTileSet,
    handleRegenerateTile,
    handleClearTileSet,
    handleDownloadTileSheet,
    handleDownloadTileSetZip,
  };
}
