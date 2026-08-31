//
// GENERATED FILE — DO NOT EDIT.
//
// Source:    schemas/anibuddy/rig-document.v5.schema.json
// Regenerate: pnpm --dir backend schema:anibuddy
//
// Every hand edit here is erased on the next run, and CI fails the build in
// the meantime. Change the JSON Schema instead.
//

import { z } from 'zod';

// The gateway validates at this boundary and nowhere else. Mongo stores a
// projection of an already-validated document (unions land as Mixed there),
// so anything that reaches the database has passed through a schema below.

// Which rig prior applies. Drives the role vocabulary the semantics model may use and the default
// deformer per role.
export const ARCHETYPE_VALUES = ["humanoid", "creature", "mechanical", "prop", "environment", "ui"] as const;
const archetypeSchema = z.enum(ARCHETYPE_VALUES);
export type Archetype = z.infer<typeof archetypeSchema>;

// What a cutout part IS. Closed set across all six archetypes — the vision model picks from it and
// never invents a role. Roles select the default deformer and the motion priors.
export const PART_ROLE_VALUES = ["root", "head", "face", "hair", "torso", "pelvis", "armUpper", "armLower", "hand", "legUpper", "legLower", "foot", "eye", "jaw", "ear", "cape", "accessory", "neck", "tail", "wing", "fin", "horn", "paw", "snout", "shell", "tentacle", "chassis", "wheel", "track", "turret", "barrel", "piston", "hatch", "rotor", "thruster", "antenna", "prop", "weapon", "projectile", "effect", "spark", "smoke", "trail", "skyLayer", "backgroundLayer", "midgroundLayer", "foregroundLayer", "cloud", "foliage", "waterLayer", "logoMark", "logoText", "icon", "badge", "panel", "glyph", "underlay", "other"] as const;
const partRoleSchema = z.enum(PART_ROLE_VALUES);
export type PartRole = z.infer<typeof partRoleSchema>;

// What a joint IS. The first thirteen entries are the v3 JointRole set verbatim and in order, so a
// v3 rig imports without remapping. The remainder cover the five non-humanoid archetypes.
export const JOINT_ROLE_VALUES = ["root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower", "limbTip", "tail", "wing", "ear", "prop", "other", "neck", "digit", "fin", "horn", "tentacleSegment", "hinge", "wheel", "piston", "slider", "layer", "anchor"] as const;
const jointRoleSchema = z.enum(JOINT_ROLE_VALUES);
export type JointRole = z.infer<typeof jointRoleSchema>;

// The four per-part deformation models. Chosen from the part role by the archetype prior, always
// overridable by the user.
export const DEFORMER_KIND_VALUES = ["rigid", "mesh", "lattice", "spline"] as const;
const deformerKindSchema = z.enum(DEFORMER_KIND_VALUES);
export type DeformerKind = z.infer<typeof deformerKindSchema>;

// How a part's pixels are selected out of the source sheet. Every kind is a REVERSIBLE
// description; the source sheet is never edited.
export const MASK_KIND_VALUES = ["rect", "polygon", "rle", "alpha-threshold"] as const;
const maskKindSchema = z.enum(MASK_KIND_VALUES);
export type MaskKind = z.infer<typeof maskKindSchema>;

// Which stage or actor produced this part, so the editor can show what was guessed versus
// confirmed.
export const PART_PROVENANCE_VALUES = ["alpha-component", "gutter-grid", "watershed", "grabcut", "vision", "manual", "imported-v3", "imported-v4"] as const;
const partProvenanceSchema = z.enum(PART_PROVENANCE_VALUES);
export type PartProvenance = z.infer<typeof partProvenanceSchema>;

// Outgoing interpolation of a keyframe. Read from the EARLIER key of a bracketing pair, matching
// v3 lib/clip.ts.
export const EASE_VALUES = ["linear", "ease", "hold"] as const;
const easeSchema = z.enum(EASE_VALUES);
export type Ease = z.infer<typeof easeSchema>;

export const CLIP_SOURCE_VALUES = ["model", "edited", "critique", "imported"] as const;
const clipSourceSchema = z.enum(CLIP_SOURCE_VALUES);
export type ClipSource = z.infer<typeof clipSourceSchema>;

