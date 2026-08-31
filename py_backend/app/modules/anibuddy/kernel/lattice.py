"""Lattice (free-form) deformation over a quad control grid.

New in v5; there is no v3 browser reference to port, so this design is the
reference and the TypeScript kernel mirrors it.

The rest lattice is a uniform ``(cols + 1) x (rows + 1)`` grid over the part's
rectangle. Authoring MOVES control points; the deformer evaluates the surface
those moved points define, then carries the whole result on the bound joint's
transform so a lattice part still follows the skeleton.

``control_points`` are absolute part-local positions, which is the wire form
verbatim -- see ``LatticeDeformer``. Both the rest grid and the posed grid are
therefore lifted into source pixels through the SAME expression, differing only
in whether the part-local coordinate is the uniform ``(i / cols, j / rows)`` or
the authored one. Writing it once means a lattice at rest is bit-identical to
its own rest grid rather than merely close to it.

Bilinear and bicubic differ only in how much the interior of a cell is
allowed to curve:

* Bilinear needs no subdivision. The rasterizer already draws each cell as two
  affine-warped triangles, and an affine map across a quad IS the bilinear
  interpolant along its edges, so subdividing would add vertices that land
  exactly where the interpolation already puts them.
* Bicubic curves inside the cell, and a flat triangle cannot represent that,
  so each cell is subdivided ``LATTICE_BICUBIC_SUBDIV`` times per edge.
"""

from __future__ import annotations

import numpy as np

from .constants import KernelConstants
from .curves import Curves
from .grid import Grid
from .skin import Skin
from .types import Asset, LatticeDeformer, Part, SolvedSkeleton


