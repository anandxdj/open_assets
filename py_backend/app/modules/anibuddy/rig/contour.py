"""Port of ``frontend/src/features/anibuddy/lib/contour.ts``.

Four steps, in the order the mesher uses them: trace the silhouette, simplify
it, measure how thick the shape is everywhere, and scatter interior points at a
pitch that follows that thickness. All of it in PART-LOCAL PIXELS; normalizing
to ``Part.rect`` happens once, at the wire boundary.

Two deliberate departures from the TypeScript original, both because this side
has data the browser did not
-----------------------------------------------------------------------------
1. The row scans in the chamfer transform and the point-in-polygon test are
   vectorized. The chamfer's within-row dependency is turned into a min-plus
   prefix scan, which is exact rather than approximate: the running minimum of
   ``d[k] - k`` is algebraically identical to relaxing ``d[x] = min(d[x],
   d[x-1] + 1)`` left to right, so the result is the same array the sequential
   loop produces, not a similar one.
2. Even-odd containment is evaluated once into a raster instead of per
   candidate point. The predicate is unchanged (XOR accumulation of the filled
   rings *is* even-odd), and the same raster is reused by the triangulator to
   decide which triangles are inside the silhouette — so sampling and
   triangulation cannot disagree about where the shape is, which they could
   when each ran its own scanline test.

Determinism matters here beyond tidiness: every stage is idempotent on
``inputHash``, so the same sheet must produce byte-identical geometry. That is
why the jitter below is a hash of the coordinate rather than an RNG draw.
"""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

import cv2
import numpy as np

from app.modules.anibuddy.constants import RigConstants

_ROOT_TWO: float = math.sqrt(2.0)
_INFINITY: float = 1e9

Point = Tuple[int, int]
Ring = List[Point]

#: Per-pixel edge emission order, matching the four ``if`` statements in
#: ``traceContours``. Ring identity does not depend on it, but reproducing it
#: keeps this port's output comparable to the browser's during the migration.
_EDGE_ORDER: Tuple[str, ...] = ("top", "right", "bottom", "left")


def _solid(mask: np.ndarray) -> np.ndarray:
    return mask > 0


def _shift_down(grid: np.ndarray) -> np.ndarray:
    """The row above, as an array aligned to the current row."""
    out = np.zeros_like(grid, dtype=bool)
    out[1:, :] = grid[:-1, :]
    return out


def _shift_up(grid: np.ndarray) -> np.ndarray:
    out = np.zeros_like(grid, dtype=bool)
    out[:-1, :] = grid[1:, :]
    return out


def _shift_right(grid: np.ndarray) -> np.ndarray:
    out = np.zeros_like(grid, dtype=bool)
    out[:, 1:] = grid[:, :-1]
    return out


def _shift_left(grid: np.ndarray) -> np.ndarray:
    out = np.zeros_like(grid, dtype=bool)
    out[:, :-1] = grid[:, 1:]
    return out


def _boundary_edges(mask: np.ndarray) -> List[Tuple[Point, Point]]:
    """Every exposed pixel edge, as a directed segment on the corner lattice.

    With the figure kept on the right of each directed edge, exterior rings
    wind one way and holes the other, which is what lets the even-odd test
    below treat holes correctly without ever asking which ring is which.

    Tracing pixel EDGES rather than pixel centres is load-bearing: a
    one-pixel-wide feature has a real two-corner-wide outline on the lattice,
    where a centre-based trace would collapse it to a degenerate line and lose
    the feature entirely.
    """
    solid = _solid(mask)
    exposed = {
        "top": solid & ~_shift_down(solid),
        "right": solid & ~_shift_left(solid),
        "bottom": solid & ~_shift_up(solid),
        "left": solid & ~_shift_right(solid),
    }

    rows: List[np.ndarray] = []
    cols: List[np.ndarray] = []
    ranks: List[np.ndarray] = []
    for rank, name in enumerate(_EDGE_ORDER):
        ys, xs = np.nonzero(exposed[name])
        rows.append(ys)
        cols.append(xs)
        ranks.append(np.full(ys.shape, rank, dtype=np.int64))
    if not any(len(part) for part in rows):
        return []

    all_y = np.concatenate(rows)
    all_x = np.concatenate(cols)
    all_rank = np.concatenate(ranks)
    # Sort key (y, x, rank) reproduces the browser's nested-loop emission order.
    order = np.lexsort((all_rank, all_x, all_y))

    edges: List[Tuple[Point, Point]] = []
    for index in order:
        y = int(all_y[index])
        x = int(all_x[index])
        rank = int(all_rank[index])
        if rank == 0:
            edges.append(((x, y), (x + 1, y)))
        elif rank == 1:
            edges.append(((x + 1, y), (x + 1, y + 1)))
        elif rank == 2:
            edges.append(((x + 1, y + 1), (x, y + 1)))
        else:
            edges.append(((x, y + 1), (x, y)))
    return edges


