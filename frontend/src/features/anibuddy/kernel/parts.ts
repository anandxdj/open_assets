// The layered-cutout part tree: validation, and the world transform per part.
//
// Mirrored by py_backend/app/modules/anibuddy/kernel/parts.py.
//
// What this module decides
// ------------------------
// A part is driven by two independent things and this file owns the second one:
//
//   1. Its **deformer**, which shapes the artwork against the JOINT skeleton
//      (deformers.ts). A rigid part rides a bound joint, a mesh part is skinned
//      to bones, a lattice rides a joint with its grid displaced, a spline
//      follows a joint chain. None of that changes here.
//   2. Its **place in the part tree** -- parentPartId, pivot, attachSlot and
//      slots -- which carries the whole shaped layer as a unit.
//
// Composition order, stated once
// ------------------------------
//
//   dst = World(P) . Deformer(P, skeleton)
//
//   World(P)  = World(parent(P)) . Local(P)        , parent exists
//             = Local(P)                           , P is a root part
//
//   Local(P)  = affineAboutScaled(
//                   rest    = pivotPixels(P),
//                   posed   = anchorPixels(P) + (tx * figureHeight,
//                                                ty * figureHeight),
//                   degrees = rot,
//                   scale   = scale)
//
//   anchorPixels(P) = slotPixels(parent(P), attachSlot)  , attachSlot is set
//                   = pivotPixels(P)                     , otherwise
//
// **The part tree composes on the OUTSIDE of the deformer, never inside it.**
// Three reasons, in the order they matter:
//
//   - A mesh part has no single joint transform to compose with -- it has one
//     per bone, blended per vertex. Only an outer transform is expressible for
//     all four deformers, and the whole value of the deformer abstraction is
//     that the layers above it do not branch on which one a part chose.
//   - The two transforms answer different questions. The deformer answers "what
//     shape is this artwork in?"; the tree answers "where is this layer?".
//     Folding a layer move into the skinning input would make it bend the mesh
//     instead of moving it.
//   - Ordering it the other way would apply the joint's rotation to the part's
//     own translation, so a `tx` authored against the figure would drift as the
//     bound joint turned -- and `tx` is defined as a figure-height fraction
//     (R6), which is a statement about the figure, not about the bone.
//
// A part therefore may be driven by a bound joint, by a parent part, or by
// both, and "both" means the joint deforms it and the tree then carries the
// result.
//
// Why the pivot is a REST point
// -----------------------------
// Local(P) rotates about the part's pivot in REST source pixels, not about
// where the deformer has moved the pivot to. That is deliberate: the tree's job
// is to place a layer, and a layer's rotation centre is a property of the
// artwork (a wheel's axle, a hip) rather than of the current frame. It also
// keeps Local(P) independent of the skeleton solve, which is what makes the
// tree solvable once per frame instead of once per part per deformer.
//
// Slots and their frame of reference
// ----------------------------------
// A Slot is a POSITION and nothing more: part-local normalized against the
// host's `rect`, carried by the host's own World transform. Its basis --
// rotation and uniform scale -- is the host's; it has none of its own. So the
// slot's world frame is (origin = World(host) . slotRest,
// basis = linear(World(host))).
//
// What naming a slot *does* is **re-anchor** the child: the child's pivot is
// placed on the slot, at rest and under pose. That is the entire reason the
// field exists -- "a sword moves from hand to back without either part learning
// the other's geometry" (F9 §7.4) only reads as true if pointing the sword at
// the back slot moves the sword. Note that re-anchoring is the only thing a
// slot can contribute: for a similarity transform, being "carried about the
// slot" and being "carried about any other point of the host" are the same map,
// so a slot that did not move the child would be decorative.
//
// `attachSlot: null` therefore keeps the child exactly where the artist drew
// it, merely carried by the parent. Attaching is an explicit act with a visible
// consequence; parenting alone is not.
//
// Refuse, never repair
// --------------------
// Every structural fault below throws KernelInputError: an unknown parent, a
// cycle, a chain deeper than MAX_PART_DEPTH, a duplicate part id, a duplicate
// or over-budget slot, an attachSlot naming a slot the parent does not offer,
// and an attachSlot on a part with no parent. This is the same philosophy
// skeleton.ts applies to the joint graph, for the same reason: a partially
// repaired tree renders a rig that looks plausible and animates wrongly, and
// the caller has no way to tell that the kernel guessed.

import { KernelConstants } from "./constants";
import { Skin } from "./skin";
import {
  KernelInputError,
  type Asset,
  type Part,
  type PartPose,
  type PartPoseMap,
  type PartTransform,
  type Point,
  type Slot,
} from "./types";

/** Shared immutable "no delta" pose, so the solve allocates nothing per part. */
const REST_POSE: PartPose = Object.freeze({});