// The six pipeline stages. Each is an idempotent worker keyed by content hash.
export const STAGE_NAME_VALUES = ["decompose", "semantics", "rig", "animate", "render", "critique"] as const;
const stageNameSchema = z.enum(STAGE_NAME_VALUES);
export type StageName = z.infer<typeof stageNameSchema>;

export const STAGE_STATUS_VALUES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
const stageStatusSchema = z.enum(STAGE_STATUS_VALUES);
export type StageStatus = z.infer<typeof stageStatusSchema>;

// The closed set of edits the critique pass may request. Every one of them is a SEMANTIC or
// PARAMETRIC nudge — none of them can introduce geometry (R2/R3).
export const CORRECTION_KIND_VALUES = ["pivot-nudge", "rotation-damp", "z-order", "deformer-swap", "parent-change", "keyframe-retime", "part-visibility", "abort"] as const;
const correctionKindSchema = z.enum(CORRECTION_KIND_VALUES);
export type CorrectionKind = z.infer<typeof correctionKindSchema>;

// The generation seam. `external-prompt-only` is the only mode a build may serve while
// AniBuddyConfig.generationEnabled is false; the enum carries `in-app-generated` so turning it on
// later is a config change plus a validator branch, not a schema migration.
export const GENERATION_MODE_VALUES = ["external-prompt-only", "in-app-generated"] as const;
const generationModeSchema = z.enum(GENERATION_MODE_VALUES);
export type GenerationMode = z.infer<typeof generationModeSchema>;

export const BUFFER_DTYPE_VALUES = ["f32", "u32"] as const;
const bufferDtypeSchema = z.enum(BUFFER_DTYPE_VALUES);
export type BufferDtype = z.infer<typeof bufferDtypeSchema>;

// `inline` carries the numbers in the document (wire and preview). `external` carries a
// StorageAdapter key instead, because a 1200-vertex weight matrix per part times 64 parts will not
// fit a 16MB Mongo document.
export const BUFFER_STORAGE_VALUES = ["inline", "external"] as const;
const bufferStorageSchema = z.enum(BUFFER_STORAGE_VALUES);
export type BufferStorage = z.infer<typeof bufferStorageSchema>;

// A 2D point. Its coordinate space is stated by the field that holds it — never inferred.
const vec2Schema = z.object({ x: z.number(), y: z.number() }).strict();
export type Vec2 = z.infer<typeof vec2Schema>;

// Axis-aligned rectangle, sheet-normalized 0..1 (R6).
const rectSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict();
export type Rect = z.infer<typeof rectSchema>;

// A flat numeric payload that is either inline or behind a StorageAdapter key. `sha256` is over
// the little-endian bytes of the payload as `dtype` and is the buffer's IDENTITY everywhere
// downstream: it names the stored object, it keys the render cache, and it is what the kernel
// fixture corpus compares against. THE EXTERNAL ROUND TRIP, which is a contract and not an
// implementation detail: (1) a producer that exceeds MAX_INLINE_BUFFER_ELEMENTS emits `storage:
// "external"`, `values: null` and a content-addressed `storageKey`; (2) only the Node gateway
// holds StorageAdapter credentials, so it is Node that uploads those bytes and rewrites
// `storageKey` to the key the adapter returned — no other process may invent one; (3) a Python
// stage that has to READ external geometry cannot fetch it, so Node sends the bytes back alongside
// the document as multipart FILE parts under the `buffers` field, each part named by its own
// `sha256`; (4) the receiver re-hashes every uploaded part and refuses any whose bytes disagree
// with the name, before decoding — bytes that do not match the hash are the wrong bytes whatever
// they decode to; (5) rehydration is IN MEMORY ONLY. The external reference stays the document's
// canonical form, and a stage that writes a child revision must restore it, or a payload that
// exists precisely because it does not fit a Mongo document travels back as the payload itself.
const numericBufferSchema = z.object({ dtype: bufferDtypeSchema, storage: bufferStorageSchema, length: z.number().int().min(0).max(4000000), sha256: z.string().regex(/^[a-f0-9]{64}$/), values: z.array(z.number()).nullable(), storageKey: z.string().max(512).nullable() }).strict();
export type NumericBuffer = z.infer<typeof numericBufferSchema>;

// The part is the whole rectangle. The degenerate case, and what a v4 grid-sliced sprite region
// imports as.
const maskRectSchema = z.object({ kind: z.literal("rect") }).strict();
export type MaskRect = z.infer<typeof maskRectSchema>;

