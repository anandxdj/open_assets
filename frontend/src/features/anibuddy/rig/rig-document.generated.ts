//
// GENERATED FILE — DO NOT EDIT.
//
// Source:    schemas/anibuddy/rig-document.v5.schema.json
// Regenerate: pnpm --dir backend schema:anibuddy
//
// Every hand edit here is erased on the next run, and CI fails the build in
// the meantime. Change the JSON Schema instead.
//

// The browser is a thin editor over this contract: it may pose and preview a
// RigDocument, but every field here is authored server-side by the Python
// geometry service. Treat an instance as read-only except through an API call.

// Which rig prior applies. Drives the role vocabulary the semantics model may use and the default
// deformer per role.
export const ARCHETYPE_VALUES = ["humanoid", "creature", "mechanical", "prop", "environment", "ui"] as const;
export type Archetype = (typeof ARCHETYPE_VALUES)[number];

// What a cutout part IS. Closed set across all six archetypes — the vision model picks from it and
// never invents a role. Roles select the default deformer and the motion priors.
export const PART_ROLE_VALUES = ["root", "head", "face", "hair", "torso", "pelvis", "armUpper", "armLower", "hand", "legUpper", "legLower", "foot", "eye", "jaw", "ear", "cape", "accessory", "neck", "tail", "wing", "fin", "horn", "paw", "snout", "shell", "tentacle", "chassis", "wheel", "track", "turret", "barrel", "piston", "hatch", "rotor", "thruster", "antenna", "prop", "weapon", "projectile", "effect", "spark", "smoke", "trail", "skyLayer", "backgroundLayer", "midgroundLayer", "foregroundLayer", "cloud", "foliage", "waterLayer", "logoMark", "logoText", "icon", "badge", "panel", "glyph", "underlay", "other"] as const;
export type PartRole = (typeof PART_ROLE_VALUES)[number];

// What a joint IS. The first thirteen entries are the v3 JointRole set verbatim and in order, so a
// v3 rig imports without remapping. The remainder cover the five non-humanoid archetypes.
export const JOINT_ROLE_VALUES = ["root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower", "limbTip", "tail", "wing", "ear", "prop", "other", "neck", "digit", "fin", "horn", "tentacleSegment", "hinge", "wheel", "piston", "slider", "layer", "anchor"] as const;
export type JointRole = (typeof JOINT_ROLE_VALUES)[number];

// The four per-part deformation models. Chosen from the part role by the archetype prior, always
// overridable by the user.
export const DEFORMER_KIND_VALUES = ["rigid", "mesh", "lattice", "spline"] as const;
export type DeformerKind = (typeof DEFORMER_KIND_VALUES)[number];

// How a part's pixels are selected out of the source sheet. Every kind is a REVERSIBLE
// description; the source sheet is never edited.
export const MASK_KIND_VALUES = ["rect", "polygon", "rle", "alpha-threshold"] as const;
export type MaskKind = (typeof MASK_KIND_VALUES)[number];

// Which stage or actor produced this part, so the editor can show what was guessed versus
// confirmed.
export const PART_PROVENANCE_VALUES = ["alpha-component", "gutter-grid", "watershed", "grabcut", "vision", "manual", "imported-v3", "imported-v4"] as const;
export type PartProvenance = (typeof PART_PROVENANCE_VALUES)[number];

// Outgoing interpolation of a keyframe. Read from the EARLIER key of a bracketing pair, matching
// v3 lib/clip.ts.
export const EASE_VALUES = ["linear", "ease", "hold"] as const;
export type Ease = (typeof EASE_VALUES)[number];

export const CLIP_SOURCE_VALUES = ["model", "edited", "critique", "imported"] as const;
export type ClipSource = (typeof CLIP_SOURCE_VALUES)[number];

// The six pipeline stages. Each is an idempotent worker keyed by content hash.
export const STAGE_NAME_VALUES = ["decompose", "semantics", "rig", "animate", "render", "critique"] as const;
export type StageName = (typeof STAGE_NAME_VALUES)[number];

export const STAGE_STATUS_VALUES = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type StageStatus = (typeof STAGE_STATUS_VALUES)[number];

