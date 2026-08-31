"""
GENERATED FILE — DO NOT EDIT.

Source:    schemas/anibuddy/rig-document.v5.schema.json
Regenerate: pnpm --dir backend schema:anibuddy

Every hand edit here is erased on the next run, and CI fails the build in
the meantime. Change the JSON Schema instead.
"""

from __future__ import annotations

from typing import Annotated, Dict, Final, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

# Field names stay camelCase on purpose. These models sit directly on the
# wire between the Node gateway and the geometry workers, and a snake_case
# alias layer is one more place the three languages could disagree about a
# name. Read them as the wire contract, not as idiomatic Python.

_CONFIG = ConfigDict(extra="forbid", protected_namespaces=())


ARCHETYPE_VALUES: Final[tuple[str, ...]] = (
    "humanoid",
    "creature",
    "mechanical",
    "prop",
    "environment",
    "ui",
)
Archetype = Literal["humanoid", "creature", "mechanical", "prop", "environment", "ui"]


PART_ROLE_VALUES: Final[tuple[str, ...]] = (
    "root",
    "head",
    "face",
    "hair",
    "torso",
    "pelvis",
    "armUpper",
    "armLower",
    "hand",
    "legUpper",
    "legLower",
    "foot",
    "eye",
    "jaw",
    "ear",
    "cape",
    "accessory",
    "neck",
    "tail",
    "wing",
    "fin",
    "horn",
    "paw",
    "snout",
    "shell",
    "tentacle",
    "chassis",
    "wheel",
    "track",
    "turret",
    "barrel",
    "piston",
    "hatch",
    "rotor",
    "thruster",
    "antenna",
    "prop",
    "weapon",
    "projectile",
    "effect",
    "spark",
    "smoke",
    "trail",
    "skyLayer",
    "backgroundLayer",
    "midgroundLayer",
    "foregroundLayer",
    "cloud",
    "foliage",
    "waterLayer",
    "logoMark",
    "logoText",
    "icon",
    "badge",
    "panel",
    "glyph",
    "underlay",
    "other",
)
PartRole = Literal["root", "head", "face", "hair", "torso", "pelvis", "armUpper", "armLower", "hand", "legUpper", "legLower", "foot", "eye", "jaw", "ear", "cape", "accessory", "neck", "tail", "wing", "fin", "horn", "paw", "snout", "shell", "tentacle", "chassis", "wheel", "track", "turret", "barrel", "piston", "hatch", "rotor", "thruster", "antenna", "prop", "weapon", "projectile", "effect", "spark", "smoke", "trail", "skyLayer", "backgroundLayer", "midgroundLayer", "foregroundLayer", "cloud", "foliage", "waterLayer", "logoMark", "logoText", "icon", "badge", "panel", "glyph", "underlay", "other"]


JOINT_ROLE_VALUES: Final[tuple[str, ...]] = (
    "root",
    "spine",
    "head",
    "eye",
    "jaw",
    "limbUpper",
    "limbLower",
    "limbTip",
    "tail",
    "wing",
    "ear",
    "prop",
    "other",
    "neck",
    "digit",
    "fin",
    "horn",
    "tentacleSegment",
    "hinge",
    "wheel",
    "piston",
    "slider",
    "layer",
    "anchor",
)
JointRole = Literal["root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower", "limbTip", "tail", "wing", "ear", "prop", "other", "neck", "digit", "fin", "horn", "tentacleSegment", "hinge", "wheel", "piston", "slider", "layer", "anchor"]


DEFORMER_KIND_VALUES: Final[tuple[str, ...]] = (
    "rigid",
    "mesh",
    "lattice",
    "spline",
)
DeformerKind = Literal["rigid", "mesh", "lattice", "spline"]


MASK_KIND_VALUES: Final[tuple[str, ...]] = (
    "rect",
    "polygon",
    "rle",
    "alpha-threshold",
)
MaskKind = Literal["rect", "polygon", "rle", "alpha-threshold"]


