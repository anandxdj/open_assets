"""Fixture adapter for the golden parity harness.

Deliberately OUTSIDE ``kernel/``. The kernel is pure math with a fixed input
struct; this is a caller that adapts one particular wire format (the fixture
corpus) into that struct and serializes the result back out. It is the same
job the render worker and the browser client each do for their own formats,
which makes it a worked example of the boundary as well as test scaffolding.

Still no file or network access here -- mappings in, mappings out. The
generator script owns the filesystem.

Serialization contract
----------------------
Every float in the output is exactly representable as float32, and is emitted
via Python's shortest round-tripping repr. ``JSON.parse`` in Node therefore
recovers the identical float64, and ``Math.fround`` of it is the identity. The
golden file is a lossless transport for float32, not an approximation of one.
"""

from __future__ import annotations

from typing import Any, Mapping

import numpy as np

from .kernel import (
    AniBuddyKernel,
    Clip,
    KernelRig,
    PartGeometry,
    PartPoseMap,
    Pose,
    PoseTrack,
    pose_from_mapping,
)


class KernelFixtures:
    """Run one fixture case and serialize its result."""

    __slots__ = ()

    @staticmethod
    def resolve_pose(case: Mapping[str, Any]) -> Pose:
        """The JOINT pose a case evaluates at.

        A case either states a pose directly or names a clip and a time. The
        clip path exists so keyframe interpolation is covered by the same
        golden comparison as the geometry, rather than by a separate test that
        could drift on its own.
        """

        if "clip" in case:
            clip = Clip.from_mapping(case["clip"])
            return PoseTrack.pose_at(clip, float(case.get("time", 0.0)))
        return pose_from_mapping(case.get("pose", {}))

    @staticmethod
    def resolve_part_pose(case: Mapping[str, Any]) -> PartPoseMap:
        """The PART pose a case evaluates at, by the same two routes."""

        if "clip" in case:
            clip = Clip.from_mapping(case["clip"])
            return PoseTrack.part_pose_at(clip, float(case.get("time", 0.0)))
        return pose_from_mapping(case.get("partPose", {}))

    @staticmethod
    def evaluate(case: Mapping[str, Any]) -> dict[str, Any]:
        """Evaluate a case to the golden document shape."""

        rig = KernelRig.from_mapping(case["rig"])
        pose = KernelFixtures.resolve_pose(case)
        part_pose = KernelFixtures.resolve_part_pose(case)
        scale = case.get("scale", [1.0, 1.0])
        frame = AniBuddyKernel.evaluate(
            rig, pose, float(scale[0]), float(scale[1]), part_pose
        )

        # Joints are emitted as a sorted list rather than an object so the
        # golden diffs cleanly and neither language's key ordering can matter.
        joints = [
            [
                joint_id,
                _f32(frame.skeleton.positions[joint_id][0]),
                _f32(frame.skeleton.positions[joint_id][1]),
                _f32(frame.skeleton.accumulated[joint_id]),
            ]
            for joint_id in sorted(frame.skeleton.positions.keys())
        ]

        bones = [
            [
                bone.id,
                _f32(float(frame.skeleton.rest_angles[index])),
                _f32(float(frame.skeleton.posed_angles[index])),
                _f32(float(frame.skeleton.rest_lengths[index])),
            ]
            for index, bone in enumerate(frame.skeleton.bones)
        ]

        return {
            "id": case["id"],
            "pose": _serialize_pose(pose),
            "partPose": _serialize_pose(part_pose),
            "joints": joints,
            "bones": bones,
            "parts": [_serialize_part(part) for part in frame.parts],
        }


def _f32(value: float) -> float:
    """Round to float32 and hand back a float64 that holds it exactly."""

    return float(np.float32(value))


def _f32_list(values: np.ndarray) -> list[float]:
    return [float(value) for value in np.asarray(values, dtype=np.float32).reshape(-1)]


def _serialize_pose(pose: Pose) -> list[list[Any]]:
    """Pose as a sorted list of ``[targetId, channel, value]`` triples.

    Flattened rather than nested so a missing channel and a channel set to its
    rest value are visibly different rows in the golden, which is exactly the
    distinction the samplers have to get right. Used for both the joint pose
    and the part pose, because the two carry the same four channels.
    """

    rows: list[list[Any]] = []
    for target_id in sorted(pose.keys()):
        channel_pose = pose[target_id]
        for channel, value in sorted(channel_pose.to_mapping().items()):
            rows.append([target_id, channel, _f32(value)])
    return rows


def _serialize_part(part: PartGeometry) -> dict[str, Any]:
    return {
        "id": part.part_id,
        "kind": part.kind,
        "zIndex": part.z_index,
        # The part tree's world transform, emitted alongside the vertices it
        # already moved. Redundant in principle and worth it in practice: a
        # composition-order defect names itself here instead of being inferred
        # from a displaced vertex 37 pages into a diff.
        "transform": [_f32(value) for value in part.transform],
        "srcVerts": _f32_list(part.src_verts),
        "dstVerts": _f32_list(part.dst_verts),
        "tris": [int(value) for value in np.asarray(part.tris).reshape(-1)],
        "warp": {
            "matrices": _f32_list(part.warp.matrices),
            "bled": _f32_list(part.warp.bled),
            "triangleIndex": [int(value) for value in part.warp.triangle_index],
            "maxStretch": _f32(part.warp.max_stretch),
            "flippedTriangles": part.warp.flipped_triangles,
            "degenerateTriangles": part.warp.degenerate_triangles,
        },
    }
