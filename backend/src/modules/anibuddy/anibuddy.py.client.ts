// HTTP client for AniBuddy's endpoints on py_backend.
//
// Handoff pattern (ONE system — matches detection/crop):
//   Frontend → Express AniBuddy API → BullMQ (Node) → Worker → HTTP POST on
//   py_backend → stage → JSON back.
//
// Which endpoint a stage posts to is not decided here. It is read from
// `AniBuddyConstants.pathByTransport`, so promoting a stage from the JSON stub
// to its real multipart endpoint is one edit in the constants table and no edit
// in the worker or the service. This module owns only how each transport shapes
// its request and normalizes its response.
//
// Node owns StorageAdapter throughout: Python holds no storage credentials, so a
// real stage receives the sheet as multipart bytes and returns oversized results
// as base64 (or a stream path) for Node to upload.
//
// The three vision-facing calls at the bottom are py_backend's half of the
// critique loop and of the semantics step: they carry pixels in and a validated
// document out. The model call is not among them and must not move here — it
// belongs to the one provider-fallback chain in the Next app
// (`anibuddy.vision.client.ts`), and a second copy of that chain is how a fallback
// chain acquires two behaviours.

import { createHash } from 'node:crypto';
import { Blob } from 'node:buffer';
import type { Readable } from 'node:stream';
import axios from 'axios';
import { Config } from '../../common/config/config';
import { ANIBUDDY_CRITIQUE_ERROR_CODES, AniBuddyConstants } from './anibuddy.constants';
import type {
  AniBuddyCritiqueErrorCode,
  AniBuddyQueuedStage,
  AniBuddyStageTransport,
} from './anibuddy.constants';
import type { AniBuddyBufferUpload } from './anibuddy.buffer.sidecar';
import type {
  CritiqueReport,
  DeformerKind,
  RigDocument,
  SemanticsProposal,
} from './dto/rig-document.generated';
import type { AniBuddyRigOptions, AniBuddyRenderOptions } from './dto/project.schema';

