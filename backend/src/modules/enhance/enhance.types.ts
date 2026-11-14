import type { StorageProviderName } from '../../lib/storage/status';

export type EnhanceJobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface ExcaliburRecipe {
  schemaVersion: 1;
  engine: 'openassets-excalibur';
  engineVersion: '2';
  sourceSha256: string;
  sourceKind: 'raster' | 'svg';
  cleanup: number;
  speckRemoval: number;
  contrast: number;
  background: 'transparent' | 'white' | 'dark';
  scale: 1 | 2 | 3;
}

export interface EnhanceJobHash {
  userId: string;
  status: EnhanceJobStatus;
  sourceUrl: string;
  sourcePublicId: string;
  sourceSha256: string;
  recipe: string;
  resultUrl: string;
  resultPublicId: string;
  error: string;
  createdAt: string;
}

export interface EnhanceJobResponse {
  jobId: string;
  kind: 'excalibur';
  status: EnhanceJobStatus;
  recipe: ExcaliburRecipe;
  resultUrl?: string;
  error?: string;
}

// ── AI enhance ──────────────────────────────────────────────────────────────

export type AiEnhanceScale = 2 | 4;
export type AiEnhanceImageFormat = 'png' | 'jpeg' | 'webp';

/** What the user asked for. At least one operation is always set. */
export interface AiEnhanceOptions {
  /** `null` leaves the resolution alone. */
  scale: AiEnhanceScale | null;
  removeBackground: boolean;
}

export interface Dimensions {
  width: number;
  height: number;
}

/** Persisted job state (Redis hash, so every field round-trips as a string). */
export interface AiEnhanceJobRecord {
  id: string;
  userId: string;
  status: EnhanceJobStatus;
  provider: StorageProviderName;
  options: AiEnhanceOptions;
  source: Dimensions & { bytes: number; format: AiEnhanceImageFormat };
  sourceUrl: string;
  sourcePublicId: string;
  resultUrl: string;
  /** Plain-language failure reason, safe to show to the user. */
  error: string;
  errorCode: string;
  createdAt: string;
}

/** Ordered operations, recorded so a result can be explained or recreated. */
export type AiEnhanceOperation =
  | { op: 'upscale'; scale: AiEnhanceScale }
  | { op: 'background_removal' };

export interface AiEnhanceRecipe {
  tool: 'ai';
  provider: StorageProviderName;
  operations: AiEnhanceOperation[];
  source: Dimensions;
  output: Dimensions;
}

/** Shape returned by `POST /api/enhance/ai` and `GET /api/enhance/ai/:jobId`. */
export interface AiEnhanceJobResponse {
  jobId: string;
  kind: 'ai';
  status: EnhanceJobStatus;
  recipe: AiEnhanceRecipe;
  /** Provider URL of the finished PNG. Browsers should use the `/result` route. */
  resultUrl?: string;
  error?: string;
  errorCode?: string;
}
