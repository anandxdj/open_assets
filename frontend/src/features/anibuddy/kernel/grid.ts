// Row-major quad grid triangulation, shared by the lattice deformer.
//
// Split out because the index arithmetic is easy to get subtly wrong (a
// transposed row stride produces a mesh that still renders, just folded), and
// because both kernels have to emit triangles in the same order for their warp
// batches to line up row for row.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/grid.py.

export const Grid = {
  /**
   * Two triangles per cell, row-major, over an (nx + 1) x (ny + 1) vertex grid.
   *
   * Cell (i, j) becomes (v00, v10, v11) then (v00, v11, v01). Both triangles
   * wind the same way, so a frame with no flips reports zero flipped triangles
   * rather than half of them.
   */
  triangulate(nx: number, ny: number): Uint32Array {
    const stride = nx + 1;
    const tris = new Uint32Array(nx * ny * 6);
    let cursor = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v00 = j * stride + i;
        const v10 = v00 + 1;
        const v01 = v00 + stride;
        const v11 = v01 + 1;
        tris[cursor] = v00;
        tris[cursor + 1] = v10;
        tris[cursor + 2] = v11;
        tris[cursor + 3] = v00;
        tris[cursor + 4] = v11;
        tris[cursor + 5] = v01;
        cursor += 6;
      }
    }
    return tris;
  },
} as const;
