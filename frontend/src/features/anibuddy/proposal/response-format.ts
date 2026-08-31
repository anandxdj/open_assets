// The three strict JSON response schemas, built from the generated enums.
//
// Why these are constructed rather than read straight out of
// `schemas/anibuddy/rig-document.v5.schema.json`
// -----------------------------------------------
// OpenAI-compatible `strict: true` structured output supports a deliberately
// small subset of JSON Schema. Three things the canonical schema uses are
// outside it: `$ref`, a map with dynamic keys (`Keyframe.joints`), and an
// optional property (every pose channel). Handing a provider the canonical
// document produces a 400 from the provider, not a strict response.
//
// So these are a flattened PROJECTION of the canonical `$defs`, and the enum
// members, the numeric bounds and the array caps are all imported from the
// generated bindings rather than retyped (R10). The projection's own conversion
// back into the canonical shape lives in `revalidate.ts`, which is where a
// nullable channel becomes an absent one.
//
// R3 is visible in what these schemas cannot say. There is no `verts`, no
// `tris`, no `weights`, no `controlPoints` and no mask field anywhere below —
// and because `additionalProperties` is false at every level, a model that
// emits one has its whole response rejected by the provider before this code
// sees it. The structural test in
// `backend/src/__tests__/anibuddy.schema.test.ts` pins the same property on the
// zod side.

import {
  ARCHETYPE_VALUES,
  CORRECTION_KIND_VALUES,
  DEFORMER_KIND_VALUES,
  EASE_VALUES,
  JOINT_ROLE_VALUES,
  PART_ROLE_VALUES,
} from "../rig/index.rig";
import { ProposalConstants } from "./proposal.constants";

/** Id pattern, verbatim from the canonical schema's `^[A-Za-z0-9_-]{1,32}$`. */
const ID_PATTERN = "^[A-Za-z0-9_-]{1,32}$";

/** Bounds, verbatim from the canonical `JointPose` / `PartPose` definitions. */
const POSE_BOUNDS = Object.freeze({
  rot: { minimum: -180, maximum: 180 },
  translate: { minimum: -1, maximum: 1 },
  scale: { minimum: 0.05, maximum: 4 },
  opacity: { minimum: 0, maximum: 1 },
  zIndex: { minimum: -512, maximum: 512 },
});

function nullableNumber(minimum: number, maximum: number) {
  return { type: ["number", "null"], minimum, maximum } as const;
}

function warnings(maxItems: number) {
  return {
    type: "array",
    maxItems,
    items: { type: "string", minLength: 1, maxLength: 500 },
  } as const;
}

