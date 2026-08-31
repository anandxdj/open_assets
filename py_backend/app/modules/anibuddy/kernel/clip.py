"""Keyframe interpolation.

Ported from ``frontend/src/features/anibuddy/lib/clip.ts`` ``poseAt``.

Poses are sparse in two dimensions at once: a keyframe names only the joints
it moves, and a named joint carries only the channels it changes. Both kinds
of absence resolve to REST, not to "hold the neighbouring value" -- a key that
only sets ``rot`` must not pin ``scale`` to whatever the previous key
happened to leave it at.

The same is true of PARTS, and identically so. ``bracket`` and ``blend`` are
shared by ``pose_at`` and ``part_pose_at`` rather than written twice, because
a part and a joint keyed on the same clip must resolve at the same instant,
with the same easing, against the same rest values. Two copies of that rule
would be two chances to disagree about it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence

from .constants import KernelConstants
from .types import Clip, EaseKind, JointPose, Keyframe, PartPoseMap, Pose


class BracketableKey(Protocol):
    """The only two fields the bracketing search reads off a keyframe.

    Declared as a protocol rather than as the kernel's own ``Keyframe`` because
    the compositing channels are sampled from the WIRE ``Keyframe`` at the
    render layer, which is a different class carrying the same two fields. One
    structural contract is what lets both call ``PoseTrack.bracket_index``
    instead of each keeping a copy of the search — and a copy is exactly how a
    part's opacity and its rotation, sampled from the same clip, end up on
    different keys.
    """

    t: float
    ease: EaseKind | None


@dataclass(frozen=True, slots=True)
class KeyBracket:
    """Which two keys surround a time, and how far between them it sits.

    Indices rather than keyframes so the caller can index into whichever
    keyframe type it holds. ``wrapped`` marks the looping case, where
    ``after_index`` is key 0 read one full cycle later — the caller needs to
    know that to report the after key's time, and nothing else about it
    differs.
    """

    before_index: int
    after_index: int | None
    u: float
    wrapped: bool


class PoseTrack:
    """Clip sampling. Pure; no state between calls."""

    __slots__ = ()

    @staticmethod
    def rest_value(channel: str) -> float:
        """Rest for a channel: 1 for ``scale``, 0 for everything else."""

        return (
            KernelConstants.REST_SCALE
            if channel == "scale"
            else KernelConstants.REST_DEFAULT
        )

    @staticmethod
    def ease(u: float, kind: EaseKind | None) -> float:
        """Map normalized segment progress through the easing curve.

        ``hold`` returns 0 for the whole segment, so the pose stays on the
        starting key and snaps at the next one -- that is what makes stepped
        animation possible without a separate keyframe type.

        An absent ``ease`` is smoothstep, not linear. That is the v3 browser
        default and changing it would silently re-time every existing clip.
        """

        if kind == "linear":
            return u
        if kind == "hold":
            return 0.0
        return u * u * (3.0 - 2.0 * u)

    @staticmethod
    def bracket_index(
        keys: Sequence[BracketableKey], loop: bool, time: float
    ) -> KeyBracket:
        """The two keys bracketing ``t``, plus eased progress between them.

        THE bracketing search. Every channel of every kind — a joint's ``rot``,
        a part's ``scale``, a part's ``opacity``, its ``visible``, its
        ``zIndex``, its ``swapTo`` — resolves through this one function, in both
        the browser and the server. That is not tidiness: a part's opacity and
        its rotation, sampled from the same clip at the same instant by two
        different modules, must land on the same pair of keys, and the only way
        to guarantee that is for there to be one search.

        Indices rather than keyframes because the geometry channels are sampled
        from the kernel's own ``Keyframe`` and the compositing channels from the
        WIRE ``Keyframe``. The two carry the same ``t`` and ``ease`` and nothing
        else this function reads, so it is typed on that pair alone.

        The search walks the keyframes in order rather than binary-searching,
        matching the browser exactly: ``before`` is the last key at or before
        ``t``, ``after`` the first strictly after it, both compared with
        ``KEYFRAME_EPSILON`` slack so a key authored at 0.3 is actually
        reachable at t = 0.3.

        A looping clip with no key after ``t`` closes back onto key 0, read one
        full cycle later, which lets the artist skip authoring a duplicate final
        key. ``wrapped`` marks that case; the returned ``after_index`` is 0 and
        ``u`` already accounts for the extra cycle in the span.
        """

        t = max(0.0, min(1.0, time))
        before_index = 0
        after_index: int | None = None
        for index, key in enumerate(keys):
            if key.t <= t + KernelConstants.KEYFRAME_EPSILON:
                before_index = index
            if key.t > t + KernelConstants.KEYFRAME_EPSILON:
                after_index = index
                break

        before_t = keys[before_index].t
        wrapped = False
        if after_index is not None:
            after_t = keys[after_index].t
        elif loop and len(keys) > 1:
            after_index = 0
            after_t = keys[0].t + 1.0
            wrapped = True
        else:
            return KeyBracket(before_index, None, 0.0, False)

        span = after_t - before_t
        u = (
            0.0
            if span <= KernelConstants.KEYFRAME_EPSILON
            else PoseTrack.ease((t - before_t) / span, keys[before_index].ease)
        )
        return KeyBracket(before_index, after_index, u, wrapped)

    @staticmethod
    def bracket(clip: Clip, time: float) -> tuple[Keyframe, Keyframe | None, float]:
        """``bracket_index`` resolved into the kernel's own keyframes.

        A thin adapter, not a second search. The looping case is materialized as
        a copy of key 0 moved to ``t + 1`` so a caller reading ``after.t`` sees
        the instant the blend actually ran to; the copy carries key 0's PARTS as
        well as its joints, so a part and a joint keyframed together wrap
        together.
        """

        keys = clip.keyframes
        found = PoseTrack.bracket_index(keys, clip.loop, time)
        before = keys[found.before_index]
        if found.after_index is None:
            return before, None, found.u
        after = keys[found.after_index]
        if found.wrapped:
            after = Keyframe(
                t=after.t + 1.0,
                joints=after.joints,
                parts=after.parts,
                ease=after.ease,
            )
        return before, after, found.u

    @staticmethod
    def blend(start_map: Pose, end_map: Pose, u: float) -> Pose:
        """Per-channel blend of two sparse pose mappings.

        Shared verbatim by the joint and the part channels, which is what makes
        their sparsity rules identical by construction rather than by review: a
        channel absent from one side blends against REST, never against the
        other side's value.
        """

        # Union of ids in first-seen order: ``start_map`` first, then any id
        # only ``end_map`` touches. Order does not affect the numbers -- the
        # consumers walk the skeleton and the part tree, not the pose -- but
        # keeping it identical to the browser keeps serialized poses diffable.
        ids: list[str] = list(start_map.keys())
        seen = set(ids)
        for target_id in end_map.keys():
            if target_id not in seen:
                seen.add(target_id)
                ids.append(target_id)

        pose: Pose = {}
        for target_id in ids:
            start = start_map.get(target_id)
            end = end_map.get(target_id)
            values: dict[str, float] = {}
            for channel in KernelConstants.POSE_CHANNELS:
                start_value = None if start is None else start.channel(channel)
                end_value = None if end is None else end.channel(channel)
                if start_value is None and end_value is None:
                    continue
                rest = PoseTrack.rest_value(channel)
                a = rest if start_value is None else start_value
                b = rest if end_value is None else end_value
                # Written as a + (b - a) * u, not (1 - u) * a + u * b. The two
                # differ in the last bit and the browser uses this form.
                values[channel] = a + (b - a) * u
            if values:
                pose[target_id] = JointPose(
                    rot=values.get("rot"),
                    tx=values.get("tx"),
                    ty=values.get("ty"),
                    scale=values.get("scale"),
                )
        return pose

    @staticmethod
    def pose_at(clip: Clip, time: float) -> Pose:
        """Resolve a clip to its sparse local JOINT pose at normalized time."""

        if not clip.keyframes:
            return {}
        before, after, u = PoseTrack.bracket(clip, time)
        if after is None:
            return dict(before.joints)
        return PoseTrack.blend(before.joints, after.joints, u)

    @staticmethod
    def part_pose_at(clip: Clip, time: float) -> PartPoseMap:
        """Resolve a clip to its sparse local PART pose at normalized time.

        The geometry channels only -- ``rot``, ``tx``, ``ty``, ``scale``. The
        wire's other four ``PartPose`` channels (``visible``, ``opacity``,
        ``zIndex``, ``swapTo``) are compositing, are resolved by
        ``render/partpose.py``, and never reach the kernel; see
        ``types.PartPose``. Both halves call ``bracket_index``, so they cannot
        land on different keys.

        Deliberately a mirror of ``pose_at`` down to the early return, because
        the symmetry IS the contract: absent means REST for a part exactly as it
        does for a joint, and the two bracket through the same function.
        """

        if not clip.keyframes:
            return {}
        before, after, u = PoseTrack.bracket(clip, time)
        if after is None:
            return dict(before.parts)
        return PoseTrack.blend(before.parts, after.parts, u)

    @staticmethod
    def sample(clip: Clip, frame_count: int) -> list[Pose]:
        """Sample a clip once per frame, preserving loop continuity.

        A looping clip samples ``i / count`` so the last frame is one step
        short of the start and the wrap is seamless; a one-shot samples
        ``i / (count - 1)`` so it actually reaches its final key.
        """

        count = max(2, int(frame_count))
        if clip.loop:
            return [PoseTrack.pose_at(clip, index / count) for index in range(count)]
        return [PoseTrack.pose_at(clip, index / (count - 1)) for index in range(count)]
