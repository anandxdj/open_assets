"""Row-major quad grid triangulation, shared by the lattice deformer.

Split out because the index arithmetic is easy to get subtly wrong (a
transposed row stride produces a mesh that still renders, just folded), and
because both kernels have to emit triangles in the same order for their
warp batches to line up row for row.
"""

from __future__ import annotations

import numpy as np

from .types import INDEX_DTYPE


class Grid:
    """Index helpers for an ``(nx + 1) x (ny + 1)`` vertex grid."""

    __slots__ = ()

    @staticmethod
    def triangulate(nx: int, ny: int) -> np.ndarray:
        """Two triangles per cell, row-major, returning (nx * ny * 2, 3) uint32.

        Cell ``(i, j)`` becomes ``(v00, v10, v11)`` then ``(v00, v11, v01)``.
        Both triangles wind the same way, so a frame with no flips reports
        zero flipped triangles rather than half of them.
        """

        stride = nx + 1
        tris = np.empty((nx * ny * 2, 3), dtype=INDEX_DTYPE)
        cursor = 0
        for j in range(ny):
            for i in range(nx):
                v00 = j * stride + i
                v10 = v00 + 1
                v01 = v00 + stride
                v11 = v01 + 1
                tris[cursor] = (v00, v10, v11)
                tris[cursor + 1] = (v00, v11, v01)
                cursor += 2
        return tris