// The closed set of edits the critique pass may request. Every one of them is a SEMANTIC or
// PARAMETRIC nudge — none of them can introduce geometry (R2/R3).
export const CORRECTION_KIND_VALUES = ["pivot-nudge", "rotation-damp", "z-order", "deformer-swap", "parent-change", "keyframe-retime", "part-visibility", "abort"] as const;
export type CorrectionKind = (typeof CORRECTION_KIND_VALUES)[number];

// The generation seam. `external-prompt-only` is the only mode a build may serve while
// AniBuddyConfig.generationEnabled is false; the enum carries `in-app-generated` so turning it on
// later is a config change plus a validator branch, not a schema migration.
export const GENERATION_MODE_VALUES = ["external-prompt-only", "in-app-generated"] as const;
export type GenerationMode = (typeof GENERATION_MODE_VALUES)[number];

export const BUFFER_DTYPE_VALUES = ["f32", "u32"] as const;
export type BufferDtype = (typeof BUFFER_DTYPE_VALUES)[number];

// `inline` carries the numbers in the document (wire and preview). `external` carries a
// StorageAdapter key instead, because a 1200-vertex weight matrix per part times 64 parts will not
// fit a 16MB Mongo document.
export const BUFFER_STORAGE_VALUES = ["inline", "external"] as const;
export type BufferStorage = (typeof BUFFER_STORAGE_VALUES)[number];

// A 2D point. Its coordinate space is stated by the field that holds it — never inferred.
export interface Vec2 {
  x: number;
  y: number;
}

// Axis-aligned rectangle, sheet-normalized 0..1 (R6).
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
export interface NumericBuffer {
  dtype: BufferDtype;
  storage: BufferStorage;
  // Element count, not byte count. Authoritative for both storage modes: a rehydrated external
  // buffer whose decoded element count disagrees with this is refused.
  length: number;
  sha256: string;
  // The numbers themselves when storage is `inline`. MUST be null when storage is `external` — a
  // consumer that finds null here has to either fetch by `storageKey` or refuse; it may never read
  // it as an empty buffer, because an empty weight matrix renders as a collapsed part rather than
  // as an error.
  values: number[] | null;
  // The StorageAdapter key when storage is `external`; null otherwise. Kept even on a buffer that
  // has been rehydrated inline for a stage's own arithmetic, because it is where the bytes really
  // live and dropping it would let a rehydrated copy be stored back as an inline document.
  storageKey: string | null;
}

// The part is the whole rectangle. The degenerate case, and what a v4 grid-sliced sprite region
// imports as.
export interface MaskRect {
  kind: "rect";
}

// The part is every pixel inside `Part.rect` whose alpha exceeds the threshold. ALPHA_FLOOR 24 is
// the repo-wide default and is shared with prepare.ts and rigCore.
export interface MaskAlphaThreshold {
  kind: "alpha-threshold";
  threshold: number;
}

// Explicit outline plus holes, part-local normalized (R6). What contour tracing emits when a part
// is cleanly separable.
export interface MaskPolygon {
  kind: "polygon";
  outline: NumericBuffer;
  holes: NumericBuffer[];
}

// Run-length encoded binary mask in PIXELS, column-major from the mask origin. What watershed and
// grabCut emit for parts that touch or overlap, where no polygon is faithful.
export interface MaskRle {
  kind: "rle";
  // Top-left of the RLE grid in SOURCE PIXELS.
  origin: Vec2;
  width: number;
  height: number;
  // Alternating run lengths starting with a background run.
  counts: NumericBuffer;
}

// Reversible pixel selection. Inherited from the v4 rule that a mask is a DESCRIPTION, never baked
// pixels — it is what lets a user reopen a decomposition and correct it.
export type Mask = MaskRect | MaskAlphaThreshold | MaskPolygon | MaskRle;

// A separation the triangulator will not cross and across which bone distance is infinite. Ported
// verbatim in meaning from v3; now scoped to one part instead of the whole figure.
export interface CutLine {
  id: string;
  // Flat [x0,y0,x1,y1,...] part-local normalized polyline, at least two points.
  points: NumericBuffer;
}