PART_PROVENANCE_VALUES: Final[tuple[str, ...]] = (
    "alpha-component",
    "gutter-grid",
    "watershed",
    "grabcut",
    "vision",
    "manual",
    "imported-v3",
    "imported-v4",
)
PartProvenance = Literal["alpha-component", "gutter-grid", "watershed", "grabcut", "vision", "manual", "imported-v3", "imported-v4"]


EASE_VALUES: Final[tuple[str, ...]] = (
    "linear",
    "ease",
    "hold",
)
Ease = Literal["linear", "ease", "hold"]


CLIP_SOURCE_VALUES: Final[tuple[str, ...]] = (
    "model",
    "edited",
    "critique",
    "imported",
)
ClipSource = Literal["model", "edited", "critique", "imported"]


STAGE_NAME_VALUES: Final[tuple[str, ...]] = (
    "decompose",
    "semantics",
    "rig",
    "animate",
    "render",
    "critique",
)
StageName = Literal["decompose", "semantics", "rig", "animate", "render", "critique"]


STAGE_STATUS_VALUES: Final[tuple[str, ...]] = (
    "pending",
    "running",
    "succeeded",
    "failed",
    "skipped",
)
StageStatus = Literal["pending", "running", "succeeded", "failed", "skipped"]


CORRECTION_KIND_VALUES: Final[tuple[str, ...]] = (
    "pivot-nudge",
    "rotation-damp",
    "z-order",
    "deformer-swap",
    "parent-change",
    "keyframe-retime",
    "part-visibility",
    "abort",
)
CorrectionKind = Literal["pivot-nudge", "rotation-damp", "z-order", "deformer-swap", "parent-change", "keyframe-retime", "part-visibility", "abort"]


GENERATION_MODE_VALUES: Final[tuple[str, ...]] = (
    "external-prompt-only",
    "in-app-generated",
)
GenerationMode = Literal["external-prompt-only", "in-app-generated"]


BUFFER_DTYPE_VALUES: Final[tuple[str, ...]] = (
    "f32",
    "u32",
)
BufferDtype = Literal["f32", "u32"]


BUFFER_STORAGE_VALUES: Final[tuple[str, ...]] = (
    "inline",
    "external",
)
BufferStorage = Literal["inline", "external"]


class Vec2(BaseModel):
    """
    A 2D point. Its coordinate space is stated by the field that holds it — never inferred.
    """

    model_config = _CONFIG

    x: float
    y: float


class Rect(BaseModel):
    """
    Axis-aligned rectangle, sheet-normalized 0..1 (R6).
    """

    model_config = _CONFIG

    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    width: float = Field(..., ge=0, le=1)
    height: float = Field(..., ge=0, le=1)


class NumericBuffer(BaseModel):
    """
    A flat numeric payload that is either inline or behind a StorageAdapter key. `sha256` is
    over the little-endian bytes of the payload as `dtype` and is the buffer's IDENTITY
    everywhere downstream: it names the stored object, it keys the render cache, and it is what
    the kernel fixture corpus compares against. THE EXTERNAL ROUND TRIP, which is a contract and
    not an implementation detail: (1) a producer that exceeds MAX_INLINE_BUFFER_ELEMENTS emits
    `storage: "external"`, `values: null` and a content-addressed `storageKey`; (2) only the
    Node gateway holds StorageAdapter credentials, so it is Node that uploads those bytes and
    rewrites `storageKey` to the key the adapter returned — no other process may invent one; (3)
    a Python stage that has to READ external geometry cannot fetch it, so Node sends the bytes
    back alongside the document as multipart FILE parts under the `buffers` field, each part
    named by its own `sha256`; (4) the receiver re-hashes every uploaded part and refuses any
    whose bytes disagree with the name, before decoding — bytes that do not match the hash are
    the wrong bytes whatever they decode to; (5) rehydration is IN MEMORY ONLY. The external
    reference stays the document's canonical form, and a stage that writes a child revision must
    restore it, or a payload that exists precisely because it does not fit a Mongo document
    travels back as the payload itself.
    """

    model_config = _CONFIG

    dtype: BufferDtype
    storage: BufferStorage
    length: int = Field(..., ge=0, le=4000000)
    sha256: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    values: Optional[List[float]]
    storageKey: Optional[str] = Field(..., max_length=512)


