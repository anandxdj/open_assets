import axios from 'axios';
import type { BoundingBox } from '../modules/jobs/job.types';

const pyClient = axios.create({
  baseURL: process.env.PY_BACKEND_URL ?? 'http://localhost:8000',
  timeout: 120_000,
  // SECURITY (#10): authenticate to the internal Python service. The header is
  // only present when INTERNAL_API_TOKEN is set; the Python side likewise only
  // enforces it when configured, so local dev keeps working.
  headers: process.env.INTERNAL_API_TOKEN
    ? { 'X-Internal-Token': process.env.INTERNAL_API_TOKEN }
    : undefined,
});

export interface DetectedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export interface DetectResult {
  boxes: DetectedBox[];
  image_width: number;
  image_height: number;
}

export interface TransparencyResult {
  transparent: boolean;
  image_width: number;
  image_height: number;
}

export interface AssetResult {
  id: string;
  name: string;
  cropped_url: string;
  public_id: string;
}

export interface CropResult {
  assets: AssetResult[];
}

/** Structured naming result — one Gemini call produces names + collection scaffold. */
export interface NamedAsset {
  systematic: string;
  name: string;
  folder?: string | null;
  tags?: string[];
  description?: string | null;
  dominant_colors?: string[];
}

export interface NameAssetsResult {
  names: Record<string, string>;
  collection?: { name?: string | null; tags?: string[] } | null;
  folders?: { name: string; tags?: string[] }[];
  assets?: NamedAsset[];
}

function toBoxInput(boxes: BoundingBox[]) {
  return boxes.map((b) => ({
    id: b.id,
    // py BoxInput coords are `int`; user-drawn boxes carry float coords from the
    // screen→image transform, which would 422 Pydantic. Round to integer pixels.
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
    name: b.label ?? b.id,
  }));
}

export async function checkTransparency(imageUrl: string): Promise<TransparencyResult> {
  const res = await pyClient.post<TransparencyResult>('/check-transparency', {
    image_url: imageUrl,
  });
  return res.data;
}

export async function detectAssets(imageUrl: string): Promise<DetectResult> {
  const res = await pyClient.post<DetectResult>('/detect', { image_url: imageUrl });
  return res.data;
}

export async function nameAssets(
  imageUrl: string,
  boxes: BoundingBox[],
): Promise<NameAssetsResult> {
  const res = await pyClient.post<NameAssetsResult>('/name-assets', {
    image_url: imageUrl,
    boxes: toBoxInput(boxes),
  });
  return res.data;
}

export async function cropAssets(
  imageUrl: string,
  boxes: BoundingBox[],
  jobId: string,
): Promise<CropResult> {
  const res = await pyClient.post<CropResult>('/crop', {
    image_url: imageUrl,
    boxes: toBoxInput(boxes),
    job_id: jobId,
  });
  return res.data;
}
