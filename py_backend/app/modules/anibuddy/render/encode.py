"""Frame sequence to PNG zip, GIF, WebM or MP4.

Ported in intent from ``frontend/src/features/anibuddy/lib/export.ts``.

Dependency choice, and why
--------------------------
The video encoders shell out to **ffmpeg**, located through
``imageio-ffmpeg``'s bundled binary and falling back to one on ``PATH``. The
bundle is the primary because ``py_backend`` ships as a container: a pinned wheel
means the image needs no ``apt-get install ffmpeg`` and CI needs no system
package, which is the same reasoning that made
``scripts/anibuddy/generate-bindings.mjs`` dependency-free. The ``PATH`` fallback
exists so a slim deployment that already carries ffmpeg is not forced to install
a second copy.

ffmpeg is driven by subprocess over a raw-video pipe rather than through
``imageio``'s writer API. One fewer abstraction between the pixel format we
produce and the ``-pix_fmt`` the codec receives, and alpha in VP9 is precisely
the case a generic writer tends to get wrong.

F9 §8.5: **a missing or failing encoder falls back to the PNG zip**, which needs
no external binary at all. That is why every failure here raises
``EncoderUnavailable`` rather than ``RenderError`` — the two get different
treatment upstream.

Streaming, and the one exception
--------------------------------
Frames arrive as an iterator and are consumed once. A 120-frame clip at
``MAX_OUTPUT_EDGE`` is gigabytes of uint8 RGBA, so holding the sequence is not
an option — the zip writes each PNG as it arrives and the video encoders pipe
each frame straight to ffmpeg.

**GIF is the exception**, and deliberately: a shared palette gives a stable
figure where per-frame palettes make its colours shift as it moves, and a shared
palette cannot be chosen before the last frame has been seen. The memory that
makes that safe is ``MAX_GIF_EDGE`` — 512 px and 120 frames is a bounded 120 MB,
where the same concession at ``MAX_OUTPUT_EDGE`` would be two gigabytes.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List

import numpy as np
from PIL import Image

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.render.types import (
    EncoderUnavailable,
    RenderError,
    RenderOptions,
)

#: A fresh iterator over straight uint8 RGBA frames. A factory rather than an
#: iterable because the PNG-zip fallback needs to walk the sequence a second
#: time after an encoder failed, and a spent generator cannot be rewound.
FrameFactory = Callable[[], Iterator[np.ndarray]]

_RGBA_BYTES_PER_PIXEL: int = 4
_MILLISECONDS_PER_SECOND: int = 1000


def _ffmpeg_binary() -> str:
    """Locate ffmpeg: bundled wheel first, then ``PATH``."""
    try:
        import imageio_ffmpeg  # noqa: PLC0415 - optional, resolved at call time

        return str(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:  # pragma: no cover - depends on the deployment image
        found = shutil.which("ffmpeg")
        if found:
            return found
        raise EncoderUnavailable(
            "No ffmpeg binary is available (neither the imageio-ffmpeg bundle "
            "nor one on PATH), so video encoding is unavailable."
        )


def _frame_bytes(frame: np.ndarray, options: RenderOptions) -> bytes:
    """One frame as raw RGBA, refusing a frame that is the wrong size.

    Checked per frame rather than trusted, because ffmpeg reading a raw pipe has
    no way to detect a short frame: it silently resynchronizes and every
    subsequent frame is sheared diagonally.
    """
    expected = (options.surface.height, options.surface.width, _RGBA_BYTES_PER_PIXEL)
    if frame.shape != expected or frame.dtype != np.uint8:
        raise RenderError(
            f"A frame arrived as {frame.shape}/{frame.dtype} but the encoder "
            f"expects {expected}/uint8."
        )
    return np.ascontiguousarray(frame).tobytes()


class Encoders:
    """One entry point per output format, behind one dispatch."""

    __slots__ = ()

    @staticmethod
    def encode(
        fmt: str,
        frames: FrameFactory,
        options: RenderOptions,
        warn,
    ) -> bytes:
        """Encode the clip in ``fmt``. Raises ``EncoderUnavailable`` on fallback."""
        if fmt == RenderConstants.FORMAT_PNG_ZIP:
            return Encoders.png_zip(frames, options)
        if fmt == RenderConstants.FORMAT_GIF:
            return Encoders.gif(frames, options, warn)
        if fmt == RenderConstants.FORMAT_WEBM:
            return Encoders.webm(frames, options, warn)
        if fmt == RenderConstants.FORMAT_MP4:
            return Encoders.mp4(frames, options, warn)
        raise RenderError(f'Unknown render format "{fmt}".')

    # --- PNG frame zip -----------------------------------------------------

    @staticmethod
    def png_zip(frames: FrameFactory, options: RenderOptions, stem: str = "frame") -> bytes:
        """Lossless PNG frames in a zip. The only encoder with no dependency.

        Frame names are zero-padded to the width of the highest index so a
        directory listing sorts in playback order — ``frame-9`` before
        ``frame-10`` is how a 100-frame export gets reassembled wrongly by every
        tool that reads it.
        """
        buffer = io.BytesIO()
        count = 0
        pad = len(str(max(0, options.frame_count - 1)))

        with zipfile.ZipFile(
            buffer,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=RenderConstants.ZIP_COMPRESS_LEVEL,
        ) as archive:
            for index, frame in enumerate(frames()):
                png = io.BytesIO()
                Image.fromarray(frame, mode="RGBA").save(png, format="PNG")
                archive.writestr(
                    RenderConstants.PNG_FRAME_NAME_TEMPLATE.format(
                        stem=stem, index=str(index).zfill(pad)
                    ),
                    png.getvalue(),
                )
                count += 1

            archive.writestr(
                RenderConstants.PNG_ZIP_README_NAME,
                Encoders._readme(options, count),
            )

        return buffer.getvalue()

    @staticmethod
    def _readme(options: RenderOptions, count: int) -> str:
        """The non-generative statement that ships inside the zip (R2)."""
        header = (
            f"{count} frames at {options.fps}fps, "
            f"{options.surface.width}x{options.surface.height}."
        )
        return "\n".join((header, "", *RenderConstants.PNG_ZIP_README_LINES))

    # --- GIF ---------------------------------------------------------------

    @staticmethod
    def gif(frames: FrameFactory, options: RenderOptions, warn) -> bytes:
        """Animated GIF with a real transparent palette slot.

        GIF has no alpha channel — it has one palette index that means "nothing
        here". Reserving that slot is not optional for cutout artwork: without
        it the quantizer assigns the empty pixels whatever colour it likes and
        the figure gains a halo of it. This is the same reason the v3 browser
        encoder passed ``rgba4444`` with ``oneBitAlpha`` instead of letting
        ``gifenc`` pick a format.

        Two consequences of one bit of alpha, both deliberate:

        * A partially transparent pixel has to choose, at
          ``GIF_ALPHA_THRESHOLD``. Half coverage keeps an antialiased silhouette
          the visual weight it had with a full alpha channel.
        * The frames must dispose to background, or a moving figure smears
          because the previous frame's pixels are never cleared.
        """
        collected: List[np.ndarray] = []
        samples: List[np.ndarray] = []

        for frame in frames():
            collected.append(frame)
            samples.append(Encoders._palette_sample(frame))

        if not collected:
            raise RenderError("A GIF needs at least one frame.")

        palette_image = Encoders._build_palette(samples)
        indexed = [
            Encoders._to_indexed(frame, palette_image) for frame in collected
        ]

        save_options: Dict[str, Any] = {
            "format": "GIF",
            "save_all": True,
            "append_images": indexed[1:],
            "duration": round(_MILLISECONDS_PER_SECOND / options.fps),
            "transparency": RenderConstants.GIF_TRANSPARENT_INDEX,
            "disposal": RenderConstants.GIF_DISPOSAL_RESTORE_BACKGROUND,
            # Palette optimization is allowed to remap indices, which would move
            # the reserved transparent slot and turn every empty pixel opaque.
            "optimize": False,
        }
        if options.loop:
            save_options["loop"] = RenderConstants.GIF_LOOP_FOREVER

        buffer = io.BytesIO()
        try:
            indexed[0].save(buffer, **save_options)
        except Exception as cause:  # pragma: no cover - Pillow-internal failure
            raise EncoderUnavailable(f"GIF encoding failed ({cause}).") from cause

        if options.surface.width > RenderConstants.MAX_GIF_EDGE or (
            options.surface.height > RenderConstants.MAX_GIF_EDGE
        ):
            warn(
                "This GIF is larger than the "
                f"{RenderConstants.MAX_GIF_EDGE}px export cap; a palette-indexed "
                "format at this size will be very large."
            )
        return buffer.getvalue()

    @staticmethod
    def _palette_sample(frame: np.ndarray) -> np.ndarray:
        """An evenly-spaced sample of a frame's opaque RGB pixels.

        Sampled rather than exhaustive because the palette only needs the
        distribution of colours, and quantizing 120 full frames costs far more
        than it improves. Only opaque pixels are offered: a transparent pixel's
        RGB is meaningless (it is premultiplied-out black) and including it would
        spend a palette entry on a colour that is never drawn.
        """
        opaque = frame[:, :, 3] >= RenderConstants.GIF_ALPHA_THRESHOLD
        pixels = frame[:, :, :3][opaque]
        if pixels.shape[0] == 0:
            return np.zeros((0, 3), dtype=np.uint8)
        budget = RenderConstants.GIF_PALETTE_SAMPLE_PER_FRAME
        if pixels.shape[0] <= budget:
            return pixels
        step = pixels.shape[0] // budget
        return pixels[::step][:budget]

    @staticmethod
    def _build_palette(samples: Iterable[np.ndarray]) -> Image.Image:
        """One shared palette for the whole clip.

        Global rather than per-frame. Per-frame palettes are individually better
        and collectively worse: the figure's colours shift frame to frame, which
        reads as flickering even when every single frame is closer to the source.
        """
        stacked = [block for block in samples if block.shape[0] > 0]
        if not stacked:
            # A fully transparent clip still needs a palette to index against.
            pixels = np.zeros((1, 1, 3), dtype=np.uint8)
        else:
            flat = np.concatenate(stacked, axis=0)
            pixels = flat.reshape(-1, 1, 3)

        return Image.fromarray(pixels, mode="RGB").quantize(
            colors=RenderConstants.GIF_PALETTE_COLOURS,
            method=Image.Quantize.MEDIANCUT,
        )

    @staticmethod
    def _to_indexed(frame: np.ndarray, palette_image: Image.Image) -> Image.Image:
        """Map one frame onto the shared palette, reserving the transparent slot.

        Dithering is off. It measurably improves a single frame on a gradient and
        measurably ruins a sequence: the dither pattern is recomputed per frame,
        so flat areas shimmer.
        """
        rgb = Image.fromarray(frame[:, :, :3], mode="RGB")
        mapped = rgb.quantize(palette=palette_image, dither=Image.Dither.NONE)

        indices = np.asarray(mapped, dtype=np.uint8)
        # The palette carries at most GIF_PALETTE_COLOURS entries, so clamping
        # guarantees nothing collides with the reserved transparent index even if
        # Pillow hands back a full 256-entry mapping.
        indices = np.minimum(indices, RenderConstants.GIF_PALETTE_COLOURS - 1)
        transparent = frame[:, :, 3] < RenderConstants.GIF_ALPHA_THRESHOLD
        indices = np.where(
            transparent, RenderConstants.GIF_TRANSPARENT_INDEX, indices
        ).astype(np.uint8)

        out = Image.fromarray(indices, mode="P")
        out.putpalette(Encoders._full_palette(palette_image))
        return out

    @staticmethod
    def _full_palette(palette_image: Image.Image) -> List[int]:
        """A 256-entry RGB palette with the transparent index left black.

        Padded to a full 256 entries so the reserved index exists in the encoded
        palette rather than being an out-of-range reference the decoder resolves
        to whatever follows.
        """
        source = palette_image.getpalette() or []
        entries = list(source[: RenderConstants.GIF_PALETTE_COLOURS * 3])
        entries.extend([0] * (256 * 3 - len(entries)))
        return entries

    # --- Video -------------------------------------------------------------

    @staticmethod
    def webm(frames: FrameFactory, options: RenderOptions, warn) -> bytes:
        """VP9 in WebM. The only video format offered that carries alpha.

        ``yuva420p`` is why: VP9 encodes an alpha plane, so a transparent
        cutout survives into a format a browser will play inline. Requesting a
        transparent MP4 instead gets matted, and told so.
        """
        alpha = options.background == RenderConstants.BACKGROUND_TRANSPARENT
        pix_fmt = (
            RenderConstants.WEBM_PIX_FMT_ALPHA
            if alpha
            else RenderConstants.WEBM_PIX_FMT_OPAQUE
        )
        return Encoders._ffmpeg(
            frames,
            options,
            warn,
            extension=RenderConstants.EXTENSION_BY_FORMAT[RenderConstants.FORMAT_WEBM],
            codec_args=[
                "-c:v",
                RenderConstants.WEBM_CODEC,
                "-pix_fmt",
                pix_fmt,
                "-crf",
                RenderConstants.WEBM_CRF,
                "-b:v",
                RenderConstants.WEBM_BITRATE,
                "-deadline",
                RenderConstants.WEBM_DEADLINE,
                "-cpu-used",
                RenderConstants.WEBM_CPU_USED,
                "-row-mt",
                RenderConstants.WEBM_ROW_MT,
                "-threads",
                RenderConstants.ENCODER_THREADS,
            ],
        )

    @staticmethod
    def mp4(frames: FrameFactory, options: RenderOptions, warn) -> bytes:
        """H.264 in MP4. No alpha in any profile a browser will play.

        The matte is applied during rasterization rather than here — see
        ``dto.resolve_options`` — so by the time frames arrive the alpha channel
        is a constant and dropping it is lossless.
        """
        return Encoders._ffmpeg(
            frames,
            options,
            warn,
            extension=RenderConstants.EXTENSION_BY_FORMAT[RenderConstants.FORMAT_MP4],
            codec_args=[
                "-c:v",
                RenderConstants.MP4_CODEC,
                "-pix_fmt",
                RenderConstants.MP4_PIX_FMT,
                "-crf",
                RenderConstants.MP4_CRF,
                "-preset",
                RenderConstants.MP4_PRESET,
                "-threads",
                RenderConstants.ENCODER_THREADS,
                "-movflags",
                RenderConstants.MP4_FASTSTART_FLAG,
            ],
        )

    @staticmethod
    def _ffmpeg(
        frames: FrameFactory,
        options: RenderOptions,
        warn,
        *,
        extension: str,
        codec_args: List[str],
    ) -> bytes:
        """Pipe raw RGBA into ffmpeg and read the muxed file back.

        Output goes to a temp file rather than stdout because ``+faststart``
        needs to seek back and rewrite the moov atom, which a pipe cannot do.
        stderr goes to a temp file too: ffmpeg is chatty, and a full stderr pipe
        deadlocks against our own blocking writes to stdin.
        """
        binary = _ffmpeg_binary()

        if options.loop:
            warn(
                "Video formats carry no loop flag; the player decides. Use the "
                "GIF or PNG-frame export if the loop has to be in the file."
            )

        with tempfile.TemporaryDirectory(prefix="anibuddy-render-") as directory:
            output = Path(directory) / f"out.{extension}"
            log = Path(directory) / "ffmpeg.log"

            command = [
                binary,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                f"{options.surface.width}x{options.surface.height}",
                "-r",
                str(options.fps),
                "-i",
                "pipe:0",
                "-an",
                *codec_args,
                str(output),
            ]

            with log.open("wb") as stderr:
                try:
                    process = subprocess.Popen(
                        command, stdin=subprocess.PIPE, stderr=stderr
                    )
                except OSError as cause:
                    raise EncoderUnavailable(
                        f"ffmpeg could not be started ({cause})."
                    ) from cause

                try:
                    assert process.stdin is not None
                    for frame in frames():
                        process.stdin.write(_frame_bytes(frame, options))
                    process.stdin.close()
                    code = process.wait(
                        timeout=RenderConstants.ENCODER_TIMEOUT_SECONDS
                    )
                except subprocess.TimeoutExpired as cause:
                    process.kill()
                    process.wait()
                    raise EncoderUnavailable(
                        "ffmpeg exceeded its "
                        f"{RenderConstants.ENCODER_TIMEOUT_SECONDS:.0f}s budget."
                    ) from cause
                except BrokenPipeError as cause:
                    process.wait()
                    raise EncoderUnavailable(
                        f"ffmpeg closed early: {Encoders._tail(log)}"
                    ) from cause

            if code != 0 or not output.exists():
                raise EncoderUnavailable(
                    f"ffmpeg exited {code}: {Encoders._tail(log)}"
                )
            return output.read_bytes()

    @staticmethod
    def _tail(log: Path) -> str:
        """The last of an encoder's stderr, short enough for a warning field."""
        try:
            raw = log.read_bytes()
        except OSError:  # pragma: no cover - the temp dir is ours
            return "no output"
        tail = raw[-RenderConstants.ENCODER_STDERR_TAIL_BYTES :]
        return tail.decode("utf-8", errors="replace").strip() or "no output"
