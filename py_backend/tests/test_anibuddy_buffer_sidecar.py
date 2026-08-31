"""Tests for the inbound half of the buffer storage handoff.

An oversized ``NumericBuffer`` leaves the rig stage as a ``StorageAdapter`` key
because it does not fit a Mongo document (F9 §7.6), and this process holds no
credentials to fetch one back (F9 §5). So a stage that has to *read* that geometry
receives the bytes as multipart parts and puts them back in memory. What these
tests pin is that the put-back is content-checked rather than trusted: the part is
named by its own sha256, and a part that does not hash to its name is refused.
"""

from __future__ import annotations

import hashlib
import json
import struct
import unittest

import numpy as np

from app.modules.anibuddy.buffer_sidecar import (
    BUFFER_FIELD,
    BufferSidecar,
    BufferSidecarError,
)
from app.modules.anibuddy.schemas import (
    AssetRef,
    CutLine,
    DeformerMesh,
    Diagnostics,
    DocumentProvenance,
    GenerationSeam,
    MaskRect,
    NumericBuffer,
    Part,
    Rect,
    RevisionLink,
    RigDocument,
    Skeleton,
    Vec2,
)


def _f32_bytes(values) -> bytes:
    return np.asarray(values, dtype="<f4").tobytes()


def _u32_bytes(values) -> bytes:
    return b"".join(struct.pack("<I", int(value)) for value in values)


def _external(raw: bytes, dtype: str, length: int) -> NumericBuffer:
    digest = hashlib.sha256(raw).hexdigest()
    return NumericBuffer(
        dtype=dtype,  # type: ignore[arg-type]
        storage="external",
        length=length,
        sha256=digest,
        values=None,
        storageKey=f"anibuddy/proj/buffers/{digest}.bin",
    )


def _inline(values, dtype: str, raw: bytes) -> NumericBuffer:
    return NumericBuffer(
        dtype=dtype,  # type: ignore[arg-type]
        storage="inline",
        length=len(values),
        sha256=hashlib.sha256(raw).hexdigest(),
        values=[float(value) for value in values],
        storageKey=None,
    )


def _document(verts: NumericBuffer, cut_points: NumericBuffer) -> RigDocument:
    """A one-part rig whose vertices and cut line both live out of band."""
    tri_values = [0, 1, 2]
    now = "2026-08-14T00:00:00Z"
    return RigDocument(
        schemaVersion=5,
        id="rev_1",
        projectId="proj",
        createdAt=now,
        updatedAt=now,
        revision=RevisionLink(index=1, parentRevisionId=None, reason="rig", accepted=False),
        archetype="humanoid",
        asset=AssetRef(
            id="asset_1",
            name="sheet.png",
            storageKey="sheets/aaa",
            contentHash="a" * 64,
            width=64,
            height=64,
            figureHeight=None,
            mimeType="image/png",
            rightsConfirmed=True,
            remoteVisionConsented=False,
        ),
        parts=[
            Part(
                id="torso",
                name="Torso",
                role="torso",
                mask=MaskRect(kind="rect"),
                rect=Rect(x=0.1, y=0.1, width=0.5, height=0.8),
                pivot=Vec2(x=0.5, y=0.1),
                zIndex=0,
                parentPartId=None,
                attachSlot=None,
                slots=[],
                deformer=DeformerMesh(
                    kind="mesh",
                    verts=verts,
                    tris=_inline(tri_values, "u32", _u32_bytes(tri_values)),
                    boneIds=["root->spine"],
                    weights=_inline([1.0, 0.0, 1.0], "f32", _f32_bytes([1.0, 0.0, 1.0])),
                    cuts=[CutLine(id="cut1", points=cut_points)],
                ),
                boundJointId=None,
                visible=True,
                opacity=1.0,
                confidence=0.9,
                provenance="alpha-component",
            )
        ],
        skeleton=Skeleton(joints=[]),
        clips=[],
        generation=GenerationSeam(
            mode="external-prompt-only", prompt=None, transcript=[], producedBy=None
        ),
        provenance=DocumentProvenance(
            pipelineVersion="anibuddy-rig/1", kernelVersion="0.1.0-numpy", stages=[]
        ),
        diagnostics=Diagnostics(
            foregroundPixels=10,
            coveredForegroundPixels=10,
            overlappingPartPairs=[],
            maxStretch=1.0,
            flippedTriangles=0,
            isolatedVertices=0,
            warnings=[],
            blockingReason=None,
        ),
    )


class BufferSidecarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.vert_values = [0.0, 0.0, 1.0, 0.0, 0.5, 1.0]
        self.vert_bytes = _f32_bytes(self.vert_values)
        self.cut_values = [0.2, 0.2, 0.8, 0.8]
        self.cut_bytes = _f32_bytes(self.cut_values)
        self.verts = _external(self.vert_bytes, "f32", len(self.vert_values))
        self.cut = _external(self.cut_bytes, "f32", len(self.cut_values))
        self.document = _document(self.verts, self.cut)

    def _blobs(self) -> dict:
        return {self.verts.sha256: self.vert_bytes, self.cut.sha256: self.cut_bytes}

    def test_every_external_reference_is_found_at_any_depth(self) -> None:
        # The deformer's own payload and a cut line nested inside it.
        self.assertEqual(
            sorted(BufferSidecar.references(self.document)),
            sorted([self.verts.sha256, self.cut.sha256]),
        )

    def test_an_all_inline_document_needs_no_uploads(self) -> None:
        inline = _document(
            _inline(self.vert_values, "f32", self.vert_bytes),
            _inline(self.cut_values, "f32", self.cut_bytes),
        )
        self.assertEqual(BufferSidecar.references(inline), [])
        # And rehydrating it is a no-op rather than an error.
        self.assertEqual(
            BufferSidecar.rehydrate(inline, {}).model_dump_json(), inline.model_dump_json()
        )

    def test_rehydrate_inlines_the_values_and_keeps_the_key(self) -> None:
        rebuilt = BufferSidecar.rehydrate(self.document, self._blobs())
        deformer = rebuilt.parts[0].deformer

        self.assertEqual(deformer.verts.storage, "inline")
        for expected, actual in zip(self.vert_values, deformer.verts.values or []):
            self.assertAlmostEqual(expected, actual, places=6)
        # The hash and the key survive: they say what these bytes are and where
        # they really live, and a rehydrated copy must not read as authored inline.
        self.assertEqual(deformer.verts.sha256, self.verts.sha256)
        self.assertEqual(deformer.verts.storageKey, self.verts.storageKey)
        self.assertEqual(deformer.cuts[0].points.storage, "inline")

    def test_a_missing_upload_is_refused_by_name(self) -> None:
        with self.assertRaises(BufferSidecarError) as caught:
            BufferSidecar.rehydrate(self.document, {self.verts.sha256: self.vert_bytes})
        message = str(caught.exception)
        self.assertIn(self.cut.sha256[:12], message)
        self.assertIn(BUFFER_FIELD, message)

    def test_bytes_that_do_not_hash_to_their_name_are_refused(self) -> None:
        blobs = self._blobs()
        blobs[self.verts.sha256] = _f32_bytes([9.0, 9.0, 9.0, 9.0, 9.0, 9.0])
        with self.assertRaises(BufferSidecarError) as caught:
            BufferSidecar.rehydrate(self.document, blobs)
        self.assertIn("not the geometry this document references", str(caught.exception))

    def test_a_length_disagreement_is_refused(self) -> None:
        short = _f32_bytes([0.0, 0.0])
        document = _document(_external(short, "f32", 6), self.cut)
        with self.assertRaises(BufferSidecarError) as caught:
            BufferSidecar.rehydrate(
                document,
                {
                    hashlib.sha256(short).hexdigest(): short,
                    self.cut.sha256: self.cut_bytes,
                },
            )
        self.assertIn("but the document declares 6", str(caught.exception))