class MaskRect(BaseModel):
    """
    The part is the whole rectangle. The degenerate case, and what a v4 grid-sliced sprite
    region imports as.
    """

    model_config = _CONFIG

    kind: Literal["rect"]


class MaskAlphaThreshold(BaseModel):
    """
    The part is every pixel inside `Part.rect` whose alpha exceeds the threshold. ALPHA_FLOOR 24
    is the repo-wide default and is shared with prepare.ts and rigCore.
    """

    model_config = _CONFIG

    kind: Literal["alpha-threshold"]
    threshold: int = Field(..., ge=0, le=255)


class MaskPolygon(BaseModel):
    """
    Explicit outline plus holes, part-local normalized (R6). What contour tracing emits when a
    part is cleanly separable.
    """

    model_config = _CONFIG

    kind: Literal["polygon"]
    outline: NumericBuffer
    holes: List[NumericBuffer] = Field(..., max_length=32)


class MaskRle(BaseModel):
    """
    Run-length encoded binary mask in PIXELS, column-major from the mask origin. What watershed
    and grabCut emit for parts that touch or overlap, where no polygon is faithful.
    """

    model_config = _CONFIG

    kind: Literal["rle"]
    origin: Vec2
    width: int = Field(..., ge=1, le=8192)
    height: int = Field(..., ge=1, le=8192)
    counts: NumericBuffer


Mask = Annotated[Union[MaskRect, MaskAlphaThreshold, MaskPolygon, MaskRle], Field(discriminator="kind")]


class CutLine(BaseModel):
    """
    A separation the triangulator will not cross and across which bone distance is infinite.
    Ported verbatim in meaning from v3; now scoped to one part instead of the whole figure.
    """

    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    points: NumericBuffer


class DeformerRigid(BaseModel):
    """
    No deformation. The part's own `Part.rect` is drawn as two triangles under the transform of
    `Part.boundJointId`. Cheapest path, and correct for anything that is drawn as a solid
    object: a wheel, a shield, a UI badge. It carries NO fields of its own by design: the
    rectangle it draws and the joint it rides are already on the part, and a second copy on the
    deformer is a second thing to keep in step. A consumer MUST read both off `Part` — a kernel
    struct that stores its own `rect` or `bindJoint` has re-declared part state and will drift
    from it.
    """

    model_config = _CONFIG

    kind: Literal["rigid"]


class DeformerMesh(BaseModel):
    """
    Triangle mesh plus linear blend skinning. The v3 path, now per-part. Vertex, triangle and
    weight payloads are part-local normalized (R6).
    """

    model_config = _CONFIG

    kind: Literal["mesh"]
    verts: NumericBuffer
    tris: NumericBuffer
    boneIds: List[str] = Field(..., max_length=32)
    weights: NumericBuffer
    cuts: List[CutLine] = Field(..., max_length=16)


class DeformerLattice(BaseModel):
    """
    Free-form quad-grid deformation. Right for soft sheets with no skeleton of their own — a
    cape, hair, a flag, cloth, a parallax layer that should billow. The displaced grid is then
    carried by `Part.boundJointId` so a lattice part still follows the skeleton; like `rigid`,
    this deformer stores neither the rect nor the bound joint, because both already live on the
    part.
    """

    model_config = _CONFIG

    kind: Literal["lattice"]
    cols: int = Field(..., ge=1, le=16)
    rows: int = Field(..., ge=1, le=16)
    controlPoints: NumericBuffer
    interpolation: Literal["bilinear", "bicubic"]