class Lattice:
    """Lattice evaluation. Pure; takes control points, returns a mesh."""

    __slots__ = ()

    @staticmethod
    def rest_control_grid(
        part: Part, deformer: LatticeDeformer, asset: Asset
    ) -> np.ndarray:
        """Uniform control grid over the part rect, in SOURCE PIXELS.

        Shape ``(rows + 1, cols + 1, 2)``. The rect is converted to pixels
        first and interpolated there, not interpolated in normalized space and
        converted after: the two agree only on a square asset.
        """

        width = float(asset.width)
        height = float(asset.height)
        x0 = part.rect[0] * width
        y0 = part.rect[1] * height
        x1 = part.rect[2] * width
        y1 = part.rect[3] * height

        grid = np.empty((deformer.rows + 1, deformer.cols + 1, 2), dtype=np.float64)
        for j in range(deformer.rows + 1):
            v = j / deformer.rows
            for i in range(deformer.cols + 1):
                u = i / deformer.cols
                grid[j, i, 0] = x0 + (x1 - x0) * u
                grid[j, i, 1] = y0 + (y1 - y0) * v
        return grid

    @staticmethod
    def posed_control_grid(
        part: Part,
        deformer: LatticeDeformer,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> np.ndarray:
        """Authored control points in pixels, then carried by the bound joint.

        The lift is ``(x0 + u * (x1 - x0)) * width``, term for term the same as
        the rest grid's and as ``PartTree.local_to_pixels``. An authored point
        that equals its rest coordinate therefore lands on exactly the same
        float as the rest grid does, which is what makes an unedited lattice
        provably a no-op rather than approximately one.
        """

        control = np.asarray(deformer.control_points, dtype=np.float64)
        width = float(asset.width)
        height = float(asset.height)
        x0 = part.rect[0] * width
        y0 = part.rect[1] * height
        x1 = part.rect[2] * width
        y1 = part.rect[3] * height

        posed = np.empty_like(control)
        posed[:, :, 0] = x0 + control[:, :, 0] * (x1 - x0)
        posed[:, :, 1] = y0 + control[:, :, 1] * (y1 - y0)

        # Applied unconditionally rather than skipped when the bound joint is at
        # rest. An identity affine is an exact no-op here (``x * 1 - y * 0 + 0``
        # is bit-identical to ``x``), so the branch would buy nothing and cost a
        # place the two kernels could disagree about when to take it.
        flat = posed.reshape(-1, 2)
        transform = Skin.bind_transform(skeleton, part)
        return Skin.apply_affine(flat, transform).reshape(posed.shape)

    @staticmethod
    def evaluate(
        part: Part,
        deformer: LatticeDeformer,
        asset: Asset,
        skeleton: SolvedSkeleton,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Return ``(src_verts, dst_verts, tris)`` in source pixels, float64.

        Source and destination are evaluated through the SAME function -- the
        rest control grid for one, the posed control grid for the other -- so
        a bicubic part's texture coordinates curve in step with its geometry
        instead of sliding across the artwork.
        """

        rest_grid = Lattice.rest_control_grid(part, deformer, asset)
        posed_grid = Lattice.posed_control_grid(part, deformer, asset, skeleton)

        if deformer.interpolation == "bicubic":
            subdiv = KernelConstants.LATTICE_BICUBIC_SUBDIV
            nx = deformer.cols * subdiv
            ny = deformer.rows * subdiv
            src = Lattice._sample_bicubic(rest_grid, deformer.cols, deformer.rows, nx, ny)
            dst = Lattice._sample_bicubic(posed_grid, deformer.cols, deformer.rows, nx, ny)
            return src, dst, Grid.triangulate(nx, ny)

        src = rest_grid.reshape(-1, 2).copy()
        dst = posed_grid.reshape(-1, 2).copy()
        return src, dst, Grid.triangulate(deformer.cols, deformer.rows)

    @staticmethod
    def _sample_bicubic(
        control: np.ndarray,
        cols: int,
        rows: int,
        nx: int,
        ny: int,
    ) -> np.ndarray:
        """Sample the bicubic Catmull-Rom surface on an ``(nx + 1) x (ny + 1)`` grid.

        Loops are scalar and ordered row-major so the TypeScript kernel can be
        read side by side with this. Edge cells clamp their outer neighbours to
        the boundary control point, which keeps the surface from flaring
        outward at the rim.
        """

        out = np.empty(((ny + 1) * (nx + 1), 2), dtype=np.float64)
        cursor = 0
        for jj in range(ny + 1):
            gy = (jj * rows) / ny
            cell_y = min(int(gy), rows - 1)
            ty = gy - cell_y
            for ii in range(nx + 1):
                gx = (ii * cols) / nx
                cell_x = min(int(gx), cols - 1)
                tx = gx - cell_x

                column_x = [0.0, 0.0, 0.0, 0.0]
                column_y = [0.0, 0.0, 0.0, 0.0]
                for row_offset in range(-1, 3):
                    row = _clamp(cell_y + row_offset, 0, rows)
                    p0 = _clamp(cell_x - 1, 0, cols)
                    p1 = _clamp(cell_x, 0, cols)
                    p2 = _clamp(cell_x + 1, 0, cols)
                    p3 = _clamp(cell_x + 2, 0, cols)
                    column_x[row_offset + 1] = Curves.catmull_rom(
                        control[row, p0, 0],
                        control[row, p1, 0],
                        control[row, p2, 0],
                        control[row, p3, 0],
                        tx,
                    )
                    column_y[row_offset + 1] = Curves.catmull_rom(
                        control[row, p0, 1],
                        control[row, p1, 1],
                        control[row, p2, 1],
                        control[row, p3, 1],
                        tx,
                    )
                x_value = Curves.catmull_rom(
                    column_x[0], column_x[1], column_x[2], column_x[3], ty
                )
                y_value = Curves.catmull_rom(
                    column_y[0], column_y[1], column_y[2], column_y[3], ty
                )
                out[cursor, 0] = x_value
                out[cursor, 1] = y_value
                cursor += 1
        return out


def _clamp(value: int, low: int, high: int) -> int:
    return low if value < low else (high if value > high else value)