const SEMANTICS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["archetype", "parts", "joints", "warnings"],
  properties: {
    archetype: { type: "string", enum: ARCHETYPE_VALUES },
    parts: {
      type: "array",
      minItems: 1,
      maxItems: ProposalConstants.maxParts,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "partId",
          "role",
          "parentPartId",
          "attachSlot",
          "pivotHint",
          "zIndex",
          "deformerHint",
          "confidence",
        ],
        properties: {
          partId: { type: "string", pattern: ID_PATTERN },
          role: { type: "string", enum: PART_ROLE_VALUES },
          parentPartId: { type: ["string", "null"] },
          attachSlot: { type: ["string", "null"] },
          // A HINT, in part-local normalized coordinates. The rig stage snaps it
          // to the mask's medial axis — the model's number is an initial guess,
          // not a geometric fact, which is what keeps it inside R3.
          pivotHint: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          zIndex: {
            type: "integer",
            minimum: POSE_BOUNDS.zIndex.minimum,
            maximum: POSE_BOUNDS.zIndex.maximum,
          },
          deformerHint: { type: "string", enum: DEFORMER_KIND_VALUES },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    joints: {
      type: "array",
      minItems: 0,
      maxItems: ProposalConstants.maxJoints,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["jointId", "name", "role", "partId", "parent", "x", "y"],
        properties: {
          jointId: { type: "string", pattern: ID_PATTERN },
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", enum: JOINT_ROLE_VALUES },
          partId: { type: ["string", "null"] },
          parent: { type: ["string", "null"] },
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    warnings: warnings(ProposalConstants.maxWarnings),
  },
} as const;

const MOTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "loop", "fps", "frameCount", "keyframes", "warnings"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    loop: { type: "boolean" },
    fps: { type: "integer", minimum: 1, maximum: ProposalConstants.maxFps },
    frameCount: { type: "integer", minimum: 2, maximum: ProposalConstants.maxFrames },
    keyframes: {
      type: "array",
      minItems: 2,
      maxItems: ProposalConstants.maxKeyframes,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "ease", "joints", "parts"],
        properties: {
          t: { type: "number", minimum: 0, maximum: 1 },
          ease: { type: "string", enum: EASE_VALUES },
          // Arrays rather than the canonical `Record<id, Pose>`: strict mode has
          // no way to say "any key matching this pattern". Revalidation folds
          // them back into the record the schema declares.
          joints: {
            type: "array",
            maxItems: ProposalConstants.maxJoints,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "rot", "tx", "ty", "scale"],
              properties: {
                id: { type: "string", pattern: ID_PATTERN },
                rot: nullableNumber(POSE_BOUNDS.rot.minimum, POSE_BOUNDS.rot.maximum),
                tx: nullableNumber(
                  POSE_BOUNDS.translate.minimum,
                  POSE_BOUNDS.translate.maximum,
                ),
                ty: nullableNumber(
                  POSE_BOUNDS.translate.minimum,
                  POSE_BOUNDS.translate.maximum,
                ),
                scale: nullableNumber(
                  POSE_BOUNDS.scale.minimum,
                  POSE_BOUNDS.scale.maximum,
                ),
              },
            },
          },
          parts: {
            type: "array",
            maxItems: ProposalConstants.maxParts,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "rot",
                "tx",
                "ty",
                "scale",
                "visible",
                "opacity",
                "zIndex",
                "swapTo",
              ],
              properties: {
                id: { type: "string", pattern: ID_PATTERN },
                rot: nullableNumber(POSE_BOUNDS.rot.minimum, POSE_BOUNDS.rot.maximum),
                tx: nullableNumber(
                  POSE_BOUNDS.translate.minimum,
                  POSE_BOUNDS.translate.maximum,
                ),
                ty: nullableNumber(
                  POSE_BOUNDS.translate.minimum,
                  POSE_BOUNDS.translate.maximum,
                ),
                scale: nullableNumber(
                  POSE_BOUNDS.scale.minimum,
                  POSE_BOUNDS.scale.maximum,
                ),
                visible: { type: ["boolean", "null"] },
                opacity: nullableNumber(
                  POSE_BOUNDS.opacity.minimum,
                  POSE_BOUNDS.opacity.maximum,
                ),
                zIndex: {
                  type: ["integer", "null"],
                  minimum: POSE_BOUNDS.zIndex.minimum,
                  maximum: POSE_BOUNDS.zIndex.maximum,
                },
                swapTo: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
    warnings: warnings(ProposalConstants.maxWarnings),
  },
} as const;

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "passIndex", "observations", "corrections"],
  properties: {
    verdict: { type: "string", enum: ["accept", "revise", "abort"] },
    passIndex: { type: "integer", minimum: 0, maximum: 8 },
    observations: warnings(ProposalConstants.maxObservations),
    corrections: {
      type: "array",
      maxItems: ProposalConstants.maxCorrectionsPerPass,
      items: {
        type: "object",
        additionalProperties: false,
        // Every field is a bounded scalar, a bounded integer, an enum member or
        // an id. There is deliberately no field here through which a vertex, a
        // triangle, a weight or a mask can arrive (R3) — which is why the
        // correction set is closed rather than free-form.
        required: [
          "kind",
          "targetId",
          "reason",
          "vec2",
          "scalar",
          "intValue",
          "deformerKind",
          "stringValue",
        ],
        properties: {
          kind: { type: "string", enum: CORRECTION_KIND_VALUES },
          targetId: { type: ["string", "null"] },
          reason: { type: "string", minLength: 1, maxLength: 300 },
          vec2: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["x", "y"],
            properties: {
              x: nullableNumber(
                -ProposalConstants.maxPivotNudge,
                ProposalConstants.maxPivotNudge,
              ),
              y: nullableNumber(
                -ProposalConstants.maxPivotNudge,
                ProposalConstants.maxPivotNudge,
              ),
            },
          },
          scalar: nullableNumber(0, 1),
          intValue: {
            type: ["integer", "null"],
            minimum: POSE_BOUNDS.zIndex.minimum,
            maximum: POSE_BOUNDS.zIndex.maximum,
          },
          deformerKind: { type: ["string", "null"], enum: [...DEFORMER_KIND_VALUES, null] },
          stringValue: { type: ["string", "null"], maxLength: 64 },
        },
      },
    },
  },
} as const;

/**
 * The three `response_format` payloads, ready to hand to `callLlm`.
 *
 * Named after the stage rather than the type so a route reads
 * `ProposalResponseFormats.semantics` and cannot pick the critique schema for a
 * semantics call — a mistake that would otherwise produce a valid-looking 400.
 */
export const ProposalResponseFormats = Object.freeze({
  semantics: {
    type: "json_schema",
    json_schema: {
      name: "anibuddy_semantics_proposal",
      strict: true,
      schema: SEMANTICS_SCHEMA,
    },
  } as const,

  motion: {
    type: "json_schema",
    json_schema: {
      name: "anibuddy_motion_proposal",
      strict: true,
      schema: MOTION_SCHEMA,
    },
  } as const,

  critique: {
    type: "json_schema",
    json_schema: {
      name: "anibuddy_critique_report",
      strict: true,
      schema: CRITIQUE_SCHEMA,
    },
  } as const,
});
