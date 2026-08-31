"""Kernel input and output structs.

These are deliberately NOT the ``RigDocument`` v5 wire schema. The kernel owns
a minimal, stable shape and each caller adapts the wire format into it. That
keeps a schema revision from forcing a change to parity-critical math, and it
keeps the kernel testable without dragging Pydantic, Mongo, or a storage
adapter into a pure-math module.

Mirrored by ``frontend/src/features/anibuddy/kernel/types.ts``.

Coordinate convention
---------------------
Every position on the wire is normalized 0..1 against the asset's own width
(x) or height (y). The kernel converts to SOURCE PIXELS on load and does all
math there. This is not a style preference: a rotation applied in normalized
space is a rotation in a non-uniformly scaled basis, which shears the figure
whenever the asset is not square. The v3 browser renderer learned this the
hard way; see the comment at ``lib/deform.ts`` line 68.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final, Literal, Mapping, Sequence

import numpy as np

from .constants import KernelConstants

#: The kernel stores and reports float32 because that is what the wire schema
#: stores. Intermediate arithmetic is float64; see ``numeric.py`` for why.
STORAGE_DTYPE: Final = np.float32
INDEX_DTYPE: Final = np.uint32

DeformerKind = Literal["rigid", "mesh", "lattice", "spline"]
LatticeInterpolation = Literal["bilinear", "bicubic"]
EaseKind = Literal["linear", "ease", "hold"]


class KernelInputError(ValueError):
    """A structurally invalid rig or pose.

    Raised rather than repaired. A plausible-looking broken rig deforms
    silently into garbage, and a caller that gets a rig back cannot tell that
    the kernel guessed.
    """


@dataclass(frozen=True, slots=True)
class Asset:
    """The sheet the rig is authored against."""

    width: int
    height: int
    #: Height in pixels of the subject inside the sheet, used as the scale for
    #: the ``tx``/``ty`` pose channels and for spline thickness. Translations
    #: are authored as a fraction of the figure, not of the canvas, so the same
    #: clip reads identically on a tightly cropped and a loosely cropped sheet.
    figure_height: float

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Asset":
        width = int(data["width"])
        height = int(data["height"])
        if width <= 0 or height <= 0:
            raise KernelInputError("Asset dimensions must be positive.")
        figure_height = float(data.get("figureHeight", height))
        return cls(width=width, height=height, figure_height=figure_height)


@dataclass(frozen=True, slots=True)
class Joint:
    """A node in the free-form joint tree. Positions are normalized 0..1."""

    id: str
    parent: str | None
    x: float
    y: float

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Joint":
        parent = data.get("parent")
        return cls(
            id=str(data["id"]),
            parent=None if parent is None else str(parent),
            x=float(data["x"]),
            y=float(data["y"]),
        )


@dataclass(frozen=True, slots=True)
class Bone:
    """A parent to child segment.

    Bones are always DERIVED from the joint tree, never stored. Their order
    follows joint order because that order indexes the columns of the skinning
    weight matrix: reordering joints without rebuilding weights silently
    rebinds every vertex to the wrong bone.
    """

    id: str
    parent_joint: str
    child_joint: str


@dataclass(frozen=True, slots=True)
class JointPose:
    """A sparse local pose delta for one joint.

    Absent channels mean "at rest", which is not the same as zero for
    ``scale``. Keeping them absent rather than defaulted lets keyframe
    interpolation tell "this key does not touch scale" from "this key sets
    scale to 1".
    """

    rot: float | None = None
    tx: float | None = None
    ty: float | None = None
    scale: float | None = None

    @property
    def rot_or_rest(self) -> float:
        return KernelConstants.REST_DEFAULT if self.rot is None else self.rot

    @property
    def tx_or_rest(self) -> float:
        return KernelConstants.REST_DEFAULT if self.tx is None else self.tx

    @property
    def ty_or_rest(self) -> float:
        return KernelConstants.REST_DEFAULT if self.ty is None else self.ty

    @property
    def scale_or_rest(self) -> float:
        return KernelConstants.REST_SCALE if self.scale is None else self.scale

    def channel(self, name: str) -> float | None:
        return getattr(self, name)

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "JointPose":
        def read(key: str) -> float | None:
            value = data.get(key)
            return None if value is None else float(value)

        return cls(rot=read("rot"), tx=read("tx"), ty=read("ty"), scale=read("scale"))

    def to_mapping(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for name in KernelConstants.POSE_CHANNELS:
            value = self.channel(name)
            if value is not None:
                out[name] = value
        return out


#: Sparse: joints absent from the mapping are at rest.
Pose = dict[str, JointPose]

#: A part's local delta, and deliberately the SAME four channels as a joint's.
#:
#: The wire's ``PartPose`` carries eight; the other four -- ``visible``,
#: ``opacity``, ``zIndex`` and ``swapTo`` -- are compositing rather than
#: geometry and are resolved by ``render/partpose.py``, which is parity-locked to
#: the browser's ``part-track.ts`` by its own corpus. Rasterization is per-target
#: by design (R4); deciding what to rasterize is not.
#: What crosses into the kernel is exactly the geometry subset, and it is the
#: same struct rather than a copy of it so the two can never acquire different
#: rest values or a different interpolation form. A part and a joint move the
#: same way; the difference is what they drive, not how they are keyed.
PartPose = JointPose

#: Sparse: parts absent from the mapping are at rest.
PartPoseMap = dict[str, PartPose]


def pose_from_mapping(data: Mapping[str, Any]) -> Pose:
    return {str(key): JointPose.from_mapping(value) for key, value in data.items()}


def pose_to_mapping(pose: Pose) -> dict[str, dict[str, float]]:
    return {key: value.to_mapping() for key, value in pose.items()}


@dataclass(frozen=True, slots=True)
class Keyframe:
    """One authored pose at a normalized time.

    ``ease`` describes the segment that STARTS at this key, so the easing of
    the key you are leaving governs the interpolation, not the key you are
    arriving at. ``None`` means smoothstep, matching the v3 browser default.

    ``joints`` and ``parts`` are sampled by the same bracketing, easing and
    sparsity rules -- see ``clip.py``. They are two mappings rather than one
    because a part id and a joint id live in different namespaces and may
    legitimately collide.
    """

    t: float
    joints: Pose
    parts: PartPoseMap = field(default_factory=dict)
    ease: EaseKind | None = None

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Keyframe":
        ease = data.get("ease")
        return cls(
            t=float(data["t"]),
            joints=pose_from_mapping(data.get("joints", {})),
            parts=pose_from_mapping(data.get("parts", {})),
            ease=None if ease is None else str(ease),  # type: ignore[arg-type]
        )


@dataclass(frozen=True, slots=True)
class Clip:
    """An ordered keyframe track. ``loop`` closes the track back onto key 0."""

    id: str
    loop: bool
    keyframes: tuple[Keyframe, ...]

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Clip":
        return cls(
            id=str(data.get("id", "")),
            loop=bool(data.get("loop", False)),
            keyframes=tuple(Keyframe.from_mapping(key) for key in data.get("keyframes", [])),
        )


# --- Deformer payloads -----------------------------------------------------


@dataclass(frozen=True, slots=True)
class RigidDeformer:
    """Pure affine follow. The part's quad rides one joint with zero deformation.

    Carries no fields at all: the rectangle it draws is ``Part.rect`` and the
    joint it rides is ``Part.bound_joint_id``. Both used to be copied onto this
    struct, which meant the wire's part state and the kernel's deformer state
    were two descriptions of one thing with nothing keeping them equal.
    """

    kind: Literal["rigid"]


@dataclass(frozen=True, eq=False, slots=True)
class MeshDeformer:
    """Triangle mesh driven by linear blend skinning."""

    kind: Literal["mesh"]
    #: (vert_count, 2) float32, normalized.
    verts: np.ndarray
    #: (tri_count, 3) uint32 indices into ``verts``.
    tris: np.ndarray
    #: (vert_count, bone_count) float32, row-major, rows summing to 1. Columns
    #: are indexed by DERIVED bone order.
    weights: np.ndarray


@dataclass(frozen=True, eq=False, slots=True)
class LatticeDeformer:
    """Free-form deformation over a quad control grid.

    ``control_points`` are ABSOLUTE part-local normalized positions -- the wire
    form, verbatim -- rather than displacements from the rest grid. Storing
    displacements would mean every caller reconstructed the same uniform rest
    grid to difference against, and two reconstructions of one grid is two
    chances to disagree in the one place where disagreement reads as the
    artwork shearing at rest.

    The evaluated surface is then carried by ``Part.bound_joint_id`` so a
    lattice part still follows the skeleton.
    """

    kind: Literal["lattice"]
    cols: int
    rows: int
    #: (rows + 1, cols + 1, 2) float32 part-local normalized positions,
    #: row-major (rows outer). At rest, point (i, j) is (i / cols, j / rows).
    control_points: np.ndarray
    interpolation: LatticeInterpolation


@dataclass(frozen=True, slots=True)
class SplineDeformer:
    """Ribbon warp along a joint chain, for tails, tentacles and ropes.

    The control polyline IS a chain of joints, so the spline is posed by the
    same forward kinematics as everything else rather than needing its own
    animation channels. Rest control points come from the joints' rest
    positions, posed control points from the FK solve.
    """

    kind: Literal["spline"]
    #: Joint ids in order along the chain, at least two.
    joints: tuple[str, ...]
    #: Taper track: at least one ribbon width, each a fraction of
    #: ``Asset.figure_height``. Indexed by NORMALIZED POSITION along the spine
    #: rather than by joint, so a chain the joint budget cut short still tapers
    #: over its whole length. One entry is a uniform ribbon.
    thickness: tuple[float, ...]
    segments: int


Deformer = RigidDeformer | MeshDeformer | LatticeDeformer | SplineDeformer

#: A similarity transform as ``(a, b, origin_x, origin_y)``, meaning
#: ``v' = [a  -b; b  a] * v + (origin_x, origin_y)``.
#:
#: Two numbers for the linear part rather than four, because every transform
#: the kernel composes is a rotation with a uniform scale -- never a shear and
#: never a non-uniform scale. That is not a simplification of a general affine;
#: it is what the pose channels can express, and holding the type to it means a
#: shear cannot be introduced by accident.
PartTransform = tuple[float, float, float, float]


def _float32_array(values: Sequence[Any], shape: tuple[int, ...], label: str) -> np.ndarray:
    array = np.asarray(values, dtype=STORAGE_DTYPE)
    if array.size != int(np.prod(shape)):
        raise KernelInputError(f"{label} has {array.size} values, expected {int(np.prod(shape))}.")
    return array.reshape(shape)


def deformer_from_mapping(data: Mapping[str, Any]) -> Deformer:
    """Adapt a plain mapping into a deformer payload.

    Convenience for fixtures and for callers whose wire format already matches;
    the real wire adapter lives with the caller, not here.
    """

    kind = str(data["kind"])
    if kind == "rigid":
        return RigidDeformer(kind="rigid")
    if kind == "mesh":
        verts = np.asarray(data["verts"], dtype=STORAGE_DTYPE).reshape(-1, 2)
        tris = np.asarray(data["tris"], dtype=INDEX_DTYPE).reshape(-1, 3)
        bone_count = int(data["boneCount"])
        weights = _float32_array(data["weights"], (verts.shape[0], bone_count), "mesh weights")
        return MeshDeformer(kind="mesh", verts=verts, tris=tris, weights=weights)
    if kind == "lattice":
        cols = int(data["cols"])
        rows = int(data["rows"])
        if not (
            KernelConstants.LATTICE_MIN_DIVISIONS <= cols <= KernelConstants.LATTICE_MAX_DIVISIONS
            and KernelConstants.LATTICE_MIN_DIVISIONS <= rows <= KernelConstants.LATTICE_MAX_DIVISIONS
        ):
            raise KernelInputError(f"Lattice {cols}x{rows} is outside the supported range.")
        control_points = _float32_array(
            data["controlPoints"], (rows + 1, cols + 1, 2), "lattice control points"
        )
        return LatticeDeformer(
            kind="lattice",
            cols=cols,
            rows=rows,
            control_points=control_points,
            interpolation=str(data.get("interpolation", "bilinear")),  # type: ignore[arg-type]
        )
    if kind == "spline":
        joints = tuple(str(value) for value in data["joints"])
        if len(joints) < 2:
            raise KernelInputError("A spline deformer needs at least two joints.")
        segments = int(data["segments"])
        if not (
            KernelConstants.SPLINE_MIN_SEGMENTS <= segments <= KernelConstants.SPLINE_MAX_SEGMENTS
        ):
            raise KernelInputError(f"Spline segment count {segments} is outside the supported range.")
        return SplineDeformer(
            kind="spline",
            joints=joints,
            thickness=_thickness_track(data["thickness"]),
            segments=segments,
        )
    raise KernelInputError(f'Unknown deformer kind "{kind}".')


def _thickness_track(value: Any) -> tuple[float, ...]:
    """A spline taper track from either a scalar or a sequence.

    A bare number is accepted as a one-entry track, which is the uniform
    ribbon; it is not a legacy shim but the honest reading of "this ribbon has
    one width".
    """

    if isinstance(value, (int, float)):
        return (float(value),)
    track = tuple(float(item) for item in value)
    if not track:
        raise KernelInputError("A spline deformer needs at least one thickness value.")
    return track


@dataclass(frozen=True, slots=True)
class Slot:
    """A named attachment point one part OFFERS to its children.

    ``x``/``y`` are PART-LOCAL normalized against the host's ``rect`` (R6),
    exactly like ``Part.pivot``. A slot carries a position and nothing else:
    its orientation and scale are the host's, which is what lets a sword move
    from a hand slot to a back slot without either part learning the other's
    geometry.
    """

    name: str
    x: float
    y: float

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Slot":
        position = data["position"]
        return cls(name=str(data["name"]), x=float(position[0]), y=float(position[1]))


@dataclass(frozen=True, eq=False, slots=True)
class Part:
    """One cutout layer: its deformer, its place in the sheet, and its parent.

    A part is driven by two independent things, and keeping them separable is
    the whole point of the layered-cutout model:

    * its **deformer**, which shapes the artwork against the JOINT skeleton;
    * its **place in the part tree**, which carries the whole shaped layer as
      a unit.

    ``rect`` and ``bound_joint_id`` live here rather than on the deformers that
    happen to need them. ``rect`` because ``pivot`` and every ``Slot`` are
    part-local normalized against it, and a mesh or spline part has a pivot
    too; ``bound_joint_id`` because it is the same field for a rigid part and a
    lattice part and copying it onto both deformers gave two places for one
    fact to live.
    """

    id: str
    z_index: int
    deformer: Deformer
    #: Sheet-normalized [x0, y0, x1, y1]. Defines the part-local space.
    rect: tuple[float, float, float, float] = KernelConstants.FULL_SHEET_RECT
    #: Part-local normalized rotation and scale centre.
    pivot: tuple[float, float] = KernelConstants.DEFAULT_PIVOT
    #: The joint a ``rigid`` or ``lattice`` part rides. None -- or an id the
    #: skeleton does not contain -- resolves to the ROOT joint, not to the
    #: identity: a part pinned to nothing stays put while the figure moves
    #: around it, which reads as the part having come loose.
    bound_joint_id: str | None = None
    #: Transform parent in the cutout tree, or None for a root part.
    parent_part_id: str | None = None
    #: Name of a ``Slot`` on the parent this part hangs from, or None to keep
    #: its own authored placement.
    attach_slot: str | None = None
    slots: tuple[Slot, ...] = ()

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "Part":
        rect = data.get("rect")
        pivot = data.get("pivot")
        parent = data.get("parentPartId")
        attach = data.get("attachSlot")
        bound = data.get("boundJointId")
        return cls(
            id=str(data["id"]),
            z_index=int(data.get("zIndex", 0)),
            deformer=deformer_from_mapping(data["deformer"]),
            bound_joint_id=None if bound is None else str(bound),
            rect=(
                KernelConstants.FULL_SHEET_RECT
                if rect is None
                else tuple(float(value) for value in rect)  # type: ignore[arg-type]
            ),
            pivot=(
                KernelConstants.DEFAULT_PIVOT
                if pivot is None
                else (float(pivot[0]), float(pivot[1]))
            ),
            parent_part_id=None if parent is None else str(parent),
            attach_slot=None if attach is None else str(attach),
            slots=tuple(Slot.from_mapping(item) for item in data.get("slots", [])),
        )


@dataclass(frozen=True, eq=False, slots=True)
class KernelRig:
    """The complete kernel input: a sheet, a joint tree, and layered parts."""

    asset: Asset
    joints: tuple[Joint, ...]
    parts: tuple[Part, ...]

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> "KernelRig":
        joints = tuple(Joint.from_mapping(item) for item in data["joints"])
        if not joints:
            raise KernelInputError("A rig needs at least one joint.")
        return cls(
            asset=Asset.from_mapping(data["asset"]),
            joints=joints,
            parts=tuple(Part.from_mapping(item) for item in data.get("parts", [])),
        )


# --- Outputs ---------------------------------------------------------------


@dataclass(frozen=True, eq=False, slots=True)
class SolvedSkeleton:
    """Result of the forward kinematics pass, in source pixels.

    Carries rest data alongside posed data so every downstream deformer can
    build its own transforms without re-deriving bones or re-reading the
    joint list, which is the kind of duplication that lets the two kernels
    drift.
    """

    #: Joint id to posed (x, y), float64 for downstream math.
    positions: dict[str, tuple[float, float]]
    #: Joint id to rest (x, y).
    rest_positions: dict[str, tuple[float, float]]
    #: Joint id to accumulated chain rotation in degrees: the sum of local
    #: ``rot`` deltas from the root down to and including this joint. This is
    #: the angle a cutout part bound to the joint should turn by.
    accumulated: dict[str, float]
    #: Bone index to posed world angle in degrees.
    posed_angles: np.ndarray
    #: Bone index to rest world angle in degrees.
    rest_angles: np.ndarray
    #: Bone index to rest length in source pixels.
    rest_lengths: np.ndarray
    bones: tuple[Bone, ...]
    #: Id of the single root joint. Carried so a part with no bound joint can
    #: fall back to it inside the kernel, which is the only way both kernels
    #: get the same answer -- when each caller's adapter resolved the fallback
    #: itself, the browser used the identity and the server used the root.
    root: str = ""


@dataclass(frozen=True, eq=False, slots=True)
class WarpBatch:
    """Per-triangle affine warps plus the frame's distortion report.

    Degenerate source triangles are dropped, so ``triangle_index`` records
    which input triangle each row came from; a renderer must not assume row i
    is triangle i.
    """

    #: (kept, 6) float32 as (a, b, c, d, e, f) in canvas order [a c; b d].
    matrices: np.ndarray
    #: (kept, 3, 2) float32 destination triangle corners after seam bleed.
    bled: np.ndarray
    #: (kept,) uint32 index of the source triangle.
    triangle_index: np.ndarray
    #: Worst finite sigma_max / sigma_min across the frame. 1.0 = undistorted.
    max_stretch: float
    #: Triangles whose affine map flipped orientation (determinant < 0).
    flipped_triangles: int
    #: Triangles skipped for having a degenerate source area.
    degenerate_triangles: int


@dataclass(frozen=True, eq=False, slots=True)
class PartGeometry:
    """A posed part, as a textured triangle mesh in source pixels.

    All four deformers emit this same shape. That is the point: the
    rasterizer, on either side of the wire, has exactly one code path
    regardless of whether a part is rigid, skinned, lattice-warped or splined.
    """

    part_id: str
    z_index: int
    kind: DeformerKind
    #: (vert_count, 2) float32 rest positions, source pixels. These are the
    #: texture coordinates: where each vertex reads from in the sheet.
    src_verts: np.ndarray
    #: (vert_count, 2) float32 posed positions, source pixels. The part tree's
    #: world transform is ALREADY folded in; a renderer draws these directly.
    dst_verts: np.ndarray
    #: (tri_count, 3) uint32.
    tris: np.ndarray
    warp: WarpBatch
    #: The part tree's world transform that was applied, reported so a caller
    #: (and the parity corpus) can attribute a displacement to the tree rather
    #: than to the deformer. Exactly ``(1, 0, 0, 0)`` when the part and every
    #: ancestor are at rest.
    transform: PartTransform = (1.0, 0.0, 0.0, 0.0)


@dataclass(frozen=True, eq=False, slots=True)
class KernelFrame:
    """Everything one posed frame needs, minus pixels."""

    skeleton: SolvedSkeleton
    parts: tuple[PartGeometry, ...]
