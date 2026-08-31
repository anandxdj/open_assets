"""The layered-cutout part tree: validation, and the world transform per part.

Mirrored by ``frontend/src/features/anibuddy/kernel/parts.ts``.

What this module decides
------------------------
A part is driven by two independent things and this file owns the second one:

1. Its **deformer**, which shapes the artwork against the JOINT skeleton
   (``deformers.py``). A rigid part rides a bound joint, a mesh part is skinned
   to bones, a lattice rides a joint with its grid displaced, a spline follows
   a joint chain. None of that changes here.
2. Its **place in the part tree** -- ``parentPartId``, ``pivot``, ``attachSlot``
   and ``slots`` -- which carries the whole shaped layer as a unit.

Composition order, stated once
------------------------------
::

    dst = World(P) . Deformer(P, skeleton)

    World(P)  = World(parent(P)) . Local(P)          , parent exists
              = Local(P)                             , P is a root part

    Local(P)  = affine_about_scaled(
                    rest    = pivot_pixels(P),
                    posed   = anchor_pixels(P) + (tx * figure_height,
                                                  ty * figure_height),
                    degrees = rot,
                    scale   = scale)

    anchor_pixels(P) = slot_pixels(parent(P), attachSlot)  , attachSlot is set
                     = pivot_pixels(P)                     , otherwise

**The part tree composes on the OUTSIDE of the deformer, never inside it.**
Three reasons, in the order they matter:

* A mesh part has no single joint transform to compose with -- it has one per
  bone, blended per vertex. Only an outer transform is expressible for all four
  deformers, and the whole value of the deformer abstraction is that the layers
  above it do not branch on which one a part chose.
* The two transforms answer different questions. The deformer answers "what
  shape is this artwork in?"; the tree answers "where is this layer?". Folding
  a layer move into the skinning input would make it bend the mesh instead of
  moving it.
* Ordering it the other way would apply the joint's rotation to the part's own
  translation, so a `tx` authored against the figure would drift as the bound
  joint turned -- and `tx` is defined as a figure-height fraction (R6), which
  is a statement about the figure, not about the bone.

A part therefore may be driven by a bound joint, by a parent part, or by both,
and "both" means the joint deforms it and the tree then carries the result.

Why the pivot is a REST point
-----------------------------
``Local(P)`` rotates about the part's pivot in REST source pixels, not about
where the deformer has moved the pivot to. That is deliberate: the tree's job
is to place a layer, and a layer's rotation centre is a property of the artwork
(a wheel's axle, a hip) rather than of the current frame. It also keeps
``Local(P)`` independent of the skeleton solve, which is what makes the tree
solvable once per frame instead of once per part per deformer.

Slots and their frame of reference
----------------------------------
A ``Slot`` is a POSITION and nothing more: part-local normalized against the
host's ``rect``, carried by the host's own ``World`` transform. Its basis --
rotation and uniform scale -- is the host's; it has none of its own. So the
slot's world frame is ``(origin = World(host) . slot_rest, basis =
linear(World(host)))``.

What naming a slot *does* is **re-anchor** the child: the child's pivot is
placed on the slot, at rest and under pose. That is the entire reason the field
exists -- "a sword moves from hand to back without either part learning the
other's geometry" (F9 §7.4) only reads as true if pointing the sword at the
back slot moves the sword. Note that re-anchoring is the only thing a slot can
contribute: for a similarity transform, being "carried about the slot" and
being "carried about any other point of the host" are the same map, so a slot
that did not move the child would be decorative.

``attachSlot: null`` therefore keeps the child exactly where the artist drew
it, merely carried by the parent. Attaching is an explicit act with a visible
consequence; parenting alone is not.

Refuse, never repair
--------------------
Every structural fault below raises ``KernelInputError``: an unknown parent, a
cycle, a chain deeper than ``MAX_PART_DEPTH``, a duplicate part id, a duplicate
or over-budget slot, an ``attachSlot`` naming a slot the parent does not offer,
and an ``attachSlot`` on a part with no parent. This is the same philosophy
``skeleton.py`` applies to the joint graph, for the same reason: a partially
repaired tree renders a rig that looks plausible and animates wrongly, and the
caller has no way to tell that the kernel guessed.
"""

