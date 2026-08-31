// The AniBuddy pipeline gateway, from the browser's side.
//
// Every call goes to the Express gateway at /api/anibuddy. The browser never talks
// to py_backend directly (F9 §5), and it never authors a RigDocument -- it uploads
// a sheet, asks for a stage, writes clips, and reads back what the pipeline
// produced.
//
// The one thing this module cannot send is `diagnostics`. A clip write posts a
// Clip and nothing larger, so `diagnostics.blockingReason` -- the export gate the
// Python validator authors (F9 §7.8) -- has no field to arrive through.
//
// Auth, the Express base URL and one-shot token refresh already live in
// @/lib/api-client; this module adds the AniBuddy paths, unwraps the gateway's
// { success, message, data } envelope, and types the result. It deliberately does
// not re-derive any of that handling.

import { apiClient } from "@/lib/api-client";
import type { Archetype, Clip, RigDocument } from "@/features/anibuddy/rig/index.rig";

/** Every stage that has its own queue. `semantics` rides inside `rig`. */
export const QUEUED_STAGES = ["decompose", "rig", "animate", "render"] as const;
export type QueuedStage = (typeof QUEUED_STAGES)[number];

export type ProjectStatus = "draft" | "queued" | "processing" | "ready" | "failed";
export type StageProgressStatus = "idle" | "queued" | "running" | "succeeded" | "failed";

export interface StageProgress {
  stage: QueuedStage | null;
  status: StageProgressStatus;
  percent: number;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  inputHash: string | null;
  bullJobId: string | null;
}

export interface ProjectAsset {
  id: string;
  name: string;
  storageKey: string;
  /**
   * Signed or CDN URL, when the gateway chose to hand one out.
   *
   * Absent for a private sheet, which is deliberate: the browser is not given a
   * raw provider URL (F9 §7.3). The editor previews from the file the user still
   * holds locally in that case, and says so when it holds neither.
   */
  sourceUrl?: string;
  contentHash: string;
  width: number;
  height: number;
  mimeType: "image/png" | "image/webp" | "image/jpeg";
  rightsConfirmed: boolean;
  remoteVisionConsented: boolean;
}

export interface ArtifactRef {
  kind: string;
  storageKey: string;
  contentHash: string;
  stage: QueuedStage;
  url?: string;
  createdAt: string;
}

export interface AniBuddyProject {
  id: string;
  name: string;
  status: ProjectStatus;
  archetype: Archetype;
  asset: ProjectAsset;
  currentRevision: number;
  /**
   * The latest revision, validated by the gateway's zod DTO before it was stored.
   *
   * Null until `decompose` has landed one. Treat it as read-only: geometry and
   * `diagnostics` are server-authoritative (R5), and `diagnostics.blockingReason`
   * in particular is a sentence the client displays and never composes.
   */
  currentDocument: RigDocument | null;
  stageProgress: StageProgress;
  artifactRefs: ArtifactRef[];
  usageEventIds: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  pipelineVersion: string;
  kernelVersion: string;
}

export interface EnqueueReceipt {
  stage: QueuedStage;
  jobId: string | null;
  usageEventId: string;
  cost: number;
  remaining: number;
  inputHash: string;
}

/** An enqueue response is a project plus what the call cost. */
export type EnqueuedProject = AniBuddyProject & { enqueue: EnqueueReceipt };

/**
 * A create response, which carries a receipt only when it also enqueued.
 *
 * `enqueueDecompose` defaults to true on the gateway and, when set, create returns
 * whatever enqueue returned -- so the receipt is present in the common case and absent
 * when a project was created without starting work.
 */
export type CreatedProject = AniBuddyProject & { enqueue?: EnqueueReceipt };

export interface CreateProjectInput {
  name?: string;
  archetype: Archetype;
  asset: {
    id?: string;
    name: string;
    storageKey: string;
    sourceUrl?: string;
    contentHash: string;
    width: number;
    height: number;
    mimeType: ProjectAsset["mimeType"];
    rightsConfirmed: boolean;
    remoteVisionConsented: boolean;
  };
  enqueueDecompose?: boolean;
}

/**
 * A stored source sheet, as the gateway measured it.
 *
 * Every field here is derived server-side from the bytes that actually landed --
 * the format from the file's own header, `contentHash` over those exact bytes.
 * The browser deliberately does not compute them: a hash taken over anything
 * other than what the pipeline will read is a cache key that lies (F9 §7.3).
 */
export interface StoredSheet {
  id: string;
  name: string;
  storageKey: string;
  sourceUrl?: string;
  contentHash: string;
  width: number;
  height: number;
  mimeType: ProjectAsset["mimeType"];
  byteLength: number;
}

/** A clip as it is sent for persistence: `source` is stamped by the server. */
export type ClipDraft = Omit<Clip, "source">;

