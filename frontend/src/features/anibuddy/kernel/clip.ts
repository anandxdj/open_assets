// Keyframe interpolation.
//
// Ported from lib/clip.ts `poseAt`.
//
// Poses are sparse in two dimensions at once: a keyframe names only the joints
// it moves, and a named joint carries only the channels it changes. Both kinds
// of absence resolve to REST, not to "hold the neighbouring value" -- a key that
// only sets `rot` must not pin `scale` to whatever the previous key happened to
// leave it at.
//
// The same is true of PARTS, and identically so. `bracket` and `blend` are
// shared by `poseAt` and `partPoseAt` rather than written twice, because a part
// and a joint keyed on the same clip must resolve at the same instant, with the
// same easing, against the same rest values. Two copies of that rule would be
// two chances to disagree about it.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/clip.py.

import { KernelConstants } from "./constants";
import type {
  Clip,
  EaseKind,
  JointPose,
  Keyframe,
  PartPoseMap,
  Pose,
  PoseChannel,
} from "./types";

/** The two keys around a sample time, and the eased progress between them. */
export interface Bracket {
  before: Keyframe;
  after: Keyframe | null;
  u: number;
}

/**
 * The only two fields the bracketing search reads off a keyframe.
 *
 * Declared structurally rather than as the kernel's own `Keyframe` because the
 * compositing channels are sampled from the WIRE `Keyframe` by the editor,
 * which is a different type carrying the same two fields. One structural
 * contract is what lets both call `PoseTrack.bracketIndex` instead of each
 * keeping a copy of the search -- and a copy is exactly how a part's opacity
 * and its rotation, sampled from the same clip, end up on different keys.
 */
export interface BracketableKey {
  readonly t: number;
  readonly ease?: EaseKind;
}

/**
 * Which two keys surround a time, and how far between them it sits.
 *
 * Indices rather than keyframes so the caller can index into whichever keyframe
 * type it holds. `wrapped` marks the looping case, where `afterIndex` is key 0
 * read one full cycle later -- the caller needs to know that to report the
 * after key's time, and nothing else about it differs.
 */
export interface KeyBracket {
  beforeIndex: number;
  afterIndex: number | null;
  u: number;
  wrapped: boolean;
}

/** Shared empty record, so an unset `Keyframe.parts` needs no allocation. */
const EMPTY_PART_POSE: PartPoseMap = Object.freeze({});