// The part is every pixel inside `Part.rect` whose alpha exceeds the threshold. ALPHA_FLOOR 24 is
// the repo-wide default and is shared with prepare.ts and rigCore.
const maskAlphaThresholdSchema = z.object({ kind: z.literal("alpha-threshold"), threshold: z.number().int().min(0).max(255) }).strict();
export type MaskAlphaThreshold = z.infer<typeof maskAlphaThresholdSchema>;

// Explicit outline plus holes, part-local normalized (R6). What contour tracing emits when a part
// is cleanly separable.
const maskPolygonSchema = z.object({ kind: z.literal("polygon"), outline: numericBufferSchema, holes: z.array(numericBufferSchema).max(32) }).strict();
export type MaskPolygon = z.infer<typeof maskPolygonSchema>;

// Run-length encoded binary mask in PIXELS, column-major from the mask origin. What watershed and
// grabCut emit for parts that touch or overlap, where no polygon is faithful.
const maskRleSchema = z.object({ kind: z.literal("rle"), origin: vec2Schema, width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), counts: numericBufferSchema }).strict();
export type MaskRle = z.infer<typeof maskRleSchema>;

// Reversible pixel selection. Inherited from the v4 rule that a mask is a DESCRIPTION, never baked
// pixels — it is what lets a user reopen a decomposition and correct it.
const maskSchema = z.discriminatedUnion("kind", [maskRectSchema, maskAlphaThresholdSchema, maskPolygonSchema, maskRleSchema]);
export type Mask = z.infer<typeof maskSchema>;

// A separation the triangulator will not cross and across which bone distance is infinite. Ported
// verbatim in meaning from v3; now scoped to one part instead of the whole figure.
const cutLineSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), points: numericBufferSchema }).strict();
export type CutLine = z.infer<typeof cutLineSchema>;

// No deformation. The part's own `Part.rect` is drawn as two triangles under the transform of
// `Part.boundJointId`. Cheapest path, and correct for anything that is drawn as a solid object: a
// wheel, a shield, a UI badge. It carries NO fields of its own by design: the rectangle it draws
// and the joint it rides are already on the part, and a second copy on the deformer is a second
// thing to keep in step. A consumer MUST read both off `Part` — a kernel struct that stores its
// own `rect` or `bindJoint` has re-declared part state and will drift from it.
const deformerRigidSchema = z.object({ kind: z.literal("rigid") }).strict();
export type DeformerRigid = z.infer<typeof deformerRigidSchema>;

// Triangle mesh plus linear blend skinning. The v3 path, now per-part. Vertex, triangle and weight
// payloads are part-local normalized (R6).
const deformerMeshSchema = z.object({ kind: z.literal("mesh"), verts: numericBufferSchema, tris: numericBufferSchema, boneIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}->[A-Za-z0-9_-]{1,32}$/)).max(32), weights: numericBufferSchema, cuts: z.array(cutLineSchema).max(16) }).strict();
export type DeformerMesh = z.infer<typeof deformerMeshSchema>;

// Free-form quad-grid deformation. Right for soft sheets with no skeleton of their own — a cape,
// hair, a flag, cloth, a parallax layer that should billow. The displaced grid is then carried by
// `Part.boundJointId` so a lattice part still follows the skeleton; like `rigid`, this deformer
// stores neither the rect nor the bound joint, because both already live on the part.
const deformerLatticeSchema = z.object({ kind: z.literal("lattice"), cols: z.number().int().min(1).max(16), rows: z.number().int().min(1).max(16), controlPoints: numericBufferSchema, interpolation: z.enum(["bilinear", "bicubic"]) }).strict();
export type DeformerLattice = z.infer<typeof deformerLatticeSchema>;

