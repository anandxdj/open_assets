"""Content-hash keying and the worker-local artifact memo.

Idempotence, the way the other stages have it
---------------------------------------------
F9 §7.3 and §7.9: every stage is idempotent on a hash of its canonicalized
input, and an equal hash lets the worker return the cached artifact rather than
recomputing. Render is the stage where that matters most, because it is the only
one whose cost scales with *frames* rather than with parts.

What the key covers, and why that list
--------------------------------------
Everything that can change a pixel: the asset's content hash and dimensions, the
joint tree, every part's geometry payload (by ``NumericBuffer.sha256``, which the
schema exists to make possible), the mask that gates its pixels, the clip, and
the render options.

``Part.pivot``, ``Part.parentPartId`` and ``Part.attachSlot`` were folded in
before the part transform tree existed, on the reasoning that a spurious
re-render is cheap and a stale export the user believes is correct is not. That
paid off: when the tree landed in the kernel, the key already covered its
inputs, so no project could serve a pre-tree artifact for a document that now
renders differently.

``CACHE_KEY_VERSION`` is the other half of that contract, and it covers what a
content hash structurally cannot: a change in what the same inputs *mean*. The
part tree was exactly that — no keyed field changed, but the pixels did — so it
bumped the tag to ``render-cache/2``. Any change to the rasterizer, an encoder,
or the interpretation of a keyed field must bump it too.

``render-cache/3`` is the schema/kernel reconciliation, and it is a textbook
case of what the tag is for: a lattice's ``controlPoints`` buffer hashes to the
same sha256 as before and is now read as absolute positions rather than
differenced against a rest grid; a spline's ``thickness`` buffer is unchanged
and is now a taper track rather than a set of values to average; ``boundJointId
: null`` now rides the root rather than nothing. Every one of those moves pixels
without moving a single keyed byte.

Scope
-----
This memo is worker-local and deliberately small. It is not the system of
record: Node owns the ``StorageAdapter``, and the content-addressed
``suggestedStorageKey`` plus its ``artifactRefs`` entry are what survive a
restart. What this buys is the common case of re-requesting a render that was
just produced — a critique pass asking for a contact sheet of a clip it has
already seen, or a client retrying after a timeout — costing nothing.
"""

from __future__ import annotations

import hashlib
import json
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from app.modules.anibuddy.constants import RenderConstants
from app.modules.anibuddy.render.types import RenderArtifact, RenderOptions
from app.modules.anibuddy.schemas import (
    Clip,
    DeformerLattice,
    DeformerMesh,
    DeformerRigid,
    DeformerSpline,
    MaskAlphaThreshold,
    MaskPolygon,
    MaskRect,
    MaskRle,
    NumericBuffer,
    Part,
    RigDocument,
)


def _buffer_key(buffer: NumericBuffer) -> List[Any]:
    """A buffer's identity, without its contents.

    ``sha256`` is over the little-endian bytes and is exactly what §7.6 says it
    is for: making render caching possible. Hashing the values again here would
    be both slower and less trustworthy, because it would hash the JSON
    round-trip rather than the canonical bytes.
    """
    return [buffer.dtype, buffer.length, buffer.sha256]


def _mask_key(part: Part) -> List[Any]:
    """The mask's contribution, which is real: it gates the part's pixels."""
    mask = part.mask
    if isinstance(mask, MaskRect):
        return ["rect"]
    if isinstance(mask, MaskAlphaThreshold):
        return ["alpha-threshold", mask.threshold]
    if isinstance(mask, MaskPolygon):
        return [
            "polygon",
            _buffer_key(mask.outline),
            [_buffer_key(hole) for hole in mask.holes],
        ]
    if isinstance(mask, MaskRle):
        return [
            "rle",
            mask.origin.x,
            mask.origin.y,
            mask.width,
            mask.height,
            _buffer_key(mask.counts),
        ]
    return ["unknown", mask.kind]  # pragma: no cover - the union is closed


def _deformer_key(part: Part) -> List[Any]:
    deformer = part.deformer
    if isinstance(deformer, DeformerRigid):
        return ["rigid"]
    if isinstance(deformer, DeformerMesh):
        return [
            "mesh",
            _buffer_key(deformer.verts),
            _buffer_key(deformer.tris),
            list(deformer.boneIds),
            _buffer_key(deformer.weights),
            [[cut.id, _buffer_key(cut.points)] for cut in deformer.cuts],
        ]
    if isinstance(deformer, DeformerLattice):
        return [
            "lattice",
            deformer.cols,
            deformer.rows,
            deformer.interpolation,
            _buffer_key(deformer.controlPoints),
        ]
    if isinstance(deformer, DeformerSpline):
        # No control polyline to key: a spline's spine is its joint chain, and
        # the joints are already keyed above. Dropping the stored bezier from
        # the schema therefore made this key MORE complete, not less — it no
        # longer covers a field that could change without changing a pixel.
        return ["spline", deformer.samples, _buffer_key(deformer.thickness)]
    return ["unknown", deformer.kind]  # pragma: no cover - the union is closed


