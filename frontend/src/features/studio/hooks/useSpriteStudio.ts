"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Sprite mode: two-pass anchor → sheet workflow with deterministic post
// (scale normalization, baseline grounding, horizontal centering, twin
// detection) instead of a vision critic.

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  SPRITE_ANIMATIONS,
  SPRITE_FRAME_COUNT,
  SPRITE_FRAME_SIZE,
  SPRITE_GRID_COLS,
  SPRITE_GRID_ROWS,
  SPRITE_SHEET_H,
  SPRITE_SHEET_W,
  SPRITE_STRIP_H,
  SPRITE_STRIP_W,
  createEmptySpriteSheet,
} from "@/features/studio/lib/sprite";
import type { SpriteAnimType, SpriteFrame, SpriteSheet } from "@/features/studio/lib/sprite";
import { BODY_PLANS, isAirborneAnim } from "@/features/studio/lib/bodyPlans";
import type { BodyPlan } from "@/features/studio/lib/bodyPlans";
import {
  alignSpriteFramesToBaseline,
  centerSpriteFramesHorizontally,
  chromaKeyToAlpha,
  isolatePrimarySpriteComponent,
  normalizeSpriteFrameScale,
  removeFrameBorder,
  removeUploadedBackground,
  sliceImageGrid,
} from "@/features/studio/lib/imageProcessor";
import { drawPoseGuideSheet, measureSubjectBounds } from "@/features/studio/lib/rig/poseRig";
import type { SubjectBounds } from "@/features/studio/lib/rig/poseRig";
import { StudioApiError, studioPost } from "@/features/studio/api/studioClient";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { useSceneBrief } from "@/features/studio/hooks/useSceneBrief";

export type SpriteAnchor = {
  /** Chroma-keyed thumbnail (transparent) for display. */
  imageUrl: string;
  /** Raw magenta-background version — fed to the AI on every sheet pass. */
  rawImageUrl: string;
  prompt: string;
  /** True when supplied by upload — never auto-regenerated from the prompt. */
  uploaded?: boolean;
};

