"""``NumericBuffer`` authoring: the inline / external decision, in one place.

Why this is its own module: every flat numeric payload in the document —
vertices, triangles, weights, control points, thicknesses, cut polylines — goes
through the same three decisions (dtype, storage, hash), and a payload that
picks them slightly differently is a payload the render cache cannot key on.

The hash is over the LITTLE-ENDIAN bytes of the stored dtype, which is the
schema's wording and is what makes it comparable across the three languages
regardless of host endianness.
"""

from __future__ import annotations

import hashlib
from typing import Iterable, List, Sequence, Tuple

import numpy as np

from app.modules.anibuddy.constants import RigConstants
from app.modules.anibuddy.rig.types import PendingBuffer
from app.modules.anibuddy.schemas import NumericBuffer


class Buffers:
    """Pack numeric arrays into wire ``NumericBuffer`` values."""

    __slots__ = ()

    @staticmethod
    def f32(
        values: Sequence[float] | np.ndarray,
        *,
        project_id: str,
    ) -> Tuple[NumericBuffer, List[PendingBuffer]]:
        """Pack float data, rounding to float32 exactly once.

        The round happens here rather than at each producer so that the hash,
        the inline ``values`` list and any externalized bytes all describe the
        same numbers. Rounding twice (once for storage, once for the hash) is
        how a buffer ends up with a sha256 that matches nothing.
        """
        array = np.ascontiguousarray(np.asarray(values, dtype=np.float64).ravel())
        stored = array.astype(np.float32)
        return Buffers._pack(stored, dtype="f32", project_id=project_id)

    @staticmethod
    def u32(
        values: Sequence[int] | np.ndarray,
        *,
        project_id: str,
    ) -> Tuple[NumericBuffer, List[PendingBuffer]]:
        """Pack index data as unsigned 32-bit.

        Negative or over-range indices are refused rather than wrapped: a
        wrapped triangle index still renders, just pointing at the wrong
        vertex, which is the class of bug that looks like corrupted artwork.
        """
        array = np.asarray(values, dtype=np.int64).ravel()
        if array.size and (int(array.min()) < 0 or int(array.max()) > np.iinfo(np.uint32).max):
            raise ValueError("u32 buffer contains an out-of-range index")
        stored = np.ascontiguousarray(array.astype(np.uint32))
        return Buffers._pack(stored, dtype="u32", project_id=project_id)

    @staticmethod
    def _pack(
        stored: np.ndarray,
        *,
        dtype: str,
        project_id: str,
    ) -> Tuple[NumericBuffer, List[PendingBuffer]]:
        """Hash, then choose inline or external by element count.

        ``MAX_INLINE_BUFFER_ELEMENTS`` is an element count, not a byte count,
        because the constraint it encodes is the 16MB Mongo document limit
        against a JSON array of numbers — where the cost per element is the
        decimal text, not the 4 packed bytes.
        """
        little_endian = stored.astype(stored.dtype.newbyteorder("<"), copy=False)
        raw = little_endian.tobytes(order="C")
        digest = hashlib.sha256(raw).hexdigest()
        length = int(stored.size)

        if length <= RigConstants.MAX_INLINE_BUFFER_ELEMENTS:
            return (
                NumericBuffer(
                    dtype=dtype,  # type: ignore[arg-type]
                    storage="inline",
                    length=length,
                    sha256=digest,
                    values=[float(value) for value in stored.tolist()],
                    storageKey=None,
                ),
                [],
            )

        storage_key = RigConstants.BUFFER_KEY_TEMPLATE.format(
            project_id=project_id, sha256=digest
        )
        pending = PendingBuffer(
            storage_key=storage_key,
            sha256=digest,
            dtype=dtype,
            length=length,
            data=raw,
        )
        return (
            NumericBuffer(
                dtype=dtype,  # type: ignore[arg-type]
                storage="external",
                length=length,
                sha256=digest,
                values=None,
                storageKey=storage_key,
            ),
            [pending],
        )

    @staticmethod
    def read_f32(buffer: NumericBuffer) -> np.ndarray:
        """Read an inline float buffer back into an array.

        External buffers are refused: this process does not hold the
        ``StorageAdapter``, and silently returning an empty array for one would
        turn a missing cut line into a cut line that does nothing.
        """
        if buffer.storage != "inline" or buffer.values is None:
            raise ValueError(
                f"Cannot read an external NumericBuffer here "
                f"(storageKey={buffer.storageKey!r}); Node owns storage."
            )
        return np.asarray(buffer.values, dtype=np.float64)

    @staticmethod
    def collect(*groups: Iterable[PendingBuffer]) -> List[PendingBuffer]:
        """Flatten pending-upload lists, dropping duplicate content keys.

        Two parts can legitimately produce byte-identical buffers (two mirrored
        limbs at the same resolution). Content addressing means one upload
        serves both.
        """
        seen: set[str] = set()
        out: List[PendingBuffer] = []
        for group in groups:
            for buffer in group:
                if buffer.storage_key in seen:
                    continue
                seen.add(buffer.storage_key)
                out.append(buffer)
        return out
