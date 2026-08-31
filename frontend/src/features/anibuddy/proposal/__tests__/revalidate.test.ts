// Revalidation contract tests (F9 §11.4).
//
// These are the tests that matter most in the AI layer, because every failure
// they cover is a way a model response could quietly produce a rig that looks
// plausible and animates wrongly. The provider's strict schema catches shape;
// these catch the three things it cannot — whether an id resolves against THIS
// revision, whether a number is a rounding artifact or a unit misunderstanding,
// and whether the resulting graph is still a tree.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ProposalConstants } from "../proposal.constants";
import { parseJsonObject, firstChoiceText } from "../proposal.parse";
import { ProposalResponseFormats } from "../response-format";
import {
  clampOrReject,
  revalidateCritique,
  revalidateMotion,
  revalidateSemantics,
} from "../revalidate";
import type {
  CritiqueCallInput,
  MotionCallInput,
  PartLegendEntry,
} from "../proposal.types";

// --- Fixtures ---------------------------------------------------------------

const LEGEND: PartLegendEntry[] = [
  { partId: "torso", label: 1, name: "Torso", role: "other", zIndex: 0, confidence: 0.9 },
  { partId: "arm", label: 2, name: "Arm", role: "other", zIndex: 1, confidence: 0.8 },
];

function semanticsPart(overrides: Record<string, unknown> = {}) {
  return {
    partId: "torso",
    role: "torso",
    parentPartId: null,
    attachSlot: null,
    pivotHint: { x: 0.5, y: 0.1 },
    zIndex: 0,
    deformerHint: "mesh",
    confidence: 0.8,
    ...overrides,
  };
}

function semanticsBody(overrides: Record<string, unknown> = {}) {
  return {
    archetype: "humanoid",
    parts: [semanticsPart(), semanticsPart({ partId: "arm", role: "armUpper", parentPartId: "torso", zIndex: 1 })],
    joints: [],
    warnings: [],
    ...overrides,
  };
}

const MOTION_INPUT: MotionCallInput = {
  imageDataUrl: "data:image/png;base64,AAAA",
  request: "wave",
  partIds: ["torso", "arm"],
  joints: [
    { id: "j_root", role: "root", parent: null },
    { id: "j_spine", role: "spine", parent: "j_root" },
  ],
  defaultFps: 12,
  defaultFrameCount: 24,
};

function wireJoint(id: string, channels: Record<string, unknown> = {}) {
  return { id, rot: null, tx: null, ty: null, scale: null, ...channels };
}

function wirePart(id: string, channels: Record<string, unknown> = {}) {
  return {
    id,
    rot: null,
    tx: null,
    ty: null,
    scale: null,
    visible: null,
    opacity: null,
    zIndex: null,
    swapTo: null,
    ...channels,
  };
}

function motionBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Wave",
    loop: true,
    fps: 12,
    frameCount: 24,
    keyframes: [
      { t: 0, ease: "ease", joints: [wireJoint("j_spine", { rot: 0 })], parts: [] },
      { t: 1, ease: "ease", joints: [wireJoint("j_spine", { rot: 30 })], parts: [] },
    ],
    warnings: [],
    ...overrides,
  };
}

const CRITIQUE_INPUT: CritiqueCallInput = {
  imageDataUrl: "data:image/png;base64,AAAA",
  passIndex: 1,
  columns: 3,
  rows: 3,
  frameTimes: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
  partIds: ["torso", "arm"],
  jointIds: ["j_root", "j_spine"],
  clipIds: ["clip_a"],
  maxStretch: 1.4,
  flippedTriangles: 0,
};

function correction(overrides: Record<string, unknown> = {}) {
  return {
    kind: "pivot-nudge",
    targetId: "torso",
    reason: "The torso rotates about its centre instead of its hips.",
    vec2: { x: 0, y: 0.04 },
    scalar: null,
    intValue: null,
    deformerKind: null,
    stringValue: null,
    ...overrides,
  };
}

function critiqueBody(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "revise",
    passIndex: 1,
    observations: ["The hip pivot is wrong."],
    corrections: [correction()],
    ...overrides,
  };
}

// --- The clamp-or-reject band ----------------------------------------------

