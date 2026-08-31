// Central AniBuddy gateway constants (Rule 9). Queue names, stage names, and
// version strings live here so workers, routes, and billing never re-declare
// literals that can drift.

import { ANIBUDDY_LIMITS } from './dto/rig-document.generated';
import type { StageName } from './dto/rig-document.generated';
import type { UsageOp } from '../usage/usage.constants';

/** BullMQ queue names Python never sees — Node owns enqueue + worker lifecycle. */
export const ANIBUDDY_QUEUE_NAMES = [
  'anibuddy-decompose',
  'anibuddy-rig',
  'anibuddy-animate',
  'anibuddy-render',
  'anibuddy-critique',
] as const;

export type AniBuddyQueueName = (typeof ANIBUDDY_QUEUE_NAMES)[number];

/**
 * Stages that have their own BullMQ queue and run through `processStageJob`.
 *
 * `semantics` rides inside `rig` (F9 §8.2). `critique` has a queue of its own but
 * is deliberately NOT here: a critique job is a bounded LOOP over render and
 * vision passes with its own billing, its own three stop conditions and its own
 * best-revision selection, not one call to one endpoint. Modelling it as a fifth
 * queued stage would mean `processStageJob` growing a second control flow that
 * only one stage takes.
 */
export const ANIBUDDY_QUEUED_STAGES = ['decompose', 'rig', 'animate', 'render'] as const;
export type AniBuddyQueuedStage = (typeof ANIBUDDY_QUEUED_STAGES)[number];

/**
 * How a stage reaches the service that does its work.
 *
 * `stub` is the JSON infra handler every stage started on. The three
 * `*-multipart` transports are the real py_backend endpoints, and they are
 * multipart because each one resamples the user's own pixels: the sheet rides as
 * bytes rather than as base64 inside a JSON body, which would inflate it by a
 * third for no gain.
 *
 * `motion-vision` is the odd one out, and naming it as its own transport kind is
 * the point. The `animate` stage's work is a VISION CALL, not geometry: it turns
 * the built rig's real ids plus a sentence of user intent into bounded keyframes.
 * There is nothing for py_backend to do — no pixel is resampled and no deformer
 * is rebuilt — so giving it a py multipart path would mean inventing an endpoint
 * that forwards a request it cannot answer. The call goes to the one provider
 * chain instead (see `serviceByTransport`), and Node authors the clip.
 */
export const ANIBUDDY_STAGE_TRANSPORTS = [
  'stub',
  'decompose-multipart',
  'rig-multipart',
  'render-multipart',
  'motion-vision',
] as const;
export type AniBuddyStageTransport = (typeof ANIBUDDY_STAGE_TRANSPORTS)[number];

/**
 * Which service a transport's path belongs to.
 *
 * Two, and the split is the whole reason `pathByTransport` is no longer called
 * `pyPathByTransport`: py_backend owns pixels and geometry, and the Next app owns
 * the single provider-fallback chain (`callLlm`, the Open Quota routing profile).
 * A stage whose work is a model call must reach that one chain rather than a
 * second copy of it, and a table that could only express py paths would force the
 * copy.
 */
export const ANIBUDDY_TRANSPORT_SERVICES = ['py-backend', 'next-vision'] as const;
export type AniBuddyTransportService = (typeof ANIBUDDY_TRANSPORT_SERVICES)[number];

/**
 * What a usage event should record in `modelId` for a transport, before the
 * served model is known.
 *
 * Three kinds because three different things run: nothing (`stub`), NumPy and
 * OpenCV geometry (`local-geometry`), and a real vision model (`vision`). Only
 * the last has a served model to reconcile afterwards, which is exactly the
 * condition the worker branches on.
 */
export const ANIBUDDY_TRANSPORT_MODEL_KINDS = ['stub', 'local-geometry', 'vision'] as const;
export type AniBuddyTransportModelKind = (typeof ANIBUDDY_TRANSPORT_MODEL_KINDS)[number];

/**
 * Whether a transport needs the source sheet's bytes, and when.
 *
 * Three values rather than a boolean because `rig` is genuinely conditional:
 * `rect`, `polygon` and `rle` masks are self-describing, so a re-rig of a
 * corrected decomposition needs no pixels at all, while an `alpha-threshold`
 * mask is resolved against them. Reading the sheet unconditionally would charge
 * every re-rig a full download of a 20MB sheet to hand Python an upload it
 * ignores.
 */