// No deformation. The part's own `Part.rect` is drawn as two triangles under the transform of
// `Part.boundJointId`. Cheapest path, and correct for anything that is drawn as a solid object: a
// wheel, a shield, a UI badge. It carries NO fields of its own by design: the rectangle it draws
// and the joint it rides are already on the part, and a second copy on the deformer is a second
// thing to keep in step. A consumer MUST read both off `Part` — a kernel struct that stores its
// own `rect` or `bindJoint` has re-declared part state and will drift from it.
export interface DeformerRigid {
  kind: "rigid";
}

// Triangle mesh plus linear blend skinning. The v3 path, now per-part. Vertex, triangle and weight
// payloads are part-local normalized (R6).
export interface DeformerMesh {
  kind: "mesh";
  // f32, flat [x,y,...], part-local normalized 0..1.
  verts: NumericBuffer;
  // u32, flat [i0,i1,i2,...] indices into verts.
  tris: NumericBuffer;
  // THE COLUMN ORDER OF `weights`, one entry per column, each `parentJointId->childJointId`. This
  // is not a hint and not a subset marker: column `c` of the weight matrix is the influence of
  // `boneIds[c]`, full stop. Bones themselves are still derived from the joint tree and never
  // stored as objects (v3 rule) — what is stored here is the ORDER, because that is the only part
  // of a derivation the document cannot reconstruct once the skeleton has moved on. A CONSUMER
  // MUST PERMUTE BY NAME into whatever bone order it derives, and MUST NEVER assume column `c`
  // corresponds to its own derived bone `c`; the two coincide only for a rig whose skeleton has
  // not changed since the weights were solved, which is exactly the case that needs no
  // permutation. A name that the consumer's own derivation does not produce MUST be REFUSED, never
  // dropped and never skipped: dropping a column shifts every later column by one and rebinds
  // every vertex that used it to a neighbouring bone, which renders as a plausible figure with one
  // limb driven by the wrong joint. This field is the difference between that failure being loud
  // and being invisible.
  boneIds: string[];
  // f32, row-major vertCount x boneIds.length, every row summing to 1 within WEIGHT_ROW_EPSILON.
  // Linear blend skinning is an affine combination, so a row summing to 0.5 places its vertex
  // halfway to the origin rather than merely underweighting it — which is why the tolerance is a
  // blocking condition and not a warning.
  weights: NumericBuffer;
  cuts: CutLine[];
}

// Free-form quad-grid deformation. Right for soft sheets with no skeleton of their own — a cape,
// hair, a flag, cloth, a parallax layer that should billow. The displaced grid is then carried by
// `Part.boundJointId` so a lattice part still follows the skeleton; like `rigid`, this deformer
// stores neither the rect nor the bound joint, because both already live on the part.
export interface DeformerLattice {
  kind: "lattice";
  cols: number;
  rows: number;
  // f32, flat [x,y,...] of (cols+1)*(rows+1) ABSOLUTE positions, part-local normalized (R6), in
  // ROW-MAJOR order — rows outer, index `j * (cols + 1) + i`. Absolute rather than
  // displacements-from-rest is the canonical form and consumers MUST keep it: it is what an editor
  // drags, it is what the rig stage authors, and the rest grid it would be differenced against
  // (exactly uniform over `Part.rect`, so control point `(i, j)` rests at `(i / cols, j / rows)`)
  // is a reconstruction each consumer would otherwise have to perform identically. Two
  // reconstructions of one grid is two chances to disagree about it, in the one place where
  // disagreement reads as the artwork shearing at rest.
  controlPoints: NumericBuffer;
  interpolation: "bilinear" | "bicubic";
}

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
export interface DeformerSpline {
  kind: "spline";
  // f32 TAPER TRACK: at least one half-width, normalized against the GEOMETRIC MEAN of
  // `Part.rect`'s pixel dimensions. The axis has to be declared rather than inferred (R6) because
  // a single scalar cannot be exact in an anisotropic part-local space, and the geometric mean is
  // the only choice that does not silently assume the ribbon runs horizontally or vertically. The
  // rig producer and the render consumer are commented on both sides that this must not drift. The
  // track is indexed by NORMALIZED POSITION ALONG THE SPINE, not by joint: with `m` entries, the
  // half-width at curve parameter `u` in 0..1 is the linear interpolation of the track at `u * (m
  // - 1)`. Decoupling the track's length from the chain's is what lets a chain shortened by the
  // joint budget still taper correctly, and `m = 1` is a legitimate uniform ribbon rather than a
  // special case.
  thickness: NumericBuffer;
  // Ribbon evaluation resolution: `samples` points along the spine, two ribbon vertices and
  // (samples - 1) quads. Fixed here rather than chosen per renderer, because browser preview and
  // server render must agree bit for bit (R4). Samples are spaced uniformly in PARAMETER, not in
  // arc length — an arc-length reparameterization needs an iterative solve whose convergence path
  // is one more thing two languages have to reproduce identically.
  samples: number;
}

