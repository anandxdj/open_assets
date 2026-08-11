// Mesh generation and linear-blend-skinning bind weights.
//
// Both are DETERMINISTIC and client-side. The rig-analysis model proposes joint
// positions only (a few dozen numbers a vision model estimates well and the user
// can drag); triangle topology and a full weight matrix are derived here. A
// hallucinated triangle list would produce deformation that is visibly broken
// with no way for the user to diagnose it.
import {
  type Joint,
  type CutLine,
  type Mesh,
  type Weights,
  getBones,
} from "@/features/anibuddy/types";
import cdt2d from "cdt2d";
import {
  distanceTransform,
  samplePoints,
  simplify,
  traceContours,
} from "@/features/anibuddy/lib/contour";

/** Alpha at or below this is background, matching prepare.ts and rigCore. */
const ALPHA_FLOOR = 24;
/** Hard ceiling on vertices — the renderer redraws every triangle per frame. */
const MAX_VERTS = 1200;
/** Reject near-zero area triangles before the affine renderer sees them. */
const MIN_TRIANGLE_AREA = 1e-4;
/** Bones influencing any one vertex after pruning. */
const TOP_K = 4;
/** Falloff exponent. 4 keeps limbs independent instead of dragging the torso. */
const FALLOFF = 4;
const EPSILON = 1e-6;

export interface Point {
  x: number;
  y: number;
}

/** Build an artwork-following constrained Delaunay mesh in normalized space. */
export function buildMesh(alpha: Uint8ClampedArray, width: number, height: number, cuts: CutLine[] = []): Mesh {
  if (width <= 0 || height <= 0) return { verts: new Float32Array(), tris: new Uint32Array() };
  const rings = traceContours(alpha, width, height)
    .map((ring) => simplify(ring, Math.max(width, height) * 0.004))
    .filter((ring) => ring.length >= 3);
  if (rings.length === 0) return { verts: new Float32Array(), tris: new Uint32Array() };

  const dist = distanceTransform(alpha, width, height);
  let solidPixels = 0;
  for (let index = 0; index < width * height; index++) if (alpha[index * 4 + 3] > ALPHA_FLOOR) solidPixels++;
  let spacing = Math.max(3, Math.sqrt(Math.max(1, solidPixels) / 520));

  for (let pass = 0; pass < 12; pass++) {
    const points: number[][] = [];
    const pointIndex = new Map<string, number>();
    const edges: number[][] = [];
    const addPoint = (x: number, y: number): number => {
      const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
      const existing = pointIndex.get(key);
      if (existing !== undefined) return existing;
      const index = points.length;
      points.push([x, y]);
      pointIndex.set(key, index);
      return index;
    };
    const addEdge = (a: number, b: number) => {
      if (a !== b) edges.push([a, b]);
    };

    for (const ring of rings) {
      const indices = ring.map(([x, y]) => addPoint(x, y));
      for (let index = 0; index < indices.length; index++) addEdge(indices[index], indices[(index + 1) % indices.length]);
    }
    for (const cut of cuts) {
      const indices = cut.points.map(([x, y]) => addPoint(
        Math.max(0, Math.min(width, x * width)),
        Math.max(0, Math.min(height, y * height)),
      ));
      for (let index = 1; index < indices.length; index++) addEdge(indices[index - 1], indices[index]);
    }
    for (const [x, y] of samplePoints(rings, dist, width, height, spacing)) addPoint(x, y);

    // Raise the local sampling pitch and rebuild the PSLG instead of slicing
    // points off the end: truncation silently leaves invalid triangle indices.
    if (points.length > MAX_VERTS && pass < 11) {
      spacing *= 1.35;
      continue;
    }

    let cells: number[][];
    try {
      cells = cdt2d(points, edges, { exterior: false, interior: true });
    } catch {
      return { verts: new Float32Array(), tris: new Uint32Array() };
    }

    const used = new Map<number, number>();
    const verts: number[] = [];
    const tris: number[] = [];
    const vertexFor = (index: number): number => {
      const existing = used.get(index);
      if (existing !== undefined) return existing;
      const vertex = verts.length / 2;
      used.set(index, vertex);
      verts.push(points[index][0] / width, points[index][1] / height);
      return vertex;
    };
    for (const cell of cells) {
      const [a, b, c] = cell;
      const area = Math.abs(
        (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) -
        (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]),
      ) / (width * height);
      if (area < MIN_TRIANGLE_AREA) continue;
      tris.push(vertexFor(a), vertexFor(b), vertexFor(c));
    }
    return { verts: Float32Array.from(verts), tris: Uint32Array.from(tris) };
  }
  return { verts: new Float32Array(), tris: new Uint32Array() };
}
/** Nearest point and distance from `p` to segment `a`–`b`. */
function nearestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < EPSILON) return { point: a, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  const point = { x: a.x + abx * t, y: a.y + aby * t };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}
/** Vertices sharing a triangle edge with each vertex — used for smoothing. */
function buildNeighbours(mesh: Mesh): number[][] {
  const neighbours: Set<number>[] = Array.from(
    { length: mesh.verts.length / 2 },
    () => new Set<number>(),
  );
  for (let i = 0; i < mesh.tris.length; i += 3) {
    const [a, b, c] = [mesh.tris[i], mesh.tris[i + 1], mesh.tris[i + 2]];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }
  return neighbours.map((set) => Array.from(set));
}

