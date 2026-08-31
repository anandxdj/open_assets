// Inverse kinematics for direct joint dragging.
//
// Cyclic coordinate descent, which is the right solver for this problem for one
// specific reason: it only ever writes a joint's local `rot`, so its output is
// already a legal sparse JointPose. An analytic two-bone solver would be exact
// and cheaper, but the archetype priors set `ikChainLength` per joint role and
// nothing guarantees the chain is two links -- a tentacle tip with a chain of
// four has no closed form worth maintaining in two languages.
//
// `Joint.ikChainLength` is honoured exactly: it is the number of ANCESTORS a drag
// on that joint may rotate. Null means FK only, which is the same solver with a
// one-link chain rather than a separate code path -- dragging an FK joint rotates
// its parent and nothing above it.
//
// This is not kernel math. It calls the kernel's forward solve, reads the joint
// positions it reports, and never computes a vertex position itself (R5).

import { AniBuddyKernel } from "@/features/anibuddy/kernel/index.kernel";
import type { JointPose, KernelRig, Pose } from "@/features/anibuddy/kernel/index.kernel";
import type { Joint } from "@/features/anibuddy/rig/index.rig";
import { EditorConstants } from "./editor.constants";

/** Shortest signed difference between two angles, in degrees. */
function shortestDelta(degrees: number): number {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}

function clampStep(degrees: number): number {
  const limit = EditorConstants.IK_MAX_STEP_DEG;
  return degrees > limit ? limit : degrees < -limit ? -limit : degrees;
}

export const IkSolver = {
  /**
   * How many ancestors a drag on this joint may rotate.
   *
   * A joint with no IK prior still poses -- it just poses one link. Treating null
   * as "unposeable" is how the v3 editor ended up with joints the user could
   * select but not move.
   */
  chainLengthFor(joint: Joint | undefined): number {
    if (!joint) return 0;
    return joint.ikChainLength ?? EditorConstants.FK_CHAIN_LENGTH;
  },

  /**
   * The ancestors a drag may rotate, nearest first.
   *
   * Walks parent links, capped by the joint count so a cyclic parent reference in
   * a hand-edited document cannot spin here. Structural validation belongs to the
   * server (R5); the preview just refuses to hang.
   */
  chain(jointId: string, joints: readonly Joint[], chainLength: number): string[] {
    const byId = new Map(joints.map((joint) => [joint.id, joint]));
    const out: string[] = [];
    let current = byId.get(jointId)?.parent ?? null;
    while (current !== null && out.length < chainLength && out.length < joints.length) {
      out.push(current);
      current = byId.get(current)?.parent ?? null;
    }
    return out;
  },

  /**
   * Rotate the chain so `jointId` reaches (`targetX`, `targetY`) in source pixels.
   *
   * Returns a new pose; the input is never mutated, because the caller holds it as
   * React state. An unreachable target converges to the closest the chain can get,
   * which is the behaviour an artist expects from dragging past a limb's reach.
   *
   * The per-sweep rotation cap is load-bearing. Without it, a target that lands
   * nearly on top of a chain joint produces a huge step from an angle that is
   * numerically meaningless, and the limb snaps inside out on a single pointer
   * move.
   */
  solve(input: {
    rig: KernelRig;
    pose: Pose;
    joints: readonly Joint[];
    jointId: string;
    targetX: number;
    targetY: number;
    chainLength: number;
  }): Pose {
    const chain = IkSolver.chain(input.jointId, input.joints, input.chainLength);
    if (chain.length === 0) return input.pose;

    const working: Pose = { ...input.pose };
    for (const jointId of chain) {
      working[jointId] = { ...(working[jointId] ?? {}) } as JointPose;
    }

    for (let sweep = 0; sweep < EditorConstants.IK_ITERATIONS; sweep++) {
      let solved = AniBuddyKernel.solve(input.rig, working);
      const effector = solved.positions.get(input.jointId);
      if (!effector) return input.pose;
      if (
        Math.hypot(effector.x - input.targetX, effector.y - input.targetY) <=
        EditorConstants.IK_TOLERANCE_PX
      ) {
        break;
      }

      for (const jointId of chain) {
        const pivot = solved.positions.get(jointId);
        const tip = solved.positions.get(input.jointId);
        if (!pivot || !tip) continue;

        const currentX = tip.x - pivot.x;
        const currentY = tip.y - pivot.y;
        const targetXOffset = input.targetX - pivot.x;
        const targetYOffset = input.targetY - pivot.y;
        if (
          Math.hypot(currentX, currentY) < EditorConstants.IK_MIN_LEVER_PX ||
          Math.hypot(targetXOffset, targetYOffset) < EditorConstants.IK_MIN_LEVER_PX
        ) {
          continue;
        }

        const currentAngle = (Math.atan2(currentY, currentX) * 180) / Math.PI;
        const targetAngle = (Math.atan2(targetYOffset, targetXOffset) * 180) / Math.PI;
        const step = clampStep(shortestDelta(targetAngle - currentAngle));

        const local = working[jointId] as JointPose;
        working[jointId] = { ...local, rot: (local.rot ?? 0) + step };
        // Re-solve after each joint: that is what makes this cyclic rather than a
        // batch of independent rotations, and it is why the chain converges
        // instead of overshooting once per link.
        solved = AniBuddyKernel.solve(input.rig, working);
      }
    }

    return working;
  },

  /**
   * Translate a joint outright, in figure-height fractions (R6).
   *
   * The path for the root, which has no ancestor to rotate. Also what a
   * hand-authored parallax layer uses: `tx` at a per-layer rate is the whole
   * motion model for the environment archetype (F9 §10.5).
   */
  translate(input: {
    pose: Pose;
    jointId: string;
    deltaX: number;
    deltaY: number;
    figureHeight: number;
  }): Pose {
    const local = input.pose[input.jointId] ?? {};
    return {
      ...input.pose,
      [input.jointId]: {
        ...local,
        tx: (local.tx ?? 0) + input.deltaX / input.figureHeight,
        ty: (local.ty ?? 0) + input.deltaY / input.figureHeight,
      },
    };
  },
} as const;
