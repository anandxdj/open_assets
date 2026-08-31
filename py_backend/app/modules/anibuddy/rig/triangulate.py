"""Quality-constrained triangulation of a part's silhouette.

Why this is not ``triangle``
---------------------------
F9 §4 replaces v3's ``cdt2d`` with "``triangle`` with quality constraints",
because ``cdt2d`` produces a *valid* triangulation rather than a *well-shaped*
one and slivers are exactly what the renderer's sigma_max/sigma_min metric
flags at export time. The quality requirement is kept here; the dependency is
not, for one reason that is not about engineering taste:

    Shewchuk's Triangle — the C library every ``triangle`` PyPI wheel wraps —
    is not licensed for commercial redistribution. Its own notice reads
    "Distribution of this code as part of a commercial system is permissible
    ONLY BY DIRECT ARRANGEMENT WITH THE AUTHOR." Vendoring it into a
    paid product is a licensing decision, not a build step.

So the quality constraint is implemented directly, on Qhull (BSD, already a
scipy dependency), as Ruppert's Delaunay refinement:

1. **Conforming pass.** Split any constraint sub-segment that another vertex
   encroaches — that is, whose diametral circle contains a vertex — at its
   midpoint. Ruppert's lemma is what makes this sufficient: a sub-segment no
   vertex encroaches necessarily appears as an edge of the Delaunay
   triangulation, so this pass alone recovers the constrained edges without a
   separate edge-flipping step.
2. **Refinement pass.** Insert the circumcentre of any interior triangle whose
   smallest angle is below ``MIN_TRIANGLE_ANGLE_DEG``, splitting encroached
   segments first. The angle bound is set at 25 degrees, inside the ~20.7
   degree region where Ruppert's algorithm provably terminates, so convergence
   is a property of the geometry rather than only of the pass cap.

What is worse than ``triangle``: no area grading, no Delaunay refinement
variants (no off-centre insertion), and a pass cap that can return a mesh with
a few remaining slivers on a pathological silhouette. That case is not silent —
the achieved minimum angle rides out on ``MeshBuild.min_angle_deg`` and becomes
a diagnostics warning.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Set, Tuple

import numpy as np
from scipy.spatial import Delaunay, QhullError

from app.modules.anibuddy.constants import RigConstants

Segment = Tuple[int, int]


class Pslg:
    """A planar straight-line graph under construction.

    Points are only ever appended, never removed or reordered, because every
    segment is an index pair into this list and a reorder would silently
    re-route the constraints.
    """

    __slots__ = ("points", "segments", "_index")

    def __init__(self) -> None:
        self.points: List[Tuple[float, float]] = []
        self.segments: List[Segment] = []
        self._index: Dict[Tuple[int, int], int] = {}

    def add_point(self, x: float, y: float) -> int:
        """Insert or reuse a point, merged on a sub-pixel grid.

        The merge grid is the v3 one (``round(v * 1e5)``). Without it, a ring
        vertex and a cut endpoint that coincide become two points a hair apart,
        and Qhull answers with a sliver rather than with an error.
        """
        key = (
            int(round(x * RigConstants.DEDUP_SCALE)),
            int(round(y * RigConstants.DEDUP_SCALE)),
        )
        existing = self._index.get(key)
        if existing is not None:
            return existing
        index = len(self.points)
        self.points.append((float(x), float(y)))
        self._index[key] = index
        return index

    def add_segment(self, a: int, b: int) -> None:
        if a != b:
            self.segments.append((a, b))

    def as_array(self) -> np.ndarray:
        return np.asarray(self.points, dtype=np.float64)


def _triangulate_points(points: np.ndarray) -> Optional[np.ndarray]:
    """Delaunay simplices, or None when the point set has no 2D hull.

    A degenerate input (fewer than three points, or all of them collinear) is
    not an error worth raising: the caller's answer is "this part cannot carry
    a mesh", and it handles that by downgrading the part to rigid.
    """
    if points.shape[0] < 3:
        return None
    try:
        return np.asarray(Delaunay(points).simplices, dtype=np.int64)
    except (QhullError, ValueError):
        return None


def _edge_set(simplices: np.ndarray) -> Set[Segment]:
    edges: Set[Segment] = set()
    for a, b, c in simplices.tolist():
        edges.add((min(a, b), max(a, b)))
        edges.add((min(b, c), max(b, c)))
        edges.add((min(a, c), max(a, c)))
    return edges


def _encroached_segments(points: np.ndarray, segments: Sequence[Segment]) -> List[int]:
    """Indices of segments whose diametral circle contains another vertex.

    Vectorized over vertices per segment rather than the other way round: the
    segment count is small and the vertex count is not, so this is one
    ``(vertex_count,)`` comparison per segment instead of a Python loop over
    the cross product.
    """
    if not segments:
        return []
    out: List[int] = []
    for index, (a, b) in enumerate(segments):
        start = points[a]
        end = points[b]
        centre = (start + end) * 0.5
        radius_sq = float(np.dot(end - start, end - start)) * 0.25
        if radius_sq <= RigConstants.EPSILON:
            continue
        delta = points - centre
        inside = np.einsum("ij,ij->i", delta, delta) < radius_sq - RigConstants.EPSILON
        inside[a] = False
        inside[b] = False
        if bool(np.any(inside)):
            out.append(index)
    return out


def _split_segments(pslg: Pslg, indices: Sequence[int]) -> int:
    """Split the named segments at their midpoints. Returns how many split.

    A sub-segment already at ``MIN_SEGMENT_LENGTH_PX`` is left alone. That
    guard is the practical answer to Ruppert's known non-termination on inputs
    where two constraints meet at a small angle: the two segments encroach each
    other forever, each split feeding the next. Stopping at one pixel bounds
    the recursion at the resolution below which the artwork has no detail
    anyway.
    """
    split = 0
    for index in sorted(indices, reverse=True):
        a, b = pslg.segments[index]
        ax, ay = pslg.points[a]
        bx, by = pslg.points[b]
        if math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) <= RigConstants.MIN_SEGMENT_LENGTH_PX:
            continue
        middle = pslg.add_point((ax + bx) * 0.5, (ay + by) * 0.5)
        if middle in (a, b):
            continue
        pslg.segments[index] = (a, middle)
        pslg.segments.append((middle, b))
        split += 1
    return split


def _inside_domain(domain: np.ndarray, x: float, y: float) -> bool:
    """Even-odd lookup, bounds-checked BEFORE rounding.

    The order matters. Rounding first admits everything in [-0.5, 0), which is
    how a circumcentre a third of a pixel outside the silhouette gets accepted
    as interior — and then every boundary segment fans a sliver triangle to it.
    That exact bug cost a mesh a hundred degenerate triangles before this
    function checked the unrounded coordinate.
    """
    if not (0.0 <= x <= domain.shape[1] - 1 and 0.0 <= y <= domain.shape[0] - 1):
        return False
    return bool(domain[int(round(y)), int(round(x))])


def _inside_domain_batch(domain: np.ndarray, points: np.ndarray) -> np.ndarray:
    """Vectorized even-odd lookup; False for NaN and out-of-raster points."""
    if points.size == 0:
        return np.zeros(0, dtype=bool)
    with np.errstate(invalid="ignore"):
        inside = (
            np.isfinite(points).all(axis=1)
            & (points[:, 0] >= 0.0)
            & (points[:, 1] >= 0.0)
            & (points[:, 0] <= domain.shape[1] - 1)
            & (points[:, 1] <= domain.shape[0] - 1)
        )
    result = np.zeros(points.shape[0], dtype=bool)
    if bool(np.any(inside)):
        px = np.rint(points[inside, 0]).astype(np.int64)
        py = np.rint(points[inside, 1]).astype(np.int64)
        result[inside] = domain[py, px] > 0
    return result


def segment_clearance(
    points: np.ndarray,
    segments: Sequence[Segment],
    candidates: np.ndarray,
) -> np.ndarray:
    """Distance from each candidate point to the nearest constraint segment.

    Interior samples that land almost on the silhouette are the dominant source
    of slivers: a point a hair off a long boundary edge makes a triangle whose
    smallest angle is ``atan(hair / edge)``, and no amount of circumcentre
    insertion fixes that — Ruppert's answer is to split the segment, which at
    pixel scale bottoms out against ``MIN_SEGMENT_LENGTH_PX``. Not creating the
    sliver is cheaper than refining it away.
    """
    if candidates.size == 0:
        return np.zeros(0, dtype=np.float64)
    best = np.full(candidates.shape[0], np.inf, dtype=np.float64)
    for a, b in segments:
        start = points[a]
        end = points[b]
        edge = end - start
        length_sq = float(np.dot(edge, edge))
        delta = candidates - start
        if length_sq <= RigConstants.EPSILON:
            distance = np.linalg.norm(delta, axis=1)
        else:
            t = np.clip((delta @ edge) / length_sq, 0.0, 1.0)
            distance = np.linalg.norm(delta - t[:, None] * edge, axis=1)
        np.minimum(best, distance, out=best)
    return best


def min_angles_deg(points: np.ndarray, simplices: np.ndarray) -> np.ndarray:
    """Smallest interior angle of every triangle, in degrees.

    From the three side lengths via the law of cosines rather than from cross
    products: the smallest angle sits opposite the shortest side, and that
    formulation degrades gracefully as a triangle flattens — the cosine walks to
    +1 instead of a near-zero cross product being divided by a near-zero norm.

    Vectorized over triangles because the refinement loop asks this question
    about every triangle on every pass, and a Python loop over a thousand
    triangles times eight passes is most of the stage's wall clock.
    """
    if simplices.size == 0:
        return np.zeros(0, dtype=np.float64)
    corners = points[simplices]
    sides = np.stack(
        [
            np.linalg.norm(corners[:, 1] - corners[:, 0], axis=1),
            np.linalg.norm(corners[:, 2] - corners[:, 1], axis=1),
            np.linalg.norm(corners[:, 0] - corners[:, 2], axis=1),
        ],
        axis=1,
    )
    sides.sort(axis=1)
    shortest = sides[:, 0]
    middle = sides[:, 1]
    longest = sides[:, 2]
    denominator = 2.0 * middle * longest
    with np.errstate(divide="ignore", invalid="ignore"):
        cosine = (middle**2 + longest**2 - shortest**2) / denominator
    cosine = np.where(denominator > RigConstants.EPSILON, cosine, 1.0)
    return np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))


def _circumcentres(points: np.ndarray, simplices: np.ndarray) -> np.ndarray:
    """Circumcentre per triangle; NaN where the triangle is degenerate."""
    corners = points[simplices]
    ax, ay = corners[:, 0, 0], corners[:, 0, 1]
    bx, by = corners[:, 1, 0], corners[:, 1, 1]
    cx, cy = corners[:, 2, 0], corners[:, 2, 1]
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    a_sq = ax * ax + ay * ay
    b_sq = bx * bx + by * by
    c_sq = cx * cx + cy * cy
    with np.errstate(divide="ignore", invalid="ignore"):
        ux = (a_sq * (by - cy) + b_sq * (cy - ay) + c_sq * (ay - by)) / d
        uy = (a_sq * (cx - bx) + b_sq * (ax - cx) + c_sq * (bx - ax)) / d
    out = np.stack([ux, uy], axis=1)
    out[np.abs(d) <= RigConstants.EPSILON] = np.nan
    return out


def _interior_simplices(
    points: np.ndarray,
    simplices: np.ndarray,
    domain: np.ndarray,
) -> np.ndarray:
    """Keep only triangles whose centroid is inside the silhouette.

    The Delaunay triangulation covers the convex hull, so this is what removes
    the material Qhull invents across a concavity — the space between two legs,
    or the inside of a ``C``. The predicate is the same even-odd raster the
    interior sampler used, so a sample point and the triangle that contains it
    cannot disagree about being inside.
    """
    if simplices.size == 0:
        return simplices
    centroids = points[simplices].mean(axis=1)
    return simplices[_inside_domain_batch(domain, centroids)]


def _orient(points: np.ndarray, simplices: np.ndarray) -> np.ndarray:
    """Give every triangle the same winding.

    Qhull does not promise a consistent orientation, and the renderer counts
    triangles whose affine warp flipped orientation as a defect. If the rest
    mesh already mixes windings then half of them are reported flipped in every
    frame, and a real fold becomes invisible in the noise.
    """
    if simplices.size == 0:
        return simplices
    corners = points[simplices]
    cross = (
        (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1])
        - (corners[:, 1, 1] - corners[:, 0, 1]) * (corners[:, 2, 0] - corners[:, 0, 0])
    )
    flipped = cross < 0.0
    out = simplices.copy()
    out[flipped, 1], out[flipped, 2] = simplices[flipped, 2], simplices[flipped, 1]
    return out


def _drop_small(
    points: np.ndarray,
    simplices: np.ndarray,
    area_floor_px: float,
) -> np.ndarray:
    if simplices.size == 0:
        return simplices
    corners = points[simplices]
    area = 0.5 * np.abs(
        (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1])
        - (corners[:, 1, 1] - corners[:, 0, 1]) * (corners[:, 2, 0] - corners[:, 0, 0])
    )
    return simplices[area >= area_floor_px]


def _compact(points: np.ndarray, simplices: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Drop unreferenced points and reindex, preserving point order.

    Order preservation is not cosmetic: it keeps the vertex list stable across
    a re-run whose refinement inserted the same circumcentres, which is what
    lets the render cache key on a buffer hash.
    """
    if simplices.size == 0:
        return np.zeros((0, 2), dtype=np.float64), np.zeros((0, 3), dtype=np.int64)
    used = np.unique(simplices)
    remap = np.full(points.shape[0], -1, dtype=np.int64)
    remap[used] = np.arange(used.shape[0], dtype=np.int64)
    return points[used], remap[simplices]