test("clamp band: the tolerance matches the python boundary", () => {
  // Both boundaries apply the same rule to the same numbers. They cannot import
  // from each other, so the value is asserted rather than trusted to a comment —
  // `VisionConstants.CLAMP_TOLERANCE` in py_backend must equal this.
  assert.equal(ProposalConstants.clampTolerance, 0.2);
});

test("clamp band: in-range values pass untouched", () => {
  const warnings: string[] = [];
  assert.equal(clampOrReject(0.5, 0, 1, "x", (m) => warnings.push(m)), 0.5);
  assert.equal(warnings.length, 0);
});

test("clamp band: a rounding artifact is clamped and disclosed", () => {
  const warnings: string[] = [];
  assert.equal(clampOrReject(1.05, 0, 1, "x", (m) => warnings.push(m)), 1);
  assert.equal(warnings.length, 1, "a silent clamp is a lie by omission");
});

test("clamp band: a unit misunderstanding is refused", () => {
  // 1.5 on a 0..1 field is not a rounding error, and a response that got the
  // units wrong once cannot be trusted on its other numbers either.
  const result = revalidateSemantics(
    semanticsBody({ parts: [semanticsPart({ confidence: 1.5 })] }),
    LEGEND,
  );
  assert.equal(result.ok, false);
});

test("clamp band: the band scales with the bound span, not an absolute epsilon", () => {
  const warnings: string[] = [];
  const cap = ProposalConstants.maxPivotNudge;
  const inside = cap * (1 + ProposalConstants.clampTolerance * 0.9);
  assert.equal(clampOrReject(inside, -cap, cap, "nudge", (m) => warnings.push(m)), cap);
  assert.throws(() =>
    clampOrReject(cap * 3, -cap, cap, "nudge", (m) => warnings.push(m)),
  );
});

// --- Parsing ----------------------------------------------------------------

test("parse: a fenced object is recovered", () => {
  // Requested strict output, but Open Quota may route to an upstream that ignores
  // response_format. Recovering a fence is not repairing a malformed proposal.
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
});

test("parse: prose around an object is recovered, an array is not an object", () => {
  assert.deepEqual(parseJsonObject('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.equal(parseJsonObject("[1,2,3]"), null);
  assert.equal(parseJsonObject("not json at all"), null);
});

test("parse: text is pulled from either content shape", () => {
  assert.equal(firstChoiceText({ choices: [{ message: { content: "hi" } }] }), "hi");
  assert.equal(
    firstChoiceText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
    "ab",
  );
});

// --- Semantics --------------------------------------------------------------

test("semantics: a well-formed proposal validates", () => {
  const result = revalidateSemantics(semanticsBody(), LEGEND);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.archetype, "humanoid");
  assert.equal(result.value.parts.length, 2);
  assert.equal(result.value.parts[1].parentPartId, "torso");
});

test("semantics: a part id outside the legend rejects the whole proposal", () => {
  // The legend is what makes the numbered overlay safe: the model answers with
  // ids, so an off-by-one in the annotator cannot reassign a role silently.
  const result = revalidateSemantics(
    semanticsBody({ parts: [semanticsPart({ partId: "ghost" })] }),
    LEGEND,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /ghost/);
});

test("semantics: an unknown role rejects rather than falling back to `other`", () => {
  const result = revalidateSemantics(
    semanticsBody({ parts: [semanticsPart({ role: "flange" })] }),
    LEGEND,
  );
  assert.equal(result.ok, false);
});

test("semantics: a parent cycle rejects", () => {
  const result = revalidateSemantics(
    semanticsBody({
      parts: [
        semanticsPart({ partId: "torso", parentPartId: "arm" }),
        semanticsPart({ partId: "arm", parentPartId: "torso" }),
      ],
    }),
    LEGEND,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /cycle/);
});

test("semantics: a duplicated part rejects", () => {
  const result = revalidateSemantics(
    semanticsBody({ parts: [semanticsPart(), semanticsPart()] }),
    LEGEND,
  );
  assert.equal(result.ok, false);
});

test("semantics: an unclassified part warns rather than rejecting", () => {
  // A part the model could not classify is a real answer, and the rig stage has a
  // geometric prior for it. Refusing the whole proposal over one unclassifiable
  // accessory would throw away the other sixty-three.
  const result = revalidateSemantics(semanticsBody({ parts: [semanticsPart()] }), LEGEND);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.warnings.some((warning) => warning.includes("arm")));
});

