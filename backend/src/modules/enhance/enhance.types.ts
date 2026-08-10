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
