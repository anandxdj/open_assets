"""The four deformer builders, and the selection that picks between them.

Selection is data, not architecture (F9 §10): the archetype prior is a role to
default-deformer table, so adding a seventh archetype adds a table entry and no
code path here. What this module owns is the *precedence* between the prior, a
model hint and a user override, and the downgrade ladder when a builder cannot
produce what was asked for.

Downgrades always land on ``rigid``, never on another soft deformer. A rigid
part looks stiff and the user can see why; a half-built mesh part looks like
corrupted artwork and the user cannot (F9 §9).

Every payload this module emits is **part-local normalized** — 0..1 over
``Part.rect``, not over the sheet (R6). That is what makes a part portable: a
re-crop of the sheet moves ``Part.rect`` and leaves every vertex, control point
and cut line untouched.
"""

from __future__ import annotations

from typing import List, Mapping, Optional, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.archetype_priors import ArchetypePriors
from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.rig.contour import (
    distance_transform,
    initial_spacing,
    rings_to_domain,
    sample_interior,
    simplify,
    spine_polyline,
    trace_contours,
)
from app.modules.anibuddy.rig.skin import Skinner
from app.modules.anibuddy.rig.triangulate import Pslg, Triangulator
from app.modules.anibuddy.rig.types import (
    BoneSegment,
    CutPolyline,
    MeshBuild,
    PartRaster,
    PendingBuffer,
    SkinResult,
)
from app.modules.anibuddy.schemas import (
    CutLine,
    Deformer,
    DeformerKind,
    DeformerLattice,
    DeformerMesh,
    DeformerRigid,
    DeformerSpline,
    Part,
)


class BuiltDeformer:
    """A finished deformer plus everything the caller has to record about it."""

    __slots__ = ("deformer", "buffers", "warnings", "isolated_vertices", "mesh", "skin")

    def __init__(
        self,
        deformer: Deformer,
        *,
        buffers: Optional[Sequence[PendingBuffer]] = None,
        warnings: Optional[Sequence[str]] = None,
        isolated_vertices: int = 0,
        mesh: Optional[MeshBuild] = None,
        skin: Optional[SkinResult] = None,
    ) -> None:
        self.deformer = deformer
        self.buffers: List[PendingBuffer] = list(buffers or ())
        self.warnings: List[str] = list(warnings or ())
        self.isolated_vertices = isolated_vertices
        self.mesh = mesh
        self.skin = skin


class DeformerSelector:
    """Which of the four a part gets, and who gets to say so."""

    __slots__ = ()

    @staticmethod
    def choose(
        part: Part,
        archetype: str,
        *,
        hint: Optional[str] = None,
        override: Optional[str] = None,
    ) -> DeformerKind:
        """Resolve the deformer kind. Precedence: override, hint, prior.

        The user's override wins outright — they are looking at the artwork.
        A model hint is advisory and is accepted only where the archetype would
        tolerate the result: F9 §10.6 says a ``ui`` ``glyph`` may be promoted to
        ``mesh`` "on explicit user request, and nothing else here should", so a
        vision model that suggests bending a logo is overruled rather than
        obeyed. That asymmetry is the point of having two channels.
        """
        if override in ("rigid", "mesh", "lattice", "spline"):
            return override  # type: ignore[return-value]

        prior = ArchetypePriors.default_deformer(archetype, part.role)
        if hint in ("rigid", "mesh", "lattice", "spline") and hint != prior:
            if DeformerSelector._hint_allowed(archetype, part.role, hint):
                return hint  # type: ignore[return-value]
        return prior  # type: ignore[return-value]

    @staticmethod
    def _hint_allowed(archetype: str, role: str, hint: str) -> bool:
        """Whether a model hint may move a part off its prior's default.

        Two rules, and they overlap today on purpose. The archetype rule is
        §10.6 as written: nothing in ``ui`` leaves ``rigid`` on a hint. The role
        rule is the same sentence scoped to the role instead, so that a
        ``glyph`` appearing in some future archetype's vocabulary does not
        quietly become promotable by a vision model. Dropping either one makes
        the other silently load-bearing.
        """
        if archetype == "ui" and hint != "rigid":
            return False
        return not (
            role in RigConstants.USER_ONLY_MESH_PROMOTION_ROLES and hint == "mesh"
        )


