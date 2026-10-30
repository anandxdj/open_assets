import { refreshAccessToken } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Mirrors backend modules/enhance/enhance.types.ts and aiEnhance.limits.ts. Keep in sync.

export type AiScale = 2 | 4;

export interface AiEnhanceOptions {
  /** `null` keeps the original resolution. */
  scale: AiScale | null;
  removeBackground: boolean;
}

export interface AiEnhanceLimits {
  minSide: number;
  maxSide: number;
  maxBytes: number;
  /** Highest pixel count the provider accepts as upscale input. */
  maxUpscaleInputPixels: number;
  maxUpscaleOutputPixels: number | null;
  /** Longest side background removal accepts, measured after any upscale. */
  maxBackgroundRemovalSide: number | null;
}

export interface AiCapabilities {
  provider: "cloudinary" | "imagekit";
  providerLabel: string;
  available: boolean;
  /** Machine-readable reason when `available` is false. */
  reason?: string;
  /** Plain-language reason when `available` is false. */
  message?: string;
  /** `maxScale` is the highest factor this account's plan allows (free 2, Pro 4). */
  operations: { upscale: { scales: AiScale[]; maxScale?: AiScale }; backgroundRemoval: boolean };
  limits: AiEnhanceLimits;
}

export type AiJobStatus = "queued" | "processing" | "ready" | "failed";

export interface AiEnhanceJob {
  jobId: string;
  kind: "ai";
  status: AiJobStatus;
  recipe: {
    tool: "ai";
    provider: "cloudinary" | "imagekit";
    operations: ({ op: "upscale"; scale: AiScale } | { op: "background_removal" })[];
    source: { width: number; height: number };
    output: { width: number; height: number };
  };
  resultUrl?: string;
  error?: string;
  errorCode?: string;
}

export const STORAGE_NOT_CONFIGURED = "STORAGE_NOT_CONFIGURED";

export class AiEnhanceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "AiEnhanceError";
  }
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

const NETWORK_MESSAGE = "Network error. Check your connection and try again.";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorFrom(status: number, body: { message?: string; code?: string } | null): AiEnhanceError {
  // 5xx bodies without a code carry generic text ("Internal Server Error").
  if (!body?.code && status >= 500) {
    return new AiEnhanceError("AI enhance hit a server error. Try again in a moment.", status);
  }
  return new AiEnhanceError(body?.message ?? `Request failed (HTTP ${status}).`, status, body?.code);
}

/** fetch with the bearer token and one refresh-and-retry on 401, like the shared api client. */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) },
    });
  try {
    let res = await send(tokenStore.get());
    if (res.status === 401) {
      const token = await refreshAccessToken();
      if (token) res = await send(token);
    }
    return res;
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new AiEnhanceError(NETWORK_MESSAGE, 0, "NETWORK");
  }
}

async function readData<T>(res: Response): Promise<T> {
  if (!res.ok) throw errorFrom(res.status, (await res.json().catch(() => null)) as { message?: string; code?: string } | null);
  return ((await res.json()) as Envelope<T>).data;
}

/** What AI enhance can do on this server right now (provider, availability, limits). */
export async function fetchAiCapabilities(signal?: AbortSignal): Promise<AiCapabilities> {
  return readData<AiCapabilities>(await authedFetch("/api/enhance/capabilities", { signal }));
}

export async function getAiEnhanceJob(jobId: string, signal?: AbortSignal): Promise<AiEnhanceJob> {
  return readData<AiEnhanceJob>(await authedFetch(`/api/enhance/ai/${encodeURIComponent(jobId)}`, { signal }));
}

/** The finished PNG, fetched through the API so the bearer token is sent. */
export async function fetchAiEnhanceResult(jobId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await authedFetch(`/api/enhance/ai/${encodeURIComponent(jobId)}/result`, { signal });
  if (!res.ok) throw errorFrom(res.status, (await res.json().catch(() => null)) as { message?: string; code?: string } | null);
  return res.blob();
}

type XhrResult = { status: number; body: unknown };

function sendWithProgress(
  form: FormData,
  token: string | null,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/api/enhance/ai`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.response });
    xhr.onerror = () => reject(new AiEnhanceError(NETWORK_MESSAGE, 0, "NETWORK"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", onAbort);

    xhr.send(form);
  });
}

/**
 * POST /api/enhance/ai with real byte progress (fetch can't report upload
 * progress). Resolves with the queued job; poll `getAiEnhanceJob` for the rest.
 */
export async function submitAiEnhance(
  file: File,
  options: AiEnhanceOptions,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<AiEnhanceJob> {
  const form = new FormData();
  form.append("image", file);
  if (options.scale !== null) form.append("scale", String(options.scale));
  form.append("removeBackground", String(options.removeBackground));

  let res = await sendWithProgress(form, tokenStore.get(), onProgress, signal);
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (token) {
      onProgress(0);
      res = await sendWithProgress(form, token, onProgress, signal);
    }
  }

  if (res.status < 200 || res.status >= 300) {
    throw errorFrom(res.status, res.body as { message?: string; code?: string } | null);
  }
  const envelope = res.body as Envelope<AiEnhanceJob> | null;
  if (!envelope?.data?.jobId) throw new AiEnhanceError("The server did not return a job.", res.status);
  return envelope.data;
}