// Exactly one of the four deformation models, tagged on `kind`.
export type Deformer = DeformerRigid | DeformerMesh | DeformerLattice | DeformerSpline;

// A named attachment point this part OFFERS to children. A child references it by name through
// Part.attachSlot, so a sword can move from hand to back without either part learning about the
// other's geometry.
export interface Slot {
  name: string;
  // Part-local normalized (R6).
  position: Vec2;
}

// One cutout layer. The unit of decomposition, of draw order, of attachment, and of deformation.
export interface Part {
  id: string;
  name: string;
  role: PartRole;
  mask: Mask;
  // The part's bounding box on the source sheet, sheet-normalized. Defines the part-local space
  // every deformer payload lives in.
  rect: Rect;
  // Rotation centre, part-local normalized. A hip is near (0.5, 0.1); a wheel is at its axle.
  pivot: Vec2;
  // Draw order, low first. Animatable through PartPose.zIndex, which is how a limb crosses in
  // front of a torso mid-clip. THIS FIELD IS THE REST VALUE of that channel: a clip that never
  // keys it leaves the part at this draw order. Ties are broken by document order, never by part
  // id — two parts sharing a z-index is a legitimate authoring state, and the artist's list order
  // is the only signal about which they meant in front.
  zIndex: number;
  // Transform parent in the cutout tree, or null for a root part. Acyclic, depth capped by
  // MAX_PART_DEPTH.
  parentPartId: string | null;
  // Name of a Slot on the parent part this part hangs from, or null to hang from the parent's
  // pivot.
  attachSlot: string | null;
  slots: Slot[];
  deformer: Deformer;
  // The joint whose transform drives this part as a unit. Read by the `rigid` deformer (which
  // draws `rect` under it) and by `lattice` (which carries its displaced grid under it); ignored
  // by `mesh`, which is driven per-vertex by its weight matrix, and by `spline`, which is driven
  // by its whole joint chain. NULL MEANS THE SKELETON ROOT, not "no transform": a part pinned to
  // nothing stays put while the figure around it moves, which reads as the part having come loose,
  // whereas riding the root means a global move still carries it and a root at rest is the
  // identity anyway. An id that the skeleton does not contain falls back the same way, with a
  // stated reason.
  boundJointId: string | null;
  // Whether the part composites at all. THIS FIELD IS THE REST VALUE of PartPose.visible — see
  // PartPose for the one rule all four compositing channels follow.
  visible: boolean;
  // Layer opacity, 0..1. THIS FIELD IS THE REST VALUE of PartPose.opacity, in exactly the sense 0
  // is the rest value of rot — see PartPose. A keyframe REPLACES it for the keyed span and is
  // NEVER multiplied by it, which is what lets a clip drive a part authored at 0.5 all the way to
  // 1.
  opacity: number;
  // How sure the producing stage is. Below CONFIDENCE_REVIEW_FLOOR the editor marks the part as
  // needing review rather than silently trusting it.
  confidence: number;
  provenance: PartProvenance;
}