export const PoseTrack = {
  /** Rest for a channel: 1 for `scale`, 0 for everything else. */
  restValue(channel: PoseChannel): number {
    return channel === "scale" ? KernelConstants.REST_SCALE : KernelConstants.REST_DEFAULT;
  },

  /**
   * Map normalized segment progress through the easing curve.
   *
   * `hold` returns 0 for the whole segment, so the pose stays on the starting
   * key and snaps at the next one -- that is what makes stepped animation
   * possible without a separate keyframe type.
   *
   * An absent `ease` is smoothstep, not linear. That is the v3 default and
   * changing it would silently re-time every existing clip.
   */
  ease(u: number, kind: EaseKind | undefined): number {
    if (kind === "linear") return u;
    if (kind === "hold") return 0;
    return u * u * (3 - 2 * u);
  },

  /**
   * The two keys bracketing `t`, plus eased progress between them.
   *
   * THE bracketing search. Every channel of every kind -- a joint's `rot`, a
   * part's `scale`, a part's `opacity`, its `visible`, its `zIndex`, its
   * `swapTo` -- resolves through this one function, in both the browser and the
   * server. That is not tidiness: a part's opacity and its rotation, sampled
   * from the same clip at the same instant by two different modules, must land
   * on the same pair of keys, and the only way to guarantee that is for there
   * to be one search.
   *
   * Indices rather than keyframes because the geometry channels are sampled
   * from the kernel's own `Keyframe` and the compositing channels from the WIRE
   * `Keyframe`. The two carry the same `t` and `ease` and nothing else this
   * function reads, so it is typed on that pair alone.
   *
   * The search walks the keyframes in order rather than binary-searching,
   * matching the Python kernel exactly: `before` is the last key at or before
   * t, `after` the first strictly after it, both compared with
   * KEYFRAME_EPSILON slack so a key authored at 0.3 is actually reachable at
   * t = 0.3.
   *
   * A looping clip with no key after t closes back onto key 0, read one full
   * cycle later, which lets the artist skip authoring a duplicate final key.
   * `wrapped` marks that case; the returned `afterIndex` is 0 and `u` already
   * accounts for the extra cycle in the span.
   */
  bracketIndex(keys: readonly BracketableKey[], loop: boolean, time: number): KeyBracket {
    const t = Math.max(0, Math.min(1, time));
    let beforeIndex = 0;
    let afterIndex: number | null = null;
    for (let index = 0; index < keys.length; index++) {
      if (keys[index].t <= t + KernelConstants.KEYFRAME_EPSILON) beforeIndex = index;
      if (keys[index].t > t + KernelConstants.KEYFRAME_EPSILON) {
        afterIndex = index;
        break;
      }
    }

    const beforeT = keys[beforeIndex].t;
    let wrapped = false;
    let afterT: number;
    if (afterIndex !== null) {
      afterT = keys[afterIndex].t;
    } else if (loop && keys.length > 1) {
      afterIndex = 0;
      afterT = keys[0].t + 1;
      wrapped = true;
    } else {
      return { beforeIndex, afterIndex: null, u: 0, wrapped: false };
    }

    const span = afterT - beforeT;
    const u =
      span <= KernelConstants.KEYFRAME_EPSILON
        ? 0
        : PoseTrack.ease((t - beforeT) / span, keys[beforeIndex].ease);
    return { beforeIndex, afterIndex, u, wrapped };
  },

  /**
   * `bracketIndex` resolved into the kernel's own keyframes.
   *
   * A thin adapter, not a second search. The looping case is materialized as a
   * copy of key 0 moved to t + 1 so a caller reading `after.t` sees the instant
   * the blend actually ran to; the copy carries key 0's PARTS as well as its
   * joints, so a part and a joint keyframed together wrap together.
   */
  bracket(clip: Clip, time: number): Bracket {
    const keys = clip.keyframes;
    const found = PoseTrack.bracketIndex(keys, clip.loop, time);
    const before = keys[found.beforeIndex];
    if (found.afterIndex === null) return { before, after: null, u: found.u };
    const after = keys[found.afterIndex];
    if (!found.wrapped) return { before, after, u: found.u };
    return {
      before,
      after: { t: after.t + 1, joints: after.joints, parts: after.parts, ease: after.ease },
      u: found.u,
    };
  },

  /**
   * Per-channel blend of two sparse pose records.
   *
   * Shared verbatim by the joint and the part channels, which is what makes
   * their sparsity rules identical by construction rather than by review: a
   * channel absent from one side blends against REST, never against the other
   * side's value.
   */
  blend(startMap: Pose, endMap: Pose, u: number): Pose {
    // Union of ids in first-seen order: `startMap` first, then any id only
    // `endMap` touches. Order does not affect the numbers -- the consumers walk
    // the skeleton and the part tree, not the pose -- but keeping it identical
    // to the Python kernel keeps serialized poses diffable.
    const ids: string[] = Object.keys(startMap);
    const seen = new Set(ids);
    for (const targetId of Object.keys(endMap)) {
      if (!seen.has(targetId)) {
        seen.add(targetId);
        ids.push(targetId);
      }
    }

    const pose: Pose = {};
    for (const targetId of ids) {
      const start = startMap[targetId];
      const end = endMap[targetId];
      const values: JointPose = {};
      let touched = false;
      for (const channel of KernelConstants.POSE_CHANNELS) {
        const startValue = start === undefined ? undefined : start[channel];
        const endValue = end === undefined ? undefined : end[channel];
        if (startValue === undefined && endValue === undefined) continue;
        const rest = PoseTrack.restValue(channel);
        const a = startValue === undefined ? rest : startValue;
        const b = endValue === undefined ? rest : endValue;
        // Written as a + (b - a) * u, not (1 - u) * a + u * b. The two differ in
        // the last bit and the Python kernel uses this form.
        values[channel] = a + (b - a) * u;
        touched = true;
      }
      if (touched) pose[targetId] = values;
    }
    return pose;
  },

  /** Resolve a clip to its sparse local JOINT pose at normalized time. */
  poseAt(clip: Clip, time: number): Pose {
    if (clip.keyframes.length === 0) return {};
    const { before, after, u } = PoseTrack.bracket(clip, time);
    if (after === null) return { ...before.joints };
    return PoseTrack.blend(before.joints, after.joints, u);
  },

  /**
   * Resolve a clip to its sparse local PART pose at normalized time.
   *
   * The geometry channels only -- `rot`, `tx`, `ty`, `scale`. The wire's other
   * four PartPose channels (`visible`, `opacity`, `zIndex`, `swapTo`) are
   * compositing, are resolved by ../editor/part-track.ts, and never reach the
   * kernel; see types.ts PartPose. Both halves call `bracketIndex`, so they
   * cannot land on different keys.
   *
   * Deliberately a mirror of poseAt down to the early return, because the
   * symmetry IS the contract: absent means REST for a part exactly as it does
   * for a joint, and the two bracket through the same function.
   */
  partPoseAt(clip: Clip, time: number): PartPoseMap {
    if (clip.keyframes.length === 0) return {};
    const { before, after, u } = PoseTrack.bracket(clip, time);
    if (after === null) return { ...(before.parts ?? EMPTY_PART_POSE) };
    return PoseTrack.blend(before.parts ?? EMPTY_PART_POSE, after.parts ?? EMPTY_PART_POSE, u);
  },

  /**
   * Sample a clip once per frame, preserving loop continuity.
   *
   * A looping clip samples i / count so the last frame is one step short of the
   * start and the wrap is seamless; a one-shot samples i / (count - 1) so it
   * actually reaches its final key.
   */
  sample(clip: Clip, frameCount: number): Pose[] {
    const count = Math.max(2, Math.trunc(frameCount));
    return Array.from({ length: count }, (_unused, index) =>
      PoseTrack.poseAt(clip, clip.loop ? index / count : index / (count - 1)),
    );
  },
} as const;