def trace_contours(mask: np.ndarray) -> List[Ring]:
    """Marching-squares-style boundary trace on the pixel-corner lattice."""
    height, width = mask.shape[:2]
    if width <= 0 or height <= 0:
        return []

    outgoing: Dict[Point, List[Point]] = {}
    for start, end in _boundary_edges(mask):
        outgoing.setdefault(start, []).append(end)
    if not outgoing:
        return []

    used: set[Tuple[Point, Point]] = set()
    rings: List[Ring] = []
    guard_limit = width * height * 4

    for start in list(outgoing.keys()):
        for first in list(outgoing.get(start, ())):
            if (start, first) in used:
                continue
            ring: Ring = [start]
            previous = start
            current = first
            guard = 0
            while guard <= guard_limit:
                guard += 1
                used.add((previous, current))
                if current == start:
                    break
                ring.append(current)
                choices = [
                    nxt
                    for nxt in outgoing.get(current, ())
                    if (current, nxt) not in used
                ]
                if not choices:
                    break
                # Diagonally touching components offer two edges at one corner.
                # Taking the clockwise-most continuation keeps the walk inside
                # the component it started in instead of hopping across the
                # diagonal into its neighbour.
                dx = current[0] - previous[0]
                dy = current[1] - previous[1]

                def turn(candidate: Point, dx: int = dx, dy: int = dy, here: Point = current) -> float:
                    ex = candidate[0] - here[0]
                    ey = candidate[1] - here[1]
                    return math.atan2(dy * ex - dx * ey, dx * ex + dy * ey)

                choices.sort(key=turn)
                previous = current
                current = choices[0]
            if len(ring) >= 3 and current == start:
                rings.append(ring)
    return rings


def _point_segment_distance_sq(
    point: Sequence[float],
    start: Sequence[float],
    end: Sequence[float],
) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0.0:
        return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2
    t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_sq
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return (point[0] - (start[0] + t * dx)) ** 2 + (point[1] - (start[1] + t * dy)) ** 2