class DeformerSpline(BaseModel):
    """
    A tapering ribbon along a spine, for anything long that bends down its length — a tail, a
    tentacle, a rope, a hose, a smoke trail. THE SPINE IS THE PART'S JOINT CHAIN, and that is
    the whole design: a tail needs a joint chain to be posable at all, so reusing it as the
    spline's control polyline means the spline is animated by ordinary forward kinematics and
    needs no deformer-specific animation channels. There is deliberately no stored control
    polyline here. An earlier draft carried a cubic bezier chain as well; it was removed because
    nothing could pose it — a static polyline has no channels — so it was authored, never read,
    and free to drift from the joints that actually drove the render. THE CHAIN DERIVATION,
    which every consumer MUST implement identically: take the joints whose `partId` is this
    part; the HEAD is the one whose `parent` is not itself a member of that set; follow child
    links from the head, taking at each step the member joint whose `parent` is the current one,
    until no member remains. That yields the chain head-to-tail. Order is load-bearing rather
    than cosmetic — the ribbon's shape is the sequence of its control points, and a reordered
    chain produces a ribbon folded back on itself. Fewer than two resolvable joints means the
    part cannot be splined and MUST be downgraded to `rigid` with a stated reason, never
    rendered as an empty ribbon. The rest ribbon and the posed ribbon are evaluated by the same
    function over the rest and posed chains respectively, which is what makes the artwork slide
    ALONG the curve instead of swimming across it.
    """

    model_config = _CONFIG

    kind: Literal["spline"]
    thickness: NumericBuffer
    samples: int = Field(..., ge=2, le=256)


Deformer = Annotated[Union[DeformerRigid, DeformerMesh, DeformerLattice, DeformerSpline], Field(discriminator="kind")]


class Slot(BaseModel):
    """
    A named attachment point this part OFFERS to children. A child references it by name through
    Part.attachSlot, so a sword can move from hand to back without either part learning about
    the other's geometry.
    """

    model_config = _CONFIG

    name: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    position: Vec2


class Part(BaseModel):
    """
    One cutout layer. The unit of decomposition, of draw order, of attachment, and of
    deformation.
    """

    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    name: str = Field(..., min_length=1, max_length=80)
    role: PartRole
    mask: Mask
    rect: Rect
    pivot: Vec2
    zIndex: int = Field(..., ge=-512, le=512)
    parentPartId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    attachSlot: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    slots: List[Slot] = Field(..., max_length=8)
    deformer: Deformer
    boundJointId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    visible: bool
    opacity: float = Field(..., ge=0, le=1)
    confidence: float = Field(..., ge=0, le=1)
    provenance: PartProvenance


class Joint(BaseModel):
    """
    A node of the free-form skeleton. Kept from v3 almost verbatim; the one structural change is
    `partId` — joints now bind to a part rather than to one global mesh.
    """

    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    name: str = Field(..., min_length=1, max_length=80)
    role: JointRole
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    parent: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    partId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    ikChainLength: Optional[int] = Field(..., ge=1, le=4)
    confidence: float = Field(..., ge=0, le=1)


class Skeleton(BaseModel):
    """
    The joint graph. Bones are DERIVED from it and never stored as objects — only their ids
    appear, as DeformerMesh.boneIds. THE DERIVATION, which every consumer MUST reproduce
    exactly: walk `joints` in document order and emit one bone `parentId->childId` for each
    joint that has a resolvable parent, skipping the root and any joint whose parent is missing.
    That order is the order weight-matrix columns are named against, so it is a contract rather
    than an implementation choice — but a consumer still permutes `DeformerMesh.boneIds` by name
    into it rather than trusting the positions to line up, because the skeleton is free to gain
    a joint after a matrix was solved.
    """

    model_config = _CONFIG

    joints: List[Joint] = Field(..., min_length=0, max_length=96)


class JointPose(BaseModel):
    """
    One joint's LOCAL delta at a keyframe. Every channel optional; absent means unchanged from
    rest. That sparsity is load-bearing — a key that only mentions the tail must not snap every
    other joint.
    """

    model_config = _CONFIG

    rot: Optional[float] = Field(None, ge=-180, le=180)
    tx: Optional[float] = Field(None, ge=-1, le=1)
    ty: Optional[float] = Field(None, ge=-1, le=1)
    scale: Optional[float] = Field(None, ge=0.05, le=4)