/**
 * Bind weights, row-major: one row per vertex, one column per bone, each row
 * summing to 1.
 *
 * `w_j = 1 / (d_j^FALLOFF + ε)`, pruned to the nearest TOP_K bones and
 * normalized. Then one Laplacian pass over mesh neighbours: raw inverse-distance
 * weights jump across the midline between two bones, and that discontinuity
 * renders as a visible crease when the limbs move apart.
 */
function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

function crossesCut(from: Point, to: Point, cuts: CutLine[]): boolean {
  for (const cut of cuts) {
    for (let index = 1; index < cut.points.length; index++) {
      const [x1, y1] = cut.points[index - 1];
      const [x2, y2] = cut.points[index];
      if (segmentsCross(from, to, { x: x1, y: y1 }, { x: x2, y: y2 })) return true;
    }
  }
  return false;
}

export function buildWeights(mesh: Mesh, joints: Joint[], cuts: CutLine[] = []): Weights {
  const bones = getBones(joints);
  const vertCount = mesh.verts.length / 2;
  const boneCount = bones.length;
  const weights = new Float32Array(vertCount * boneCount);
  if (boneCount === 0) return weights;

  const scored = new Float64Array(boneCount);
  let isolatedVertices = 0;
  for (let v = 0; v < vertCount; v++) {
    const point = { x: mesh.verts[v * 2], y: mesh.verts[v * 2 + 1] };
    let fallbackBone = 0;
    let fallbackDistance = Infinity;

    for (let b = 0; b < boneCount; b++) {
      const start = { x: bones[b].parentJoint.x, y: bones[b].parentJoint.y };
      const end = { x: bones[b].childJoint.x, y: bones[b].childJoint.y };
      const nearest = nearestPointOnSegment(point, start, end);
      if (nearest.distance < fallbackDistance) {
        fallbackDistance = nearest.distance;
        fallbackBone = b;
      }
      // Test the path to the actual nearest point, not both bone endpoints:
      // one endpoint can be beyond a cut even while the closest part is visible.
      scored[b] = crossesCut(point, nearest.point, cuts)
        ? 0
        : 1 / (Math.pow(nearest.distance, FALLOFF) + EPSILON);
    }

    // Keep the TOP_K strongest, zero the rest, then normalize.
    const cutoff = boneCount <= TOP_K ? 0 : Array.from(scored).sort((a, b) => b - a)[TOP_K - 1];
    let sum = 0;
    for (let b = 0; b < boneCount; b++) {
      if (scored[b] < cutoff) scored[b] = 0;
      sum += scored[b];
    }

    const base = v * boneCount;
    if (sum <= 0) {
      // A cut can legitimately isolate a pocket from every bone. Pin it to the
      // geometrically nearest bone, ignoring cuts, rather than propagate NaN.
      weights[base + fallbackBone] = 1;
      isolatedVertices++;
      continue;
    }
    for (let b = 0; b < boneCount; b++) weights[base + b] = scored[b] / sum;
  }

  if (isolatedVertices > 0) {
    // buildWeights is deliberately pure at its call sites, so Order 4 can fold
    // this diagnostic into Rig.warnings without changing its result shape.
    console.warn(`AniBuddy: ${isolatedVertices} mesh vertices were cut off from every bone; nearest-bone fallback was used.`);
  }
  return smoothWeights(mesh, weights, boneCount);
}
/** One Laplacian smoothing pass, re-normalized. */
function smoothWeights(mesh: Mesh, weights: Weights, boneCount: number): Weights {
  const neighbours = buildNeighbours(mesh);
  const smoothed = new Float32Array(weights.length);

  for (let v = 0; v < neighbours.length; v++) {
    const base = v * boneCount;
    const adjacent = neighbours[v];
    let sum = 0;

    for (let b = 0; b < boneCount; b++) {
      let accumulated = weights[base + b];
      for (const other of adjacent) accumulated += weights[other * boneCount + b];
      const value = accumulated / (adjacent.length + 1);
      smoothed[base + b] = value;
      sum += value;
    }

    if (sum <= 0) {
      smoothed[base] = 1;
      continue;
    }
    for (let b = 0; b < boneCount; b++) smoothed[base + b] /= sum;
  }

  return smoothed;
}

/**
 * Re-normalize the rows the weight brush touched. Painting adds influence to one
 * bone; without this the row no longer sums to 1 and `rigInvalidReason` rejects
 * the rig.
 */
export function normalizeRows(weights: Weights, boneCount: number, rows: Iterable<number>): void {
  for (const row of rows) {
    const base = row * boneCount;
    let sum = 0;
    for (let b = 0; b < boneCount; b++) {
      if (weights[base + b] < 0) weights[base + b] = 0;
      sum += weights[base + b];
    }
    if (sum <= 0) {
      weights[base] = 1;
      continue;
    }
    for (let b = 0; b < boneCount; b++) weights[base + b] /= sum;
  }
}