def _part_key(part: Part) -> List[Any]:
    return [
        part.id,
        part.zIndex,
        part.visible,
        part.opacity,
        [part.rect.x, part.rect.y, part.rect.width, part.rect.height],
        [part.pivot.x, part.pivot.y],
        part.parentPartId,
        part.attachSlot,
        part.boundJointId,
        _mask_key(part),
        _deformer_key(part),
    ]


def _clip_key(clip: Optional[Clip]) -> Any:
    """The clip, keyframe by keyframe.

    Sparsity is preserved through ``exclude_none``: a key that sets ``rot`` to 0
    and a key that does not mention ``rot`` at all are different animations, so
    they must be different cache keys. Dumping with defaults filled in would make
    them identical.
    """
    if clip is None:
        return None
    return [
        clip.id,
        clip.loop,
        clip.fps,
        clip.frameCount,
        [
            [
                key.t,
                key.ease,
                {
                    joint_id: pose.model_dump(exclude_none=True)
                    for joint_id, pose in sorted(key.joints.items())
                },
                {
                    part_id: pose.model_dump(exclude_none=True)
                    for part_id, pose in sorted(key.parts.items())
                },
            ]
            for key in clip.keyframes
        ],
    ]


def _options_key(options: RenderOptions) -> List[Any]:
    return [
        options.fmt,
        options.fps,
        options.frame_count,
        options.loop,
        options.surface.width,
        options.surface.height,
        options.background,
    ]


class RenderCache:
    """Cache key derivation plus a bounded worker-local artifact store."""

    #: Insertion-ordered so the oldest entry is the first to be evicted. A dict
    #: on the class rather than a module global so the eviction policy and the
    #: storage cannot be reached independently of each other.
    _entries: "OrderedDict[str, RenderArtifact]" = OrderedDict()
    _bytes: int = 0

    @staticmethod
    def key(
        document: RigDocument,
        clip: Optional[Clip],
        options: RenderOptions,
    ) -> str:
        """SHA-256 over the canonicalized render input.

        ``sort_keys`` plus the tightest separators, so the same inputs produce
        the same bytes regardless of dict insertion order or Python version.
        Lists stay ordered because their order is meaningful — joint order
        indexes weight columns, and part order breaks a z-index tie.
        """
        payload: Dict[str, Any] = {
            "version": RenderConstants.CACHE_KEY_VERSION,
            "rasterizer": RenderConstants.RASTERIZER,
            "kernel": RenderConstants.KERNEL_VERSION,
            "asset": [
                document.asset.contentHash,
                document.asset.width,
                document.asset.height,
                # figureHeight scales every tx/ty channel and every spline
                # ribbon, so two revisions of one sheet that measured the figure
                # differently are two different animations of the same pixels.
                document.asset.figureHeight,
            ],
            "joints": [
                [joint.id, joint.parent, joint.x, joint.y, joint.partId]
                for joint in document.skeleton.joints
            ],
            "parts": [_part_key(part) for part in document.parts],
            "clip": _clip_key(clip),
            "options": _options_key(options),
        }
        canonical = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def get(key: str) -> Optional[RenderArtifact]:
        """Fetch and mark as most recently used."""
        artifact = RenderCache._entries.get(key)
        if artifact is None:
            return None
        RenderCache._entries.move_to_end(key)
        return artifact

    @staticmethod
    def put(key: str, artifact: RenderArtifact) -> None:
        """Store, then evict until both caps hold.

        An artifact larger than the whole byte budget is not stored at all
        rather than evicting everything to hold one entry that will itself be
        evicted by the next render.
        """
        if artifact.byte_length > RenderConstants.CACHE_MAX_BYTES:
            return
        existing = RenderCache._entries.pop(key, None)
        if existing is not None:
            RenderCache._bytes -= existing.byte_length

        RenderCache._entries[key] = artifact
        RenderCache._bytes += artifact.byte_length

        while RenderCache._entries and (
            len(RenderCache._entries) > RenderConstants.CACHE_MAX_ENTRIES
            or RenderCache._bytes > RenderConstants.CACHE_MAX_BYTES
        ):
            _, evicted = RenderCache._entries.popitem(last=False)
            RenderCache._bytes -= evicted.byte_length

    @staticmethod
    def clear() -> None:
        """Drop everything. Exists for tests and for a config reload."""
        RenderCache._entries.clear()
        RenderCache._bytes = 0

    @staticmethod
    def stats() -> Dict[str, int]:
        """Entry count and resident bytes, for a health or debug surface."""
        return {
            "entries": len(RenderCache._entries),
            "bytes": RenderCache._bytes,
        }
