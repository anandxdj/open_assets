// Free-form joint graph validation and the local structural checks that decide
// which motion templates are actually safe for a given rig.
import type { BodyPlanId, SubjectBounds } from "@/features/studio/lib/rig/rigCore";
import {
  type Joint,
  type CutLine,
  type JointRole,
  JOINT_ID_PATTERN,
  JOINT_ROLES,
  MAX_JOINT_DEPTH,
  MAX_JOINTS,
  MIN_JOINTS,
  type MotionId,
  type PreparedAsset,
  type Rig,
  type RigAnalysis,
  type RigAnalysisV3,
} from "@/features/anibuddy/types";
import { buildMesh, buildWeights } from "@/features/anibuddy/lib/mesh";

const ALPHA_FLOOR = 24;

/** Shared editor palette. Roles describe a graph, so their colour must not
 * depend on legacy joint ids or a particular body plan. */
const ROLE_COLORS: Record<JointRole, string> = {
  root: "#18181b",
  spine: "#7c3aed",
  head: "#ea580c",
  eye: "#eab308",
  jaw: "#f97316",
  limbUpper: "#0d9488",
  limbLower: "#0891b2",
  limbTip: "#2563eb",
  tail: "#db2777",
  wing: "#9333ea",
  ear: "#a16207",
  prop: "#4f46e5",
  other: "#71717a",
};

export function roleColor(role: JointRole): string {
  return ROLE_COLORS[role];
}

export class JointGraphError extends Error {}

/** Validate model-authored free-form joints. Structural errors are refused,
 * not repaired, because a plausible broken graph deforms silently. */
export function sanitizeJointGraph(
  proposed: Array<{ id: string; name?: string; role?: JointRole; x: number; y: number; parent: string | null }>,
  bounds: SubjectBounds,
  width: number,
  height: number,
): Joint[] {
  if (proposed.length < MIN_JOINTS) throw new JointGraphError("A rig needs at least three joints.");
  if (proposed.length > MAX_JOINTS) throw new JointGraphError("This rig has too many joints (max 48).");

  const ids = new Set<string>();
  for (const item of proposed) {
    if (!JOINT_ID_PATTERN.test(item.id) || ids.has(item.id)) {
      throw new JointGraphError(`Joint id "${item.id}" is invalid or duplicates another joint.`);
    }
    ids.add(item.id);
  }
  for (const item of proposed) {
    if (item.parent !== null && !ids.has(item.parent)) {
      throw new JointGraphError(`Joint "${item.id}" points at a missing parent.`);
    }
  }

  const roots = proposed.filter((item) => item.parent === null);
  if (roots.length !== 1) throw new JointGraphError("The joint graph needs exactly one root.");

  const byId = new Map(proposed.map((item) => [item.id, item]));
  for (const item of proposed) {
    let cursor: typeof item | undefined = item;
    let depth = 0;
    while (cursor?.parent) {
      cursor = byId.get(cursor.parent);
      if (++depth > proposed.length) {
        throw new JointGraphError(`Joint "${item.id}" is part of a loop.`);
      }
    }
    if (depth > MAX_JOINT_DEPTH) throw new JointGraphError(`Joint "${item.id}" is nested too deeply.`);
  }
  for (const item of proposed) {
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || item.x < 0 || item.x > 1 || item.y < 0 || item.y > 1) {
      throw new JointGraphError(`Joint "${item.id}" is outside the artwork.`);
    }
  }

  const subjectTop = Math.max(0, (bounds.baseline - bounds.height) / height);
  const subjectBottom = Math.min(1, bounds.baseline / height);
  return proposed.map((item) => ({
    id: item.id,
    name: item.name?.trim() || JOINT_LABELS[item.id] || item.id,
    role: JOINT_ROLES.includes(item.role ?? "other") ? item.role ?? "other" : "other",
    x: Math.min(1, Math.max(0, item.x)),
    y: Math.min(subjectBottom, Math.max(subjectTop, item.y)),
    parent: item.parent,
  }));
}

/** @deprecated fallback labels for legacy biped ids, not a graph whitelist. */
export const JOINT_LABELS: Record<string, string> = {
  hip: "Hips",
  torso: "Chest",
  neck: "Neck",
  head: "Head",
  eyeA: "Left eye",
  eyeB: "Right eye",
  shoulderA: "Left shoulder",
  elbowA: "Left elbow",
  handA: "Left hand",
  shoulderB: "Right shoulder",
  elbowB: "Right elbow",
  handB: "Right hand",
  kneeA: "Left knee",
  footA: "Left foot",
  kneeB: "Right knee",
  footB: "Right foot",
};

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function alphaBox(alpha: Uint8ClampedArray, width: number, height: number, box: Box) {
  let found = false;
  for (let y = Math.max(0, box.minY); y <= Math.min(height - 1, box.maxY) && !found; y++) {
    for (let x = Math.max(0, box.minX); x <= Math.min(width - 1, box.maxX); x++) {
      if (alpha[(y * width + x) * 4 + 3] > ALPHA_FLOOR) {
        found = true;
        break;
      }
    }
  }
  return found;
}

/**
 * Which templates this artwork can actually support, independent of what the
 * model claimed. A bad `supported` list must not be able to enable a motion the
 * pixels cannot carry — F9 §7 requires unsupported motions to be disclosed, not
 * silently attempted.
 */
