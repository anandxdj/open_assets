// Per-part draw state, and the frame's distortion report.
//
// Sits between the kernel's output and the renderer's inputs: it turns resolved
// PartPose channels into the opacity, draw order and texture remap the shader
// takes, and it reads the kernel's own warp report back out rather than
// recomputing any of it.
//
// COMPOSITING ONLY. There is no per-part matrix here any more: `rot`, `tx`, `ty`
// and `scale` are handed to `AniBuddyKernel.evaluate`, which composes the part's
// whole parent chain and bakes the world transform into `dstVerts` (kernel
// parts.ts). A matrix built on this side could only re-apply what is already
// baked in, and could only ever describe a root part.
//
// The sprite-swap channel is worth naming, because it looks like it should need a
// second texture and does not. `swapTo` names another part whose pixels replace
// this one's; both parts crop the same sheet through `Part.rect`, so the swap is a
// remap of texture coordinates from one rect onto another. Geometry, deformer and
// draw order all stay this part's -- which is exactly what the v4 sprite-swap track
// meant, and why folding it into a channel cost nothing (F9 §4).
//
// Neither the channel resolution nor the remap is computed here any more. Both
// come from `PartTrack.compositeOrder`, which is the twin of the server's
// `PartPoseTrack.composite_order` and is held to it by the compositing parity
// corpus. This module's job is what is genuinely browser-only: which parts get
// tinted, and what the frame's distortion report says.

import { ANIBUDDY_LIMITS } from "@/features/anibuddy/rig/index.rig";
import type { Part } from "@/features/anibuddy/rig/index.rig";
import type { KernelFrame } from "@/features/anibuddy/kernel/index.kernel";
import { EditorConstants } from "./editor.constants";
import type {
  DistortionReport,
  EditorSelection,
  PartComposite,
} from "./editor.types";
import type { PartDrawState } from "./gl-renderer";

export const DrawState = {
  /**
   * The frame's distortion, read straight off the kernel's own warp report.
   *
   * Nothing is recomputed here. `maxStretch` and `flippedTriangles` are the
   * sigmaMax/sigmaMin metering the kernel already performed, and re-deriving them on
   * this side would produce a second number that can disagree with the server's for
   * no benefit (R12).
   */
  reportOf(frame: KernelFrame): DistortionReport {
    const report = DrawState.empty();
    for (const geometry of frame.parts) {
      if (geometry.warp.maxStretch > report.maxStretch) {
        report.maxStretch = geometry.warp.maxStretch;
        report.worstPartId = geometry.partId;
      }
      report.flippedTriangles += geometry.warp.flippedTriangles;
      report.degenerateTriangles += geometry.warp.degenerateTriangles;
    }
    return report;
  },

  /**
   * Build the renderer's per-part state, its draw order, and the distortion report.
   *
   * `composites` decides which parts draw, out of whose pixels, and in what
   * order; this function only adds the tint, which is the one genuinely
   * browser-only thing about a layer. `order` is returned rather than left to
   * the renderer to derive, so the preview obeys exactly the order the parity
   * corpus checked.
   *
   * The report is read straight off `PartGeometry.warp`, which the kernel filled
   * in. Distortion is surfaced rather than smoothed over: a frame that ships
   * smeared or folded artwork with no indication is the failure v3 avoided by
   * showing the problem, and that behaviour carries forward (F9 §8.5).
   */
  build(input: {
    frame: KernelFrame;
    partsById: ReadonlyMap<string, Part>;
    composites: readonly PartComposite[];
    selection: EditorSelection;
  }): {
    states: Map<string, PartDrawState>;
    order: readonly string[];
    report: DistortionReport;
  } {
    const states = new Map<string, PartDrawState>();
    const report = DrawState.reportOf(input.frame);
    const geometryById = new Map(input.frame.parts.map((part) => [part.partId, part]));
    const order: string[] = [];

    for (const composite of input.composites) {
      const geometry = geometryById.get(composite.partId);
      if (!geometry) continue;
      if (!input.partsById.has(composite.partId)) continue;
      const selected =
        input.selection.kind === "part" && input.selection.id === composite.partId;

      // Distortion outranks selection. A tinted selection that hides a folded
      // triangle trades a problem the user must see for feedback they already have
      // from the inspector.
      const tint =
        geometry.warp.flippedTriangles > 0
          ? EditorConstants.TINT.flipped
          : geometry.warp.maxStretch > ANIBUDDY_LIMITS.STRETCH_WARNING
            ? EditorConstants.TINT.stretched
            : selected
              ? EditorConstants.TINT.selected
              : EditorConstants.TINT.none;

      states.set(composite.partId, {
        opacity: composite.opacity,
        zIndex: composite.zIndex,
        uvRemap: composite.uvRemap,
        tint,
      });
      order.push(composite.partId);
    }

    return { states, order, report };
  },

  /** Worst case of two reports, keeping whichever part owns the worse stretch. */
  merge(left: DistortionReport, right: DistortionReport): DistortionReport {
    const worse = right.maxStretch > left.maxStretch ? right : left;
    return {
      maxStretch: worse.maxStretch,
      flippedTriangles: Math.max(left.flippedTriangles, right.flippedTriangles),
      degenerateTriangles: Math.max(left.degenerateTriangles, right.degenerateTriangles),
      worstPartId: worse.worstPartId,
    };
  },

  /** A clean report: undistorted, nothing folded. */
  empty(): DistortionReport {
    return { maxStretch: 1, flippedTriangles: 0, degenerateTriangles: 0, worstPartId: null };
  },
} as const;
