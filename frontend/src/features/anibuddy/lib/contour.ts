// Contour extraction and interior point sampling for AniBuddy meshes. These
// helpers use pixel coordinates; mesh.ts normalizes only at its public edge.

const ALPHA_FLOOR = 24;
const ROOT_TWO = Math.SQRT2;

type Point = number[];

type Alpha = Uint8Array | Uint8ClampedArray;

function alphaAt(alpha: Alpha, index: number, pixels: number): number {
  // AniBuddy passes ImageData.data (RGBA), while accepting a one-channel alpha
  // buffer here keeps these geometry helpers independently useful.
  return alpha.length >= pixels * 4 ? alpha[index * 4 + 3] : alpha[index];
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Marching-squares-style boundary trace at the shared alpha threshold. */
export function traceContours(alpha: Alpha, w: number, h: number): number[][][] {
  if (w <= 0 || h <= 0) return [];
  const pixels = w * h;
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && alphaAt(alpha, y * w + x, pixels) > ALPHA_FLOOR;

  // Every exposed pixel edge is a contour edge. With the figure on the right
  // of each directed edge, exterior rings wind clockwise in canvas coordinates
  // and holes wind in the opposite direction.
  const outgoing = new Map<string, Point[]>();
  const add = (from: Point, to: Point) => {
    const key = pointKey(from[0], from[1]);
    const edges = outgoing.get(key);
    if (edges) edges.push(to);
    else outgoing.set(key, [to]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y - 1)) add([x, y], [x + 1, y]);
      if (!solid(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!solid(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!solid(x - 1, y)) add([x, y + 1], [x, y]);
    }
  }

  const rings: number[][][] = [];
  const used = new Set<string>();
  const edgeKey = (from: Point, to: Point) => `${pointKey(from[0], from[1])}>${pointKey(to[0], to[1])}`;

  for (const [startKey, candidates] of outgoing) {
    const start = startKey.split(",").map(Number);
    for (const first of candidates) {
      if (used.has(edgeKey(start, first))) continue;
      const ring: Point[] = [start];
      let previous = start;
      let current = first;
      let guard = 0;

      while (guard++ <= pixels * 4) {
        used.add(edgeKey(previous, current));
        if (current[0] === start[0] && current[1] === start[1]) break;
        ring.push(current);
        const choices = (outgoing.get(pointKey(current[0], current[1])) ?? [])
          .filter((next) => !used.has(edgeKey(current, next)));
        if (choices.length === 0) break;

        // Diagonally touching components can offer two edges at a vertex. A
        // clockwise-most continuation preserves the current pixel component.
        const dx = current[0] - previous[0];
        const dy = current[1] - previous[1];
        choices.sort((a, b) => {
          const turnA = Math.atan2(dy * (a[0] - current[0]) - dx * (a[1] - current[1]), dx * (a[0] - current[0]) + dy * (a[1] - current[1]));
          const turnB = Math.atan2(dy * (b[0] - current[0]) - dx * (b[1] - current[1]), dx * (b[0] - current[0]) + dy * (b[1] - current[1]));
          return turnA - turnB;
        });
        previous = current;
        current = choices[0];
      }
      if (ring.length >= 3 && current[0] === start[0] && current[1] === start[1]) rings.push(ring);
    }
  }
  return rings;
}

function pointDistanceSq(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq));
  return (point[0] - (start[0] + t * dx)) ** 2 + (point[1] - (start[1] + t * dy)) ** 2;
}

function simplifyOpen(points: Point[], epsilonSq: number): Point[] {
  if (points.length <= 2) return points;
  let farthest = -1;
  let distance = epsilonSq;
  for (let index = 1; index < points.length - 1; index++) {
    const candidate = pointDistanceSq(points[index], points[0], points[points.length - 1]);
    if (candidate > distance) {
      distance = candidate;
      farthest = index;
    }
  }
  if (farthest < 0) return [points[0], points[points.length - 1]];
  return [...simplifyOpen(points.slice(0, farthest + 1), epsilonSq).slice(0, -1), ...simplifyOpen(points.slice(farthest), epsilonSq)];
}