export function useSpriteStudio() {
  const { apiKey, selectedModel, debugMode, refreshCredits } = useStudioSettings();
  const { sceneBrief } = useSceneBrief();

  const [bodyPlan, setBodyPlan] = useState<BodyPlan>("biped");
  const [anim, setAnim] = useState<SpriteAnimType>("idle");
  const [sheet, setSheet] = useState<SpriteSheet>(() => createEmptySpriteSheet("idle"));
  const [anchor, setAnchor] = useState<SpriteAnchor | null>(null);
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState("none");
  const [fps, setFps] = useState<number>(SPRITE_ANIMATIONS.idle.defaultFps);
  const [generating, setGenerating] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Per-(plan, anim) cache so tab/plan switches keep generated sheets.
  const [sheetCache, setSheetCache] = useState<Record<string, SpriteSheet>>({});
  const cacheKey = (plan: BodyPlan, a: SpriteAnimType) => `${plan}:${a}`;

  const generatedAnims = useMemo(() => {
    const prefix = `${bodyPlan}:`;
    const next = new Set<SpriteAnimType>();
    // The live sheet counts as cached for its own slot.
    const entries: Record<string, SpriteSheet> = {
      ...sheetCache,
      [cacheKey(bodyPlan, sheet.anim)]: sheet,
    };
    for (const [key, cached] of Object.entries(entries)) {
      if (key.startsWith(prefix) && cached && cached.frames.some((f) => !!f.imageUrl)) {
        next.add(key.slice(prefix.length) as SpriteAnimType);
      }
    }
    return next;
  }, [sheetCache, sheet, bodyPlan]);

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

  // ── Mode switches ────────────────────────────────────────────────────────

  /** Switch animation: preserves the anchor; restores a cached sheet if any. */
  const selectAnim = useCallback(
    (next: SpriteAnimType) => {
      if (next === anim || generating) return;
      setSheetCache((prev) => ({ ...prev, [cacheKey(bodyPlan, anim)]: sheet }));
      const cached = sheetCache[cacheKey(bodyPlan, next)];
      setAnim(next);
      setSheet(cached ?? createEmptySpriteSheet(next));
      setFps(cached?.fps ?? SPRITE_ANIMATIONS[next].defaultFps);
      setProgressMsg(null);
    },
    [anim, generating, bodyPlan, sheet, sheetCache],
  );

  /** Switch body plan: plan-specific rigs/anims/identity — start clean. */
  const selectBodyPlan = useCallback(
    (next: BodyPlan) => {
      if (next === bodyPlan || generating) return;
      const plan = BODY_PLANS[next];
      const nextAnim = plan.defaultAnim;
      setSheetCache({});
      setBodyPlan(next);
      setAnim(nextAnim);
      setSheet(createEmptySpriteSheet(nextAnim));
      setFps(SPRITE_ANIMATIONS[nextAnim].defaultFps);
      setAnchor(null);
      setProgressMsg(null);
    },
    [bodyPlan, generating],
  );

  // ── Guides ───────────────────────────────────────────────────────────────

  const measureAnchorSubject = useCallback(
    async (anchorRawImageUrl: string): Promise<SubjectBounds> => {
      const fallback: SubjectBounds = {
        height: Math.round(SPRITE_FRAME_SIZE * 0.78),
        centerX: SPRITE_FRAME_SIZE / 2,
        baseline: Math.round(SPRITE_FRAME_SIZE * 0.92),
      };
      try {
        return await new Promise<SubjectBounds>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = SPRITE_FRAME_SIZE;
            c.height = SPRITE_FRAME_SIZE;
            const cx = c.getContext("2d");
            if (!cx) return resolve(fallback);
            cx.drawImage(img, 0, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE);
            const { data } = cx.getImageData(0, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE);
            const measured = measureSubjectBounds(data, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE);
            resolve(measured ?? fallback);
          };
          img.onerror = () => resolve(fallback);
          img.src = anchorRawImageUrl;
        });
      } catch {
        return fallback;
      }
    },
    [],
  );

  /** Pose-map guide: deterministic skeletal mannequin per frame, matched to
   * the anchor's measured bounds — the model only skins the character on. */
  const buildSpriteSheetGuideDataUrl = useCallback(
    async (anchorRawImageUrl: string): Promise<string> => {
      const subject = await measureAnchorSubject(anchorRawImageUrl);
      const canvas = document.createElement("canvas");
      canvas.width = SPRITE_SHEET_W;
      canvas.height = SPRITE_SHEET_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to create sprite-guide canvas");
      ctx.imageSmoothingEnabled = true;
      drawPoseGuideSheet(ctx, {
        anim,
        bodyPlan,
        cols: SPRITE_GRID_COLS,
        rows: SPRITE_GRID_ROWS,
        cellSize: SPRITE_FRAME_SIZE,
        frameCount: SPRITE_FRAME_COUNT,
        subject,
      });
      return canvas.toDataURL("image/png");
    },
    [anim, bodyPlan, measureAnchorSubject],
  );

  // ── Sheet composition ────────────────────────────────────────────────────

  const composeSpriteGridSheet = useCallback(async (cells: string[]): Promise<string | null> => {
    if (cells.length === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_SHEET_W;
    canvas.height = SPRITE_SHEET_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const r = Math.floor(i / SPRITE_GRID_COLS);
            const c = i % SPRITE_GRID_COLS;
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, c * SPRITE_FRAME_SIZE, r * SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE);
              resolve();
            };
            img.onerror = () => reject(new Error(`Failed to load sprite frame ${i}`));
            img.src = url;
          }),
      ),
    );
    return canvas.toDataURL("image/png");
  }, []);

  const composeSpriteStripSheet = useCallback(async (cells: string[]): Promise<string | null> => {
    if (cells.length === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = cells.length * SPRITE_FRAME_SIZE;
    canvas.height = SPRITE_STRIP_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, i * SPRITE_FRAME_SIZE, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE);
              resolve();
            };
            img.onerror = () => reject(new Error(`Failed to load sprite frame ${i}`));
            img.src = url;
          }),
      ),
    );
    return canvas.toDataURL("image/png");
  }, []);

  // ── Deterministic twin/spillover detector ────────────────────────────────

  const detectSpriteDuplicateCells = useCallback(async (cells: string[]): Promise<number> => {
    const W = 100;
    const H = 100;
    const hasSplitMass = (profile: number[]) => {
      const peak = Math.max(...profile);
      if (peak <= 0) return false;
      const occThresh = peak * 0.06;
      const minGap = Math.max(3, Math.round(profile.length * 0.05));
      const segments: { mass: number }[] = [];
      let cur: number | null = null;
      let gap = 0;
      for (let i = 0; i < profile.length; i++) {
        if (profile[i] > occThresh) {
          if (cur === null) {
            segments.push({ mass: 0 });
            cur = segments.length - 1;
          }
          segments[cur].mass += profile[i];
          gap = 0;
        } else if (cur !== null) {
          gap++;
          if (gap >= minGap) cur = null;
        }
      }
      if (segments.length < 2) return false;
      segments.sort((a, b) => b.mass - a.mass);
      return segments[1].mass >= segments[0].mass * 0.45;
    };
    const analyze = (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(false);
            ctx.clearRect(0, 0, W, H);
            ctx.drawImage(img, 0, 0, W, H);
            const { data } = ctx.getImageData(0, 0, W, H);
            const colMass = new Array<number>(W).fill(0);
            const rowMass = new Array<number>(H).fill(0);
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                const alpha = data[(y * W + x) * 4 + 3];
                colMass[x] += alpha;
                rowMass[y] += alpha;
              }
            }
            resolve(hasSplitMass(colMass) || hasSplitMass(rowMass));
          } catch {
            resolve(false);
          }
        };
        img.onerror = () => resolve(false);
        img.src = url;
      });
    try {
      const flags = await Promise.all(cells.map(analyze));
      return flags.filter(Boolean).length;
    } catch {
      return 0;
    }
  }, []);

  // ── Generation passes ────────────────────────────────────────────────────

  const runSpriteAnchorPass = useCallback(
    async (anchorPrompt: string): Promise<{ imageUrl: string; rawImageUrl: string }> => {
      const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
        prompt: anchorPrompt,
        width: SPRITE_FRAME_SIZE,
        height: SPRITE_FRAME_SIZE,
        artStyle: artStyle !== "none" ? artStyle : undefined,
        model: selectedModel,
        spriteAnchor: true,
        spriteBodyPlan: bodyPlan,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      });
      if (!data.imageUrl) throw new Error("No anchor image returned from API");
      const rawImageUrl: string = data.imageUrl;
      const keyedImageUrl = await chromaKeyToAlpha(rawImageUrl);
      return { imageUrl: keyedImageUrl, rawImageUrl };
    },
    [artStyle, selectedModel, bodyPlan, sceneBrief],
  );

  const runSpriteSheetPass = useCallback(
    async (
      sheetPrompt: string,
      anchorRawUrl: string | null,
      fixNotes?: string,
    ): Promise<{ rawSheetUrl: string; keyedCells: string[]; keyedSheetUrl: string | null }> => {
      let guideImage: string | undefined;
      if (anchorRawUrl) {
        try {
          guideImage = await buildSpriteSheetGuideDataUrl(anchorRawUrl);
        } catch (err) {
          console.warn("Sprite guide build failed; proceeding without it:", err);
        }
      }
      const data = await studioPost<{ imageUrl: string }>("/api/studio/generate", {
        prompt: sheetPrompt,
        width: SPRITE_SHEET_W,
        height: SPRITE_SHEET_H,
        artStyle: artStyle !== "none" ? artStyle : undefined,
        model: selectedModel,
        spriteSheet: true,
        spriteAnim: anim,
        spriteBodyPlan: bodyPlan,
        spriteFrameCount: SPRITE_FRAME_COUNT,
        spriteGridCols: SPRITE_GRID_COLS,
        spriteGridRows: SPRITE_GRID_ROWS,
        spriteFrameSize: SPRITE_FRAME_SIZE,
        spriteGuideImage: guideImage,
        // Pose-map carries STRUCTURE; the raw anchor carries IDENTITY.
        spritePoseGuide: Boolean(guideImage),
        spriteIdentityImage: anchorRawUrl ?? undefined,
        spriteFixNotes: fixNotes,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      });
      if (!data.imageUrl) throw new Error("No image returned from API");
      const rawSheetUrl: string = data.imageUrl;
      const rawCells = await sliceImageGrid(rawSheetUrl, {
        cols: SPRITE_GRID_COLS,
        rows: SPRITE_GRID_ROWS,
        cellSize: SPRITE_FRAME_SIZE,
      });
      const keyedCells = await Promise.all(
        rawCells.map(async (cellUrl) => {
          const keyed = await chromaKeyToAlpha(cellUrl);
          let cleaned = keyed;
          try {
            cleaned = await removeFrameBorder(cleaned);
          } catch {
            cleaned = keyed;
          }
          if (bodyPlan !== "biped") {
            try {
              // Compact bodies may fuse two creatures by a thin bridge; thin
              // subjects (serpent/flyer) must not be split or they'd fragment.
              const enableSplit = bodyPlan === "quadruped" || bodyPlan === "blob";
              cleaned = await isolatePrimarySpriteComponent(cleaned, { enableSplit });
            } catch {
              /* keep prior cleanup */
            }
          }
          return cleaned;
        }),
      );

      // Scale normalization → baseline alignment → horizontal centering.
      let alignedCells = keyedCells;
      try {
        const scaled = await normalizeSpriteFrameScale(keyedCells, {
          tolerance: 0.05,
          maxScaleAdjust: 0.18,
        });
        alignedCells = scaled.cells;
        if (debugMode) console.log("[Sprite] Scale normalization:", scaled.scales);
      } catch (err) {
        console.warn("Sprite scale normalization failed; using raw cells:", err);
      }
      try {
        const hasAirborne = isAirborneAnim(bodyPlan, anim);
        const alignment = await alignSpriteFramesToBaseline(alignedCells, {
          groundAll: !hasAirborne,
          targetBaseline: Math.round(SPRITE_FRAME_SIZE * 0.9),
        });
        alignedCells = alignment.cells;
        if (debugMode) console.log("[Sprite] Baseline alignment:", alignment.shifted);
      } catch (err) {
        console.warn("Sprite baseline alignment failed; using raw cells:", err);
      }
      try {
        const centering = await centerSpriteFramesHorizontally(alignedCells, {
          mode: "cellCenter",
        });
        alignedCells = centering.cells;
        if (debugMode) console.log("[Sprite] Horizontal centering:", centering.shifted);
      } catch (err) {
        console.warn("Sprite horizontal centering failed; using prior cells:", err);
      }

      const keyedSheetUrl = await composeSpriteGridSheet(alignedCells);
      return { rawSheetUrl, keyedCells: alignedCells, keyedSheetUrl };
    },
    [artStyle, selectedModel, anim, bodyPlan, sceneBrief, debugMode, buildSpriteSheetGuideDataUrl, composeSpriteGridSheet],
  );

  // ── Orchestration ────────────────────────────────────────────────────────

  const handleGenerateSpriteSheet = useCallback(
    async ({ forceNewAnchor = false }: { forceNewAnchor?: boolean } = {}) => {
      if (generating) return;
      const hasUploadedAnchor = !!anchor?.uploaded;
      if (!prompt.trim() && !hasUploadedAnchor) {
        toast.error("Describe the character you want — e.g. armored pixel knight.");
        return;
      }
      stopRef.current = false;
      setGenerating(true);
      const startedAt = Date.now();

      const effectivePrompt = prompt.trim() || "the character shown in the reference image";

      setSheet((prev) => ({
        ...prev,
        anim,
        frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
        gridSheetUrl: null,
        rawGridSheetUrl: null,
        prompt: effectivePrompt,
      }));

      const needsNewAnchor =
        forceNewAnchor || !anchor || (!anchor.uploaded && anchor.prompt.trim() !== prompt.trim());

      if (needsNewAnchor) {
        setAnchor(null);
        setSheetCache({});
      }

      const MAX_SPRITE_REVIEW_PASSES = 2;
      let phaseLabel = needsNewAnchor ? "Locking character (1/2)" : "Painting frames (2/2)";
      const tickHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setProgressMsg(`${phaseLabel} · ${elapsed}s`);
      }, 1000);

      try {
        let anchorRef = anchor;
        if (needsNewAnchor) {
          const anchorResult = await runSpriteAnchorPass(effectivePrompt);
          if (stopRef.current) return;
          anchorRef = {
            imageUrl: anchorResult.imageUrl,
            rawImageUrl: anchorResult.rawImageUrl,
            prompt: effectivePrompt,
          };
          setAnchor(anchorRef);
        }

        phaseLabel = "Painting frames (2/2)";
        let sheetResult = await runSpriteSheetPass(effectivePrompt, anchorRef?.rawImageUrl ?? null);
        if (stopRef.current) return;

        // Vision review is intentionally disabled for sprites — only the
        // cheap deterministic twin/spillover check drives repaints.
        let fixNotes: string | undefined;
        for (let pass = 0; pass < MAX_SPRITE_REVIEW_PASSES; pass++) {
          phaseLabel = "Checking frames";
          setProgressMsg("Checking frames…");
          const twinCount = await detectSpriteDuplicateCells(sheetResult.keyedCells);
          if (stopRef.current) return;

          if (twinCount === 0) break;

          fixNotes =
            `CRITICAL DEFECT: ${twinCount} cell(s) contain duplicate/spillover creatures: either two copies in one cell, or a full creature plus a cropped partial creature/body part from a neighbouring row/column. Paint EXACTLY ONE single character per ${SPRITE_FRAME_SIZE}×${SPRITE_FRAME_SIZE} cell, centered and scaled down with a clear magenta gutter; no head, tail, wing, leg, body, fur, shadow, or motion shape may cross a hidden cell boundary. This is the highest-priority fix.`.trim();
          if (debugMode) console.log(`🎭 QA rejected (twins: ${twinCount}), repainting:`, fixNotes);

          phaseLabel = `Repainting frames (pass ${pass + 2})`;
          setProgressMsg("Duplicate/spillover found — repainting…");
          sheetResult = await runSpriteSheetPass(
            effectivePrompt,
            anchorRef?.rawImageUrl ?? null,
            fixNotes,
          );
          if (stopRef.current) return;
        }

        setSheet((prev) => ({
          ...prev,
          anim,
          frames: sheetResult.keyedCells.map((url, i) => ({ index: i, imageUrl: url })),
          gridSheetUrl: sheetResult.keyedSheetUrl,
          rawGridSheetUrl: sheetResult.rawSheetUrl,
          prompt: effectivePrompt,
          fps,
        }));
      } catch (err) {
        setSheet((prev) => ({
          ...prev,
          frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
        }));
        reportError(err);
      } finally {
        clearInterval(tickHandle);
        setGenerating(false);
        setProgressMsg(null);
        if (!apiKey) void refreshCredits();
        if (debugMode) {
          console.log(`🎭 Sprite sheet generated in ${Math.floor((Date.now() - startedAt) / 1000)}s`);
        }
      }
    },
    [generating, anchor, prompt, anim, fps, debugMode, runSpriteAnchorPass, runSpriteSheetPass, detectSpriteDuplicateCells, reportError, apiKey, refreshCredits],
  );

  const handleRerollCharacter = useCallback(() => {
    if (generating) return;
    void handleGenerateSpriteSheet({ forceNewAnchor: true });
  }, [generating, handleGenerateSpriteSheet]);

  // ── Upload anchor ────────────────────────────────────────────────────────

  const buildSpriteAnchorFromUpload = useCallback(
    async (rawDataUrl: string): Promise<{ imageUrl: string; rawImageUrl: string }> => {
      let dataUrl = rawDataUrl;
      try {
        dataUrl = await removeUploadedBackground(rawDataUrl);
      } catch {
        dataUrl = rawDataUrl;
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
          try {
            const S = SPRITE_FRAME_SIZE;
            const canvas = document.createElement("canvas");
            canvas.width = S;
            canvas.height = S;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("Canvas unavailable"));
            ctx.fillStyle = "#FF00FF";
            ctx.fillRect(0, 0, S, S);
            const maxW = S * 0.84;
            const maxH = S * 0.9;
            const scale = Math.min(maxW / img.width, maxH / img.height);
            const dw = img.width * scale;
            const dh = img.height * scale;
            const dx = (S - dw) / 2;
            const dy = S * 0.95 - dh;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(img, dx, dy, dw, dh);
            const rawImageUrl = canvas.toDataURL("image/png");
            const imageUrl = await chromaKeyToAlpha(rawImageUrl);
            resolve({ imageUrl, rawImageUrl });
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error("Could not load the uploaded image"));
        img.src = dataUrl;
      });
    },
    [],
  );

  const handleUploadCharacter = useCallback(
    async (file: File) => {
      if (generating) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose an image file (PNG with transparency works best).");
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Failed to read the file"));
          reader.readAsDataURL(file);
        });
        const { imageUrl, rawImageUrl } = await buildSpriteAnchorFromUpload(dataUrl);
        setSheetCache({});
        setAnchor({
          imageUrl,
          rawImageUrl,
          prompt: prompt.trim() || "Uploaded character",
          uploaded: true,
        });
        setSheet(createEmptySpriteSheet(anim));
        setProgressMsg(null);
      } catch (err) {
        reportError(err);
      }
    },
    [generating, prompt, anim, buildSpriteAnchorFromUpload, reportError],
  );

  const handleRemoveUploadedCharacter = useCallback(() => {
    if (generating) return;
    setSheetCache({});
    setAnchor(null);
    setSheet(createEmptySpriteSheet(anim));
    setProgressMsg(null);
  }, [generating, anim]);

  const handleStop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const handleToggleFrame = useCallback((index: number) => {
    setSheet((prev) => ({
      ...prev,
      frames: prev.frames.map((f) =>
        f.index === index && f.imageUrl ? { ...f, disabled: !f.disabled } : f,
      ),
    }));
  }, []);

  const handleClear = useCallback(() => {
    setSheetCache({});
    setSheet(createEmptySpriteSheet(anim));
    setAnchor(null);
    setPrompt("");
    setProgressMsg(null);
    setFps(SPRITE_ANIMATIONS[anim].defaultFps);
    stopRef.current = false;
  }, [anim]);

  // ── Export ───────────────────────────────────────────────────────────────

  const buildSpriteManifest = useCallback(
    (activeFrames: SpriteFrame[]) => {
      const spec = SPRITE_ANIMATIONS[anim];
      const count = activeFrames.length;
      const stripCols = Math.max(1, count);
      return {
        version: 1,
        bodyPlan,
        bodyPlanLabel: BODY_PLANS[bodyPlan].label,
        anim,
        label: spec.label,
        frameCount: count,
        frameSize: SPRITE_FRAME_SIZE,
        fps,
        frameDurationMs: Math.round(1000 / fps),
        loop: spec.loop,
        grid: {
          fileName: "sheet.png",
          cols: SPRITE_GRID_COLS,
          rows: SPRITE_GRID_ROWS,
          sheetWidth: SPRITE_SHEET_W,
          sheetHeight: SPRITE_SHEET_H,
        },
        strip: {
          fileName: "strip.png",
          cols: stripCols,
          rows: 1,
          sheetWidth: stripCols * SPRITE_FRAME_SIZE,
          sheetHeight: SPRITE_STRIP_H,
        },
        prompt: sheet.prompt || prompt,
        sceneBrief: sceneBrief.trim() || null,
        artStyle: artStyle !== "none" ? artStyle : null,
        frames: activeFrames.map((f, i) => ({
          index: i,
          sourceIndex: f.index,
          fileName: `frame_${String(i + 1).padStart(2, "0")}.png`,
          gridCol: i % SPRITE_GRID_COLS,
          gridRow: Math.floor(i / SPRITE_GRID_COLS),
          gridX: (i % SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
          gridY: Math.floor(i / SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
          stripX: i * SPRITE_FRAME_SIZE,
          stripY: 0,
        })),
      };
    },
    [anim, bodyPlan, fps, sheet.prompt, prompt, sceneBrief, artStyle],
  );

  const handleDownloadSheet = useCallback(async () => {
    try {
      const populated = sheet.frames.filter((f) => !!f.imageUrl && !f.disabled);
      if (populated.length === 0) {
        toast.error(
          sheet.frames.some((f) => !!f.imageUrl)
            ? "All frames are excluded — click a frame to include it before downloading."
            : "Generate the sheet before downloading.",
        );
        return;
      }
      const cellUrls = populated.map((f) => f.imageUrl as string);
      const grid = await composeSpriteGridSheet(cellUrls);
      const strip = await composeSpriteStripSheet(cellUrls);
      const baseName = `${anim}_${(prompt.trim().slice(0, 24) || "sprite").replace(/[^a-z0-9]+/gi, "_")}`;

      if (grid) {
        const link = document.createElement("a");
        link.href = grid;
        link.download = `${baseName}_grid_${SPRITE_SHEET_W}x${SPRITE_SHEET_H}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      if (strip) {
        const link = document.createElement("a");
        link.href = strip;
        link.download = `${baseName}_strip_${SPRITE_STRIP_W}x${SPRITE_STRIP_H}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      const json = JSON.stringify(buildSpriteManifest(populated), null, 2);
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
  }, [sheet.frames, anim, prompt, composeSpriteGridSheet, composeSpriteStripSheet, buildSpriteManifest, reportError]);

  const handleDownloadZip = useCallback(async () => {
    try {
      const populated = sheet.frames.filter((f) => !!f.imageUrl && !f.disabled);
      if (populated.length === 0) {
        toast.error(
          sheet.frames.some((f) => !!f.imageUrl)
            ? "All frames are excluded — click a frame to include it before exporting."
            : "Generate the sheet before exporting the ZIP.",
        );
        return;
      }
      const cellUrls = populated.map((f) => f.imageUrl as string);
      const zip = new JSZip();
      populated.forEach((f, i) => {
        if (!f.imageUrl) return;
        const base64 = f.imageUrl.split(",")[1];
        if (base64) zip.file(`frame_${String(i + 1).padStart(2, "0")}.png`, base64, { base64: true });
      });
      const grid = await composeSpriteGridSheet(cellUrls);
      if (grid) {
        const b64 = grid.split(",")[1];
        if (b64) zip.file("sheet.png", b64, { base64: true });
      }
      const strip = await composeSpriteStripSheet(cellUrls);
      if (strip) {
        const b64 = strip.split(",")[1];
        if (b64) zip.file("strip.png", b64, { base64: true });
      }
      zip.file("manifest.json", JSON.stringify(buildSpriteManifest(populated), null, 2));

      const blob = await zip.generateAsync({ type: "blob" });
      const baseName = `${anim}_${(prompt.trim().slice(0, 24) || "sprite").replace(/[^a-z0-9]+/gi, "_")}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}_sprite.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      reportError(err);
    }
  }, [sheet.frames, anim, prompt, composeSpriteGridSheet, composeSpriteStripSheet, buildSpriteManifest, reportError]);

  return {
    sheet,
    anchor,
    bodyPlan,
    selectBodyPlan,
    anim,
    selectAnim,
    generatedAnims,
    prompt,
    setPrompt,
    artStyle,
    setArtStyle,
    fps,
    setFps,
    generating,
    progressMsg,
    handleGenerateSpriteSheet,
    handleRerollCharacter,
    handleUploadCharacter,
    handleRemoveUploadedCharacter,
    handleStop,
    handleToggleFrame,
    handleClear,
    handleDownloadSheet,
    handleDownloadZip,
  };
}
