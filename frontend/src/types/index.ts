// Mirrors backend job.types.ts — keep in sync

export type JobStatus =
  | "uploaded"
  | "queued"
  | "detecting"
  | "removing_bg"
  | "detected"
  | "naming"
  | "cropping"
  | "cropped"
  | "finalizing"
  | "ready"
  | "failed";

export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  tags?: string[];
  croppedUrl?: string;
  enhancedUrl?: string;
}

export interface JobResponse {
  jobId: string;
  status: JobStatus;
  fileName?: string;
  cloudinaryUrl: string;
  workingUrl?: string;
  isTransparent?: boolean;
  imageWidth: number;
  imageHeight: number;
  detectionMode?: string;
  detectionConfidence?: number;
  detectionWarning?: string;
  boxes: BoundingBox[];
  assets?: Asset[];
  downloadUrl?: string;
  /** Upscale factor chosen for the export (2 or 4), once finalize has started. */
  upscaleScale?: number;
  /** Naming pattern the export's file names follow, once finalize has started. */
  namingPattern?: string;
  error?: string;
}

/** One row of GET /api/jobs: what a job list shows, without boxes or assets. */
export interface JobSummary {
  jobId: string;
  status: JobStatus;
  fileName?: string;
  assetCount: number;
  createdAt: string; // ISO 8601
  imageUrl: string;
  error?: string;
}

/** A page of GET /api/jobs. `nextCursor` is null on the last page. */
export interface JobListPage {
  jobs: JobSummary[];
  nextCursor: string | null;
}

export interface Asset {
  id: string;
  name: string;
  cropped_url: string;
  public_id: string;
  upscaled_url?: string; // set per-asset as cloud upscale completes
  /** Export file name (with .png) the server's naming pattern gave it, set when finalize starts. */
  file_name?: string;
}

export interface UploadResponse {
  jobId: string;
  cloudinaryUrl: string;
  status: "queued";
}
