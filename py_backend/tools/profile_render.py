"""Attribute render-stage wall time between the kernel and the rasterizer.

    python -m tools.profile_render            # a realistic humanoid-shaped rig
    python -m tools.profile_render --worst     # 16 full-sheet parts

Not a test. Run it when a render feels slow, to find out *which half* is slow
before optimizing anything, because the two halves have very different rules:

* The **kernel** is parity-locked against its TypeScript twin at 0 float32 ULP.
  Its per-triangle warp loop is a scalar Python loop on purpose (see
  ``kernel/warp.py``) and vectorizing it would reassociate arithmetic and break
  the golden corpus. Cost there is a cost to live with.
* The **rasterizer** is per-target by design (R4), so it can be optimized
  freely. It is also where the cost actually is: measured at ~80% of a render.

Rig shape matters more than triangle count. The rasterizer's cost is
proportional to each part's destination bounding-box AREA, so twelve
limb-shaped parts are far cheaper than twelve full-sheet ones even at identical
triangle counts. ``--worst`` exists to make that gap visible.

Kept in mind because the gateway gives py_backend a 120s request budget
(``Config.pyBackend.timeoutMs``): a 120-frame clip has roughly a second per
frame before a working render becomes a timeout.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import time
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.anibuddy.kernel import AniBuddyKernel, PoseTrack  # noqa: E402
from app.modules.anibuddy.render.adapter import RigAdapter  # noqa: E402
from app.modules.anibuddy.render.options import RenderOptionsResolver  # noqa: E402
from app.modules.anibuddy.render.partpose import PartPoseTrack  # noqa: E402
from app.modules.anibuddy.render.rasterize import Rasterizer  # noqa: E402
from app.modules.anibuddy.render.service import decode_sheet  # noqa: E402
from app.modules.anibuddy.rig.buffers import Buffers  # noqa: E402
from app.modules.anibuddy.schemas import (  # noqa: E402
    AssetRef,
    Clip,
    DeformerMesh,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    Joint,
    JointPose,
    Keyframe,
    MaskAlphaThreshold,
    Part,
    Rect,
    RevisionLink,
    RigDocument,
    Skeleton,
    Vec2,
)

#: A humanoid decomposes into limb-shaped rects, not full-sheet ones. These are
#: eyeballed from the archetype's own part list (F9 §10.1).
HUMANOID_RECTS: Tuple[Tuple[float, float, float, float], ...] = (
    (0.40, 0.30, 0.20, 0.28),  # torso
    (0.42, 0.10, 0.16, 0.18),  # head
    (0.26, 0.30, 0.14, 0.30),  # arm upper L
    (0.20, 0.55, 0.12, 0.26),  # arm lower L
    (0.60, 0.30, 0.14, 0.30),  # arm upper R
    (0.68, 0.55, 0.12, 0.26),  # arm lower R
    (0.40, 0.56, 0.10, 0.28),  # leg upper L
    (0.38, 0.80, 0.10, 0.16),  # leg lower L
    (0.50, 0.56, 0.10, 0.28),  # leg upper R
    (0.52, 0.80, 0.10, 0.16),  # leg lower R
    (0.44, 0.06, 0.12, 0.08),  # hair
    (0.30, 0.20, 0.40, 0.14),  # cape
)

WORST_CASE_RECTS: Tuple[Tuple[float, float, float, float], ...] = tuple(
    (0.1, 0.1, 0.6, 0.7) for _ in range(16)
)


def _sheet(size: int) -> bytes:
    """A noise-filled sheet. Noise so PNG cannot compress the cost away."""
    rng = np.random.default_rng(1)
    inset = size // 8
    sheet = np.zeros((size, size, 4), dtype=np.uint8)
    span = size - 2 * inset
    sheet[inset:-inset, inset:-inset, :3] = rng.integers(
        0, 256, (span, span, 3), dtype=np.uint8
    )
    sheet[inset:-inset, inset:-inset, 3] = 255
    buffer = io.BytesIO()
    Image.fromarray(sheet, mode="RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def _mesh(divisions: int) -> Tuple[DeformerMesh, int]:
    grid_x, grid_y = np.meshgrid(
        np.linspace(0, 1, divisions + 1), np.linspace(0, 1, divisions + 1)
    )
    verts = np.stack([grid_x.ravel(), grid_y.ravel()], axis=1)
    tris: List[int] = []
    for j in range(divisions):
        for i in range(divisions):
            corner = j * (divisions + 1) + i
            tris += [
                corner,
                corner + 1,
                corner + divisions + 2,
                corner,
                corner + divisions + 2,
                corner + divisions + 1,
            ]

    vertex_buffer, _ = Buffers.f32(verts.ravel(), project_id="profile")
    tri_buffer, _ = Buffers.u32(tris, project_id="profile")
    weights = np.ones((verts.shape[0], 1))
    weight_buffer, _ = Buffers.f32(weights.ravel(), project_id="profile")
    mesh = DeformerMesh(
        kind="mesh",
        verts=vertex_buffer,
        tris=tri_buffer,
        boneIds=["j_root->j_tip"],
        weights=weight_buffer,
        cuts=[],
    )
    return mesh, len(tris) // 3


def build(
    rects: Tuple[Tuple[float, float, float, float], ...],
    divisions: int,
    size: int,
    frames: int,
) -> Tuple[RigDocument, bytes, int]:
    data = _sheet(size)
    mesh, triangles = _mesh(divisions)
    now = "2026-08-14T00:00:00Z"

    document = RigDocument(
        schemaVersion=5,
        id="rev_profile",
        projectId="profile",
        createdAt=now,
        updatedAt=now,
        revision=RevisionLink(
            index=0, parentRevisionId=None, reason="profile", accepted=True
        ),
        archetype="humanoid",
        asset=AssetRef(
            id="asset_profile",
            name="profile.png",
            storageKey="anibuddy/profile.png",
            contentHash=hashlib.sha256(data).hexdigest(),
            width=size,
            height=size,
            figureHeight=None,
            mimeType="image/png",
            rightsConfirmed=True,
            remoteVisionConsented=False,
        ),
        parts=[
            Part(
                id=f"p{index}",
                name=f"part {index}",
                role="torso",
                mask=MaskAlphaThreshold(kind="alpha-threshold", threshold=24),
                rect=Rect(x=rect[0], y=rect[1], width=rect[2], height=rect[3]),
                pivot=Vec2(x=0.5, y=0.5),
                zIndex=index,
                parentPartId=None,
                attachSlot=None,
                slots=[],
                deformer=mesh,
                boundJointId="j_root",
                visible=True,
                opacity=1.0,
                confidence=0.9,
                provenance="manual",
            )
            for index, rect in enumerate(rects)
        ],
        skeleton=Skeleton(
            joints=[
                Joint(
                    id="j_root",
                    name="root",
                    role="root",
                    x=0.5,
                    y=0.7,
                    parent=None,
                    partId=None,
                    ikChainLength=None,
                    confidence=0.9,
                ),
                Joint(
                    id="j_tip",
                    name="tip",
                    role="spine",
                    x=0.5,
                    y=0.2,
                    parent="j_root",
                    partId=None,
                    ikChainLength=None,
                    confidence=0.9,
                ),
            ]
        ),
        clips=[
            Clip(
                id="clip_profile",
                name="profile",
                request="",
                loop=False,
                fps=24,
                frameCount=frames,
                keyframes=[
                    Keyframe(
                        t=0.0,
                        ease="linear",
                        joints={"j_tip": JointPose(rot=0.0)},
                        parts={},
                    ),
                    Keyframe(
                        t=1.0,
                        ease="linear",
                        joints={"j_tip": JointPose(rot=25.0)},
                        parts={},
                    ),
                ],
                source="edited",
            )
        ],
        generation=GenerationSeam(
            mode="external-prompt-only", prompt=None, transcript=[], producedBy=None
        ),
        provenance=DocumentProvenance(
            pipelineVersion="profile", kernelVersion="profile", stages=[]
        ),
        diagnostics=Diagnostics(
            foregroundPixels=0,
            coveredForegroundPixels=0,
            overlappingPartPairs=[],
            maxStretch=1.0,
            flippedTriangles=0,
            isolatedVertices=0,
            warnings=[],
            blockingReason=None,
        ),
    )
    return document, data, triangles


def profile(
    rects: Tuple[Tuple[float, float, float, float], ...],
    divisions: int,
    size: int,
    frames: int,
    label: str,
) -> None:
    document, data, per_part_triangles = build(rects, divisions, size, frames)

    def warn(_message: str) -> None:
        return None

    sheet = decode_sheet(data)
    clip = document.clips[0]
    options = RenderOptionsResolver.resolve(
        document,
        clip,
        fmt="png-zip",
        fps=None,
        frame_count=None,
        width=None,
        height=None,
        max_edge=None,
        background="transparent",
        loop=None,
        warn=warn,
    )

    adapted = RigAdapter.to_kernel(document)
    sources = Rasterizer.part_sources(document, sheet, warn)
    kernel_clip = RigAdapter.clip_to_kernel(clip)
    times = [index / (frames - 1) for index in range(frames)]
    composites = PartPoseTrack.sample(list(document.parts), clip, times, warn)

    kernel_seconds = 0.0
    raster_seconds = 0.0
    for index, moment in enumerate(times):
        start = time.perf_counter()
        pose = PoseTrack.pose_at(kernel_clip, moment)
        kernel_frame = AniBuddyKernel.evaluate(
            adapted.kernel_rig, pose, options.surface.scale_x, options.surface.scale_y
        )
        geometry = Rasterizer.index_geometry(kernel_frame)
        kernel_seconds += time.perf_counter() - start

        start = time.perf_counter()
        Rasterizer.frame(
            geometry,
            composites[index],
            sources,
            options.surface,
            options.background,
            document.asset.width,
            document.asset.height,
        )
        raster_seconds += time.perf_counter() - start

    total = kernel_seconds + raster_seconds
    triangles = per_part_triangles * len(rects)
    print(
        f"{label}: {len(rects)} parts x {per_part_triangles} tris "
        f"({triangles} tris/frame), {frames} frames at "
        f"{options.surface.width}x{options.surface.height}"
    )
    print(
        f"  kernel (parity-locked vertex math) {kernel_seconds:7.2f}s"
        f"  {kernel_seconds / total:5.1%}"
    )
    print(
        f"  rasterizer                         {raster_seconds:7.2f}s"
        f"  {raster_seconds / total:5.1%}"
    )
    print(f"  per frame                          {total / frames * 1000:7.0f} ms")
    print(
        f"  extrapolated to MAX_FRAMES (120)   {total / frames * 120:7.1f}s"
        "  (gateway budget is 120s)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--worst",
        action="store_true",
        help="16 full-sheet parts instead of a humanoid's limb-shaped ones",
    )
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--frames", type=int, default=12)
    parser.add_argument("--divisions", type=int, default=12)
    args = parser.parse_args()

    if args.worst:
        profile(WORST_CASE_RECTS, args.divisions, args.size, args.frames, "WORST CASE")
    else:
        profile(HUMANOID_RECTS, args.divisions, args.size, args.frames, "HUMANOID")


if __name__ == "__main__":
    main()
