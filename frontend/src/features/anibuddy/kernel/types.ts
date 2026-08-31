// Kernel input and output types.
//
// These are deliberately NOT the RigDocument v5 wire schema. The kernel owns a
// minimal, stable shape and each caller adapts the wire format into it. That
// keeps a schema revision from forcing a change to parity-critical math, and it
// keeps the kernel testable without dragging the API client, zod, or React into
// a pure-math module.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/types.py.
//
// Coordinate convention
// ---------------------
// Every position on the wire is normalized 0..1 against the asset's own width
// (x) or height (y). The kernel converts to SOURCE PIXELS on load and does all
// math there. This is not a style preference: a rotation applied in normalized
// space is a rotation in a non-uniformly scaled basis, which shears the figure
// whenever the asset is not square. The v3 renderer learned this the hard way;
// see the comment at lib/deform.ts line 68.
//
// Array layout
// ------------
// Vertex arrays are FLAT and interleaved, stride 2: [x0, y0, x1, y1, ...].
// Triangle arrays are flat, stride 3. Weight matrices are flat row-major,
// vertCount rows by boneCount columns. This mirrors NumPy's row-major (N, 2)
// and (N, B) layouts exactly, so an index computed in one kernel is the same
// index in the other.

import { KernelConstants } from "./constants";

export type DeformerKind = "rigid" | "mesh" | "lattice" | "spline";
export type LatticeInterpolation = "bilinear" | "bicubic";
export type EaseKind = "linear" | "ease" | "hold";
export type PoseChannel = (typeof KernelConstants.POSE_CHANNELS)[number];

/**
 * A structurally invalid rig or pose. Thrown rather than repaired: a
 * plausible-looking broken rig deforms silently into garbage, and a caller that
 * gets a rig back cannot tell that the kernel guessed.
 */
export class KernelInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelInputError";
  }
}

export interface Asset {
  width: number;
  height: number;
  /**
   * Height in pixels of the subject inside the sheet, used as the scale for the
   * `tx`/`ty` pose channels and for spline thickness. Translations are authored
   * as a fraction of the figure, not of the canvas, so the same clip reads
   * identically on a tightly cropped and a loosely cropped sheet.
   */
  figureHeight: number;
}

/** A node in the free-form joint tree. Positions are normalized 0..1. */
export interface Joint {
  id: string;
  parent: string | null;
  x: number;
  y: number;
}

/**
 * A parent to child segment.
 *
 * Bones are always DERIVED from the joint tree, never stored. Their order
 * follows joint order because that order indexes the columns of the skinning
 * weight matrix: reordering joints without rebuilding weights silently rebinds
 * every vertex to the wrong bone.
 */
export interface Bone {
  id: string;
  parentJoint: string;
  childJoint: string;
}

/**
 * A sparse local pose delta for one joint.
 *
 * Absent channels mean "at rest", which is not the same as zero for `scale`.
 * Keeping them absent rather than defaulted lets keyframe interpolation tell
 * "this key does not touch scale" from "this key sets scale to 1".
 */
export interface JointPose {
  rot?: number;
  tx?: number;
  ty?: number;
  scale?: number;
}

/** Sparse: joints absent from the record are at rest. */
export type Pose = Record<string, JointPose>;

/**
 * A part's local delta, and deliberately the SAME four channels as a joint's.
 *
 * The wire's `PartPose` carries eight; the other four -- `visible`, `opacity`,
 * `zIndex` and `swapTo` -- are compositing rather than geometry and are resolved
 * by ../editor/part-track.ts, which is parity-locked to the server's
 * render/partpose.py by its own corpus. Rasterization is per-target by design
 * (R4); deciding what to rasterize is not. What crosses into the
 * kernel is exactly the geometry subset, and it is the same type rather than a
 * copy of it so the two can never acquire different rest values or a different
 * interpolation form. A part and a joint move the same way; the difference is
 * what they drive, not how they are keyed.
 */
export type PartPose = JointPose;

/** Sparse: parts absent from the record are at rest. */
export type PartPoseMap = Record<string, PartPose>;

/**
 * One authored pose at a normalized time.
 *
 * `ease` describes the segment that STARTS at this key, so the easing of the
 * key you are leaving governs the interpolation. Undefined means smoothstep,
 * matching the v3 default.
 *
 * `joints` and `parts` are sampled by the same bracketing, easing and sparsity
 * rules -- see clip.ts. They are two records rather than one because a part id
 * and a joint id live in different namespaces and may legitimately collide.
 */
