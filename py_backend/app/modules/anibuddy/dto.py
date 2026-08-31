"""Hand-written wire envelopes for AniBuddy stage endpoints.

Generated ``schemas.py`` owns RigDocument field shapes. These DTOs are the
HTTP request wrappers the Node gateway posts; they are deliberately *not*
generated so routing code can evolve without a schema regen.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.schemas import (
    Archetype,
    AssetRef,
    BufferDtype,
    CritiqueReport,
    DeformerKind,
    RigDocument,
    SemanticsProposal,
)

_CONFIG = ConfigDict(extra="forbid", protected_namespaces=())


class DecomposeRequest(BaseModel):
    """JSON body (or form field) accompanying the uploaded sheet bytes."""

    model_config = _CONFIG

    asset: AssetRef
    projectId: str = Field(..., min_length=1, max_length=64)
    revisionId: str = Field(..., min_length=1, max_length=64)
    #: Which rig prior the document declares (F9 §10).
    #:
    #: The caller's choice, carried rather than derived: this stage measures
    #: pixels and an archetype is a judgement about the artwork. Typed as the
    #: generated ``Archetype`` so an unknown value is refused by name here instead
    #: of reaching the priors table, and defaulted so a caller that has not asked
    #: the user yet still gets a valid document.
    archetype: Archetype = DecomposeConstants.DEFAULT_ARCHETYPE  # type: ignore[assignment]
    parentRevisionId: Optional[str] = Field(None, max_length=64)
    revisionIndex: int = Field(0, ge=0, le=4096)


class DecomposeResponse(BaseModel):
    """Stage result: a provisional RigDocument revision (parts + diagnostics)."""

    model_config = _CONFIG

    document: RigDocument


class RenderRequest(BaseModel):
    """JSON body (or form field) accompanying the source sheet bytes.

    Every sizing and sampling field is optional: absent means "take it from the
    clip", which is where §7.7 puts ``fps`` and ``frameCount``. An override is a
    request to sample the same motion differently, not a contradiction of the
    document, which is why they are accepted rather than refused.

    The sheet rides as multipart bytes rather than as a storage key because
    py_backend does not hold the ``StorageAdapter`` — Node does, and Node is the
    only caller. Same shape as ``DecomposeRequest`` for the same reason.
    """

    model_config = _CONFIG

    document: RigDocument
    projectId: str = Field(..., min_length=1, max_length=64)
    revisionId: str = Field(..., min_length=1, max_length=64)
    parentRevisionId: Optional[str] = Field(None, max_length=64)
    revisionIndex: int = Field(0, ge=0, le=4096)
    passIndex: int = Field(0, ge=0, le=8)
    usageEventId: Optional[str] = Field(None, pattern=r"^[a-f0-9]{24}$")

    #: Which clip to sample. Null renders a single still at rest, which is what
    #: the rig editor's thumbnail wants.
    clipId: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,32}$")
    format: str = Field("png-zip", max_length=16)
    fps: Optional[int] = Field(None, ge=1, le=60)
    frameCount: Optional[int] = Field(None, ge=1, le=120)
    #: Explicit output size. Both must be given for either to apply; otherwise
    #: ``maxEdge`` (or the asset's own size) drives an aspect-preserving fit.
    width: Optional[int] = Field(None, ge=1, le=8192)
    height: Optional[int] = Field(None, ge=1, le=8192)
    maxEdge: Optional[int] = Field(None, ge=1, le=8192)
    background: str = Field("transparent", max_length=16)
    loop: Optional[bool] = None


class RenderArtifactHint(BaseModel):
    """The encoded artifact, and how Node should get hold of the bytes.

    Node remains the ``StorageAdapter`` owner. ``contentBase64`` is present only
    for a payload small enough to ride inside JSON; above that threshold
    ``downloadPath`` names a stream on this same internal-token-protected
    service. ``RenderService.artifact_hint`` carries the full rationale and the
    one Node-side branch the streaming path needs.
    """

    model_config = _CONFIG

    kind: str
    suggestedStorageKey: str = Field(..., max_length=512)
    contentHash: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    mimeType: str
    byteLength: int = Field(..., ge=0)
    frameCount: int = Field(..., ge=0)
    width: int = Field(..., ge=0)
    height: int = Field(..., ge=0)
    format: str
    cacheKey: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    contentBase64: Optional[str] = None
    downloadPath: Optional[str] = None


class RenderResponse(BaseModel):
    """Stage result: a child RigDocument revision plus the artifact.

    ``requestedFormat`` and ``servedFormat`` differ exactly when the ffmpeg
    fallback fired (F9 §8.5). Reported rather than silently substituted, because
    a caller that asked for MP4 and got a zip must not label it ``video/mp4``.
    """

    model_config = _CONFIG

    document: RigDocument
    artifact: RenderArtifactHint
    cacheKey: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    cacheHit: bool
    requestedFormat: str
    servedFormat: str
    message: Optional[str] = Field(None, max_length=2000)


class RigRequest(BaseModel):
    """JSON body accompanying the sheet bytes for ``POST /anibuddy/rig``.

    The sheet upload is optional. Rect, polygon and RLE masks are
    self-describing, so a re-rig of a corrected decomposition needs no pixels at
    all; an ``alpha-threshold`` mask does, and the stage refuses by name rather
    than quietly meshing an empty rect.
    """

    model_config = _CONFIG

    document: RigDocument
    revisionId: str = Field(..., min_length=1, max_length=64)
    #: Validated semantics, when the vision pass ran. Absent means the stage
    #: falls back to the geometric prior (F9 §8.2), which is a normal outcome
    #: and not a degraded one.
    semantics: Optional[SemanticsProposal] = None
    #: Per-part user overrides of the archetype prior's deformer choice. A user
    #: looking at the artwork outranks a table (F9 §9).
    deformerOverrides: Dict[str, DeformerKind] = Field(default_factory=dict)
    passIndex: int = Field(0, ge=0, le=8)
    usageEventId: Optional[str] = Field(None, pattern=r"^[a-f0-9]{24}$")


class BufferUpload(BaseModel):
    """One oversized ``NumericBuffer`` for Node to write through storage.

    py_backend does not hold the ``StorageAdapter`` — Node does — so a buffer
    over ``MAX_INLINE_BUFFER_ELEMENTS`` leaves here as base64 plus the
    content-addressed key it belongs at. The key is a hash of the bytes, which
    makes the upload idempotent: a re-run of the stage produces the same key for
    the same geometry, so Node may skip an object that already exists.
    """

    model_config = _CONFIG

    storageKey: str = Field(..., min_length=1, max_length=512)
    sha256: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    dtype: BufferDtype
    length: int = Field(..., ge=0)
    contentBase64: str


class RigResponse(BaseModel):
    """Stage result: a rigged child revision plus its out-of-band buffers."""

    model_config = _CONFIG

    document: RigDocument
    buffers: List[BufferUpload] = Field(default_factory=list)
    message: Optional[str] = Field(None, max_length=2000)


# ─────────────────────────────────────────────────────────────────────────────
# Vision-facing envelopes.
#
# These three carry the two images a model is allowed to see and the bounded
# corrections it sends back. The vision CALL is not here and must not move
# here: it belongs beside the one provider-fallback chain in Next. What crosses
# this boundary is pixels in and a validated document out.
# ─────────────────────────────────────────────────────────────────────────────


class AnnotateRequest(BaseModel):
    """JSON body accompanying the sheet bytes for the semantics annotation."""

    model_config = _CONFIG

    document: RigDocument
    #: Longest edge of the annotated composite. Absent takes
    #: ``VisionConstants.ANNOTATION_MAX_EDGE``, which is sized for image tokens
    #: rather than for detail no role decision depends on.
    maxEdge: Optional[int] = Field(None, ge=64, le=4096)


class PartLegendEntry(BaseModel):
    """One row of the number-to-part-id legend the caller must revalidate against.

    The legend is the reason the numbers on the sheet are safe: the model answers
    with ``partId``, and any id absent from this list rejects the whole proposal.
    Were the numbers themselves the reply protocol, an off-by-one in the
    annotator would silently reassign every role in the rig.
    """

    model_config = _CONFIG

    partId: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,32}$")
    label: int = Field(..., ge=1)
    name: str = Field(..., max_length=120)
    role: str = Field(..., max_length=40)
    #: Current draw order, so the model can propose a change rather than a value
    #: it has no baseline for.
    zIndex: int = Field(..., ge=-512, le=512)
    confidence: float = Field(..., ge=0, le=1)


class AnnotateResponse(BaseModel):
    """The annotated sheet as a data URL, plus the legend that binds it."""

    model_config = _CONFIG

    imageDataUrl: str
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    legend: List[PartLegendEntry]
    archetype: str = Field(..., max_length=40)
    warnings: List[str] = Field(default_factory=list)


class ContactSheetRequest(BaseModel):
    """JSON body accompanying the sheet bytes for one critique pass's frames."""

    model_config = _CONFIG

    document: RigDocument
    projectId: str = Field(..., min_length=1, max_length=64)
    revisionId: str = Field(..., min_length=1, max_length=64)
    parentRevisionId: Optional[str] = Field(None, max_length=64)
    revisionIndex: int = Field(0, ge=0, le=4096)
    passIndex: int = Field(0, ge=0, le=8)
    usageEventId: Optional[str] = Field(None, pattern=r"^[a-f0-9]{24}$")
    clipId: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9_-]{1,32}$")
    #: Tile count. Absent takes ``CRITIQUE_CONTACT_SHEET_FRAMES``; an override
    #: exists for a caller trading image tokens against temporal detail, and is
    #: capped by the schema's own frame limit.
    frames: Optional[int] = Field(None, ge=1, le=120)
    tileMaxEdge: Optional[int] = Field(None, ge=32, le=1024)


