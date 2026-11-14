import type { BackgroundMethod, BackgroundRemovalMode, JobBackground } from '../../lib/background';

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
  file_name?: string;    // export file name (with .png) the naming pattern gave it; set when finalize starts
}

export interface JobHash {
  status: JobStatus;
  cloudinaryUrl: string;
  publicId: string;
  fileName?: string;      // original upload name; empty on jobs created before it was stored
  workingUrl: string;
  isTransparent: string;
  imageWidth: string;
  imageHeight: string;
  detectionMode: string;
  detectionConfidence: string;
  detectionWarning: string;
  background?: string;    // JSON.stringify(JobBackground), set by detection; absent on jobs from before it existed
  backgroundRemoval?: BackgroundRemovalMode; // what the crop asked for; absent = auto
  backgroundMethod?: BackgroundMethod;       // which method the crop ran
  backgroundReason?: string;                 // why the background was kept, when it was
  workingPublicId?: string;                  // storage id of the keyed sheet the crop cut from, when the server keyed it
  boxes: string;         // JSON.stringify(BoundingBox[])
  nameMap: string;        // JSON.stringify(Record<string,string>)
  assets: string;         // JSON.stringify(Asset[])
  assetCount?: string;    // length of assets, kept in step by updateJob() so lists need not parse them
  boxCount?: string;      // length of boxes, same
  selectedIds: string;    // JSON.stringify(string[])
  skipUpscale?: string;   // 'true' | 'false'
  upscaleScale?: string;  // '2' | '4' (export upscale factor)
  namingPattern?: string; // pattern the export's file names follow; validated and plan-gated in finalize.controller
  downloadUrl: string;
  error: string;
  userId: string;
  createdAt: string;
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
  /** What the sheet's background is, from detection. Absent on jobs detected before this existed. */
  background?: JobBackground;
  /** The mode the crop was asked to use ('auto' when the request sent none), once the crop has started. */
  backgroundRemoval?: BackgroundRemovalMode;
  /** Which method ran: nothing, our free server keyer, or the provider's AI (paid). Set once the crop has run. */
  backgroundMethod?: BackgroundMethod;
  /** Why the background was kept, when it was. */
  backgroundReason?: string;
  boxes: BoundingBox[];
  assets: Asset[];
  downloadUrl?: string;
  /** Upscale factor chosen for the export (2 or 4), once finalize has started. */
  upscaleScale?: number;
  /** Naming pattern the export's file names follow, once finalize has started. */
  namingPattern?: string;
  error?: string;
}

/** One row of GET /jobs: what a job list shows, without boxes or assets. */
export interface JobSummary {
  jobId: string;
  status: JobStatus;
  fileName?: string;
  assetCount: number;
  createdAt: string;      // ISO 8601
  imageUrl: string;
  error?: string;
}

/** A page of GET /jobs. `nextCursor` is null on the last page. */
export interface JobListPage {
  jobs: JobSummary[];
  nextCursor: string | null;
}