export interface Keyframe {
  t: number;
  joints: Pose;
  parts?: PartPoseMap;
  ease?: EaseKind;
}

/** An ordered keyframe track. `loop` closes the track back onto key 0. */
export interface Clip {
  id: string;
  loop: boolean;
  keyframes: Keyframe[];
}

/**
 * Pure affine follow. The part's quad rides one joint with zero deformation.
 *
 * Carries no fields at all: the rectangle it draws is `Part.rect` and the joint
 * it rides is `Part.boundJointId`. Both used to be copied onto this struct,
 * which meant the wire's part state and the kernel's deformer state were two
 * descriptions of one thing with nothing keeping them equal.
 */
export interface RigidDeformer {
  kind: "rigid";
}

/** Triangle mesh driven by linear blend skinning. */
export interface MeshDeformer {
  kind: "mesh";
  /** Flat [x, y, ...] normalized, length 2 * vertCount. */
  verts: Float32Array;
  /** Flat [i0, i1, i2, ...] indices, length 3 * triCount. */
  tris: Uint32Array;
  /**
   * Flat row-major vertCount x boneCount, rows summing to 1. Columns are
   * indexed by DERIVED bone order.
   */
  weights: Float32Array;
  boneCount: number;
}

/**
 * Free-form deformation over a quad control grid.
 *
 * `controlPoints` are ABSOLUTE part-local normalized positions -- the wire form,
 * verbatim -- rather than displacements from the rest grid. Storing
 * displacements would mean every caller reconstructed the same uniform rest grid
 * to difference against, and two reconstructions of one grid is two chances to
 * disagree in the one place where disagreement reads as the artwork shearing at
 * rest.
 *
 * The evaluated surface is then carried by `Part.boundJointId` so a lattice part
 * still follows the skeleton.
 */
export interface LatticeDeformer {
  kind: "lattice";
  cols: number;
  rows: number;
  /**
   * Flat row-major (rows + 1) x (cols + 1) x 2 part-local normalized positions.
   * At rest, point (i, j) is (i / cols, j / rows).
   */
  controlPoints: Float32Array;
  interpolation: LatticeInterpolation;
}

/**
 * Ribbon warp along a joint chain, for tails, tentacles and ropes.
 *
 * The control polyline IS a chain of joints, so the spline is posed by the same
 * forward kinematics as everything else rather than needing its own animation
 * channels.
 */
export interface SplineDeformer {
  kind: "spline";
  /** Joint ids in order along the chain, at least two. */
  joints: string[];
  /**
   * Taper track: at least one ribbon width, each a fraction of
   * Asset.figureHeight. Indexed by NORMALIZED POSITION along the spine rather
   * than by joint, so a chain the joint budget cut short still tapers over its
   * whole length. One entry is a uniform ribbon.
   */
  thickness: readonly number[];
  segments: number;
}

export type Deformer = RigidDeformer | MeshDeformer | LatticeDeformer | SplineDeformer;

/**
 * A similarity transform as `(a, b, originX, originY)`, meaning
 * `v' = [a -b; b a] * v + (originX, originY)`.
 *
 * Two numbers for the linear part rather than four, because every transform the
 * kernel composes is a rotation with a uniform scale -- never a shear and never
 * a non-uniform scale. That is not a simplification of a general affine; it is
 * what the pose channels can express, and holding the type to it means a shear
 * cannot be introduced by accident.
 */
export type PartTransform = readonly [number, number, number, number];

/**
 * A named attachment point one part OFFERS to its children.
 *
 * `x`/`y` are PART-LOCAL normalized against the host's `rect` (R6), exactly
 * like `Part.pivot`. A slot carries a position and nothing else: its
 * orientation and scale are the host's, which is what lets a sword move from a
 * hand slot to a back slot without either part learning the other's geometry.
 */
export interface Slot {
  name: string;
  x: number;
  y: number;
}

/**
 * One cutout layer: its deformer, its place in the sheet, and its parent.
 *
 * A part is driven by two independent things, and keeping them separable is the
 * whole point of the layered-cutout model:
 *
 * - its **deformer**, which shapes the artwork against the JOINT skeleton;
 * - its **place in the part tree**, which carries the whole shaped layer as a
 *   unit.
 *
 * `rect` and `boundJointId` live here rather than on the deformers that happen
 * to need them. `rect` because `pivot` and every `Slot` are part-local
 * normalized against it, and a mesh or spline part has a pivot too;
 * `boundJointId` because it is the same field for a rigid part and a lattice
 * part and copying it onto both deformers gave two places for one fact to live.
 */