def _cut_polylines(part: Part, raster: PartRaster) -> List[CutPolyline]:
    """Read the part's existing cut lines back into part-local pixels.

    Cuts are the one piece of mesh geometry a *user* authors, so a re-rig has to
    carry them forward — dropping them would silently undo the fix a user made
    to stop an arm dragging a torso. They arrive part-local normalized and every
    predicate downstream works in part-local pixels, so the conversion happens
    once, here.
    """
    if not isinstance(part.deformer, DeformerMesh):
        return []
    out: List[CutPolyline] = []
    for cut in part.deformer.cuts[: RigConstants.MAX_CUTS_PER_PART]:
        flat = Buffers.read_f32(cut.points)
        if flat.size < 4:
            continue
        pairs = flat.reshape(-1, 2).copy()
        pairs[:, 0] *= raster.width
        pairs[:, 1] *= raster.height
        out.append(CutPolyline(id=cut.id, points=pairs))
    return out


def _cut_lines_wire(
    cuts: Sequence[CutPolyline],
    raster: PartRaster,
    project_id: str,
) -> Tuple[List[CutLine], List[PendingBuffer]]:
    lines: List[CutLine] = []
    buffers: List[PendingBuffer] = []
    for cut in cuts:
        normalized = cut.points.copy()
        normalized[:, 0] /= max(1, raster.width)
        normalized[:, 1] /= max(1, raster.height)
        buffer, pending = Buffers.f32(normalized.ravel(), project_id=project_id)
        lines.append(CutLine(id=cut.id, points=buffer))
        buffers.extend(pending)
    return lines, buffers


def _build_pslg(
    rings: Sequence[Sequence[Tuple[int, int]]],
    cuts: Sequence[CutPolyline],
    domain: np.ndarray,
    dist: np.ndarray,
    raster: PartRaster,
    spacing: float,
) -> Pslg:
    """Assemble the constrained input: rings, cuts, then interior samples.

    Order matters for reproducibility only — the ring vertices get the low
    indices, which keeps a re-run's vertex list stable when refinement inserts
    the same circumcentres.
    """
    pslg = Pslg()
    max_edge = max(
        RigConstants.MIN_SEGMENT_LENGTH_PX,
        spacing * RigConstants.BOUNDARY_SEGMENT_RATIO,
    )
    for ring in rings:
        closed = [*ring, ring[0]]
        indices: List[int] = []
        for position in range(len(closed) - 1):
            ax, ay = float(closed[position][0]), float(closed[position][1])
            bx, by = float(closed[position + 1][0]), float(closed[position + 1][1])
            indices.append(pslg.add_point(ax, ay))
            # Subdivide the boundary to the interior's own resolution; see
            # BOUNDARY_SEGMENT_RATIO for why this is not cosmetic.
            steps = int(np.ceil(np.hypot(bx - ax, by - ay) / max_edge))
            for step in range(1, steps):
                fraction = step / steps
                indices.append(
                    pslg.add_point(ax + (bx - ax) * fraction, ay + (by - ay) * fraction)
                )
        for position in range(len(indices)):
            pslg.add_segment(indices[position], indices[(position + 1) % len(indices)])
    for cut in cuts:
        clamped = np.empty_like(cut.points)
        clamped[:, 0] = np.clip(cut.points[:, 0], 0.0, raster.width)
        clamped[:, 1] = np.clip(cut.points[:, 1], 0.0, raster.height)
        indices = [pslg.add_point(float(x), float(y)) for x, y in clamped]
        for position in range(1, len(indices)):
            pslg.add_segment(indices[position - 1], indices[position])

    candidates = sample_interior(domain, dist, raster.width, raster.height, spacing)
    for x, y in Triangulator.filter_by_clearance(pslg, candidates, spacing):
        pslg.add_point(x, y)
    return pslg