export const ANIBUDDY_SHEET_POLICIES = ['none', 'required', 'alpha-masks-only'] as const;
export type AniBuddySheetPolicy = (typeof ANIBUDDY_SHEET_POLICIES)[number];

/**
 * Body limit for a clip write, and the mount path it applies to.
 *
 * A `Clip` may legitimately carry 32 keyframes across 96 joints and 64 parts,
 * which does not fit the 100kb bound `app.ts` puts on the rest of the API. The
 * wider parser is mounted on this path *ahead* of the global one, because
 * `express.json` skips a request whose body another parser already read — a
 * route-level parser inside the router would never be reached, the global one
 * having already answered 413.
 */
export const ANIBUDDY_CLIP_BODY_LIMIT = '512kb';
export const ANIBUDDY_CLIP_BODY_MOUNT = '/api/anibuddy/projects/:id/clips';

/**
 * Body limit for the internal annotate route, and the mount path it applies to.
 *
 * Derived from the sheet ceiling rather than picked: the request carries a whole
 * source sheet as base64, which inflates it by 4/3, plus the RigDocument the
 * outlines are traced from. A literal here would be a number nobody could check
 * against the upload limit it has to exceed.
 *
 * Mounted ahead of the global parser for the same reason the clip mount is —
 * `express.json` skips a request another parser already read, so a route-level
 * parser would never be reached: the global one would have answered 413 first.
 */
export const ANIBUDDY_ANNOTATE_BODY_LIMIT = `${
  Math.ceil((20 * 1024 * 1024 * 4) / 3 / (1024 * 1024)) + 8
}mb`;
export const ANIBUDDY_ANNOTATE_BODY_MOUNT = '/api/anibuddy/internal/annotate';

/**
 * Failure codes the critique loop classifies on.
 *
 * A mirror of `PROPOSAL_ERROR_CODES` in the Next AI layer, and it has to stay a
 * mirror: the loop's refund table branches on the code the vision call reports, so
 * a code that only one side knows would refund the wrong pass. The values are the
 * contract between the two processes — the names are local.
 *
 * Only the codes the loop can produce or receive are here. The route-level ones
 * (`ANIBUDDY_BAD_REQUEST` and friends) belong to whichever handler answers a
 * browser and never reach a queued job.
 */
export const ANIBUDDY_CRITIQUE_ERROR_CODES = Object.freeze({
  /** Provider chain exhausted: no usable response at all. Retryable. */
  PROVIDER_FAILED: 'ANIBUDDY_PROVIDER_FAILED',
  /** A response arrived and failed revalidation twice. Refund, fall back. */
  CRITIQUE_INVALID: 'ANIBUDDY_CRITIQUE_INVALID',
  MOTION_INVALID: 'ANIBUDDY_MOTION_INVALID',
  /** py_backend refused the image work or the corrections, by name. */
  PIPELINE_REFUSED: 'ANIBUDDY_PIPELINE_REFUSED',
  /** py_backend, or the Next vision route, was unreachable. */
  PIPELINE_UNAVAILABLE: 'ANIBUDDY_PIPELINE_UNAVAILABLE',
  /** `AssetRef.remoteVisionConsented` is false (F9 §7.3). */
  CONSENT_REQUIRED: 'ANIBUDDY_VISION_CONSENT_REQUIRED',
} as const);

export type AniBuddyCritiqueErrorCode =
  (typeof ANIBUDDY_CRITIQUE_ERROR_CODES)[keyof typeof ANIBUDDY_CRITIQUE_ERROR_CODES];

export type AniBuddyProjectStatus =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

