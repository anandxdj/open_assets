export type JobStatus =
  | 'uploaded'
  | 'queued'
  | 'detecting'
  | 'removing_bg'
  | 'detected'
  | 'naming'
  | 'cropping'
  | 'cropped'
  | 'finalizing'
  | 'ready'
  | 'failed';

export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  croppedUrl?: string;
}

export interface Asset {
  id: string;
  name: string;
  cropped_url: string;
  public_id: string;
  upscaled_url?: string; // set per-asset as cloud upscale completes
}

export interface JobHash {
  status: JobStatus;
  cloudinaryUrl: string;
  publicId: string;
  workingUrl: string;
  isTransparent: string;
  imageWidth: string;
  imageHeight: string;
  boxes: string;          // JSON.stringify(BoundingBox[])
  nameMap: string;        // JSON.stringify(Record<string,string>)
  assets: string;         // JSON.stringify(Asset[])
  selectedIds: string;    // JSON.stringify(string[])
  skipUpscale?: string;   // 'true' | 'false'
  downloadUrl: string;
  error: string;
  userId: string;
  createdAt: string;
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
  assets: Asset[];
  downloadUrl?: string;
  error?: string;
}
