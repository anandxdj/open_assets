"""Decompose stage orchestration — classical CV only, no model.

Cascade (cheapest first), matching F9 §8.1:

1. gutter-grid
2. alpha connected components
3. watershed (touching parts)
4. grabCut (overlapping / shared silhouette)
5. single-part degenerate (valid, not an error)

Never edits source pixels. Emits reversible masks + confidence + provenance.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import List, Optional, Sequence

import numpy as np

from app.modules.anibuddy.constants import DecomposeConstants
from app.modules.anibuddy.decompose.alpha import alpha_components, whole_sheet_candidate
from app.modules.anibuddy.decompose.grabcut import grabcut_split
from app.modules.anibuddy.decompose.gutter import candidate_grid
from app.modules.anibuddy.decompose.masks import (
    alpha_foreground,
    count_foreground,
    covered_foreground_pixels,
    overlapping_part_pairs,
    promote_candidate,
)
from app.modules.anibuddy.decompose.types import PartCandidate
from app.modules.anibuddy.decompose.watershed import touching_probe, watershed_split
from app.modules.anibuddy.schemas import (
    AssetRef,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    Part,
    RevisionLink,
    RigDocument,
    Skeleton,
    StageRecord,
)


class DecomposeError(ValueError):
    """Raised when the sheet has no opaque pixels (hard refuse)."""


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _ensure_bgra(image: np.ndarray) -> np.ndarray:
    """Normalize decoded OpenCV images to BGRA without inventing RGB values.

    Gray → BGRA with full opacity; BGR → BGRA with full opacity; already-BGRA
    is returned as-is. Adding a synthetic full alpha on opaque inputs is a
    channel layout fix, not a pixel invent — every opaque pixel stays opaque.
    """
    if image.ndim == 2:
        bgr = np.stack([image, image, image], axis=-1)
        alpha = np.full(image.shape, 255, dtype=np.uint8)
        return np.dstack([bgr, alpha])
    if image.ndim == 3 and image.shape[2] == 3:
        alpha = np.full(image.shape[:2], 255, dtype=np.uint8)
        return np.dstack([image, alpha])
    if image.ndim == 3 and image.shape[2] == 4:
        return image
    raise ValueError(f"Unsupported image shape {image.shape}")


def _cap_parts(candidates: Sequence[PartCandidate]) -> tuple[List[PartCandidate], List[str]]:
    warnings: List[str] = []
    ordered = sorted(candidates, key=lambda c: -c.bounds.pixels)
    if len(ordered) > DecomposeConstants.MAX_PARTS:
        warnings.append(
            f"Detected {len(ordered)} part candidates; kept the "
            f"{DecomposeConstants.MAX_PARTS} largest by area."
        )
        ordered = ordered[: DecomposeConstants.MAX_PARTS]
    return list(ordered), warnings


def _run_cascade(
    rgba: np.ndarray,
    fg_mask: np.ndarray,
) -> tuple[List[PartCandidate], List[str]]:
    warnings: List[str] = []

    grid = candidate_grid(fg_mask)
    if grid is not None:
        warnings.append("Detected transparent grid gutters.")
        return _cap_parts(grid)

    components = alpha_components(fg_mask)
    if len(components) >= 2:
        warnings.append("Detected alpha-connected candidates.")
        return _cap_parts(components)

    # Single (or filtered-empty) alpha component: escalate. Touch-probe is an
    # advisory note only — watershed can still seed-split when erode does not.
    if touching_probe(fg_mask):
        warnings.append("Foreground survives erode as multiple islands (touching).")

    split = watershed_split(rgba, fg_mask)
    if split is not None:
        warnings.append("Partitioned with watershed.")
        return _cap_parts(split)

    grab = grabcut_split(rgba, fg_mask)
    if grab is not None:
        warnings.append(
            "Shared silhouette partitioned with grabCut (low confidence)."
        )
        return _cap_parts(grab)

    whole = whole_sheet_candidate(fg_mask)
    if whole is None:
        raise DecomposeError("This image has no opaque pixels.")
    warnings.append(
        "No separable transparent candidates were found; the complete sheet "
        "is retained as one unclassified part."
    )
    return [whole], warnings


def _figure_height(parts: List[Part], sheet_h: int) -> float:
    """The subject's own height in source pixels: the union of the part rects.

    This is the denominator for every ``tx``/``ty`` channel and for spline
    thickness, and it is measured HERE — once, by the stage that first knows
    what the parts are — rather than re-derived per stage. A later stage that
    merged two parts would otherwise silently re-time every clip already
    authored against the old number.

    A sheet with no parts falls back to its own height, which is also what a
    consumer does with a null. The two are the same arithmetic on artwork that
    fills its sheet, so the measurement is a refinement of the fallback rather
    than a different convention.
    """
    if not parts:
        return float(sheet_h)
    top = min(part.rect.y for part in parts)
    bottom = max(part.rect.y + part.rect.height for part in parts)
    # Clamped to at least one pixel: the schema's minimum, and a zero here would
    # divide every translation channel by zero.
    return max(1.0, (bottom - top) * float(sheet_h))


def decompose_image(
    image: np.ndarray,
    *,
    asset: AssetRef,
    project_id: str,
    revision_id: str,
    archetype: str = DecomposeConstants.DEFAULT_ARCHETYPE,
    parent_revision_id: Optional[str] = None,
    revision_index: int = 0,
    input_bytes: Optional[bytes] = None,
) -> RigDocument:
    """Run the decompose cascade and return a provisional RigDocument revision.

    ``parts`` carry masks/rects/confidence/provenance only. Roles stay
    ``other``, deformers stay ``rigid``, skeleton and clips are empty —
    later stages fill those in. Source pixels are never modified.

    ``archetype`` is carried through rather than derived. Which rig prior applies
    (F9 §10) is a semantic judgement about the artwork, and this stage only
    measures pixels — so the caller's choice is recorded and the ``semantics``
    stage is what may later overrule it.
    """
    started = _utcnow_iso()
    rgba = _ensure_bgra(image)
    height, width = rgba.shape[:2]
    if (
        width < 1
        or height < 1
        or width > DecomposeConstants.MAX_SOURCE_EDGE
        or height > DecomposeConstants.MAX_SOURCE_EDGE
    ):
        raise DecomposeError(
            f"Unsupported image dimensions {width}x{height} "
            f"(max {DecomposeConstants.MAX_SOURCE_EDGE})"
        )

    # Prefer the caller's declared size; fall back to decoded pixels.
    sheet_w = asset.width if asset.width > 0 else width
    sheet_h = asset.height if asset.height > 0 else height

    fg_mask = alpha_foreground(rgba)
    foreground = count_foreground(fg_mask)
    if foreground == 0:
        raise DecomposeError("This image has no opaque pixels.")

    candidates, warnings = _run_cascade(rgba, fg_mask)
    covered = covered_foreground_pixels(candidates, fg_mask)
    if foreground > 0:
        gap = 1.0 - (covered / foreground)
        if gap > DecomposeConstants.COVERAGE_GAP_WARN:
            warnings.append(
                f"Coverage gap {gap:.1%}: {foreground - covered} opaque pixels "
                "were not claimed by any part."
            )

    parts: List[Part] = [
        promote_candidate(c, index, sheet_w, sheet_h)
        for index, c in enumerate(candidates)
    ]

    # inputHash is SHA-256 of the stage input. Prefer raw bytes when the
    # caller still has them; otherwise hash the decoded raster.
    if input_bytes is not None:
        input_hash = hashlib.sha256(input_bytes).hexdigest()
    else:
        input_hash = hashlib.sha256(rgba.tobytes()).hexdigest()

    finished = _utcnow_iso()
    stage = StageRecord(
        stage="decompose",
        status="succeeded",
        startedAt=started,
        finishedAt=finished,
        inputHash=input_hash,
        passIndex=0,
        modelId=None,
        usageEventId=None,
        creditsSpent=0,
        message=f"decompose produced {len(parts)} part(s)",
    )

    diagnostics = Diagnostics(
        foregroundPixels=foreground,
        coveredForegroundPixels=covered,
        overlappingPartPairs=overlapping_part_pairs(parts),
        maxStretch=0.0,
        flippedTriangles=0,
        isolatedVertices=0,
        warnings=warnings[:64],
        blockingReason=None,
    )

    # Align asset dimensions with what we actually decoded when the caller
    # left them as placeholders — still does not rewrite pixel bytes — and
    # record the figure's own height while the parts are in hand.
    aligned_asset = asset.model_copy(
        update={
            "width": sheet_w,
            "height": sheet_h,
            "figureHeight": _figure_height(parts, sheet_h),
        }
    )

    return RigDocument(
        schemaVersion=5,
        id=revision_id,
        projectId=project_id,
        createdAt=started,
        updatedAt=finished,
        revision=RevisionLink(
            index=revision_index,
            parentRevisionId=parent_revision_id,
            reason=DecomposeConstants.REVISION_REASON,
            accepted=False,
        ),
        archetype=archetype,
        asset=aligned_asset,
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
            pipelineVersion=DecomposeConstants.PIPELINE_VERSION,
            kernelVersion=DecomposeConstants.KERNEL_VERSION,
            stages=[stage],
        ),
        diagnostics=diagnostics,
    )


# Aggregator-style export matching the module's wrapped-methods convention.
class DecomposeService:
    """Public service surface for the decompose stage."""

    DecomposeError = DecomposeError

    @staticmethod
    def run(
        image: np.ndarray,
        *,
        asset: AssetRef,
        project_id: str,
        revision_id: str,
        archetype: str = DecomposeConstants.DEFAULT_ARCHETYPE,
        parent_revision_id: Optional[str] = None,
        revision_index: int = 0,
        input_bytes: Optional[bytes] = None,
    ) -> RigDocument:
        return decompose_image(
            image,
            asset=asset,
            project_id=project_id,
            revision_id=revision_id,
            archetype=archetype,
            parent_revision_id=parent_revision_id,
            revision_index=revision_index,
            input_bytes=input_bytes,
        )
