// Editor-local types.
//
// None of these cross the wire. The wire contract is RigDocument v5 (generated
// from the JSON Schema) and the math contract is the kernel's own input structs;
// what is declared here is the state an interactive editor needs in between --
// what is selected, which frame is showing, which parts could not be previewed
// faithfully, and how sheet pixels map onto the canvas.

import type {
  Clip,
  DeformerKind,
  Ease,
  Keyframe,
  Part,
  PartPose,
  RigDocument,
} from "@/features/anibuddy/rig/index.rig";
import type { KernelRig, Pose } from "@/features/anibuddy/kernel/index.kernel";

/** What the inspector is pointed at. */
export type EditorSelection =
  | { kind: "none" }
  | { kind: "part"; id: string }
  | { kind: "joint"; id: string };

/**
 * Direct-manipulation mode.
 *
 * `pose` drags joints (IK where the joint allows it, otherwise a one-link FK
 * rotation); `layout` drags whole parts by their PartPose translation. They are
 * separate tools rather than modifier keys because a joint handle sitting on top
 * of a part is otherwise ambiguous on a touch device.
 */
export type EditorTool = "pose" | "layout";

/** Sheet pixels to CSS pixels. Uniform scale, letterboxed, no rotation. */
export interface ViewportTransform {
  /** CSS pixels per source pixel. */
  scale: number;
  /** CSS-pixel offset of the sheet's top-left inside the canvas. */
  offsetX: number;
  offsetY: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

/**
 * A part the preview could not evaluate exactly as authored.
 *
 * Surfaced rather than swallowed: a silently downgraded part previews as a stiff
 * rectangle, and without this the user reads that as the rig being wrong instead
 * of the preview being incomplete. `rigid` is the safe downgrade target for the
 * same reason the pipeline uses it (F9 §9).
 *
 * `from === to` is a legitimate entry, and means the preview evaluates that
 * deformer through a different parameterization than the server does rather than
 * substituting a different one.
 */
export interface PreviewDowngrade {
  partId: string;
  from: DeformerKind;
  to: DeformerKind;
  reason: string;
}

/** Kernel input plus everything the renderer and hit-tester need beside it. */
export interface PreviewRig {
  kernelRig: KernelRig;
  /** Document parts by id, in document order. */
  partsById: ReadonlyMap<string, Part>;
  /** Draw order, low first, resolved from `Part.zIndex` at rest. */
  drawOrder: readonly string[];
  downgrades: readonly PreviewDowngrade[];
  /** True when a synthetic root was added because the skeleton was empty. */
  syntheticRoot: boolean;
}

/**
 * Every PartPose channel resolved to a concrete value at one instant.
 *
 * The interpolating channels are blended against their rest value; the stepping
 * channels (`visible`, `zIndex`, `swapTo`) are taken whole from the earlier
 * bracketing key, because there is no meaningful halfway between two sprites
 * (F9 §7.7). For the three compositing channels that have one, the rest value
 * is the part's own authored field -- see `PartPose` in the JSON Schema.
 */
export interface ResolvedPartPose {
  rot: number;
  tx: number;
  ty: number;
  scale: number;
  visible: boolean;
  opacity: number;
  zIndex: number;
  swapTo: string | null;
}

/** Resolved part channels by part id. Parts absent from the map are at rest. */
export type ResolvedPartPoses = ReadonlyMap<string, ResolvedPartPose>;

/**
 * The fields of a `Part` that compositing reads.
 *
 * Declared structurally rather than taken as a whole `Part`, mirroring the
 * protocol the Python resolver declares. A wire `Part` also carries a mask, a
 * deformer, a provenance record and a confidence score, none of which decide a
 * single thing in compositing -- and requiring them would mean the parity corpus
 * had to author a whole valid RigDocument per case just to say "a part at
 * opacity 0.5". What the resolver reads IS the contract, so the contract is what
 * it declares.
 */
export interface CompositingPart {
  id: string;
  visible: boolean;
  opacity: number;
  zIndex: number;
  rect: { x: number; y: number; width: number; height: number };
}

/** A keyframe, as compositing reads it: a time, an easing, and part poses. */
export interface CompositingKeyframe {
  t: number;
  ease?: Ease;
  parts: Readonly<Record<string, PartPose>>;
}

/**
 * A clip, as compositing reads it.
 *
 * A wire `Clip` satisfies this, and so does a fixture case's two-field clip
 * block. Same reason `CompositingPart` is structural: `id`, `name`, `request`,
 * `fps`, `frameCount` and `source` decide nothing here, and demanding them would
 * mean the parity corpus had to author a whole valid clip to say "these two keys
 * loop".
 */
export interface CompositingClip {
  loop: boolean;
  keyframes: readonly CompositingKeyframe[];
}

/** Sheet-normalized `[scaleX, scaleY, offsetX, offsetY]` texture remap. */
export type UvRemap = readonly [number, number, number, number];

/**
 * How one part participates in one frame's composite.
 *
 * The twin of the server's `PartComposite` (py render/types.py). This IS the
 * resolved compositing state, and the compositing parity corpus compares the two
 * field for field -- because nothing else can: two implementations can disagree
 * about every value here while their vertices stay bit-identical.
 */
export interface PartComposite {
  /** Whose GEOMETRY is drawn. Always this part's own -- a `swapTo` never moves
   *  geometry. */
  partId: string;
  /** Whose PIXELS are sampled. Differs from `partId` only when a `swapTo`
   *  channel redirected it to another part's crop of the same sheet. */
  texturePartId: string;
  uvRemap: UvRemap;
  zIndex: number;
  opacity: number;
  /** Document order, used only to break a z-index tie deterministically. */
  order: number;
}

/**
 * What the last drawn frame cost geometrically.
 *
 * Reported per frame and accumulated per clip, because the frame the user is
 * parked on is rarely the worst one. Reset when the active clip changes -- a
 * stat carried over from another clip is worse than no stat.
 */
export interface DistortionReport {
  maxStretch: number;
  flippedTriangles: number;
  degenerateTriangles: number;
  /** Part contributing `maxStretch`, or null when nothing is distorted. */
  worstPartId: string | null;
}

/** A pose edit expressed as channel deltas, before it becomes a keyframe. */
export interface PoseEdit {
  joints?: Pose;
  parts?: Record<string, PartPose>;
}

/**
 * Locally edited clips, plus what they were forked from.
 *
 * The document is server-authoritative (R5), and there is no clip-write endpoint
 * yet, so hand-authored clips live here and are labelled as unsaved in the UI.
 * `baseRevisionId` is what makes that honest: when a stage lands a new revision
 * the draft is known to be stale rather than silently merged into it.
 */
export interface ClipDraft {
  baseRevisionId: string;
  clips: Clip[];
  dirty: boolean;
}

/** Read-only view of a document plus its draft clips, as the UI consumes it. */
export interface EditorDocumentView {
  document: RigDocument;
  clips: readonly Clip[];
  activeClip: Clip | null;
  activeKeyframe: Keyframe | null;
}
