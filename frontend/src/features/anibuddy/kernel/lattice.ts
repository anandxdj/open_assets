// Lattice (free-form) deformation over a quad control grid.
//
// New in v5; there is no v3 reference to port, so this design and the Python
// twin are the reference for each other.
//
// The rest lattice is a uniform (cols + 1) x (rows + 1) grid over the part's
// rectangle. Authoring MOVES control points; the deformer evaluates the surface
// those moved points define, then carries the whole result on the bound joint's
// transform so a lattice part still follows the skeleton.
//
// `controlPoints` are absolute part-local positions, which is the wire form
// verbatim -- see LatticeDeformer. Both the rest grid and the posed grid are
// therefore lifted into source pixels through the SAME expression, differing
// only in whether the part-local coordinate is the uniform (i / cols, j / rows)
// or the authored one. Writing it once means a lattice at rest is bit-identical
// to its own rest grid rather than merely close to it.
//
// Bilinear and bicubic differ only in how much the interior of a cell is
// allowed to curve:
//
// - Bilinear needs no subdivision. The rasterizer already draws each cell as
//   two affine-warped triangles, and an affine map across a quad IS the
//   bilinear interpolant along its edges, so subdividing would add vertices
//   that land exactly where the interpolation already puts them.
// - Bicubic curves inside the cell, and a flat triangle cannot represent that,
//   so each cell is subdivided LATTICE_BICUBIC_SUBDIV times per edge.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/lattice.py.

import { KernelConstants } from "./constants";
import { Curves } from "./curves";
import { Grid } from "./grid";
import { Skin } from "./skin";
import type { Asset, DeformedMesh, LatticeDeformer, Part, SolvedSkeleton } from "./types";

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function rectPixels(part: Part, asset: Asset): [number, number, number, number] {
  const rect = part.rect ?? KernelConstants.FULL_SHEET_RECT;
  return [
    rect[0] * asset.width,
    rect[1] * asset.height,
    rect[2] * asset.width,
    rect[3] * asset.height,
  ];
}

