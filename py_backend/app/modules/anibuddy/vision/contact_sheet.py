"""Tile really-rendered frames into the one image a critique pass looks at.

This is the file that makes the loop closed rather than reflective. The model
does not read back its own ``MotionProposal``; it looks at frames the render
stage produced by resampling the user's artwork through the rig it proposed
(F9 §11.1). A proposal is a hypothesis about pixels the model has never seen
deformed, and this is where it finally sees them.

Why the frames arrive as a PNG zip
----------------------------------
The tiler takes the render stage's own artifact and does not reach inside the
rasterizer. That boundary is deliberate: ``render`` owns pixels-per-frame, this
owns the layout of nine of them, and the seam between the two is a documented
artifact format rather than a shared internal. PNG-zip specifically because it
is the only encoder with no external dependency (F9 §8.5) and because a video
would have to be decoded back to frames to be tiled.

Layout decisions that change what the model reports
---------------------------------------------------
* **Gutters are not decoration.** Without them a limb leaving frame N reads as
  continuing into frame N+1, and the model critiques a motion nobody rendered.
* **Tiles are labelled with the frame index and its normalized clip time.** A
  ``keyframe-retime`` correction is a time in 0..1, so the model must be able to
  read a time off the picture instead of inferring one from a tile position.
* **Reading order is row-major, stated in the prompt.** Nine unlabelled tiles
  have two plausible orders and the model does not get to guess which.
"""

from __future__ import annotations

import io
import zipfile
from typing import List, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import VisionConstants
from app.modules.anibuddy.vision.types import VisionError, blank_canvas, to_bgr

_LABEL_FONT = cv2.FONT_HERSHEY_SIMPLEX


