"""HTTP surface for AniBuddy Python stages.

Browser never calls these. The Node gateway posts with ``X-Internal-Token``,
enforced by the middleware in ``app.main``.

Three surfaces coexist on purpose during the vertical slice:

* ``POST /anibuddy/decompose`` — real OpenCV decompose (multipart), owned by
  the decompose-stage work.
* ``POST /anibuddy/rig`` — real skeleton inference and deformer construction
  (multipart, sheet optional). Node remains the StorageAdapter owner, so
  oversized numeric buffers come back as base64 for Node to upload — and come
  *in* as ``buffers`` file parts when a stage has to read geometry that already
  went out that way (see ``buffer_sidecar``).
* ``POST /anibuddy/render`` — real rasterize and encode (multipart), plus
  ``GET /anibuddy/render/artifacts/{cacheKey}`` for the large-payload handoff.
* ``POST /anibuddy/semantics/annotate``,
  ``POST /anibuddy/critique/contact-sheet`` and
  ``POST /anibuddy/critique/apply`` — the two images a vision model may see and
  the bounded corrections it may send back. The vision CALL is not here: it
  lives beside the one provider-fallback chain in Next, and forking that chain
  to give py_backend its own copy is how it acquires two behaviours.
* ``POST /anibuddy/stages/{stage}`` — JSON stub handlers for the infra slice
  (Node BullMQ workers). Node remains the StorageAdapter owner; stubs return
  a RigDocument plus an optional base64 artifact hint for Node to upload.
"""

from __future__ import annotations

import base64
import json
from typing import Dict, List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, Response, UploadFile

from app.modules.anibuddy.buffer_sidecar import BufferSidecar, BufferSidecarError
from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.decompose import DecomposeError, DecomposeService
from app.modules.anibuddy.dto import (
    AnnotateRequest,
    AnnotateResponse,
    AppliedCorrectionRecord,
    ApplyCritiqueRequest,
    ApplyCritiqueResponse,
    BufferUpload,
    ContactSheetRequest,
    ContactSheetResponse,
    DecomposeRequest,
    DecomposeResponse,
    PartLegendEntry,
    RenderArtifactHint,
    RenderRequest,
    RenderResponse,
    RigRequest,
    RigResponse,
)
from app.modules.anibuddy.render import RenderCache, RenderError, RenderService
from app.modules.anibuddy.rig import RigError, RigService
from app.modules.anibuddy.stages.stub import StageRequest, StageResponse, run_stub_stage
from app.modules.anibuddy.vision import (
    CritiqueCorrections,
    VisionError,
    VisionService,
    to_data_url,
)

router = APIRouter(prefix="/anibuddy", tags=["anibuddy"])

_STUB_STAGES = frozenset({"decompose", "rig", "animate", "render"})

async def _envelope(model, upload: UploadFile, label: str):
    """Parse the JSON envelope that rides as a multipart FILE part.

    Why a file part and not ``Form(...)``
    -------------------------------------
    Starlette measures every non-file multipart part against ``max_part_size``
    (1 MB) and raises ``MultiPartException`` above it — a 400 before this handler
    runs, carrying a message about a "Part" that names neither the field nor the
    endpoint. A part that declares a ``filename`` is spooled to a temporary file
    instead and has no such bound.

    That distinction is load-bearing rather than theoretical. A 64-part rig
    document exceeds 1 MB on its own once masks and vertex arrays are inline, and
    it does so even though oversized geometry already travels out of band as
    ``buffers`` file parts: ``MAX_INLINE_BUFFER_ELEMENTS`` is 4096 *per buffer*,
    so sixty buffers just under that ceiling are still sixty buffers inside the
    JSON. Raising the limit would only move the failure to the next document that
    grows; a file part removes the class of failure.

    The envelope is still validated by the same Pydantic model, so nothing about
    the request CONTRACT changed — only which kind of multipart part carries it.
    """
    payload = await upload.read()
    if not payload:
        raise HTTPException(status_code=422, detail=f"Empty {label} request envelope")
    try:
        return model.model_validate_json(payload)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Invalid {label} request") from error


@router.post("/decompose", response_model=DecomposeResponse)
async def decompose(
    image: UploadFile = File(...),
    request: UploadFile = File(...),
) -> DecomposeResponse:
    """Decompose a cutout sheet into provisional parts (classical CV only)."""
    parsed = await _envelope(DecomposeRequest, request, "decompose")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Empty image upload")

    decoded = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_UNCHANGED)
    if decoded is None:
        raise HTTPException(status_code=422, detail="Could not decode image")

    try:
        document = DecomposeService.run(
            decoded,
            asset=parsed.asset,
            project_id=parsed.projectId,
            revision_id=parsed.revisionId,
            archetype=parsed.archetype,
            parent_revision_id=parsed.parentRevisionId,
            revision_index=parsed.revisionIndex,
            input_bytes=contents,
        )
    except DecomposeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Validate round-trip against the generated RigDocument contract.
    RigDocument = document.__class__
    RigDocument.model_validate(json.loads(document.model_dump_json()))
    return DecomposeResponse(document=document)


