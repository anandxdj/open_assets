"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Parallax-mode state machine: 4 depth layers (sky/far/mid/near), keyed-layer
// extension, auto-extend-to-target loop, seam harmonize, tileable healing,
// and ZIP export with an engine-friendly manifest.

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import type { Candidate, Direction } from "@/features/studio/lib/app";
import {
  LAYER_ORDER,
  LAYER_ROLES,
  PARALLAX_MAX_AUTO_STEPS,
  WORKFLOW_ORDER,
  createDefaultLayers,
  getRecommendedLayerIndex,
} from "@/features/studio/lib/parallax";
import type { LayerRole, ParallaxLayer } from "@/features/studio/lib/parallax";
import {
  chromaKeyToAlpha,
  getImageDimensions,
  harmonizeHorizontalSeams,
  makeHorizontallyTileable,
} from "@/features/studio/lib/imageProcessor";
import { runExtendCore } from "@/features/studio/lib/extendRunner";
import { StudioApiError, studioPost } from "@/features/studio/api/studioClient";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { useSceneBrief } from "@/features/studio/hooks/useSceneBrief";

export type Dims = { width: number; height: number };

export function useParallax() {
  const { apiKey, selectedModel, debugMode, refreshCredits } = useStudioSettings();
  const { sceneBrief, setSceneBrief, sceneBriefLoading, deriveSceneBrief } = useSceneBrief();

  const [layers, setLayers] = useState<ParallaxLayer[]>(() => createDefaultLayers());
  const [activeIdx, setActiveIdx] = useState(() => LAYER_ORDER.indexOf(WORKFLOW_ORDER[0]));
  const [targetWidth, setTargetWidth] = useState<number | null>(null);
  const [autoExtending, setAutoExtending] = useState(false);
  const autoStopRef = useRef(false);

  // Candidate review state (mirrors useExtender, but writes back to layers)
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [candidateDims, setCandidateDims] = useState<Array<Dims | null>>([]);
  const [imageBeforeExtension, setImageBeforeExtension] = useState<string | null>(null);
  const [lastExtensionParams, setLastExtensionParams] = useState<{
    direction: Direction;
    customPrompt: string;
    artStyle: string;
    layerRole?: LayerRole;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("none");

  // Generate-modal state
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateWidth, setGenerateWidth] = useState(1280);
  const [generateHeight, setGenerateHeight] = useState(720);
  const [generating, setGenerating] = useState(false);

  const activeLayer: ParallaxLayer | null = layers[activeIdx] ?? null;

  const reportError = useCallback((err: unknown) => {
    if (err instanceof StudioApiError) {
      if (err.code === "AUTH_REQUIRED") {
        toast.error("Sign in for free credits, or add your OpenRouter key in Studio settings (gear icon).");
        return;
      }
      if (err.code === "INSUFFICIENT_CREDITS") {
        toast.error("Out of free credits. Add your own OpenRouter key in Studio settings to keep going.");
        return;
      }
    }
    toast.error(err instanceof Error ? err.message : "An error occurred");
  }, []);

  // ── Layer helpers ─────────────────────────────────────────────────────────

  const patchActiveLayer = useCallback(
    (patch: Partial<ParallaxLayer>) => {
      setLayers((prev) => prev.map((l, i) => (i === activeIdx ? { ...l, ...patch } : l)));
    },
    [activeIdx],
  );

  const setLayerScrollSpeed = useCallback((idx: number, speed: number) => {
    setLayers((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, scrollSpeed: Math.max(0, speed) } : l)),
    );
  }, []);

  const clearLayer = useCallback((idx: number) => {
    setLayers((prev) =>
      prev.map((l, i) =>
        i === idx
          ? { ...l, imageUrl: null, rawImageUrl: null, width: null, height: null, fromUpload: false }
          : l,
      ),
    );
  }, []);

  /** Apply an uploaded/generated image to the active layer. Keyed layers from
   * generation get chroma-keyed for display; uploads are trusted alpha. */
  const applyImageToActiveLayer = useCallback(
    async (imageUrl: string, options: { fromUpload: boolean }) => {
      const layer = layers[activeIdx];
      if (!layer) return;
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque;
      const dims = await getImageDimensions(imageUrl);
      let displayImage = imageUrl;
      const rawImage: string | null = imageUrl;
      if (isKeyed && !options.fromUpload) {
        displayImage = await chromaKeyToAlpha(imageUrl);
      }
      const updatedLayers = layers.map((l, i) =>
        i === activeIdx
          ? {
              ...l,
              imageUrl: displayImage,
              rawImageUrl: rawImage,
              width: dims.width,
              height: dims.height,
              fromUpload: options.fromUpload,
            }
          : l,
      );
      setLayers(updatedLayers);
      // Nudge workflow: jump to the next empty layer in front→back order.
      const nextIdx = getRecommendedLayerIndex(updatedLayers);
      if (nextIdx !== null && nextIdx !== activeIdx) {
        setActiveIdx(nextIdx);
      }
    },
    [layers, activeIdx],
  );

  // Switching layers wipes in-flight review state so a stale candidate from
  // layer N never renders over layer M.
  const selectLayer = useCallback((idx: number) => {
    setActiveIdx(idx);
    setCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
  }, []);

  // ── Candidates ───────────────────────────────────────────────────────────

  const adoptCandidates = useCallback((next: Candidate[]) => {
    setCandidates(next);
    setSelectedCandidateIdx(0);
    setCandidateDims(new Array(next.length).fill(null));
    next.forEach((c, idx) => {
      const img = new Image();
      img.onload = () => {
        setCandidateDims((prev) => {
          const out = prev.slice();
          out[idx] = { width: img.width, height: img.height };
          return out;
        });
      };
      img.src = c.imageUrl;
    });
  }, []);

  const activeCandidate: Candidate | null =
    candidates.length > 0
      ? candidates[Math.min(selectedCandidateIdx, candidates.length - 1)]
      : null;

  const cycleVariant = useCallback(
    (delta: 1 | -1) => {
      if (candidates.length <= 1) return;
      setSelectedCandidateIdx((prev) => {
        const n = candidates.length;
        return (prev + delta + n) % n;
      });
    },
    [candidates.length],
  );

  // ── Extend ───────────────────────────────────────────────────────────────

  const handleExtend = useCallback(
    async (direction: Direction) => {
      if (loading || autoExtending) return;
      const layer = activeLayer;
      if (!layer?.imageUrl) return;
      const sourceImage = layer.rawImageUrl ?? layer.imageUrl;
      setLoading(true);
      setProgressMsg(`Extending ${direction}…`);
      setActiveDirection(direction);
      setImageBeforeExtension(sourceImage);
      setLastExtensionParams({ direction, customPrompt, artStyle, layerRole: layer.role });

      try {
        const next = await runExtendCore({
          direction,
          sourceImage,
          promptText: customPrompt,
          style: artStyle,
          model: selectedModel,
          debugMode,
          layerRole: layer.role,
          sceneBrief,
          onProgress: setProgressMsg,
        });
        adoptCandidates(next);
      } catch (err) {
        reportError(err);
        setActiveDirection(null);
      } finally {
        setLoading(false);
        setProgressMsg(null);
        if (!apiKey) void refreshCredits();
      }
    },
    [loading, autoExtending, activeLayer, customPrompt, artStyle, selectedModel, debugMode, sceneBrief, adoptCandidates, reportError, apiKey, refreshCredits],
  );

  const handleRegenerate = useCallback(async () => {
    if (!lastExtensionParams || !imageBeforeExtension || loading) return;
    setLoading(true);
    setProgressMsg(`Regenerating ${lastExtensionParams.direction}…`);
    try {
      const next = await runExtendCore({
        direction: lastExtensionParams.direction,
        sourceImage: imageBeforeExtension,
        promptText: lastExtensionParams.customPrompt,
        style: lastExtensionParams.artStyle,
        model: selectedModel,
        debugMode,
        layerRole: lastExtensionParams.layerRole,
        sceneBrief,
        onProgress: setProgressMsg,
      });
      adoptCandidates(next);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
      setProgressMsg(null);
      if (!apiKey) void refreshCredits();
    }
  }, [lastExtensionParams, imageBeforeExtension, loading, selectedModel, debugMode, sceneBrief, adoptCandidates, reportError, apiKey, refreshCredits]);

  const handleAccept = useCallback(() => {
    if (!activeCandidate || !activeLayer) return;
    const dims = candidateDims[selectedCandidateIdx];
    patchActiveLayer({
      imageUrl: activeCandidate.imageUrl,
      rawImageUrl: activeCandidate.rawImageUrl ?? activeCandidate.imageUrl,
      width: dims?.width ?? activeLayer.width,
      height: dims?.height ?? activeLayer.height,
    });
    setCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
  }, [activeCandidate, activeLayer, candidateDims, selectedCandidateIdx, patchActiveLayer]);

  const handleDiscard = useCallback(() => {
    setCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
  }, []);

  // ── Generate (text-to-image into the active layer) ───────────────────────

  /** Pre-fill role defaults; same-role regenerations keep exact dims. */
  const openGenerateModal = useCallback(() => {
    if (activeLayer) {
      const spec = LAYER_ROLES[activeLayer.role];
      if (activeLayer.width && activeLayer.height) {
        setGenerateWidth(activeLayer.width);
        setGenerateHeight(activeLayer.height);
      } else {
        setGenerateWidth(spec.defaultWidth);
        setGenerateHeight(spec.defaultHeight);
      }
      setGeneratePrompt((prev) => (prev.trim() ? prev : spec.defaultPrompt));
    }
    setGenerateOpen(true);
  }, [activeLayer]);

  const handleGenerateImage = useCallback(async () => {
    if (!generatePrompt.trim()) {
      toast.error("Please describe the image you want to generate.");
      return;
    }
    const layerRole = activeLayer?.role;
    setGenerating(true);
    try {
      const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
        prompt: generatePrompt,
        width: generateWidth,
        height: generateHeight,
        artStyle: artStyle !== "none" ? artStyle : undefined,
        model: selectedModel,
        layerRole,
        sceneBrief:
          layerRole && layerRole !== WORKFLOW_ORDER[0] && sceneBrief.trim()
            ? sceneBrief.trim()
            : undefined,
      });
      if (!data.imageUrl) throw new Error("No image returned from API");
      const anchorPromptUsed = generatePrompt.trim();
      await applyImageToActiveLayer(data.imageUrl, { fromUpload: false });
      if (layerRole === WORKFLOW_ORDER[0] && anchorPromptUsed) {
        void deriveSceneBrief(anchorPromptUsed, artStyle, selectedModel);
      }
      setGenerateOpen(false);
      setGeneratePrompt("");
    } catch (err) {
      reportError(err);
    } finally {
      setGenerating(false);
      if (!apiKey) void refreshCredits();
    }
  }, [generatePrompt, generateWidth, generateHeight, artStyle, selectedModel, activeLayer, sceneBrief, applyImageToActiveLayer, deriveSceneBrief, reportError, apiKey, refreshCredits]);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        try {
          await applyImageToActiveLayer(dataUrl, { fromUpload: true });
        } catch (err) {
          reportError(err);
        }
      };
      reader.readAsDataURL(file);
    },
    [applyImageToActiveLayer, reportError],
  );

  // ── Tileable / harmonize ─────────────────────────────────────────────────

  const makeLayerTileableByIdx = useCallback(
    async (idx: number, currentLayers?: ParallaxLayer[]) => {
      const list = currentLayers ?? layers;
      const layer = list[idx];
      if (!layer?.imageUrl) return;
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque;
      if (isKeyed && layer.rawImageUrl) {
        const tileableRaw = await makeHorizontallyTileable(layer.rawImageUrl, {
          ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
        });
        const tileableDisplay = await chromaKeyToAlpha(tileableRaw);
        setLayers((prev) =>
          prev.map((l, i) =>
            i === idx ? { ...l, imageUrl: tileableDisplay, rawImageUrl: tileableRaw } : l,
          ),
        );
      } else {
        const tileable = await makeHorizontallyTileable(layer.imageUrl);
        setLayers((prev) =>
          prev.map((l, i) => (i === idx ? { ...l, imageUrl: tileable, rawImageUrl: tileable } : l)),
        );
      }
    },
    [layers],
  );

  const handleMakeActiveLayerTileable = useCallback(async () => {
    if (loading || autoExtending || !activeLayer?.imageUrl) return;
    setLoading(true);
    setProgressMsg("Making tileable…");
    try {
      await makeLayerTileableByIdx(activeIdx);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
      setProgressMsg(null);
    }
  }, [loading, autoExtending, activeLayer, activeIdx, makeLayerTileableByIdx, reportError]);

  const handleHarmonizeActiveLayer = useCallback(async () => {
    if (loading || autoExtending || !activeLayer?.imageUrl) return;
    setLoading(true);
    setProgressMsg("Harmonizing seams…");
    try {
      const layer = layers[activeIdx];
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque;
      if (isKeyed && layer.rawImageUrl) {
        const harmonizedRaw = await harmonizeHorizontalSeams(layer.rawImageUrl, {
          strength: 0.85,
          ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
        });
        const harmonizedDisplay = await chromaKeyToAlpha(harmonizedRaw);
        setLayers((prev) =>
          prev.map((l, i) =>
            i === activeIdx ? { ...l, imageUrl: harmonizedDisplay, rawImageUrl: harmonizedRaw } : l,
          ),
        );
      } else {
        const harmonized = await harmonizeHorizontalSeams(layer.imageUrl!, { strength: 0.85 });
        setLayers((prev) =>
          prev.map((l, i) =>
            i === activeIdx ? { ...l, imageUrl: harmonized, rawImageUrl: harmonized } : l,
          ),
        );
      }
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
      setProgressMsg(null);
    }
  }, [loading, autoExtending, activeLayer, activeIdx, layers, reportError]);

  // ── Auto-extend loop ─────────────────────────────────────────────────────

  const handleAutoExtend = useCallback(async () => {
    if (loading || autoExtending || !targetWidth) return;
    const layer = activeLayer;
    if (!layer?.imageUrl || !layer.width || !layer.height) return;
    if (layer.width >= targetWidth) return;

    const sourceImage0 = layer.rawImageUrl ?? layer.imageUrl;
    autoStopRef.current = false;
    setAutoExtending(true);
    setActiveDirection("right");
    setCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);

    let currentSource = sourceImage0;
    let currentDims = { width: layer.width, height: layer.height };
    let stepCount = 0;

    try {
      while (
        currentDims.width < targetWidth &&
        stepCount < PARALLAX_MAX_AUTO_STEPS &&
        !autoStopRef.current
      ) {
        stepCount++;
        setLoading(true);
        setProgressMsg(`Auto step ${stepCount} · ${currentDims.width} → ${targetWidth}px`);

        const stepCandidates = await runExtendCore({
          direction: "right",
          sourceImage: currentSource,
          promptText: customPrompt,
          style: artStyle,
          model: selectedModel,
          debugMode,
          layerRole: layer.role,
          sceneBrief,
          onProgress: setProgressMsg,
        });
        if (autoStopRef.current) break;
        const best = stepCandidates[0];

        const nextSource = best.rawImageUrl ?? best.imageUrl;
        currentSource = nextSource;
        currentDims = await getImageDimensions(best.imageUrl);

        patchActiveLayer({
          imageUrl: best.imageUrl,
          rawImageUrl: nextSource,
          width: currentDims.width,
          height: currentDims.height,
        });
        setLoading(false);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
      setActiveDirection(null);
      setProgressMsg(null);
      setAutoExtending(false);
    }

    // Close the loop: heal the repeat-x seam so the default output Just Works.
    if (!autoStopRef.current) {
      try {
        setLoading(true);
        setProgressMsg("Closing the loop…");
        await makeLayerTileableByIdx(activeIdx);
      } catch {
        // Non-fatal — leave the un-tiled result in place.
      } finally {
        setLoading(false);
        setProgressMsg(null);
      }
    }
    autoStopRef.current = false;
    if (!apiKey) void refreshCredits();
  }, [loading, autoExtending, targetWidth, activeLayer, customPrompt, artStyle, selectedModel, debugMode, sceneBrief, patchActiveLayer, makeLayerTileableByIdx, activeIdx, reportError, apiKey, refreshCredits]);

  const handleStopAutoExtend = useCallback(() => {
    autoStopRef.current = true;
    setProgressMsg("Stopping after this step…");
  }, []);

  // ── Export ───────────────────────────────────────────────────────────────

  const handleDownloadActiveLayerPng = useCallback(() => {
    const layer = activeLayer;
    if (!layer?.imageUrl) return;
    const link = document.createElement("a");
    link.href = layer.imageUrl;
    link.download = `parallax_${layer.role}_${layer.width ?? 0}x${layer.height ?? 0}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeLayer]);

  const handleExportZip = useCallback(async () => {
    const populated = layers.filter((l) => l.imageUrl);
    if (populated.length === 0) {
      toast.error("No layers to export. Generate or upload at least one layer first.");
      return;
    }
    setProgressMsg("Packaging ZIP…");
    try {
      const zip = new JSZip();
      const manifest: {
        version: number;
        createdAt: string;
        sceneBrief?: string;
        layers: {
          role: LayerRole;
          file: string;
          width: number | null;
          height: number | null;
          scrollSpeed: number;
          opaque: boolean;
        }[];
      } = {
        version: 1,
        createdAt: new Date().toISOString(),
        ...(sceneBrief.trim() ? { sceneBrief: sceneBrief.trim() } : {}),
        layers: [],
      };
      for (const layer of layers) {
        if (!layer.imageUrl) continue;
        const filename = `${layer.role}.png`;
        const base64 = layer.imageUrl.split(",")[1] ?? "";
        zip.file(filename, base64, { base64: true });
        manifest.layers.push({
          role: layer.role,
          file: filename,
          width: layer.width,
          height: layer.height,
          scrollSpeed: layer.scrollSpeed,
          opaque: LAYER_ROLES[layer.role].isOpaque,
        });
      }
      zip.file("parallax.json", JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `parallax_project_${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      reportError(err);
    } finally {
      setProgressMsg(null);
    }
  }, [layers, sceneBrief, reportError]);

  const handleNewProject = useCallback(() => {
    setLayers(createDefaultLayers());
    setActiveIdx(LAYER_ORDER.indexOf(WORKFLOW_ORDER[0]));
    setSceneBrief("");
    setTargetWidth(null);
    setCustomPrompt("");
    handleDiscard();
  }, [setSceneBrief, handleDiscard]);

  return {
    layers,
    activeIdx,
    setActiveIdx: selectLayer,
    activeLayer,
    targetWidth,
    setTargetWidth,
    autoExtending,
    candidates,
    selectedCandidateIdx,
    candidateDims,
    activeCandidate,
    loading,
    activeDirection,
    progressMsg,
    customPrompt,
    setCustomPrompt,
    artStyle,
    setArtStyle,
    debugMode,
    sceneBrief,
    setSceneBrief,
    sceneBriefLoading,
    generateOpen,
    setGenerateOpen,
    generatePrompt,
    setGeneratePrompt,
    generateWidth,
    setGenerateWidth,
    generateHeight,
    setGenerateHeight,
    generating,
    openGenerateModal,
    handleGenerateImage,
    handleFile,
    handleExtend,
    handleRegenerate,
    handleAccept,
    handleDiscard,
    cycleVariant,
    setLayerScrollSpeed,
    clearLayer,
    handleAutoExtend,
    handleStopAutoExtend,
    handleMakeActiveLayerTileable,
    handleHarmonizeActiveLayer,
    handleDownloadActiveLayerPng,
    handleExportZip,
    handleNewProject,
  };
}