test("semantics: more than one joint root rejects", () => {
  const joint = (id: string, parent: string | null) => ({
    jointId: id,
    name: id,
    role: "spine",
    partId: null,
    parent,
    x: 0.5,
    y: 0.5,
  });
  const result = revalidateSemantics(
    semanticsBody({ joints: [joint("a", null), joint("b", null)] }),
    LEGEND,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /exactly one/);
});

test("semantics: a joint bound to an unknown part rejects", () => {
  const result = revalidateSemantics(
    semanticsBody({
      joints: [
        {
          jointId: "j_root",
          name: "Root",
          role: "root",
          partId: "ghost",
          parent: null,
          x: 0.5,
          y: 0.5,
        },
      ],
    }),
    LEGEND,
  );
  assert.equal(result.ok, false);
});

// --- Motion -----------------------------------------------------------------

test("motion: a well-formed clip validates and folds channels into a record", () => {
  const result = revalidateMotion(motionBody(), MOTION_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.keyframes.length, 2);
  assert.deepEqual(result.value.keyframes[1].joints.j_spine, { rot: 30 });
});

test("motion: null channels become ABSENT, not zero", () => {
  // §7.7's sparsity is load-bearing: a key that mentions only the tail must not
  // snap every other joint, and a pose full of explicit zeros does exactly that.
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "ease", joints: [wireJoint("j_spine", { rot: 0 })], parts: [] },
        { t: 1, ease: "ease", joints: [wireJoint("j_spine", { ty: 0.2 })], parts: [] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.value.keyframes[1].joints.j_spine), ["ty"]);
});

test("motion: an unknown joint id rejects the whole clip", () => {
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "ease", joints: [wireJoint("ghost", { rot: 0 })], parts: [] },
        { t: 1, ease: "ease", joints: [wireJoint("ghost", { rot: 10 })], parts: [] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /ghost/);
});

test("motion: the first key must be at t = 0", () => {
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0.1, ease: "ease", joints: [wireJoint("j_spine", { rot: 0 })], parts: [] },
        { t: 1, ease: "ease", joints: [wireJoint("j_spine", { rot: 10 })], parts: [] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, false);
});

test("motion: non-increasing times reject", () => {
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "ease", joints: [wireJoint("j_spine", { rot: 0 })], parts: [] },
        { t: 0, ease: "ease", joints: [wireJoint("j_spine", { rot: 10 })], parts: [] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, false);
});

test("motion: a clip that poses nothing rejects", () => {
  // Two keys with every channel null is a still, and a still that claims to be a
  // clip is worse than a refusal because the user cannot tell why nothing moves.
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "ease", joints: [], parts: [] },
        { t: 1, ease: "ease", joints: [], parts: [] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, false);
});

test("motion: part channels and a swapTo to a real part validate", () => {
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "hold", joints: [], parts: [wirePart("arm", { visible: true })] },
        {
          t: 1,
          ease: "hold",
          joints: [],
          parts: [wirePart("arm", { swapTo: "torso", zIndex: 5, opacity: 0.5 })],
        },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.keyframes[1].parts.arm.swapTo, "torso");
  assert.equal(result.value.keyframes[1].parts.arm.zIndex, 5);
});

test("motion: a swapTo to an unknown part rejects", () => {
  const result = revalidateMotion(
    motionBody({
      keyframes: [
        { t: 0, ease: "hold", joints: [], parts: [wirePart("arm", { visible: true })] },
        { t: 1, ease: "hold", joints: [], parts: [wirePart("arm", { swapTo: "ghost" })] },
      ],
    }),
    MOTION_INPUT,
  );
  assert.equal(result.ok, false);
});

// --- Critique ---------------------------------------------------------------

test("critique: a well-formed report validates", () => {
  const result = revalidateCritique(critiqueBody(), CRITIQUE_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.verdict, "revise");
  assert.equal(result.value.corrections[0].kind, "pivot-nudge");
});

test("critique: the pass index comes from the loop, not from the model", () => {
  // Bookkeeping the loop owns. A model that miscounts it would make the audit
  // trail attribute the work to the wrong pass.
  const result = revalidateCritique(critiqueBody({ passIndex: 7 }), CRITIQUE_INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.passIndex, CRITIQUE_INPUT.passIndex);
});

