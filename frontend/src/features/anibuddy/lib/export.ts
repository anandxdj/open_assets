// Export: PNG frame zip, animated GIF, and the download plumbing for both.
//
// Frames are rendered one at a time through the SAME `Deformer` the live
// preview uses, into a single reused canvas. Holding 24 full-size canvases at
// once would be tens of megabytes for no benefit (F9 §6 memory caps).
import JSZip from "jszip";
import { GIFEncoder, applyPalette, quantize } from "gifenc";

import {
  type BackgroundId,
  type MotionId,
  type PreparedAsset,
  type Rig,
  MAX_GIF_EDGE,
} from "@/features/anibuddy/types";
import { createDeformer } from "@/features/anibuddy/lib/deform";
import { getFramePoses, referencePose } from "@/features/anibuddy/lib/motion";
import { loadImageElement } from "@/features/anibuddy/lib/raster";

/** GIF carries a single fully-transparent palette entry, not an alpha channel,
 *  so anything but `transparent` has to be matted before encoding. */
export const BACKGROUND_CSS: Record<BackgroundId, string | null> = {
  transparent: null,
  white: "#ffffff",
  dark: "#18181b",
};

export const BACKGROUND_LABEL: Record<BackgroundId, string> = {
  transparent: "Transparent",
  white: "White",
  dark: "Dark",
};

export class ExportError extends Error {}

export interface ExportInput {
  prepared: PreparedAsset;
  rig: Rig;
  motion: MotionId;
  frameCount: number;
  fps: number;
  background: BackgroundId;
  /** Base filename, without extension. */
  name: string;
}

export type ProgressFn = (completed: number, total: number) => void;

interface FrameRunner {
  frameCount: number;
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  drawFrame(index: number): void;
}

async function createRunner(input: ExportInput, maxEdge: number | null): Promise<FrameRunner> {
  const { prepared, rig, motion, frameCount } = input;
  const image = await loadImageElement(prepared.dataUrl);
  const deformer = createDeformer(rig, prepared, image);

  const scale = maxEdge
    ? Math.min(1, maxEdge / Math.max(prepared.width, prepared.height))
    : 1;
  const width = Math.max(1, Math.round(prepared.width * scale));
  const height = Math.max(1, Math.round(prepared.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ExportError("This browser refused a 2D canvas, so nothing can be exported.");

  const frames = getFramePoses(rig.bodyPlan, motion, frameCount);
  const reference = referencePose(rig.bodyPlan, motion);
  const background = BACKGROUND_CSS[input.background];

  return {
    frameCount: frames.length,
    width,
    height,
    ctx,
    canvas,
    drawFrame(index) {
      // TODO(order-9): sample the active v3 clip instead of the legacy table.
      deformer.render(ctx, {}, { width, height, background });
    },
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ExportError("A frame could not be encoded as PNG."));
    }, "image/png");
  });
}

/** PNG frames keep the full alpha channel, so they are the lossless output and
 *  the fallback whenever GIF encoding fails. */
export async function exportPngFrames(
  input: ExportInput,
  onProgress?: ProgressFn,
): Promise<Blob> {
  const runner = await createRunner(input, null);
  const zip = new JSZip();
  const folder = zip.folder(input.name) ?? zip;
  const pad = String(runner.frameCount - 1).length;

  for (let index = 0; index < runner.frameCount; index++) {
    runner.drawFrame(index);
    const blob = await canvasToBlob(runner.canvas);
    folder.file(`${input.name}-${String(index).padStart(pad, "0")}.png`, blob);
    onProgress?.(index + 1, runner.frameCount);
  }

  folder.file(
    "README.txt",
    [
      `${input.name} — ${runner.frameCount} frames at ${input.fps}fps, motion "${input.motion}".`,
      "",
      "Every frame is the artwork you supplied, deformed by the rig you placed.",
      "No image generation was used at any point in producing these files.",
    ].join("\n"),
  );

  return zip.generateAsync({ type: "blob" });
}

/** Palette index of the fully transparent entry, or -1 when there is none. */
function findTransparentIndex(palette: number[][]): number {
  return palette.findIndex((entry) => (entry[3] ?? 255) === 0);
}

export async function exportGif(input: ExportInput, onProgress?: ProgressFn): Promise<Blob> {
  const runner = await createRunner(input, MAX_GIF_EDGE);
  const transparent = BACKGROUND_CSS[input.background] === null;
  const delay = Math.round(1000 / input.fps);

  try {
    const encoder = GIFEncoder();

    for (let index = 0; index < runner.frameCount; index++) {
      runner.drawFrame(index);
      const { data } = runner.ctx.getImageData(0, 0, runner.width, runner.height);

      // rgba4444 + oneBitAlpha is what lets the quantizer reserve a palette slot
      // for "nothing here". Without it the cut-out edge picks up whatever colour
      // the quantizer thinks the empty pixels are.
      const format = transparent ? "rgba4444" : "rgb565";
      const palette = quantize(data, 256, { format, oneBitAlpha: transparent });
      const indexed = applyPalette(data, palette, format);
      const transparentIndex = transparent ? findTransparentIndex(palette) : -1;

      encoder.writeFrame(indexed, runner.width, runner.height, {
        palette,
        delay,
        ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
      });
      onProgress?.(index + 1, runner.frameCount);
    }

    encoder.finish();
    return new Blob([encoder.bytes() as BlobPart], { type: "image/gif" });
  } catch (cause) {
    throw new ExportError(
      cause instanceof Error
        ? `GIF encoding failed (${cause.message}).`
        : "GIF encoding failed.",
    );
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to have been handed off.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBaseName(sourceName: string | null | undefined, motion: MotionId): string {
  const stem = (sourceName ?? "anibuddy")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${stem || "anibuddy"}-${motion}`;
}
