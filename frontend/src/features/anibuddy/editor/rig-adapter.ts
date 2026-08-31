// RigDocument v5 -> kernel input structs.
//
// The kernel deliberately does NOT speak the wire schema (see kernel/types.ts):
// it owns a minimal, stable shape and every caller adapts into it. This module is
// the browser's half of that adapter; py_backend's render worker has its own.
// Keeping the adaptation here is what lets a schema revision land without
// touching parity-critical math.
//
// Two coordinate conversions happen in this file and nowhere else (R6):
//
//   1. Mesh vertices are PART-LOCAL normalized on the wire and the kernel wants
//      them SHEET-normalized, so every vertex is lifted through `Part.rect`.
//      Storing them part-local is what makes a part portable — a re-crop moves
//      `rect` and leaves the vertices untouched — so the lift is the price of
//      that property rather than a mismatch.
//   2. Spline thickness is a taper track of part-local half-widths on the wire,
//      normalized against the GEOMETRIC MEAN of the rect's pixel dimensions, and
//      the kernel wants full widths as fractions of the figure height. The
//      geometric mean is the producer's declared convention and the two sides
//      must not drift.
//
// The lattice used to be a third: the wire's absolute control points were
// differenced against a rest grid this file reconstructed and the server's
// adapter reconstructed separately. The kernel takes the wire's form directly
// now, so there is one reconstruction of that grid left in the system and it is
// inside the kernel.
//
// Anything that cannot be converted faithfully is DOWNGRADED and reported, never
// guessed at. A part that previews as a stiff rectangle with a stated reason is
// recoverable; one that previews as garbage is read as a broken rig.

import { KernelConstants, Skeleton } from "@/features/anibuddy/kernel/index.kernel";
import type {
  Clip as KernelClip,
  Deformer as KernelDeformer,
  Joint as KernelJoint,
  Part as KernelPart,
} from "@/features/anibuddy/kernel/index.kernel";
import type {
  AssetRef,
  Clip,
  DeformerLattice,
  DeformerMesh,
  DeformerSpline,
  Joint,
  NumericBuffer,
  Part,
  Rect,
  RigDocument,
} from "@/features/anibuddy/rig/index.rig";
import { EditorConstants } from "./editor.constants";
import type { PreviewDowngrade, PreviewRig } from "./editor.types";

/** Mutable accumulator so each converter can report without returning a tuple. */
type DowngradeSink = PreviewDowngrade[];

function rectBounds(rect: Rect): readonly [number, number, number, number] {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}