// A tapering ribbon along a spine, for anything long that bends down its length — a tail, a
// tentacle, a rope, a hose, a smoke trail. THE SPINE IS THE PART'S JOINT CHAIN, and that is the
// whole design: a tail needs a joint chain to be posable at all, so reusing it as the spline's
// control polyline means the spline is animated by ordinary forward kinematics and needs no
// deformer-specific animation channels. There is deliberately no stored control polyline here. An
// earlier draft carried a cubic bezier chain as well; it was removed because nothing could pose it
// — a static polyline has no channels — so it was authored, never read, and free to drift from the
// joints that actually drove the render. THE CHAIN DERIVATION, which every consumer MUST implement
// identically: take the joints whose `partId` is this part; the HEAD is the one whose `parent` is
// not itself a member of that set; follow child links from the head, taking at each step the
// member joint whose `parent` is the current one, until no member remains. That yields the chain
// head-to-tail. Order is load-bearing rather than cosmetic — the ribbon's shape is the sequence of
// its control points, and a reordered chain produces a ribbon folded back on itself. Fewer than
// two resolvable joints means the part cannot be splined and MUST be downgraded to `rigid` with a
// stated reason, never rendered as an empty ribbon. The rest ribbon and the posed ribbon are
// evaluated by the same function over the rest and posed chains respectively, which is what makes
// the artwork slide ALONG the curve instead of swimming across it.
const deformerSplineSchema = z.object({ kind: z.literal("spline"), thickness: numericBufferSchema, samples: z.number().int().min(2).max(256) }).strict();
export type DeformerSpline = z.infer<typeof deformerSplineSchema>;

// Exactly one of the four deformation models, tagged on `kind`.
const deformerSchema = z.discriminatedUnion("kind", [deformerRigidSchema, deformerMeshSchema, deformerLatticeSchema, deformerSplineSchema]);
export type Deformer = z.infer<typeof deformerSchema>;

// A named attachment point this part OFFERS to children. A child references it by name through
// Part.attachSlot, so a sword can move from hand to back without either part learning about the
// other's geometry.
const slotSchema = z.object({ name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), position: vec2Schema }).strict();
export type Slot = z.infer<typeof slotSchema>;

// One cutout layer. The unit of decomposition, of draw order, of attachment, and of deformation.
const partSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), name: z.string().min(1).max(80), role: partRoleSchema, mask: maskSchema, rect: rectSchema, pivot: vec2Schema, zIndex: z.number().int().min(-512).max(512), parentPartId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), attachSlot: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), slots: z.array(slotSchema).max(8), deformer: deformerSchema, boundJointId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), visible: z.boolean(), opacity: z.number().min(0).max(1), confidence: z.number().min(0).max(1), provenance: partProvenanceSchema }).strict();
export type Part = z.infer<typeof partSchema>;

// A node of the free-form skeleton. Kept from v3 almost verbatim; the one structural change is
// `partId` — joints now bind to a part rather than to one global mesh.
const jointSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), name: z.string().min(1).max(80), role: jointRoleSchema, x: z.number().min(0).max(1), y: z.number().min(0).max(1), parent: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), partId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), ikChainLength: z.number().int().min(1).max(4).nullable(), confidence: z.number().min(0).max(1) }).strict();
export type Joint = z.infer<typeof jointSchema>;

// The joint graph. Bones are DERIVED from it and never stored as objects — only their ids appear,
// as DeformerMesh.boneIds. THE DERIVATION, which every consumer MUST reproduce exactly: walk
// `joints` in document order and emit one bone `parentId->childId` for each joint that has a
// resolvable parent, skipping the root and any joint whose parent is missing. That order is the
// order weight-matrix columns are named against, so it is a contract rather than an implementation
// choice — but a consumer still permutes `DeformerMesh.boneIds` by name into it rather than
// trusting the positions to line up, because the skeleton is free to gain a joint after a matrix
// was solved.
const skeletonSchema = z.object({ joints: z.array(jointSchema).min(0).max(96) }).strict();
export type Skeleton = z.infer<typeof skeletonSchema>;

// One joint's LOCAL delta at a keyframe. Every channel optional; absent means unchanged from rest.
// That sparsity is load-bearing — a key that only mentions the tail must not snap every other
// joint.
const jointPoseSchema = z.object({ rot: z.number().min(-180).max(180).optional(), tx: z.number().min(-1).max(1).optional(), ty: z.number().min(-1).max(1).optional(), scale: z.number().min(0.05).max(4).optional() }).strict();
export type JointPose = z.infer<typeof jointPoseSchema>;

