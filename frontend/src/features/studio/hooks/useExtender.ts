"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Extender-mode state machine, extracted from the upstream page.tsx monolith
// (extender-only branches; parallax dispatch lives in useParallax instead).

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Candidate, Direction } from "@/features/studio/lib/app";
import { runExtendCore } from "@/features/studio/lib/extendRunner";
import { StudioApiError } from "@/features/studio/api/studioClient";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";

export type Dims = { width: number; height: number };

export function useExtender() {
  const { apiKey, selectedModel, debugMode, refreshCredits } = useStudioSettings();

  // Image state
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState("extended");
  /** Candidates from the most recent extension, best seam first. */
  const [extendedCandidates, setExtendedCandidates] = useState<Candidate[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [candidateDims, setCandidateDims] = useState<Array<Dims | null>>([]);
  const [currentImageDimensions, setCurrentImageDimensions] = useState<Dims | null>(null);
  const [imageBeforeExtension, setImageBeforeExtension] = useState<string | null>(null);
  const [lastExtensionParams, setLastExtensionParams] = useState<{
    direction: Direction;
    customPrompt: string;
    artStyle: string;
  } | null>(null);

  // Operation state
  const [loading, setLoading] = useState(false);
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);

  // Form state
  const [customPrompt, setCustomPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("none");

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

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadDataUrlAsImage = useCallback((dataUrl: string, filename = "image.png") => {
    setSelectedImage(dataUrl);
    setExtendedCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setOriginalFileName(filename);
    const img = new Image();
    img.onload = () => setCurrentImageDimensions({ width: img.width, height: img.height });
    img.src = dataUrl;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        loadDataUrlAsImage(dataUrl, file.name);
      };
      reader.readAsDataURL(file);
    },
    [loadDataUrlAsImage],
  );

  /** Adopt fresh candidates: best first, async dims reads per candidate. */
  const adoptCandidates = useCallback((candidates: Candidate[]) => {
    setExtendedCandidates(candidates);
    setSelectedCandidateIdx(0);
    setCandidateDims(new Array(candidates.length).fill(null));
    candidates.forEach((c, idx) => {
      const img = new Image();
      img.onload = () => {
        setCandidateDims((prev) => {
          const next = prev.slice();
          next[idx] = { width: img.width, height: img.height };
          return next;
        });
      };
      img.src = c.imageUrl;
    });
  }, []);

  // ── Extend core ───────────────────────────────────────────────────────────

  const runExtend = useCallback(
    (direction: Direction, sourceImage: string, promptText: string, style: string) =>
      runExtendCore({
        direction,
        sourceImage,
        promptText,
        style,
        model: selectedModel,
        debugMode,
        onProgress: setProgressMsg,
      }),
    [debugMode, selectedModel],
  );

  const handleExtend = useCallback(
    async (direction: Direction) => {
      if (loading || !selectedImage) return;
      setLoading(true);
      setProgressMsg(`Extending ${direction}…`);
      setActiveDirection(direction);
      setImageBeforeExtension(selectedImage);
      setLastExtensionParams({ direction, customPrompt, artStyle });

      try {
        const candidates = await runExtend(direction, selectedImage, customPrompt, artStyle);
        adoptCandidates(candidates);
      } catch (err) {
        reportError(err);
        setActiveDirection(null);
      } finally {
        setLoading(false);
        setProgressMsg(null);
        if (!apiKey) void refreshCredits();
      }
    },
    [loading, selectedImage, customPrompt, artStyle, runExtend, adoptCandidates, reportError, apiKey, refreshCredits],
  );

  const handleRegenerate = useCallback(async () => {
    if (!lastExtensionParams || !imageBeforeExtension || loading) return;
    setLoading(true);
    setProgressMsg(`Regenerating ${lastExtensionParams.direction}…`);
    try {
      const candidates = await runExtend(
        lastExtensionParams.direction,
        imageBeforeExtension,
        lastExtensionParams.customPrompt,
        lastExtensionParams.artStyle,
      );
      adoptCandidates(candidates);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
      setProgressMsg(null);
      if (!apiKey) void refreshCredits();
    }
  }, [lastExtensionParams, imageBeforeExtension, loading, runExtend, adoptCandidates, reportError, apiKey, refreshCredits]);

  const cycleVariant = useCallback(
    (delta: 1 | -1) => {
      if (extendedCandidates.length <= 1) return;
      setSelectedCandidateIdx((prev) => {
        const n = extendedCandidates.length;
        return (prev + delta + n) % n;
      });
    },
    [extendedCandidates.length],
  );

  /** The candidate currently in view (null when no active result). */
  const activeCandidate: Candidate | null =
    extendedCandidates.length > 0
      ? extendedCandidates[Math.min(selectedCandidateIdx, extendedCandidates.length - 1)]
      : null;

  const handleAccept = useCallback(() => {
    if (!activeCandidate) return;
    const accepted = activeCandidate.imageUrl;
    setSelectedImage(accepted);
    const img = new Image();
    img.onload = () => setCurrentImageDimensions({ width: img.width, height: img.height });
    img.src = accepted;
    setExtendedCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
  }, [activeCandidate]);

  const handleDiscard = useCallback(() => {
    setExtendedCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
  }, []);

  const handleDownload = useCallback(() => {
    if (!activeCandidate) return;
    const link = document.createElement("a");
    link.href = activeCandidate.imageUrl;
    const baseName = originalFileName.replace(/\.[^/.]+$/, "") || "extended";
    const variantTag = extendedCandidates.length > 1 ? `_v${selectedCandidateIdx + 1}` : "";
    link.download = `${baseName}_extended${variantTag}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeCandidate, originalFileName, extendedCandidates.length, selectedCandidateIdx]);

  const handleNewImage = useCallback(() => {
    setSelectedImage(null);
    setExtendedCandidates([]);
    setCandidateDims([]);
    setSelectedCandidateIdx(0);
    setCurrentImageDimensions(null);
    setImageBeforeExtension(null);
    setLastExtensionParams(null);
    setActiveDirection(null);
    setCustomPrompt("");
  }, []);

  return {
    // image + result state
    selectedImage,
    currentImageDimensions,
    extendedCandidates,
    selectedCandidateIdx,
    candidateDims,
    activeCandidate,
    // operation state
    loading,
    activeDirection,
    progressMsg,
    // form state
    customPrompt,
    setCustomPrompt,
    artStyle,
    setArtStyle,
    debugMode,
    // actions
    handleFile,
    loadDataUrlAsImage,
    handleExtend,
    handleRegenerate,
    handleAccept,
    handleDiscard,
    handleDownload,
    handleNewImage,
    cycleVariant,
  };
}
