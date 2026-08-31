// Fixture adapter for the golden parity harness.
//
// The mirror of py_backend/app/modules/anibuddy/kernel_fixtures.py. It adapts
// one particular wire format -- the fixture corpus -- into the kernel's input
// structs and serializes the result back out, which is the same job the editor
// and the render worker each do for their own formats. It is test scaffolding
// and a worked example of the adapter boundary at the same time.
//
// No file access here: objects in, objects out. The test file owns the
// filesystem.

import { AniBuddyKernel } from "./kernel";
import { PoseTrack } from "./clip";
import { KernelConstants } from "./constants";
import {
  KernelInputError,
  type Asset,
  type Clip,
  type Deformer,
  type Joint,
  type KernelRig,
  type Part,
  type PartGeometry,
  type PartPoseMap,
  type Pose,
  type Slot,
} from "./types";

interface SerializedWarp {
  matrices: number[];
  bled: number[];
  triangleIndex: number[];
  maxStretch: number;
  flippedTriangles: number;
  degenerateTriangles: number;
}

interface SerializedPart {
  id: string;
  kind: string;
  zIndex: number;
  transform: number[];
  srcVerts: number[];
  dstVerts: number[];
  tris: number[];
  warp: SerializedWarp;
}

export interface SerializedResult {
  id: string;
  pose: Array<[string, string, number]>;
  partPose: Array<[string, string, number]>;
  joints: Array<[string, number, number, number]>;
  bones: Array<[string, number, number, number]>;
  parts: SerializedPart[];
}

/** The shape a fixture case file has on disk. Intentionally loose. */
export interface FixtureCase {
  id: string;
  description?: string;
  rig: Record<string, unknown>;
  pose?: Record<string, Record<string, number>>;
  partPose?: Record<string, Record<string, number>>;
  clip?: Record<string, unknown>;
  time?: number;
  scale?: [number, number];
}

function readAsset(data: Record<string, unknown>): Asset {
  const width = Number(data.width);
  const height = Number(data.height);
  if (!(width > 0) || !(height > 0)) {
    throw new KernelInputError("Asset dimensions must be positive.");
  }
  return {
    width,
    height,
    figureHeight: data.figureHeight === undefined ? height : Number(data.figureHeight),
  };
}

function readJoint(data: Record<string, unknown>): Joint {
  const parent = data.parent;
  return {
    id: String(data.id),
    parent: parent === null || parent === undefined ? null : String(parent),
    x: Number(data.x),
    y: Number(data.y),
  };
}

function readRect(values: unknown): readonly [number, number, number, number] {
  const list = values as number[];
  return [Number(list[0]), Number(list[1]), Number(list[2]), Number(list[3])];
}

function readDeformer(data: Record<string, unknown>): Deformer {
  const kind = String(data.kind);
  if (kind === "rigid") {
    return { kind: "rigid" };
  }
  if (kind === "mesh") {
    return {
      kind: "mesh",
      verts: Float32Array.from(data.verts as number[]),
      tris: Uint32Array.from(data.tris as number[]),
      weights: Float32Array.from(data.weights as number[]),
      boneCount: Number(data.boneCount),
    };
  }
  if (kind === "lattice") {
    const cols = Number(data.cols);
    const rows = Number(data.rows);
    const controlPoints = Float32Array.from(data.controlPoints as number[]);
    if (controlPoints.length !== (rows + 1) * (cols + 1) * 2) {
      throw new KernelInputError(
        `Lattice control points have ${controlPoints.length} values, expected ${(rows + 1) * (cols + 1) * 2}.`,
      );
    }
    return {
      kind: "lattice",
      cols,
      rows,
      controlPoints,
      interpolation: (data.interpolation === "bicubic" ? "bicubic" : "bilinear") as
        | "bilinear"
        | "bicubic",
    };
  }
  if (kind === "spline") {
    const joints = (data.joints as string[]).map(String);
    if (joints.length < 2) throw new KernelInputError("A spline deformer needs at least two joints.");
    return {
      kind: "spline",
      joints,
      thickness: readThickness(data.thickness),
      segments: Number(data.segments),
    };
  }
  throw new KernelInputError(`Unknown deformer kind "${kind}".`);
}

/**
 * A spline taper track from either a scalar or an array.
 *
 * A bare number is accepted as a one-entry track, which is the uniform ribbon;
 * it is not a legacy shim but the honest reading of "this ribbon has one width".
 */
function readThickness(value: unknown): number[] {
  if (typeof value === "number") return [value];
  const track = (value as unknown[]).map(Number);
  if (track.length === 0) {
    throw new KernelInputError("A spline deformer needs at least one thickness value.");
  }
  return track;
}

function readVec2(values: unknown): readonly [number, number] {
  const list = values as number[];
  return [Number(list[0]), Number(list[1])];
}

function readSlot(data: Record<string, unknown>): Slot {
  const position = readVec2(data.position);
  return { name: String(data.name), x: position[0], y: position[1] };
}

