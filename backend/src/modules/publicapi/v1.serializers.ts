import { parseBackground } from '../../lib/background';
import type { BackgroundKind, BackgroundMethod, BackgroundRemovalMode } from '../../lib/background';
import { parseAssets, parseBoxes } from '../jobs/job.store';
import type { JobSummaryRecord } from '../jobs/job.store';
import type { BoundingBox, JobHash, JobStatus } from '../jobs/job.types';

/*
 * What `/api/v1` returns for a job. A separate shape from the web app's
 * GET /api/jobs/:id on purpose: this one is a public contract, so it names no
 * storage provider and drops internals (working URLs, name maps, the raw
 * `selectedIds`). Add fields freely; renaming or removing one is a v2 change.
 */

export interface V1Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The name detection gave the box ("asset_001") until the crop is named. */
  label: string | null;
}

export interface V1Asset {
  /** Same id as the box it was cut from. */
  id: string;
  /** The name the crop gave it, or the one set at export. Also the file name in the ZIP. */
  name: string;
  /** The cut-out PNG with its background removed. */
  url: string;
  /** The upscaled PNG, once the export has produced it. */
  upscaledUrl: string | null;
  /** The file name (with .png) the export's naming pattern gave it. null until the export has started. */
  fileName: string | null;
}

export interface V1Job {
  jobId: string;
  status: JobStatus;
  fileName: string | null;
  createdAt: string | null;
  image: { url: string; width: number; height: number };
  detection: { mode: string | null; confidence: number | null; warning: string | null };
  /**
   * What the sheet's background is, from detection: `transparent`, `flat` (white, black, a plain colour),
   * `chroma` (magenta, green, blue screen) or `complex` (gradient, texture). `color` is set for flat and chroma.
   * null on jobs detected before this existed.
   */
  background: { kind: BackgroundKind; color: string | null } | null;
  /**
   * How the crop treated the background, once it has run. `method`: `server` (our free keyer), `ai` (the
   * provider's paid AI removal) or `none`; `reason` says why the background was kept. null before the crop.
   */
  backgroundRemoval: { mode: BackgroundRemovalMode; method: BackgroundMethod; reason: string | null } | null;
  boxes: V1Box[];
  assets: V1Asset[];
  export: {
    /** Upscale factor of the export once it has started: 2 or 4, or 1 when it skipped upscaling. */
    scale: 1 | 2 | 4 | null;
    /** The naming pattern the export's file names follow, once it has started. */
    namingPattern: string | null;
    /** The ZIP can be downloaded. */
    ready: boolean;
  };
  error: string | null;
}

export interface V1JobSummary {
  jobId: string;
  status: JobStatus;
  fileName: string | null;
  assetCount: number;
  createdAt: string;
  imageUrl: string;
  error: string | null;
}

export interface V1JobPage {
  jobs: V1JobSummary[];
  /** Pass as `?cursor=` for the next page. null on the last page. */
  nextCursor: string | null;
}

const number = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : null;
};

function toBox(box: BoundingBox): V1Box {
  return { id: box.id, x: box.x, y: box.y, width: box.width, height: box.height, label: box.label ?? null };
}

export function serializeJob(job: JobHash & { id: string }): V1Job {
  const scale = number(job.upscaleScale);
  return {
    jobId: job.id,
    status: job.status,
    fileName: job.fileName || null,
    createdAt: job.createdAt || null,
    image: { url: job.cloudinaryUrl, width: number(job.imageWidth) ?? 0, height: number(job.imageHeight) ?? 0 },
    detection: {
      mode: job.detectionMode || null,
      confidence: number(job.detectionConfidence),
      warning: job.detectionWarning || null,
    },
    background: ((bg) => (bg ? { kind: bg.kind, color: bg.color ?? null } : null))(parseBackground(job.background)),
    backgroundRemoval: job.backgroundMethod
      ? { mode: job.backgroundRemoval ?? 'auto', method: job.backgroundMethod, reason: job.backgroundReason || null }
      : null,
    boxes: parseBoxes(job.boxes).map(toBox),
    assets: parseAssets(job.assets).map((a) => ({
      id: a.id,
      name: a.name,
      url: a.cropped_url,
      upscaledUrl: a.upscaled_url ?? null,
      fileName: a.file_name ?? null,
    })),
    export: {
      scale: job.skipUpscale === 'true' ? 1 : scale === 2 || scale === 4 ? scale : null,
      namingPattern: job.namingPattern || null,
      ready: job.status === 'ready',
    },
    error: job.error || null,
  };
}

export function serializeJobSummary(job: JobSummaryRecord): V1JobSummary {
  return {
    jobId: job.id,
    status: job.status,
    fileName: job.fileName || null,
    assetCount: Number(job.assetCount) || Number(job.boxCount) || 0,
    createdAt: job.createdAt,
    imageUrl: job.cloudinaryUrl,
    error: job.error || null,
  };
}
