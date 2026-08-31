"""``PartPose`` compositing-channel sampling, mirrored by the browser.

Why only half of ``PartPose`` is here
-------------------------------------
``PartPose`` carries eight channels and they split by responsibility:

* ``visible``, ``opacity``, ``zIndex``, ``swapTo`` are **compositing**. They
  decide which layers are drawn, in what order, how strongly, and out of whose
  pixels. No vertex moves. Rasterization is deliberately per-target (R4), so
  they belong on the rasterizer's side of the line and are resolved here.
* ``rot``, ``tx``, ``ty``, ``scale`` are **geometry**. Honouring them means
  moving vertices, which is exactly the math R4 requires to live in one place
  reproduced in two targets — so they live in the kernel, sampled by
  ``PoseTrack.part_pose_at`` and applied by the part transform tree in
  ``kernel/parts.py``. This module never sees them.

The line between the two halves is the same line R4 draws everywhere else:
vertex math is shared, rasterization is not.

But "rasterization is not shared" was read too widely once, and it cost us
-------------------------------------------------------------------------
Compositing is per-target. Deciding WHAT to composite is not. This module is
the twin of ``frontend/src/features/anibuddy/editor/part-track.ts``: the two
resolve the same four channels from the same document to the same values, and
the fixture corpus in ``fixtures/anibuddy-compositing/`` is what enforces it.

That corpus exists because the vertex-parity corpus structurally cannot see
this file. It compares geometry, and every divergence here is invisible in
geometry: the two implementations disagreed for months about whether
``Part.opacity`` was a rest value or a gain, and about whether ``swapTo``
substituted a part's pixels or its whole posed self, while the kernels agreed
at 0 ULP across seventeen fixtures and always would have.

The rule, stated once
---------------------
The canonical statement is on ``PartPose`` in
``schemas/anibuddy/rig-document.v5.schema.json``. In short:

**A compositing channel's REST value is the part's own authored field, and a
key REPLACES it rather than scaling it.** ``Part.visible``, ``Part.opacity`` and
``Part.zIndex`` ARE the rest values of the pose channels of the same name, in
exactly the sense 0 is the rest value of ``rot``. So a channel absent from both
bracketing keys leaves the part as authored; a channel present in only one of
them blends against the part's authored value, not against a schema-wide
constant; and a resolved opacity is never multiplied by ``Part.opacity``.

The alternative reading — ``Part.opacity`` as a static gain the pose modulates —
was the server's until this module was rewritten. It loses on two counts. It
would make ``opacity`` the only channel in the schema whose static field is a
gain rather than a rest, breaking the symmetry with ``visible`` and ``zIndex``
which have never been anything but rests. And it makes a part authored
translucent permanently translucent: no keyframe can drive it to 1, because
every resolved value is scaled back down.

Sparsity and stepping
---------------------
Same rule as ``JointPose``, because inconsistency between the two would be worse
than either choice: absent means REST, not "hold whatever the previous key
left". The bracketing search is not mirrored here, it is *called*:
``PoseTrack.bracket_index`` is the one search both halves of a ``PartPose`` go
through, so a part's opacity and its rotation, sampled from the same clip by two
different modules, cannot land on different keys.

Stepped channels take the earlier bracketing key's value, which is the same
thing as interpolating with ``u`` pinned to 0. That is why ``ease: "hold"``
needs no special case here: it already pins ``u`` to 0 for everything.
"""

from __future__ import annotations

from typing import List, Mapping, Optional, Protocol, Sequence, Tuple

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.kernel import PoseTrack
from app.modules.anibuddy.render.types import PartComposite


# --- Structural inputs ------------------------------------------------------
#
# Typed as protocols rather than as the wire models on purpose. The wire ``Part``
# carries a mask, a deformer, a provenance record and a confidence score, none of
# which decide a single thing in this file — and requiring them would mean the
# parity corpus had to author a whole valid ``RigDocument`` per case just to say
# "a part at opacity 0.5". What this module reads IS the contract, so the
# contract is what it declares.


class CompositingRect(Protocol):
    """A part's crop on the sheet, sheet-normalized (R6)."""

    x: float
    y: float
    width: float
    height: float


