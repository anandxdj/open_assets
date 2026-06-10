"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Props mode: an ever-growing decoration library. Each batch is a two-call
// pipeline — a reasoning art director invents fresh categories (text dedup vs
// the existing library), then the image model paints them against a style
// anchor built from earlier props.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  PROP_BATCH,
  PROP_BATCH_COLS,
  PROP_BATCH_H,
  PROP_BATCH_ROWS,
  PROP_BATCH_W,
  PROP_TILE_SIZE,
  nextPropId,
  propAtlasLayout,
  resolvePropNames,
} from "@/features/studio/lib/props";
import type { PropItem } from "@/features/studio/lib/props";
import {
  chromaKeyToAlpha,
  removeFrameBorder,
  sliceImageGrid,
} from "@/features/studio/lib/imageProcessor";
import { StudioApiError, studioPost } from "@/features/studio/api/studioClient";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { useSceneBrief } from "@/features/studio/hooks/useSceneBrief";

// Props are colorful — moderate chroma-key so saturated colors survive.
const PROP_CHROMA_KEY_OPTS = {
  castThreshold: 70,
  castSoftness: 30,
  despill: 1,
  despillGreenBoost: 0.5,
};

export function usePropStudio() {
  const { apiKey, selectedModel, debugMode, refreshCredits } = useStudioSettings();
  const { sceneBrief, setSceneBrief, sceneBriefLoading } = useSceneBrief();

  const [propItems, setPropItems] = useState<PropItem[]>([]);
  const [propPrompt, setPropPrompt] = useState("");
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

  /** Magenta → alpha for one sliced prop cell, then trim cell-edge bleed. */
  const postProcessProp = useCallback(async (rawCellUrl: string): Promise<string> => {
    const keyed = await chromaKeyToAlpha(rawCellUrl, PROP_CHROMA_KEY_OPTS);
    try {
      return await removeFrameBorder(keyed);
    } catch {
      return keyed;
    }
  }, []);

  /** Fixed-size style anchor: ≤9 props sampled evenly across the library,
   * drawn on magenta so the model reads them in its output convention. */
  const buildPropStyleRefDataUrl = useCallback(
    async (items: PropItem[]): Promise<string | undefined> => {
      const all = items.filter((p) => p.imageUrl);
      if (all.length === 0) return undefined;
      const CAP = 9;
      let withImg: PropItem[];
      if (all.length <= CAP) {
        withImg = all;
      } else {
        withImg = [];
        for (let i = 0; i < CAP; i++) {
          withImg.push(all[Math.floor((i * all.length) / CAP)]);
        }
      }
      const cell = 200;
      const cols = Math.min(3, withImg.length);
      const rows = Math.ceil(withImg.length / cols);
      const canvas = document.createElement("canvas");
      canvas.width = cols * cell;
      canvas.height = rows * cell;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.fillStyle = "#FF00FF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      await Promise.all(
        withImg.map(
          (p, i) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                ctx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
                resolve();
              };
              img.onerror = () => resolve();
              img.src = p.imageUrl as string;
            }),
        ),
      );
      return canvas.toDataURL("image/png");
    },
    [],
  );

  const propCategoriesOf = (items: PropItem[]): string[] => {
    const seen = new Set<string>();
    for (const p of items) {
      const n = (p.name || "").trim().toLowerCase();
      if (n) seen.add(n);
    }
    return Array.from(seen);
  };

  /** CALL #1 — art director invents the next `count` fresh decoration ideas.
   * Returns [] on failure so callers fall back to free invention. */
  const fetchPropIdeas = useCallback(
    async (
      count: number,
      items: PropItem[],
    ): Promise<{ category: string; description: string }[]> => {
      try {
        const data = await studioPost<{ ideas: { category: string; description: string }[] }>(
          "/api/studio/prop-brief",
          {
            prompt: propPrompt,
            sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
            artStyle: artStyle !== "none" ? artStyle : undefined,
            count,
            existing: propCategoriesOf(items),
          },
        );
        return Array.isArray(data.ideas) ? data.ideas : [];
      } catch {
        return [];
      }
    },
    [propPrompt, sceneBrief, artStyle],
  );

  // ── Batch generation ─────────────────────────────────────────────────────

  const handleAddPropBatch = useCallback(async () => {
    if (generating) return;
    if (!propPrompt.trim()) {
      toast.error("Describe the biome / palette — e.g. lush forest decorations.");
      return;
    }
    stopRef.current = false;
    setGenerating(true);
    const startedAt = Date.now();

    const existing = propItems.filter((p) => p.imageUrl);
    const batchIds = Array.from({ length: PROP_BATCH }, () => nextPropId());
    const batchIdSet = new Set(batchIds);
    setPropItems((prev) => [
      ...prev,
      ...batchIds.map((id) => ({ id, imageUrl: null, generating: true })),
    ]);

    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setProgressMsg(
        `${existing.length ? "Adding" : "Generating"} ${PROP_BATCH} props · ${elapsed}s`,
      );
    }, 1000);

    const dropBatch = () => setPropItems((prev) => prev.filter((p) => !batchIdSet.has(p.id)));

    try {
      const refImage = await buildPropStyleRefDataUrl(existing);

      // CALL #1 — art director plans fresh categories (non-fatal on failure).
      setProgressMsg("Art director planning…");
      const ideas = await fetchPropIdeas(PROP_BATCH, existing);
      const briefs = ideas.map((i) => i.description);
      const cats = ideas.map((i) => i.category);

      // CALL #2 — render exactly the planned list, matched to the style anchor.
      const data = await studioPost<{ imageUrl: string; names?: string[] }>(
        "/api/studio/generate",
        {
          prompt: propPrompt,
          width: PROP_BATCH_W,
          height: PROP_BATCH_H,
          artStyle: artStyle !== "none" ? artStyle : undefined,
          model: selectedModel,
          propSheet: true,
          propCols: PROP_BATCH_COLS,
          propRows: PROP_BATCH_ROWS,
          propCount: PROP_BATCH,
          propRefImage: refImage,
          propList: briefs.length ? briefs : undefined,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        },
      );
      if (!data.imageUrl) throw new Error("No image returned from API");
      if (stopRef.current) {
        dropBatch();
        return;
      }

      setProgressMsg("Slicing…");
      const cells = await sliceImageGrid(data.imageUrl, {
        cols: PROP_BATCH_COLS,
        rows: PROP_BATCH_ROWS,
        cellSize: PROP_TILE_SIZE,
      });
      if (stopRef.current) {
        dropBatch();
        return;
      }

      setProgressMsg("Processing…");
      const processed = await Promise.all(
        batchIds.map(async (_id, i) => {
          const raw = cells[i];
          if (!raw) return null;
          try {
            return await postProcessProp(raw);
          } catch {
            return raw;
          }
        }),
      );
      if (stopRef.current) {
        dropBatch();
        return;
      }

      // Fill placeholders; tag each prop with the art director's category
      // (falls back to the model-returned ITEMS list when planning failed).
      const fallbackNames = Array.isArray(data.names) ? data.names : [];
      const urlById = new Map<string, string>();
      const nameById = new Map<string, string>();
      batchIds.forEach((id, i) => {
        const url = processed[i];
        if (url) {
          urlById.set(id, url);
          const name = cats[i] || fallbackNames[i];
          if (name) nameById.set(id, name);
        }
      });
      setPropItems((prev) =>
        prev
          .map((p) =>
            batchIdSet.has(p.id)
              ? {
                  ...p,
                  imageUrl: urlById.get(p.id) ?? null,
                  name: nameById.get(p.id),
                  generating: false,
                }
              : p,
          )
          .filter((p) => !(batchIdSet.has(p.id) && !p.imageUrl)),
      );
    } catch (err) {
      dropBatch();
      reportError(err);
    } finally {
      clearInterval(tickHandle);
      setGenerating(false);
      setProgressMsg(null);
      if (!apiKey) void refreshCredits();
      if (debugMode) {
        console.log(`🌿 Prop batch generated in ${Math.floor((Date.now() - startedAt) / 1000)}s`);
      }
    }
  }, [generating, propPrompt, propItems, artStyle, selectedModel, sceneBrief, debugMode, buildPropStyleRefDataUrl, fetchPropIdeas, postProcessProp, reportError, apiKey, refreshCredits]);

  const handleStopPropSet = useCallback(() => {
    stopRef.current = true;
  }, []);

  /** Re-roll a single prop in place, style-matched to the rest. */
  const handleRegenerateProp = useCallback(
    async (id: string) => {
      if (generating) return;
      if (!propPrompt.trim()) {
        toast.error("Describe the biome first, then re-roll an individual prop.");
        return;
      }
      setPropItems((prev) => prev.map((p) => (p.id === id ? { ...p, generating: true } : p)));
      setProgressMsg("Re-rolling prop…");
      try {
        const others = propItems.filter((p) => p.id !== id && p.imageUrl);
        const refImage = await buildPropStyleRefDataUrl(others);
        const ideas = await fetchPropIdeas(1, others);
        const idea = ideas[0];
        const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
          prompt: propPrompt,
          width: PROP_TILE_SIZE,
          height: PROP_TILE_SIZE,
          artStyle: artStyle !== "none" ? artStyle : undefined,
          model: selectedModel,
          propMode: true,
          propRole: idea?.description,
          propRefImage: refImage,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        });
        if (!data.imageUrl) throw new Error("No image returned from API");
        setProgressMsg("Processing…");
        const processed = await postProcessProp(data.imageUrl);
        setPropItems((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, imageUrl: processed, name: idea?.category, generating: false }
              : p,
          ),
        );
      } catch (err) {
        setPropItems((prev) => prev.map((p) => (p.id === id ? { ...p, generating: false } : p)));
        reportError(err);
      } finally {
        setProgressMsg(null);
        if (!apiKey) void refreshCredits();
      }
    },
    [generating, propPrompt, propItems, artStyle, selectedModel, sceneBrief, buildPropStyleRefDataUrl, fetchPropIdeas, postProcessProp, reportError, apiKey, refreshCredits],
  );

  const handleDeleteProp = useCallback((id: string) => {
    setPropItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleClearPropSet = useCallback(() => {
    setPropItems([]);
    setProgressMsg(null);
    stopRef.current = false;
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────

  const buildPropAtlasDataUrl = useCallback(async (): Promise<string | null> => {
    const populated = propItems.filter((p) => p.imageUrl);
    if (populated.length === 0) return null;
    const layout = propAtlasLayout(populated.length);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    await Promise.all(
      populated.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            const r = layout.rect(i);
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, r.x, r.y, r.width, r.height);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = p.imageUrl as string;
          }),
      ),
    );
    return canvas.toDataURL("image/png");
  }, [propItems]);

  const buildPropManifest = useCallback(() => {
    const populated = propItems.filter((p) => p.imageUrl);
    const layout = propAtlasLayout(populated.length);
    const names = resolvePropNames(populated);
    return {
      type: "prop-atlas",
      generator: "OpenAssets Studio — Props",
      prompt: propPrompt.trim() || null,
      sceneBrief: sceneBrief.trim() || null,
      sheet: { width: layout.width, height: layout.height },
      grid: { cols: layout.cols, rows: layout.rows, cellSize: PROP_TILE_SIZE },
      count: populated.length,
      props: populated.map((p, i) => {
        const r = layout.rect(i);
        return {
          id: p.id,
          name: names[i].name,
          file: names[i].file,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      }),
    };
  }, [propItems, propPrompt, sceneBrief]);

  const handleDownloadPropSheet = useCallback(async () => {
    try {
      const sheet = await buildPropAtlasDataUrl();
      if (!sheet) {
        toast.error("Generate at least one prop before downloading the atlas.");
        return;
      }
      const baseName = (propPrompt.trim().slice(0, 24) || "props").replace(/[^a-z0-9]+/gi, "_");
      const link = document.createElement("a");
      link.href = sheet;
      link.download = `${baseName}_props_atlas.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const json = JSON.stringify(buildPropManifest(), null, 2);
      const jsonUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const linkJson = document.createElement("a");
      linkJson.href = jsonUrl;
      linkJson.download = `${baseName}_props_manifest.json`;
      document.body.appendChild(linkJson);
      linkJson.click();
      document.body.removeChild(linkJson);
      URL.revokeObjectURL(jsonUrl);
    } catch (err) {
      reportError(err);
    }
  }, [buildPropAtlasDataUrl, buildPropManifest, propPrompt, reportError]);

  const handleDownloadPropZip = useCallback(async () => {
    try {
      const populated = propItems.filter((p) => p.imageUrl);
      if (populated.length === 0) {
        toast.error("Generate at least one prop before exporting the ZIP.");
        return;
      }
      const zip = new JSZip();
      const names = resolvePropNames(populated);
      populated.forEach((p, i) => {
        const base64 = (p.imageUrl as string).split(",")[1];
        if (base64) zip.file(names[i].file, base64, { base64: true });
      });
      const sheet = await buildPropAtlasDataUrl();
      if (sheet) {
        const base64 = sheet.split(",")[1];
        if (base64) zip.file("props_atlas.png", base64, { base64: true });
      }
      zip.file("manifest.json", JSON.stringify(buildPropManifest(), null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const baseName = (propPrompt.trim().slice(0, 24) || "props").replace(/[^a-z0-9]+/gi, "_");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}_props.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      reportError(err);
    }
  }, [propItems, buildPropAtlasDataUrl, buildPropManifest, propPrompt, reportError]);

  return {
    propItems,
    propPrompt,
    setPropPrompt,
    artStyle,
    setArtStyle,
    generating,
    progressMsg,
    sceneBrief,
    setSceneBrief,
    sceneBriefLoading,
    handleAddPropBatch,
    handleStopPropSet,
    handleRegenerateProp,
    handleDeleteProp,
    handleClearPropSet,
    handleDownloadPropSheet,
    handleDownloadPropZip,
  };
}