// A node of the free-form skeleton. Kept from v3 almost verbatim; the one structural change is
// `partId` — joints now bind to a part rather than to one global mesh.
export interface Joint {
  id: string;
  name: string;
  role: JointRole;
  // Sheet-normalized 0..1 (R6).
  x: number;
  // Sheet-normalized 0..1 (R6).
  y: number;
  // Parent joint id, or null for the single root. Exactly one root across the skeleton, no cycles,
  // depth capped by MAX_JOINT_DEPTH.
  parent: string | null;
  // The part this joint articulates, or null for a pure structural joint such as the root.
  partId: string | null;
  // How many ancestors an IK drag on this joint may rotate, or null for FK only. Set by the
  // archetype prior on limbTip roles.
  ikChainLength: number | null;
  confidence: number;
}

// The joint graph. Bones are DERIVED from it and never stored as objects — only their ids appear,
// as DeformerMesh.boneIds. THE DERIVATION, which every consumer MUST reproduce exactly: walk
// `joints` in document order and emit one bone `parentId->childId` for each joint that has a
// resolvable parent, skipping the root and any joint whose parent is missing. That order is the
// order weight-matrix columns are named against, so it is a contract rather than an implementation
// choice — but a consumer still permutes `DeformerMesh.boneIds` by name into it rather than
// trusting the positions to line up, because the skeleton is free to gain a joint after a matrix
// was solved.
export interface Skeleton {
  joints: Joint[];
}

// One joint's LOCAL delta at a keyframe. Every channel optional; absent means unchanged from rest.
// That sparsity is load-bearing — a key that only mentions the tail must not snap every other
// joint.
export interface JointPose {
  // Degrees, local, positive is clockwise on screen.
  rot?: number;
  // Fraction of AssetRef.figureHeight — of the figure, not of the canvas, and the same denominator
  // on both axes so a translation cannot shear on a non-square sheet.
  tx?: number;
  // Fraction of AssetRef.figureHeight, as tx.
  ty?: number;
  scale?: number;
}

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
export interface PartPose {
  rot?: number;
  // Fraction of AssetRef.figureHeight, exactly as JointPose.tx.
  tx?: number;
  // Fraction of AssetRef.figureHeight, exactly as JointPose.ty.
  ty?: number;
  scale?: number;
  // Steps, never interpolates — there is no meaningful halfway between shown and hidden. Rest is
  // `Part.visible`.
  visible?: boolean;
  // Interpolates. Rest is `Part.opacity`, NOT 1: the resolved value replaces the part's authored
  // opacity rather than scaling it.
  opacity?: number;
  // Steps, never interpolates — there is no meaningful halfway between two draw orders. Rest is
  // `Part.zIndex`.
  zIndex?: number;
  // Id of another part whose PIXELS replace this one's for the rest of the segment. The v4
  // sprite-swap track, expressed as a channel. Steps, never interpolates; rest is no swap. ONLY
  // THE PIXELS CHANGE: the referring part's geometry, deformer, parent chain, pivot, opacity and
  // draw order all stay its own. Both parts crop the same sheet through `Part.rect`, so the
  // substitution is an affine remap of texture coordinates from this part's rect onto the
  // target's, and R2 holds — a different region of the user's own artwork is resampled, nothing is
  // generated. Reading it the other way, as "draw the target's posed geometry in this slot", is
  // REFUSED by this schema: it would make a swap silently re-parent and re-deform the layer, so a
  // mouth cutout would stop following the head, and it would composite the target's mesh twice in
  // any frame where the target is also drawn as itself. A target that is not a part of this rig is
  // a warning and the part draws itself.
  swapTo?: string;
}

// A sparse pose sample. Interpolation is per-channel between the two bracketing keys; a channel
// present in only one of them blends against its REST value — 0 for rot/tx/ty, 1 for scale, and
// for a PartPose's compositing channels the part's own authored `visible`/`opacity`/`zIndex`
// rather than a schema-wide constant (see PartPose). Every channel of every kind brackets through
// the same search, so a part's opacity and a joint's rotation sampled from this clip at the same
// instant can never land on different keys.
export interface Keyframe {
  // Normalized clip time. keyframes[0].t is always 0.
  t: number;
  ease: Ease;
  joints: Record<string, JointPose>;
  parts: Record<string, PartPose>;
}

// One named motion. `fps` and `frameCount` are the clip's sampling rate, not its content.
export interface Clip {
  id: string;
  name: string;
  // What the user asked for, kept so the clip can be regenerated.
  request: string;
  loop: boolean;
  fps: number;
  frameCount: number;
  keyframes: Keyframe[];
  source: ClipSource;
}

