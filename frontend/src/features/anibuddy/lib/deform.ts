// Deterministic deformation: forward kinematics over the joint tree, linear
// blend skinning of the mesh, and a per-triangle affine warp of the user's own
// pixels onto canvas 2D.
//
// No pixels are invented here. Every output pixel is a resampled source pixel.
//
// The same function drives the live preview and the exported frames, so the two
// cannot drift apart.
import { deg, projRight } from "@/features/studio/lib/rig/rigCore";
import {
  type Joint,
  type Pose,
  type PreparedAsset,
  type Rig,
  getBones,
} from "@/features/anibuddy/types";

interface Point {
  x: number;
  y: number;
}

/** Below this the source triangle is degenerate and its inverse is meaningless. */
const MIN_TRIANGLE_AREA = 1e-4;
/** Outward push (px) applied to each destination triangle before clipping. */
const SEAM_BLEED = 0.5;
/** Anisotropy above which a triangle is smeared enough to be worth disclosing. */
export const STRETCH_WARNING = 2.5;

export interface FrameStats {
  /** Worst σmax/σmin across the frame's triangles. 1 = no distortion. */
  maxStretch: number;
  /** Triangles whose affine map flipped orientation (det < 0). */
  flippedTriangles: number;
}

export interface RenderOptions {
  /** Destination canvas size in px. */
  width: number;
  height: number;
  /** CSS colour to matte against, or null/undefined for transparent. */
  background?: string | null;
  /** Overlay the stretched triangles in red instead of hiding the problem. */
  showDistortion?: boolean;
}

export interface Deformer {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  render(
    ctx: CanvasRenderingContext2D,
    pose: Pose,
    options: RenderOptions,
  ): FrameStats;
}

