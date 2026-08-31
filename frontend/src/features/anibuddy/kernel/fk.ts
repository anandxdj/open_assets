// Forward kinematics over the free-form joint tree.
//
// Ported from lib/deform.ts `solve` (~line 111). The tree is free-form -- any
// acyclic graph with one root, not a fixed humanoid -- so the walk is a
// breadth-first traversal that accumulates rotation down each chain and places
// each child at its scaled rest length from its parent.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/fk.py.

import { KernelConstants } from "./constants";
import { Numeric } from "./numeric";
import { Skeleton } from "./skeleton";
import type { Asset, Joint, JointPose, Point, Pose, SolvedSkeleton } from "./types";

/** Shared immutable "no delta" pose, so the hot loop allocates nothing. */
const REST_POSE: JointPose = Object.freeze({});

function rotOrRest(pose: JointPose): number {
  return pose.rot === undefined ? KernelConstants.REST_DEFAULT : pose.rot;
}

function txOrRest(pose: JointPose): number {
  return pose.tx === undefined ? KernelConstants.REST_DEFAULT : pose.tx;
}

function tyOrRest(pose: JointPose): number {
  return pose.ty === undefined ? KernelConstants.REST_DEFAULT : pose.ty;
}

function scaleOrRest(pose: JointPose): number {
  return pose.scale === undefined ? KernelConstants.REST_SCALE : pose.scale;
}

export const Fk = {
  /**
   * Walk the tree, applying each joint's local delta, in source pixels.
   *
   * Evaluation order is part of the parity contract:
   *
   * - Bones are derived in joint order (see Skeleton.bones).
   * - The traversal is a FIFO queue seeded with the root, and children are
   *   visited in joint order. A different visit order would not change any
   *   individual joint's position -- each depends only on its parent -- but it
   *   would change the order in which posedAngles is written, and keeping the
   *   two kernels textually parallel is worth more than the freedom.
   * - tx/ty are scaled by figureHeight, not by the canvas, so a clip authored
   *   on a tight crop reads the same on a loose one.
   * - The child's position is parent + scaledLength * (cos, sin) of the
   *   accumulated world angle, matching the browser's projRight: angle measured
   *   from straight right, positive tilting down.
   */
  solve(joints: Joint[], asset: Asset, pose: Pose): SolvedSkeleton {
    const bones = Skeleton.bones(joints);
    const restPositions = Skeleton.restPositions(joints, asset);
    const { restAngles, restLengths } = Skeleton.restGeometry(bones, restPositions);
    const boneOfChild = Skeleton.boneIndexByChild(bones);
    const childrenOf = Skeleton.childrenOf(joints);
    const root = Skeleton.root(joints);
    const figureHeight = asset.figureHeight;

    const posedAngles = Float64Array.from(restAngles);
    const positions = new Map<string, Point>();
    const accumulated = new Map<string, number>();

    const rootRest = restPositions.get(root.id)!;
    const rootPose = pose[root.id] ?? REST_POSE;
    positions.set(root.id, {
      x: rootRest.x + txOrRest(rootPose) * figureHeight,
      y: rootRest.y + tyOrRest(rootPose) * figureHeight,
    });
    accumulated.set(root.id, rotOrRest(rootPose));

    // Explicit head index instead of Array.shift(): shift is O(n) per call on
    // some engines, and the visit order is identical either way.
    const queue: Joint[] = [root];
    for (let head = 0; head < queue.length; head++) {
      const parent = queue[head];
      const parentPos = positions.get(parent.id)!;
      const parentAccumulated = accumulated.get(parent.id) ?? 0;

      for (const child of childrenOf.get(parent.id) ?? []) {
        const index = boneOfChild.get(child.id);
        if (index === undefined) continue;

        const local = pose[child.id] ?? REST_POSE;
        // Rotation accumulates down the chain: a shoulder turn carries the
        // elbow and the hand with it. The local delta is added to the parent's
        // accumulated angle, and the bone's REST angle is added on top to get
        // the world angle.
        const chain = parentAccumulated + rotOrRest(local);
        const world = restAngles[index] + chain;
        posedAngles[index] = world;

        const scaledLength = restLengths[index] * scaleOrRest(local);
        const radians = Numeric.radians(world);
        const nextX = parentPos.x + scaledLength * Math.cos(radians);
        const nextY = parentPos.y + scaledLength * Math.sin(radians);

        positions.set(child.id, {
          x: nextX + txOrRest(local) * figureHeight,
          y: nextY + tyOrRest(local) * figureHeight,
        });
        accumulated.set(child.id, chain);
        queue.push(child);
      }
    }

    // A joint unreachable from the root (an orphan sub-tree, or a dangling
    // parent reference) keeps its rest position rather than vanishing to the
    // origin, which would drag any part bound to it across the canvas.
    for (const joint of joints) {
      if (!positions.has(joint.id)) positions.set(joint.id, restPositions.get(joint.id)!);
      if (!accumulated.has(joint.id)) accumulated.set(joint.id, 0);
    }

    return {
      positions,
      restPositions,
      accumulated,
      posedAngles,
      restAngles,
      restLengths,
      bones,
      root: root.id,
    };
  },
} as const;