// One part's LOCAL delta at a keyframe. Same sparsity rule as JointPose. The last four channels
// are new in v5 and are what make sprite swapping, layered reveals and mid-clip draw-order changes
// expressible — the v4 MotionProgram track types, folded into one keyframe model. REST FOR A
// COMPOSITING CHANNEL IS THE PART'S OWN AUTHORED VALUE, AND A KEY REPLACES IT RATHER THAN SCALING
// IT. `Part.visible`, `Part.opacity` and `Part.zIndex` ARE the rest values of `visible`, `opacity`
// and `zIndex` here, in exactly the sense 0 is the rest value of `rot`. Three consequences, stated
// because each one is a place two implementations can silently disagree: (1) a clip that never
// mentions the channel composites the part exactly as authored; (2) a channel present in only ONE
// of the two bracketing keys blends against the part's authored value, not against a schema-wide
// constant, so a part drawn at 0.5 that is keyed to 1 at the end of a clip ramps 0.5 → 1; (3) a
// resolved opacity is NEVER multiplied by `Part.opacity` — multiplying would make it impossible
// for a keyframe to drive a translucent part to full opacity, and would make `opacity` the only
// channel in the schema whose static field is a gain rather than a rest. `swapTo` has no static
// counterpart, so its rest is "no swap". The four geometry channels (`rot`, `tx`, `ty`, `scale`)
// keep the schema-wide rests, because a part has no authored `rot` for them to fall back to.
const partPoseSchema = z.object({ rot: z.number().min(-180).max(180).optional(), tx: z.number().min(-1).max(1).optional(), ty: z.number().min(-1).max(1).optional(), scale: z.number().min(0.05).max(4).optional(), visible: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(), zIndex: z.number().int().min(-512).max(512).optional(), swapTo: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional() }).strict();
export type PartPose = z.infer<typeof partPoseSchema>;

// A sparse pose sample. Interpolation is per-channel between the two bracketing keys; a channel
// present in only one of them blends against its REST value — 0 for rot/tx/ty, 1 for scale, and
// for a PartPose's compositing channels the part's own authored `visible`/`opacity`/`zIndex`
// rather than a schema-wide constant (see PartPose). Every channel of every kind brackets through
// the same search, so a part's opacity and a joint's rotation sampled from this clip at the same
// instant can never land on different keys.
const keyframeSchema = z.object({ t: z.number().min(0).max(1), ease: easeSchema, joints: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), jointPoseSchema), parts: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), partPoseSchema) }).strict();
export type Keyframe = z.infer<typeof keyframeSchema>;

// One named motion. `fps` and `frameCount` are the clip's sampling rate, not its content.
const clipSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), name: z.string().min(1).max(80), request: z.string().max(500), loop: z.boolean(), fps: z.number().int().min(1).max(60), frameCount: z.number().int().min(2).max(120), keyframes: z.array(keyframeSchema).min(0).max(32), source: clipSourceSchema }).strict();
export type Clip = z.infer<typeof clipSchema>;

// The source sheet. Referenced, never embedded and never edited.
const assetRefSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string().min(1).max(200), storageKey: z.string().min(1).max(512), contentHash: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), figureHeight: z.number().min(1).max(8192).nullable(), mimeType: z.enum(["image/png", "image/webp", "image/jpeg"]), rightsConfirmed: z.boolean(), remoteVisionConsented: z.boolean() }).strict();
export type AssetRef = z.infer<typeof assetRefSchema>;

const qaTurnSchema = z.object({ question: z.string().max(1000), answer: z.string().max(1000) }).strict();
export type QaTurn = z.infer<typeof qaTurnSchema>;

// Who made the source sheet. While generationEnabled is false the validator requires `kind:
// external-tool`, which is the machine-checkable form of R2.
const generationProducedBySchema = z.object({ kind: z.enum(["user-supplied", "external-tool", "in-app-model"]), modelId: z.string().max(120).nullable(), at: z.string().datetime() }).strict();
export type GenerationProducedBy = z.infer<typeof generationProducedBySchema>;

// Everything about where the pixels came from, isolated in one object so enabling in-app
// generation later touches this object, one config flag and one validator branch — and nothing
// else.
const generationSeamSchema = z.object({ mode: generationModeSchema, prompt: z.string().max(4000).nullable(), transcript: z.array(qaTurnSchema).max(6), producedBy: generationProducedBySchema.nullable() }).strict();
export type GenerationSeam = z.infer<typeof generationSeamSchema>;

// One execution of one pipeline stage. The audit trail that makes a rig explainable and a bill
// defensible.
const stageRecordSchema = z.object({ stage: stageNameSchema, status: stageStatusSchema, startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), inputHash: z.string().regex(/^[a-f0-9]{64}$/), passIndex: z.number().int().min(0).max(8), modelId: z.string().max(120).nullable(), usageEventId: z.string().regex(/^[a-f0-9]{24}$/).nullable(), creditsSpent: z.number().int().min(0).max(1000), message: z.string().max(2000).nullable() }).strict();
export type StageRecord = z.infer<typeof stageRecordSchema>;