def build_mesh_geometry(
    raster: PartRaster,
    cuts: Sequence[CutPolyline],
) -> Optional[MeshBuild]:
    """Contour, simplify, sample, triangulate — the v3 path, per part.

    The retry ladder raises the sampling pitch and rebuilds the whole PSLG
    rather than trimming the vertex array. F9 §8.3 is explicit about that, and
    the reason is mechanical: triangle indices are into the vertex array, so
    truncating it leaves triangles pointing at vertices that no longer exist and
    the mesh renders as a burst of stray polygons.
    """
    traced = trace_contours(raster.mask)
    if not traced:
        return None

    dist = distance_transform(raster.mask)
    spacing = initial_spacing(raster.solid_pixels)
    # The schema's MIN_TRIANGLE_AREA is part-local normalized; the triangulator
    # measures in part-local pixels, so the floor is scaled once here rather
    # than at every comparison.
    area_floor_px = RigConstants.MIN_TRIANGLE_AREA * raster.width * raster.height

    for attempt in range(RigConstants.SPACING_PASSES):
        # Simplified inside the loop, not outside: the tolerance tracks the
        # sampling pitch, so a coarser retry has to re-simplify the boundary to
        # match or the mesh ends up fine on its edge and coarse in its middle.
        epsilon = max(
            max(raster.width, raster.height) * RigConstants.RDP_EPSILON_RATIO,
            spacing * RigConstants.RDP_PITCH_RATIO,
        )
        rings = [
            ring
            for ring in (simplify(candidate, epsilon) for candidate in traced)
            if len(ring) >= 3
        ]
        if not rings:
            return None
        domain = rings_to_domain(rings, raster.width, raster.height)
        pslg = _build_pslg(rings, cuts, domain, dist, raster, spacing)
        if (
            len(pslg.points) > RigConstants.MAX_VERTS_PER_PART
            and attempt < RigConstants.SPACING_PASSES - 1
        ):
            spacing *= RigConstants.SPACING_GROWTH
            continue

        verts, tris, min_angle, passes, conforming = Triangulator.run(
            pslg,
            domain,
            max_verts=RigConstants.MAX_VERTS_PER_PART,
            area_floor_px=area_floor_px,
        )
        if verts is None or tris is None:
            return None
        over_budget = (
            verts.shape[0] > RigConstants.MAX_VERTS_PER_PART
            or tris.shape[0] > RigConstants.MAX_TRIS_PER_PART
        )
        if over_budget and attempt < RigConstants.SPACING_PASSES - 1:
            spacing *= RigConstants.SPACING_GROWTH
            continue
        if over_budget:
            return None
        return MeshBuild(
            verts=verts,
            tris=tris,
            min_angle_deg=min_angle,
            sliver_count=Triangulator.sliver_count(verts, tris),
            refine_passes=passes,
            conforming=conforming,
            spacing_px=spacing,
        )
    return None


