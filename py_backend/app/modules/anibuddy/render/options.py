"""Turn a render request into resolved, clamped ``RenderOptions``.

All bound-checking, defaulting and format-capability reconciliation happens
here, once, so nothing downstream re-checks a limit or invents a default. The
rasterizer trusts its surface; the encoders trust their frame size.

Two resolutions are worth reading before changing anything in this file.

**The surface is rounded to even on both axes, for every format.** H.264 in
``yuv420p`` requires it, and only the video encoders care — but a render's cache
key, its diagnostics and its artifact metadata all quote the surface, and having
that number depend on the output format is how a PNG preview and an MP4 export
of "the same render" end up one pixel apart with nothing explaining why.

**A format that cannot carry alpha gets its matte applied during
rasterization**, not during encoding. Deciding it here means the background is
part of the cache key, so a transparent request and a matted request are
different artifacts rather than the same one rendered twice.
"""

from __future__ import annotations

from typing import Optional

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.render.types import RenderError, RenderOptions, RenderSurface
from app.modules.anibuddy.schemas import Clip, RigDocument


def _clamp(value: int, low: int, high: int) -> int:
    return low if value < low else (high if value > high else value)


def _to_even(value: int) -> int:
    """Round down to the nearest even number, never below the floor."""
    multiple = RenderConstants.EVEN_DIMENSION_MULTIPLE
    even = (value // multiple) * multiple
    return max(RenderConstants.MIN_OUTPUT_EDGE, even)


class RenderOptionsResolver:
    """Request plus document to validated render settings."""

    __slots__ = ()

    @staticmethod
    def resolve(
        document: RigDocument,
        clip: Optional[Clip],
        *,
        fmt: str,
        fps: Optional[int],
        frame_count: Optional[int],
        width: Optional[int],
        height: Optional[int],
        max_edge: Optional[int],
        background: str,
        loop: Optional[bool],
        warn,
    ) -> RenderOptions:
        if fmt not in RenderConstants.FORMATS:
            raise RenderError(
                f'Unknown render format "{fmt}". Supported: '
                f"{', '.join(RenderConstants.FORMATS)}."
            )

        resolved_fps = RenderOptionsResolver._fps(clip, fps)
        resolved_count = RenderOptionsResolver._frame_count(clip, frame_count)
        resolved_loop = bool(clip.loop) if loop is None and clip else bool(loop)
        surface = RenderOptionsResolver._surface(
            document, fmt=fmt, width=width, height=height, max_edge=max_edge, warn=warn
        )
        resolved_background = RenderOptionsResolver._background(fmt, background, warn)

        return RenderOptions(
            fmt=fmt,
            fps=resolved_fps,
            frame_count=resolved_count,
            loop=resolved_loop,
            surface=surface,
            background=resolved_background,
            clip_id=None if clip is None else clip.id,
        )

    @staticmethod
    def _fps(clip: Optional[Clip], override: Optional[int]) -> int:
        """Requested fps, else the clip's own sampling rate, else the default.

        The clip owns ``fps`` because §7.7 makes it the clip's sampling rate
        rather than its content — so an override is a legitimate request for a
        different sampling of the same motion, not a contradiction.
        """
        candidate = override if override is not None else (
            clip.fps if clip is not None else RenderConstants.DEFAULT_FPS
        )
        return _clamp(int(candidate), 1, RenderConstants.MAX_FPS)

    @staticmethod
    def _frame_count(clip: Optional[Clip], override: Optional[int]) -> int:
        """How many frames to sample.

        A render with no clip is a single still at rest, which is why the floor
        here is 1 and not the schema's ``Clip.frameCount`` minimum of 2: that
        minimum is a constraint on an *animation*, and a still is not one.
        """
        candidate = override if override is not None else (
            clip.frameCount
            if clip is not None
            else RenderConstants.DEFAULT_STILL_FRAME_COUNT
        )
        return _clamp(int(candidate), 1, RenderConstants.MAX_FRAMES)

    @staticmethod
    def _surface(
        document: RigDocument,
        *,
        fmt: str,
        width: Optional[int],
        height: Optional[int],
        max_edge: Optional[int],
        warn,
    ) -> RenderSurface:
        """The destination raster, and the scale the kernel will apply.

        Aspect ratio is preserved on every path except an explicit
        ``width``+``height`` pair, which is taken as an instruction rather than
        second-guessed — a caller asking for a specific pixel size usually has a
        sprite sheet slot to fill.
        """
        asset_w = int(document.asset.width)
        asset_h = int(document.asset.height)
        if asset_w <= 0 or asset_h <= 0:
            raise RenderError("The asset has no dimensions to render into.")

        cap = RenderConstants.MAX_OUTPUT_EDGE
        if fmt == RenderConstants.FORMAT_GIF:
            cap = min(cap, RenderConstants.MAX_GIF_EDGE)

        if width is not None and height is not None:
            out_w = _clamp(int(width), RenderConstants.MIN_OUTPUT_EDGE, cap)
            out_h = _clamp(int(height), RenderConstants.MIN_OUTPUT_EDGE, cap)
            if out_w > asset_w or out_h > asset_h:
                # Upscaling is still only resampling the user's own pixels (R2),
                # so it is allowed — but it cannot add detail that is not on the
                # sheet, and a caller who gets a soft export deserves to know
                # why rather than blaming the deformer.
                warn(
                    f"The requested {out_w}x{out_h} output is larger than the "
                    f"{asset_w}x{asset_h} source sheet, so the artwork is "
                    "upscaled and will look soft."
                )
        else:
            target = max_edge if max_edge is not None else max(asset_w, asset_h)
            target = _clamp(int(target), RenderConstants.MIN_OUTPUT_EDGE, cap)
            scale = min(1.0, target / float(max(asset_w, asset_h)))
            out_w = max(RenderConstants.MIN_OUTPUT_EDGE, round(asset_w * scale))
            out_h = max(RenderConstants.MIN_OUTPUT_EDGE, round(asset_h * scale))

        even_w = _to_even(out_w)
        even_h = _to_even(out_h)
        if (even_w, even_h) != (out_w, out_h):
            warn(
                f"The render surface was rounded to {even_w}x{even_h}; video "
                "codecs require even dimensions and every format quotes the "
                "same size."
            )

        return RenderSurface(
            width=even_w,
            height=even_h,
            # Scale is derived from the FINAL surface, so the kernel's single
            # multiply lands the geometry exactly inside the raster the encoders
            # were told about. Deriving it from the requested size instead would
            # offset the figure by the rounding.
            scale_x=even_w / float(asset_w),
            scale_y=even_h / float(asset_h),
        )

    @staticmethod
    def _background(fmt: str, background: str, warn) -> str:
        """Validate the matte, and force one when the format cannot carry alpha."""
        known = {RenderConstants.BACKGROUND_TRANSPARENT, *RenderConstants.BACKGROUND_RGB}
        if background not in known:
            raise RenderError(
                f'Unknown render background "{background}". Supported: '
                f"{', '.join(sorted(known))}."
            )

        if (
            background == RenderConstants.BACKGROUND_TRANSPARENT
            and fmt not in RenderConstants.ALPHA_CAPABLE_FORMATS
        ):
            warn(
                f"{fmt} cannot carry an alpha channel, so the transparent "
                f"background was matted to {RenderConstants.OPAQUE_FALLBACK_BACKGROUND}. "
                "Export WebM, GIF or PNG frames to keep the cut-out."
            )
            return RenderConstants.OPAQUE_FALLBACK_BACKGROUND
        return background
