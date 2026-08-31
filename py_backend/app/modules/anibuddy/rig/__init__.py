"""Rig stage package — skeleton inference and the four deformer builders.

Reading order, if you are new to this code: ``service.py`` is the orchestration
and the only thing callers need; ``skeleton.py`` owns the joint graph and its
validator; ``deformers.py`` owns selection and the four builders; ``skin.py``
owns the weight solve and documents where it deviates from the plan's bounded
biharmonic weights and why; ``triangulate.py`` documents why the quality
constraint is implemented rather than delegated to ``triangle``.
"""

from app.modules.anibuddy.rig.buffers import Buffers
from app.modules.anibuddy.rig.contour import (
    distance_transform,
    initial_spacing,
    resample_polyline,
    rings_to_domain,
    sample_interior,
    simplify,
    snap_to_medial_axis,
    spine_polyline,
    trace_contours,
)
from app.modules.anibuddy.rig.deformers import (
    BuiltDeformer,
    DeformerBuilders,
    DeformerSelector,
    build_mesh_geometry,
    spline_candidates,
)
from app.modules.anibuddy.rig.raster import Raster, rect_pixel_bounds
from app.modules.anibuddy.rig.service import RigResult, RigService, rig_document
from app.modules.anibuddy.rig.skeleton import (
    JointGraph,
    JointIds,
    PartTree,
    SkeletonPlanner,
    to_skeleton,
)
from app.modules.anibuddy.rig.skin import Skinner
from app.modules.anibuddy.rig.triangulate import Pslg, Triangulator
from app.modules.anibuddy.rig.types import (
    BoneSegment,
    CutPolyline,
    MeshBuild,
    PartRaster,
    PendingBuffer,
    RigError,
    SkinResult,
    StageReport,
)

__all__ = [
    "BoneSegment",
    "Buffers",
    "BuiltDeformer",
    "CutPolyline",
    "DeformerBuilders",
    "DeformerSelector",
    "JointGraph",
    "JointIds",
    "MeshBuild",
    "PartRaster",
    "PartTree",
    "PendingBuffer",
    "Pslg",
    "Raster",
    "RigError",
    "RigResult",
    "RigService",
    "SkeletonPlanner",
    "SkinResult",
    "Skinner",
    "StageReport",
    "Triangulator",
    "build_mesh_geometry",
    "distance_transform",
    "initial_spacing",
    "rect_pixel_bounds",
    "resample_polyline",
    "rig_document",
    "rings_to_domain",
    "sample_interior",
    "simplify",
    "snap_to_medial_axis",
    "spine_polyline",
    "spline_candidates",
    "to_skeleton",
    "trace_contours",
]