class DeformerBuilders:
    """One builder per deformer kind. Each returns None when it cannot build."""

    __slots__ = ()

    @staticmethod
    def rigid() -> BuiltDeformer:
        """Stores nothing but its tag; the part rides its bound joint."""
        return BuiltDeformer(DeformerRigid(kind="rigid"))

    @staticmethod
    def mesh(
        part: Part,
        raster: PartRaster,
        bones: Sequence[BoneSegment],
        project_id: str,
    ) -> Optional[BuiltDeformer]:
        cuts = _cut_polylines(part, raster)
        build = build_mesh_geometry(raster, cuts)
        if build is None or build.tri_count == 0:
            return None

        origin = (float(raster.origin_x), float(raster.origin_y))
        columns = Skinner.select_bones(
            part.id,
            bones,
            build.verts,
            origin,
            RigConstants.MAX_BONES_PER_PART,
        )
        skin = Skinner.solve(build.verts, build.tris, columns, origin, cuts)

        normalized = build.verts.copy()
        normalized[:, 0] /= max(1, raster.width)
        normalized[:, 1] /= max(1, raster.height)

        verts_buffer, verts_pending = Buffers.f32(normalized.ravel(), project_id=project_id)
        tris_buffer, tris_pending = Buffers.u32(build.tris.ravel(), project_id=project_id)
        weights_buffer, weights_pending = Buffers.f32(
            skin.weights.ravel(), project_id=project_id
        )
        cut_lines, cut_pending = _cut_lines_wire(cuts, raster, project_id)

        warnings: List[str] = []
        sliver_fraction = build.sliver_count / max(1, build.tri_count)
        if sliver_fraction > RigConstants.SLIVER_WARN_FRACTION:
            warnings.append(
                f'Part "{part.id}" kept {build.sliver_count} of {build.tri_count} '
                f"triangles under {RigConstants.MIN_TRIANGLE_ANGLE_DEG:.0f} degrees "
                f"(thinnest {build.min_angle_deg:.1f}); this part may show "
                "stretching artefacts."
            )
        if skin.method != RigConstants.SKINNING_METHOD:
            warnings.append(
                f'Part "{part.id}" fell back to {skin.method} weights: no '
                "harmonic solution was available for this mesh."
            )
        if cuts and not build.conforming:
            # The cut still stops influence — that test is geometric — but the
            # triangulation did not split along it, so triangles straddle the
            # seam and the two sides share vertices. Worth saying, because the
            # user drew a line expecting a seam.
            warnings.append(
                f'Part "{part.id}" has cut lines the triangulation could not '
                "follow exactly; skinning still respects them."
            )

        return BuiltDeformer(
            DeformerMesh(
                kind="mesh",
                verts=verts_buffer,
                tris=tris_buffer,
                boneIds=skin.bone_ids,
                weights=weights_buffer,
                cuts=cut_lines,
            ),
            buffers=Buffers.collect(
                verts_pending, tris_pending, weights_pending, cut_pending
            ),
            warnings=warnings,
            isolated_vertices=skin.isolated_vertices,
            mesh=build,
            skin=skin,
        )

    @staticmethod
    def lattice(raster: PartRaster, project_id: str) -> BuiltDeformer:
        """A regular quad grid over the part rect, at rest.

        Divisions come from the part's own pixel size rather than from a fixed
        grid, so a hair tuft and a full-width water layer get comparable cell
        density — a fixed 4x4 over a 2000px cloth layer gives the animator one
        handle per 500 pixels, which cannot express a ripple.

        The rest grid is exactly uniform, which the kernel relies on: it derives
        the source (texture) positions from the same uniform grid, so any
        non-uniformity here would read as a texture shear at rest.
        """
        cols = int(
            min(
                RigConstants.MAX_LATTICE_COLS,
                max(
                    RigConstants.LATTICE_MIN_DIVISIONS,
                    round(raster.width / RigConstants.LATTICE_TARGET_CELL_PX),
                ),
            )
        )
        rows = int(
            min(
                RigConstants.MAX_LATTICE_ROWS,
                max(
                    RigConstants.LATTICE_MIN_DIVISIONS,
                    round(raster.height / RigConstants.LATTICE_TARGET_CELL_PX),
                ),
            )
        )
        xs = np.linspace(0.0, 1.0, cols + 1)
        ys = np.linspace(0.0, 1.0, rows + 1)
        grid = np.empty(((rows + 1) * (cols + 1), 2), dtype=np.float64)
        # Row-major: the schema's stated order, and the order the kernel reshapes
        # to (rows + 1, cols + 1, 2).
        grid[:, 0] = np.tile(xs, rows + 1)
        grid[:, 1] = np.repeat(ys, cols + 1)

        buffer, pending = Buffers.f32(grid.ravel(), project_id=project_id)
        return BuiltDeformer(
            DeformerLattice(
                kind="lattice",
                cols=cols,
                rows=rows,
                controlPoints=buffer,
                interpolation=RigConstants.LATTICE_DEFAULT_INTERPOLATION,  # type: ignore[arg-type]
            ),
            buffers=pending,
        )

    @staticmethod
    def spline(raster: PartRaster, project_id: str) -> Optional[BuiltDeformer]:
        """A taper track along the spine, and nothing else.

        Refused — and so downgraded to rigid by the caller — when the part is
        not actually elongated. A spline over a blob invents a spine the artwork
        does not have, and the animator gets a tail-like bend applied to
        something round, which is worse than the same shape held stiff.

        THE SPINE ITSELF IS NOT STORED. It is the part's joint chain, which
        ``SkeletonPlanner._append_spline_chains`` authors from this same medial
        polyline, and which is the only form of it that forward kinematics can
        pose. This builder used to also emit a cubic bezier chain of the same
        spine; nothing ever read it — the kernel cannot pose a static polyline —
        so it was a second description free to drift from the one that drove the
        render.

        Half-widths are normalized against the GEOMETRIC MEAN of the part's
        pixel dimensions. A single scalar cannot be exact in an anisotropic
        part-local space, so the axis has to be declared rather than inferred
        (R6), and the geometric mean is the only choice that does not silently
        assume the ribbon runs horizontally or vertically. ``render/adapter.py``
        reads it back with the same convention; the two must not drift.
        """
        points, widths, aspect = spine_polyline(raster.mask, RigConstants.SPLINE_PROBES)
        if points.shape[0] < 2 or aspect < RigConstants.SPLINE_MIN_ASPECT:
            return None

        # The track is sampled along the spine rather than per joint, so its
        # length is a resolution choice rather than a structural one. Keeping it
        # at the old anchor count means a tail tapers at the same fidelity it
        # always did, and a chain the joint budget cuts short still tapers over
        # its whole length.
        anchor_widths = _resample_scalars(widths, RigConstants.SPLINE_SEGMENTS + 1)
        local_scale = float(np.sqrt(max(1, raster.width) * max(1, raster.height)))
        half_widths = np.maximum(
            anchor_widths / local_scale, RigConstants.SPLINE_MIN_HALF_WIDTH
        )

        thickness_buffer, thickness_pending = Buffers.f32(
            half_widths, project_id=project_id
        )
        return BuiltDeformer(
            DeformerSpline(
                kind="spline",
                thickness=thickness_buffer,
                samples=min(RigConstants.SPLINE_SAMPLES, RigConstants.MAX_SPLINE_SAMPLES),
            ),
            buffers=thickness_pending,
        )


def _resample_scalars(values: np.ndarray, count: int) -> np.ndarray:
    """Resample a scalar track to ``count`` samples, uniformly in index."""
    if values.size == 0:
        return np.zeros(count, dtype=np.float64)
    if values.size == 1:
        return np.repeat(values, count)
    source = np.linspace(0.0, 1.0, values.size)
    target = np.linspace(0.0, 1.0, count)
    return np.interp(target, source, values)


def spline_candidates(
    parts: Sequence[Part],
    archetype: str,
    hints: Mapping[str, str],
    overrides: Mapping[str, str],
) -> List[str]:
    """Part ids the selector will ask for a spline.

    Needed *before* the skeleton is built, because a spline part's joint chain
    is part of the skeleton and a chain cannot be appended to a graph the mesh
    weights were already solved against.
    """
    return [
        part.id
        for part in parts
        if DeformerSelector.choose(
            part,
            archetype,
            hint=hints.get(part.id),
            override=overrides.get(part.id),
        )
        == "spline"
    ]
