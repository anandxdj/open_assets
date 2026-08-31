"""Rehydrating a document whose geometry lives behind a ``StorageAdapter`` key.

Why this exists
---------------
A buffer over ``MAX_INLINE_BUFFER_ELEMENTS`` leaves the rig stage as
``storage: "external"`` plus a content-addressed key, because a 64-part weight
matrix does not fit a 16MB Mongo document (F9 §7.6). **Node owns the
``StorageAdapter``** (F9 §5) — this process holds no provider credentials — so a
later stage that has to *read* that geometry cannot fetch it. ``Buffers.read_f32``
says so by name rather than returning zeros, which is correct and also the end of
the road for a render of any real mesh rig: 512 vertices skinned to 8 bones is
4096 weights, and one more of either externalizes the matrix.

So the caller uploads the bytes with the request, and this module puts them back
into the document in memory. Nothing is written to disk, and the stored document
is untouched — the external reference remains the document's canonical form.

Why the bytes ride as *file* parts
----------------------------------
Starlette caps a non-file multipart part at 1MB and does not cap a file part, so a
weight matrix in the JSON request field would fail at the parser with a message
about kilobytes. As files they are also spooled rather than held, which is the
difference between one resident copy and several.

Each part is named by its own ``sha256``, which is what makes the lookup safe: the
name is derived from the bytes, so a part cannot claim to be a buffer it is not,
and a mismatch is refused rather than stored.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Mapping

import numpy as np

from app.modules.anibuddy.schemas import RigDocument

#: Little-endian numpy dtype per wire ``BufferDtype``. Little-endian because the
#: schema says the hash is over the little-endian bytes, which is what makes a
#: buffer comparable across the three languages regardless of host order.
_NUMPY_DTYPE: Mapping[str, str] = {"f32": "<f4", "u32": "<u4"}

#: The multipart field every uploaded buffer arrives under.
BUFFER_FIELD: str = "buffers"


class BufferSidecarError(ValueError):
    """A referenced buffer was missing, mismatched, or undecodable."""


def _is_external(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("storage") == "external"
        and isinstance(value.get("dtype"), str)
        and isinstance(value.get("sha256"), str)
    )


def _inline(reference: Dict[str, Any], blob: bytes) -> Dict[str, Any]:
    """One external reference plus its bytes, as an inline buffer.

    The hash is checked before the decode, not after: the ``sha256`` is the
    buffer's identity everywhere downstream — it names the object and it keys the
    render cache — so bytes that disagree with it are the wrong bytes, whatever
    they decode to.
    """
    sha256 = str(reference["sha256"])
    actual = hashlib.sha256(blob).hexdigest()
    if actual != sha256:
        raise BufferSidecarError(
            f"The uploaded buffer for {sha256[:12]}… hashes to {actual[:12]}…, so it "
            "is not the geometry this document references."
        )

    dtype = str(reference["dtype"])
    numpy_dtype = _NUMPY_DTYPE.get(dtype)
    if numpy_dtype is None:
        raise BufferSidecarError(f'Buffer {sha256[:12]}… declares unknown dtype "{dtype}".')

    values = np.frombuffer(blob, dtype=numpy_dtype)
    expected = int(reference["length"])
    if values.size != expected:
        raise BufferSidecarError(
            f"The uploaded buffer for {sha256[:12]}… holds {values.size} {dtype} "
            f"value(s) but the document declares {expected}."
        )

    return {
        **reference,
        "storage": "inline",
        "values": [float(value) for value in values.tolist()],
        # The key is kept: it is where these bytes really live, and dropping it
        # would turn a rehydrated copy into a document that looks authored inline
        # and could be stored back as one.
        "storageKey": reference.get("storageKey"),
    }


class BufferSidecar:
    """Put uploaded geometry back into the document that references it."""

    Error = BufferSidecarError

    @staticmethod
    def references(document: RigDocument) -> List[str]:
        """Every external buffer hash the document names, in document order."""
        found: List[str] = []

        def visit(value: Any) -> None:
            if isinstance(value, list):
                for entry in value:
                    visit(entry)
                return
            if not isinstance(value, dict):
                return
            if _is_external(value):
                found.append(str(value["sha256"]))
                return
            for entry in value.values():
                visit(entry)

        visit(document.model_dump())
        return found

    @staticmethod
    def restore(document: RigDocument, original: RigDocument) -> RigDocument:
        """Put back the external references a rehydrate replaced.

        The other end of ``rehydrate``, and not optional. A stage writes its child
        revision by copying the document it was given, so a buffer inlined for the
        stage's own arithmetic would travel back to the caller as inline — turning
        the external reference that exists precisely because the payload does not
        fit a Mongo document into the payload itself.

        Matched by ``sha256``, which is exact rather than heuristic: an external
        buffer is one that exceeded the inline element cap, so a buffer the stage
        *rebuilt* to the same hash is the same bytes and is over the same cap.
        Anything the stage authored fresh keeps whatever storage the stage chose.
        """
        external: Dict[str, Dict[str, Any]] = {}

        def collect(value: Any) -> None:
            if isinstance(value, list):
                for entry in value:
                    collect(entry)
                return
            if not isinstance(value, dict):
                return
            if _is_external(value):
                external[str(value["sha256"])] = value
                return
            for entry in value.values():
                collect(entry)

        collect(original.model_dump())
        if not external:
            return document

        def convert(value: Any) -> Any:
            if isinstance(value, list):
                return [convert(entry) for entry in value]
            if not isinstance(value, dict):
                return value
            if value.get("storage") == "inline" and isinstance(value.get("sha256"), str):
                reference = external.get(str(value["sha256"]))
                if reference is not None:
                    return dict(reference)
                return value
            return {key: convert(entry) for key, entry in value.items()}

        return RigDocument.model_validate(convert(document.model_dump()))

    @staticmethod
    def rehydrate(document: RigDocument, blobs: Mapping[str, bytes]) -> RigDocument:
        """Return the document with every external buffer inlined from ``blobs``.

        Refuses by name when a referenced buffer was not uploaded. The alternative
        — leaving it external and letting the adapter refuse deeper in — turns a
        statement about the request into a 500 about a helper function.
        """
        missing: List[str] = []

        def convert(value: Any) -> Any:
            if isinstance(value, list):
                return [convert(entry) for entry in value]
            if not isinstance(value, dict):
                return value
            if _is_external(value):
                sha256 = str(value["sha256"])
                blob = blobs.get(sha256)
                if blob is None:
                    missing.append(sha256)
                    return value
                return _inline(value, blob)
            return {key: convert(entry) for key, entry in value.items()}

        payload = convert(document.model_dump())
        if missing:
            names = ", ".join(sorted({sha[:12] + "…" for sha in missing}))
            raise BufferSidecarError(
                f"This document references geometry that is not inline and was not "
                f"uploaded with the request: {names}. py_backend holds no storage "
                f"credentials, so the caller must send those buffers as "
                f'"{BUFFER_FIELD}" parts named by their sha256.'
            )

        return RigDocument.model_validate(payload)
