// Server-side revalidation of everything the response schema claims (F9 §11.4).
//
// The provider's strict schema is the first gate and it is a good one, but it can
// only check shape. Three things it cannot check are exactly the three that make
// a proposal dangerous:
//
// 1. **Whether an id resolves against THIS revision.** A model working from a
//    stale document sends plausible ids that name nothing. That rejects the whole
//    response, not the one correction — a stale premise makes every other answer
//    in the same response suspect.
// 2. **Whether a number is a rounding artifact or a unit misunderstanding.** The
//    band below clamps the first and refuses the second. The asymmetry is the
//    load-bearing rule in this file: a value 3% past a bound loses nothing by
//    being clamped, and a value 5x past it means the model answered in pixels.
// 3. **Whether the resulting graph is still a tree.** Single root, acyclic, depth
//    capped. Checked after every id resolves, because two individually-valid
//    parent edges can close a cycle together.
//
// Refuse rather than repair (R7). Every function here returns the whole value or
// one rejection sentence; there is no partial-proposal path. A rig with half a
// proposal applied looks deliberate and animates wrongly, which is strictly worse
// for the user than a refusal they can act on.
//
// The same band, with the same tolerance, is implemented once more in
// py_backend's `vision/corrections.py`. That is not a fork: the two boundaries
// validate the same numbers at different points in the pipeline, Node cannot
// reach into the document's masks and Python does not hold the provider chain.
// `ProposalConstants.clampTolerance` and `VisionConstants.CLAMP_TOLERANCE` must
// agree, and a test asserts the Node value rather than trusting this comment.

import type {
  Archetype,
  Correction,
  CorrectionKind,
  CritiqueReport,
  DeformerKind,
  Ease,
  JointPose,
  JointRole,
  Keyframe,
  MotionProposal,
  PartPose,
  PartRole,
  ProposedJointSemantics,
  ProposedPartSemantics,
  SemanticsProposal,
} from "../rig/index.rig";
import {
  ARCHETYPE_VALUES,
  CORRECTION_KIND_VALUES,
  DEFORMER_KIND_VALUES,
  EASE_VALUES,
  JOINT_ROLE_VALUES,
  PART_ROLE_VALUES,
} from "../rig/index.rig";
import { ProposalConstants } from "./proposal.constants";
import type {
  CritiqueCallInput,
  MotionCallInput,
  PartLegendEntry,
  Revalidation,
  WireJointChannels,
  WireKeyframe,
  WirePartChannels,
} from "./proposal.types";

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

class Rejection extends Error {}

function reject(reason: string): never {
  throw new Rejection(reason);
}

/** Run a validator, turning its rejection into a result instead of a throw. */
function attempt<T>(build: (warn: (message: string) => void) => T): Revalidation<T> {
  const warnings: string[] = [];
  try {
    const value = build((message) => {
      if (!warnings.includes(message)) warnings.push(message);
    });
    return { ok: true, value, warnings };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * One number through the §11.4 band. Clamps inside the tolerance, rejects outside.
 *
 * The tolerance is a fraction of the bound's own SPAN, so the same rule reads
 * sensibly on `[-0.08, 0.08]` and on `[0.05, 4]` without either needing a
 * hand-picked epsilon of its own. This is the only place the band is
 * implemented on the Node side.
 */
export function clampOrReject(
  value: unknown,
  low: number,
  high: number,
  label: string,
  warn: (message: string) => void,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) reject(`${label} was not a finite number.`);
  if (numeric >= low && numeric <= high) return numeric;

  const slack = Math.abs(high - low) * ProposalConstants.clampTolerance;
  const percent = Math.round(ProposalConstants.clampTolerance * 100);
  if (numeric < low - slack || numeric > high + slack) {
    reject(
      `${label} was ${numeric}, more than ${percent}% outside its ${low}..${high} range. ` +
        "That is a unit misunderstanding rather than a rounding error, so the whole response was rejected.",
    );
  }
  const clamped = numeric < low ? low : high;
  warn(`${label} was ${numeric} and was clamped to ${clamped}.`);
  return clamped;
}

function requireId(value: unknown, label: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    reject(`${label} must be 1-32 characters of letters, numbers, _ or -.`);
  }
  return id;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireId(value, label);
}

function requireMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  const text = typeof value === "string" ? value.trim() : "";
  if (!(allowed as readonly string[]).includes(text)) {
    reject(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return text as T;
}

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, cap);
}

/**
 * Walk a parent map, refusing on a cycle or an over-deep chain.
 *
 * Iterative and step-capped rather than recursive, so a cycle terminates in
 * bounded time instead of on a stack overflow — the same guard the v3
 * rig-analysis route applies to a proposed joint graph.
 */
function assertAcyclic(
  parentOf: Map<string, string | null>,
  cap: number,
  label: string,
): void {
  for (const id of parentOf.keys()) {
    const seen = new Set<string>([id]);
    let cursor = parentOf.get(id) ?? null;
    let depth = 0;
    while (cursor !== null) {
      if (!parentOf.has(cursor)) reject(`${label} "${id}" is parented to unknown "${cursor}".`);
      if (seen.has(cursor)) reject(`${label} "${id}" sits in a parent cycle.`);
      seen.add(cursor);
      depth += 1;
      if (depth > cap) {
        reject(`${label} "${id}" sits ${depth} links deep, past the ${cap}-link cap.`);
      }
      cursor = parentOf.get(cursor) ?? null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantics
// ─────────────────────────────────────────────────────────────────────────────

function semanticsPart(
  raw: unknown,
  legend: Map<string, PartLegendEntry>,
  seen: Set<string>,
  warn: (message: string) => void,
): ProposedPartSemantics {
  if (!raw || typeof raw !== "object") reject("Every proposed part must be an object.");
  const input = raw as Record<string, unknown>;

  const partId = requireId(input.partId, "A proposed part id");
  if (!legend.has(partId)) {
    reject(
      `Part "${partId}" is not one of the numbered parts on the sheet. Use only the ids from the legend.`,
    );
  }
  if (seen.has(partId)) reject(`Part "${partId}" appears twice in the proposal.`);
  seen.add(partId);

  const parentPartId = optionalId(input.parentPartId, `Part "${partId}"'s parent`);
  if (parentPartId !== null && !legend.has(parentPartId)) {
    reject(`Part "${partId}" is parented to unknown part "${parentPartId}".`);
  }
  if (parentPartId === partId) reject(`Part "${partId}" is parented to itself.`);

  const hint = input.pivotHint;
  if (!hint || typeof hint !== "object") {
    reject(`Part "${partId}" must carry a pivotHint with x and y.`);
  }
  const pivot = hint as Record<string, unknown>;

  return {
    partId,
    role: requireMember<PartRole>(input.role, PART_ROLE_VALUES, `Part "${partId}"'s role`),
    parentPartId,
    // A slot name, not an id — the parent has to OFFER it, and the rig stage is
    // what knows which slots exist. Carried through and validated there.
    attachSlot: optionalId(input.attachSlot, `Part "${partId}"'s attach slot`),
    pivotHint: {
      x: clampOrReject(pivot.x, 0, 1, `Part "${partId}"'s pivotHint x`, warn),
      y: clampOrReject(pivot.y, 0, 1, `Part "${partId}"'s pivotHint y`, warn),
    },
    zIndex: Math.round(
      clampOrReject(input.zIndex, -512, 512, `Part "${partId}"'s zIndex`, warn),
    ),
    deformerHint: requireMember<DeformerKind>(
      input.deformerHint,
      DEFORMER_KIND_VALUES,
      `Part "${partId}"'s deformerHint`,
    ),
    confidence: clampOrReject(
      input.confidence,
      0,
      1,
      `Part "${partId}"'s confidence`,
      warn,
    ),
  };
}

function semanticsJoint(
  raw: unknown,
  legend: Map<string, PartLegendEntry>,
  seen: Set<string>,
  warn: (message: string) => void,
): ProposedJointSemantics {
  if (!raw || typeof raw !== "object") reject("Every proposed joint must be an object.");
  const input = raw as Record<string, unknown>;

  const jointId = requireId(input.jointId, "A proposed joint id");
  if (seen.has(jointId)) reject(`Joint "${jointId}" appears twice in the proposal.`);
  seen.add(jointId);

  const partId = optionalId(input.partId, `Joint "${jointId}"'s part`);
  if (partId !== null && !legend.has(partId)) {
    reject(`Joint "${jointId}" binds to unknown part "${partId}".`);
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80) reject(`Joint "${jointId}" needs a name of 1-80 characters.`);

  return {
    jointId,
    name,
    role: requireMember<JointRole>(
      input.role,
      JOINT_ROLE_VALUES,
      `Joint "${jointId}"'s role`,
    ),
    partId,
    parent: optionalId(input.parent, `Joint "${jointId}"'s parent`),
    // Sheet-normalized (R6). Advisory: the rig stage rejects a joint that lands
    // on transparent pixels, which is a check only the mask can make.
    x: clampOrReject(input.x, 0, 1, `Joint "${jointId}"'s x`, warn),
    y: clampOrReject(input.y, 0, 1, `Joint "${jointId}"'s y`, warn),
  };
}

/**
 * Revalidate a semantics proposal against the legend that was drawn on the sheet.
 *
 * The legend is what makes the numbered overlay safe. The model reasons about
 * numbers and answers with ids; anything not in the legend is refused, so an
 * off-by-one in the annotator cannot silently reassign a role.
 */
export function revalidateSemantics(
  raw: Record<string, unknown> | null,
  legend: PartLegendEntry[],
): Revalidation<SemanticsProposal> {
  return attempt((warn) => {
    if (!raw) reject("The response did not contain a JSON object.");
    const byId = new Map(legend.map((entry) => [entry.partId, entry]));

    if (!Array.isArray(raw.parts) || raw.parts.length === 0) {
      reject("The proposal must contain a non-empty parts array.");
    }
    if (raw.parts.length > ProposalConstants.maxParts) {
      reject(`A proposal may describe at most ${ProposalConstants.maxParts} parts.`);
    }

    const seenParts = new Set<string>();
    const parts = raw.parts.map((entry) => semanticsPart(entry, byId, seenParts, warn));

    const missing = legend.filter((entry) => !seenParts.has(entry.partId));
    if (missing.length > 0) {
      // A warning rather than a rejection. A part the model could not classify is
      // a real answer, and the rig stage has a geometric prior for it — refusing
      // the whole proposal over one unclassifiable accessory would throw away
      // the other sixty-three.
      warn(
        `The proposal did not classify ${missing.length} part(s): ` +
          `${missing.map((entry) => entry.partId).join(", ")}. They keep their geometric prior.`,
      );
    }

    const seenJoints = new Set<string>();
    const rawJoints = Array.isArray(raw.joints) ? raw.joints : [];
    if (rawJoints.length > ProposalConstants.maxJoints) {
      reject(`A proposal may describe at most ${ProposalConstants.maxJoints} joints.`);
    }
    const joints = rawJoints.map((entry) => semanticsJoint(entry, byId, seenJoints, warn));

    // Part tree: acyclic and depth-capped. Multiple roots are legal here —
    // `environment` is flat by design and every layer is a root part (F9 §10.5).
    assertAcyclic(
      new Map(parts.map((part) => [part.partId, part.parentPartId])),
      ProposalConstants.maxPartDepth,
      "Part",
    );

    if (joints.length > 0) {
      const jointParents = new Map(joints.map((joint) => [joint.jointId, joint.parent]));
      assertAcyclic(jointParents, ProposalConstants.maxJointDepth, "Joint");
      const roots = joints.filter((joint) => joint.parent === null);
      if (roots.length !== 1) {
        reject(
          `The proposed skeleton must have exactly one parent:null root; this one has ${roots.length}.`,
        );
      }
    }

    return {
      archetype: requireMember<Archetype>(
        raw.archetype,
        ARCHETYPE_VALUES,
        "The archetype",
      ),
      parts,
      joints,
      warnings: stringList(raw.warnings, ProposalConstants.maxWarnings),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fold a nullable-channel wire pose into the sparse pose the schema declares.
 *
 * Null becomes ABSENT, not zero. That is the whole point of §7.7's sparsity
 * rule: a key that mentions only the tail must not snap every other joint, and a
 * pose full of explicit zeros does exactly that.
 */
function jointPose(
  raw: WireJointChannels,
  label: string,
  warn: (message: string) => void,
): JointPose {
  const pose: JointPose = {};
  if (raw.rot !== null && raw.rot !== undefined) {
    pose.rot = clampOrReject(raw.rot, -180, 180, `${label} rot`, warn);
  }
  if (raw.tx !== null && raw.tx !== undefined) {
    pose.tx = clampOrReject(raw.tx, -1, 1, `${label} tx`, warn);
  }
  if (raw.ty !== null && raw.ty !== undefined) {
    pose.ty = clampOrReject(raw.ty, -1, 1, `${label} ty`, warn);
  }
  if (raw.scale !== null && raw.scale !== undefined) {
    pose.scale = clampOrReject(raw.scale, 0.05, 4, `${label} scale`, warn);
  }
  return pose;
}

function partPose(
  raw: WirePartChannels,
  knownParts: Set<string>,
  label: string,
  warn: (message: string) => void,
): PartPose {
  const pose: PartPose = jointPose(raw, label, warn);
  if (raw.visible !== null && raw.visible !== undefined) pose.visible = Boolean(raw.visible);
  if (raw.opacity !== null && raw.opacity !== undefined) {
    pose.opacity = clampOrReject(raw.opacity, 0, 1, `${label} opacity`, warn);
  }
  if (raw.zIndex !== null && raw.zIndex !== undefined) {
    pose.zIndex = Math.round(clampOrReject(raw.zIndex, -512, 512, `${label} zIndex`, warn));
  }
  if (raw.swapTo !== null && raw.swapTo !== undefined && raw.swapTo !== "") {
    const swapTo = requireId(raw.swapTo, `${label} swapTo`);
    if (!knownParts.has(swapTo)) reject(`${label} swaps to unknown part "${swapTo}".`);
    pose.swapTo = swapTo;
  }
  return pose;
}

/**
 * Revalidate a motion proposal against the REAL part and joint ids of the rig.
 *
 * §8.4's failure modes are all rejections rather than repairs: an unknown id,
 * a `t` outside 0..1, a first key that is not at 0, non-increasing times, or
 * fewer than two usable keys. A partially-applied clip is worse than no clip,
 * because it looks deliberate.
 */
export function revalidateMotion(
  raw: Record<string, unknown> | null,
  input: MotionCallInput,
): Revalidation<MotionProposal> {
  return attempt((warn) => {
    if (!raw) reject("The response did not contain a JSON object.");

    const knownParts = new Set(input.partIds);
    const knownJoints = new Set(input.joints.map((joint) => joint.id));

    if (!Array.isArray(raw.keyframes) || raw.keyframes.length < 2) {
      reject("A clip needs at least two keyframes.");
    }
    if (raw.keyframes.length > ProposalConstants.maxKeyframes) {
      reject(`A clip may hold at most ${ProposalConstants.maxKeyframes} keyframes.`);
    }

    let previous = -1;
    let posedChannels = 0;
    const keyframes: Keyframe[] = raw.keyframes.map((entry, index) => {
      if (!entry || typeof entry !== "object") reject("Every keyframe must be an object.");
      const key = entry as unknown as WireKeyframe;

      const t = clampOrReject(key.t, 0, 1, `Keyframe ${index}'s t`, warn);
      if (index === 0 && t !== 0) reject("The first keyframe must be at t = 0.");
      if (t <= previous) {
        reject(
          `Keyframe ${index} is at t = ${t}, which is not after the previous key at t = ${previous}.`,
        );
      }
      previous = t;

      const joints: Record<string, JointPose> = {};
      for (const channels of Array.isArray(key.joints) ? key.joints : []) {
        const id = requireId(channels?.id, `Keyframe ${index}'s joint id`);
        if (!knownJoints.has(id)) {
          reject(
            `Keyframe ${index} poses unknown joint "${id}". Use only the joint ids from the rig.`,
          );
        }
        const pose = jointPose(channels, `Keyframe ${index}'s joint "${id}"`, warn);
        if (Object.keys(pose).length > 0) {
          joints[id] = pose;
          posedChannels += Object.keys(pose).length;
        }
      }

      const parts: Record<string, PartPose> = {};
      for (const channels of Array.isArray(key.parts) ? key.parts : []) {
        const id = requireId(channels?.id, `Keyframe ${index}'s part id`);
        if (!knownParts.has(id)) {
          reject(
            `Keyframe ${index} poses unknown part "${id}". Use only the part ids from the rig.`,
          );
        }
        const pose = partPose(
          channels,
          knownParts,
          `Keyframe ${index}'s part "${id}"`,
          warn,
        );
        if (Object.keys(pose).length > 0) {
          parts[id] = pose;
          posedChannels += Object.keys(pose).length;
        }
      }

      return {
        t,
        ease: requireMember<Ease>(key.ease, EASE_VALUES, `Keyframe ${index}'s ease`),
        joints,
        parts,
      };
    });

    if (posedChannels === 0) {
      reject("Not one keyframe poses anything; the clip would be a still.");
    }

    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";

    return {
      name: name || "Generated motion",
      loop: raw.loop !== false,
      fps: Math.round(
        clampOrReject(
          raw.fps ?? input.defaultFps,
          1,
          ProposalConstants.maxFps,
          "The clip's fps",
          warn,
        ),
      ),
      frameCount: Math.round(
        clampOrReject(
          raw.frameCount ?? input.defaultFrameCount,
          2,
          ProposalConstants.maxFrames,
          "The clip's frameCount",
          warn,
        ),
      ),
      keyframes,
      warnings: stringList(raw.warnings, ProposalConstants.maxWarnings),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Critique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which id space each correction kind targets.
 *
 * A table rather than a switch because the point of it is to be READ: getting
 * this wrong means a correction resolves against the wrong id space, passes
 * validation, and then edits the wrong thing in py_backend.
 */
const CORRECTION_TARGET_SPACE: Readonly<
  Record<CorrectionKind, "part" | "joint-or-part" | "clip" | "none">
> = Object.freeze({
  "pivot-nudge": "part",
  "rotation-damp": "joint-or-part",
  "z-order": "part",
  "deformer-swap": "part",
  "parent-change": "joint-or-part",
  "keyframe-retime": "clip",
  "part-visibility": "part",
  abort: "none",
});

function correction(
  raw: unknown,
  input: CritiqueCallInput,
  warn: (message: string) => void,
): Correction {
  if (!raw || typeof raw !== "object") reject("Every correction must be an object.");
  const item = raw as Record<string, unknown>;

  const kind = requireMember<CorrectionKind>(
    item.kind,
    CORRECTION_KIND_VALUES,
    "A correction kind",
  );
  const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, 300) : "";
  if (!reason) reject(`A "${kind}" correction must say why.`);

  const space = CORRECTION_TARGET_SPACE[kind];
  const parts = new Set(input.partIds);
  const joints = new Set(input.jointIds);
  const clips = new Set(input.clipIds);

  let targetId: string | null = null;
  if (space !== "none") {
    targetId = requireId(item.targetId, `A "${kind}" correction's targetId`);
    const resolves =
      space === "part"
        ? parts.has(targetId)
        : space === "clip"
          ? clips.has(targetId)
          : parts.has(targetId) || joints.has(targetId);
    if (!resolves) {
      reject(
        `A "${kind}" correction targets "${targetId}", which is not a ${space} in this rig. ` +
          "An unknown id means the critique is working from a stale revision, so the whole report was rejected.",
      );
    }
  }

  const built: Correction = {
    kind,
    targetId,
    reason,
    vec2: null,
    scalar: null,
    intValue: null,
    deformerKind: null,
    stringValue: null,
  };

  switch (kind) {
    case "pivot-nudge": {
      const vec = item.vec2;
      if (!vec || typeof vec !== "object") {
        reject('A "pivot-nudge" correction must carry a vec2 delta.');
      }
      const delta = vec as Record<string, unknown>;
      const cap = ProposalConstants.maxPivotNudge;
      built.vec2 = {
        x: clampOrReject(delta.x, -cap, cap, `The pivot nudge x on "${targetId}"`, warn),
        y: clampOrReject(delta.y, -cap, cap, `The pivot nudge y on "${targetId}"`, warn),
      };
      break;
    }
    case "rotation-damp":
      built.scalar = clampOrReject(
        item.scalar,
        ProposalConstants.minRotationDamp,
        1,
        `The rotation damping on "${targetId}"`,
        warn,
      );
      break;
    case "z-order":
      built.intValue = Math.round(
        clampOrReject(item.intValue, -512, 512, `The z-order on "${targetId}"`, warn),
      );
      break;
    case "deformer-swap":
      built.deformerKind = requireMember<DeformerKind>(
        item.deformerKind,
        DEFORMER_KIND_VALUES,
        `The deformer swap on "${targetId}"`,
      );
      break;
    case "parent-change": {
      const parent = requireId(
        item.stringValue,
        `The new parent id on "${targetId}"`,
      );
      if (parent === targetId) reject(`A "parent-change" would parent "${targetId}" to itself.`);
      // Resolved in the SAME space as the target: reparenting a part under a
      // joint is not a thing the transform tree can express.
      const sameSpace = parts.has(String(targetId)) ? parts : joints;
      if (!sameSpace.has(parent)) {
        reject(
          `A "parent-change" on "${targetId}" names parent "${parent}", which is not in the same tree.`,
        );
      }
      built.stringValue = parent;
      break;
    }
    case "keyframe-retime":
      built.scalar = clampOrReject(
        item.scalar,
        0,
        1,
        `The retime on clip "${targetId}"`,
        warn,
      );
      break;
    case "part-visibility": {
      const word = typeof item.stringValue === "string" ? item.stringValue.trim().toLowerCase() : "";
      if (word !== "show" && word !== "hide") {
        reject('A "part-visibility" correction must say "show" or "hide".');
      }
      built.stringValue = word;
      break;
    }
    case "abort":
      break;
  }

  return built;
}

export function revalidateCritique(
  raw: Record<string, unknown> | null,
  input: CritiqueCallInput,
): Revalidation<CritiqueReport> {
  return attempt((warn) => {
    if (!raw) reject("The response did not contain a JSON object.");

    const verdict = requireMember(
      raw.verdict,
      ["accept", "revise", "abort"] as const,
      "The verdict",
    );

    const rawCorrections = Array.isArray(raw.corrections) ? raw.corrections : [];
    if (rawCorrections.length > ProposalConstants.maxCorrectionsPerPass) {
      reject(
        `A pass may request at most ${ProposalConstants.maxCorrectionsPerPass} corrections; this one requested ${rawCorrections.length}.`,
      );
    }
    const corrections = rawCorrections.map((entry) => correction(entry, input, warn));

    if (verdict === "revise" && corrections.length === 0) {
      // "Revise, but here is nothing to change" would spend another render and
      // another vision call on an identical document, which is the retry storm
      // §11.6 exists to prevent.
      reject('A verdict of "revise" must come with at least one correction.');
    }

    return {
      verdict,
      // The pass index is authored HERE, not read from the response. It is
      // bookkeeping the loop owns, and a model that miscounts it would make the
      // audit trail attribute the work to the wrong pass.
      passIndex: input.passIndex,
      observations: stringList(raw.observations, ProposalConstants.maxObservations),
      corrections,
    };
  });
}

export const ProposalRevalidator = Object.freeze({
  semantics: revalidateSemantics,
  motion: revalidateMotion,
  critique: revalidateCritique,
  clampOrReject,
});
