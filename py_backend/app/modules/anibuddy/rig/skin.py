"""Skinning weights: harmonic over the triangulation, with v3's cut semantics.

What was asked for, what shipped, and why
-----------------------------------------
F9 §4 replaces v3's inverse-distance^4 weights with **bounded biharmonic
weights** (BBW). BBW minimizes the squared *bi*-Laplacian energy
``∫|Δw|²`` subject to ``0 ≤ w ≤ 1``, ``Σ_j w_j = 1`` and the handle
constraints. Those inequality constraints are the "bounded" in the name, and
they are also the problem: with them the solve is a bound-constrained quadratic
program, not a linear system. Doing it properly needs an active-set QP over a
sparse Hessian — libigl reaches for MOSEK for exactly this — and scipy carries
no sparse bound-constrained QP that scales to a per-part solve inside a request
handler.

**What this module implements instead: harmonic weights.** Per bone, solve

    Δw = 0   on the free vertices
    w = 1    on that bone's anchor vertices
    w = 0    on every other bone's anchor vertices

with the cotangent Laplacian over the part's own triangulation. Three
properties come out of that formulation rather than out of a repair pass, and
they are the properties the rig actually depends on:

* **Bounded in [0, 1] without clamping.** A cotangent Laplacian with
  non-negative edge weights is an M-matrix, so the discrete maximum principle
  holds and no interior value can exceed its boundary values. That is why
  ``COTAN_MIN`` clamps the cotangents at zero — it is not numerical
  paranoia, it is what keeps the bound theorem true on obtuse triangles.
* **Exact partition of unity.** ``Σ_j w_j`` solves the same Laplace problem
  with boundary value 1 everywhere, so it *is* 1 everywhere. No row
  normalization is needed to make the rows sum to one; the later
  normalizations exist only to repair the top-K prune.
* **Respects the interior.** Diffusion travels through the mesh, so influence
  cannot cross a gap in the artwork. This is the property F9 wanted from BBW
  and the reason v3 needed cut lines as a primary mechanism rather than as a
  user override.

**The deviation, stated plainly.** Harmonic weights minimize ``∫|∇w|²`` — first
order — where BBW minimizes ``∫|Δw|²`` — second order. Practically: harmonic
weights are C0 at a handle where BBW is C1, so a bone's own anchor region has a
slightly sharper falloff than BBW would give it, and a long limb shows a little
more concentration near the bone. The kept Laplacian smoothing pass (v3's, and
the reason it existed) softens exactly that. Upgrading to real BBW later is
this module and nothing else: the weight matrix's shape, its column order and
its consumers do not change.

**Cut-line occlusion is preserved as v3 wrote it** (``lib/mesh.ts`` 193-224),
in both places it now has to act:

1. In anchor assignment, a bone whose straight path to the vertex crosses a cut
   is infinitely far away, so it cannot claim the vertex.
2. In the diffusion itself, a mesh edge that crosses a cut carries no
   conductivity, so influence does not leak around the cut through the
   triangulation.

And v3's fallback is kept for the same reason it was written: a cut can
legitimately isolate a pocket from every bone, and pinning that pocket to the
geometrically nearest bone is the difference between a stiff pocket and a NaN
row that poisons every frame.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np
from scipy.sparse import coo_matrix, csc_matrix
from scipy.sparse.linalg import splu

from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.rig.types import BoneSegment, CutPolyline, SkinResult

#: The method name is owned by ``RigConstants`` because the stage record quotes
#: it, so a rename must not be able to make the record and the solver disagree.
_METHOD_HARMONIC: str = RigConstants.SKINNING_METHOD
_METHOD_INVERSE_DISTANCE: str = RigConstants.SKINNING_FALLBACK_METHOD


# --- Geometric predicates, ported verbatim in meaning from lib/mesh.ts ------


def _nearest_on_segment(
    points: np.ndarray,
    start: Sequence[float],
    end: Sequence[float],
) -> Tuple[np.ndarray, np.ndarray]:
    """Nearest point on a segment, and the distance to it, for every point.

    Distances use ``sqrt(dx*dx + dy*dy)`` rather than ``hypot`` for the reason
    given in ``kernel/numeric.py``: the two libms disagree more often than
    ``sqrt`` does, and this value feeds an anchor decision that must be stable.
    """
    ax, ay = float(start[0]), float(start[1])
    bx, by = float(end[0]), float(end[1])
    abx = bx - ax
    aby = by - ay
    length_sq = abx * abx + aby * aby
    count = points.shape[0]

    if length_sq < RigConstants.EPSILON:
        nearest = np.empty((count, 2), dtype=np.float64)
        nearest[:, 0] = ax
        nearest[:, 1] = ay
        dx = points[:, 0] - ax
        dy = points[:, 1] - ay
        return nearest, np.sqrt(dx * dx + dy * dy)

    t = ((points[:, 0] - ax) * abx + (points[:, 1] - ay) * aby) / length_sq
    np.clip(t, 0.0, 1.0, out=t)
    nearest = np.empty((count, 2), dtype=np.float64)
    nearest[:, 0] = ax + abx * t
    nearest[:, 1] = ay + aby * t
    dx = points[:, 0] - nearest[:, 0]
    dy = points[:, 1] - nearest[:, 1]
    return nearest, np.sqrt(dx * dx + dy * dy)


def _orientation(
    ax: np.ndarray | float,
    ay: np.ndarray | float,
    bx: np.ndarray | float,
    by: np.ndarray | float,
    cx: np.ndarray | float,
    cy: np.ndarray | float,
) -> np.ndarray:
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def _segments_cross(
    from_points: np.ndarray,
    to_points: np.ndarray,
    c: Sequence[float],
    d: Sequence[float],
) -> np.ndarray:
    """Strict proper crossing, vectorized over a batch of first segments.

    Strict on purpose, exactly as in v3: touching endpoints do not count. A cut
    line drawn to end exactly on a mesh vertex must not sever that vertex from
    everything, which is what a non-strict test would do.
    """
    epsilon = RigConstants.EPSILON
    ax = from_points[:, 0]
    ay = from_points[:, 1]
    bx = to_points[:, 0]
    by = to_points[:, 1]
    cx, cy = float(c[0]), float(c[1])
    dx, dy = float(d[0]), float(d[1])

    ab_c = _orientation(ax, ay, bx, by, cx, cy)
    ab_d = _orientation(ax, ay, bx, by, dx, dy)
    cd_a = _orientation(cx, cy, dx, dy, ax, ay)
    cd_b = _orientation(cx, cy, dx, dy, bx, by)
    straddles_ab = ((ab_c > epsilon) & (ab_d < -epsilon)) | (
        (ab_c < -epsilon) & (ab_d > epsilon)
    )
    straddles_cd = ((cd_a > epsilon) & (cd_b < -epsilon)) | (
        (cd_a < -epsilon) & (cd_b > epsilon)
    )
    return straddles_ab & straddles_cd


def _crosses_any_cut(
    from_points: np.ndarray,
    to_points: np.ndarray,
    cuts: Sequence[CutPolyline],
) -> np.ndarray:
    crossed = np.zeros(from_points.shape[0], dtype=bool)
    for cut in cuts:
        points = cut.points
        for index in range(1, points.shape[0]):
            crossed |= _segments_cross(
                from_points, to_points, points[index - 1], points[index]
            )
    return crossed


# --- Bone distances and anchors --------------------------------------------


def _bone_distances(
    verts_local: np.ndarray,
    bones: Sequence[BoneSegment],
    origin: Tuple[float, float],
    cuts: Sequence[CutPolyline],
) -> Tuple[np.ndarray, np.ndarray]:
    """``(occluded_distance, geometric_distance)`` matrices, both (N, B).

    Two matrices rather than one because they answer different questions.
    ``occluded`` is infinite across a cut and drives the weights; ``geometric``
    ignores cuts and exists only to supply v3's nearest-bone fallback for a
    pocket that every cut severed.

    The bone path test is against the nearest point on the bone, not against
    both endpoints — one endpoint can sit beyond a cut while the closest part of
    the same bone is in plain view (``lib/mesh.ts`` 201-202).
    """
    count = verts_local.shape[0]
    bone_count = len(bones)
    occluded = np.full((count, bone_count), np.inf, dtype=np.float64)
    geometric = np.full((count, bone_count), np.inf, dtype=np.float64)

    sheet = np.empty_like(verts_local)
    sheet[:, 0] = verts_local[:, 0] + origin[0]
    sheet[:, 1] = verts_local[:, 1] + origin[1]

    for index, bone in enumerate(bones):
        nearest_sheet, distance = _nearest_on_segment(sheet, bone.start, bone.end)
        geometric[:, index] = distance
        if not cuts:
            occluded[:, index] = distance
            continue
        nearest_local = np.empty_like(nearest_sheet)
        nearest_local[:, 0] = nearest_sheet[:, 0] - origin[0]
        nearest_local[:, 1] = nearest_sheet[:, 1] - origin[1]
        blocked = _crosses_any_cut(verts_local, nearest_local, cuts)
        occluded[:, index] = np.where(blocked, np.inf, distance)
    return occluded, geometric


def _anchor_labels(distances: np.ndarray) -> np.ndarray:
    """Per-vertex anchor bone index, or -1 for a free vertex.

    A vertex is pinned only when one bone is *decisively* nearest. Pinning every
    vertex to its nearest bone would reproduce nearest-bone rigid banding and
    make the diffusion pointless; pinning none of them leaves the system with no
    boundary condition at all. The dominance ratio is the dial between those.

    Every bone additionally gets at least one anchor where one is available,
    because a column of zeros means "moving this bone moves nothing", and an
    artist reads that as a broken rig rather than as a weighting choice.
    """
    count, bone_count = distances.shape
    labels = np.full(count, -1, dtype=np.int64)
    if bone_count == 0:
        return labels

    order = np.argsort(distances, axis=1, kind="stable")
    nearest = order[:, 0]
    nearest_distance = distances[np.arange(count), nearest]
    if bone_count > 1:
        second = order[:, 1]
        second_distance = distances[np.arange(count), second]
    else:
        second_distance = np.full(count, np.inf)

    reachable = np.isfinite(nearest_distance)
    dominant = nearest_distance <= (
        second_distance * RigConstants.ANCHOR_DOMINANCE_RATIO
    )
    # An unreachable second bone leaves the nearest one unopposed.
    dominant |= ~np.isfinite(second_distance)
    labels = np.where(reachable & dominant, nearest, -1).astype(np.int64)

    for bone in range(bone_count):
        if bool(np.any(labels == bone)):
            continue
        candidates = np.argsort(distances[:, bone], kind="stable")
        for vertex in candidates.tolist():
            if not np.isfinite(distances[vertex, bone]):
                break
            if labels[vertex] == -1:
                labels[vertex] = bone
                break
    return labels


# --- Cotangent Laplacian ---------------------------------------------------


def _cut_severed_edges(
    verts_local: np.ndarray,
    tris: np.ndarray,
    cuts: Sequence[CutPolyline],
) -> set[Tuple[int, int]]:
    """Mesh edges a cut crosses. These carry no conductivity.

    Without this the diffusion leaks around a cut through the shared vertices
    that a conforming triangulation deliberately keeps on both sides of it, and
    the cut would only affect anchoring — which is not what a user drawing a cut
    between two overlapping limbs is asking for.
    """
    if not cuts or tris.size == 0:
        return set()
    pairs: set[Tuple[int, int]] = set()
    for a, b, c in tris.tolist():
        pairs.add((min(a, b), max(a, b)))
        pairs.add((min(b, c), max(b, c)))
        pairs.add((min(a, c), max(a, c)))
    if not pairs:
        return set()

    edges = np.asarray(sorted(pairs), dtype=np.int64)
    crossed = _crosses_any_cut(verts_local[edges[:, 0]], verts_local[edges[:, 1]], cuts)
    return {(int(edges[i, 0]), int(edges[i, 1])) for i in np.nonzero(crossed)[0]}


def _cotangent_laplacian(
    verts: np.ndarray,
    tris: np.ndarray,
    severed: set[Tuple[int, int]],
) -> csc_matrix:
    """``L = D - W`` with clamped cotangent edge weights.

    Clamping the cotangents to be non-negative is what keeps ``L`` an M-matrix,
    and the M-matrix property is the entire reason the harmonic weights this
    solves for are bounded in [0, 1]. An obtuse triangle produces a negative
    cotangent; honouring it would let an interior weight overshoot its boundary
    values and the "bounded" half of the guarantee would quietly stop holding.
    """
    count = verts.shape[0]
    rows: List[int] = []
    cols: List[int] = []
    values: List[float] = []

    for triangle in tris.tolist():
        for corner in range(3):
            i = triangle[corner]
            j = triangle[(corner + 1) % 3]
            k = triangle[(corner + 2) % 3]
            edge = (min(j, k), max(j, k))
            if edge in severed:
                continue
            u = verts[j] - verts[i]
            v = verts[k] - verts[i]
            cross = abs(float(u[0] * v[1] - u[1] * v[0]))
            if cross <= RigConstants.EPSILON:
                continue
            cotangent = float(u[0] * v[0] + u[1] * v[1]) / cross
            weight = 0.5 * min(
                RigConstants.COTAN_MAX, max(RigConstants.COTAN_MIN, cotangent)
            )
            if weight <= 0.0:
                continue
            rows.extend((j, k))
            cols.extend((k, j))
            values.extend((-weight, -weight))

    adjacency = coo_matrix(
        (values, (rows, cols)), shape=(count, count), dtype=np.float64
    ).tocsr()
    degree = np.asarray(-adjacency.sum(axis=1)).ravel()
    laplacian = adjacency.tolil()
    laplacian.setdiag(degree + RigConstants.HARMONIC_REGULARISER)
    return laplacian.tocsc()


def _neighbours(
    count: int,
    tris: np.ndarray,
    severed: set[Tuple[int, int]],
) -> List[List[int]]:
    """One-ring adjacency for the smoothing pass, minus cut-severed edges.

    v3's smoothing pass used the raw triangle adjacency, which quietly undid one
    ring of the cut it had just honoured: the vertices immediately above a cut
    averaged in the weights of the vertices immediately below it. Using the same
    severed adjacency the diffusion used means there is exactly one notion of
    "which vertices are connected" in this module, and a cut means the same thing
    to both passes.
    """
    sets: List[set[int]] = [set() for _ in range(count)]

    def link(a: int, b: int) -> None:
        if (min(a, b), max(a, b)) in severed:
            return
        sets[a].add(b)
        sets[b].add(a)

    for a, b, c in tris.tolist():
        link(a, b)
        link(b, c)
        link(a, c)
    return [sorted(item) for item in sets]


# --- Weight assembly -------------------------------------------------------


def _inverse_distance_weights(distances: np.ndarray) -> np.ndarray:
    """v3's ``1 / (d^FALLOFF + eps)``, kept as the fallback solver.

    Reached only when the harmonic system cannot be factored — a mesh so
    fragmented that every block is singular. Producing something stiff but
    sane beats producing no rig, and the method that was used is recorded on
    the result so a support case does not have to guess.
    """
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        raw = 1.0 / (np.power(distances, RigConstants.SKIN_FALLOFF) + RigConstants.EPSILON)
    return np.where(np.isfinite(raw), raw, 0.0)


def _solve_harmonic(
    laplacian: csc_matrix,
    labels: np.ndarray,
    bone_count: int,
) -> Optional[np.ndarray]:
    """Dirichlet solve for all bone columns at once, or None if unavailable.

    ``None`` covers two different situations that both mean "there is no
    harmonic answer here": no vertex could be anchored at all (every bone is
    behind a cut), and a system the factorization refused. Both hand the caller
    the same decision, so they are not distinguished.
    """
    count = labels.shape[0]
    weights = np.zeros((count, bone_count), dtype=np.float64)
    anchored = labels >= 0
    weights[anchored, labels[anchored]] = 1.0

    free = np.nonzero(~anchored)[0]
    if free.size == 0:
        return weights
    if not bool(np.any(anchored)):
        return None

    l_ff = laplacian[free[:, None], free]
    l_fa = laplacian[free[:, None], np.nonzero(anchored)[0]]
    rhs = -(l_fa @ weights[anchored])
    try:
        solver = splu(csc_matrix(l_ff))
        solved = solver.solve(np.asarray(rhs, dtype=np.float64))
    except (RuntimeError, ValueError):
        return None
    if not np.all(np.isfinite(solved)):
        return None
    weights[free] = solved
    return weights


def _smooth(weights: np.ndarray, neighbours: Sequence[Sequence[int]]) -> np.ndarray:
    """One Laplacian smoothing pass, re-normalized. Kept from v3 verbatim.

    v3's note is still the reason it is here: per-bone weights step across the
    midline between two bones, and that discontinuity renders as a visible
    crease the moment the limbs move apart.
    """
    smoothed = np.empty_like(weights)
    for vertex, adjacent in enumerate(neighbours):
        accumulated = weights[vertex].copy()
        for other in adjacent:
            accumulated += weights[other]
        smoothed[vertex] = accumulated / (len(adjacent) + 1)
    return smoothed


def _prune_top_k(weights: np.ndarray, top_k: int) -> np.ndarray:
    """Keep the strongest ``top_k`` columns per row, zero the rest.

    Not only a size optimization: linear blend skinning costs one transform per
    non-zero weight per vertex per frame, and a dense 32-column row spends most
    of that budget on influences too small to see.
    """
    count, bone_count = weights.shape
    if bone_count <= top_k:
        return weights
    kept = np.zeros_like(weights)
    order = np.argsort(-weights, axis=1, kind="stable")[:, :top_k]
    rows = np.repeat(np.arange(count), top_k)
    kept[rows, order.ravel()] = weights[rows, order.ravel()]
    return kept


def _normalize_rows(
    weights: np.ndarray,
    fallback: np.ndarray,
) -> Tuple[np.ndarray, int]:
    """Clamp negatives, normalize to sum 1, and count fallback rows.

    A row that sums to nothing is the case v3 called out: a cut can legitimately
    isolate a pocket from every bone. It gets the geometrically nearest bone at
    full weight, which is stiff but finite — the alternative is a division by
    zero that propagates NaN into every posed vertex for the life of the
    document.
    """
    clamped = np.where(weights > 0.0, weights, 0.0)
    sums = clamped.sum(axis=1)
    isolated = np.nonzero(sums <= 0.0)[0]
    for vertex in isolated.tolist():
        clamped[vertex, :] = 0.0
        clamped[vertex, int(fallback[vertex])] = 1.0
    sums = clamped.sum(axis=1)
    sums[sums <= 0.0] = 1.0
    return clamped / sums[:, None], int(isolated.size)


class Skinner:
    """Per-part bone selection and weight solving."""

    __slots__ = ()

    @staticmethod
    def select_bones(
        part_id: str,
        bones: Sequence[BoneSegment],
        verts_local: np.ndarray,
        origin: Tuple[float, float],
        limit: int,
    ) -> List[BoneSegment]:
        """Which bones become weight-matrix columns for this part.

        Part binding first, distance only as a tie-break. That order matters:
        a hand drawn beside a hip is *closer* to the hip bone than to its own
        wrist bone on plenty of sheets, and a purely geometric selection would
        skin it to the hip. Joints carry ``partId`` precisely so this does not
        have to be guessed.

        Bones one joint away from the part's own bones are included as well, so
        influence can fall off across the shoulder instead of terminating at it
        — a hard column boundary at a part seam is a crease.
        """
        if not bones:
            return []

        owned = [
            bone
            for bone in bones
            if bone.parent_part_id == part_id or bone.child_part_id == part_id
        ]
        selected = {bone.id: bone for bone in owned}
        owned_joints = {bone.parent_joint_id for bone in owned} | {
            bone.child_joint_id for bone in owned
        }
        for bone in bones:
            if bone.parent_joint_id in owned_joints or bone.child_joint_id in owned_joints:
                selected.setdefault(bone.id, bone)

        candidates = list(selected.values()) if selected else list(bones)
        if len(candidates) <= limit:
            return candidates

        # Over budget: keep the ones actually near the artwork.
        centre = np.array(
            [
                float(verts_local[:, 0].mean() + origin[0]),
                float(verts_local[:, 1].mean() + origin[1]),
            ],
            dtype=np.float64,
        ).reshape(1, 2)
        scored = sorted(
            candidates,
            key=lambda bone: float(_nearest_on_segment(centre, bone.start, bone.end)[1][0]),
        )
        return scored[:limit]

    @staticmethod
    def solve(
        verts_local: np.ndarray,
        tris: np.ndarray,
        bones: Sequence[BoneSegment],
        origin: Tuple[float, float],
        cuts: Sequence[CutPolyline],
    ) -> SkinResult:
        """Build the weight matrix and the column order that indexes it."""
        count = verts_local.shape[0]
        bone_count = len(bones)
        bone_ids = [bone.id for bone in bones]
        if bone_count == 0:
            return SkinResult(
                weights=np.zeros((count, 0), dtype=np.float32),
                bone_ids=[],
                isolated_vertices=0,
                method=_METHOD_HARMONIC,
            )

        occluded, geometric = _bone_distances(verts_local, bones, origin, cuts)
        fallback = np.argmin(geometric, axis=1)
        labels = _anchor_labels(occluded)

        severed = _cut_severed_edges(verts_local, tris, cuts)
        laplacian = _cotangent_laplacian(verts_local, tris, severed)
        solved = _solve_harmonic(laplacian, labels, bone_count)
        method = _METHOD_HARMONIC
        if solved is None:
            solved = _inverse_distance_weights(occluded)
            method = _METHOD_INVERSE_DISTANCE

        neighbours = _neighbours(count, tris, severed)
        for _ in range(RigConstants.SMOOTH_PASSES):
            solved = _smooth(solved, neighbours)
        solved = _prune_top_k(solved, RigConstants.SKIN_TOP_K)
        normalized, isolated = _normalize_rows(solved, fallback)

        # Round to storage precision, then normalize once more IN float32. The
        # order is deliberate: normalizing before the cast leaves rows that sum
        # to 1 in float64 and to 1 +/- a few ULP in float32, and the validator
        # checks the stored numbers, not the ones we computed.
        stored = normalized.astype(np.float32)
        sums = stored.sum(axis=1, dtype=np.float32)
        sums[sums <= np.float32(0.0)] = np.float32(1.0)
        stored = (stored / sums[:, None]).astype(np.float32)

        return SkinResult(
            weights=stored,
            bone_ids=bone_ids,
            isolated_vertices=isolated,
            method=method,
        )

    @staticmethod
    def rows_sum_to_one(weights: np.ndarray) -> bool:
        """Whether every row is within ``WEIGHT_ROW_EPSILON`` of summing to 1.

        An empty matrix passes: a part with no bones has no rows to check, and
        a rigid part legitimately has none.
        """
        if weights.size == 0:
            return True
        sums = weights.sum(axis=1, dtype=np.float64)
        return bool(np.all(np.abs(sums - 1.0) <= RigConstants.WEIGHT_ROW_EPSILON))
