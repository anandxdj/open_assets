// Per-frame skeleton drive data for the four v1 motion templates.
//
// Every table is in the SAME conventions as `features/studio/lib/rig/biped.ts`
// so the studio's own pose tables stay interchangeable with the ones authored
// here:
//   - limb angles are measured from straight DOWN, positive = swung forward
//   - `bodyY` is a vertical offset as a fraction of figure height, + = up
//   - `lean` / `headTilt` are degrees from vertical, + = forward
//
// The renderer never uses these as absolute poses. It takes frame 0 of the
// table as the reference and applies every later frame as a DELTA from it, so
// the artwork keeps whatever rest pose the artist drew instead of being snapped
// onto a mannequin. See lib/deform.ts.
import type { BodyPlanId } from "@/features/studio/lib/rig/rigCore";
import type { FramePose } from "@/features/studio/lib/rig/biped";
import { RIGS } from "@/features/studio/lib/rig/poseRig";
import { MAX_FRAMES, type MotionId } from "@/features/anibuddy/types";

/**
 * A `FramePose` plus the one channel a puppet needs and a mannequin does not.
 * `eyeOpen` is a vertical scale about the eye joints: 1 open, 0 shut.
 */
export interface AniFrame extends FramePose {
  eyeOpen?: number;
}

export const MOTION_META: Record<MotionId, { label: string; blurb: string }> = {
  idle: {
    label: "Idle",
    blurb: "A quiet breathing loop. Works on any rig.",
  },
  bounce: {
    label: "Bounce",
    blurb: "The whole figure rises and crouches, knees bending under it.",
  },
  wave: {
    label: "Wave",
    blurb: "One arm lifts and waves. Needs an arm drawn clear of the body.",
  },
  blink: {
    label: "Blink",
    blurb: "The eyes close and open. Needs visible eyes.",
  },
};

function frame(
  lean: number,
  bodyY: number,
  legBase: number,
  legFlex: number,
  armBase: number,
  armFlex: number,
  extra: Partial<AniFrame> = {},
): AniFrame {
  // Both sides carry identical values. AniBuddy art is front-facing, so the
  // renderer mirrors the A side; identical values therefore read as a
  // symmetric motion rather than as both limbs sliding the same way.
  return {
    lean,
    bodyY,
    legA: { base: legBase, flex: legFlex },
    legB: { base: legBase, flex: legFlex },
    armA: { base: armBase, flex: armFlex },
    armB: { base: armBase, flex: armFlex },
    ...extra,
  };
}

/** Whole-body rise and crouch. Shaped after `biped.ts`'s JUMP curve, retimed so
 *  the last frame flows back into the first. */
const BOUNCE: AniFrame[] = [
  frame(2, 0.0, 4, 10, -4, 15, { headTilt: 0 }),
  frame(0, 0.045, 4, 4, -10, 14, { headTilt: -2 }),
  frame(-1, 0.065, 4, 2, -14, 13, { headTilt: -3 }),
  frame(0, 0.045, 4, 4, -10, 14, { headTilt: -2 }),
  frame(2, 0.0, 4, 12, -4, 15, { headTilt: 0 }),
  frame(5, -0.045, 4, 30, 6, 18, { headTilt: 2 }),
  frame(7, -0.065, 4, 42, 10, 20, { headTilt: 3 }),
  frame(4, -0.03, 4, 26, 4, 17, { headTilt: 1 }),
];

/** Only the A-side arm moves; everything else holds a neutral stance so the
 *  motion reads as a wave rather than as a whole-body wobble. */
const WAVE: AniFrame[] = [
  frame(3, 0, 4, 11, -4, 15, { armA: { base: -4, flex: 15 } }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 60, flex: 30 } }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 130, flex: 45 } }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 150, flex: 25 }, headTilt: -2 }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 150, flex: 55 }, headTilt: -2 }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 150, flex: 25 }, headTilt: -2 }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 110, flex: 40 } }),
  frame(3, 0, 4, 11, -4, 15, { armA: { base: 30, flex: 22 } }),
];

/** A held pose plus the `eyeOpen` channel. The body drifts very slightly so the
 *  frame does not look frozen between blinks. */