async def _rehydrated(document, buffers: Optional[List[UploadFile]]):
    """The document with any external geometry put back from uploaded parts.

    A no-op for a document whose buffers are all inline, which is every document
    the decompose stage produces. It matters for a re-rig or a render of a mesh
    rig: those buffers left as ``storage: "external"`` keys, and this process holds
    no storage credentials to fetch them with (F9 §5). See ``buffer_sidecar``.
    """
    if not BufferSidecar.references(document):
        return document

    blobs: Dict[str, bytes] = {}
    for upload in buffers or ():
        # The part's filename is the buffer's own sha256, and the sidecar checks
        # the bytes against it — so a part cannot claim to be geometry it is not.
        blobs[str(upload.filename or "")] = await upload.read()

    try:
        return BufferSidecar.rehydrate(document, blobs)
    except BufferSidecarError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/rig", response_model=RigResponse)
async def rig(
    request: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
    buffers: Optional[List[UploadFile]] = File(None),
) -> RigResponse:
    """Build the skeleton and one deformer per part (classical geometry only).

    Multipart rather than JSON for the same reason decompose is: an
    ``alpha-threshold`` mask is resolved against the source pixels, and passing
    a whole sheet as base64 inside a JSON body inflates it by a third for no
    gain. The upload is optional because the other three mask kinds are
    self-describing.

    ``buffers`` is the other half of the storage handoff: a document being re-rigged
    may reference geometry that lives behind a ``StorageAdapter`` key, and the
    caller uploads those bytes because only it can read them.

    The ``request`` envelope is a file part rather than a form field; see
    ``_envelope`` for why a 64-part document cannot fit a form field.
    """
    parsed = await _envelope(RigRequest, request, "rig")

    document = await _rehydrated(parsed.document, buffers)

    decoded: Optional[np.ndarray] = None
    if image is not None:
        contents = await image.read()
        if contents:
            decoded = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_UNCHANGED)
            if decoded is None:
                raise HTTPException(status_code=422, detail="Could not decode image")
            if decoded.ndim == 3 and decoded.shape[2] == 3:
                # Opaque source: give it a full alpha channel so the mask
                # resolver has one to threshold. Not a pixel invent — every
                # opaque pixel stays opaque.
                alpha = np.full(decoded.shape[:2], 255, dtype=np.uint8)
                decoded = np.dstack([decoded, alpha])

    try:
        result = RigService.run(
            document,
            sheet=decoded,
            revision_id=parsed.revisionId,
            semantics=parsed.semantics,
            deformer_overrides=dict(parsed.deformerOverrides),
            pass_index=parsed.passIndex,
            usage_event_id=parsed.usageEventId,
        )
    except RigError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Any buffer that was inlined for this stage's arithmetic goes back to being a
    # reference before the caller sees it: the child revision is a copy of the
    # document, and inline geometry in it is the payload the reference exists to
    # keep out of the stored document.
    child = BufferSidecar.restore(result.document, parsed.document)

    # Validate the round trip against the generated contract before Node sees
    # it: a document that fails here would fail in the zod boundary anyway, and
    # failing on this side names the stage that produced it.
    RigDocument = child.__class__
    RigDocument.model_validate(json.loads(child.model_dump_json()))

    return RigResponse(
        document=child,
        buffers=[
            BufferUpload(
                storageKey=buffer.storage_key,
                sha256=buffer.sha256,
                dtype=buffer.dtype,  # type: ignore[arg-type]
                length=buffer.length,
                contentBase64=base64.b64encode(buffer.data).decode("ascii"),
            )
            for buffer in result.pending_buffers
        ],
        message=result.message,
    )