/** Ramer–Douglas–Peucker simplification for an unclosed polygon ring. */
export function simplify(ring: number[][], epsilon: number): number[][] {
  if (ring.length <= 3) return ring.map((point) => [...point]);
  let split = 1;
  let farthest = -1;
  for (let index = 1; index < ring.length; index++) {
    const distance = (ring[index][0] - ring[0][0]) ** 2 + (ring[index][1] - ring[0][1]) ** 2;
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }
  const epsilonSq = epsilon * epsilon;
  const first = simplifyOpen([...ring.slice(0, split + 1), ring[0]], epsilonSq).slice(0, -1);
  const second = simplifyOpen([...ring.slice(split), ring[0]], epsilonSq).slice(0, -1);
  const result = [...first, ...second];
  return result.length >= 3 ? result.map((point) => [...point]) : ring.map((point) => [...point]);
}

/** Chamfer distance transform from every solid pixel to the nearest background. */
export function distanceTransform(alpha: Alpha, w: number, h: number): Float32Array {
  const count = Math.max(0, w * h);
  const dist = new Float32Array(count);
  const infinity = 1e9;
  for (let index = 0; index < count; index++) dist[index] = alphaAt(alpha, index, count) > ALPHA_FLOOR ? infinity : 0;

  const relax = (index: number, neighbour: number, cost: number) => {
    dist[index] = Math.min(dist[index], dist[neighbour] + cost);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const index = y * w + x;
    if (x > 0) relax(index, index - 1, 1);
    if (y > 0) relax(index, index - w, 1);
    if (x > 0 && y > 0) relax(index, index - w - 1, ROOT_TWO);
    if (x + 1 < w && y > 0) relax(index, index - w + 1, ROOT_TWO);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const index = y * w + x;
    if (x + 1 < w) relax(index, index + 1, 1);
    if (y + 1 < h) relax(index, index + w, 1);
    if (x + 1 < w && y + 1 < h) relax(index, index + w + 1, ROOT_TWO);
    if (x > 0 && y + 1 < h) relax(index, index + w - 1, ROOT_TWO);
  }
  return dist;
}

function insideRings(point: Point, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

/** Deterministic Poisson-ish samples; thin areas retain a tighter local pitch. */
export function samplePoints(rings: number[][][], dist: Float32Array, w: number, h: number, spacing: number): number[][] {
  if (rings.length === 0) return [];
  const points: Point[] = [];
  const cell = Math.max(2, spacing * 0.5);
  const grid = new Map<string, Point[]>();
  const localSpacing = (point: Point): number => {
    const x = Math.min(w - 1, Math.max(0, Math.round(point[0])));
    const y = Math.min(h - 1, Math.max(0, Math.round(point[1])));
    return Math.max(2, Math.min(spacing * 2, spacing * 0.55 + dist[y * w + x] * 0.25));
  };
  const gridKey = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  for (let y = cell / 2; y < h; y += cell) for (let x = cell / 2; x < w; x += cell) {
    // A tiny deterministic offset prevents a regular lattice from becoming a
    // visible deformation pattern while keeping reruns stable.
    const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const jitter = hash - Math.floor(hash) - 0.5;
    const candidate = [Math.max(0, Math.min(w - 1, x + jitter * cell * 0.45)), Math.max(0, Math.min(h - 1, y + (0.5 - jitter) * cell * 0.45))];
    if (!insideRings(candidate, rings)) continue;
    const pitch = localSpacing(candidate);
    const gx = Math.floor(candidate[0] / cell);
    const gy = Math.floor(candidate[1] / cell);
    let near = false;
    const range = Math.ceil((spacing * 2) / cell);
    for (let oy = -range; oy <= range && !near; oy++) for (let ox = -range; ox <= range && !near; ox++) {
      for (const other of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
        const minDistance = Math.min(pitch, localSpacing(other)) * 0.8;
        if ((candidate[0] - other[0]) ** 2 + (candidate[1] - other[1]) ** 2 < minDistance ** 2) { near = true; break; }
      }
    }
    if (near) continue;
    points.push(candidate);
    const key = gridKey(candidate[0], candidate[1]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(candidate); else grid.set(key, [candidate]);
  }
  return points;
}