export const RigAdapter = {
  /**
   * Inline buffer values, or null when the payload lives behind a storage key.
   *
   * An `external` buffer is not fetchable from the editor -- the browser never
   * receives a raw provider URL for a private sheet (F9 §7.3) -- so the caller
   * downgrades the part rather than rendering an empty mesh.
   */
  readBuffer(buffer: NumericBuffer): Float32Array | null {
    if (buffer.storage !== "inline" || buffer.values === null) return null;
    return Float32Array.from(buffer.values);
  },

  /** Same, as indices. */
  readIndexBuffer(buffer: NumericBuffer): Uint32Array | null {
    if (buffer.storage !== "inline" || buffer.values === null) return null;
    return Uint32Array.from(buffer.values);
  },

  /**
   * The scale `tx`/`ty` and spline thickness are expressed against (R6).
   *
   * Read straight off the wire. `AssetRef.figureHeight` is the measured height of
   * the subject inside the sheet; null means it has not been measured yet — a
   * sheet uploaded but not decomposed — and the schema says to fall back to
   * `height`. Never re-measured here: a number only the preview knew would make
   * `tx` mean something slightly different in the browser than on the server,
   * which is the drift R4 exists to prevent.
   */
  figureHeight(asset: AssetRef): number {
    return asset.figureHeight ?? asset.height;
  },

  /**
   * Document joints, plus a synthetic root when there are none.
   *
   * MIN_JOINTS is 0: a prop or a parallax sheet legitimately has an empty
   * skeleton and moves entirely through PartPose channels. Forward kinematics
   * still needs somewhere to hang the parts, so the preview adds one unposed
   * anchor at the sheet centre. It is never written back to the document.
   */
  toKernelJoints(joints: readonly Joint[]): { joints: KernelJoint[]; synthetic: boolean } {
    if (joints.length > 0) {
      return {
        joints: joints.map((joint) => ({
          id: joint.id,
          parent: joint.parent,
          x: joint.x,
          y: joint.y,
        })),
        synthetic: false,
      };
    }
    return {
      joints: [
        {
          id: EditorConstants.SYNTHETIC_ROOT_JOINT_ID,
          parent: null,
          x: EditorConstants.SYNTHETIC_ROOT_X,
          y: EditorConstants.SYNTHETIC_ROOT_Y,
        },
      ],
      synthetic: true,
    };
  },

  /**
   * Adapt one document into kernel input plus everything the editor needs beside
   * it: document parts by id, rest draw order, and the downgrade report.
   */
  toPreviewRig(document: RigDocument): PreviewRig {
    const { joints, synthetic } = RigAdapter.toKernelJoints(document.skeleton.joints);
    const bones = Skeleton.bones(joints);
    const boneColumn = new Map(bones.map((bone, index) => [bone.id, index]));
    const jointIds = new Set(joints.map((joint) => joint.id));
    const downgrades: DowngradeSink = [];

    const parts: KernelPart[] = document.parts.map((part) => ({
      id: part.id,
      zIndex: part.zIndex,
      deformer: RigAdapter._toKernelDeformer(part, document, {
        jointIds,
        boneCount: bones.length,
        boneColumn,
        downgrades,
      }),
      // The part transform tree. Carried across verbatim -- the only conversion
      // is Rect into the kernel's corner form and Slot.position into a flat
      // pair -- because kernel/parts.ts models these fields directly now. The
      // server's adapter does exactly the same, which is what makes the two
      // sides resolve the same tree from the same document.
      rect: rectBounds(part.rect),
      pivot: [part.pivot.x, part.pivot.y] as const,
      parentPartId: part.parentPartId,
      attachSlot: part.attachSlot,
      boundJointId: part.boundJointId,
      slots: part.slots.map((slot) => ({
        name: slot.name,
        x: slot.position.x,
        y: slot.position.y,
      })),
    }));

    const drawOrder = [...document.parts]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((part) => part.id);

    return {
      kernelRig: {
        asset: {
          width: document.asset.width,
          height: document.asset.height,
          figureHeight: RigAdapter.figureHeight(document.asset),
        },
        joints,
        parts,
      },
      partsById: new Map(document.parts.map((part) => [part.id, part])),
      drawOrder,
      downgrades,
      syntheticRoot: synthetic,
    };
  },

  /**
   * Document clip -> kernel clip.
   *
   * Both channel sets cross over. `JointPose` and the kernel's four-channel
   * `PartPose` are structurally identical to their wire counterparts, so the
   * poses pass through by reference rather than being copied per frame; the
   * kernel reads only the four geometry channels off a wire `PartPose` and
   * ignores the compositing ones, which PartTrack still owns.
   *
   * The caller consumes the part channels the way the render worker does:
   * `PoseTrack.partPoseAt` samples them and they go into `evaluate` as its part
   * pose, so the transform tree is composed once, inside the kernel, and lands
   * in `dstVerts`. There is deliberately no second application on the browser
   * side -- a shader matrix could describe a root part and nothing deeper.
   */
  toKernelClip(clip: Clip): KernelClip {
    return {
      id: clip.id,
      loop: clip.loop,
      keyframes: clip.keyframes.map((key) => ({
        t: key.t,
        joints: key.joints,
        parts: key.parts,
        ease: key.ease,
      })),
    };
  },

  // Internal method — deformer dispatch with a rigid fallback per failure mode.
  //
  // The fallback carries no payload now: a rigid deformer draws `Part.rect` and
  // rides `Part.boundJointId`, both of which the kernel reads off the part it is
  // already given. A downgrade is therefore purely a change of KIND, which is
  // what it always meant.
  _toKernelDeformer(
    part: Part,
    document: RigDocument,
    context: {
      jointIds: Set<string>;
      boneCount: number;
      boneColumn: Map<string, number>;
      downgrades: DowngradeSink;
    },
  ): KernelDeformer {
    const rigid: KernelDeformer = { kind: "rigid" };

    switch (part.deformer.kind) {
      case "rigid":
        return rigid;
      case "mesh":
        return RigAdapter._toKernelMesh(part, part.deformer, context) ?? rigid;
      case "lattice":
        return RigAdapter._toKernelLattice(part, part.deformer, context) ?? rigid;
      case "spline":
        return (
          RigAdapter._toKernelSpline(part, part.deformer, document, context) ?? rigid
        );
      default: {
        // The tagged union is closed by the schema; this is the compile-time
        // proof that it is, not a runtime guard.
        const unreachable: never = part.deformer;
        throw new Error(`Unsupported deformer ${JSON.stringify(unreachable)}`);
      }
    }
  },

  /**
   * Internal method — mesh, with the weight matrix reprojected into bone order.
   *
   * `DeformerMesh.boneIds` IS the weight matrix's column order; the kernel
   * indexes columns by the bone order it derives itself. The schema is explicit
   * that a consumer permutes BY NAME and never trusts the positions to coincide
   * — they coincide only for a rig whose skeleton has not moved since the
   * weights were solved, which is exactly the case that needs no permutation.
   *
   * A name that does not resolve downgrades the whole part rather than dropping
   * the column: dropping one shifts every later column by one and rebinds every
   * vertex that used it to a neighbouring bone, which previews as a plausible
   * figure with one limb driven by the wrong joint.
   */
  _toKernelMesh(
    part: Part,
    deformer: DeformerMesh,
    context: { boneCount: number; boneColumn: Map<string, number>; downgrades: DowngradeSink },
  ): KernelDeformer | null {
    const fail = (reason: string): null => {
      context.downgrades.push({ partId: part.id, from: "mesh", to: "rigid", reason });
      return null;
    };

    if (context.boneCount === 0) {
      return fail("The skeleton derives no bones, so skinning has nothing to blend against.");
    }

    const verts = RigAdapter.readBuffer(deformer.verts);
    const tris = RigAdapter.readIndexBuffer(deformer.tris);
    const weights = RigAdapter.readBuffer(deformer.weights);
    if (!verts || !tris || !weights) {
      return fail("Its geometry is stored outside the document and is not fetchable here.");
    }

    const vertCount = verts.length / 2;
    const columns = deformer.boneIds.length;
    if (weights.length !== vertCount * columns) {
      return fail(
        `Its weight matrix is ${weights.length} values, not ${vertCount} verts x ${columns} bones.`,
      );
    }

    const targets = deformer.boneIds.map((boneId) => context.boneColumn.get(boneId));
    if (targets.some((target) => target === undefined)) {
      return fail("It is skinned to bones this skeleton no longer has.");
    }

    // Lift part-local vertices into sheet-normalized space; the kernel scales by
    // the asset's own width and height from there.
    const sheetVerts = new Float32Array(verts.length);
    for (let index = 0; index < vertCount; index++) {
      sheetVerts[index * 2] = part.rect.x + verts[index * 2] * part.rect.width;
      sheetVerts[index * 2 + 1] = part.rect.y + verts[index * 2 + 1] * part.rect.height;
    }

    const remapped = new Float32Array(vertCount * context.boneCount);
    for (let vertex = 0; vertex < vertCount; vertex++) {
      for (let column = 0; column < columns; column++) {
        remapped[vertex * context.boneCount + (targets[column] as number)] =
          weights[vertex * columns + column];
      }
    }

    return {
      kind: "mesh",
      verts: sheetVerts,
      tris,
      weights: remapped,
      boneCount: context.boneCount,
    };
  },

  /**
   * Internal method — lattice, carried across as it is.
   *
   * The wire and the kernel now hold the same thing: absolute part-local control
   * points in row-major order. This used to difference them against a rest grid
   * reconstructed here, which the server's adapter also reconstructed, and the
   * two had to agree on it exactly. Only the kernel builds that grid now.
   *
   * The checks stay, because a control grid of the wrong length would otherwise
   * reshape into a plausible grid of the wrong dimensions.
   */
  _toKernelLattice(
    part: Part,
    deformer: DeformerLattice,
    context: { downgrades: DowngradeSink },
  ): KernelDeformer | null {
    const controlPoints = RigAdapter.readBuffer(deformer.controlPoints);
    const expected = (deformer.rows + 1) * (deformer.cols + 1) * 2;
    if (!controlPoints) {
      context.downgrades.push({
        partId: part.id,
        from: "lattice",
        to: "rigid",
        reason: "Its control grid is stored outside the document and is not fetchable here.",
      });
      return null;
    }
    if (controlPoints.length !== expected) {
      context.downgrades.push({
        partId: part.id,
        from: "lattice",
        to: "rigid",
        reason: `Its control grid is ${controlPoints.length} values, not the ${expected} a ${deformer.cols}x${deformer.rows} lattice needs.`,
      });
      return null;
    }
    if (
      deformer.cols < KernelConstants.LATTICE_MIN_DIVISIONS ||
      deformer.rows < KernelConstants.LATTICE_MIN_DIVISIONS
    ) {
      context.downgrades.push({
        partId: part.id,
        from: "lattice",
        to: "rigid",
        reason: "Its lattice has no cells to deform.",
      });
      return null;
    }

    return {
      kind: "lattice",
      cols: deformer.cols,
      rows: deformer.rows,
      controlPoints,
      interpolation: deformer.interpolation,
    };
  },

  /**
   * Internal method — spline, resolved to the joint chain that IS its spine.
   *
   * The wire no longer stores a control polyline, so this is not a substitution
   * for one: the spine is the part's joint chain, which is the only form of it
   * forward kinematics can pose, and the schema says so. What is left to convert
   * is the taper track's unit — part-local half-widths normalized against the
   * geometric mean of the rect's pixel dimensions become full widths as
   * fractions of the figure height.
   */
  _toKernelSpline(
    part: Part,
    deformer: DeformerSpline,
    document: RigDocument,
    context: { jointIds: Set<string>; downgrades: DowngradeSink },
  ): KernelDeformer | null {
    const chain = RigAdapter.splineChain(part, document.skeleton.joints);
    if (chain.length < 2) {
      context.downgrades.push({
        partId: part.id,
        from: "spline",
        to: "rigid",
        reason: "Its spine needs a chain of at least two joints and this part has none.",
      });
      return null;
    }
    if (!chain.every((jointId) => context.jointIds.has(jointId))) {
      context.downgrades.push({
        partId: part.id,
        from: "spline",
        to: "rigid",
        reason: "Its spine references joints this skeleton no longer has.",
      });
      return null;
    }

    const track = RigAdapter.readBuffer(deformer.thickness);
    if (!track || track.length === 0) {
      context.downgrades.push({
        partId: part.id,
        from: "spline",
        to: "rigid",
        reason: "Its ribbon width is stored outside the document and is not fetchable here.",
      });
      return null;
    }

    // The GEOMETRIC MEAN of the rect's pixel dimensions is the producer's
    // declared axis: a single scalar cannot be exact in an anisotropic
    // part-local space, so the axis is declared rather than inferred, and the
    // geometric mean is the only choice that does not silently assume the ribbon
    // runs horizontally or vertically. THE TWO SIDES MUST NOT DRIFT — the server
    // reads it back in render/adapter.py with this same expression.
    const rectWidthPx = part.rect.width * document.asset.width;
    const rectHeightPx = part.rect.height * document.asset.height;
    const localScalePx = Math.sqrt(Math.max(rectWidthPx * rectHeightPx, 0));
    const figureHeight = RigAdapter.figureHeight(document.asset);

    return {
      kind: "spline",
      joints: chain,
      thickness: Array.from(track, (halfWidth) => (2 * halfWidth * localScalePx) / figureHeight),
      segments: Math.max(
        KernelConstants.SPLINE_MIN_SEGMENTS,
        Math.min(KernelConstants.SPLINE_MAX_SEGMENTS, deformer.samples - 1),
      ),
    };
  },

  /**
   * The spline spine: joints bound to this part, head to tail.
   *
   * This is the schema's stated derivation, and it is stated there rather than
   * left to each consumer precisely because this function used to implement a
   * different one — it started from `boundJointId` and followed children, which
   * picks a different chain whenever a spline part also anchors something else,
   * so the preview and the server could ride two different spines. Both sides
   * run this algorithm now:
   *
   *   - members are the joints whose `partId` is this part;
   *   - the HEAD is the member whose parent is not itself a member;
   *   - follow child links from the head until no member remains.
   *
   * Order is load-bearing, not cosmetic: the ribbon's shape is the sequence of
   * its control points, and a reordered chain folds back on itself.
   */
  splineChain(part: Part, joints: readonly Joint[]): string[] {
    const members = joints.filter((joint) => joint.partId === part.id);
    if (members.length === 0) return [];

    const memberIds = new Set(members.map((joint) => joint.id));
    const childOf = new Map<string, string>();
    let head: string | null = null;
    for (const joint of members) {
      if (joint.parent !== null && memberIds.has(joint.parent)) childOf.set(joint.parent, joint.id);
      else if (head === null) head = joint.id;
    }

    // A chain whose head cannot be identified (every member's parent is also a
    // member, i.e. a cycle) falls back to document order rather than looping
    // forever. Rejecting the cycle is the server validator's job, not the
    // preview's.
    if (head === null) return members.map((joint) => joint.id);

    const ordered = [head];
    let cursor = head;
    while (ordered.length < members.length) {
      const next = childOf.get(cursor);
      if (next === undefined) break;
      ordered.push(next);
      cursor = next;
    }
    return ordered;
  },
} as const;
