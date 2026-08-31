"""Fixture adapter for the compositing parity harness.

The mirror of ``frontend/src/features/anibuddy/editor/compositing-fixtures.ts``.
It adapts one particular wire format — the compositing fixture corpus — into the
structural inputs ``PartPoseTrack`` declares, and serializes the resolved
compositing state back out.

Why this corpus exists at all
-----------------------------
``fixtures/anibuddy-kernel/`` compares VERTICES. Compositing moves none, so that
corpus is structurally blind to everything this one covers: the two
implementations can disagree about a part's opacity, its visibility, its draw
order and which artwork it samples, and still agree at 0 ULP across all
seventeen vertex cases. They did, for months, on two counts at once.

No file access here: objects in, objects out. The generator and the test own the
filesystem, exactly as they do for the kernel corpus.

No NumPy either, deliberately. Rounding to float32 through ``struct`` keeps this
harness runnable with a bare interpreter, so the CI job that guards it cannot
quietly acquire a dependency the thing it guards does not have.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.modules.anibuddy.render.partpose import PartPoseTrack

#: Times a case samples when it does not name its own. Deliberately not the
#: keyframe times: a bracketing or easing difference is largest strictly BETWEEN
#: keys, and a sweep that only lands on keys would miss it. The endpoints are
#: included because 0 and 1 are where clamping and loop wrap live.
DEFAULT_TIMES: Tuple[float, ...] = (0.0, 0.125, 0.25, 0.5, 0.75, 0.875, 1.0)


def to_float32(value: float) -> float:
    """Round to the nearest float32 and return it as a Python float.

    Same reason the kernel goldens do it: a golden written from a float64 is not
    recoverable bit-for-bit by ``JSON.parse``, so the file would encode a
    difference the implementations do not have. Rounded here, the golden is a
    lossless transport for float32 rather than an approximation of one.
    """
    return struct.unpack("<f", struct.pack("<f", value))[0]


# --- Structural inputs ------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FixtureRect:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True, slots=True)
class FixturePart:
    """A ``Part`` reduced to what compositing reads. Satisfies ``CompositingPart``."""

    id: str
    visible: bool
    opacity: float
    zIndex: int
    rect: FixtureRect


@dataclass(frozen=True, slots=True)
class FixturePartPose:
    """A ``PartPose``'s four compositing channels. Satisfies ``CompositingPose``."""

    visible: Optional[bool] = None
    opacity: Optional[float] = None
    zIndex: Optional[int] = None
    swapTo: Optional[str] = None


@dataclass(frozen=True, slots=True)
class FixtureKeyframe:
    """Satisfies ``CompositingKey``: a time, an easing, and part poses."""

    t: float
    ease: Optional[str] = None
    parts: Mapping[str, FixturePartPose] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class FixtureClip:
    """Satisfies ``CompositingClip``."""

    loop: bool
    keyframes: Sequence[FixtureKeyframe]


def _read_rect(data: Optional[Mapping[str, Any]]) -> FixtureRect:
    """A part's crop, defaulting to the whole sheet.

    A case that says nothing about rects is a case about channels, and the whole
    sheet is the rect under which every ``swapTo`` remap is the identity — so the
    default cannot accidentally make a remap case pass.
    """
    if data is None:
        return FixtureRect(0.0, 0.0, 1.0, 1.0)
    return FixtureRect(
        float(data["x"]),
        float(data["y"]),
        float(data["width"]),
        float(data["height"]),
    )


def _read_part(data: Mapping[str, Any]) -> FixturePart:
    return FixturePart(
        id=str(data["id"]),
        visible=bool(data.get("visible", True)),
        opacity=float(data.get("opacity", 1.0)),
        zIndex=int(data.get("zIndex", 0)),
        rect=_read_rect(data.get("rect")),
    )


def _read_pose(data: Mapping[str, Any]) -> FixturePartPose:
    return FixturePartPose(
        visible=None if data.get("visible") is None else bool(data["visible"]),
        opacity=None if data.get("opacity") is None else float(data["opacity"]),
        zIndex=None if data.get("zIndex") is None else int(data["zIndex"]),
        swapTo=None if data.get("swapTo") is None else str(data["swapTo"]),
    )


def _read_keyframe(data: Mapping[str, Any]) -> FixtureKeyframe:
    poses = data.get("parts") or {}
    return FixtureKeyframe(
        t=float(data["t"]),
        ease=None if data.get("ease") is None else str(data["ease"]),
        parts={part_id: _read_pose(pose) for part_id, pose in poses.items()},
    )


class CompositingFixtures:
    """Adapt a fixture case, resolve it, and serialize the result."""

    __slots__ = ()

    @staticmethod
    def read_parts(case: Mapping[str, Any]) -> List[FixturePart]:
        return [_read_part(part) for part in case["parts"]]

    @staticmethod
    def read_clip(case: Mapping[str, Any]) -> Optional[FixtureClip]:
        """The case's clip, or None for a still at rest.

        A case with no clip is not a degenerate one: it is what pins down that
        the rest values ARE the resolved values when nothing animates, which is
        half of the rule the two implementations disagreed about.
        """
        data = case.get("clip")
        if data is None:
            return None
        return FixtureClip(
            loop=bool(data.get("loop", False)),
            keyframes=[_read_keyframe(key) for key in data["keyframes"]],
        )

    @staticmethod
    def times(case: Mapping[str, Any]) -> List[float]:
        stated = case.get("times")
        if stated is None:
            return list(DEFAULT_TIMES)
        return [float(time) for time in stated]

    @staticmethod
    def evaluate(case: Mapping[str, Any]) -> Dict[str, Any]:
        """Resolve a case to the golden document shape.

        Warnings are collected across the whole sweep and deduplicated in
        first-seen order, mirroring ``RenderReport.warn``. Without the dedupe an
        unresolvable ``swapTo`` would appear once per sampled time and the golden
        would encode the sampling rate rather than the defect.
        """
        parts = CompositingFixtures.read_parts(case)
        clip = CompositingFixtures.read_clip(case)
        keys = () if clip is None else clip.keyframes
        loop = False if clip is None else clip.loop

        warnings: List[str] = []

        def warn(message: str) -> None:
            if message not in warnings:
                warnings.append(message)

        frames: List[Dict[str, Any]] = []
        for time in CompositingFixtures.times(case):
            # Every part's channels, in document order, including the ones that
            # do not draw. A part dropped from the composite and a part resolved
            # wrong then dropped look identical in the draw list, so the resolved
            # state is emitted separately from the draw list on purpose.
            resolved_rows: List[List[Any]] = []
            for part in parts:
                resolved = PartPoseTrack.resolve(part, keys, loop, time)
                resolved_rows.append(
                    [
                        part.id,
                        bool(resolved.visible),
                        to_float32(resolved.opacity),
                        int(resolved.z_index),
                        resolved.swap_to,
                    ]
                )

            draw_rows: List[List[Any]] = []
            for entry in PartPoseTrack.composite_order(parts, clip, time, warn):
                draw_rows.append(
                    [
                        entry.part_id,
                        entry.texture_part_id,
                        int(entry.z_index),
                        to_float32(entry.opacity),
                        int(entry.order),
                        *[to_float32(value) for value in entry.uv_remap],
                    ]
                )

            frames.append(
                {"time": to_float32(time), "resolved": resolved_rows, "draw": draw_rows}
            )

        return {"id": str(case["id"]), "frames": frames, "warnings": warnings}
