// Core data model for AniBuddy — the non-generative 2D puppet animation
// workspace specified in docs/plan/features/F9-anibuddy.md.
//
// The rig deliberately reuses the studio's deterministic pose engine
// (features/studio/lib/rig/). That engine was written to render grey mannequin
// pose-maps for conditioning an image model; AniBuddy consumes the same
// `FramePose` tables as SKELETON DRIVE DATA and deforms the user's own pixels
// with them. Nothing here generates image pixels.
import type {
  BodyPlanId,
  SubjectBounds,
} from "@/features/studio/lib/rig/rigCore";

/** The v1 motion templates from F9 §3. Deliberately small and safe. */
export type MotionId = "idle" | "bounce" | "wave" | "blink";

export type StepId =
  | "concept"
  | "source"
  | "prepare"
  | "rig"
  | "animate"
  | "export";

/** Ordered for the step rail. `concept` is advice, not a dependency. */
export const STEP_ORDER: StepId[] = [
  "concept",
  "source",
  "prepare",
  "rig",
  "animate",
  "export",
];

export interface Joint {
  /** Stable identifier, e.g. `elbowA`. Referenced by `Joint.parent`. */
  id: string;
  /** Human label shown in the editor, e.g. "Near elbow". */
  name: string;
  /** Normalized 0..1 of the PREPARED asset width. */
  x: number;
  /** Normalized 0..1 of the PREPARED asset height. */
  y: number;
  /** Parent joint id, or null for the single root. */
  parent: string | null;
}

/** A parent→child joint segment. Bones are derived, never stored. */
export interface Bone {
  id: string;
  parentJoint: Joint;
  childJoint: Joint;
}

export interface Mesh {
  /** Flat [x0,y0, x1,y1, ...], normalized 0..1 of the prepared asset. */
  verts: Float32Array;
  /** Flat [i0,i1,i2, ...] vertex indices, 3 per triangle. */
  tris: Uint32Array;
}

/**
 * Linear-blend-skinning bind weights. Row-major:
 * `verts.length / 2` rows × `bones.length` columns, each row summing to 1.
 */
export type Weights = Float32Array;

export interface Rig {
  bodyPlan: BodyPlanId;
  joints: Joint[];
  mesh: Mesh;
  weights: Weights;
  /** Model's judgement, already intersected with local structural checks. */
  supported: MotionId[];
  /** Shown verbatim beside disabled templates. */
  warnings: string[];
  /** Flips to `edited` on any user change, so the UI can say so. */
  source: "model" | "edited";
}

/** Escape hatches for artwork the default pipeline would damage. */
export interface PrepareOptions {
  /** Skip background removal for art whose background is intentional. */
  keepBackground: boolean;
  /** Skip speck/secondary-blob removal, e.g. for a character holding a prop. */
  keepLooseParts: boolean;
}

export const DEFAULT_PREPARE_OPTIONS: PrepareOptions = {
  keepBackground: false,
  keepLooseParts: false,
};

export interface PreparedAsset {
  /** Transparent, trimmed PNG data URL. */
  dataUrl: string;
  width: number;
  height: number;
  bounds: SubjectBounds;
  /** SHA-256 of the prepared bytes. Guards manifest reopen (F9 §4). */
  hash: string;
  /**
   * The options this asset was produced with. Carried so a manifest reopen can
   * re-run preparation identically — otherwise re-supplying the *correct*
   * artwork still fails the hash check whenever the user flipped an option,
   * and the refusal would be a lie about which image they handed back.
   */
  options: PrepareOptions;
}

export interface SourceAsset {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

/** Background treatment. GIF has 1-bit alpha, so exports matte against this. */
export type BackgroundId = "transparent" | "white" | "dark";

export const FPS_OPTIONS = [8, 12, 16] as const;
export type Fps = (typeof FPS_OPTIONS)[number];

/** F9 §6 memory caps. */
export const MAX_SOURCE_EDGE = 2048;
export const MAX_FRAMES = 24;
export const MAX_GIF_EDGE = 512;

export const PROJECT_SCHEMA_VERSION = 2;

export interface AniBuddyProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  concept: { idea: string; prompt: string | null };
  source: SourceAsset | null;
  rightsConfirmed: boolean;
  prepared: PreparedAsset | null;
  rig: Rig | null;
  motion: MotionId | null;
  fps: Fps;
  frameCount: number;
  background: BackgroundId;
}