const BLINK: AniFrame[] = [
  frame(3, 0, 4, 11, -4, 15, { eyeOpen: 1, headTilt: 0 }),
  frame(3, 0.002, 4, 11, -4, 15, { eyeOpen: 1, headTilt: -1 }),
  frame(3, 0.003, 4, 11, -4, 15, { eyeOpen: 0.55, headTilt: -1 }),
  frame(3, 0.003, 4, 11, -4, 15, { eyeOpen: 0.08, headTilt: -1 }),
  frame(3, 0.002, 4, 11, -4, 15, { eyeOpen: 0.55, headTilt: -1 }),
  frame(3, 0.001, 4, 11, -4, 15, { eyeOpen: 1, headTilt: 0 }),
  frame(3, 0, 4, 11, -4, 15, { eyeOpen: 1, headTilt: 1 }),
  frame(3, 0, 4, 11, -4, 15, { eyeOpen: 1, headTilt: 0 }),
];

function isFramePose(value: unknown): value is FramePose {
  const candidate = value as FramePose | null;
  return (
    !!candidate &&
    typeof candidate.lean === "number" &&
    typeof candidate.bodyY === "number" &&
    !!candidate.legA &&
    !!candidate.armA
  );
}

/**
 * The studio's own idle table, used verbatim.
 *
 * Every AniBuddy rig is built on the biped joint tree (`skeleton.ts` PARENTS),
 * so a quadruped or serpent pose — a different `FramePose` shape with no `armA`
 * — has no joints here to drive. Body plan is still recorded on the rig and
 * reported to the user; when its table does not fit, the biped one runs instead
 * of the figure silently freezing.
 */
function idleTable(bodyPlan: BodyPlanId): AniFrame[] {
  const claimed = (RIGS[bodyPlan] ?? RIGS.biped).getFrames("idle");
  const usable = claimed.filter(isFramePose);
  return usable.length > 0 ? usable : (RIGS.biped.getFrames("idle") as FramePose[]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPose(a: AniFrame, b: AniFrame, t: number): AniFrame {
  if (t <= 0) return a;
  return {
    lean: lerp(a.lean, b.lean, t),
    bodyY: lerp(a.bodyY, b.bodyY, t),
    legA: { base: lerp(a.legA.base, b.legA.base, t), flex: lerp(a.legA.flex, b.legA.flex, t) },
    legB: { base: lerp(a.legB.base, b.legB.base, t), flex: lerp(a.legB.flex, b.legB.flex, t) },
    armA: { base: lerp(a.armA.base, b.armA.base, t), flex: lerp(a.armA.flex, b.armA.flex, t) },
    armB: { base: lerp(a.armB.base, b.armB.base, t), flex: lerp(a.armB.flex, b.armB.flex, t) },
    headTilt: lerp(a.headTilt ?? 0, b.headTilt ?? 0, t),
    eyeOpen: lerp(a.eyeOpen ?? 1, b.eyeOpen ?? 1, t),
  };
}

/**
 * Resample an 8-frame table to the requested frame count, wrapping so the last
 * frame flows into the first. Interpolating rather than repeating means a
 * 24-frame export is genuinely smoother than an 8-frame one instead of being
 * the same eight poses held longer.
 */
function resample(table: AniFrame[], frameCount: number): AniFrame[] {
  const count = Math.max(2, Math.min(MAX_FRAMES, Math.round(frameCount)));
  const frames: AniFrame[] = [];
  for (let i = 0; i < count; i++) {
    const position = (i / count) * table.length;
    const index = Math.floor(position);
    frames.push(
      lerpPose(table[index % table.length], table[(index + 1) % table.length], position - index),
    );
  }
  return frames;
}

/** Frame 0 of the table, which the renderer treats as the artwork's rest pose. */
export function referencePose(bodyPlan: BodyPlanId, motion: MotionId): AniFrame {
  return baseTable(bodyPlan, motion)[0];
}

function baseTable(bodyPlan: BodyPlanId, motion: MotionId): AniFrame[] {
  switch (motion) {
    case "bounce":
      return BOUNCE;
    case "wave":
      return WAVE;
    case "blink":
      return BLINK;
    case "idle":
    default:
      return idleTable(bodyPlan);
  }
}

export function getFramePoses(
  bodyPlan: BodyPlanId,
  motion: MotionId,
  frameCount: number,
): AniFrame[] {
  return resample(baseTable(bodyPlan, motion), frameCount);
}