/** Shared empty slot list, so an unset `slots` needs no allocation to read. */
const NO_SLOTS: readonly Slot[] = Object.freeze([]);

function rotOrRest(pose: PartPose): number {
  return pose.rot === undefined ? KernelConstants.REST_DEFAULT : pose.rot;
}

function txOrRest(pose: PartPose): number {
  return pose.tx === undefined ? KernelConstants.REST_DEFAULT : pose.tx;
}

function tyOrRest(pose: PartPose): number {
  return pose.ty === undefined ? KernelConstants.REST_DEFAULT : pose.ty;
}

function scaleOrRest(pose: PartPose): number {
  return pose.scale === undefined ? KernelConstants.REST_SCALE : pose.scale;
}

function rectOf(part: Part): readonly [number, number, number, number] {
  return part.rect ?? KernelConstants.FULL_SHEET_RECT;
}

function pivotOf(part: Part): readonly [number, number] {
  return part.pivot ?? KernelConstants.DEFAULT_PIVOT;
}

function slotsOf(part: Part): readonly Slot[] {
  return part.slots ?? NO_SLOTS;
}

function parentIdOf(part: Part): string | null {
  return part.parentPartId ?? null;
}

function attachSlotOf(part: Part): string | null {
  return part.attachSlot ?? null;
}