export type AniBuddyStageProgressStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export const AniBuddyConstants = Object.freeze({
  schemaVersion: ANIBUDDY_LIMITS.SCHEMA_VERSION,
  queueNames: ANIBUDDY_QUEUE_NAMES,
  queuedStages: ANIBUDDY_QUEUED_STAGES,
  errorCodes: ANIBUDDY_CRITIQUE_ERROR_CODES,

  projectStatuses: Object.freeze([
    'draft',
    'queued',
    'processing',
    'ready',
    'failed',
  ] as const satisfies readonly AniBuddyProjectStatus[]),

  stageProgressStatuses: Object.freeze([
    'idle',
    'queued',
    'running',
    'succeeded',
    'failed',
  ] as const satisfies readonly AniBuddyStageProgressStatus[]),

  /** Default name when the client omits one. */
  defaultProjectName: 'Untitled AniBuddy project',

  /**
   * What a usage event records in `modelId` when no model ran.
   *
   * R13 asks every event to name the model that was actually served. Three of the
   * four queued stages serve none — they are OpenCV and NumPy geometry — so they
   * name that rather than borrowing the stub's id, which would attribute a real
   * decompose to a handler that did not run it. The vision stages thread the
   * provider's served-model tag back through `reconcile`, which is where a real
   * model id comes from.
   */
  stubModelId: 'anibuddy-stub',
  localGeometryModelId: 'anibuddy-local-geometry',

  /** Job names passed to BullMQ `queue.add(name, data)`. */
  jobNames: Object.freeze({
    decompose: 'anibuddy-decompose',
    rig: 'anibuddy-rig',
    animate: 'anibuddy-animate',
    render: 'anibuddy-render',
  } as const satisfies Record<AniBuddyQueuedStage, AniBuddyQueueName>),

  /** Map queued stage → BullMQ queue name. */
  queueByStage: Object.freeze({
    decompose: 'anibuddy-decompose',
    rig: 'anibuddy-rig',
    animate: 'anibuddy-animate',
    render: 'anibuddy-render',
  } as const satisfies Record<AniBuddyQueuedStage, AniBuddyQueueName>),

  /** Map queued stage → registered usage op for pre-auth. */
  usageOpByStage: Object.freeze({
    decompose: 'anibuddy-decompose',
    rig: 'anibuddy-rig',
    animate: 'anibuddy-animate',
    render: 'anibuddy-render',
  } as const satisfies Record<AniBuddyQueuedStage, UsageOp>),

  /**
   * The stage routing table.
   *
   * This is the single switch from a stubbed stage to a real one: change a
   * stage's transport here and the worker follows, because the worker asks this
   * table rather than naming an endpoint. Nothing else in the pipeline knows a
   * py_backend path.
   */
  transportByStage: Object.freeze({
    decompose: 'decompose-multipart',
    rig: 'rig-multipart',
    animate: 'motion-vision',
    render: 'render-multipart',
  } as const satisfies Record<AniBuddyQueuedStage, AniBuddyStageTransport>),

  /**
   * Path each transport posts to. `:stage` is substituted for the stub.
   *
   * The paths are relative to the transport's own service (`serviceByTransport`),
   * so this stays the only place in the gateway where a remote route is written
   * down — for both services, not just for py_backend.
   */
  pathByTransport: Object.freeze({
    stub: '/anibuddy/stages/:stage',
    'decompose-multipart': '/anibuddy/decompose',
    'rig-multipart': '/anibuddy/rig',
    'render-multipart': '/anibuddy/render',
    'motion-vision': '/api/enhance/anibuddy/motion',
  } as const satisfies Record<AniBuddyStageTransport, string>),

  /** Which service each transport's path lives on. */
  serviceByTransport: Object.freeze({
    stub: 'py-backend',
    'decompose-multipart': 'py-backend',
    'rig-multipart': 'py-backend',
    'render-multipart': 'py-backend',
    'motion-vision': 'next-vision',
  } as const satisfies Record<AniBuddyStageTransport, AniBuddyTransportService>),

  /**
   * What `UsageEvent.modelId` records for a transport at pre-authorization time.
   *
   * R13 asks every event to name the model that actually served it. Three of the
   * five transports serve none — they are OpenCV and NumPy geometry, or the stub —
   * so they name that rather than borrowing an id from a handler that did not run.
   * A `vision` transport records the configured model and is then corrected by
   * `UsageService.reconcile` once the chain reports what it really served.
   */
  modelKindByTransport: Object.freeze({
    stub: 'stub',
    'decompose-multipart': 'local-geometry',
    'rig-multipart': 'local-geometry',
    'render-multipart': 'local-geometry',
    'motion-vision': 'vision',
  } as const satisfies Record<AniBuddyStageTransport, AniBuddyTransportModelKind>),

  /**
   * Whether each transport needs the source sheet's bytes read back out of
   * storage before the call. Node owns the StorageAdapter (F9 §5), so this is
   * the gateway's question to answer, not Python's.
   *
   * `render` is `required` — every frame resamples the user's own pixels, so
   * there is nothing to draw without them. `rig` is conditional on the masks the
   * document actually carries; see `ANIBUDDY_SHEET_POLICIES`.
   */
  sheetPolicyByTransport: Object.freeze({
    stub: 'none',
    'decompose-multipart': 'required',
    'rig-multipart': 'alpha-masks-only',
    'render-multipart': 'required',
    // The motion call reasons about the artwork it is animating, so it needs the
    // sheet — as a data URL rather than as multipart bytes, because a provider's
    // `image_url` part is the only shape a model can be shown an image in.
    'motion-vision': 'required',
  } as const satisfies Record<AniBuddyStageTransport, AniBuddySheetPolicy>),

  /**
   * Which transports have to be able to READ the document's geometry.
   *
   * The other half of the storage handoff. An oversized `NumericBuffer` leaves as
   * a `StorageAdapter` key (F9 §7.6), and py_backend holds no credentials to fetch
   * one with — so a stage that evaluates that geometry needs Node to send the bytes
   * back alongside the document. `decompose` authors the first revision and reads
   * no geometry at all; the stub reads nothing.
   */
  transportReadsGeometry: Object.freeze({
    stub: false,
    'decompose-multipart': false,
    'rig-multipart': true,
    'render-multipart': true,
    // A motion proposal names ids and bounded channels. It cannot read geometry
    // and there is no field on its response schema through which geometry could
    // come back (R3), so reading a weight matrix for it would be pure cost.
    'motion-vision': false,
  } as const satisfies Record<AniBuddyStageTransport, boolean>),

  /** Multipart field each resolved buffer is appended under. */
  bufferFormField: 'buffers' as const,

  /**
   * The multipart field the JSON envelope rides in, and the filename it carries.
   *
   * The filename is what makes this a FILE part rather than a form field, and that
   * distinction is load-bearing rather than cosmetic: Starlette's multipart parser
   * caps a non-file part at `max_part_size` (1 MB) and raises `MultiPartException`
   * above it, while a part with a filename is spooled to a temporary file with no
   * such bound. A 64-part rig document with inline RLE masks and inline vertex
   * arrays exceeds 1 MB on its own — even with oversized geometry already sent out
   * of band as `buffers` — so the envelope has to be a file part or the request is
   * refused before any handler sees it.
   */
  envelopeFormField: 'request' as const,
  envelopeFilename: 'request.json' as const,
  envelopeContentType: 'application/json' as const,

  /**
   * How many buffer objects are read back at once.
   *
   * A 64-part mesh rig references a few hundred of them. Sequentially that is a
   * few hundred round trips before a frame is drawn; all at once it is a few
   * hundred simultaneous requests at one provider, per in-flight job. Neither is
   * the right answer, so the reads run in bounded batches.
   */
  bufferFetchConcurrency: 8,

  /**
   * The one mask kind that cannot be resolved without the source pixels.
   *
   * Named here rather than tested for inline because it is the whole content of
   * the `alpha-masks-only` policy above, and the two must not be able to drift.
   */
  maskKindNeedingSheet: 'alpha-threshold' as const,

  /**
   * Transports this gateway can actually drive today.
   *
   * All five are live. The list stays, and the test that asserts every routed
   * stage appears in it stays with it: it is what makes flipping a stage onto a
   * new endpoint a deliberate act rather than a one-word edit that fails at
   * runtime with an axios message.
   */
  implementedTransports: Object.freeze([
    'stub',
    'decompose-multipart',
    'rig-multipart',
    'render-multipart',
    'motion-vision',
  ] as const satisfies readonly AniBuddyStageTransport[]),

  /** Artifact kinds written under the StorageAdapter. */
  artifactKinds: Object.freeze({
    stageResult: 'stage-result',
    rigDocument: 'rig-document',
    render: 'render',
    /** One oversized `NumericBuffer`, content-addressed on its own sha256. */
    rigBuffer: 'rig-buffer',
  } as const),

  storageFolder: 'anibuddy' as const,

  /** Gateway route paths, so no handler or test re-types one (Rule 9). */
  routes: Object.freeze({
    projects: '/anibuddy/projects',
    project: '/anibuddy/projects/:id',
    enqueue: '/anibuddy/projects/:id/enqueue',
    assets: '/anibuddy/assets',
    clips: '/anibuddy/projects/:id/clips',
    clip: '/anibuddy/projects/:id/clips/:clipId',
    critique: '/anibuddy/projects/:id/critique',
    /**
     * The one route the Next app calls INTO this gateway on.
     *
     * It exists so the browser-adjacent app never holds `INTERNAL_API_TOKEN`.
     * The `semantics` vision call has to happen in Next (one provider chain) and
     * needs the numbered-outline sheet py_backend draws — so Next asks the
     * gateway for the image, and the gateway is the only process that talks to
     * py_backend. Guarded by `INTERNAL_SERVICE_TOKEN`, the same secret and the
     * same `x-service-token` header the refund and reconcile routes use.
     */
    internalAnnotate: '/anibuddy/internal/annotate',
  } as const),

  /**
   * py_backend's vision-facing paths.
   *
   * Separate from `pathByTransport` because none of these is a queued stage's
   * transport: two of them are steps INSIDE the critique loop, which runs many of
   * them per job, and the third serves a Next route rather than a BullMQ job.
   * Folding them into the transport table would make a transport enum member that
   * no stage can ever be routed to.
   */
  pyVisionPaths: Object.freeze({
    annotate: '/anibuddy/semantics/annotate',
    contactSheet: '/anibuddy/critique/contact-sheet',
    applyCritique: '/anibuddy/critique/apply',
  } as const),

  /** The Next app's internal vision paths, reached with `x-service-token`. */
  nextVisionPaths: Object.freeze({
    critique: '/api/enhance/anibuddy/critique',
    motion: '/api/enhance/anibuddy/motion',
  } as const),

  /**
   * The closed critique loop's queue, caps and budgets (F9 §11).
   *
   * Every cap that also exists in the generated schema is re-exported from
   * `ANIBUDDY_LIMITS` rather than restated (R10): a second declaration of
   * MAX_CRITIQUE_PASSES would disagree with the first exactly once, and the
   * disagreement would be a billing incident.
   */
  critique: Object.freeze({
    queueName: 'anibuddy-critique',
    jobName: 'anibuddy-critique',
    /** The `StageName` a critique job reports progress under. */
    stage: 'critique' as const,
    // `satisfies` rather than `as`: it proves both ops are registered in the landed
    // billing contract while keeping the literal type, so the loop needs no cast to
    // narrow them back and cannot be handed an op the usage service would refuse.
    usageOp: 'anibuddy-critique' satisfies UsageOp,
    /** The render half of a pass bills under the render op, per frame. */
    renderUsageOp: 'anibuddy-render' satisfies UsageOp,

    /** Pass 0 is the unreviewed rig; 1..3 are critique iterations. */
    maxPasses: ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES,
    /**
     * Hard credit stop per loop, checked BEFORE a pass is enqueued. Independent
     * of the pass cap because a pass on a 64-part sheet costs more than a pass on
     * a 3-part one, and only the ceiling bounds the worst case (F9 §11.5).
     */
    creditCeiling: ANIBUDDY_LIMITS.CRITIQUE_CREDIT_CEILING,
    /** Frames tiled into the one image the model sees, and the render's units. */
    contactSheetFrames: ANIBUDDY_LIMITS.CRITIQUE_CONTACT_SHEET_FRAMES,
    /** One contact-sheet vision call per pass, per the landed cost table. */
    unitsPerPass: 1,

    /**
     * Wall clock for the whole loop.
     *
     * Kept at the value the Next route ran under even though a BullMQ job has no
     * request to time out. It is not a transport limit: it is the promise that a
     * user watching `stageProgress` gets a defined ending rather than an
     * indefinite spinner, and three passes of render-plus-vision is what fits.
     */
    budgetMs: 100_000,
    /**
     * Below this much remaining budget a new pass is not started. A pass is a
     * render plus a vision call; starting one with less leaves it to time out
     * after spending the render.
     */
    minPassBudgetMs: 25_000,

    /** Wall clock for one call to py_backend from inside the loop. */
    pipelineTimeoutMs: 60_000,
  } as const),

  /**
   * The `animate` stage's request surface and clip defaults.
   *
   * `defaultFps` matches `RenderConstants.DEFAULT_FPS` on py_backend so a proposed
   * motion and a render of it agree on its length. 12fps is the traditional cel
   * rate and reads as deliberate on cutout artwork.
   */
  animate: Object.freeze({
    maxRequestLength: 500,
    defaultFps: 12,
    defaultFrameCount: 24,
    defaultClipId: 'auto',
    /**
     * Server-stamped provenance, for the same reason a clip write is stamped
     * `edited`: this clip's keyframes came from a model, and the client does not
     * get to claim otherwise.
     */
    clipSource: 'model' as const,
    revisionReason: 'animate',
  } as const),

  /** Source-sheet upload limits and the storage layout they write into. */
  asset: Object.freeze({
    /** Multipart field the upload route reads the sheet from. */
    formField: 'sheet',
    /** Matches the existing upload module's multer ceiling. */
    maxBytes: 20 * 1024 * 1024,
    /**
     * Below this a sheet cannot carry a decomposable figure, and the decompose
     * cascade's morphology kernels stop meaning anything.
     */
    minEdge: 64,
    maxEdge: ANIBUDDY_LIMITS.MAX_SOURCE_EDGE,
    mimeTypes: Object.freeze(['image/png', 'image/webp', 'image/jpeg'] as const),
    /**
     * Objects are named by their own content hash under this prefix, so
     * re-uploading the same sheet is idempotent and lands on the same key —
     * which is the property every stage's `inputHash` is built on (F9 §7.3).
     * Deliberately not namespaced per user: two accounts holding the same bytes
     * share one object and one render cache entry, and the project row, not the
     * key, is the authorization boundary.
     */
    keyPrefix: 'sheets',
    idPrefix: 'asset_',
    /** Characters of the content hash that name the AssetRef id (max 64). */
    idHashChars: 24,
  } as const),

  /**
   * The render stage's request surface, and the one GET that completes it.
   *
   * `formats` and `backgrounds` mirror `RenderConstants` on py_backend, which
   * refuses an unknown value by name. They are restated here so the enqueue DTO
   * can refuse it a request earlier — before a credit is spent on a job whose
   * only possible outcome is a 422.
   */
  render: Object.freeze({
    formats: Object.freeze(['png-zip', 'gif', 'webm', 'mp4'] as const),
    /** The only encoder with no external dependency, hence the floor (F9 §8.5). */
    defaultFormat: 'png-zip' as const,
    backgrounds: Object.freeze(['transparent', 'white', 'dark', 'black'] as const),
    defaultBackground: 'transparent' as const,
    /**
     * Where an oversized artifact is streamed from.
     *
     * Built from the response's `cacheKey` rather than from the `downloadPath`
     * Python hands back, so this table stays the only place a py_backend path is
     * written down. The response field is read as a *signal* that the payload was
     * too large to inline, not as a route to follow.
     */
    artifactPath: '/anibuddy/render/artifacts/:cacheKey',
  } as const),

  /** Clip persistence rules the gateway enforces on top of the zod DTO. */
  clip: Object.freeze({
    /**
     * Server-stamped provenance. A clip that arrives through this route was
     * authored by a human in the editor, so the client does not get to claim
     * `model` or `critique` — those name work the pipeline really did.
     */
    source: 'edited',
    maxClips: ANIBUDDY_LIMITS.MAX_CLIPS,
    maxKeyframes: ANIBUDDY_LIMITS.MAX_KEYFRAMES,
    /** Revision reasons written onto the child revision a clip write creates. */
    revisionReasons: Object.freeze({
      create: 'clip-create',
      update: 'clip-update',
      delete: 'clip-delete',
    } as const),
  } as const),

  /** All StageName values from the schema (for progress records). */
  allStages: Object.freeze([
    'decompose',
    'semantics',
    'rig',
    'animate',
    'render',
    'critique',
  ] as const satisfies readonly StageName[]),
});