class PartPose(BaseModel):
    """
    One part's LOCAL delta at a keyframe. Same sparsity rule as JointPose. The last four
    channels are new in v5 and are what make sprite swapping, layered reveals and mid-clip
    draw-order changes expressible — the v4 MotionProgram track types, folded into one keyframe
    model. REST FOR A COMPOSITING CHANNEL IS THE PART'S OWN AUTHORED VALUE, AND A KEY REPLACES
    IT RATHER THAN SCALING IT. `Part.visible`, `Part.opacity` and `Part.zIndex` ARE the rest
    values of `visible`, `opacity` and `zIndex` here, in exactly the sense 0 is the rest value
    of `rot`. Three consequences, stated because each one is a place two implementations can
    silently disagree: (1) a clip that never mentions the channel composites the part exactly as
    authored; (2) a channel present in only ONE of the two bracketing keys blends against the
    part's authored value, not against a schema-wide constant, so a part drawn at 0.5 that is
    keyed to 1 at the end of a clip ramps 0.5 → 1; (3) a resolved opacity is NEVER multiplied by
    `Part.opacity` — multiplying would make it impossible for a keyframe to drive a translucent
    part to full opacity, and would make `opacity` the only channel in the schema whose static
    field is a gain rather than a rest. `swapTo` has no static counterpart, so its rest is "no
    swap". The four geometry channels (`rot`, `tx`, `ty`, `scale`) keep the schema-wide rests,
    because a part has no authored `rot` for them to fall back to.
    """

    model_config = _CONFIG

    rot: Optional[float] = Field(None, ge=-180, le=180)
    tx: Optional[float] = Field(None, ge=-1, le=1)
    ty: Optional[float] = Field(None, ge=-1, le=1)
    scale: Optional[float] = Field(None, ge=0.05, le=4)
    visible: Optional[bool] = None
    opacity: Optional[float] = Field(None, ge=0, le=1)
    zIndex: Optional[int] = Field(None, ge=-512, le=512)
    swapTo: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,32}$")


class Keyframe(BaseModel):
    """
    A sparse pose sample. Interpolation is per-channel between the two bracketing keys; a
    channel present in only one of them blends against its REST value — 0 for rot/tx/ty, 1 for
    scale, and for a PartPose's compositing channels the part's own authored
    `visible`/`opacity`/`zIndex` rather than a schema-wide constant (see PartPose). Every
    channel of every kind brackets through the same search, so a part's opacity and a joint's
    rotation sampled from this clip at the same instant can never land on different keys.
    """

    model_config = _CONFIG

    t: float = Field(..., ge=0, le=1)
    ease: Ease
    joints: Dict[str, JointPose]
    parts: Dict[str, PartPose]


class Clip(BaseModel):
    """
    One named motion. `fps` and `frameCount` are the clip's sampling rate, not its content.
    """

    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    name: str = Field(..., min_length=1, max_length=80)
    request: str = Field(..., max_length=500)
    loop: bool
    fps: int = Field(..., ge=1, le=60)
    frameCount: int = Field(..., ge=2, le=120)
    keyframes: List[Keyframe] = Field(..., min_length=0, max_length=32)
    source: ClipSource


class AssetRef(BaseModel):
    """
    The source sheet. Referenced, never embedded and never edited.
    """

    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(..., min_length=1, max_length=200)
    storageKey: str = Field(..., min_length=1, max_length=512)
    contentHash: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    width: int = Field(..., ge=1, le=8192)
    height: int = Field(..., ge=1, le=8192)
    figureHeight: Optional[float] = Field(..., ge=1, le=8192)
    mimeType: Literal["image/png", "image/webp", "image/jpeg"]
    rightsConfirmed: bool
    remoteVisionConsented: bool


class QaTurn(BaseModel):
    model_config = _CONFIG

    question: str = Field(..., max_length=1000)
    answer: str = Field(..., max_length=1000)


class GenerationProducedBy(BaseModel):
    """
    Who made the source sheet. While generationEnabled is false the validator requires `kind:
    external-tool`, which is the machine-checkable form of R2.
    """

    model_config = _CONFIG

    kind: Literal["user-supplied", "external-tool", "in-app-model"]
    modelId: Optional[str] = Field(..., max_length=120)
    at: str


class GenerationSeam(BaseModel):
    """
    Everything about where the pixels came from, isolated in one object so enabling in-app
    generation later touches this object, one config flag and one validator branch — and nothing
    else.
    """

    model_config = _CONFIG

    mode: GenerationMode
    prompt: Optional[str] = Field(..., max_length=4000)
    transcript: List[QaTurn] = Field(..., max_length=6)
    producedBy: Optional[GenerationProducedBy]