function readPart(data: Record<string, unknown>): Part {
  return {
    id: String(data.id),
    zIndex: data.zIndex === undefined ? 0 : Number(data.zIndex),
    deformer: readDeformer(data.deformer as Record<string, unknown>),
    rect: data.rect === undefined ? KernelConstants.FULL_SHEET_RECT : readRect(data.rect),
    pivot: data.pivot === undefined ? KernelConstants.DEFAULT_PIVOT : readVec2(data.pivot),
    parentPartId:
      data.parentPartId === null || data.parentPartId === undefined
        ? null
        : String(data.parentPartId),
    attachSlot:
      data.attachSlot === null || data.attachSlot === undefined ? null : String(data.attachSlot),
    boundJointId:
      data.boundJointId === null || data.boundJointId === undefined
        ? null
        : String(data.boundJointId),
    slots: ((data.slots ?? []) as Array<Record<string, unknown>>).map(readSlot),
  };
}

function toArray(values: Float32Array): number[] {
  return Array.from(values);
}

function serializePose(pose: Pose): Array<[string, string, number]> {
  const rows: Array<[string, string, number]> = [];
  for (const jointId of Object.keys(pose).sort()) {
    const jointPose = pose[jointId] as Record<string, number | undefined>;
    for (const channel of Object.keys(jointPose).sort()) {
      const value = jointPose[channel];
      if (value === undefined) continue;
      rows.push([jointId, channel, Math.fround(value)]);
    }
  }
  return rows;
}

function serializePart(part: PartGeometry): SerializedPart {
  return {
    id: part.partId,
    kind: part.kind,
    zIndex: part.zIndex,
    // The part tree's world transform, emitted alongside the vertices it
    // already moved. Redundant in principle and worth it in practice: a
    // composition-order defect names itself here instead of being inferred from
    // a displaced vertex 37 pages into a diff.
    transform: part.transform.map((value) => Math.fround(value)),
    srcVerts: toArray(part.srcVerts),
    dstVerts: toArray(part.dstVerts),
    tris: Array.from(part.tris),
    warp: {
      matrices: toArray(part.warp.matrices),
      bled: toArray(part.warp.bled),
      triangleIndex: Array.from(part.warp.triangleIndex),
      maxStretch: part.warp.maxStretch,
      flippedTriangles: part.warp.flippedTriangles,
      degenerateTriangles: part.warp.degenerateTriangles,
    },
  };
}

export const KernelFixtures = {
  /** Adapt a fixture case's `rig` block into kernel input structs. */
  readRig(data: Record<string, unknown>): KernelRig {
    const joints = (data.joints as Array<Record<string, unknown>>).map(readJoint);
    if (joints.length === 0) throw new KernelInputError("A rig needs at least one joint.");
    return {
      asset: readAsset(data.asset as Record<string, unknown>),
      joints,
      parts: ((data.parts ?? []) as Array<Record<string, unknown>>).map(readPart),
    };
  },

  /**
   * The JOINT pose a case evaluates at.
   *
   * A case either states a pose directly or names a clip and a time. The clip
   * path exists so keyframe interpolation is covered by the same golden
   * comparison as the geometry, rather than by a separate test that could drift
   * on its own.
   */
  resolvePose(fixtureCase: FixtureCase): Pose {
    if (fixtureCase.clip) {
      return PoseTrack.poseAt(fixtureCase.clip as unknown as Clip, fixtureCase.time ?? 0);
    }
    return (fixtureCase.pose ?? {}) as Pose;
  },

  /** The PART pose a case evaluates at, by the same two routes. */
  resolvePartPose(fixtureCase: FixtureCase): PartPoseMap {
    if (fixtureCase.clip) {
      return PoseTrack.partPoseAt(fixtureCase.clip as unknown as Clip, fixtureCase.time ?? 0);
    }
    return (fixtureCase.partPose ?? {}) as PartPoseMap;
  },

  /** Evaluate a case to the golden document shape. */
  evaluate(fixtureCase: FixtureCase): SerializedResult {
    const rig = KernelFixtures.readRig(fixtureCase.rig);
    const pose = KernelFixtures.resolvePose(fixtureCase);
    const partPose = KernelFixtures.resolvePartPose(fixtureCase);
    const scale = fixtureCase.scale ?? [1, 1];
    const frame = AniBuddyKernel.evaluate(rig, pose, scale[0], scale[1], partPose);

    // Joints are emitted as a sorted list rather than an object so the golden
    // diffs cleanly and neither language's key ordering can matter.
    const joints = [...frame.skeleton.positions.keys()]
      .sort()
      .map((jointId): [string, number, number, number] => {
        const position = frame.skeleton.positions.get(jointId)!;
        return [
          jointId,
          Math.fround(position.x),
          Math.fround(position.y),
          Math.fround(frame.skeleton.accumulated.get(jointId) ?? 0),
        ];
      });

    const bones = frame.skeleton.bones.map((bone, index): [string, number, number, number] => [
      bone.id,
      Math.fround(frame.skeleton.restAngles[index]),
      Math.fround(frame.skeleton.posedAngles[index]),
      Math.fround(frame.skeleton.restLengths[index]),
    ]);

    return {
      id: fixtureCase.id,
      pose: serializePose(pose),
      partPose: serializePose(partPose),
      joints,
      bones,
      parts: frame.parts.map(serializePart),
    };
  },
} as const;
