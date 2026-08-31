// The compositing contract, in one place, mirrored by the server.
//
// This module is mirrored value for value by the "Compositing" block of
// py_backend/app/modules/anibuddy/constants.py (RenderConstants). It is
// deliberately separate from EditorConstants: everything in that file is
// presentation policy this side of the wire is free to choose, and nothing in
// this one is. A constant that drifts between here and the Python file is a
// preview that disagrees with the export while every test stays green -- which
// is precisely what happened to `opacity`, for months, at 0 ULP of vertex
// parity.
//
// The canonical statement of the rule lives on `PartPose` in
// schemas/anibuddy/rig-document.v5.schema.json. It is short enough to restate:
// a compositing channel's REST value is the part's own authored field, and a
// key REPLACES it rather than scaling it.

export const CompositingConstants = Object.freeze({
  /**
   * `PartPose` channels that STEP rather than interpolate (F9 §7.7): there is
   * no meaningful halfway between two sprites, between shown and hidden, or
   * between two draw orders.
   */
  STEPPED_PART_CHANNELS: Object.freeze(["visible", "zIndex", "swapTo"] as const),

  /**
   * `PartPose` channels that interpolate at the compositing layer.
   *
   * The other four -- `rot`, `tx`, `ty`, `scale` -- are geometry and are not
   * listed here because this layer never touches them: `PoseTrack.partPoseAt`
   * samples them and the kernel's part transform tree applies them, which is
   * what makes the preview reproduce the export (R4).
   */
  INTERPOLATED_PART_CHANNELS: Object.freeze(["opacity"] as const),

  /**
   * Compositing channels whose REST value is a field on `Part` rather than a
   * constant. This tuple IS the rule: `Part.visible`, `Part.opacity` and
   * `Part.zIndex` are the rest values of the pose channels of the same name.
   *
   * There is deliberately no `REST_OPACITY` here. One existed on the server,
   * which blended against it and then multiplied the result by `Part.opacity`,
   * while this side treated the same field as a plain fallback used only when
   * neither bracketing key mentioned the channel. The two agreed on every part
   * authored at opacity 1 and disagreed on every other one.
   */
  PART_REST_CHANNELS: Object.freeze(["visible", "opacity", "zIndex"] as const),

  /**
   * `swapTo` is the one compositing channel with no static counterpart, so its
   * rest is stated rather than looked up: draw this part's own pixels.
   */
  REST_SWAP_TO: null,

  /** Resolved opacity is clamped into these bounds once, at the end of
   *  resolution, so neither the draw loop nor the shader has to. */
  OPACITY_MIN: 0,
  OPACITY_MAX: 1,

  /**
   * At or below this resolved opacity a layer contributes nothing and is
   * dropped from the composite. Named because the server applies the same cut
   * and a mismatch here is a layer that previews and does not export.
   */
  MIN_DRAWN_OPACITY: 0,

  /**
   * Texture remap `[scaleX, scaleY, offsetX, offsetY]`, sheet-normalized, for a
   * part drawing its own pixels. A `swapTo` replaces it with the affine that
   * carries this part's rect onto the target's; the identity is what every
   * other part gets, so the swap path and the ordinary path are one code path.
   */
  IDENTITY_UV_REMAP: Object.freeze([1, 1, 0, 0] as const),

  /**
   * Warning raised when a `swapTo` names a part this rig does not contain.
   *
   * A template rather than a formatted string at the call site, because the
   * compositing parity corpus compares the warnings the two implementations
   * emit, and a wording difference there is the cheapest possible early signal
   * that the two sides have stopped agreeing about what is unresolvable.
   */
  UNRESOLVED_SWAP_WARNING: (partId: string, swapTo: string): string =>
    `Part "${partId}" swaps to "${swapTo}", which is not a part of this rig; ` +
    "it was drawn as itself.",
});

export type CompositingConstantName = keyof typeof CompositingConstants;