class StageRecord(BaseModel):
    """
    One execution of one pipeline stage. The audit trail that makes a rig explainable and a bill
    defensible.
    """

    model_config = _CONFIG

    stage: StageName
    status: StageStatus
    startedAt: str
    finishedAt: Optional[str]
    inputHash: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    passIndex: int = Field(..., ge=0, le=8)
    modelId: Optional[str] = Field(..., max_length=120)
    usageEventId: Optional[str] = Field(..., pattern=r"^[a-f0-9]{24}$")
    creditsSpent: int = Field(..., ge=0, le=1000)
    message: Optional[str] = Field(..., max_length=2000)


class DocumentProvenance(BaseModel):
    model_config = _CONFIG

    pipelineVersion: str = Field(..., max_length=40)
    kernelVersion: str = Field(..., max_length=40)
    stages: List[StageRecord] = Field(..., max_length=64)


class Diagnostics(BaseModel):
    """
    What the pipeline measured. Server-authoritative: authored only by the Python validator,
    never by the browser and never by a model.
    """

    model_config = _CONFIG

    foregroundPixels: int = Field(..., ge=0)
    coveredForegroundPixels: int = Field(..., ge=0)
    overlappingPartPairs: List[List[str]] = Field(..., max_length=256)
    maxStretch: float = Field(..., ge=0)
    flippedTriangles: int = Field(..., ge=0)
    isolatedVertices: int = Field(..., ge=0)
    warnings: List[str] = Field(..., max_length=64)
    blockingReason: Optional[str] = Field(..., max_length=500)


class RevisionLink(BaseModel):
    """
    Immutable parent-linked revisions, kept from v4. A stage never mutates a document in place;
    it writes a child revision, so every correction is reversible and the editor can diff two
    passes.
    """

    model_config = _CONFIG

    index: int = Field(..., ge=0, le=4096)
    parentRevisionId: Optional[str] = Field(..., max_length=64)
    reason: str = Field(..., max_length=200)
    accepted: bool


class RigDocument(BaseModel):
    """
    The whole contract. One document is one revision of one asset's rig.
    """

    model_config = _CONFIG

    schemaVersion: Literal[5]
    id: str = Field(..., min_length=1, max_length=64)
    projectId: str = Field(..., min_length=1, max_length=64)
    createdAt: str
    updatedAt: str
    revision: RevisionLink
    archetype: Archetype
    asset: AssetRef
    parts: List[Part] = Field(..., min_length=0, max_length=64)
    skeleton: Skeleton
    clips: List[Clip] = Field(..., max_length=16)
    generation: GenerationSeam
    provenance: DocumentProvenance
    diagnostics: Diagnostics


class ProposedPartSemantics(BaseModel):
    """
    What the vision model is allowed to say about one part. Note what is absent: no mask, no
    rect, no vertices, no weights. The model proposes SEMANTICS ONLY (R3).
    """

    model_config = _CONFIG

    partId: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    role: PartRole
    parentPartId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    attachSlot: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    pivotHint: Vec2
    zIndex: int = Field(..., ge=-512, le=512)
    deformerHint: DeformerKind
    confidence: float = Field(..., ge=0, le=1)


class ProposedJointSemantics(BaseModel):
    """
    A joint the model believes exists. Position is normalized and advisory; the rig stage
    validates it against the part's mask and rejects joints that fall on empty pixels.
    """

    model_config = _CONFIG

    jointId: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    name: str = Field(..., min_length=1, max_length=80)
    role: JointRole
    partId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    parent: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)


class SemanticsProposal(BaseModel):
    """
    The strict response schema of the `semantics` stage's vision call. Revalidated server-side;
    a structural failure rejects the WHOLE response and refunds (R7), because a partially
    repaired graph animates wrongly while looking plausible.
    """

    model_config = _CONFIG

    archetype: Archetype
    parts: List[ProposedPartSemantics] = Field(..., min_length=1, max_length=64)
    joints: List[ProposedJointSemantics] = Field(..., min_length=0, max_length=96)
    warnings: List[str] = Field(..., max_length=32)