@router.post("/render", response_model=RenderResponse)
async def render(
    request: UploadFile = File(...),
    image: UploadFile = File(...),
    buffers: Optional[List[UploadFile]] = File(None),
) -> RenderResponse:
    """Rasterize a posed rig and encode it, keyed by content hash.

    Multipart, and the sheet is required rather than optional as it is for rig:
    a render resamples the user's own pixels for every frame (R2), so there is
    nothing to draw without them.

    Refusals are 422 rather than 500 because every one of them is a statement
    about the request — a non-null ``blockingReason``, an unknown clip id, a
    sheet whose size contradicts the document — and the Node worker surfaces the
    detail string to the user verbatim.

    The ``request`` envelope is a file part rather than a form field; see
    ``_envelope`` for why a 64-part document cannot fit a form field.
    """
    parsed = await _envelope(RenderRequest, request, "render")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Empty image upload")

    document = await _rehydrated(parsed.document, buffers)

    try:
        result = RenderService.run(
            document,
            contents,
            project_id=parsed.projectId,
            revision_id=parsed.revisionId,
            clip_id=parsed.clipId,
            fmt=parsed.format,
            fps=parsed.fps,
            frame_count=parsed.frameCount,
            width=parsed.width,
            height=parsed.height,
            max_edge=parsed.maxEdge,
            background=parsed.background,
            loop=parsed.loop,
            parent_revision_id=parsed.parentRevisionId,
            revision_index=parsed.revisionIndex,
            pass_index=parsed.passIndex,
            usage_event_id=parsed.usageEventId,
        )
    except RenderError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Re-externalize, for the reason the rig endpoint does: a rehydrated buffer
    # belongs to this request, not to the revision the caller stores.
    child = BufferSidecar.restore(result.document, parsed.document)

    # Validate the round trip against the generated contract before Node sees
    # it, for the reason the rig endpoint does: failing on this side names the
    # stage that produced the bad document.
    RigDocument = child.__class__
    RigDocument.model_validate(json.loads(child.model_dump_json()))

    return RenderResponse(
        document=child,
        artifact=RenderArtifactHint.model_validate(
            RenderService.artifact_hint(result)
        ),
        cacheKey=result.cache_key,
        cacheHit=result.report.cache_hit,
        requestedFormat=result.report.requested_format,
        servedFormat=result.report.served_format,
        message=result.document.provenance.stages[-1].message,
    )


@router.get("/render/artifacts/{cache_key}")
async def render_artifact(cache_key: str) -> Response:
    """Stream a rendered artifact's raw bytes for Node to upload.

    The large-payload half of the storage handoff. Node stays the
    ``StorageAdapter`` owner; this exists only so a 40 MB frame zip reaches it as
    a stream instead of as base64 inside a JSON body. See
    ``RenderService.artifact_hint`` for the full reasoning and the Node-side
    branch it expects.

    Served from the worker-local render cache, so a 404 here means the artifact
    was evicted and the render should be re-requested — which is free when the
    inputs have not changed, because the cache key is a content hash. The same
    ``X-Internal-Token`` middleware guards this path as every other one.
    """
    artifact = RenderCache.get(cache_key)
    if artifact is None:
        raise HTTPException(
            status_code=404,
            detail="That render artifact is no longer cached; re-request the render.",
        )
    return Response(
        content=artifact.data,
        media_type=artifact.mime_type,
        headers={
            "Content-Length": str(artifact.byte_length),
            # Content-addressed bytes are immutable by construction, so a
            # caching proxy between Node and this service can hold them safely.
            "ETag": f'"{artifact.content_hash}"',
        },
    )


@router.post("/semantics/annotate", response_model=AnnotateResponse)
async def annotate_for_semantics(
    request: UploadFile = File(...),
    image: UploadFile = File(...),
) -> AnnotateResponse:
    """Draw numbered part outlines over the sheet for the semantics vision call.

    The vision call itself is NOT here. It lives in the Next route handler beside
    the one provider-fallback chain and the one credits helper; giving py_backend
    a second copy of either is how a fallback chain acquires two behaviours. What
    this endpoint owns is the image, because drawing outlines on a raster is image
    work and Python is where the pixels are.

    The sheet is required rather than optional: outlines are traced from resolved
    masks, and an ``alpha-threshold`` mask has nothing to trace without it.

    Reached from the Node gateway rather than from Next: the browser-adjacent app
    holds no ``X-Internal-Token``, so it asks the gateway for this image and the
    gateway is the only process that talks to this service.
    """
    parsed = await _envelope(AnnotateRequest, request, "annotate")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Empty image upload")

    try:
        annotated = VisionService.annotate(
            parsed.document,
            contents,
            max_edge=parsed.maxEdge or VisionConstants.ANNOTATION_MAX_EDGE,
        )
    except VisionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    by_id = {part.id: part for part in parsed.document.parts}
    return AnnotateResponse(
        imageDataUrl=to_data_url(annotated.png),
        width=annotated.width,
        height=annotated.height,
        legend=[
            PartLegendEntry(
                partId=outline.part_id,
                label=outline.label,
                name=outline.name,
                role=str(by_id[outline.part_id].role),
                zIndex=int(by_id[outline.part_id].zIndex),
                confidence=float(by_id[outline.part_id].confidence),
            )
            for outline in annotated.outlines
        ],
        archetype=str(parsed.document.archetype),
        warnings=annotated.warnings,
    )


