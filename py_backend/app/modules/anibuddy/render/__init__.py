"""AniBuddy render stage: rasterization and encoding over the shared kernel.

Aggregator for the package (Rule 7). Import from here, not from the submodules,
so the internal layout can change without touching the router.

What this stage does and does not do
-----------------------------------
It **does not** do deformation math. Every vertex it draws comes from
``app.modules.anibuddy.kernel``, which is parity-locked against its TypeScript
twin at 0 float32 ULP. Re-deriving any of that here would be a silent export bug
by construction (R4, R12).

It **does** own everything downstream of the vertices: resolving the wire
schema into kernel input, gating each part's pixels through its mask,
per-triangle affine resampling of the user's own artwork, z-ordered compositing,
the ``PartPose`` channels the kernel has no concept of, encoding, and the content
hash that makes a re-render free.

Rasterization is deliberately NOT shared with the browser — only the vertex math
is, because that is where drift is invisible until it is a support ticket (R4).

One line inside that rule is worth drawing explicitly, because it was read too
widely once. ``partpose.py`` is not rasterization: it decides WHAT to
rasterize, and it is parity-locked to the browser's ``editor/part-track.ts`` by
``fixtures/anibuddy-compositing/``. Compositing PIXELS is per-target; resolving
the four channels that say which layers to composite is not, and the two
implementations disagreed about ``Part.opacity`` and ``PartPose.swapTo`` for
months precisely because nothing said so.
"""

from __future__ import annotations

from app.modules.anibuddy.render.adapter import RigAdapter
from app.modules.anibuddy.render.cache import RenderCache
from app.modules.anibuddy.render.encode import Encoders
from app.modules.anibuddy.render.options import RenderOptionsResolver
from app.modules.anibuddy.render.partpose import PartPoseTrack
from app.modules.anibuddy.render.rasterize import Rasterizer
from app.modules.anibuddy.render.service import (
    RenderResult,
    RenderService,
    decode_sheet,
)
from app.modules.anibuddy.render.types import (
    AdaptedRig,
    EncoderUnavailable,
    FrameStats,
    PartComposite,
    PartSource,
    RenderArtifact,
    RenderError,
    RenderOptions,
    RenderReport,
    RenderSurface,
)

__all__ = [
    "AdaptedRig",
    "EncoderUnavailable",
    "Encoders",
    "FrameStats",
    "PartComposite",
    "PartPoseTrack",
    "PartSource",
    "RenderArtifact",
    "RenderCache",
    "RenderError",
    "RenderOptions",
    "RenderOptionsResolver",
    "RenderReport",
    "RenderResult",
    "RenderService",
    "RenderSurface",
    "RigAdapter",
    "Rasterizer",
    "decode_sheet",
]