export const PartTree = {
  // --- Coordinate lifts -----------------------------------------------------

  /**
   * Part-local normalized to SOURCE PIXELS, through the part's rect.
   *
   * Two lifts in one expression, in this order: part-local to sheet-normalized
   * through `rect`, then sheet-normalized to pixels through the asset. Written
   * as `(x0 + u * (x1 - x0)) * width` in both kernels; distributing it would
   * change the last bit.
   */
  localToPixels(part: Part, x: number, y: number, asset: Asset): Point {
    const [x0, y0, x1, y1] = rectOf(part);
    return {
      x: (x0 + x * (x1 - x0)) * asset.width,
      y: (y0 + y * (y1 - y0)) * asset.height,
    };
  },

  /** The part's rotation and scale centre, in rest source pixels. */
  pivotPixels(part: Part, asset: Asset): Point {
    const pivot = pivotOf(part);
    return PartTree.localToPixels(part, pivot[0], pivot[1], asset);
  },

  /** A slot's rest position, in source pixels of the HOST's local space. */
  slotPixels(host: Part, slot: Slot, asset: Asset): Point {
    return PartTree.localToPixels(host, slot.x, slot.y, asset);
  },

  /** The named slot, or null. Linear: a part offers at most eight. */
  findSlot(part: Part, name: string): Slot | null {
    for (const slot of slotsOf(part)) {
      if (slot.name === name) return slot;
    }
    return null;
  },

  // --- Validation -----------------------------------------------------------

  /**
   * Index the parts by id, refusing any structurally invalid tree.
   *
   * Returns the index because every caller needs one and building it is where
   * the duplicate-id check falls out for free.
   */
  validate(parts: readonly Part[]): Map<string, Part> {
    const byId = new Map<string, Part>();
    for (const part of parts) {
      if (byId.has(part.id)) {
        throw new KernelInputError(
          `Two parts share the id "${part.id}". Part ids key the transform tree ` +
            `and the pose channels, so a duplicate makes both ambiguous.`,
        );
      }
      byId.set(part.id, part);
    }

    for (const part of parts) {
      PartTree._validateSlots(part);
      PartTree._validateAttachment(part, byId);
      PartTree._validateDepth(part, byId);
    }
    return byId;
  },

  // Internal method — slot budget and name uniqueness on one part.
  _validateSlots(part: Part): void {
    const slots = slotsOf(part);
    if (slots.length > KernelConstants.MAX_SLOTS_PER_PART) {
      throw new KernelInputError(
        `Part "${part.id}" offers ${slots.length} slots, over the limit of ` +
          `${KernelConstants.MAX_SLOTS_PER_PART}.`,
      );
    }
    const seen = new Set<string>();
    for (const slot of slots) {
      if (seen.has(slot.name)) {
        throw new KernelInputError(
          `Part "${part.id}" offers two slots named "${slot.name}". A child ` +
            `names a slot by name, so a duplicate has no answer.`,
        );
      }
      seen.add(slot.name);
    }
  },

  // Internal method — the parent link and the slot it names must both resolve.
  _validateAttachment(part: Part, byId: Map<string, Part>): void {
    const parentId = parentIdOf(part);
    const attachSlot = attachSlotOf(part);
    if (parentId === null) {
      if (attachSlot !== null) {
        throw new KernelInputError(
          `Part "${part.id}" attaches to slot "${attachSlot}" but has no parent ` +
            `part to find it on.`,
        );
      }
      return;
    }

    const parent = byId.get(parentId);
    if (parent === undefined) {
      throw new KernelInputError(
        `Part "${part.id}" is parented to "${parentId}", which is not a part of ` +
          `this rig. Refusing rather than promoting it to a root, because a root ` +
          `part is a different animation.`,
      );
    }
    if (parentId === part.id) {
      throw new KernelInputError(`Part "${part.id}" is its own transform parent.`);
    }
    if (attachSlot !== null && PartTree.findSlot(parent, attachSlot) === null) {
      const offered = slotsOf(parent)
        .map((slot) => slot.name)
        .join(", ");
      throw new KernelInputError(
        `Part "${part.id}" attaches to slot "${attachSlot}" on "${parent.id}", ` +
          `which offers: ${offered || "none"}.`,
      );
    }
  },

  /**
   * Internal method — walk to the root, refusing a cycle or an over-deep chain.
   *
   * Depth is counted in EDGES, so a root part is 0. The walk is bounded by
   * MAX_PART_DEPTH and therefore terminates on a cycle too -- but the two are
   * reported separately, because "you made a loop" and "your tree is too tall"
   * are different mistakes with different fixes.
   */
  _validateDepth(part: Part, byId: Map<string, Part>): void {
    const seen = new Set<string>([part.id]);
    let cursor = part;
    let depth = 0;
    let parentId = parentIdOf(cursor);
    while (parentId !== null) {
      depth += 1;
      if (depth > KernelConstants.MAX_PART_DEPTH) {
        throw new KernelInputError(
          `Part "${part.id}" sits deeper than ${KernelConstants.MAX_PART_DEPTH} ` +
            `levels in the part tree.`,
        );
      }
      if (seen.has(parentId)) {
        throw new KernelInputError(`The part tree has a cycle through "${parentId}".`);
      }
      seen.add(parentId);
      // Resolution is guaranteed by _validateAttachment having run over every
      // part before any depth walk starts.
      cursor = byId.get(parentId)!;
      parentId = parentIdOf(cursor);
    }
  },

  // --- Solve ----------------------------------------------------------------

  /**
   * The part's own transform, before its parent chain carries it.
   *
   * Rotation and uniform scale about the part's pivot; translation in
   * figure-height fractions, matching the joint convention exactly (R6). When
   * the part is attached to a slot, the pivot lands ON the slot instead of on
   * its authored position -- see the module header for why that is the only
   * thing a slot can meaningfully contribute.
   */
  localTransform(part: Part, parent: Part | null, asset: Asset, pose: PartPose): PartTransform {
    const pivot = PartTree.pivotPixels(part, asset);
    let anchor = pivot;
    const attachSlot = attachSlotOf(part);
    if (parent !== null && attachSlot !== null) {
      const slot = PartTree.findSlot(parent, attachSlot);
      if (slot !== null) anchor = PartTree.slotPixels(parent, slot, asset);
    }

    const figureHeight = asset.figureHeight;
    const posed: Point = {
      x: anchor.x + txOrRest(pose) * figureHeight,
      y: anchor.y + tyOrRest(pose) * figureHeight,
    };
    return Skin.affineAboutScaled(pivot, posed, rotOrRest(pose), scaleOrRest(pose));
  },

  /**
   * World transform per part id, with the tree validated first.
   *
   * Evaluation order is part of the parity contract. Parts are visited in RIG
   * ORDER; for each, the unsolved chain up to its nearest already-solved
   * ancestor is collected and then composed root-first. Every part's transform
   * therefore depends only on its own chain, and the sequence in which
   * `compose` runs is identical in both kernels regardless of how the author
   * ordered the list.
   *
   * A rig whose parts are all at rest and unparented resolves to Skin.IDENTITY
   * for every part, exactly -- see Skin.compose.
   */
  solve(parts: readonly Part[], asset: Asset, partPose: PartPoseMap): Map<string, PartTransform> {
    const byId = PartTree.validate(parts);
    const world = new Map<string, PartTransform>();

    for (const part of parts) {
      const chain: Part[] = [];
      let cursor: Part | null = part;
      while (cursor !== null && !world.has(cursor.id)) {
        chain.push(cursor);
        const parentId: string | null = parentIdOf(cursor);
        cursor = parentId === null ? null : byId.get(parentId)!;
      }

      for (let index = chain.length - 1; index >= 0; index--) {
        const node = chain[index];
        const parentId = parentIdOf(node);
        const parent = parentId === null ? null : byId.get(parentId)!;
        const local = PartTree.localTransform(
          node,
          parent,
          asset,
          partPose[node.id] ?? REST_POSE,
        );
        world.set(
          node.id,
          parent === null ? local : Skin.compose(world.get(parent.id)!, local),
        );
      }
    }

    return world;
  },
} as const;