class MotionProposal(BaseModel):
    """
    The strict response schema of the `animate` stage. Keyframes reference REAL part and joint
    ids from the built rig; an unknown id rejects the whole response.
    """

    model_config = _CONFIG

    name: str = Field(..., min_length=1, max_length=80)
    loop: bool
    fps: int = Field(..., ge=1, le=60)
    frameCount: int = Field(..., ge=2, le=120)
    keyframes: List[Keyframe] = Field(..., min_length=2, max_length=32)
    warnings: List[str] = Field(..., max_length=32)


class Correction(BaseModel):
    """
    One requested change from a critique pass. Every field the model may set is a small bounded
    scalar or an id — there is no field here through which geometry can enter.
    """

    model_config = _CONFIG

    kind: CorrectionKind
    targetId: Optional[str] = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    reason: str = Field(..., min_length=1, max_length=300)
    vec2: Optional[Vec2]
    scalar: Optional[float] = Field(..., ge=0, le=1)
    intValue: Optional[int] = Field(..., ge=-512, le=512)
    deformerKind: Optional[DeformerKind]
    stringValue: Optional[str] = Field(..., max_length=64)


class CritiqueReport(BaseModel):
    """
    The strict response schema of the `critique` stage, produced after the model VIEWS a contact
    sheet of really-rendered frames. `verdict: accept` ends the loop; `abort` ends it without
    spending another pass.
    """

    model_config = _CONFIG

    verdict: Literal["accept", "revise", "abort"]
    passIndex: int = Field(..., ge=0, le=8)
    observations: List[str] = Field(..., max_length=16)
    corrections: List[Correction] = Field(..., max_length=12)


# Every cap and epsilon the pipeline agrees on. Rule 9: import from here,
# never re-declare a literal at a call site.
ANIBUDDY_LIMITS: Final[dict[str, float]] = {
    "ALPHA_FLOOR": 24,
    "CONFIDENCE_REVIEW_FLOOR": 0.55,
    "CRITIQUE_CONTACT_SHEET_FRAMES": 9,
    "CRITIQUE_CREDIT_CEILING": 24,
    "CRITIQUE_MAX_PIVOT_NUDGE": 0.08,
    "CRITIQUE_MIN_ROTATION_DAMP": 0.25,
    "MAX_BONES_PER_PART": 32,
    "MAX_CLIPS": 16,
    "MAX_CORRECTIONS_PER_PASS": 12,
    "MAX_CRITIQUE_PASSES": 3,
    "MAX_CUTS_PER_PART": 16,
    "MAX_FPS": 60,
    "MAX_FRAMES": 120,
    "MAX_INLINE_BUFFER_ELEMENTS": 4096,
    "MAX_INTERVIEW_ROUNDS": 6,
    "MAX_JOINT_DEPTH": 12,
    "MAX_JOINTS": 96,
    "MAX_KEYFRAMES": 32,
    "MAX_LATTICE_COLS": 16,
    "MAX_LATTICE_ROWS": 16,
    "MAX_MASK_HOLES": 32,
    "MAX_PART_DEPTH": 8,
    "MAX_PARTS": 64,
    "MAX_SLOTS_PER_PART": 8,
    "MAX_SOURCE_EDGE": 8192,
    "MAX_SPLINE_SAMPLES": 256,
    "MAX_STAGE_RECORDS": 64,
    "MAX_TRIS_PER_PART": 2400,
    "MAX_VERTS_PER_PART": 1200,
    "MIN_JOINTS": 0,
    "MIN_PARTS": 1,
    "MIN_TRIANGLE_AREA": 0.0001,
    "PROPOSAL_RETRY_LIMIT": 1,
    "SCHEMA_VERSION": 5,
    "SEAM_BLEED_PX": 0.5,
    "SKIN_FALLOFF": 4,
    "SKIN_TOP_K": 4,
    "STRETCH_WARNING": 2.5,
    "WEIGHT_ROW_EPSILON": 0.001,
}