class BufferSidecarRestoreTests(unittest.TestCase):
    """The way back: a rehydrated buffer must not travel out as inline."""

    def setUp(self) -> None:
        self.vert_values = [0.0, 0.0, 1.0, 0.0, 0.5, 1.0]
        self.vert_bytes = _f32_bytes(self.vert_values)
        self.cut_values = [0.2, 0.2, 0.8, 0.8]
        self.cut_bytes = _f32_bytes(self.cut_values)
        self.original = _document(
            _external(self.vert_bytes, "f32", len(self.vert_values)),
            _inline(self.cut_values, "f32", self.cut_bytes),
        )

    def test_a_round_trip_returns_the_document_it_started_as(self) -> None:
        rehydrated = BufferSidecar.rehydrate(
            self.original,
            {hashlib.sha256(self.vert_bytes).hexdigest(): self.vert_bytes},
        )
        self.assertEqual(rehydrated.parts[0].deformer.verts.storage, "inline")

        restored = BufferSidecar.restore(rehydrated, self.original)
        self.assertEqual(restored.model_dump_json(), self.original.model_dump_json())

    def test_a_buffer_the_stage_authored_keeps_the_storage_it_chose(self) -> None:
        # A fresh inline buffer with a hash the original never referenced is the
        # stage's own work, and is left exactly as the stage wrote it.
        fresh_values = [0.1, 0.2]
        rebuilt = _document(
            _external(self.vert_bytes, "f32", len(self.vert_values)),
            _inline(fresh_values, "f32", _f32_bytes(fresh_values)),
        )
        restored = BufferSidecar.restore(rebuilt, self.original)
        self.assertEqual(restored.parts[0].deformer.cuts[0].points.storage, "inline")
        self.assertEqual(restored.parts[0].deformer.cuts[0].points.values, fresh_values)

    def test_a_document_with_no_external_input_is_returned_untouched(self) -> None:
        inline = _document(
            _inline(self.vert_values, "f32", self.vert_bytes),
            _inline(self.cut_values, "f32", self.cut_bytes),
        )
        self.assertEqual(
            BufferSidecar.restore(inline, inline).model_dump_json(), inline.model_dump_json()
        )


class BufferSidecarEndpointTests(unittest.TestCase):
    """The rig endpoint, over the multipart field the gateway really posts to."""

    def _client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from app.modules.anibuddy.router import router

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    def _payload(self) -> tuple[dict, bytes, str]:
        cut_values = [0.2, 0.2, 0.8, 0.8]
        cut_bytes = _f32_bytes(cut_values)
        vert_values = [0.0, 0.0, 1.0, 0.0, 0.5, 1.0]
        document = _document(
            _inline(vert_values, "f32", _f32_bytes(vert_values)),
            _external(cut_bytes, "f32", len(cut_values)),
        )
        body = {
            "document": json.loads(document.model_dump_json()),
            "revisionId": "rev_sidecar",
        }
        return body, cut_bytes, hashlib.sha256(cut_bytes).hexdigest()

    def _envelope(self, body: dict) -> tuple:
        """The request envelope as a multipart file part.

        A file part, not a form field: Starlette caps a non-file part at 1 MB, and a
        document that references external geometry is exactly the kind that grows
        past it — sending geometry out of band bounds each buffer, not the document.
        """
        return ("request.json", json.dumps(body).encode("utf-8"), "application/json")

    def test_a_document_with_external_geometry_and_no_upload_is_a_422(self) -> None:
        body, _bytes, sha256 = self._payload()
        response = self._client().post(
            "/anibuddy/rig", files={"request": self._envelope(body)}
        )
        self.assertEqual(response.status_code, 422)
        detail = response.json()["detail"]
        self.assertIn(sha256[:12], detail)
        self.assertIn(BUFFER_FIELD, detail)

    def test_the_uploaded_buffer_lets_the_same_request_through(self) -> None:
        body, raw, sha256 = self._payload()
        response = self._client().post(
            "/anibuddy/rig",
            files=[
                ("request", self._envelope(body)),
                # Named by its own hash, which is how the sidecar matches it to the
                # reference in the document.
                (BUFFER_FIELD, (sha256, raw, "application/octet-stream")),
            ],
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["document"]["id"], "rev_sidecar")

        # And the buffer it uploaded comes back as a reference rather than as
        # values: the child revision is stored, and the reference is why the
        # payload is not.
        cuts = body["document"]["parts"][0]["deformer"].get("cuts", [])
        for cut in cuts:
            if cut["points"]["sha256"] == sha256:
                self.assertEqual(cut["points"]["storage"], "external")
                self.assertIsNone(cut["points"]["values"])


if __name__ == "__main__":
    unittest.main()