from __future__ import annotations

from .constants import KernelConstants
from .skin import Skin
from .types import (
    Asset,
    KernelInputError,
    Part,
    PartPose,
    PartPoseMap,
    PartTransform,
    Slot,
)

#: Shared immutable "no delta" pose, so the solve does not allocate one per
#: part per frame.
_REST_POSE = PartPose()


class PartTree:
    """Pure functions over the part list. No state, no I/O."""

    __slots__ = ()

    # --- Coordinate lifts ---------------------------------------------------

    @staticmethod
    def local_to_pixels(
        part: Part,
        x: float,
        y: float,
        asset: Asset,
    ) -> tuple[float, float]:
        """Part-local normalized to SOURCE PIXELS, through the part's rect.

        Two lifts in one expression, in this order: part-local to
        sheet-normalized through ``rect``, then sheet-normalized to pixels
        through the asset. Written as ``(x0 + u * (x1 - x0)) * width`` in both
        kernels; distributing it would change the last bit.
        """

        x0, y0, x1, y1 = part.rect
        return (
            (x0 + x * (x1 - x0)) * float(asset.width),
            (y0 + y * (y1 - y0)) * float(asset.height),
        )

    @staticmethod
    def pivot_pixels(part: Part, asset: Asset) -> tuple[float, float]:
        """The part's rotation and scale centre, in rest source pixels."""

        return PartTree.local_to_pixels(part, part.pivot[0], part.pivot[1], asset)

    @staticmethod
    def slot_pixels(host: Part, slot: Slot, asset: Asset) -> tuple[float, float]:
        """A slot's rest position, in source pixels of the HOST's local space."""

        return PartTree.local_to_pixels(host, slot.x, slot.y, asset)

    # --- Validation ---------------------------------------------------------

    @staticmethod
    def validate(parts: tuple[Part, ...]) -> dict[str, Part]:
        """Index the parts by id, refusing any structurally invalid tree.

        Returns the index because every caller needs one and building it is
        where the duplicate-id check falls out for free.
        """

        by_id: dict[str, Part] = {}
        for part in parts:
            if part.id in by_id:
                raise KernelInputError(
                    f'Two parts share the id "{part.id}". Part ids key the '
                    "transform tree and the pose channels, so a duplicate makes "
                    "both ambiguous."
                )
            by_id[part.id] = part

        for part in parts:
            PartTree._validate_slots(part)
            PartTree._validate_attachment(part, by_id)
            PartTree._validate_depth(part, by_id)
        return by_id

    @staticmethod
    def _validate_slots(part: Part) -> None:
        if len(part.slots) > KernelConstants.MAX_SLOTS_PER_PART:
            raise KernelInputError(
                f'Part "{part.id}" offers {len(part.slots)} slots, over the '
                f"limit of {KernelConstants.MAX_SLOTS_PER_PART}."
            )
        seen: set[str] = set()
        for slot in part.slots:
            if slot.name in seen:
                raise KernelInputError(
                    f'Part "{part.id}" offers two slots named "{slot.name}". A '
                    "child names a slot by name, so a duplicate has no answer."
                )
            seen.add(slot.name)

    @staticmethod
    def _validate_attachment(part: Part, by_id: dict[str, Part]) -> None:
        if part.parent_part_id is None:
            if part.attach_slot is not None:
                raise KernelInputError(
                    f'Part "{part.id}" attaches to slot "{part.attach_slot}" but '
                    "has no parent part to find it on."
                )
            return

        parent = by_id.get(part.parent_part_id)
        if parent is None:
            raise KernelInputError(
                f'Part "{part.id}" is parented to "{part.parent_part_id}", which '
                "is not a part of this rig. Refusing rather than promoting it to "
                "a root, because a root part is a different animation."
            )
        if part.parent_part_id == part.id:
            raise KernelInputError(f'Part "{part.id}" is its own transform parent.')
        if part.attach_slot is not None and PartTree.find_slot(parent, part.attach_slot) is None:
            offered = ", ".join(slot.name for slot in parent.slots) or "none"
            raise KernelInputError(
                f'Part "{part.id}" attaches to slot "{part.attach_slot}" on '
                f'"{parent.id}", which offers: {offered}.'
            )

    @staticmethod
    def _validate_depth(part: Part, by_id: dict[str, Part]) -> None:
        """Walk to the root, refusing a cycle or an over-deep chain.

        Depth is counted in EDGES, so a root part is 0. The walk is bounded by
        ``MAX_PART_DEPTH`` and therefore terminates on a cycle too -- but the
        two are reported separately, because "you made a loop" and "your tree is
        too tall" are different mistakes with different fixes.
        """

        seen = {part.id}
        cursor = part
        depth = 0
        while cursor.parent_part_id is not None:
            depth += 1
            if depth > KernelConstants.MAX_PART_DEPTH:
                raise KernelInputError(
                    f'Part "{part.id}" sits deeper than '
                    f"{KernelConstants.MAX_PART_DEPTH} levels in the part tree."
                )
            if cursor.parent_part_id in seen:
                raise KernelInputError(
                    f'The part tree has a cycle through "{cursor.parent_part_id}".'
                )
            seen.add(cursor.parent_part_id)
            # Resolution is guaranteed by ``_validate_attachment`` having run
            # over every part before any depth walk starts.
            cursor = by_id[cursor.parent_part_id]

    @staticmethod
    def find_slot(part: Part, name: str) -> Slot | None:
        """The named slot, or None. Linear: a part offers at most eight."""

        for slot in part.slots:
            if slot.name == name:
                return slot
        return None

    # --- Solve --------------------------------------------------------------

    @staticmethod
    def local_transform(
        part: Part,
        parent: Part | None,
        asset: Asset,
        pose: PartPose,
    ) -> PartTransform:
        """The part's own transform, before its parent chain carries it.

        Rotation and uniform scale about the part's pivot; translation in
        figure-height fractions, matching the joint convention exactly (R6).
        When the part is attached to a slot, the pivot lands ON the slot instead
        of on its authored position -- see the module docstring for why that is
        the only thing a slot can meaningfully contribute.
        """

        pivot = PartTree.pivot_pixels(part, asset)
        anchor = pivot
        if parent is not None and part.attach_slot is not None:
            slot = PartTree.find_slot(parent, part.attach_slot)
            if slot is not None:
                anchor = PartTree.slot_pixels(parent, slot, asset)

        figure_height = float(asset.figure_height)
        posed = (
            anchor[0] + pose.tx_or_rest * figure_height,
            anchor[1] + pose.ty_or_rest * figure_height,
        )
        return Skin.affine_about_scaled(
            pivot, posed, pose.rot_or_rest, pose.scale_or_rest
        )

    @staticmethod
    def solve(
        parts: tuple[Part, ...],
        asset: Asset,
        part_pose: PartPoseMap,
    ) -> dict[str, PartTransform]:
        """World transform per part id, with the tree validated first.

        Evaluation order is part of the parity contract. Parts are visited in
        RIG ORDER; for each, the unsolved chain up to its nearest already-solved
        ancestor is collected and then composed root-first. Every part's
        transform therefore depends only on its own chain, and the sequence in
        which ``compose`` runs is identical in both kernels regardless of how
        the author ordered the list.

        A rig whose parts are all at rest and unparented resolves to
        ``Skin.IDENTITY`` for every part, exactly -- see ``Skin.compose``.
        """

        by_id = PartTree.validate(parts)
        world: dict[str, PartTransform] = {}

        for part in parts:
            chain: list[Part] = []
            cursor: Part | None = part
            while cursor is not None and cursor.id not in world:
                chain.append(cursor)
                cursor = (
                    None
                    if cursor.parent_part_id is None
                    else by_id[cursor.parent_part_id]
                )

            for node in reversed(chain):
                parent = (
                    None
                    if node.parent_part_id is None
                    else by_id[node.parent_part_id]
                )
                local = PartTree.local_transform(
                    node, parent, asset, part_pose.get(node.id, _REST_POSE)
                )
                world[node.id] = (
                    local
                    if parent is None
                    else Skin.compose(world[parent.id], local)
                )

        return world
