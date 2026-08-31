"""AniBuddy: layered-cutout rig decomposition, rigging, deformation and render.

Imports are lazy so the infra stub surface (`stages.stub`, BullMQ JSON handlers)
can load without pulling OpenCV for the classical decompose path.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "ArchetypePriors",
    "DecomposeError",
    "DecomposeRequest",
    "DecomposeResponse",
    "DecomposeService",
    "RenderCache",
    "RenderError",
    "RenderRequest",
    "RenderResponse",
    "RenderService",
    "decompose_image",
    "router",
]


def __getattr__(name: str) -> Any:
    if name == "ArchetypePriors":
        from app.modules.anibuddy.archetype_priors import ArchetypePriors

        return ArchetypePriors
    if name == "router":
        from app.modules.anibuddy.router import router

        return router
    if name in {"DecomposeError", "DecomposeService", "decompose_image"}:
        from app.modules.anibuddy.decompose import (
            DecomposeError,
            DecomposeService,
            decompose_image,
        )

        return {
            "DecomposeError": DecomposeError,
            "DecomposeService": DecomposeService,
            "decompose_image": decompose_image,
        }[name]
    if name in {"RenderCache", "RenderError", "RenderService"}:
        from app.modules.anibuddy.render import RenderCache, RenderError, RenderService

        return {
            "RenderCache": RenderCache,
            "RenderError": RenderError,
            "RenderService": RenderService,
        }[name]
    if name in {
        "DecomposeRequest",
        "DecomposeResponse",
        "RenderRequest",
        "RenderResponse",
    }:
        from app.modules.anibuddy import dto

        return getattr(dto, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
