"""Internal candidate types used between cascade strategies.

These never leave the service boundary — the wire sees ``Part`` /
``Diagnostics`` from the generated schemas only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

PartStrategy = Literal["gutter-grid", "alpha-component", "watershed", "grabcut"]


@dataclass(frozen=True)
class PixelBounds:
    """Axis-aligned bounds in source pixels, inclusive on both edges."""

    x: int
    y: int
    width: int
    height: int
    pixels: int


@dataclass
class PartCandidate:
    """One provisional cutout before it is promoted to a wire ``Part``."""

    bounds: PixelBounds
    #: Binary mask (H×W of the full sheet), 0/1 uint8. Never mutates source RGB.
    mask: np.ndarray
    provenance: PartStrategy
    confidence: float
