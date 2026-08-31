"""AniBuddy deformation kernel: pure vertex math, shared contract with the browser.

This package is one half of a deliberately duplicated implementation. Its twin
is ``frontend/src/features/anibuddy/kernel/``. The server renders the
authoritative export; the browser deforms interactively. If the two drift, a
user poses something, likes it, exports it, and gets something different --
with nothing failing anywhere.

The only thing standing between that failure mode and production is the golden
parity harness (``scripts/test-anibuddy-kernel.sh``). Treat a parity failure as
a release blocker, not as a flaky test, and never widen the epsilon to make one
go away.

Rules for editing anything in here:

1. Every change is made in both kernels, in the same commit.
2. Operation order is part of the contract. ``a * b / c`` and ``a * (b / c)``
   are different functions at the last bit.
3. No reductions whose order NumPy is free to choose (``sum``, ``matmul``,
   ``einsum``) on a parity-critical path.
4. No I/O, no logging, no rasterization, no image decoding.
"""

from .clip import BracketableKey, KeyBracket, PoseTrack
from .constants import KernelConstants
from .curves import Curves
from .deformers import Deformers
from .fk import Fk
from .grid import Grid
from .kernel import AniBuddyKernel
from .lattice import Lattice
from .numeric import Numeric
from .parts import PartTree
from .skeleton import Skeleton
from .skin import Skin
from .spline import Spline
from .types import (
    Asset,
    Bone,
    Clip,
    Deformer,
    Joint,
    JointPose,
    Keyframe,
    KernelFrame,
    KernelInputError,
    KernelRig,
    LatticeDeformer,
    MeshDeformer,
    Part,
    PartGeometry,
    PartPose,
    PartPoseMap,
    PartTransform,
    Pose,
    RigidDeformer,
    Slot,
    SolvedSkeleton,
    SplineDeformer,
    WarpBatch,
    pose_from_mapping,
    pose_to_mapping,
)
from .warp import Warp

__all__ = [
    "AniBuddyKernel",
    "Asset",
    "Bone",
    "BracketableKey",
    "Clip",
    "Curves",
    "Deformer",
    "Deformers",
    "Fk",
    "Grid",
    "Joint",
    "JointPose",
    "KeyBracket",
    "Keyframe",
    "KernelConstants",
    "KernelFrame",
    "KernelInputError",
    "KernelRig",
    "Lattice",
    "LatticeDeformer",
    "MeshDeformer",
    "Numeric",
    "Part",
    "PartGeometry",
    "PartPose",
    "PartPoseMap",
    "PartTransform",
    "PartTree",
    "Pose",
    "PoseTrack",
    "RigidDeformer",
    "Skeleton",
    "Skin",
    "Slot",
    "SolvedSkeleton",
    "Spline",
    "SplineDeformer",
    "Warp",
    "WarpBatch",
    "pose_from_mapping",
    "pose_to_mapping",
]