def _simplify_open(points: Sequence[Point], epsilon_sq: float) -> List[Point]:
    """Ramer-Douglas-Peucker on an open polyline, iteratively.

    Iterative rather than recursive purely for stack safety: a ring with a
    thousand collinear-ish points recurses a thousand deep in the browser
    without complaint and blows Python's default limit. The kept-point set is
    identical — the split predicate and the tolerance are unchanged.
    """
    count = len(points)
    if count <= 2:
        return list(points)

    keep = np.zeros(count, dtype=bool)
    keep[0] = True
    keep[count - 1] = True
    stack: List[Tuple[int, int]] = [(0, count - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        farthest = -1
        best = epsilon_sq
        for index in range(first + 1, last):
            candidate = _point_segment_distance_sq(points[index], points[first], points[last])
            if candidate > best:
                best = candidate
                farthest = index
        if farthest < 0:
            continue
        keep[farthest] = True
        stack.append((first, farthest))
        stack.append((farthest, last))
    return [points[index] for index in range(count) if keep[index]]


def simplify(ring: Ring, epsilon: float) -> Ring:
    """RDP for a CLOSED ring, split at the point farthest from ring[0].

    A closed ring has no natural endpoints, so RDP needs two anchors. Using
    ring[0] and the point farthest from it guarantees the two halves are both
    substantial; anchoring on adjacent points would let RDP straighten the
    whole silhouette into a single chord.
    """
    if len(ring) <= 3:
        return [tuple(point) for point in ring]

    split = 1
    farthest = -1.0
    for index in range(1, len(ring)):
        distance = (ring[index][0] - ring[0][0]) ** 2 + (ring[index][1] - ring[0][1]) ** 2
        if distance > farthest:
            farthest = distance
            split = index

    epsilon_sq = epsilon * epsilon
    first = _simplify_open([*ring[: split + 1], ring[0]], epsilon_sq)[:-1]
    second = _simplify_open([*ring[split:], ring[0]], epsilon_sq)[:-1]
    result = [*first, *second]
    return result if len(result) >= 3 else [tuple(point) for point in ring]


def distance_transform(mask: np.ndarray) -> np.ndarray:
    """Chamfer distance from every solid pixel to the nearest background pixel.

    Two sweeps with a 3x3 chamfer mask (orthogonal cost 1, diagonal cost
    sqrt(2)), exactly as in ``lib/contour.ts``. The within-row relaxation is
    computed as a min-plus prefix scan rather than a loop; see the module
    docstring for why that is exact.
    """
    height, width = mask.shape[:2]
    if width <= 0 or height <= 0:
        return np.zeros((max(0, height), max(0, width)), dtype=np.float64)

    dist = np.where(_solid(mask), _INFINITY, 0.0).astype(np.float64)
    index = np.arange(width, dtype=np.float64)

    def scan_forward(row: np.ndarray) -> np.ndarray:
        # d[x] = x + min_{k <= x} (row[k] - k): the closed form of relaxing
        # left to right with unit horizontal cost.
        return index + np.minimum.accumulate(row - index)

    def scan_backward(row: np.ndarray) -> np.ndarray:
        flipped = row[::-1]
        return scan_forward(flipped)[::-1]

    def combine(row: np.ndarray, neighbour: np.ndarray) -> np.ndarray:
        candidate = np.minimum(row, neighbour + 1.0)
        shifted_right = np.full(width, _INFINITY)
        shifted_right[1:] = neighbour[:-1]
        candidate = np.minimum(candidate, shifted_right + _ROOT_TWO)
        shifted_left = np.full(width, _INFINITY)
        shifted_left[:-1] = neighbour[1:]
        return np.minimum(candidate, shifted_left + _ROOT_TWO)

    for y in range(height):
        row = dist[y] if y == 0 else combine(dist[y], dist[y - 1])
        dist[y] = scan_forward(row)
    for y in range(height - 1, -1, -1):
        row = dist[y] if y == height - 1 else combine(dist[y], dist[y + 1])
        dist[y] = scan_backward(row)
    return dist


def rings_to_domain(rings: Sequence[Ring], width: int, height: int) -> np.ndarray:
    """Rasterize the even-odd interior of a ring set, on the corner lattice.

    XOR accumulation of each filled ring *is* the even-odd rule, so a hole
    ring punches its own interior back out without anyone having to classify
    rings by winding. Ring coordinates live on the corner lattice (0..width
    inclusive), so the raster is one pixel larger on each axis and a lookup for
    pixel (x, y) reads cell (x, y) — the cell whose top-left corner it is.
    """
    domain = np.zeros((height + 1, width + 1), dtype=np.uint8)
    for ring in rings:
        if len(ring) < 3:
            continue
        polygon = np.asarray(ring, dtype=np.int32).reshape(-1, 1, 2)
        layer = np.zeros_like(domain)
        cv2.fillPoly(layer, [polygon], 1)
        domain ^= layer
    return domain


def _local_pitch(
    x: float,
    y: float,
    dist: np.ndarray,
    spacing: float,
) -> float:
    """Sampling pitch at a point: coarser where the shape is thick.

    A uniform pitch is wrong in both directions at once — it wastes vertices in
    the middle of a torso and starves a wrist of them. Scaling with the
    distance transform is what keeps thin features from being crossed by a
    single triangle.
    """
    height, width = dist.shape[:2]
    px = int(min(width - 1, max(0, round(x))))
    py = int(min(height - 1, max(0, round(y))))
    value = (
        spacing * RigConstants.SAMPLE_PITCH_BASE
        + float(dist[py, px]) * RigConstants.SAMPLE_PITCH_DISTANCE
    )
    ceiling = spacing * RigConstants.SAMPLE_PITCH_MAX_FACTOR
    return max(RigConstants.SAMPLE_CELL_MIN_PX, min(ceiling, value))


def sample_interior(
    domain: np.ndarray,
    dist: np.ndarray,
    width: int,
    height: int,
    spacing: float,
) -> List[Tuple[float, float]]:
    """Deterministic Poisson-ish interior samples at an adaptive pitch."""
    if width <= 0 or height <= 0:
        return []

    cell = max(RigConstants.SAMPLE_CELL_MIN_PX, spacing * RigConstants.SAMPLE_CELL_RATIO)
    grid: Dict[Tuple[int, int], List[Tuple[float, float]]] = {}
    points: List[Tuple[float, float]] = []
    neighbourhood = int(
        math.ceil((spacing * RigConstants.SAMPLE_PITCH_MAX_FACTOR) / cell)
    )

    y = cell / 2.0
    while y < height:
        x = cell / 2.0
        while x < width:
            # Hash jitter, not an RNG draw: the stage has to be idempotent on
            # inputHash, and a regular lattice of samples shows up as a visible
            # periodic pattern once the part deforms.
            hashed = (
                math.sin(x * RigConstants.SAMPLE_HASH_X + y * RigConstants.SAMPLE_HASH_Y)
                * RigConstants.SAMPLE_HASH_SCALE
            )
            jitter = hashed - math.floor(hashed) - 0.5
            candidate = (
                max(0.0, min(width - 1.0, x + jitter * cell * RigConstants.SAMPLE_JITTER_RATIO)),
                max(
                    0.0,
                    min(
                        height - 1.0,
                        y + (0.5 - jitter) * cell * RigConstants.SAMPLE_JITTER_RATIO,
                    ),
                ),
            )
            x += cell

            lookup_x = int(min(domain.shape[1] - 1, max(0, round(candidate[0]))))
            lookup_y = int(min(domain.shape[0] - 1, max(0, round(candidate[1]))))
            if not domain[lookup_y, lookup_x]:
                continue

            pitch = _local_pitch(candidate[0], candidate[1], dist, spacing)
            gx = int(math.floor(candidate[0] / cell))
            gy = int(math.floor(candidate[1] / cell))
            near = False
            for oy in range(-neighbourhood, neighbourhood + 1):
                if near:
                    break
                for ox in range(-neighbourhood, neighbourhood + 1):
                    if near:
                        break
                    for other in grid.get((gx + ox, gy + oy), ()):
                        limit = (
                            min(pitch, _local_pitch(other[0], other[1], dist, spacing))
                            * RigConstants.SAMPLE_PACKING_RATIO
                        )
                        dx = candidate[0] - other[0]
                        dy = candidate[1] - other[1]
                        if dx * dx + dy * dy < limit * limit:
                            near = True
                            break
            if near:
                continue
            points.append(candidate)
            grid.setdefault((gx, gy), []).append(candidate)
        y += cell
    return points


def snap_to_medial_axis(
    mask: np.ndarray,
    dist: np.ndarray,
    x: float,
    y: float,
) -> Tuple[float, float]:
    """Pull a pivot hint onto the shape's medial axis, in part-local pixels.

    A pivot is a rotation centre, and a rotation centre off the medial axis
    swings the part through its own silhouette — the pivot sitting a few pixels
    inside a limb's edge is what makes a shoulder look dislocated when the arm
    lifts. Vision models place pivot *hints* well enough to identify which end
    of a limb is proximal and not well enough to land on the axis, which is why
    F9 §8.2 makes this the rig stage's job.

    Two steps: land on solid pixels at all, then walk to the local ridge of the
    distance transform. The search radius is the local half-thickness rather
    than a tuned constant, so a wrist searches a few pixels and a torso searches
    tens — the axis is that much further away in a thick part.
    """
    height, width = mask.shape[:2]
    if height <= 0 or width <= 0:
        return x, y

    solid_ys, solid_xs = np.nonzero(mask)
    if solid_xs.size == 0:
        return x, y

    px = float(min(width - 1, max(0, x)))
    py = float(min(height - 1, max(0, y)))
    if not mask[int(round(py)), int(round(px))]:
        squared = (solid_xs - px) ** 2 + (solid_ys - py) ** 2
        nearest = int(np.argmin(squared))
        px = float(solid_xs[nearest])
        py = float(solid_ys[nearest])

    thickness = float(dist[int(round(py)), int(round(px))])
    radius = max(1, int(round(thickness * RigConstants.PIVOT_SNAP_RADIUS_FACTOR)))
    x0 = max(0, int(round(px)) - radius)
    x1 = min(width, int(round(px)) + radius + 1)
    y0 = max(0, int(round(py)) - radius)
    y1 = min(height, int(round(py)) + radius + 1)

    window_dist = np.where(mask[y0:y1, x0:x1] > 0, dist[y0:y1, x0:x1], -1.0)
    if window_dist.max() < 0.0:
        return px, py
    ys, xs = np.mgrid[y0:y1, x0:x1]
    # Break ties toward the original hint so a uniformly thick part does not
    # slide its pivot to a corner of the search window.
    penalty = np.sqrt((xs - px) ** 2 + (ys - py) ** 2) * RigConstants.EPSILON
    best = int(np.argmax(window_dist - penalty))
    return float(xs.ravel()[best]), float(ys.ravel()[best])


def spine_polyline(
    mask: np.ndarray,
    probes: int,
) -> Tuple[np.ndarray, np.ndarray, float]:
    """Medial polyline along the part's principal axis, plus half-widths.

    Returns ``(points, half_widths, aspect)`` in part-local pixels. Both halves
    of a spline part come from this one measurement: the joint chain that IS its
    spine, from ``points``, and its taper track, from ``half_widths``. One
    source, so the tail's shape and the tail's width cannot disagree about where
    it narrows.

    Principal axis by PCA on the solid pixels rather than by skeletonization:
    a tail, a rope and a smoke trail are all *elongated*, and the eigenvector of
    the pixel covariance finds that axis in one pass, with no thinning
    iterations to tune and no spurious branches to prune. It gives up on an
    S-curve so tight that its principal axis is degenerate — for which the
    ``aspect`` return value is the caller's signal to fall back to ``rigid``.
    """
    ys, xs = np.nonzero(mask)
    if xs.size < 2:
        return np.zeros((0, 2), dtype=np.float64), np.zeros(0, dtype=np.float64), 0.0

    cloud = np.stack([xs.astype(np.float64), ys.astype(np.float64)], axis=1)
    centre = cloud.mean(axis=0)
    centred = cloud - centre
    # Covariance of two variables: eigen-decomposition is closed form, and
    # symmetric eigh is deterministic where a general svd's sign is not.
    covariance = (centred.T @ centred) / float(cloud.shape[0])
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    # Pin the eigenvector's sign so the spine always runs top-to-bottom or
    # left-to-right; an unpinned sign flips the chain's root between runs.
    if axis[1] < 0.0 or (abs(axis[1]) <= RigConstants.EPSILON and axis[0] < 0.0):
        axis = -axis
    normal = np.array([-axis[1], axis[0]], dtype=np.float64)

    along = centred @ axis
    across = centred @ normal
    low = float(along.min())
    high = float(along.max())
    length = high - low
    if length <= RigConstants.EPSILON:
        return np.zeros((0, 2), dtype=np.float64), np.zeros(0, dtype=np.float64), 0.0

    stations = max(2, int(probes))
    edges = np.linspace(low, high, stations + 1)
    bins = np.clip(np.digitize(along, edges[1:-1]), 0, stations - 1)

    points: List[Tuple[float, float]] = []
    widths: List[float] = []
    for station in range(stations):
        members = bins == station
        if not bool(np.any(members)):
            continue
        centre_along = float(along[members].mean())
        centre_across = float(across[members].mean())
        spread = across[members]
        half_width = float(max(spread.max() - centre_across, centre_across - spread.min()))
        position = centre + axis * centre_along + normal * centre_across
        points.append((float(position[0]), float(position[1])))
        widths.append(half_width)

    if len(points) < 2:
        return np.zeros((0, 2), dtype=np.float64), np.zeros(0, dtype=np.float64), 0.0

    mean_width = float(np.mean(widths)) * 2.0
    aspect = length / mean_width if mean_width > RigConstants.EPSILON else 0.0
    return (
        np.asarray(points, dtype=np.float64),
        np.asarray(widths, dtype=np.float64),
        aspect,
    )


def resample_polyline(points: np.ndarray, count: int) -> np.ndarray:
    """Resample a polyline to ``count`` points at uniform arc length.

    Uniform in arc length, not in index: the PCA stations are uniform along the
    principal axis, which is not the same thing once the spine curves, and a
    joint chain with unevenly spaced joints bends unevenly.
    """
    if points.shape[0] == 0 or count < 2:
        return points
    deltas = np.diff(points, axis=0)
    lengths = np.sqrt((deltas**2).sum(axis=1))
    cumulative = np.concatenate([[0.0], np.cumsum(lengths)])
    total = float(cumulative[-1])
    if total <= RigConstants.EPSILON:
        return np.repeat(points[:1], count, axis=0)
    targets = np.linspace(0.0, total, count)
    out = np.empty((count, 2), dtype=np.float64)
    out[:, 0] = np.interp(targets, cumulative, points[:, 0])
    out[:, 1] = np.interp(targets, cumulative, points[:, 1])
    return out


def initial_spacing(solid_pixels: int) -> float:
    """Starting Poisson pitch for a given solid area.

    ``sqrt(area / SAMPLE_AREA_PER_POINT)`` targets a roughly constant vertex
    budget regardless of how large the part is on the sheet, which is what
    keeps a 2000px torso from blowing the vertex cap on its first pass.
    """
    area = max(1, int(solid_pixels))
    return max(
        RigConstants.MIN_SAMPLE_SPACING_PX,
        math.sqrt(area / RigConstants.SAMPLE_AREA_PER_POINT),
    )
