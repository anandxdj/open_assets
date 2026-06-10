"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Mode-agnostic extension core, shared by useExtender (plain images) and
// useParallax (keyed layers). Horizontal → best-of-N candidates ranked by
// seam residual; vertical → single deterministic chunked pass.

import type { Candidate, Direction } from "@/features/studio/lib/app";
import { EXTENSION_PERCENT } from "@/features/studio/lib/app";
import { getModelConfig } from "@/features/studio/lib/models";
import {
  applyFullContextResult,
  chromaKeyToAlpha,
  createChunkedExtension,
  createFullContextExtension,
  isAiExtensionUnfilled,
  measureSeamResidual,
  stitchExtendedChunk,
} from "@/features/studio/lib/imageProcessor";
import { studioPost } from "@/features/studio/api/studioClient";
import type { LayerRole } from "@/features/studio/lib/parallax";

export type RunExtendOptions = {
  direction: Direction;
  sourceImage: string;
  promptText: string;
  style: string;
  model: string;
  debugMode: boolean;
  /** Parallax layer role: non-sky roles get chroma-keyed candidates. */
  layerRole?: LayerRole;
  sceneBrief?: string;
  onProgress: (msg: string) => void;
};

export async function runExtendCore(opts: RunExtendOptions): Promise<Candidate[]> {
  const { direction, sourceImage, promptText, style, model, debugMode, layerRole, sceneBrief } =
    opts;
  const isKeyedLayer = !!layerRole && layerRole !== "sky";

  const callExtendApi = async (expandedCanvas: string, body: Record<string, unknown>) => {
    const data = await studioPost<{ imageUrl: string }>("/api/studio/extend", {
      expandedCanvas,
      direction,
      extensionAmount: EXTENSION_PERCENT,
      customPrompt: promptText.trim() || undefined,
      artStyle: style !== "none" ? style : undefined,
      model,
      layerRole,
      sceneBrief: sceneBrief?.trim() || undefined,
      ...body,
    });
    return data.imageUrl;
  };

  /** Keyed parallax layers: store the alpha-keyed display image plus the
   * raw magenta source for the next extension round. */
  const finalizeCandidate = async (
    blended: string,
    score: number,
    attempt: number,
  ): Promise<Candidate> => {
    if (isKeyedLayer) {
      const keyed = await chromaKeyToAlpha(blended);
      return { imageUrl: keyed, rawImageUrl: blended, score, attempt };
    }
    return { imageUrl: blended, score, attempt };
  };

  const isHorizontal = direction === "left" || direction === "right";
  const modelCfg = getModelConfig(model);

  if (isHorizontal) {
    const maxAttempts = Math.max(1, modelCfg.maxAttempts);
    const candidates: Candidate[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      const tickHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - attemptStart) / 1000);
        opts.onProgress(
          maxAttempts > 1
            ? `Variant ${attempt + 1}/${maxAttempts} · ${elapsed}s`
            : `Generating · ${elapsed}s`,
        );
      }, 1000);

      try {
        const fullResult = await createFullContextExtension(
          sourceImage,
          direction,
          EXTENSION_PERCENT,
        );
        const imageUrl = await callExtendApi(fullResult.fullImageWithBlankArea, {
          useFullContext: true,
          extensionInfo: fullResult.extensionInfo,
          attempt,
        });
        if (await isAiExtensionUnfilled(imageUrl, fullResult.extensionInfo)) {
          continue;
        }
        const blended = await applyFullContextResult(
          imageUrl,
          fullResult.extensionInfo,
          sourceImage,
        );
        const score = await measureSeamResidual(blended, fullResult.extensionInfo, sourceImage);
        if (debugMode) {
          console.log(`🔬 Variant ${attempt + 1} seam residual: ${score.toFixed(2)}`);
        }
        candidates.push(await finalizeCandidate(blended, score, attempt + 1));
      } finally {
        clearInterval(tickHandle);
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `AI failed to fill the extension area after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""}. Try a different direction or model.`,
      );
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  } else {
    const attemptStart = Date.now();
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - attemptStart) / 1000);
      opts.onProgress(`Generating · ${elapsed}s`);
    }, 1000);
    try {
      const result = await createChunkedExtension(sourceImage, direction, EXTENSION_PERCENT, 40);
      const imageUrl = await callExtendApi(result.chunkToExtend, {
        chunkInfo: result.chunkInfo,
        useFullContext: false,
      });
      const stitched = await stitchExtendedChunk(sourceImage, imageUrl, result.chunkInfo, debugMode);
      return [await finalizeCandidate(stitched, 0, 1)];
    } finally {
      clearInterval(tickHandle);
    }
  }
}