@router.post("/critique/contact-sheet", response_model=ContactSheetResponse)
async def critique_contact_sheet(
    request: UploadFile = File(...),
    image: UploadFile = File(...),
    buffers: Optional[List[UploadFile]] = File(None),
) -> ContactSheetResponse:
    """Render the clip and tile really-rendered frames for one critique pass.

    This is what makes the loop closed rather than reflective (F9 §11.1): the
    model looks at frames the renderer produced from the user's own pixels, not
    at its own plan. The returned ``document`` is the render stage's child
    revision, and the caller must keep it — its ``diagnostics`` were measured on
    exactly these frames, which is what makes "best revision" a measurement.

    ``buffers`` is here for the same reason it is on ``/anibuddy/render``, and it
    was missing while the loop's only caller was a browser-adjacent route that
    could not read a ``StorageAdapter``: tiling nine frames IS a render, it
    evaluates every deformer in the document, and a mesh rig's weight matrices
    left as storage keys. This process holds no credentials to fetch one with, so
    the caller brings the bytes and each part is checked against its own sha256.

    The ``request`` envelope is a file part rather than a form field; see
    ``_envelope`` for why a 64-part document cannot fit a form field.
    """
    parsed = await _envelope(ContactSheetRequest, request, "contact-sheet")

    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Empty image upload")

    rehydrated = await _rehydrated(parsed.document, buffers)

    try:
        result = VisionService.contact_sheet(
            rehydrated,
            contents,
            project_id=parsed.projectId,
            revision_id=parsed.revisionId,
            clip_id=parsed.clipId,
            parent_revision_id=parsed.parentRevisionId,
            revision_index=parsed.revisionIndex,
            pass_index=parsed.passIndex,
            usage_event_id=parsed.usageEventId,
            frames=parsed.frames or VisionConstants.CONTACT_SHEET_FRAMES,
            tile_max_edge=(
                parsed.tileMaxEdge or VisionConstants.CONTACT_SHEET_TILE_MAX_EDGE
            ),
        )
    except VisionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    # Re-externalize, for the reason the render endpoint does: a buffer that was
    # rehydrated for this request's arithmetic belongs to the request, not to the
    # revision the caller stores.
    document = BufferSidecar.restore(result.document, parsed.document)
    RigDocumentModel = document.__class__
    RigDocumentModel.model_validate(json.loads(document.model_dump_json()))

    return ContactSheetResponse(
        imageDataUrl=to_data_url(result.png),
        width=result.width,
        height=result.height,
        columns=result.columns,
        rows=result.rows,
        frameCount=result.frame_count,
        frameTimes=list(result.frame_times),
        document=document,
        maxStretch=result.max_stretch,
        flippedTriangles=result.flipped_triangles,
        blockingReason=result.blocking_reason,
        cacheKey=result.cache_key,
        warnings=result.warnings,
    )


@router.post("/critique/apply", response_model=ApplyCritiqueResponse)
async def apply_critique(request: ApplyCritiqueRequest) -> ApplyCritiqueResponse:
    """Revalidate a critique report against the live document and apply it.

    JSON rather than multipart, and deliberately so: applying a correction is
    parameter arithmetic over ids the document already carries, and none of it
    reads a pixel. A stage that needs no sheet should not ask for one.

    Every failure here is a 422 with the refusal sentence, because every one of
    them is a statement about the response — an unknown id, a number too far out
    of range to be a rounding artifact, a reparent that closes a cycle — and the
    caller refunds the pass on exactly that signal (F9 §11.6).
    """
    try:
        outcome = CritiqueCorrections.apply(
            request.document,
            request.report,
            revision_id=request.revisionId,
            project_id=request.projectId,
            parent_revision_id=request.parentRevisionId,
            revision_index=request.revisionIndex,
            pass_index=request.passIndex,
            model_id=request.modelId,
            usage_event_id=request.usageEventId,
            credits_spent=request.creditsSpent,
        )
    except VisionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    document = outcome.document
    RigDocumentModel = document.__class__
    RigDocumentModel.model_validate(json.loads(document.model_dump_json()))

    return ApplyCritiqueResponse(
        document=document,
        applied=[
            AppliedCorrectionRecord(
                kind=item.kind,
                targetId=item.target_id,
                reason=item.reason,
                effect=item.effect,
                clamped=item.clamped,
            )
            for item in outcome.applied
        ],
        deformerOverrides=dict(outcome.deformer_overrides),  # type: ignore[arg-type]
        requiresRerig=outcome.requires_rerig,
        warnings=outcome.warnings,
    )


@router.post("/stages/{stage}", response_model=StageResponse)
async def run_stub_stage_endpoint(stage: str, request: StageRequest) -> StageResponse:
    """Infra-slice stub: Node BullMQ workers call this for every queued stage."""
    if stage not in _STUB_STAGES:
        raise HTTPException(status_code=404, detail=f"Unknown AniBuddy stage: {stage}")
    if request.stage != stage:
        raise HTTPException(
            status_code=400,
            detail=f"Path stage '{stage}' does not match body stage '{request.stage}'",
        )
    return run_stub_stage(request)