const documentProvenanceSchema = z.object({ pipelineVersion: z.string().max(40), kernelVersion: z.string().max(40), stages: z.array(stageRecordSchema).max(64) }).strict();
export type DocumentProvenance = z.infer<typeof documentProvenanceSchema>;

// What the pipeline measured. Server-authoritative: authored only by the Python validator, never
// by the browser and never by a model.
const diagnosticsSchema = z.object({ foregroundPixels: z.number().int().min(0), coveredForegroundPixels: z.number().int().min(0), overlappingPartPairs: z.array(z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).min(2).max(2)).max(256), maxStretch: z.number().min(0), flippedTriangles: z.number().int().min(0), isolatedVertices: z.number().int().min(0), warnings: z.array(z.string().max(500)).max(64), blockingReason: z.string().max(500).nullable() }).strict();
export type Diagnostics = z.infer<typeof diagnosticsSchema>;

// Immutable parent-linked revisions, kept from v4. A stage never mutates a document in place; it
// writes a child revision, so every correction is reversible and the editor can diff two passes.
const revisionLinkSchema = z.object({ index: z.number().int().min(0).max(4096), parentRevisionId: z.string().max(64).nullable(), reason: z.string().max(200), accepted: z.boolean() }).strict();
export type RevisionLink = z.infer<typeof revisionLinkSchema>;

// The whole contract. One document is one revision of one asset's rig.
const rigDocumentSchema = z.object({ schemaVersion: z.literal(5), id: z.string().min(1).max(64), projectId: z.string().min(1).max(64), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revision: revisionLinkSchema, archetype: archetypeSchema, asset: assetRefSchema, parts: z.array(partSchema).min(0).max(64), skeleton: skeletonSchema, clips: z.array(clipSchema).max(16), generation: generationSeamSchema, provenance: documentProvenanceSchema, diagnostics: diagnosticsSchema }).strict();
export type RigDocument = z.infer<typeof rigDocumentSchema>;

// What the vision model is allowed to say about one part. Note what is absent: no mask, no rect,
// no vertices, no weights. The model proposes SEMANTICS ONLY (R3).
const proposedPartSemanticsSchema = z.object({ partId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), role: partRoleSchema, parentPartId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), attachSlot: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), pivotHint: vec2Schema, zIndex: z.number().int().min(-512).max(512), deformerHint: deformerKindSchema, confidence: z.number().min(0).max(1) }).strict();
export type ProposedPartSemantics = z.infer<typeof proposedPartSemanticsSchema>;

// A joint the model believes exists. Position is normalized and advisory; the rig stage validates
// it against the part's mask and rejects joints that fall on empty pixels.
const proposedJointSemanticsSchema = z.object({ jointId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), name: z.string().min(1).max(80), role: jointRoleSchema, partId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), parent: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export type ProposedJointSemantics = z.infer<typeof proposedJointSemanticsSchema>;

// The strict response schema of the `semantics` stage's vision call. Revalidated server-side; a
// structural failure rejects the WHOLE response and refunds (R7), because a partially repaired
// graph animates wrongly while looking plausible.
const semanticsProposalSchema = z.object({ archetype: archetypeSchema, parts: z.array(proposedPartSemanticsSchema).min(1).max(64), joints: z.array(proposedJointSemanticsSchema).min(0).max(96), warnings: z.array(z.string().max(500)).max(32) }).strict();
export type SemanticsProposal = z.infer<typeof semanticsProposalSchema>;

// The strict response schema of the `animate` stage. Keyframes reference REAL part and joint ids
// from the built rig; an unknown id rejects the whole response.
const motionProposalSchema = z.object({ name: z.string().min(1).max(80), loop: z.boolean(), fps: z.number().int().min(1).max(60), frameCount: z.number().int().min(2).max(120), keyframes: z.array(keyframeSchema).min(2).max(32), warnings: z.array(z.string().max(500)).max(32) }).strict();
export type MotionProposal = z.infer<typeof motionProposalSchema>;