export function localSupport(
  joints: Joint[],
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): { supported: MotionId[]; warnings: string[] } {
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const warnings: string[] = [];

  // idle and bounce move the whole figure, so they need nothing beyond a rig.
  const supported: MotionId[] = ["idle", "bounce"];

  // wave needs arm pixels that are separable from the torso. Sample a band just
  // outside the shoulder: if it is empty, the arm is drawn merged into the body
  // and rotating it would tear the torso.
  const shoulder = byId.get("shoulderA");
  const hand = byId.get("handA");
  const torso = byId.get("torso");
  if (shoulder && hand && torso) {
    const armSpan = Math.abs(hand.x - shoulder.x) + Math.abs(hand.y - shoulder.y);
    const outward = shoulder.x <= torso.x ? -1 : 1;
    const probeX = Math.round((shoulder.x + outward * 0.04) * width);
    const bandHalf = Math.round(0.05 * height);
    const centreY = Math.round(((shoulder.y + hand.y) / 2) * height);
    const hasArmPixels = alphaBox(alpha, width, height, {
      minX: probeX - 2,
      maxX: probeX + 2,
      minY: centreY - bandHalf,
      maxY: centreY + bandHalf,
    });

    if (hasArmPixels && armSpan > 0.08) {
      supported.push("wave");
    } else {
      warnings.push(
        "Wave is unavailable: this artwork has no arm that reads separately from the body. Move the shoulder, elbow and hand joints onto a visible arm to enable it.",
      );
    }
  } else {
    warnings.push("Wave is unavailable: this rig has no arm joints.");
  }

  // blink needs eye joints sitting on head pixels.
  const head = byId.get("head");
  const eyeA = byId.get("eyeA");
  const eyeB = byId.get("eyeB");
  if (head && eyeA && eyeB) {
    const radius = Math.hypot(eyeA.x - head.x, eyeA.y - head.y);
    const eyeOnPixels = [eyeA, eyeB].every((eye) => {
      const px = Math.round(eye.x * width);
      const py = Math.round(eye.y * height);
      return alphaBox(alpha, width, height, {
        minX: px - 1,
        maxX: px + 1,
        minY: py - 1,
        maxY: py + 1,
      });
    });

    if (eyeOnPixels && radius < 0.25) {
      supported.push("blink");
    } else {
      warnings.push(
        "Blink is unavailable: the eye markers are not sitting on the character's face. Drag them onto the eyes to enable it.",
      );
    }
  } else {
    warnings.push("Blink is unavailable: this rig has no eye markers.");
  }

  return { supported, warnings };
}

/** Openers of the warnings `localSupport` writes, so a re-derive can replace its
 *  own stale text without discarding what the model reported. */
const LOCAL_WARNING_PREFIXES = ["Wave is unavailable", "Blink is unavailable"];

/**
 * Re-derive template support from the joints as they now stand.
 *
 * Joint drags change the answer: dragging the eye markers onto the face should
 * enable blink, and moving them off it should take blink away again. The model's
 * own warnings are preserved — only the locally-generated ones are refreshed.
 */
export function applyLocalSupport(
  rig: Rig,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): Rig {
  const local = localSupport(rig.joints, alpha, width, height);
  const kept = rig.warnings.filter(
    (warning) => !LOCAL_WARNING_PREFIXES.some((prefix) => warning.startsWith(prefix)),
  );
  return {
    ...rig,
    supported: local.supported,
    warnings: [...local.warnings, ...kept],
  };
}

/** Assemble a complete rig: validated joints, derived mesh, derived weights. */
export function buildRig(
  analysis: RigAnalysis | RigAnalysisV3 | null,
  prepared: PreparedAsset,
  alpha: Uint8ClampedArray,
  fallbackBodyPlan: BodyPlanId = "biped",
): Rig {
  const proposed = Array.isArray(analysis?.joints) ? analysis.joints : [];
  const joints = sanitizeJointGraph(
    proposed as RigAnalysisV3["joints"],
    prepared.bounds,
    prepared.width,
    prepared.height,
  );
  const cuts: CutLine[] = [];
  const mesh = buildMesh(alpha, prepared.width, prepared.height, cuts);
  const weights = buildWeights(mesh, joints, cuts);
  const local = localSupport(joints, alpha, prepared.width, prepared.height);

  // Intersect: the model can veto a template, but it cannot grant one the
  // pixels do not support.
  const claimed = analysis?.supported;
  const supported = Array.isArray(claimed)
    ? local.supported.filter((motion) => claimed.includes(motion))
    : local.supported;

  const modelWarnings = Array.isArray(analysis?.warnings)
    ? analysis.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    bodyPlan: analysis?.bodyPlan ?? fallbackBodyPlan,
    joints,
    mesh,
    weights,
    cuts,
    supported,
    warnings: [...local.warnings, ...modelWarnings],
    source: analysis ? "model" : "edited",
  };
}

/** Recompute weights after joints move. Mesh topology is unaffected by drags. */
export function rebindWeights(rig: Rig): Rig {
  return { ...rig, weights: buildWeights(rig.mesh, rig.joints, rig.cuts), source: "edited" };
}