export const Lattice = {
  /**
   * Uniform control grid over the part rect, in SOURCE PIXELS.
   *
   * Flat row-major, stride 2, (rows + 1) * (cols + 1) points. The rect is
   * converted to pixels first and interpolated there, not interpolated in
   * normalized space and converted after: the two agree only on a square asset.
   */
  restControlGrid(part: Part, deformer: LatticeDeformer, asset: Asset): Float64Array {
    const [x0, y0, x1, y1] = rectPixels(part, asset);

    const grid = new Float64Array((deformer.rows + 1) * (deformer.cols + 1) * 2);
    let cursor = 0;
    for (let j = 0; j <= deformer.rows; j++) {
      const v = j / deformer.rows;
      for (let i = 0; i <= deformer.cols; i++) {
        const u = i / deformer.cols;
        grid[cursor] = x0 + (x1 - x0) * u;
        grid[cursor + 1] = y0 + (y1 - y0) * v;
        cursor += 2;
      }
    }
    return grid;
  },

  /**
   * Authored control points in pixels, then carried by the bound joint.
   *
   * The lift is `(x0 + u * (x1 - x0)) * width`, term for term the same as the
   * rest grid's and as PartTree.localToPixels. An authored point that equals its
   * rest coordinate therefore lands on exactly the same float as the rest grid
   * does, which is what makes an unedited lattice provably a no-op rather than
   * approximately one.
   */
  posedControlGrid(
    part: Part,
    deformer: LatticeDeformer,
    asset: Asset,
    skeleton: SolvedSkeleton,
  ): Float64Array {
    const [x0, y0, x1, y1] = rectPixels(part, asset);
    const control = deformer.controlPoints;
    const posed = new Float64Array(control.length);
    for (let index = 0; index < control.length; index += 2) {
      posed[index] = x0 + control[index] * (x1 - x0);
      posed[index + 1] = y0 + control[index + 1] * (y1 - y0);
    }
    // Applied unconditionally rather than skipped when the bound joint is at
    // rest. An identity affine is an exact no-op here (`x * 1 - y * 0 + 0` is
    // bit-identical to `x`), so the branch would buy nothing and cost a place
    // the two kernels could disagree about when to take it.
    return Skin.applyAffine(posed, Skin.bindTransform(skeleton, part));
  },

  /**
   * Evaluate the lattice to a posed triangle mesh in source pixels.
   *
   * Source and destination are evaluated through the SAME function -- the rest
   * control grid for one, the posed control grid for the other -- so a bicubic
   * part's texture coordinates curve in step with its geometry instead of
   * sliding across the artwork.
   */
  evaluate(
    part: Part,
    deformer: LatticeDeformer,
    asset: Asset,
    skeleton: SolvedSkeleton,
  ): DeformedMesh {
    const restGrid = Lattice.restControlGrid(part, deformer, asset);
    const posedGrid = Lattice.posedControlGrid(part, deformer, asset, skeleton);

    if (deformer.interpolation === "bicubic") {
      const subdiv = KernelConstants.LATTICE_BICUBIC_SUBDIV;
      const nx = deformer.cols * subdiv;
      const ny = deformer.rows * subdiv;
      return {
        srcVerts: Lattice.sampleBicubic(restGrid, deformer.cols, deformer.rows, nx, ny),
        dstVerts: Lattice.sampleBicubic(posedGrid, deformer.cols, deformer.rows, nx, ny),
        tris: Grid.triangulate(nx, ny),
      };
    }

    return {
      srcVerts: restGrid.slice(),
      dstVerts: posedGrid.slice(),
      tris: Grid.triangulate(deformer.cols, deformer.rows),
    };
  },

  /**
   * Sample the bicubic Catmull-Rom surface on an (nx + 1) x (ny + 1) grid.
   *
   * Loops are ordered row-major so the Python kernel can be read side by side
   * with this. Edge cells clamp their outer neighbours to the boundary control
   * point, which keeps the surface from flaring outward at the rim.
   */
  sampleBicubic(
    control: Float64Array,
    cols: number,
    rows: number,
    nx: number,
    ny: number,
  ): Float64Array {
    const stride = cols + 1;
    const out = new Float64Array((ny + 1) * (nx + 1) * 2);
    const columnX = [0, 0, 0, 0];
    const columnY = [0, 0, 0, 0];
    let cursor = 0;

    for (let jj = 0; jj <= ny; jj++) {
      const gy = (jj * rows) / ny;
      const cellY = Math.min(Math.floor(gy), rows - 1);
      const ty = gy - cellY;
      for (let ii = 0; ii <= nx; ii++) {
        const gx = (ii * cols) / nx;
        const cellX = Math.min(Math.floor(gx), cols - 1);
        const tx = gx - cellX;

        for (let rowOffset = -1; rowOffset < 3; rowOffset++) {
          const row = clamp(cellY + rowOffset, 0, rows);
          const p0 = clamp(cellX - 1, 0, cols);
          const p1 = clamp(cellX, 0, cols);
          const p2 = clamp(cellX + 1, 0, cols);
          const p3 = clamp(cellX + 2, 0, cols);
          const base = row * stride * 2;
          columnX[rowOffset + 1] = Curves.catmullRom(
            control[base + p0 * 2],
            control[base + p1 * 2],
            control[base + p2 * 2],
            control[base + p3 * 2],
            tx,
          );
          columnY[rowOffset + 1] = Curves.catmullRom(
            control[base + p0 * 2 + 1],
            control[base + p1 * 2 + 1],
            control[base + p2 * 2 + 1],
            control[base + p3 * 2 + 1],
            tx,
          );
        }

        out[cursor] = Curves.catmullRom(columnX[0], columnX[1], columnX[2], columnX[3], ty);
        out[cursor + 1] = Curves.catmullRom(columnY[0], columnY[1], columnY[2], columnY[3], ty);
        cursor += 2;
      }
    }
    return out;
  },
} as const;
