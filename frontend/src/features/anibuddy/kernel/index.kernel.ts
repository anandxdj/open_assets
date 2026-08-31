// AniBuddy deformation kernel: pure vertex math, shared contract with the server.
//
// This module is one half of a deliberately duplicated implementation. Its twin
// is py_backend/app/modules/anibuddy/kernel/. The server renders the
// authoritative export; the browser deforms interactively. If the two drift, a
// user poses something, likes it, exports it, and gets something different --
// with nothing failing anywhere.
//
// The only thing standing between that failure mode and production is the
// golden parity harness (scripts/test-anibuddy-kernel.sh). Treat a parity
// failure as a release blocker, not as a flaky test, and never widen the
// epsilon to make one go away.
//
// Rules for editing anything in here:
//
// 1. Every change is made in both kernels, in the same commit.
// 2. Operation order is part of the contract. `a * b / c` and `a * (b / c)` are
//    different functions at the last bit.
// 3. No I/O, no logging, no rasterization, no DOM.

export { PoseTrack } from "./clip";
export { KernelConstants } from "./constants";
export { Curves } from "./curves";
export { Deformers } from "./deformers";
export { Fk } from "./fk";
export { Grid } from "./grid";
export { AniBuddyKernel } from "./kernel";
export { Lattice } from "./lattice";
export { Numeric } from "./numeric";
export { PartTree } from "./parts";
export { Skeleton } from "./skeleton";
export { Skin } from "./skin";
export { Spline } from "./spline";
export { Warp } from "./warp";
export { KernelInputError } from "./types";
export type {
  Asset,
  Bone,
  Clip,
  DeformedMesh,
  Deformer,
  DeformerKind,
  EaseKind,
  Joint,
  JointPose,
  Keyframe,
  KernelFrame,
  KernelRig,
  LatticeDeformer,
  LatticeInterpolation,
  MeshDeformer,
  Part,
  PartGeometry,
  PartPose,
  PartPoseMap,
  PartTransform,
  Point,
  Pose,
  PoseChannel,
  RigidDeformer,
  Slot,
  SolvedSkeleton,
  SplineDeformer,
  WarpBatch,
} from "./types";
export type { Bracket, BracketableKey, KeyBracket } from "./clip";
export type { RigidTransform } from "./skin";