/** Shape returned by POST /api/enhance/anibuddy/rig-analysis. Joints only —
 *  mesh and weights are derived deterministically on the client. */
export interface RigAnalysis {
  bodyPlan: BodyPlanId;
  /**
   * Positions only. `name` and `parent` are deliberately absent: the route sends
   * neither, and `hardenJoints` supplies both from the canonical tree so a model
   * cannot reparent a joint. Typing this as `Joint[]` would advertise fields that
   * never arrive over the wire.
   */
  joints: Pick<Joint, "id" | "x" | "y">[];
  supported: MotionId[];
  warnings: string[];
}

export function createEmptyProject(): AniBuddyProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    concept: { idea: "", prompt: null },
    source: null,
    rightsConfirmed: false,
    prepared: null,
    rig: null,
    motion: null,
    fps: 12,
    frameCount: 8,
    background: "transparent",
  };
}

/**
 * Whether an asset still carries its pixels.
 *
 * Both persistence paths strip `dataUrl` to `""` — localStorage because base64
 * bitmaps blow the ~5MB quota, manifests because a project file should not
 * redistribute someone's art. The metadata survives, so a stripped asset is a
 * non-null object that every step gate would otherwise wave through, and the
 * user would land on export with nothing to render.
 */
export function hasPixels(asset: { dataUrl: string } | null | undefined): boolean {
  return typeof asset?.dataUrl === "string" && asset.dataUrl.length > 0;
}

/** Derive bones from the joint tree. Order is stable (joint order), because
 *  weight matrix columns are indexed by it. */
export function getBones(joints: Joint[]): Bone[] {
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const bones: Bone[] = [];
  for (const joint of joints) {
    if (!joint.parent) continue;
    const parent = byId.get(joint.parent);
    if (!parent) continue;
    bones.push({ id: `${parent.id}->${joint.id}`, parentJoint: parent, childJoint: joint });
  }
  return bones;
}

/**
 * Structural validity gate for steps 4 and 5. A rig that fails this can produce
 * a silently broken render, so export stays locked until every check passes.
 * Returns a reason string on failure so the UI can explain the lock.
 */
export function rigInvalidReason(rig: Rig | null): string | null {
  if (!rig) return "No rig yet.";

  const { joints, mesh, weights } = rig;
  if (joints.length < 3) return "A rig needs at least three joints.";

  const roots = joints.filter((joint) => joint.parent === null);
  if (roots.length !== 1) {
    return roots.length === 0
      ? "The rig has no root joint."
      : `The rig has ${roots.length} root joints; it needs exactly one.`;
  }

  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  for (const joint of joints) {
    if (joint.parent !== null && !byId.has(joint.parent)) {
      return `Joint "${joint.name}" points at a missing parent.`;
    }
    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y)) {
      return `Joint "${joint.name}" has an invalid position.`;
    }
    if (joint.x < 0 || joint.x > 1 || joint.y < 0 || joint.y > 1) {
      return `Joint "${joint.name}" sits outside the artwork.`;
    }
  }

  // Cycle check: walking to the root must terminate within joints.length hops.
  for (const joint of joints) {
    let cursor: Joint | undefined = joint;
    let hops = 0;
    while (cursor?.parent) {
      cursor = byId.get(cursor.parent);
      if (++hops > joints.length) return "The joint tree contains a loop.";
    }
  }

  if (mesh.verts.length < 6 || mesh.tris.length < 3) {
    return "The mesh is empty.";
  }

  const vertCount = mesh.verts.length / 2;
  const boneCount = getBones(joints).length;
  if (boneCount === 0) return "The rig has no bones.";
  if (weights.length !== vertCount * boneCount) {
    return "Mesh weights are out of sync with the rig.";
  }

  for (let row = 0; row < vertCount; row++) {
    let sum = 0;
    for (let col = 0; col < boneCount; col++) sum += weights[row * boneCount + col];
    if (Math.abs(sum - 1) > 1e-3) return "Mesh weights are not normalized.";
  }

  return null;
}

export function isRigValid(rig: Rig | null): rig is Rig {
  return rigInvalidReason(rig) === null;
}
