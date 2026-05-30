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

export type ExportStatus = "pending" | "processing" | "ready" | "failed";

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
  cloudinaryUrl: string;
  workingUrl?: string;
  isTransparent?: boolean;
  imageWidth: number;
  imageHeight: number;
  boxes: BoundingBox[];
  assets?: any[];
  downloadUrl?: string;
  error?: string;
}

export interface Asset {
  id: string;
  name: string;
  cropped_url: string;
  public_id: string;
  upscaled_url?: string; // set per-asset as cloud upscale completes
}

export interface ExportJobResponse {
  exportJobId: string;
  status: ExportStatus;
  downloadUrl?: string;
  error?: string;
}

export interface UploadResponse {
  jobId: string;
  cloudinaryUrl: string;
  status: "queued";
}