/** Output formats the render stage encodes to. `png-zip` needs no ffmpeg. */
export const RENDER_FORMATS = ["png-zip", "gif", "webm", "mp4"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

/** Mattes the render stage accepts. A format without alpha is matted and says so. */
export const RENDER_BACKGROUNDS = ["transparent", "white", "dark", "black"] as const;
export type RenderBackground = (typeof RENDER_BACKGROUNDS)[number];

/**
 * What an enqueue may say about the stage it is starting.
 *
 * Deliberately small. Geometry, diagnostics and the export gate are
 * server-authored (R5), so the only things here are a clip to sample, an output
 * shape, and per-part deformer choices the user made by looking at the artwork
 * (F9 §9). The gateway revalidates all of it and refuses an unknown value before
 * a credit is spent.
 */
export interface EnqueueOptions {
  rig?: {
    deformerOverrides?: Record<string, "rigid" | "mesh" | "lattice" | "spline">;
  };
  render?: {
    /** Absent renders a single still at rest, which is the rig thumbnail. */
    clipId?: string;
    format?: RenderFormat;
    fps?: number;
    frameCount?: number;
    width?: number;
    height?: number;
    maxEdge?: number;
    background?: RenderBackground;
    loop?: boolean;
  };
}

interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

const BASE_PATH = "/api/anibuddy/projects";
const ASSET_PATH = "/api/anibuddy/assets";
const SHEET_FIELD = "sheet";

export const AniBuddyAssetApi = {
  /**
   * Store a source sheet and get back an `AssetRef` to open a project with.
   *
   * This is the only way a project acquires an asset its stages can fetch. The
   * result is content-addressed, so uploading the same sheet twice is idempotent
   * and lands on the same key.
   */
  async upload(file: File, name?: string): Promise<StoredSheet> {
    const form = new FormData();
    form.append(SHEET_FIELD, file, file.name);
    if (name) form.append("name", name);
    const response = await apiClient.postForm<Envelope<StoredSheet>>(ASSET_PATH, form);
    return response.data;
  },
} as const;

export const AniBuddyProjectApi = {
  /**
   * Create a project and, by default, enqueue `decompose` in the same call.
   *
   * The gateway pre-authorizes credits inside enqueue, so a create that enqueues
   * can fail on credits after the project row exists. That is the gateway's
   * contract, not something to paper over here -- the caller re-reads the project
   * and shows the error against it.
   */
  async create(input: CreateProjectInput): Promise<CreatedProject> {
    const response = await apiClient.post<Envelope<CreatedProject>>(BASE_PATH, input);
    return response.data;
  },

  async list(): Promise<AniBuddyProject[]> {
    const response = await apiClient.get<Envelope<AniBuddyProject[]>>(BASE_PATH);
    return response.data;
  },

  /** The polling surface. SSE can wrap the same read later. */
  async get(projectId: string): Promise<AniBuddyProject> {
    const response = await apiClient.get<Envelope<AniBuddyProject>>(
      `${BASE_PATH}/${encodeURIComponent(projectId)}`,
    );
    return response.data;
  },

  /**
   * Enqueue one stage.
   *
   * `units` is what the stage's credit rate is multiplied by -- detected parts for
   * `decompose`, parts for `rig`, clips for `animate`, frames for `render` (F9
   * §13). The gateway clamps it to 1..20 and prices it server-side; passing a
   * wrong number cannot underpay, only misreport.
   */
  async enqueue(
    projectId: string,
    stage: QueuedStage,
    units?: number,
    options?: EnqueueOptions,
  ): Promise<EnqueuedProject> {
    const response = await apiClient.post<Envelope<EnqueuedProject>>(
      `${BASE_PATH}/${encodeURIComponent(projectId)}/enqueue`,
      {
        stage,
        ...(units === undefined ? {} : { units }),
        ...(options?.rig ? { rig: options.rig } : {}),
        ...(options?.render ? { render: options.render } : {}),
      },
    );
    return response.data;
  },

  /**
   * Persist a clip onto the project's current revision.
   *
   * The gateway writes a child revision rather than editing one in place (R9), so
   * the returned project carries a bumped `currentRevision` and a document whose
   * `diagnostics` are untouched. A clip naming a joint or part the current
   * document does not contain is refused whole rather than partly applied -- that
   * is the stale-clip case, and a half-applied clip animates wrongly while
   * looking deliberate (R7).
   */
  async createClip(projectId: string, clip: ClipDraft): Promise<AniBuddyProject> {
    const response = await apiClient.post<Envelope<AniBuddyProject>>(
      `${BASE_PATH}/${encodeURIComponent(projectId)}/clips`,
      clip,
    );
    return response.data;
  },

  async updateClip(projectId: string, clip: ClipDraft): Promise<AniBuddyProject> {
    const response = await apiClient.put<Envelope<AniBuddyProject>>(
      `${BASE_PATH}/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clip.id)}`,
      clip,
    );
    return response.data;
  },

  async deleteClip(projectId: string, clipId: string): Promise<AniBuddyProject> {
    const response = await apiClient.del<Envelope<AniBuddyProject>>(
      `${BASE_PATH}/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}`,
    );
    return response.data;
  },
} as const;