export function createDeformer(
  rig: Rig,
  prepared: PreparedAsset,
  image: CanvasImageSource,
): Deformer {
  const bones = getBones(rig.joints);
  const boneCount = bones.length;
  const width = prepared.width;
  const height = prepared.height;
  const figureHeight = prepared.bounds.height || height;

  // Everything below works in SOURCE PIXELS, never in normalized coordinates.
  // Rotating in normalized space would shear the figure whenever the asset is
  // not square.
  const restPos = new Map<string, Point>(
    rig.joints.map((joint) => [joint.id, { x: joint.x * width, y: joint.y * height }]),
  );

  const restAngle = new Float64Array(boneCount);
  const restLength = new Float64Array(boneCount);
  bones.forEach((bone, index) => {
    const from = restPos.get(bone.parentJoint.id)!;
    const to = restPos.get(bone.childJoint.id)!;
    restAngle[index] = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    restLength[index] = Math.hypot(to.x - from.x, to.y - from.y);
  });

  const boneOfChild = new Map<string, number>(
    bones.map((bone, index) => [bone.childJoint.id, index]),
  );
  const childrenOf = new Map<string, Joint[]>();
  for (const joint of rig.joints) {
    if (!joint.parent) continue;
    const siblings = childrenOf.get(joint.parent);
    if (siblings) siblings.push(joint);
    else childrenOf.set(joint.parent, [joint]);
  }
  const root = rig.joints.find((joint) => joint.parent === null) ?? rig.joints[0];

  const vertCount = rig.mesh.verts.length / 2;
  const srcVerts = new Float64Array(vertCount * 2);
  for (let v = 0; v < vertCount; v++) {
    srcVerts[v * 2] = rig.mesh.verts[v * 2] * width;
    srcVerts[v * 2 + 1] = rig.mesh.verts[v * 2 + 1] * height;
  }

  const posedVerts = new Float64Array(vertCount * 2);
  const posedAngle = new Float64Array(boneCount);
  const originX = new Float64Array(boneCount);
  const originY = new Float64Array(boneCount);
  const cosine = new Float64Array(boneCount);
  const sine = new Float64Array(boneCount);

  /** Walk the free-form tree, applying each joint's local delta. */
  function solve(pose: Pose): Map<string, Point> {
    const positions = new Map<string, Point>();
    const accumulated = new Map<string, number>();

    const rootRest = restPos.get(root.id)!;
    const rootPose = pose[root.id] ?? {};
    positions.set(root.id, {
      x: rootRest.x + (rootPose.tx ?? 0) * figureHeight,
      y: rootRest.y + (rootPose.ty ?? 0) * figureHeight,
    });
    accumulated.set(root.id, rootPose.rot ?? 0);

    const queue: Joint[] = [root];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      const parentPos = positions.get(parent.id)!;
      const parentAccumulated = accumulated.get(parent.id) ?? 0;

      for (const child of childrenOf.get(parent.id) ?? []) {
        const index = boneOfChild.get(child.id);
        if (index === undefined) continue;

        const local = pose[child.id] ?? {};
        const chain = parentAccumulated + (local.rot ?? 0);
        const world = restAngle[index] + chain;
        posedAngle[index] = world;
        const scaledLength = restLength[index] * (local.scale ?? 1);
        const next = projRight(parentPos.x, parentPos.y, scaledLength, world);
        positions.set(child.id, {
          x: next.x + (local.tx ?? 0) * figureHeight,
          y: next.y + (local.ty ?? 0) * figureHeight,
        });
        accumulated.set(child.id, chain);
        queue.push(child);
      }
    }
    return positions;
  }

  /** v' = Σ_j w_j · (P_j · B_j⁻¹) · v — bone lengths are preserved, so each
   *  bone transform is a pure rotate-about-rest-origin plus translation. */
  function skin(positions: Map<string, Point>): void {
    for (let b = 0; b < boneCount; b++) {
      const rotation = deg(posedAngle[b] - restAngle[b]);
      cosine[b] = Math.cos(rotation);
      sine[b] = Math.sin(rotation);
      const rest = restPos.get(bones[b].parentJoint.id)!;
      const posed = positions.get(bones[b].parentJoint.id) ?? rest;
      // Fold the rest origin into the translation: v' = R·(v - rest) + posed.
      originX[b] = posed.x - (rest.x * cosine[b] - rest.y * sine[b]);
      originY[b] = posed.y - (rest.x * sine[b] + rest.y * cosine[b]);
    }

    for (let v = 0; v < vertCount; v++) {
      const sx = srcVerts[v * 2];
      const sy = srcVerts[v * 2 + 1];
      let x = 0;
      let y = 0;
      for (let b = 0; b < boneCount; b++) {
        const weight = rig.weights[v * boneCount + b];
        if (weight <= 0) continue;
        x += weight * (sx * cosine[b] - sy * sine[b] + originX[b]);
        y += weight * (sx * sine[b] + sy * cosine[b] + originY[b]);
      }
      posedVerts[v * 2] = x;
      posedVerts[v * 2 + 1] = y;
    }
  }

  return {
    sourceWidth: width,
    sourceHeight: height,

    render(ctx, pose, options) {
      const positions = solve(pose);
      skin(positions);

      const scaleX = options.width / width;
      const scaleY = options.height / height;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, options.width, options.height);
      if (options.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, options.width, options.height);
      }

      let maxStretch = 1;
      let flippedTriangles = 0;
      const hot: number[] = [];

      for (let t = 0; t < rig.mesh.tris.length; t += 3) {
        const i0 = rig.mesh.tris[t];
        const i1 = rig.mesh.tris[t + 1];
        const i2 = rig.mesh.tris[t + 2];

        const s0x = srcVerts[i0 * 2];
        const s0y = srcVerts[i0 * 2 + 1];
        const s1x = srcVerts[i1 * 2] - s0x;
        const s1y = srcVerts[i1 * 2 + 1] - s0y;
        const s2x = srcVerts[i2 * 2] - s0x;
        const s2y = srcVerts[i2 * 2 + 1] - s0y;

        const detS = s1x * s2y - s2x * s1y;
        if (Math.abs(detS) < MIN_TRIANGLE_AREA) continue;

        const d0x = posedVerts[i0 * 2] * scaleX;
        const d0y = posedVerts[i0 * 2 + 1] * scaleY;
        const d1x = posedVerts[i1 * 2] * scaleX - d0x;
        const d1y = posedVerts[i1 * 2 + 1] * scaleY - d0y;
        const d2x = posedVerts[i2 * 2] * scaleX - d0x;
        const d2y = posedVerts[i2 * 2 + 1] * scaleY - d0y;

        // A = D · S⁻¹, in canvas order [a c; b d] with translation (e, f).
        const a = (d1x * s2y - d2x * s1y) / detS;
        const c = (d2x * s1x - d1x * s2x) / detS;
        const b = (d1y * s2y - d2y * s1y) / detS;
        const d = (d2y * s1x - d1y * s2x) / detS;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
          continue;
        }
        const e = d0x - (a * s0x + c * s0y);
        const f = d0y - (b * s0x + d * s0y);

        // Singular values of A, closed form for 2×2. σmax/σmin is how far this
        // patch of artwork has been smeared out of shape.
        const sum = Math.hypot((a + d) / 2, (b - c) / 2);
        const difference = Math.hypot((a - d) / 2, (b + c) / 2);
        const sigmaMax = sum + difference;
        const sigmaMin = Math.abs(sum - difference);
        const stretch = sigmaMin > 1e-6 ? sigmaMax / sigmaMin : Infinity;
        if (Number.isFinite(stretch) && stretch > maxStretch) maxStretch = stretch;
        if (a * d - b * c < 0) flippedTriangles++;
        if (options.showDistortion && (stretch > STRETCH_WARNING || a * d - b * c < 0)) {
          hot.push(i0, i1, i2);
        }

        // Adjacent clipped triangles leave hairline antialiasing gaps, so each
        // destination triangle is pushed out about its centroid before clipping.
        const cx = (d0x + (d0x + d1x) + (d0x + d2x)) / 3;
        const cy = (d0y + (d0y + d1y) + (d0y + d2y)) / 3;
        const bleed = (px: number, py: number): [number, number] => {
          const vx = px - cx;
          const vy = py - cy;
          const length = Math.hypot(vx, vy);
          if (length < 1e-6) return [px, py];
          return [px + (vx / length) * SEAM_BLEED, py + (vy / length) * SEAM_BLEED];
        };

        const [p0x, p0y] = bleed(d0x, d0y);
        const [p1x, p1y] = bleed(d0x + d1x, d0y + d1y);
        const [p2x, p2y] = bleed(d0x + d2x, d0y + d2y);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.lineTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(a, b, c, d, e, f);
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);

      if (hot.length > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(220,38,38,0.35)";
        for (let i = 0; i < hot.length; i += 3) {
          ctx.beginPath();
          ctx.moveTo(posedVerts[hot[i] * 2] * scaleX, posedVerts[hot[i] * 2 + 1] * scaleY);
          ctx.lineTo(posedVerts[hot[i + 1] * 2] * scaleX, posedVerts[hot[i + 1] * 2 + 1] * scaleY);
          ctx.lineTo(posedVerts[hot[i + 2] * 2] * scaleX, posedVerts[hot[i + 2] * 2 + 1] * scaleY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      return { maxStretch, flippedTriangles };
    },
  };
}