test("critique: each kind resolves against its own id space", () => {
  // A z-order aimed at a joint would pass a naive "does this id exist" check and
  // then edit nothing, or the wrong thing.
  const jointTargeted = revalidateCritique(
    critiqueBody({ corrections: [correction({ kind: "z-order", targetId: "j_spine", vec2: null, intValue: 3 })] }),
    CRITIQUE_INPUT,
  );
  assert.equal(jointTargeted.ok, false);

  const clipTargeted = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({ kind: "keyframe-retime", targetId: "clip_a", vec2: null, scalar: 0.7 }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(clipTargeted.ok, true);

  const wrongClip = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({ kind: "keyframe-retime", targetId: "torso", vec2: null, scalar: 0.7 }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(wrongClip.ok, false);
});

test("critique: rotation damping below the floor is clamped, far below is refused", () => {
  const clamped = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({
          kind: "rotation-damp",
          targetId: "j_spine",
          vec2: null,
          scalar: ProposalConstants.minRotationDamp - 0.05,
        }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(clamped.ok, true);
  if (clamped.ok) {
    assert.equal(clamped.value.corrections[0].scalar, ProposalConstants.minRotationDamp);
    assert.ok(clamped.warnings.length > 0);
  }

  const refused = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({ kind: "rotation-damp", targetId: "j_spine", vec2: null, scalar: 0 }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(refused.ok, false);
});

test("critique: a parent-change must stay inside one tree", () => {
  const crossTree = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({
          kind: "parent-change",
          targetId: "arm",
          vec2: null,
          stringValue: "j_spine",
        }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(crossTree.ok, false, "a part cannot be parented to a joint");

  const sameTree = revalidateCritique(
    critiqueBody({
      corrections: [
        correction({
          kind: "parent-change",
          targetId: "arm",
          vec2: null,
          stringValue: "torso",
        }),
      ],
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(sameTree.ok, true);
});

test('critique: "revise" with no corrections rejects', () => {
  // Would spend another render and another vision call on an identical document,
  // which is the retry storm §11.6 exists to prevent.
  const result = revalidateCritique(critiqueBody({ corrections: [] }), CRITIQUE_INPUT);
  assert.equal(result.ok, false);
});

test('critique: "accept" and "abort" need no corrections', () => {
  for (const verdict of ["accept", "abort"] as const) {
    const result = revalidateCritique(
      critiqueBody({ verdict, corrections: [] }),
      CRITIQUE_INPUT,
    );
    assert.equal(result.ok, true, `${verdict} must be allowed to carry nothing`);
  }
});

test("critique: more corrections than the per-pass cap reject", () => {
  const result = revalidateCritique(
    critiqueBody({
      corrections: Array.from(
        { length: ProposalConstants.maxCorrectionsPerPass + 1 },
        () => correction(),
      ),
    }),
    CRITIQUE_INPUT,
  );
  assert.equal(result.ok, false);
});

test("critique: a correction with no reason rejects", () => {
  const result = revalidateCritique(
    critiqueBody({ corrections: [correction({ reason: "  " })] }),
    CRITIQUE_INPUT,
  );
  assert.equal(result.ok, false);
});

// --- R3: the schemas cannot carry geometry ---------------------------------

test("R3: no proposal schema has a geometry channel", () => {
  // The structural half of R3 on the request side. The zod half is pinned in
  // backend/src/__tests__/anibuddy.schema.test.ts; this asserts the same property
  // of the schema we actually send to the provider, because a field that exists
  // here is a field a model will eventually fill in.
  const serialized = JSON.stringify(ProposalResponseFormats);
  for (const forbidden of [
    "verts",
    "tris",
    "weights",
    "controlPoints",
    "boneIds",
    "mask",
    "cuts",
    "thickness",
  ]) {
    assert.ok(
      !serialized.includes(`"${forbidden}"`),
      `${forbidden} must not be a field on any proposal schema (R3)`,
    );
  }
});

test("R3: every proposal schema forbids additional properties", () => {
  // Belt and braces on the above: a model cannot smuggle a geometry field in as
  // an extra property, because the provider rejects the response before we parse.
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.type === "object" || (record.type as string[])?.includes?.("object")) {
      assert.equal(
        record.additionalProperties,
        false,
        `every object in a proposal schema must forbid extra properties: ${JSON.stringify(record).slice(0, 120)}`,
      );
    }
    Object.values(record).forEach(walk);
  };
  walk(ProposalResponseFormats);
});