export interface Part {
  id: string;
  zIndex: number;
  deformer: Deformer;
  /** Sheet-normalized [x0, y0, x1, y1]. Defines the part-local space. */
  rect?: readonly [number, number, number, number];
  /** Part-local normalized rotation and scale centre. */
  pivot?: readonly [number, number];
  /**
   * The joint a `rigid` or `lattice` part rides. Null -- or an id the skeleton
   * does not contain -- resolves to the ROOT joint, not to the identity: a part
   * pinned to nothing stays put while the figure moves around it, which reads as
   * the part having come loose.
   */
  boundJointId?: string | null;
  /** Transform parent in the cutout tree, or null for a root part. */
  parentPartId?: string | null;
  /**
   * Name of a `Slot` on the parent this part hangs from, or null to keep its
   * own authored placement.
   */
  attachSlot?: string | null;
  slots?: readonly Slot[];
}

/** The complete kernel input: a sheet, a joint tree, and layered parts. */
export interface KernelRig {
  asset: Asset;
  joints: Joint[];
  parts: Part[];
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Result of the forward kinematics pass, in source pixels.
 *
 * Carries rest data alongside posed data so every downstream deformer can build
 * its own transforms without re-deriving bones or re-reading the joint list,
 * which is the kind of duplication that lets the two kernels drift.
 */
export interface SolvedSkeleton {
  positions: Map<string, Point>;
  restPositions: Map<string, Point>;
  /**
   * Accumulated chain rotation in degrees: the sum of local `rot` deltas from
   * the root down to and including this joint. This is the angle a cutout part
   * bound to the joint should turn by.
   */
  accumulated: Map<string, number>;
  /** Posed world angle in degrees, per bone. */
  posedAngles: Float64Array;
  /** Rest world angle in degrees, per bone. */
  restAngles: Float64Array;
  /** Rest length in source pixels, per bone. */
  restLengths: Float64Array;
  bones: Bone[];
  /**
   * Id of the single root joint. Carried so a part with no bound joint can fall
   * back to it inside the kernel, which is the only way both kernels get the
   * same answer -- when each caller's adapter resolved the fallback itself, the
   * browser used the identity and the server used the root.
   */
  root: string;
}

/**
 * Per-triangle affine warps plus the frame's distortion report.
 *
 * Degenerate source triangles are dropped, so `triangleIndex` records which
 * input triangle each row came from; a renderer must not assume row i is
 * triangle i.
 */
export interface WarpBatch {
  /** Flat stride 6: (a, b, c, d, e, f) in canvas order [a c; b d]. */
  matrices: Float32Array;
  /** Flat stride 6: destination triangle corners after seam bleed. */
  bled: Float32Array;
  /** Index of the source triangle each kept row came from. */
  triangleIndex: Uint32Array;
  /** Worst finite sigmaMax / sigmaMin across the frame. 1 = undistorted. */
  maxStretch: number;
  /** Triangles whose affine map flipped orientation (determinant < 0). */
  flippedTriangles: number;
  /** Triangles skipped for having a degenerate source area. */
  degenerateTriangles: number;
}

/**
 * A posed part, as a textured triangle mesh in source pixels.
 *
 * All four deformers emit this same shape. That is the point: the rasterizer,
 * on either side of the wire, has exactly one code path regardless of whether a
 * part is rigid, skinned, lattice-warped or splined.
 */
export interface PartGeometry {
  partId: string;
  zIndex: number;
  kind: DeformerKind;
  /**
   * Flat stride 2 rest positions in source pixels. These are the texture
   * coordinates: where each vertex reads from in the sheet.
   */
  srcVerts: Float32Array;
  /**
   * Flat stride 2 posed positions in source pixels. The part tree's world
   * transform is ALREADY folded in; a renderer draws these directly.
   */
  dstVerts: Float32Array;
  tris: Uint32Array;
  warp: WarpBatch;
  /**
   * The part tree's world transform that was applied, reported so a caller
   * (and the parity corpus) can attribute a displacement to the tree rather
   * than to the deformer. Exactly `(1, 0, 0, 0)` when the part and every
   * ancestor are at rest.
   */
  transform: PartTransform;
}

/** Everything one posed frame needs, minus pixels. */
export interface KernelFrame {
  skeleton: SolvedSkeleton;
  parts: PartGeometry[];
}

/** Evaluation result of a deformer, before the warp pass. Float64 working set. */
export interface DeformedMesh {
  srcVerts: Float64Array;
  dstVerts: Float64Array;
  tris: Uint32Array;
}
