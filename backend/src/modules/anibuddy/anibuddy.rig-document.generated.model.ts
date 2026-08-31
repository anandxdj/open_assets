//
// GENERATED FILE — DO NOT EDIT.
//
// Source:    schemas/anibuddy/rig-document.v5.schema.json
// Regenerate: pnpm --dir backend schema:anibuddy
//
// Every hand edit here is erased on the next run, and CI fails the build in
// the meantime. Change the JSON Schema instead.
//

import { Schema } from 'mongoose';

// Storage projection of the RigDocument contract. Rule 10: pure schema — no
// hooks, no methods, no virtuals. Validation lives in the zod DTOs; anything
// a document reaches Mongo with has already passed them. Tagged unions are
// Mixed here because Mongoose can only express a union through a
// discriminator model, which would drag behaviour into a model file.

const vec2Schema = new Schema({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
}, { _id: false });

const rectSchema = new Schema({
  x: { type: Number, min: 0, max: 1, required: true },
  y: { type: Number, min: 0, max: 1, required: true },
  width: { type: Number, min: 0, max: 1, required: true },
  height: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const numericBufferSchema = new Schema({
  dtype: { type: String, enum: ["f32", "u32"], required: true },
  storage: { type: String, enum: ["inline", "external"], required: true },
  length: { type: Number, min: 0, max: 4000000, required: true },
  sha256: { type: String, match: /^[a-f0-9]{64}$/, required: true },
  values: { type: [Number], required: false, default: null },
  storageKey: { type: String, maxlength: 512, required: false, default: null },
}, { _id: false });

const maskRectSchema = new Schema({
  kind: { type: String, enum: ["rect"], required: true, default: "rect" },
}, { _id: false });

const maskAlphaThresholdSchema = new Schema({
  kind: { type: String, enum: ["alpha-threshold"], required: true, default: "alpha-threshold" },
  threshold: { type: Number, min: 0, max: 255, required: true },
}, { _id: false });

const maskPolygonSchema = new Schema({
  kind: { type: String, enum: ["polygon"], required: true, default: "polygon" },
  outline: { type: numericBufferSchema, required: true },
  holes: { type: [numericBufferSchema], required: true, default: undefined },
}, { _id: false });

const maskRleSchema = new Schema({
  kind: { type: String, enum: ["rle"], required: true, default: "rle" },
  origin: { type: vec2Schema, required: true },
  width: { type: Number, min: 1, max: 8192, required: true },
  height: { type: Number, min: 1, max: 8192, required: true },
  counts: { type: numericBufferSchema, required: true },
}, { _id: false });

const cutLineSchema = new Schema({
  id: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  points: { type: numericBufferSchema, required: true },
}, { _id: false });

const deformerRigidSchema = new Schema({
  kind: { type: String, enum: ["rigid"], required: true, default: "rigid" },
}, { _id: false });

const deformerMeshSchema = new Schema({
  kind: { type: String, enum: ["mesh"], required: true, default: "mesh" },
  verts: { type: numericBufferSchema, required: true },
  tris: { type: numericBufferSchema, required: true },
  boneIds: { type: [String], required: true, default: undefined },
  weights: { type: numericBufferSchema, required: true },
  cuts: { type: [cutLineSchema], required: true, default: undefined },
}, { _id: false });

const deformerLatticeSchema = new Schema({
  kind: { type: String, enum: ["lattice"], required: true, default: "lattice" },
  cols: { type: Number, min: 1, max: 16, required: true },
  rows: { type: Number, min: 1, max: 16, required: true },
  controlPoints: { type: numericBufferSchema, required: true },
  interpolation: { type: String, enum: ["bilinear", "bicubic"], required: true },
}, { _id: false });

const deformerSplineSchema = new Schema({
  kind: { type: String, enum: ["spline"], required: true, default: "spline" },
  thickness: { type: numericBufferSchema, required: true },
  samples: { type: Number, min: 2, max: 256, required: true },
}, { _id: false });

const slotSchema = new Schema({
  name: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  position: { type: vec2Schema, required: true },
}, { _id: false });

const partSchema = new Schema({
  id: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  name: { type: String, maxlength: 80, required: true },
  role: { type: String, enum: ["root", "head", "face", "hair", "torso", "pelvis", "armUpper", "armLower", "hand", "legUpper", "legLower", "foot", "eye", "jaw", "ear", "cape", "accessory", "neck", "tail", "wing", "fin", "horn", "paw", "snout", "shell", "tentacle", "chassis", "wheel", "track", "turret", "barrel", "piston", "hatch", "rotor", "thruster", "antenna", "prop", "weapon", "projectile", "effect", "spark", "smoke", "trail", "skyLayer", "backgroundLayer", "midgroundLayer", "foregroundLayer", "cloud", "foliage", "waterLayer", "logoMark", "logoText", "icon", "badge", "panel", "glyph", "underlay", "other"], required: true },
  mask: { type: Schema.Types.Mixed, required: true },
  rect: { type: rectSchema, required: true },
  pivot: { type: vec2Schema, required: true },
  zIndex: { type: Number, min: -512, max: 512, required: true },
  parentPartId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  attachSlot: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  slots: { type: [slotSchema], required: true, default: undefined },
  deformer: { type: Schema.Types.Mixed, required: true },
  boundJointId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  visible: { type: Boolean, required: true },
  opacity: { type: Number, min: 0, max: 1, required: true },
  confidence: { type: Number, min: 0, max: 1, required: true },
  provenance: { type: String, enum: ["alpha-component", "gutter-grid", "watershed", "grabcut", "vision", "manual", "imported-v3", "imported-v4"], required: true },
}, { _id: false });

const jointSchema = new Schema({
  id: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  name: { type: String, maxlength: 80, required: true },
  role: { type: String, enum: ["root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower", "limbTip", "tail", "wing", "ear", "prop", "other", "neck", "digit", "fin", "horn", "tentacleSegment", "hinge", "wheel", "piston", "slider", "layer", "anchor"], required: true },
  x: { type: Number, min: 0, max: 1, required: true },
  y: { type: Number, min: 0, max: 1, required: true },
  parent: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  partId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  ikChainLength: { type: Number, min: 1, max: 4, required: false, default: null },
  confidence: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const skeletonSchema = new Schema({
  joints: { type: [jointSchema], required: true, default: undefined },
}, { _id: false });

const jointPoseSchema = new Schema({
  rot: { type: Number, min: -180, max: 180, required: false },
  tx: { type: Number, min: -1, max: 1, required: false },
  ty: { type: Number, min: -1, max: 1, required: false },
  scale: { type: Number, min: 0.05, max: 4, required: false },
}, { _id: false });

const partPoseSchema = new Schema({
  rot: { type: Number, min: -180, max: 180, required: false },
  tx: { type: Number, min: -1, max: 1, required: false },
  ty: { type: Number, min: -1, max: 1, required: false },
  scale: { type: Number, min: 0.05, max: 4, required: false },
  visible: { type: Boolean, required: false },
  opacity: { type: Number, min: 0, max: 1, required: false },
  zIndex: { type: Number, min: -512, max: 512, required: false },
  swapTo: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false },
}, { _id: false });

const keyframeSchema = new Schema({
  t: { type: Number, min: 0, max: 1, required: true },
  ease: { type: String, enum: ["linear", "ease", "hold"], required: true },
  joints: { type: Map, of: jointPoseSchema, required: true },
  parts: { type: Map, of: partPoseSchema, required: true },
}, { _id: false });

const clipSchema = new Schema({
  id: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  name: { type: String, maxlength: 80, required: true },
  request: { type: String, maxlength: 500, required: true },
  loop: { type: Boolean, required: true },
  fps: { type: Number, min: 1, max: 60, required: true },
  frameCount: { type: Number, min: 2, max: 120, required: true },
  keyframes: { type: [keyframeSchema], required: true, default: undefined },
  source: { type: String, enum: ["model", "edited", "critique", "imported"], required: true },
}, { _id: false });

const assetRefSchema = new Schema({
  id: { type: String, match: /^[A-Za-z0-9_-]{1,64}$/, required: true },
  name: { type: String, maxlength: 200, required: true },
  storageKey: { type: String, maxlength: 512, required: true },
  contentHash: { type: String, match: /^[a-f0-9]{64}$/, required: true },
  width: { type: Number, min: 1, max: 8192, required: true },
  height: { type: Number, min: 1, max: 8192, required: true },
  figureHeight: { type: Number, min: 1, max: 8192, required: false, default: null },
  mimeType: { type: String, enum: ["image/png", "image/webp", "image/jpeg"], required: true },
  rightsConfirmed: { type: Boolean, required: true },
  remoteVisionConsented: { type: Boolean, required: true },
}, { _id: false });

const qaTurnSchema = new Schema({
  question: { type: String, maxlength: 1000, required: true },
  answer: { type: String, maxlength: 1000, required: true },
}, { _id: false });

const generationProducedBySchema = new Schema({
  kind: { type: String, enum: ["user-supplied", "external-tool", "in-app-model"], required: true },
  modelId: { type: String, maxlength: 120, required: false, default: null },
  at: { type: String, required: true },
}, { _id: false });

const generationSeamSchema = new Schema({
  mode: { type: String, enum: ["external-prompt-only", "in-app-generated"], required: true },
  prompt: { type: String, maxlength: 4000, required: false, default: null },
  transcript: { type: [qaTurnSchema], required: true, default: undefined },
  producedBy: { type: generationProducedBySchema, required: false, default: null },
}, { _id: false });

const stageRecordSchema = new Schema({
  stage: { type: String, enum: ["decompose", "semantics", "rig", "animate", "render", "critique"], required: true },
  status: { type: String, enum: ["pending", "running", "succeeded", "failed", "skipped"], required: true },
  startedAt: { type: String, required: true },
  finishedAt: { type: String, required: false, default: null },
  inputHash: { type: String, match: /^[a-f0-9]{64}$/, required: true },
  passIndex: { type: Number, min: 0, max: 8, required: true },
  modelId: { type: String, maxlength: 120, required: false, default: null },
  usageEventId: { type: String, match: /^[a-f0-9]{24}$/, required: false, default: null },
  creditsSpent: { type: Number, min: 0, max: 1000, required: true },
  message: { type: String, maxlength: 2000, required: false, default: null },
}, { _id: false });

const documentProvenanceSchema = new Schema({
  pipelineVersion: { type: String, maxlength: 40, required: true },
  kernelVersion: { type: String, maxlength: 40, required: true },
  stages: { type: [stageRecordSchema], required: true, default: undefined },
}, { _id: false });

const diagnosticsSchema = new Schema({
  foregroundPixels: { type: Number, min: 0, required: true },
  coveredForegroundPixels: { type: Number, min: 0, required: true },
  overlappingPartPairs: { type: [Schema.Types.Mixed], required: true, default: undefined },
  maxStretch: { type: Number, min: 0, required: true },
  flippedTriangles: { type: Number, min: 0, required: true },
  isolatedVertices: { type: Number, min: 0, required: true },
  warnings: { type: [String], required: true, default: undefined },
  blockingReason: { type: String, maxlength: 500, required: false, default: null },
}, { _id: false });

const revisionLinkSchema = new Schema({
  index: { type: Number, min: 0, max: 4096, required: true },
  parentRevisionId: { type: String, maxlength: 64, required: false, default: null },
  reason: { type: String, maxlength: 200, required: true },
  accepted: { type: Boolean, required: true },
}, { _id: false });

const rigDocumentSchema = new Schema({
  schemaVersion: { type: Number, required: true, default: 5 },
  id: { type: String, maxlength: 64, required: true },
  projectId: { type: String, maxlength: 64, required: true },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
  revision: { type: revisionLinkSchema, required: true },
  archetype: { type: String, enum: ["humanoid", "creature", "mechanical", "prop", "environment", "ui"], required: true },
  asset: { type: assetRefSchema, required: true },
  parts: { type: [partSchema], required: true, default: undefined },
  skeleton: { type: skeletonSchema, required: true },
  clips: { type: [clipSchema], required: true, default: undefined },
  generation: { type: generationSeamSchema, required: true },
  provenance: { type: documentProvenanceSchema, required: true },
  diagnostics: { type: diagnosticsSchema, required: true },
}, { _id: false });

const proposedPartSemanticsSchema = new Schema({
  partId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  role: { type: String, enum: ["root", "head", "face", "hair", "torso", "pelvis", "armUpper", "armLower", "hand", "legUpper", "legLower", "foot", "eye", "jaw", "ear", "cape", "accessory", "neck", "tail", "wing", "fin", "horn", "paw", "snout", "shell", "tentacle", "chassis", "wheel", "track", "turret", "barrel", "piston", "hatch", "rotor", "thruster", "antenna", "prop", "weapon", "projectile", "effect", "spark", "smoke", "trail", "skyLayer", "backgroundLayer", "midgroundLayer", "foregroundLayer", "cloud", "foliage", "waterLayer", "logoMark", "logoText", "icon", "badge", "panel", "glyph", "underlay", "other"], required: true },
  parentPartId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  attachSlot: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  pivotHint: { type: vec2Schema, required: true },
  zIndex: { type: Number, min: -512, max: 512, required: true },
  deformerHint: { type: String, enum: ["rigid", "mesh", "lattice", "spline"], required: true },
  confidence: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const proposedJointSemanticsSchema = new Schema({
  jointId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: true },
  name: { type: String, maxlength: 80, required: true },
  role: { type: String, enum: ["root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower", "limbTip", "tail", "wing", "ear", "prop", "other", "neck", "digit", "fin", "horn", "tentacleSegment", "hinge", "wheel", "piston", "slider", "layer", "anchor"], required: true },
  partId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  parent: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  x: { type: Number, min: 0, max: 1, required: true },
  y: { type: Number, min: 0, max: 1, required: true },
}, { _id: false });

const semanticsProposalSchema = new Schema({
  archetype: { type: String, enum: ["humanoid", "creature", "mechanical", "prop", "environment", "ui"], required: true },
  parts: { type: [proposedPartSemanticsSchema], required: true, default: undefined },
  joints: { type: [proposedJointSemanticsSchema], required: true, default: undefined },
  warnings: { type: [String], required: true, default: undefined },
}, { _id: false });

const motionProposalSchema = new Schema({
  name: { type: String, maxlength: 80, required: true },
  loop: { type: Boolean, required: true },
  fps: { type: Number, min: 1, max: 60, required: true },
  frameCount: { type: Number, min: 2, max: 120, required: true },
  keyframes: { type: [keyframeSchema], required: true, default: undefined },
  warnings: { type: [String], required: true, default: undefined },
}, { _id: false });

const correctionSchema = new Schema({
  kind: { type: String, enum: ["pivot-nudge", "rotation-damp", "z-order", "deformer-swap", "parent-change", "keyframe-retime", "part-visibility", "abort"], required: true },
  targetId: { type: String, match: /^[A-Za-z0-9_-]{1,32}$/, required: false, default: null },
  reason: { type: String, maxlength: 300, required: true },
  vec2: { type: vec2Schema, required: false, default: null },
  scalar: { type: Number, min: 0, max: 1, required: false, default: null },
  intValue: { type: Number, min: -512, max: 512, required: false, default: null },
  deformerKind: { type: String, enum: ["rigid", "mesh", "lattice", "spline"], required: false, default: null },
  stringValue: { type: String, maxlength: 64, required: false, default: null },
}, { _id: false });

const critiqueReportSchema = new Schema({
  verdict: { type: String, enum: ["accept", "revise", "abort"], required: true },
  passIndex: { type: Number, min: 0, max: 8, required: true },
  observations: { type: [String], required: true, default: undefined },
  corrections: { type: [correctionSchema], required: true, default: undefined },
}, { _id: false });

/** Rule 16: one PascalCase object, one named export. Compose these into a
 *  top-level model with `new Schema({ ... rig: AniBuddyRigDocumentSchemas.rigDocument })`. */
export const AniBuddyRigDocumentSchemas = {
  vec2: vec2Schema,
  rect: rectSchema,
  numericBuffer: numericBufferSchema,
  maskRect: maskRectSchema,
  maskAlphaThreshold: maskAlphaThresholdSchema,
  maskPolygon: maskPolygonSchema,
  maskRle: maskRleSchema,
  cutLine: cutLineSchema,
  deformerRigid: deformerRigidSchema,
  deformerMesh: deformerMeshSchema,
  deformerLattice: deformerLatticeSchema,
  deformerSpline: deformerSplineSchema,
  slot: slotSchema,
  part: partSchema,
  joint: jointSchema,
  skeleton: skeletonSchema,
  jointPose: jointPoseSchema,
  partPose: partPoseSchema,
  keyframe: keyframeSchema,
  clip: clipSchema,
  assetRef: assetRefSchema,
  qaTurn: qaTurnSchema,
  generationProducedBy: generationProducedBySchema,
  generationSeam: generationSeamSchema,
  stageRecord: stageRecordSchema,
  documentProvenance: documentProvenanceSchema,
  diagnostics: diagnosticsSchema,
  revisionLink: revisionLinkSchema,
  rigDocument: rigDocumentSchema,
  proposedPartSemantics: proposedPartSemanticsSchema,
  proposedJointSemantics: proposedJointSemanticsSchema,
  semanticsProposal: semanticsProposalSchema,
  motionProposal: motionProposalSchema,
  correction: correctionSchema,
  critiqueReport: critiqueReportSchema,
} as const;
