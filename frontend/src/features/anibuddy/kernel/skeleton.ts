// Derived views of the joint tree: bones, children, root, rest geometry.
//
// Nothing here is stored on the wire. Bones in particular are always recomputed
// from the joint list, because the moment a bone list is persisted it can
// disagree with the tree that produced it, and the weight matrix -- whose
// columns are bone-indexed -- would then bind every vertex to the wrong bone
// with no error anywhere.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/skeleton.py.

import { Numeric } from "./numeric";
import { KernelInputError, type Asset, type Bone, type Joint, type Point } from "./types";

export const Skeleton = {
  /**
   * Derive parent to child segments in JOINT ORDER.
   *
   * Order is the contract. The skinning weight matrix has one column per bone
   * in exactly this sequence, so both kernels must walk the joint list in the
   * same direction and skip the same entries: the root (no parent) and any
   * joint whose parent id does not resolve.
   */
  bones(joints: Joint[]): Bone[] {
    const byId = new Map(joints.map((joint) => [joint.id, joint]));
    const out: Bone[] = [];
    for (const joint of joints) {
      if (joint.parent === null) continue;
      const parent = byId.get(joint.parent);
      if (!parent) continue;
      out.push({ id: `${parent.id}->${joint.id}`, parentJoint: parent.id, childJoint: joint.id });
    }
    return out;
  },

  /** Adjacency in joint order, so the BFS visits siblings deterministically. */
  childrenOf(joints: Joint[]): Map<string, Joint[]> {
    const out = new Map<string, Joint[]>();
    for (const joint of joints) {
      if (joint.parent === null) continue;
      const siblings = out.get(joint.parent);
      if (siblings) siblings.push(joint);
      else out.set(joint.parent, [joint]);
    }
    return out;
  },

  /**
   * The single parentless joint, falling back to the first joint.
   *
   * The fallback exists because forward kinematics on a rootless tree should
   * still produce something inspectable rather than throwing inside a render
   * loop; structural validation is the caller's job.
   */
  root(joints: Joint[]): Joint {
    for (const joint of joints) {
      if (joint.parent === null) return joint;
    }
    if (joints.length === 0) throw new KernelInputError("A rig needs at least one joint.");
    return joints[0];
  },

  /**
   * Normalized joint positions lifted into SOURCE PIXELS.
   *
   * Everything downstream works in this space. Rotating in normalized space
   * would shear the figure on any non-square sheet, because a rotation matrix
   * is only a rotation in an orthonormal basis.
   */
  restPositions(joints: Joint[], asset: Asset): Map<string, Point> {
    const width = asset.width;
    const height = asset.height;
    return new Map(joints.map((joint) => [joint.id, { x: joint.x * width, y: joint.y * height }]));
  },

  /**
   * Rest world angle (degrees) and rest length (pixels) per bone.
   *
   * Angles are measured from straight right (+x) with positive tilting down,
   * matching canvas orientation. Computed once from rest data, so the single
   * atan2 per bone here is the only place that transcendental enters the rest
   * pose.
   *
   * The conversion is written (atan2(...) * 180) / PI -- multiply first -- to
   * match the Python kernel exactly. Folding it to atan2(...) * (180 / PI)
   * changes the last bit.
   */
  restGeometry(
    bones: Bone[],
    restPositions: Map<string, Point>,
  ): { restAngles: Float64Array; restLengths: Float64Array } {
    const restAngles = new Float64Array(bones.length);
    const restLengths = new Float64Array(bones.length);
    for (let index = 0; index < bones.length; index++) {
      const from = restPositions.get(bones[index].parentJoint)!;
      const to = restPositions.get(bones[index].childJoint)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      restAngles[index] = (Math.atan2(dy, dx) * 180) / Numeric.PI;
      restLengths[index] = Numeric.length(dx, dy);
    }
    return { restAngles, restLengths };
  },

  /**
   * Map a child joint id to the index of the bone that ends at it.
   *
   * A joint identifies a bone by being its endpoint, which is how a rigid or
   * lattice part names the segment it rides.
   */
  boneIndexByChild(bones: Bone[]): Map<string, number> {
    return new Map(bones.map((bone, index) => [bone.childJoint, index]));
  },
} as const;
