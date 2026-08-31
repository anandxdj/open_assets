"""Stub AniBuddy pipeline stages for the infra vertical slice.

Real OpenCV / meshing / encode work lands in later todos. These handlers only
return a valid RigDocument-shaped child revision so Node can exercise queues,
Mongo project docs, StorageAdapter artifact keys, and frontend polling.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.modules.anibuddy.schemas import (
    ARCHETYPE_VALUES,
    AssetRef,
    DeformerRigid,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    MaskRect,
    Part,
    Rect,
    RevisionLink,
    RigDocument,
    Skeleton,
    StageRecord,
    Vec2,
)

_CONFIG = ConfigDict(extra="forbid", protected_namespaces=())

QueuedStage = Literal["decompose", "rig", "animate", "render"]


class StageAssetInput(BaseModel):
    model_config = _CONFIG

    id: str = Field(..., pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(..., min_length=1, max_length=200)
    storageKey: str = Field(..., min_length=1, max_length=512)
    sourceUrl: Optional[str] = None
    contentHash: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    width: int = Field(..., ge=1, le=8192)
    height: int = Field(..., ge=1, le=8192)
    mimeType: Literal["image/png", "image/webp", "image/jpeg"]
    rightsConfirmed: bool
    remoteVisionConsented: bool


class StageRequest(BaseModel):
    """Wire body from the Node BullMQ worker (camelCase)."""

    model_config = _CONFIG

    projectId: str = Field(..., min_length=1, max_length=64)
    stage: QueuedStage
    inputHash: str = Field(..., pattern=r"^[a-f0-9]{64}$")
    passIndex: int = Field(..., ge=0, le=8)
    usageEventId: Optional[str] = Field(None, pattern=r"^[a-f0-9]{24}$")
    pipelineVersion: str = Field(..., max_length=40)
    kernelVersion: str = Field(..., max_length=40)
    asset: StageAssetInput
    archetype: str = Field(..., max_length=40)
    parentDocument: Optional[dict[str, Any]] = None
    currentRevision: int = Field(..., ge=0, le=4096)


class StageArtifactHint(BaseModel):
    model_config = _CONFIG

    kind: str
    suggestedStorageKey: str
    contentHash: str
    contentBase64: Optional[str] = None
    mimeType: Optional[str] = None


class StageResponse(BaseModel):
    model_config = _CONFIG

    document: RigDocument
    artifact: Optional[StageArtifactHint] = None
    message: Optional[str] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _pipeline_version(request: StageRequest) -> str:
    return request.pipelineVersion or getattr(settings, "ANIBUDDY_PIPELINE_VERSION", "5.0.0-stub")


def _kernel_version(request: StageRequest) -> str:
    return request.kernelVersion or getattr(settings, "ANIBUDDY_KERNEL_VERSION", "0.1.0-numpy")


def _asset_ref(request: StageRequest) -> AssetRef:
    a = request.asset
    return AssetRef(
        id=a.id,
        name=a.name,
        storageKey=a.storageKey,
        contentHash=a.contentHash,
        width=a.width,
        height=a.height,
        figureHeight=a.figureHeight,
        mimeType=a.mimeType,
        rightsConfirmed=a.rightsConfirmed,
        remoteVisionConsented=a.remoteVisionConsented,
    )


def _stub_part() -> Part:
    return Part(
        id="stub_torso",
        name="Stub torso",
        role="torso",
        mask=MaskRect(kind="rect"),
        rect=Rect(x=0.1, y=0.1, width=0.8, height=0.8),
        pivot=Vec2(x=0.5, y=0.15),
        zIndex=0,
        parentPartId=None,
        attachSlot=None,
        slots=[],
        deformer=DeformerRigid(kind="rigid"),
        boundJointId=None,
        visible=True,
        opacity=1.0,
        confidence=0.42,
        provenance="alpha-component",
    )


def _blocking_reason(stage: QueuedStage) -> Optional[str]:
    # Stub documents are not export-ready — server authors diagnostics.blockingReason.
    if stage == "decompose":
        return "Stub decompose only — real cutouts and a skeleton are required before export."
    if stage == "rig":
        return "Stub rig only — deformers and joints are placeholders."
    if stage == "animate":
        return "Stub animate only — no real keyframes yet."
    return "Stub render only — no encoded frames yet."


def build_stub_document(request: StageRequest) -> RigDocument:
    """Produce a minimal valid RigDocument child revision for the requested stage."""
    now = _now_iso()
    revision_index = request.currentRevision + 1
    doc_id = f"rev_{request.projectId[:8]}_{revision_index}"
    parent_id = None
    if isinstance(request.parentDocument, dict):
        parent_id = request.parentDocument.get("id")

    archetype = request.archetype if request.archetype in ARCHETYPE_VALUES else "humanoid"

    parts = [_stub_part()]
    # Later stages keep the stub part set; real stages will replace via child revision.
    if isinstance(request.parentDocument, dict) and request.parentDocument.get("parts"):
        try:
            parts = [Part.model_validate(p) for p in request.parentDocument["parts"]]
        except Exception:
            parts = [_stub_part()]

    stage_record = StageRecord(
        stage=request.stage,
        status="succeeded",
        startedAt=now,
        finishedAt=now,
        inputHash=request.inputHash,
        passIndex=request.passIndex,
        modelId=None,
        usageEventId=request.usageEventId,
        creditsSpent=0,
        message=f"Stub {request.stage} completed",
    )

    return RigDocument(
        schemaVersion=5,
        id=doc_id,
        projectId=request.projectId,
        createdAt=now,
        updatedAt=now,
        revision=RevisionLink(
            index=revision_index,
            parentRevisionId=parent_id if isinstance(parent_id, str) else None,
            reason=f"stub-{request.stage}",
            accepted=False,
        ),
        archetype=archetype,  # type: ignore[arg-type]
        asset=_asset_ref(request),
        parts=parts,
        skeleton=Skeleton(joints=[]),
        clips=[],
        generation=GenerationSeam(
            mode="external-prompt-only",
            prompt=None,
            transcript=[],
            producedBy=None,
        ),
        provenance=DocumentProvenance(
            pipelineVersion=_pipeline_version(request),
            kernelVersion=_kernel_version(request),
            stages=[stage_record],
        ),
        diagnostics=Diagnostics(
            foregroundPixels=0,
            coveredForegroundPixels=0,
            overlappingPartPairs=[],
            maxStretch=1.0,
            flippedTriangles=0,
            isolatedVertices=0,
            warnings=[f"infra-slice stub: {request.stage}"],
            blockingReason=_blocking_reason(request.stage),
        ),
    )


def build_artifact_hint(request: StageRequest, document: RigDocument) -> StageArtifactHint:
    """Small JSON payload for Node to upload via StorageAdapter (Node owns storage)."""
    payload = {
        "stage": request.stage,
        "projectId": request.projectId,
        "documentId": document.id,
        "inputHash": request.inputHash,
        "stub": True,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    key = f"anibuddy/{request.projectId}/{request.stage}/{digest[:16]}.json"
    return StageArtifactHint(
        kind="stage-result",
        suggestedStorageKey=key,
        contentHash=digest,
        contentBase64=base64.b64encode(raw).decode("ascii"),
        mimeType="application/json",
    )


def run_stub_stage(request: StageRequest) -> StageResponse:
    document = build_stub_document(request)
    artifact = build_artifact_hint(request, document)
    return StageResponse(
        document=document,
        artifact=artifact,
        message=f"Stub {request.stage} ok",
    )