// One requested change from a critique pass. Every field the model may set is a small bounded
// scalar or an id — there is no field here through which geometry can enter.
const correctionSchema = z.object({ kind: correctionKindSchema, targetId: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).nullable(), reason: z.string().min(1).max(300), vec2: vec2Schema.nullable(), scalar: z.number().min(0).max(1).nullable(), intValue: z.number().int().min(-512).max(512).nullable(), deformerKind: deformerKindSchema.nullable(), stringValue: z.string().max(64).nullable() }).strict();
export type Correction = z.infer<typeof correctionSchema>;

// The strict response schema of the `critique` stage, produced after the model VIEWS a contact
// sheet of really-rendered frames. `verdict: accept` ends the loop; `abort` ends it without
// spending another pass.
const critiqueReportSchema = z.object({ verdict: z.enum(["accept", "revise", "abort"]), passIndex: z.number().int().min(0).max(8), observations: z.array(z.string().max(500)).max(16), corrections: z.array(correctionSchema).max(12) }).strict();
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;

/** Every cap and epsilon the pipeline agrees on. Rule 9: import from here,
 *  never re-declare a literal at a call site. */
export const ANIBUDDY_LIMITS = {
  ALPHA_FLOOR: 24,
  CONFIDENCE_REVIEW_FLOOR: 0.55,
  CRITIQUE_CONTACT_SHEET_FRAMES: 9,
  CRITIQUE_CREDIT_CEILING: 24,
  CRITIQUE_MAX_PIVOT_NUDGE: 0.08,
  CRITIQUE_MIN_ROTATION_DAMP: 0.25,
  MAX_BONES_PER_PART: 32,
  MAX_CLIPS: 16,
  MAX_CORRECTIONS_PER_PASS: 12,
  MAX_CRITIQUE_PASSES: 3,
  MAX_CUTS_PER_PART: 16,
  MAX_FPS: 60,
  MAX_FRAMES: 120,
  MAX_INLINE_BUFFER_ELEMENTS: 4096,
  MAX_INTERVIEW_ROUNDS: 6,
  MAX_JOINT_DEPTH: 12,
  MAX_JOINTS: 96,
  MAX_KEYFRAMES: 32,
  MAX_LATTICE_COLS: 16,
  MAX_LATTICE_ROWS: 16,
  MAX_MASK_HOLES: 32,
  MAX_PART_DEPTH: 8,
  MAX_PARTS: 64,
  MAX_SLOTS_PER_PART: 8,
  MAX_SOURCE_EDGE: 8192,
  MAX_SPLINE_SAMPLES: 256,
  MAX_STAGE_RECORDS: 64,
  MAX_TRIS_PER_PART: 2400,
  MAX_VERTS_PER_PART: 1200,
  MIN_JOINTS: 0,
  MIN_PARTS: 1,
  MIN_TRIANGLE_AREA: 0.0001,
  PROPOSAL_RETRY_LIMIT: 1,
  SCHEMA_VERSION: 5,
  SEAM_BLEED_PX: 0.5,
  SKIN_FALLOFF: 4,
  SKIN_TOP_K: 4,
  STRETCH_WARNING: 2.5,
  WEIGHT_ROW_EPSILON: 0.001,
} as const;

/** Rule 16: one PascalCase object, one named export, methods and members
 *  declared directly inside it. */
export const AniBuddyRigDocumentDto = {
  archetype: archetypeSchema,
  partRole: partRoleSchema,
  jointRole: jointRoleSchema,
  deformerKind: deformerKindSchema,
  maskKind: maskKindSchema,
  partProvenance: partProvenanceSchema,
  ease: easeSchema,
  clipSource: clipSourceSchema,
  stageName: stageNameSchema,
  stageStatus: stageStatusSchema,
  correctionKind: correctionKindSchema,
  generationMode: generationModeSchema,
  bufferDtype: bufferDtypeSchema,
  bufferStorage: bufferStorageSchema,
  vec2: vec2Schema,
  rect: rectSchema,
  numericBuffer: numericBufferSchema,
  maskRect: maskRectSchema,
  maskAlphaThreshold: maskAlphaThresholdSchema,
  maskPolygon: maskPolygonSchema,
  maskRle: maskRleSchema,
  mask: maskSchema,
  cutLine: cutLineSchema,
  deformerRigid: deformerRigidSchema,
  deformerMesh: deformerMeshSchema,
  deformerLattice: deformerLatticeSchema,
  deformerSpline: deformerSplineSchema,
  deformer: deformerSchema,
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