class Triangulator:
    """Ruppert-refined conforming Delaunay over a part's PSLG."""

    __slots__ = ()

    @staticmethod
    def run(
        pslg: Pslg,
        domain: np.ndarray,
        *,
        max_verts: int,
        area_floor_px: float,
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], float, int, bool]:
        """Triangulate, returning ``(verts, tris, min_angle, passes, conforming)``.

        ``verts``/``tris`` are ``None`` when the part cannot carry a mesh at
        all, which the caller turns into a downgrade to ``rigid`` rather than
        into an error — a stiff part is recoverable, a broken mesh part looks
        like corruption (F9 §9).
        """
        points = pslg.as_array()
        simplices = _triangulate_points(points)
        if simplices is None:
            return None, None, 0.0, 0, True

        conforming = Triangulator._conform(pslg)
        passes = Triangulator._refine(pslg, domain, max_verts=max_verts)

        points = pslg.as_array()
        simplices = _triangulate_points(points)
        if simplices is None:
            return None, None, 0.0, passes, conforming

        interior = _interior_simplices(points, simplices, domain)
        interior = _drop_small(points, interior, area_floor_px)
        interior = _orient(points, interior)
        if interior.shape[0] == 0:
            return None, None, 0.0, passes, conforming

        # Conformity is judged on the final triangulation, not on whether the
        # encroachment loop converged: a segment can be recovered as an edge
        # even when the loop hit its cap.
        edges = _edge_set(simplices)
        conforming = all(
            (min(a, b), max(a, b)) in edges for a, b in pslg.segments
        )

        verts, tris = _compact(points, interior)
        return verts, tris, Triangulator.min_angle(verts, tris), passes, conforming

    @staticmethod
    def filter_by_clearance(
        pslg: Pslg,
        candidates: Sequence[Tuple[float, float]],
        spacing: float,
    ) -> List[Tuple[float, float]]:
        """Drop interior samples that sit too close to a constraint segment."""
        if not candidates or not pslg.segments:
            return list(candidates)
        array = np.asarray(candidates, dtype=np.float64)
        clearance = segment_clearance(pslg.as_array(), pslg.segments, array)
        limit = spacing * RigConstants.SAMPLE_BOUNDARY_CLEARANCE
        keep = clearance >= limit
        return [tuple(point) for point in array[keep]]

    @staticmethod
    def _conform(pslg: Pslg) -> bool:
        """Split encroached sub-segments until none is encroached."""
        for _ in range(RigConstants.ENCROACH_MAX_PASSES):
            points = pslg.as_array()
            encroached = _encroached_segments(points, pslg.segments)
            if not encroached:
                return True
            if _split_segments(pslg, encroached) == 0:
                return False
        return False

    @staticmethod
    def _refine(pslg: Pslg, domain: np.ndarray, *, max_verts: int) -> int:
        """Insert circumcentres of poorly-shaped interior triangles."""
        for completed in range(RigConstants.REFINE_MAX_PASSES):
            points = pslg.as_array()
            simplices = _triangulate_points(points)
            if simplices is None:
                return completed
            interior = _interior_simplices(points, simplices, domain)
            if interior.shape[0] == 0:
                return completed

            angles = min_angles_deg(points, interior)
            bad = angles < RigConstants.MIN_TRIANGLE_ANGLE_DEG
            if not bool(np.any(bad)):
                return completed
            centres = _circumcentres(points, interior[bad])
            usable = _inside_domain_batch(domain, centres)
            if not bool(np.any(usable)):
                return completed
            # Worst triangles first: one insertion often fixes several
            # neighbours, so spending the per-pass budget on the worst offenders
            # converges in fewer passes than scan order would.
            order = np.argsort(angles[bad][usable], kind="stable")
            queue = centres[usable][order]

            inserted = 0
            for centre in queue[: RigConstants.REFINE_INSERTS_PER_PASS]:
                if len(pslg.points) >= max_verts:
                    return completed + 1
                if not _inside_domain(domain, float(centre[0]), float(centre[1])):
                    continue
                before = len(pslg.points)
                index = pslg.add_point(float(centre[0]), float(centre[1]))
                if index < before:
                    # Merged onto an existing vertex: inserting it again would
                    # loop forever on the same bad triangle.
                    continue
                inserted += 1
            if inserted == 0:
                return completed + 1
            # A new vertex can encroach a segment, and Ruppert requires the
            # segment split to win — otherwise the vertex sits across a
            # constraint and the triangulation stops conforming. Checked once per
            # batch rather than once per insertion: the per-insertion form is
            # O(inserts x segments) numpy calls and dominated the stage's wall
            # clock, while the interior clearance rule makes an encroaching
            # circumcentre rare enough that a batch check finds the same splits.
            encroached = _encroached_segments(pslg.as_array(), pslg.segments)
            if encroached:
                _split_segments(pslg, encroached)
        return RigConstants.REFINE_MAX_PASSES

    @staticmethod
    def min_angle(verts: np.ndarray, tris: np.ndarray) -> float:
        """Smallest angle over every triangle, in degrees. 0 for an empty mesh."""
        if tris.size == 0:
            return 0.0
        return float(min_angles_deg(verts, tris).min())

    @staticmethod
    def sliver_count(verts: np.ndarray, tris: np.ndarray) -> int:
        """Triangles under the target angle that are thick enough to matter.

        The altitude filter is the whole content of this function; see
        ``SLIVER_MIN_ALTITUDE_PX`` for why a sub-pixel-thin triangle under the
        angle target is expected output rather than a defect. Without it this
        counter reports the boundary's chord approximation as a problem on every
        curved part, and a warning that fires on every part is a warning nobody
        reads.
        """
        if tris.size == 0:
            return 0
        angles = min_angles_deg(verts, tris)
        corners = verts[tris]
        edges = np.stack(
            [
                np.linalg.norm(corners[:, 1] - corners[:, 0], axis=1),
                np.linalg.norm(corners[:, 2] - corners[:, 1], axis=1),
                np.linalg.norm(corners[:, 0] - corners[:, 2], axis=1),
            ],
            axis=1,
        )
        longest = edges.max(axis=1)
        area = 0.5 * np.abs(
            (corners[:, 1, 0] - corners[:, 0, 0]) * (corners[:, 2, 1] - corners[:, 0, 1])
            - (corners[:, 1, 1] - corners[:, 0, 1]) * (corners[:, 2, 0] - corners[:, 0, 0])
        )
        with np.errstate(divide="ignore", invalid="ignore"):
            altitude = np.where(longest > RigConstants.EPSILON, 2.0 * area / longest, 0.0)
        return int(
            np.count_nonzero(
                (angles < RigConstants.MIN_TRIANGLE_ANGLE_DEG)
                & (altitude >= RigConstants.SLIVER_MIN_ALTITUDE_PX)
            )
        )