class ContactSheetResponse(BaseModel):
    """The tiled frames, the revision that produced them, and what it measured.

    ``document`` is the render stage's child revision, and its ``diagnostics``
    were measured on exactly these frames. That is what makes the loop's
    "best revision" selection (F9 §11.6) a measurement rather than a guess, so
    the caller must keep it rather than the revision it sent.
    """

    model_config = _CONFIG

    imageDataUrl: str
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    columns: int = Field(..., ge=1)
    rows: int = Field(..., ge=1)
    frameCount: int = Field(..., ge=1)
    frameTimes: List[float]
    document: RigDocument
    maxStretch: float = Field(..., ge=0)
    flippedTriangles: int = Field(..., ge=0)
    blockingReason: Optional[str] = Field(None, max_length=500)
    cacheKey: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    warnings: List[str] = Field(default_factory=list)


class ApplyCritiqueRequest(BaseModel):
    """A validated ``CritiqueReport`` to apply to one revision.

    The report has already passed the strict response schema at the Next
    boundary. It is revalidated here anyway, against the live document, because
    the schema cannot know whether an id resolves or whether two reparents close
    a cycle together (F9 §11.4).
    """

    model_config = _CONFIG

    document: RigDocument
    report: CritiqueReport
    revisionId: str = Field(..., min_length=1, max_length=64)
    projectId: Optional[str] = Field(None, max_length=64)
    parentRevisionId: Optional[str] = Field(None, max_length=64)
    revisionIndex: Optional[int] = Field(None, ge=0, le=4096)
    passIndex: int = Field(0, ge=0, le=8)
    #: The model that was actually SERVED, threaded from the provider response
    #: tag — never the one that was requested (F9 §13).
    modelId: Optional[str] = Field(None, max_length=120)
    usageEventId: Optional[str] = Field(None, pattern=r"^[a-f0-9]{24}$")
    creditsSpent: int = Field(0, ge=0, le=1000)


class AppliedCorrectionRecord(BaseModel):
    """What one correction actually changed, for the editor's revision diff."""

    model_config = _CONFIG

    kind: str = Field(..., max_length=40)
    targetId: Optional[str] = Field(None, max_length=64)
    reason: str = Field(..., max_length=300)
    effect: str = Field(..., max_length=300)
    clamped: bool


class ApplyCritiqueResponse(BaseModel):
    """The corrected child revision plus what landed and what still needs a re-rig."""

    model_config = _CONFIG

    document: RigDocument
    applied: List[AppliedCorrectionRecord] = Field(default_factory=list)
    #: Per-part deformer swaps the next ``rig`` pass must rebuild geometry for.
    #: Deliberately not applied here: authoring a mesh from a critique response
    #: would put the model one field away from emitting vertices (R3).
    deformerOverrides: Dict[str, DeformerKind] = Field(default_factory=dict)
    requiresRerig: bool = False
    warnings: List[str] = Field(default_factory=list)
