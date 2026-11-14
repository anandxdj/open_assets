/**
 * Turns a job's selected assets into export file names with a naming pattern.
 * Pure (no Redis, no database): callers load the job and pass what is needed,
 * so the finalize worker, the export names endpoint and saving to a collection
 * all name files the same way.
 */
import { ApiError } from '../../common/utils/ApiError';
import { applyNamingPattern, cropSize } from './pattern';
import type { PatternIssue } from './pattern';

export const INVALID_PATTERN = 'INVALID_PATTERN';

/** 400 with the problems found, for a pattern that fails validation. */
export function invalidPatternError(issues: PatternIssue[]): ApiError {
  const first = issues[0]?.message ?? 'The naming pattern is not valid.';
  return new ApiError(400, first, INVALID_PATTERN, { issues });
}

/**
 * The upscale factor an export has: 2 or 4 once an upscaling finalize has
 * started, otherwise 1 (the crops as cut, or a finalize that skipped upscaling).
 */
export function exportScaleOf(job: { status?: string; skipUpscale?: string; upscaleScale?: string }): 1 | 2 | 4 {
  if (job.skipUpscale === 'true') return 1;
  if (job.status !== 'finalizing' && job.status !== 'ready') return 1;
  const scale = Number(job.upscaleScale);
  return scale === 2 || scale === 4 ? scale : 1;
}

export interface ExportNamingInput {
  /** The assets to name, in export order (the job's asset order, selected ones only). */
  assets: readonly { id: string; name: string }[];
  /** Asset ids are box ids; the box gives the crop size. */
  boxes: readonly { id: string; x: number; y: number; width: number; height: number }[];
  sheetWidth: number;
  sheetHeight: number;
  /** The uploaded file name (`job.fileName`); may be empty on old jobs. */
  sheetFileName?: string;
  pattern: string;
  scale: number;
  now?: Date;
}

export interface ExportName {
  id: string;
  /** The asset's name before the pattern. */
  name: string;
  /** File name without the extension; unique within this call. */
  stem: string;
  /** `stem` plus ".png". */
  fileName: string;
}

/** Names every asset. Throws 400 INVALID_PATTERN when the pattern is not valid. */
export function nameExportAssets(input: ExportNamingInput): ExportName[] {
  const boxById = new Map(input.boxes.map((b) => [b.id, b]));
  const scale = input.scale > 0 ? input.scale : 1;
  const items = input.assets.map((asset) => {
    const box = boxById.get(asset.id);
    const size = box ? cropSize(box, input.sheetWidth, input.sheetHeight) : null;
    return {
      name: asset.name,
      ...(size ? { width: size.width * scale, height: size.height * scale } : {}),
    };
  });

  const result = applyNamingPattern(input.pattern, items, {
    sheet: input.sheetFileName,
    scale,
    date: input.now ?? new Date(),
  });
  if (!result.ok) throw invalidPatternError(result.issues);

  return input.assets.map((asset, i) => ({
    id: asset.id,
    name: asset.name,
    stem: result.stems[i] as string,
    fileName: result.fileNames[i] as string,
  }));
}