// The source sheet. Referenced, never embedded and never edited.
export interface AssetRef {
  id: string;
  name: string;
  // Key into the Node StorageAdapter. The browser never receives a raw provider URL for a private
  // sheet.
  storageKey: string;
  // SHA-256 of the source bytes. Every stage is idempotent on this, and it is what makes a render
  // cache hit safe.
  contentHash: string;
  width: number;
  height: number;
  // Height of the SUBJECT inside the sheet, in source pixels. This is the denominator for the
  // `tx`/`ty` pose channels on both JointPose and PartPose, and for `DeformerSpline.thickness` —
  // translations are authored as a fraction of the figure rather than of the canvas, so that the
  // same clip reads identically on a tight crop and on a loose one. It is a separate field from
  // `height` precisely because those two numbers differ whenever the artwork does not fill its
  // sheet, which is the common case; resolving it to `height` would defeat the only reason the
  // channel is figure-relative. DERIVATION: the pixel height of the union of every `Part.rect`,
  // i.e. the bounding box of the decomposed figure, measured once by the stage that first knows
  // the parts (decompose) and carried forward by later revisions. It is not re-measured per stage:
  // a rig stage that merges two parts would otherwise silently re-time every existing clip.
  // DEFAULT: null means unmeasured — a sheet uploaded but not yet decomposed — and a consumer MUST
  // then fall back to `height`. Null and `height` are therefore the same arithmetic, which is what
  // makes adding the measurement to an existing document a refinement rather than a migration.
  figureHeight: number | null;
  mimeType: "image/png" | "image/webp" | "image/jpeg";
  rightsConfirmed: boolean;
  // The user has agreed this sheet may be sent to a remote vision model. False blocks the
  // semantics, animate and critique stages, not the geometry stages.
  remoteVisionConsented: boolean;
}

export interface QaTurn {
  question: string;
  answer: string;
}

// Who made the source sheet. While generationEnabled is false the validator requires `kind:
// external-tool`, which is the machine-checkable form of R2.
export interface GenerationProducedBy {
  kind: "user-supplied" | "external-tool" | "in-app-model";
  modelId: string | null;
  at: string;
}

// Everything about where the pixels came from, isolated in one object so enabling in-app
// generation later touches this object, one config flag and one validator branch — and nothing
// else.
export interface GenerationSeam {
  mode: GenerationMode;
  // The prompt AniBuddy WROTE for the user to take to an external image tool. Writing it is not
  // generating with it (R2).
  prompt: string | null;
  transcript: QaTurn[];
  producedBy: GenerationProducedBy | null;
}

// One execution of one pipeline stage. The audit trail that makes a rig explainable and a bill
// defensible.
export interface StageRecord {
  stage: StageName;
  status: StageStatus;
  startedAt: string;
  finishedAt: string | null;
  // SHA-256 of the stage's canonicalized input. Equal hash means the worker may return the cached
  // artifact instead of recomputing.
  inputHash: string;
  // Which critique pass produced this record. 0 is the first, unreviewed pass.
  passIndex: number;
  // The model that was actually SERVED, threaded back from the provider response tag — never the
  // model that was requested.
  modelId: string | null;
  usageEventId: string | null;
  creditsSpent: number;
  message: string | null;
}

export interface DocumentProvenance {
  pipelineVersion: string;
  // Version of the shared Rust kernel that produced or last validated this document. A preview
  // rendered by a different kernel build is not guaranteed bit-identical (R4).
  kernelVersion: string;
  stages: StageRecord[];
}

