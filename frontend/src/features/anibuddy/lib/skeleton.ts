// Free-form joint graph validation and the local structural checks that decide
// which motion templates are actually safe for a given rig.
import type { SubjectBounds } from "@/features/studio/lib/rig/rigCore";
import {
  type Joint,
  type CutLine,
  type JointRole,
  JOINT_ID_PATTERN,
  JOINT_ROLES,
  MAX_JOINT_DEPTH,
  MAX_JOINTS,
  MIN_JOINTS,
  type PreparedAsset,
  type Rig,
  type RigAnalysis,
} from "@/features/anibuddy/types";
import { buildMesh, buildWeights } from "@/features/anibuddy/lib/mesh";

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

/** Assemble a complete rig: validated joints, derived mesh, derived weights. */
export function buildRig(
  analysis: RigAnalysis | null,
  prepared: PreparedAsset,
  alpha: Uint8ClampedArray,
): Rig {
  const proposed = Array.isArray(analysis?.joints) ? analysis.joints : [];
  const joints = sanitizeJointGraph(
    proposed as RigAnalysis["joints"],
    prepared.bounds,
    prepared.width,
    prepared.height,
  );
  const cuts: CutLine[] = [];
  const mesh = buildMesh(alpha, prepared.width, prepared.height, cuts);
  const weights = buildWeights(mesh, joints, cuts);


  const modelWarnings = Array.isArray(analysis?.warnings)
    ? analysis.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];

  return {
    joints,
    mesh,
    weights,
    cuts,
    warnings: modelWarnings,
    source: analysis ? "model" : "edited",
  };
}

/** Recompute weights after joints move. Mesh topology is unaffected by drags. */
export function rebindWeights(rig: Rig): Rig {
  return { ...rig, weights: buildWeights(rig.mesh, rig.joints, rig.cuts), source: "edited" };
}
