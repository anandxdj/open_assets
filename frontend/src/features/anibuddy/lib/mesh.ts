// Mesh generation and linear-blend-skinning bind weights.
//
// Both are DETERMINISTIC and client-side. The rig-analysis model proposes joint
// positions only (a few dozen numbers a vision model estimates well and the user
// can drag); triangle topology and a full weight matrix are derived here. A
// hallucinated triangle list would produce deformation that is visibly broken
// with no way for the user to diagnose it.
import {
  type Joint,
  type Mesh,
  type Weights,
  getBones,
} from "@/features/anibuddy/types";

/** Alpha at or below this is background, matching prepare.ts and rigCore. */
const ALPHA_FLOOR = 24;
/** Lattice columns. Rows follow from the aspect ratio. */
const COLS = 20;
/** Hard ceiling on vertices — the renderer redraws every triangle per frame. */
const MAX_VERTS = 1200;
/** Bones influencing any one vertex after pruning. */
const TOP_K = 3;
/** Falloff exponent. 4 keeps limbs independent instead of dragging the torso. */
const FALLOFF = 4;
const EPSILON = 1e-6;

export interface Point {
  x: number;
  y: number;
}

/**
 * Build an alpha-clipped lattice over the prepared asset.
 *
 * A grid rather than a Delaunay triangulation: the vertex count is predictable,
 * the topology is stable across re-runs, and — the deciding factor — a lattice
 * produces no sliver triangles. Slivers are what make per-triangle affine
 * warping tear visibly.
 *
 * Coordinates are normalized 0..1 so the mesh survives the asset being
 * displayed at any size.
 */
export function buildMesh(alpha: Uint8ClampedArray, width: number, height: number): Mesh {
  // Choose a grid whose cells stay roughly square, then shrink it if the
  // vertex budget would be blown.
  let cols = COLS;
  let rows = Math.max(3, Math.round((COLS * height) / Math.max(1, width)));
  while ((cols + 1) * (rows + 1) > MAX_VERTS && cols > 3) {
    cols -= 1;
    rows = Math.max(3, Math.round((cols * height) / Math.max(1, width)));
  }

  const solid = (px: number, py: number): boolean => {
    const x = Math.min(width - 1, Math.max(0, Math.round(px)));
    const y = Math.min(height - 1, Math.max(0, Math.round(py)));
    return alpha[(y * width + x) * 4 + 3] > ALPHA_FLOOR;
  };

  // A cell survives if any of its four corners covers artwork. Sampling corners
  // only would drop thin limbs that pass between them, so also probe the centre.
  const cellW = width / cols;
  const cellH = height / rows;
  const kept: boolean[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellW;
      const y0 = row * cellH;
      kept[row * cols + col] =
        solid(x0, y0) ||
        solid(x0 + cellW, y0) ||
        solid(x0, y0 + cellH) ||
        solid(x0 + cellW, y0 + cellH) ||
        solid(x0 + cellW / 2, y0 + cellH / 2);
    }
  }

  // Emit only vertices a kept cell actually references, so the weight matrix
  // has no dead rows.
  const vertIndex = new Map<number, number>();
  const verts: number[] = [];
  const vertexFor = (col: number, row: number): number => {
    const key = row * (cols + 1) + col;
    const existing = vertIndex.get(key);
    if (existing !== undefined) return existing;

    const index = verts.length / 2;
    vertIndex.set(key, index);
    verts.push(Math.min(1, (col * cellW) / width), Math.min(1, (row * cellH) / height));
    return index;
  };

  const tris: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!kept[row * cols + col]) continue;
      const tl = vertexFor(col, row);
      const tr = vertexFor(col + 1, row);
      const bl = vertexFor(col, row + 1);
      const br = vertexFor(col + 1, row + 1);
      tris.push(tl, tr, bl, tr, br, bl);
    }
  }

  return snapToSilhouette(
    { verts: Float32Array.from(verts), tris: Uint32Array.from(tris) },
    alpha,
    width,
    height,
    cellW,
    cellH,
  );
}

/**
 * Pull background vertices onto the nearest artwork pixel so the mesh boundary
 * hugs the silhouette instead of stair-stepping along cell edges.
 *
 * Movement is capped at half a cell in each axis. Snapping further would let a
 * vertex cross its neighbours and invert the triangles that share it, which
 * renders as a folded-over patch of the character.
 */
function snapToSilhouette(
  mesh: Mesh,
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  cellW: number,
  cellH: number,
): Mesh {
  const solidAt = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    alpha[(y * width + x) * 4 + 3] > ALPHA_FLOOR;

  const limitX = Math.floor(cellW / 2);
  const limitY = Math.floor(cellH / 2);

  for (let v = 0; v < mesh.verts.length / 2; v++) {
    const px = Math.min(width - 1, Math.round(mesh.verts[v * 2] * width));
    const py = Math.min(height - 1, Math.round(mesh.verts[v * 2 + 1] * height));
    if (solidAt(px, py)) continue;

    // Expanding square search, so the first hit is the nearest in Chebyshev
    // distance — close enough to Euclidean at this radius, and far cheaper.
    let best: Point | null = null;
    const maxRadius = Math.max(limitX, limitY);
    for (let radius = 1; radius <= maxRadius && !best; radius++) {
      for (let dy = -radius; dy <= radius && !best; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (Math.abs(dx) > limitX || Math.abs(dy) > limitY) continue;
          if (solidAt(px + dx, py + dy)) {
            best = { x: px + dx, y: py + dy };
            break;
          }
        }
      }
    }

    if (best) {
      mesh.verts[v * 2] = best.x / width;
      mesh.verts[v * 2 + 1] = best.y / height;
    }
  }

  return mesh;
}

/** Squared distance from `p` to segment `a`–`b`, plus the clamped parameter. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
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
export function buildWeights(mesh: Mesh, joints: Joint[]): Weights {
  const bones = getBones(joints);
  const vertCount = mesh.verts.length / 2;
  const boneCount = bones.length;
  const weights = new Float32Array(vertCount * boneCount);
  if (boneCount === 0) return weights;

  const scored = new Float64Array(boneCount);
  for (let v = 0; v < vertCount; v++) {
    const point = { x: mesh.verts[v * 2], y: mesh.verts[v * 2 + 1] };

    for (let b = 0; b < boneCount; b++) {
      const distance = distanceToSegment(
        point,
        { x: bones[b].parentJoint.x, y: bones[b].parentJoint.y },
        { x: bones[b].childJoint.x, y: bones[b].childJoint.y },
      );
      scored[b] = 1 / (Math.pow(distance, FALLOFF) + EPSILON);
    }

    // Keep the TOP_K strongest, zero the rest, then normalize.
    const cutoff =
      boneCount <= TOP_K
        ? 0
        : Array.from(scored).sort((a, b) => b - a)[TOP_K - 1];

    let sum = 0;
    for (let b = 0; b < boneCount; b++) {
      if (scored[b] < cutoff) scored[b] = 0;
      sum += scored[b];
    }

    const base = v * boneCount;
    if (sum <= 0) {
      // Degenerate (every bone infinitely far): pin to the first bone rather
      // than emit a zero row, which would fail the normalization check.
      weights[base] = 1;
      continue;
    }
    for (let b = 0; b < boneCount; b++) weights[base + b] = scored[b] / sum;
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