// What the pipeline measured. Server-authoritative: authored only by the Python validator, never
// by the browser and never by a model.
export interface Diagnostics {
  foregroundPixels: number;
  // Foreground pixels claimed by at least one part. The gap against foregroundPixels is the
  // decompose stage's own honesty check.
  coveredForegroundPixels: number;
  overlappingPartPairs: string[][];
  // Worst sigmaMax/sigmaMin across every deformed triangle in the last render. 1 is undistorted;
  // above STRETCH_WARNING the UI discloses it rather than hiding it.
  maxStretch: number;
  flippedTriangles: number;
  // Vertices a cut line severed from every bone, which fell back to nearest-bone. Carried as a
  // number instead of a console warning, which is where v3 put it.
  isolatedVertices: number;
  warnings: string[];
  // The export gate. Null means the document is structurally valid and may be rendered or
  // exported. Non-null is a user-facing sentence explaining the lock — the direct descendant of
  // v3's rigInvalidReason, moved server-side so the browser cannot talk its way past it.
  blockingReason: string | null;
}

// Immutable parent-linked revisions, kept from v4. A stage never mutates a document in place; it
// writes a child revision, so every correction is reversible and the editor can diff two passes.
export interface RevisionLink {
  index: number;
  parentRevisionId: string | null;
  reason: string;
  // Whether the user or the critique loop signed this revision off. An unaccepted revision is a
  // proposal, not the truth.
  accepted: boolean;
}

// The whole contract. One document is one revision of one asset's rig.
export interface RigDocument {
  schemaVersion: 5;
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  revision: RevisionLink;
  archetype: Archetype;
  asset: AssetRef;
  parts: Part[];
  skeleton: Skeleton;
  clips: Clip[];
  generation: GenerationSeam;
  provenance: DocumentProvenance;
  diagnostics: Diagnostics;
}

// What the vision model is allowed to say about one part. Note what is absent: no mask, no rect,
// no vertices, no weights. The model proposes SEMANTICS ONLY (R3).
export interface ProposedPartSemantics {
  partId: string;
  role: PartRole;
  parentPartId: string | null;
  attachSlot: string | null;
  // A HINT in part-local normalized coordinates. The rig stage snaps it to the mask's medial axis;
  // the model's number is an initial guess, not a geometric fact.
  pivotHint: Vec2;
  zIndex: number;
  deformerHint: DeformerKind;
  confidence: number;
}

// A joint the model believes exists. Position is normalized and advisory; the rig stage validates
// it against the part's mask and rejects joints that fall on empty pixels.
export interface ProposedJointSemantics {
  jointId: string;
  name: string;
  role: JointRole;
  partId: string | null;
  parent: string | null;
  x: number;
  y: number;
}

// The strict response schema of the `semantics` stage's vision call. Revalidated server-side; a
// structural failure rejects the WHOLE response and refunds (R7), because a partially repaired
// graph animates wrongly while looking plausible.
export interface SemanticsProposal {
  archetype: Archetype;
  parts: ProposedPartSemantics[];
  joints: ProposedJointSemantics[];
  warnings: string[];
}

// The strict response schema of the `animate` stage. Keyframes reference REAL part and joint ids
// from the built rig; an unknown id rejects the whole response.
export interface MotionProposal {
  name: string;
  loop: boolean;
  fps: number;
  frameCount: number;
  keyframes: Keyframe[];
  warnings: string[];
}

// One requested change from a critique pass. Every field the model may set is a small bounded
// scalar or an id — there is no field here through which geometry can enter.
export interface Correction {
  kind: CorrectionKind;
  // Part id, joint id or clip id, depending on `kind`.
  targetId: string | null;
  reason: string;
  // Payload for pivot-nudge. Part-local normalized delta, clamped to CRITIQUE_MAX_PIVOT_NUDGE.
  vec2: Vec2 | null;
  // Payload for rotation-damp (a 0..1 multiplier) and keyframe-retime (a 0..1 time).
  scalar: number | null;
  // Payload for z-order.
  intValue: number | null;
  deformerKind: DeformerKind | null;
  // Payload for parent-change (a part or joint id) and part-visibility (`show` or `hide`).
  stringValue: string | null;
}

// The strict response schema of the `critique` stage, produced after the model VIEWS a contact
// sheet of really-rendered frames. `verdict: accept` ends the loop; `abort` ends it without
// spending another pass.
export interface CritiqueReport {
  verdict: "accept" | "revise" | "abort";
  passIndex: number;
  observations: string[];
  corrections: Correction[];
}

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

export type AniBuddyLimitName = keyof typeof ANIBUDDY_LIMITS;
