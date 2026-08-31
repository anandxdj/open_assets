// Picking joints and parts from a pointer position.
//
// Both tests run against the POSED geometry the kernel just produced, not against
// rest positions or bounding boxes. A limb that has been rotated 90 degrees is
// picked where it is drawn, which is the only behaviour that does not feel broken.
//
// `dstVerts` carries the part tree's world transform already, so the pointer is
// compared against them directly. Nothing is inverted on this side: a part
// dragged out of its parent's frame is picked at its drawn position because that
// IS the position the kernel reported.
//
// Parts are tested by point-in-triangle over the posed mesh rather than by
// rectangle, because a cutout's rect overlaps its neighbours by construction --
// that is what makes it a cutout -- and rect picking would make the part behind
// the arm unreachable.
//
// No alpha test. A pointer inside a transparent triangle of the head still picks
// the head, which is what a mesh-based editor conventionally does and which keeps
// picking independent of whether the sheet's pixels have been decoded yet.

import type { KernelFrame, PartGeometry } from "@/features/anibuddy/kernel/index.kernel";
import { EditorConstants } from "./editor.constants";
import type { ViewportTransform } from "./editor.types";
import { Viewport } from "./viewport";

/** Barycentric sign test. Inclusive of edges, so a shared edge always picks. */
function insideTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

export const HitTest = {
  /**
   * The joint handle under the pointer, or null.
   *
   * Distances are compared in CSS pixels, not source pixels, so the pick radius is
   * the same physical target on a 512px sheet and a 4096px one.
   */
  joint(
    frame: KernelFrame,
    transform: ViewportTransform,
    canvasX: number,
    canvasY: number,
  ): string | null {
    let best: string | null = null;
    let bestDistance: number = EditorConstants.JOINT_PICK_RADIUS_PX;
    for (const [jointId, position] of frame.skeleton.positions) {
      const point = Viewport.toCanvas(transform, position.x, position.y);
      const distance = Math.hypot(point.x - canvasX, point.y - canvasY);
      if (distance <= bestDistance) {
        best = jointId;
        bestDistance = distance;
      }
    }
    return best;
  },

  /**
   * The topmost part under the pointer, or null.
   *
   * Walks `order` -- literally the array the renderer drew, from
   * `PartTrack.compositeOrder` -- backwards, and returns the first hit: the part
   * drawn on top is the part the user is pointing at. It does not re-derive the
   * order, and it does not re-apply the visibility or opacity cut. Both were
   * decided once; a part that resolves hidden is simply absent from `order`, so
   * picking something you cannot see is impossible by construction rather than
   * by a filter that could disagree with the renderer's.
   */
  part(
    frame: KernelFrame,
    order: readonly string[],
    transform: ViewportTransform,
    canvasX: number,
    canvasY: number,
  ): string | null {
    const pointer = Viewport.toSheet(transform, canvasX, canvasY);
    const geometryById = new Map(frame.parts.map((entry) => [entry.partId, entry]));

    for (let index = order.length - 1; index >= 0; index--) {
      const part: PartGeometry | undefined = geometryById.get(order[index]);
      if (!part) continue;
      for (let triangle = 0; triangle < part.tris.length; triangle += 3) {
        const a = part.tris[triangle] * 2;
        const b = part.tris[triangle + 1] * 2;
        const c = part.tris[triangle + 2] * 2;
        if (
          insideTriangle(
            pointer.x,
            pointer.y,
            part.dstVerts[a],
            part.dstVerts[a + 1],
            part.dstVerts[b],
            part.dstVerts[b + 1],
            part.dstVerts[c],
            part.dstVerts[c + 1],
          )
        ) {
          return part.partId;
        }
      }
    }
    return null;
  },
} as const;
