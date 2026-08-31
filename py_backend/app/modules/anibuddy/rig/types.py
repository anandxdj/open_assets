"""Internal value objects for the rig stage.

Deliberately NOT the wire schema. The stage's intermediate shapes carry pixel
rasters and float64 arrays that have no place in a RigDocument, and keeping
them separate is what lets the meshing and skinning code be unit-tested without
constructing a whole document (same reasoning as ``kernel/types.py``).

Coordinate spaces, stated rather than inferred (R6)
--------------------------------------------------
* ``PartRaster.mask`` is indexed in PART-LOCAL PIXELS: row 0 is the top of
  ``Part.rect``, not the top of the sheet.
* ``MeshBuild.verts`` is in PART-LOCAL PIXELS. Normalizing to ``Part.rect``
  happens once, at the wire boundary in ``deformers.py``.
* Bone geometry passed to the skinner is in SHEET PIXELS, because joints are
  sheet-normalized and a distance measured in a non-uniformly scaled basis is
  not a distance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np


class RigError(ValueError):
    """A structurally invalid rig input, refused rather than repaired.

    The v3 ``sanitizeJointGraph`` philosophy (``lib/skeleton.ts`` lines 43-44),
    kept verbatim in intent: a plausible-looking broken graph deforms silently
    into something that animates wrongly, which is strictly worse for the user
    than a refusal naming what is wrong.
    """


@dataclass(frozen=True, eq=False, slots=True)
class PartRaster:
    """A part's mask, resolved to part-local pixels.

    ``origin_x``/``origin_y`` are the rect's top-left in sheet pixels, so a
    caller can lift a part-local point back to the sheet without re-deriving
    the rect rounding.
    """

    part_id: str
    #: (height, width) uint8, 0 or 255.
    mask: np.ndarray
    width: int
    height: int
    origin_x: int
    origin_y: int
    solid_pixels: int

    @property
    def area_fraction(self) -> float:
        """Solid pixels as a fraction of the part's own rect."""
        total = self.width * self.height
        return 0.0 if total <= 0 else self.solid_pixels / total


@dataclass(frozen=True, eq=False, slots=True)
class MeshBuild:
    """A triangulated part in part-local pixels."""

    #: (vert_count, 2) float64, part-local pixels.
    verts: np.ndarray
    #: (tri_count, 3) int32 indices into ``verts``.
    tris: np.ndarray
    #: Smallest triangle angle in degrees actually achieved, for diagnostics.
    min_angle_deg: float
    #: Triangles still under the target angle after refinement gave up.
    sliver_count: int
    #: Refinement passes consumed. Surfaced so a pathological silhouette is
    #: visible in the stage message rather than only as a slow request.
    refine_passes: int
    #: Whether every constraint segment survived as a mesh edge. False means
    #: triangles straddle a cut line — the skinner's cut test is geometric so
    #: influence is still blocked, but the mesh has no seam along it.
    conforming: bool
    #: Poisson pitch the successful pass ran at, in part-local pixels.
    spacing_px: float

    @property
    def vert_count(self) -> int:
        return int(self.verts.shape[0])

    @property
    def tri_count(self) -> int:
        return int(self.tris.shape[0])


@dataclass(frozen=True, eq=False, slots=True)
class BoneSegment:
    """One derived bone, in sheet pixels, with the wire column id it owns.

    The two ``*_part_id`` fields are what make per-part bone selection possible
    at all: with one global mesh, "every bone" was the right answer, and with N
    cutout layers it is the answer that lets a torso bone drag an arm.
    """

    #: ``parentJointId->childJointId``, matching ``kernel/skeleton.py``.
    id: str
    parent_joint_id: str
    child_joint_id: str
    start: Tuple[float, float]
    end: Tuple[float, float]
    parent_part_id: Optional[str]
    child_part_id: Optional[str]


@dataclass(frozen=True, eq=False, slots=True)
class SkinResult:
    """A weight matrix and the explicit column order that indexes it."""

    #: (vert_count, bone_count) float32, rows summing to 1.
    weights: np.ndarray
    #: Weight-matrix column order. Storing it is what stops a per-part matrix
    #: silently reinterpreting itself when the skeleton gains a joint.
    bone_ids: List[str]
    #: Vertices a cut severed from every bone, which fell back to nearest-bone.
    isolated_vertices: int
    #: Which solver produced the rows, for the stage message.
    method: str


@dataclass(frozen=True, eq=False, slots=True)
class CutPolyline:
    """A cut line in part-local pixels, ready for the geometric predicates."""

    id: str
    #: (point_count, 2) float64.
    points: np.ndarray


@dataclass(eq=False, slots=True)
class PendingBuffer:
    """A ``NumericBuffer`` payload too large to inline.

    py_backend does not own the ``StorageAdapter`` — Node does. So an external
    buffer leaves here as bytes plus the content-addressed key it should land
    under, and the caller uploads it. Content addressing makes that upload
    idempotent: identical geometry produces an identical key, so a re-run
    overwrites itself with the same bytes or is skipped entirely.
    """

    storage_key: str
    sha256: str
    dtype: str
    length: int
    data: bytes


@dataclass(eq=False, slots=True)
class StageReport:
    """Everything the stage learned that is not part of the geometry itself."""

    warnings: List[str] = field(default_factory=list)
    isolated_vertices: int = 0
    #: Populated when a document must not be rendered or exported.
    blocking_reasons: List[str] = field(default_factory=list)
    pending_buffers: List[PendingBuffer] = field(default_factory=list)
    #: Per-part note of the deformer that was actually built, for the message.
    deformer_kinds: List[Tuple[str, str]] = field(default_factory=list)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def block(self, reason: str) -> None:
        self.blocking_reasons.append(reason)

    def extend_buffers(self, buffers: Sequence[PendingBuffer]) -> None:
        self.pending_buffers.extend(buffers)

    def blocking_reason(self) -> Optional[str]:
        """One user-facing sentence, or None when the document is renderable.

        A sentence rather than a boolean, for the reason v3's
        ``rigInvalidReason`` was one: the editor has to be able to explain why
        export is locked.
        """
        if not self.blocking_reasons:
            return None
        return " ".join(self.blocking_reasons)