class CompositingPart(Protocol):
    """The four fields of a ``Part`` that compositing reads, plus its crop."""

    id: str
    visible: bool
    opacity: float
    zIndex: int
    rect: CompositingRect


class CompositingPose(Protocol):
    """The four ``PartPose`` channels that compositing reads. All optional."""

    visible: Optional[bool]
    opacity: Optional[float]
    zIndex: Optional[int]
    swapTo: Optional[str]


class CompositingKey(Protocol):
    """A keyframe, as this module reads it: a time, an easing, and part poses."""

    t: float
    ease: Optional[str]
    parts: Mapping[str, CompositingPose]


class CompositingClip(Protocol):
    """A clip, as this module reads it."""

    loop: bool
    keyframes: Sequence[CompositingKey]


class ResolvedPartPose:
    """One part's compositing channels at one time.

    A plain mutable holder rather than a frozen dataclass: it is built field by
    field as each channel resolves.
    """

    __slots__ = ("visible", "opacity", "z_index", "swap_to")

    def __init__(self, *, visible: bool, opacity: float, z_index: int) -> None:
        self.visible = visible
        self.opacity = opacity
        self.z_index = z_index
        self.swap_to: Optional[str] = RenderConstants.REST_SWAP_TO


class PartPoseTrack:
    """Sample ``Keyframe.parts`` into a per-frame composite order."""

    __slots__ = ()

    @staticmethod
    def rest_pose(part: CompositingPart) -> ResolvedPartPose:
        """The part's compositing state before any clip is applied.

        This function is the rule. ``Part.visible``, ``Part.opacity`` and
        ``Part.zIndex`` are read here as REST VALUES, not as gains, defaults or
        hints, and nothing downstream multiplies them back in. Mirrored by
        ``PartTrack.restPose`` in the browser.
        """
        return ResolvedPartPose(
            visible=bool(part.visible),
            opacity=float(part.opacity),
            z_index=int(part.zIndex),
        )

    @staticmethod
    def resolve(
        part: CompositingPart,
        keys: Sequence[CompositingKey],
        loop: bool,
        time: float,
    ) -> ResolvedPartPose:
        """One part's compositing channels at normalized ``time``.

        Keys and ``loop`` rather than a clip so a caller with no clip passes an
        empty sequence instead of threading a ``None`` through every branch.
        """
        resolved = PartPoseTrack.rest_pose(part)
        if not keys:
            return resolved

        found = PoseTrack.bracket_index(keys, loop, time)
        start: Optional[CompositingPose] = keys[found.before_index].parts.get(part.id)
        end: Optional[CompositingPose] = (
            None
            if found.after_index is None
            else keys[found.after_index].parts.get(part.id)
        )

        # Stepped channels: the earlier key's value, or rest when it is silent.
        # No blend, because there is no meaningful halfway between shown and
        # hidden, between two draw orders, or between two sprites (F9 §7.7).
        # Each is tested for presence individually — assigning the whole pose
        # would write a rest value over a rest value, which reads as intent.
        if start is not None:
            if start.visible is not None:
                resolved.visible = bool(start.visible)
            if start.zIndex is not None:
                resolved.z_index = int(start.zIndex)
            if start.swapTo is not None:
                resolved.swap_to = start.swapTo

        # Interpolated channels: blend against the part's own REST value when a
        # channel is present on only one side, never against the other side's
        # value and never against a schema-wide constant. Written as
        # ``a + (b - a) * u`` to match the kernel's own form; the two differ in
        # the last bit and a visible opacity ramp should not depend on which one
        # a reader reached for.
        start_opacity = None if start is None else start.opacity
        end_opacity = None if end is None else end.opacity
        if start_opacity is not None or end_opacity is not None:
            rest = float(part.opacity)
            a = rest if start_opacity is None else float(start_opacity)
            b = rest if end_opacity is None else float(end_opacity)
            resolved.opacity = a + (b - a) * found.u

        return resolved

    @staticmethod
    def uv_remap(
        source: CompositingPart, target: CompositingPart
    ) -> Tuple[float, float, float, float]:
        """Texture remap that samples ``target``'s rect through ``source``'s.

        Sheet-normalized, so it is the same four numbers the browser's shader
        takes and the same four the parity corpus compares. Both parts crop the
        same sheet, so the substitution is affine in that space:

            uv' = uv * (targetSize / sourceSize)
                     + (targetOrigin - sourceOrigin * scale)

        A zero-width or zero-height source rect cannot define a ratio, so that
        axis falls back to 1 rather than producing an infinity that would smear
        one texel across the whole layer.
        """
        scale_x = (
            RenderConstants.IDENTITY_UV_REMAP[0]
            if source.rect.width == 0
            else float(target.rect.width) / float(source.rect.width)
        )
        scale_y = (
            RenderConstants.IDENTITY_UV_REMAP[1]
            if source.rect.height == 0
            else float(target.rect.height) / float(source.rect.height)
        )
        return (
            scale_x,
            scale_y,
            float(target.rect.x) - float(source.rect.x) * scale_x,
            float(target.rect.y) - float(source.rect.y) * scale_y,
        )

    @staticmethod
    def composite_order(
        parts: Sequence[CompositingPart],
        clip: Optional[CompositingClip],
        time: float,
        warn,
    ) -> List[PartComposite]:
        """Which layers to draw at ``time``, in back-to-front order.

        ``swapTo`` semantics, stated because the schema names the field and this
        is where the field becomes a draw call. The v4 track type it absorbs is a
        sprite swap: at this moment, show a different cutout in this layer's
        place. It is implemented as a substitution of PIXELS ONLY — the referring
        part keeps its geometry, its deformer, its parent chain, its opacity and
        its draw order, and only the texture coordinates are remapped onto the
        target's rect.

        This module used to substitute the target's whole posed part instead,
        which the browser never did. That reading is wrong on its own terms, not
        merely divergent: a swap would silently re-parent and re-deform the
        layer, so a mouth cutout swapped mid-clip would stop following the head;
        and in any frame where the target is also drawn as itself, its mesh would
        be composited twice, which double-darkens premultiplied alpha along
        every shared edge.

        Sorting is stable on ``(zIndex, document order)``. Document order breaks
        the tie rather than part id, because two parts sharing a z-index is a
        legitimate authoring state and the artist's list order is the only
        signal about which they meant to be in front.
        """
        keys: Sequence[CompositingKey] = () if clip is None else clip.keyframes
        loop = False if clip is None else bool(clip.loop)
        by_id = {part.id: part for part in parts}
        entries: List[PartComposite] = []

        for order, part in enumerate(parts):
            resolved = PartPoseTrack.resolve(part, keys, loop, time)
            if not resolved.visible:
                continue
            opacity = min(
                RenderConstants.OPACITY_MAX,
                max(RenderConstants.OPACITY_MIN, resolved.opacity),
            )
            if opacity <= RenderConstants.MIN_DRAWN_OPACITY:
                continue

            texture_id = part.id
            remap = RenderConstants.IDENTITY_UV_REMAP
            if resolved.swap_to is not None:
                target = by_id.get(resolved.swap_to)
                if target is None:
                    warn(
                        RenderConstants.UNRESOLVED_SWAP_WARNING.format(
                            part_id=part.id, swap_to=resolved.swap_to
                        )
                    )
                else:
                    texture_id = target.id
                    remap = PartPoseTrack.uv_remap(part, target)

            entries.append(
                PartComposite(
                    part_id=part.id,
                    texture_part_id=texture_id,
                    uv_remap=remap,
                    z_index=resolved.z_index,
                    opacity=opacity,
                    order=order,
                )
            )

        entries.sort(key=lambda entry: (entry.z_index, entry.order))
        return entries

    @staticmethod
    def sample(
        parts: Sequence[CompositingPart],
        clip: Optional[CompositingClip],
        times: Sequence[float],
        warn,
    ) -> List[List[PartComposite]]:
        """Composite order for every frame of a clip.

        Sampled up front rather than per frame inside the rasterizer so the
        channel semantics are testable without a pixel buffer — which is exactly
        what the compositing parity corpus does with it.
        """
        return [
            PartPoseTrack.composite_order(parts, clip, time, warn) for time in times
        ]