/** The sheet's bytes, read back out of storage by the caller. */
export interface AniBuddyStageSheet {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * One external `NumericBuffer`, read back out of storage for a stage that must
 * evaluate it. Named by its own content hash, which is how Python matches it to
 * the reference in the document.
 */
export interface AniBuddyResolvedBuffer {
  sha256: string;
  bytes: Buffer;
}

export interface AniBuddyStageRequest {
  projectId: string;
  stage: AniBuddyQueuedStage;
  inputHash: string;
  passIndex: number;
  usageEventId: string | null;
  pipelineVersion: string;
  kernelVersion: string;
  asset: {
    id: string;
    name: string;
    storageKey: string;
    sourceUrl?: string;
    contentHash: string;
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
    rightsConfirmed: boolean;
    remoteVisionConsented: boolean;
  };
  archetype: string;
  /** Previous revision document, if any — stubs ignore it; real stages write a child revision. */
  parentDocument: RigDocument | null;
  currentRevision: number;
  /** Id the stage must stamp on the child revision it writes (R9). */
  revisionId: string;
  revisionIndex: number;
  /** Present exactly when `AniBuddyConstants.sheetPolicyByTransport` calls for it. */
  sheet: AniBuddyStageSheet | null;
  /**
   * The document's external geometry, for a transport that has to read it.
   *
   * Empty for a document whose buffers are all inline, which is every document
   * decompose produces.
   */
  buffers: readonly AniBuddyResolvedBuffer[];
  /**
   * A validated semantics proposal, when the vision pass produced one.
   *
   * Null is a normal outcome, not a degraded one: the rig stage falls back to its
   * geometric prior (F9 §8.2). The gateway never authors one — the field exists so
   * the vision layer has a seam to hand a *validated* proposal through, and the
   * Python side revalidates every id against the live document regardless.
   */
  semantics: SemanticsProposal | null;
  /** Per-part user overrides of the archetype prior's deformer choice (F9 §9). */
  rig: AniBuddyRigOptions | null;
  /** Clip, format and sizing for the render stage. */
  render: AniBuddyRenderOptions | null;
}

export interface AniBuddyStageArtifactHint {
  kind: string;
  suggestedStorageKey: string;
  contentHash: string;
  /**
   * UTF-8 JSON or small binary for Node to upload via StorageAdapter.
   *
   * Absent (or null) on a render whose payload exceeded the inline threshold; in
   * that case `cacheKey` names the stream to fetch instead. Base64 inflates by
   * 4/3, and a 120-frame PNG zip inside a JSON body is that inflation buffered
   * four times over — by FastAPI, the socket, axios and `Buffer.from`.
   */
  contentBase64?: string | null;
  mimeType?: string;
  byteLength?: number;
  /** Present exactly when the artifact is streamable from the render cache. */
  cacheKey?: string | null;
  /** Python's own path for the stream. Read as a signal; the path comes from constants. */
  downloadPath?: string | null;
}

export interface AniBuddyStageResponse {
  document: RigDocument;
  artifact?: AniBuddyStageArtifactHint | null;
  /** Oversized `NumericBuffer` payloads for Node to write through storage (F9 §7.6). */
  buffers?: AniBuddyBufferUpload[];
  message?: string | null;
  /** Which transport produced this, for the progress line and the log. */
  transport: AniBuddyStageTransport;
  /**
   * The model that actually SERVED this stage, when a model ran at all.
   *
   * Present only for a `vision` transport. Null everywhere else, and that is a
   * statement rather than a gap: three of the five transports are OpenCV and NumPy
   * geometry, and naming a model on one of them would attribute local arithmetic to
   * a provider. The worker reconciles the usage event exactly when this is set (R13).
   */
  servedModel?: string | null;
}

/** An artifact too large to inline, as a stream Node pipes straight into storage. */
export interface AniBuddyArtifactStream {
  stream: Readable;
  contentType: string | null;
  byteLength: number | null;
}

/** One row of the number-to-part-id legend py_backend drew onto the sheet. */
export interface AniBuddyPartLegendEntry {
  partId: string;
  label: number;
  name: string;
  role: string;
  zIndex: number;
  confidence: number;
}

export interface AniBuddyAnnotateResult {
  imageDataUrl: string;
  width: number;
  height: number;
  legend: AniBuddyPartLegendEntry[];
  archetype: string;
  warnings: string[];
}

export interface AniBuddyContactSheetResult {
  imageDataUrl: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  frameCount: number;
  frameTimes: number[];
  /** The RENDER stage's child revision. Keep this, not the one that was sent. */
  document: RigDocument;
  maxStretch: number;
  flippedTriangles: number;
  blockingReason: string | null;
  cacheKey: string;
  warnings: string[];
}

export interface AniBuddyApplyCritiqueResult {
  document: RigDocument;
  applied: Array<{
    kind: string;
    targetId: string | null;
    reason: string;
    effect: string;
    clamped: boolean;
  }>;
  deformerOverrides: Record<string, DeformerKind>;
  requiresRerig: boolean;
  warnings: string[];
}

interface DecomposeWireResponse {
  document: RigDocument;
}

interface RigWireResponse {
  document: RigDocument;
  buffers: AniBuddyBufferUpload[];
  message: string | null;
}

interface RenderWireResponse {
  document: RigDocument;
  artifact: {
    kind: string;
    suggestedStorageKey: string;
    contentHash: string;
    mimeType: string;
    byteLength: number;
    frameCount: number;
    width: number;
    height: number;
    format: string;
    cacheKey: string;
    contentBase64: string | null;
    downloadPath: string | null;
  };
  cacheKey: string;
  cacheHit: boolean;
  requestedFormat: string;
  servedFormat: string;
  message: string | null;
}

const pyClient = axios.create({
  baseURL: Config.pyBackend.baseUrl,
  timeout: Config.pyBackend.timeoutMs,
  headers: Config.security.internalApiToken
    ? { 'X-Internal-Token': Config.security.internalApiToken }
    : undefined,
});

export const AniBuddyPyClient = {
  /**
   * Turn a stage failure into a sentence.
   *
   * Every refusal on the Python side is a 422 whose `detail` states what about
   * the request was wrong. Axios's own message is only ever "Request failed with
   * status code 422", which is the least useful half of what arrived, and this
   * string reaches the user through `stageProgress.error`.
   */
  describeError(error: unknown, stage: AniBuddyQueuedStage): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { detail?: unknown; message?: unknown } | undefined;
      const detail = data?.detail ?? data?.message;
      if (typeof detail === 'string' && detail.length > 0) {
        return `${stage}: ${detail}`;
      }
      if (error.response) {
        return `${stage}: py_backend answered HTTP ${error.response.status}`;
      }
      return `${stage}: py_backend is unreachable (${error.code ?? error.message})`;
    }
    return error instanceof Error ? error.message : String(error);
  },

  // Internal method — the JSON infra handler at POST /anibuddy/stages/{stage}.
  async _postStub(request: AniBuddyStageRequest): Promise<AniBuddyStageResponse> {
    const path = AniBuddyConstants.pathByTransport.stub.replace(':stage', request.stage);
    // Everything the stub body does not declare is stripped: it is `extra="forbid"`
    // and predates the revision ids, the sheet and the per-stage option objects.
    const {
      sheet: _sheet,
      buffers: _buffers,
      revisionId: _revisionId,
      revisionIndex: _revisionIndex,
      semantics: _semantics,
      rig: _rig,
      render: _render,
      ...body
    } = request;
    const res = await pyClient.post<Omit<AniBuddyStageResponse, 'transport'>>(path, body);
    return { ...res.data, transport: 'stub' };
  },

  // Internal method — the sheet as a multipart part, for the transports that take one.
  _appendSheet(body: FormData, sheet: AniBuddyStageSheet): void {
    body.append('image', new Blob([sheet.buffer], { type: sheet.contentType }), sheet.filename);
  },

  /**
   * Internal method — the JSON envelope, as a FILE part rather than a form field.
   *
   * The filename is what makes the difference, and it is the whole fix for a class
   * of failure that only appeared on large rigs. Starlette's multipart parser
   * measures every non-file part against `max_part_size` (1 MB) and raises
   * `MultiPartException` above it — a 400 before any handler runs, with a message
   * about a "Part" that names neither the field nor the endpoint. A 64-part
   * document carrying inline RLE mask runs and inline vertex arrays passes 1 MB on
   * its own, and it does so even though oversized geometry already travels out of
   * band as `buffers`: `MAX_INLINE_BUFFER_ELEMENTS` is 4096 per buffer, and sixty
   * buffers just under that limit are still sixty buffers inside the JSON.
   *
   * A part with a filename is spooled to a temporary file instead and has no size
   * bound, so this is a one-line change on each side rather than a limit that has
   * to be raised again the next time a document grows.
   */
  _appendEnvelope(body: FormData, payload: unknown): void {
    body.append(
      AniBuddyConstants.envelopeFormField,
      new Blob([JSON.stringify(payload)], { type: AniBuddyConstants.envelopeContentType }),
      AniBuddyConstants.envelopeFilename,
    );
  },

  /**
   * Internal method — the document's external geometry, as multipart file parts.
   *
   * File parts rather than a JSON field on purpose: a non-file multipart part is
   * capped at 1MB by the parser on the other side, and a single weight matrix can
   * exceed that. Each part is named by its own sha256, so Python matches it to the
   * reference in the document by content rather than by position.
   */
  _appendBuffers(body: FormData, buffers: readonly AniBuddyResolvedBuffer[]): void {
    for (const entry of buffers) {
      body.append(
        AniBuddyConstants.bufferFormField,
        new Blob([entry.bytes], { type: 'application/octet-stream' }),
        entry.sha256,
      );
    }
  },

  /**
   * Internal method — the document a stage builds on, or a refusal naming what is
   * missing.
   *
   * `rig` and `render` both operate on an existing revision rather than producing
   * the first one, so a null document is a sequencing mistake and is named as one.
   * Posting an empty body and letting Python answer 422 would surface as "Invalid
   * rig request", which says nothing the user can act on.
   */
  _requireParent(request: AniBuddyStageRequest, needs: string): RigDocument {
    if (request.parentDocument) return request.parentDocument;
    throw new Error(
      `The ${request.stage} stage needs ${needs}, and this project has no rig document yet. ` +
        `Run decompose first.`,
    );
  },

  /**
   * Internal method — the real skeleton and deformer builder at POST /anibuddy/rig.
   *
   * The sheet part is optional here, unlike every other multipart transport: only
   * an `alpha-threshold` mask is resolved against source pixels, so a re-rig of a
   * corrected decomposition sends no image at all and Python refuses by name if it
   * turns out to have needed one.
   */
  async _postRig(request: AniBuddyStageRequest): Promise<AniBuddyStageResponse> {
    const document = this._requireParent(request, 'a decomposed document with parts');

    const body = new FormData();
    this._appendEnvelope(body, {
      document,
      revisionId: request.revisionId,
      semantics: request.semantics,
      deformerOverrides: request.rig?.deformerOverrides ?? {},
      passIndex: request.passIndex,
      usageEventId: request.usageEventId,
    });
    if (request.sheet) this._appendSheet(body, request.sheet);
    this._appendBuffers(body, request.buffers);

    const res = await pyClient.post<RigWireResponse>(
      AniBuddyConstants.pathByTransport['rig-multipart'],
      body,
    );

    return {
      document: res.data.document,
      // The buffers are not an artifact: an artifact is one object recorded on the
      // project, and these are N geometry payloads the document itself references.
      artifact: null,
      buffers: res.data.buffers ?? [],
      message: res.data.message ?? 'rig complete',
      transport: 'rig-multipart',
    };
  },

  /**
   * Internal method — the real rasterizer and encoder at POST /anibuddy/render.
   *
   * The sheet is required rather than optional: every frame resamples the user's
   * own pixels (R2), so there is nothing to draw without them.
   *
   * Absent sizing and sampling fields mean "take it from the clip", which is where
   * F9 §7.7 puts `fps` and `frameCount`. They are sent as explicit nulls so the
   * body is the same shape on every call and a missing key never reads as a
   * serializer accident.
   */
  async _postRender(request: AniBuddyStageRequest): Promise<AniBuddyStageResponse> {
    const document = this._requireParent(request, 'a rigged document');
    if (!request.sheet) {
      throw new Error('The render stage needs the source sheet and none was read.');
    }

    const options = request.render;
    const body = new FormData();
    this._appendEnvelope(body, {
      document,
      projectId: request.projectId,
      revisionId: request.revisionId,
      parentRevisionId: document.id,
      revisionIndex: request.revisionIndex,
      passIndex: request.passIndex,
      usageEventId: request.usageEventId,
      clipId: options?.clipId ?? null,
      format: options?.format ?? AniBuddyConstants.render.defaultFormat,
      fps: options?.fps ?? null,
      frameCount: options?.frameCount ?? null,
      width: options?.width ?? null,
      height: options?.height ?? null,
      maxEdge: options?.maxEdge ?? null,
      background: options?.background ?? AniBuddyConstants.render.defaultBackground,
      loop: options?.loop ?? null,
    });
    this._appendSheet(body, request.sheet);
    this._appendBuffers(body, request.buffers);

    const res = await pyClient.post<RenderWireResponse>(
      AniBuddyConstants.pathByTransport['render-multipart'],
      body,
    );
    const wire = res.data;

    return {
      document: wire.document,
      artifact: {
        kind: wire.artifact.kind,
        suggestedStorageKey: wire.artifact.suggestedStorageKey,
        contentHash: wire.artifact.contentHash,
        contentBase64: wire.artifact.contentBase64,
        mimeType: wire.artifact.mimeType,
        byteLength: wire.artifact.byteLength,
        cacheKey: wire.artifact.cacheKey ?? wire.cacheKey,
        downloadPath: wire.artifact.downloadPath,
      },
      message: this._renderMessage(wire),
      transport: 'render-multipart',
    };
  },

  /**
   * Internal method — the render's progress line, including a format substitution.
   *
   * `requestedFormat` and `servedFormat` differ exactly when the ffmpeg fallback
   * fired (F9 §8.5). Python's own message names the size, the rate and the byte
   * count; what it does not say is that the user asked for something else, and a
   * caller who requested MP4 and received a zip has to be told before they label
   * it `video/mp4`.
   */
  _renderMessage(wire: RenderWireResponse): string {
    const base = wire.message ?? 'render complete';
    if (wire.servedFormat === wire.requestedFormat) return base;
    return `${base} — ${wire.requestedFormat} was unavailable, so ${wire.servedFormat} was served instead`;
  },

  /**
   * How an artifact's bytes are meant to reach storage.
   *
   * Python decides, by payload size, and says so in the shape of the hint rather
   * than in a flag: `contentBase64` for anything under
   * `ARTIFACT_INLINE_MAX_BYTES`, a `cacheKey` to stream above it, and neither for
   * a stub whose artifact is the key itself. Reading that decision in one named
   * place keeps the caller from inferring it from two possibly-null fields.
   */
  artifactDelivery(
    hint: NonNullable<AniBuddyStageResponse['artifact']>,
  ): 'inline' | 'stream' | 'key-only' {
    if (hint.contentBase64) return 'inline';
    return hint.cacheKey ? 'stream' : 'key-only';
  },

  /** The internal path a cached artifact streams from, built from the one table. */
  artifactPathFor(cacheKey: string): string {
    return AniBuddyConstants.render.artifactPath.replace(
      ':cacheKey',
      encodeURIComponent(cacheKey),
    );
  },

  /**
   * Open a render artifact as a stream, for a payload too large to inline.
   *
   * Served from py_backend's worker-local render cache, so a 404 means the entry
   * was evicted rather than that the render failed — and re-requesting it is cheap
   * precisely because the cache key is a content hash.
   *
   * The path is built from the constants table rather than from the response's
   * `downloadPath`, so this module stays the only place a py_backend route is
   * written down. `downloadPath`'s presence is the signal; its value is not
   * followed.
   */
  async openArtifactStream(cacheKey: string): Promise<AniBuddyArtifactStream> {
    const res = await pyClient.get<Readable>(this.artifactPathFor(cacheKey), {
      responseType: 'stream',
    });
    const declared = Number(res.headers['content-length']);
    const contentType = res.headers['content-type'];
    return {
      stream: res.data,
      contentType: typeof contentType === 'string' ? contentType : null,
      byteLength: Number.isFinite(declared) ? declared : null,
    };
  },

  // Internal method — the real classical-CV decompose at POST /anibuddy/decompose.
  async _postDecompose(request: AniBuddyStageRequest): Promise<AniBuddyStageResponse> {
    if (!request.sheet) {
      throw new Error('The decompose stage needs the source sheet and none was read.');
    }

    // DecomposeRequest is `extra="forbid"` and takes an AssetRef, which has no
    // `sourceUrl` — that field is Node's own record of where the bytes live and
    // is not part of the document contract (F9 §7.3).
    const { sourceUrl: _sourceUrl, ...asset } = request.asset;
    const body = new FormData();
    this._appendEnvelope(body, {
      asset,
      projectId: request.projectId,
      revisionId: request.revisionId,
      parentRevisionId: request.parentDocument?.id ?? null,
      revisionIndex: request.revisionIndex,
      // The archetype is the user's choice at project creation, not something
      // decompose can measure, so it is carried in rather than defaulted on the
      // Python side and patched back on afterwards.
      archetype: request.archetype,
    });
    this._appendSheet(body, request.sheet);

    const res = await pyClient.post<DecomposeWireResponse>(
      AniBuddyConstants.pathByTransport['decompose-multipart'],
      body,
    );

    // Decompose writes its own StageRecord, so the progress message comes from
    // the document rather than from a separate field the endpoint does not have.
    const stages = res.data.document.provenance.stages;
    const last = stages.length > 0 ? stages[stages.length - 1] : undefined;
    return {
      document: res.data.document,
      artifact: null,
      message: last?.message ?? 'decompose complete',
      transport: 'decompose-multipart',
    };
  },

  /**
   * Run one stage against py_backend, over whichever transport the table assigns.
   *
   * A stage routed to a transport this gateway cannot drive fails by name. That is
   * deliberately louder than posting a body Python would reject: the table is the
   * switch, and a half-flipped switch should say so.
   *
   * A stage whose transport belongs to the Next vision service never reaches here
   * — the worker asks `serviceByTransport` first — and the default arm says so
   * rather than falling through to a py path that does not exist.
   */
  async runStage(request: AniBuddyStageRequest): Promise<AniBuddyStageResponse> {
    // Widened deliberately. No stage is routed to `stub` today, so the table's own
    // value type no longer includes it — and narrowing to that would make the stub's
    // arm unreachable and delete the handler the transport enum still declares. The
    // enum is the contract; the current table's values are one configuration of it,
    // and `stub` is what a stage is routed back to while an endpoint is reworked.
    const transport = AniBuddyConstants.transportByStage[
      request.stage
    ] as AniBuddyStageTransport;
    switch (transport) {
      case 'stub':
        return this._postStub(request);
      case 'decompose-multipart':
        return this._postDecompose(request);
      case 'rig-multipart':
        return this._postRig(request);
      case 'render-multipart':
        return this._postRender(request);
      default:
        throw new Error(
          `AniBuddy stage '${request.stage}' is routed to transport '${transport}', which is ` +
            `served by '${AniBuddyConstants.serviceByTransport[transport]}' rather than by ` +
            `py_backend. This client only drives py_backend transports.`,
        );
    }
  },

  // ───────────────────────── vision-facing image work ─────────────────────────
  //
  // py_backend's half of the semantics step and of the critique loop. Every one of
  // these carries pixels or ids in and a validated document out; none of them
  // calls a model. See `anibuddy.vision.client.ts` for the half that does.

  /**
   * Numbered part outlines drawn over the user's own sheet, for the semantics call.
   *
   * The image is built here rather than in Node because drawing outlines on a
   * raster is image work and Python is where the pixels are. The returned `legend`
   * is the reply protocol: the model answers with a `partId`, and any id absent
   * from the legend rejects the whole proposal.
   */
  async annotate(input: {
    document: RigDocument;
    sheet: AniBuddyStageSheet;
    maxEdge?: number | null;
  }): Promise<AniBuddyAnnotateResult> {
    const body = new FormData();
    this._appendEnvelope(body, {
      document: input.document,
      maxEdge: input.maxEdge ?? null,
    });
    this._appendSheet(body, input.sheet);

    const res = await pyClient.post<AniBuddyAnnotateResult>(
      AniBuddyConstants.pyVisionPaths.annotate,
      body,
    );
    return res.data;
  },

  /**
   * A grid of really-rendered frames, plus the render revision that produced it.
   *
   * This is what makes the loop closed rather than reflective (F9 §11.1): the model
   * looks at frames the renderer drew from the user's own pixels. The returned
   * `document` is the render stage's child revision and the caller must keep it
   * rather than the one it sent — its `diagnostics` were measured on exactly these
   * frames, which is what makes "best revision" a measurement.
   *
   * The buffer sidecar applies here for the same reason it applies to a render:
   * a mesh rig's weight matrices left as `StorageAdapter` keys, and Python holds no
   * credentials to fetch one with, so Node brings the bytes.
   */
  async contactSheet(input: {
    document: RigDocument;
    sheet: AniBuddyStageSheet;
    buffers: readonly AniBuddyResolvedBuffer[];
    projectId: string;
    revisionId: string;
    parentRevisionId: string | null;
    revisionIndex: number;
    passIndex: number;
    usageEventId: string | null;
    clipId: string | null;
    frames?: number;
  }): Promise<AniBuddyContactSheetResult> {
    const body = new FormData();
    this._appendEnvelope(body, {
      document: input.document,
      projectId: input.projectId,
      revisionId: input.revisionId,
      parentRevisionId: input.parentRevisionId,
      revisionIndex: input.revisionIndex,
      passIndex: input.passIndex,
      usageEventId: input.usageEventId,
      clipId: input.clipId,
      frames: input.frames ?? AniBuddyConstants.critique.contactSheetFrames,
      tileMaxEdge: null,
    });
    this._appendSheet(body, input.sheet);
    this._appendBuffers(body, input.buffers);

    const res = await pyClient.post<AniBuddyContactSheetResult>(
      AniBuddyConstants.pyVisionPaths.contactSheet,
      body,
      { timeout: AniBuddyConstants.critique.pipelineTimeoutMs },
    );
    return res.data;
  },

  /**
   * Revalidate a critique report against the live document and apply it.
   *
   * JSON rather than multipart, and deliberately so: applying a correction is
   * parameter arithmetic over ids the document already carries, and none of it
   * reads a pixel. A stage that needs no sheet should not ask for one — which is
   * also why the 1 MB form-field cap never applied to this call.
   */
  async applyCritique(input: {
    document: RigDocument;
    report: CritiqueReport;
    revisionId: string;
    projectId: string | null;
    parentRevisionId: string | null;
    revisionIndex: number | null;
    passIndex: number;
    modelId: string | null;
    usageEventId: string | null;
    creditsSpent: number;
  }): Promise<AniBuddyApplyCritiqueResult> {
    const res = await pyClient.post<AniBuddyApplyCritiqueResult>(
      AniBuddyConstants.pyVisionPaths.applyCritique,
      {
        document: input.document,
        report: input.report,
        revisionId: input.revisionId,
        projectId: input.projectId,
        parentRevisionId: input.parentRevisionId,
        revisionIndex: input.revisionIndex,
        passIndex: input.passIndex,
        modelId: input.modelId,
        usageEventId: input.usageEventId,
        creditsSpent: input.creditsSpent,
      },
      { timeout: AniBuddyConstants.critique.pipelineTimeoutMs },
    );
    return res.data;
  },

  /**
   * Classify a py_backend failure the way the critique loop's refund table needs.
   *
   * A 422 is a statement about the request the user can act on — a blocked
   * document, an unknown id, a number out of range — so its `detail` is surfaced
   * verbatim under `PIPELINE_REFUSED`. Anything else is infrastructure and gets
   * `PIPELINE_UNAVAILABLE`. The loop branches on the code, never on the sentence.
   */
  classifyError(error: unknown, fallback: string): {
    code: AniBuddyCritiqueErrorCode;
    error: string;
  } {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { detail?: unknown } | undefined;
      const detail = typeof data?.detail === 'string' ? data.detail : '';
      if (error.response?.status === 422) {
        return {
          code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_REFUSED,
          error: detail || fallback,
        };
      }
      return {
        code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_UNAVAILABLE,
        error: detail || `The geometry service answered HTTP ${error.response?.status ?? 0}.`,
      };
    }
    return {
      code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_UNAVAILABLE,
      error: error instanceof Error ? error.message : String(error),
    };
  },

  /** SHA-256 hex of canonical stage input — used for idempotency keys. */
  hashStageInput(payload: unknown): string {
    const canonical = JSON.stringify(payload);
    return createHash('sha256').update(canonical).digest('hex');
  },
};