def frames_from_png_zip(archive: bytes) -> Tuple[np.ndarray, ...]:
    """Decode the render stage's PNG-zip artifact into RGB frames, in order.

    Sorted by name rather than by zip member order: the encoder writes
    ``{stem}-{index}.png`` and a zip is an unordered container, so trusting
    member order would shuffle the animation on any implementation that
    reorders. Zero-padded indices in the template are what make the lexical
    sort agree with the numeric one.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            names = sorted(
                name for name in bundle.namelist() if name.lower().endswith(".png")
            )
            if not names:
                raise VisionError(
                    "The render artifact contained no PNG frames to tile."
                )
            frames: List[np.ndarray] = []
            for name in names:
                decoded = cv2.imdecode(
                    np.frombuffer(bundle.read(name), np.uint8), cv2.IMREAD_UNCHANGED
                )
                if decoded is None:
                    raise VisionError(f'Frame "{name}" could not be decoded.')
                frames.append(_to_rgb(decoded))
    except zipfile.BadZipFile as error:
        raise VisionError("The render artifact was not a readable zip.") from error
    return tuple(frames)


def _to_rgb(decoded: np.ndarray) -> np.ndarray:
    """Any decoded frame to opaque RGB over the contact sheet's own matte.

    The render was already asked for an opaque background, so an alpha channel
    here is either absent or fully opaque. Compositing anyway costs one multiply
    and removes the "what if the encoder kept alpha" branch from the tiler.
    """
    if decoded.ndim == 2:
        return cv2.cvtColor(decoded, cv2.COLOR_GRAY2RGB)
    if decoded.shape[2] == 3:
        return cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB)
    if decoded.shape[2] == 4:
        rgba = cv2.cvtColor(decoded, cv2.COLOR_BGRA2RGBA)
        rgb = rgba[:, :, :3].astype(np.float32)
        alpha = (rgba[:, :, 3].astype(np.float32) / 255.0)[:, :, None]
        matte = np.array(
            VisionConstants.CONTACT_SHEET_SHEET_RGB, dtype=np.float32
        )[None, None, :]
        return np.clip(np.rint(rgb * alpha + matte * (1.0 - alpha)), 0, 255).astype(
            np.uint8
        )
    raise VisionError(f"Unsupported frame shape {decoded.shape}.")


def pick_frame_indices(available: int, wanted: int) -> Tuple[int, ...]:
    """Evenly spread ``wanted`` indices across ``available`` frames.

    Evenly rather than the first N: the first nine frames of a 120-frame walk
    cycle are one ninth of a step, and a critique of that says nothing about the
    cycle. Endpoints are included so the model sees the loop's seam, which is
    where a bad ``keyframe-retime`` shows first.

    Duplicates are kept when ``available < wanted`` instead of shortening the
    grid. A short clip genuinely has fewer distinct poses, and a ragged grid is
    a layout the model has to interpret rather than read.
    """
    if available <= 0:
        raise VisionError("There are no rendered frames to build a contact sheet from.")
    if wanted <= 0:
        raise VisionError("A contact sheet needs at least one tile.")
    if available == 1:
        return tuple(0 for _ in range(wanted))
    step = (available - 1) / float(wanted - 1) if wanted > 1 else 0.0
    return tuple(min(available - 1, int(round(index * step))) for index in range(wanted))


def _tile_size(frame: np.ndarray, max_edge: int) -> Tuple[int, int]:
    height, width = frame.shape[:2]
    longest = max(int(width), int(height))
    if longest <= 0:
        raise VisionError("A rendered frame has no dimensions.")
    scale = min(1.0, float(max_edge) / float(longest))
    return (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )


class ContactSheet:
    """Compose N rendered frames into one labelled grid image."""

    __slots__ = ()

    @staticmethod
    def compose(
        frames: Sequence[np.ndarray],
        frame_times: Sequence[float],
        *,
        columns: int = VisionConstants.CONTACT_SHEET_COLUMNS,
        tile_max_edge: int = VisionConstants.CONTACT_SHEET_TILE_MAX_EDGE,
    ) -> Tuple[bytes, int, int, int, int]:
        """Returns ``(png, width, height, columns, rows)``.

        ``frame_times`` must be the same length as ``frames``; they are printed
        on the tiles, and a mismatch would label a pose with another pose's time,
        which is worse than no label at all.
        """
        if not frames:
            raise VisionError("A contact sheet needs at least one frame.")
        if len(frame_times) != len(frames):
            raise VisionError(
                "Every contact-sheet tile needs its own clip time; got "
                f"{len(frame_times)} times for {len(frames)} frames."
            )
        if columns <= 0:
            raise VisionError("A contact sheet needs at least one column.")

        tile_w, tile_h = _tile_size(frames[0], tile_max_edge)
        rows = (len(frames) + columns - 1) // columns
        gutter = VisionConstants.CONTACT_SHEET_GUTTER_PX
        margin = VisionConstants.CONTACT_SHEET_MARGIN_PX

        sheet_w = margin * 2 + columns * tile_w + (columns - 1) * gutter
        sheet_h = margin * 2 + rows * tile_h + (rows - 1) * gutter
        sheet = blank_canvas(
            sheet_w, sheet_h, VisionConstants.CONTACT_SHEET_SHEET_RGB
        )
        sheet_bgr = cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR)

        for index, frame in enumerate(frames):
            row, column = divmod(index, columns)
            left = margin + column * (tile_w + gutter)
            top = margin + row * (tile_h + gutter)
            resized = cv2.resize(frame, (tile_w, tile_h), interpolation=cv2.INTER_AREA)
            sheet_bgr[top : top + tile_h, left : left + tile_w] = cv2.cvtColor(
                resized, cv2.COLOR_RGB2BGR
            )
            cv2.rectangle(
                sheet_bgr,
                (left, top),
                (left + tile_w - 1, top + tile_h - 1),
                to_bgr(VisionConstants.CONTACT_SHEET_TILE_BORDER_RGB),
                thickness=1,
            )
            ContactSheet._label(sheet_bgr, index, frame_times[index], left, top)

        buffer = io.BytesIO()
        Image.fromarray(cv2.cvtColor(sheet_bgr, cv2.COLOR_BGR2RGB), mode="RGB").save(
            buffer, format="PNG"
        )
        return buffer.getvalue(), sheet_w, sheet_h, columns, rows

    @staticmethod
    def _label(
        sheet_bgr: np.ndarray, index: int, time: float, left: int, top: int
    ) -> None:
        """Frame number and its normalized clip time, drawn inside the tile.

        Inside rather than in the gutter so a model that crops or re-tiles the
        image cannot separate a label from the pose it describes.
        """
        text = f"#{index + 1} t={time:.2f}"
        cv2.putText(
            sheet_bgr,
            text,
            (left + 3, top + 12),
            _LABEL_FONT,
            VisionConstants.CONTACT_SHEET_LABEL_SCALE,
            to_bgr(VisionConstants.CONTACT_SHEET_LABEL_TEXT_RGB),
            VisionConstants.CONTACT_SHEET_LABEL_THICKNESS,
            lineType=cv2.LINE_AA,
        )
