// PartPose sampling: the four v4 track types, folded into keyframe channels.
//
// `PartPose` carries eight channels and they split by responsibility, exactly as
// they do on the server (py_backend render/partpose.py):
//
//   - `rot`, `tx`, `ty`, `scale` are GEOMETRY. They move vertices, so they are
//     sampled by the kernel's own `PoseTrack.partPoseAt` and applied by the part
//     transform tree, which composes the parent chain and bakes the result into
//     `dstVerts`. The preview hands them to `AniBuddyKernel.evaluate` rather than
//     re-applying them, because a second application is a double transform and a
//     browser-only application composes no parent chain.
//   - `visible`, `opacity`, `zIndex`, `swapTo` are COMPOSITING. No vertex moves,
//     and they are resolved here.
//
// The geometry channels are still resolved below as well, but only so the
// inspector can show what a part is doing and a drag can start from it. Nothing
// drawn is derived from them.
//
// THIS FILE IS THE TWIN OF py_backend/app/modules/anibuddy/render/partpose.py.
// Rasterization is deliberately per-target (R4), but deciding WHAT to composite
// is not, and reading that rule too widely is what let the two sides drift:
// this module treated `Part.opacity` as a fallback used only when neither
// bracketing key mentioned the channel, while the server blended against a
// constant 1 and then multiplied the result by `Part.opacity`. The two agreed on
// every part authored fully opaque and disagreed on every other one, and the
// vertex parity corpus could not see it -- opacity is compositing, and that
// corpus compares geometry. `fixtures/anibuddy-compositing/` is the corpus that
// can, and it holds these two files to each other.
//
// The rule, stated canonically on `PartPose` in the JSON Schema: a compositing
// channel's REST value is the part's own authored field, and a key REPLACES it
// rather than scaling it. The easing curve, the bracketing search and the
// geometry rests are all read from the kernel, so the two interpolators cannot
// disagree about what `ease`, "which keys" or "at rest" mean.

import { KernelConstants, PoseTrack } from "@/features/anibuddy/kernel/index.kernel";
import type {
  PartPose as KernelPartPose,
  PartPoseMap,
} from "@/features/anibuddy/kernel/index.kernel";
import type { Part, PartPose } from "@/features/anibuddy/rig/index.rig";
import { CompositingConstants } from "./compositing.constants";
import type {
  CompositingClip,
  CompositingKeyframe,
  CompositingPart,
  PartComposite,
  ResolvedPartPose,
  ResolvedPartPoses,
  UvRemap,
} from "./editor.types";

/** Geometry channels, which blend against the KERNEL's rest values. */
const GEOMETRY_CHANNELS = ["rot", "tx", "ty", "scale"] as const;
type GeometryChannel = (typeof GEOMETRY_CHANNELS)[number];

/**
 * Schema-level rest for a GEOMETRY channel (F9 §7.7).
 *
 * These four are the only channels with a schema-wide rest, and the reason is
 * structural rather than historical: a part has no authored `rot` for `rot` to
 * fall back to. Compositing channels do have one, so theirs is the part's own
 * field and is read straight off it -- never through this function.
 */
function restOf(channel: GeometryChannel): number {
  return channel === "scale" ? KernelConstants.REST_SCALE : KernelConstants.REST_DEFAULT;
}

const NO_KEYS: readonly CompositingKeyframe[] = Object.freeze([]);

export const PartTrack = {
  /**
   * The part's compositing state before any clip is applied.
   *
   * This function is the rule. `Part.visible`, `Part.opacity` and `Part.zIndex`
   * are read here as REST VALUES, not as gains, defaults or hints, and nothing
   * downstream multiplies them back in. Mirrored by `PartPoseTrack.rest_pose`
   * on the server.
   */
  restPose(part: CompositingPart): ResolvedPartPose {
    return {
      rot: KernelConstants.REST_DEFAULT,
      tx: KernelConstants.REST_DEFAULT,
      ty: KernelConstants.REST_DEFAULT,
      scale: KernelConstants.REST_SCALE,
      visible: part.visible,
      opacity: part.opacity,
      zIndex: part.zIndex,
      swapTo: CompositingConstants.REST_SWAP_TO,
    };
  },

  /**
   * Resolve one part's channels at `time`.
   *
   * Keys and `loop` rather than a clip so a caller with no clip passes an empty
   * array instead of threading a null through every branch, and so the parity
   * corpus can drive this with hand-written keyframes.
   */
  resolveOne(
    part: CompositingPart,
    keys: readonly CompositingKeyframe[],
    loop: boolean,
    time: number,
  ): ResolvedPartPose {
    const resolved = PartTrack.restPose(part);
    if (keys.length === 0) return resolved;

    const found = PoseTrack.bracketIndex(keys, loop, time);
    const start: PartPose | undefined = keys[found.beforeIndex].parts[part.id];
    const end: PartPose | undefined =
      found.afterIndex === null ? undefined : keys[found.afterIndex].parts[part.id];

    // Geometry channels: blended against the schema-wide rest, because there is
    // no authored per-part value for them to fall back to.
    for (const channel of GEOMETRY_CHANNELS) {
      const startValue = start?.[channel];
      const endValue = end?.[channel];
      if (startValue === undefined && endValue === undefined) continue;
      const a = startValue ?? restOf(channel);
      const b = endValue ?? restOf(channel);
      // a + (b - a) * u, matching the kernel's interpolation form.
      resolved[channel] = a + (b - a) * found.u;
    }

    // Stepping channels take the earlier key whole. There is no meaningful
    // halfway between two sprites, two draw orders, or shown and hidden.
    if (start?.visible !== undefined) resolved.visible = start.visible;
    if (start?.zIndex !== undefined) resolved.zIndex = start.zIndex;
    if (start?.swapTo !== undefined) resolved.swapTo = start.swapTo;

    // Opacity blends against the PART's own rest, never against a schema-wide
    // constant and never against the other side's value. So a ghost authored at
    // 0.5 and keyed to 1 at the end of a clip ramps 0.5 -> 1, and a clip that
    // never keys it leaves the ghost at 0.5.
    const startOpacity = start?.opacity;
    const endOpacity = end?.opacity;
    if (startOpacity !== undefined || endOpacity !== undefined) {
      const rest = part.opacity;
      const a = startOpacity ?? rest;
      const b = endOpacity ?? rest;
      resolved.opacity = a + (b - a) * found.u;
    }

    return resolved;
  },

  /**
   * Resolve every part's channels at `time`.
   *
   * Parts the clip never mentions still get an entry, carrying their rest state,
   * so the renderer never has to decide what an absent part means.
   */
  resolve(
    clip: CompositingClip | null,
    time: number,
    parts: readonly Part[],
  ): ResolvedPartPoses {
    const keys = clip ? clip.keyframes : NO_KEYS;
    const loop = clip ? clip.loop : false;
    const out = new Map<string, ResolvedPartPose>();
    for (const part of parts) {
      out.set(part.id, PartTrack.resolveOne(part, keys, loop, time));
    }
    return out;
  },

  /**
   * Texture remap that samples `target`'s rect through `source`'s.
   *
   * Sheet-normalized, so it is the same four numbers the shader takes and the
   * same four the parity corpus compares. Both parts crop the same sheet, so the
   * substitution is affine in that space:
   *
   *   uv' = uv * (targetSize / sourceSize) + (targetOrigin - sourceOrigin * scale)
   *
   * A zero-width or zero-height source rect cannot define a ratio, so that axis
   * falls back to 1 rather than producing an infinity that would smear one texel
   * across the whole layer.
   */
  uvRemap(source: CompositingPart, target: CompositingPart): UvRemap {
    const scaleX =
      source.rect.width === 0
        ? CompositingConstants.IDENTITY_UV_REMAP[0]
        : target.rect.width / source.rect.width;
    const scaleY =
      source.rect.height === 0
        ? CompositingConstants.IDENTITY_UV_REMAP[1]
        : target.rect.height / source.rect.height;
    return [
      scaleX,
      scaleY,
      target.rect.x - source.rect.x * scaleX,
      target.rect.y - source.rect.y * scaleY,
    ];
  },

  /**
   * Which layers to draw at `time`, in back-to-front order.
   *
   * The single source of draw order in the browser. The renderer and the hit
   * tester both consume this rather than each filtering and sorting for
   * themselves, for the same reason the server's rasterizer never sorts: three
   * copies of "which parts, in what order" is three places a z-order bug can
   * live, and two of them would only ever be noticed as picking the wrong part.
   *
   * `swapTo` substitutes PIXELS ONLY. The referring part keeps its geometry, its
   * deformer, its parent chain, its opacity and its draw order; only the texture
   * coordinates are remapped onto the target's rect. Both parts crop the same
   * sheet, so that is exactly an affine remap and R2 holds -- a different region
   * of the user's own artwork is resampled, nothing is generated.
   *
   * Sorting is stable on `(zIndex, document order)`. Document order breaks the
   * tie rather than part id, because two parts sharing a z-index is a legitimate
   * authoring state and the artist's list order is the only signal about which
   * they meant to be in front.
   */
  compositeOrder(
    parts: readonly CompositingPart[],
    clip: CompositingClip | null,
    time: number,
    warn: (message: string) => void,
  ): PartComposite[] {
    const keys = clip ? clip.keyframes : NO_KEYS;
    const loop = clip ? clip.loop : false;
    const byId = new Map(parts.map((part) => [part.id, part]));
    const entries: PartComposite[] = [];

    parts.forEach((part, order) => {
      const resolved = PartTrack.resolveOne(part, keys, loop, time);
      if (!resolved.visible) return;
      const opacity = Math.min(
        CompositingConstants.OPACITY_MAX,
        Math.max(CompositingConstants.OPACITY_MIN, resolved.opacity),
      );
      if (opacity <= CompositingConstants.MIN_DRAWN_OPACITY) return;

      let texturePartId = part.id;
      let uvRemap: UvRemap = CompositingConstants.IDENTITY_UV_REMAP;
      if (resolved.swapTo !== null) {
        const target = byId.get(resolved.swapTo);
        if (target === undefined) {
          warn(CompositingConstants.UNRESOLVED_SWAP_WARNING(part.id, resolved.swapTo));
        } else {
          texturePartId = target.id;
          uvRemap = PartTrack.uvRemap(part, target);
        }
      }

      entries.push({
        partId: part.id,
        texturePartId,
        uvRemap,
        zIndex: resolved.zIndex,
        opacity,
        order,
      });
    });

    // Array.prototype.sort is stable, so comparing on zIndex alone would already
    // preserve document order. `order` is compared explicitly anyway: the
    // Python side sorts on the pair, and a rule that holds here only because of
    // a language guarantee is a rule the two sides do not actually share.
    entries.sort((left, right) =>
      left.zIndex === right.zIndex ? left.order - right.order : left.zIndex - right.zIndex,
    );
    return entries;
  },

  /** Composite order for every sampled instant of a clip. */
  sample(
    parts: readonly CompositingPart[],
    clip: CompositingClip | null,
    times: readonly number[],
    warn: (message: string) => void,
  ): PartComposite[][] {
    return times.map((time) => PartTrack.compositeOrder(parts, clip, time, warn));
  },

  /**
   * A resolved pose's four GEOMETRY channels, as the kernel's own `PartPose`.
   *
   * The compositing four stop here. This is the only place an editor-resolved
   * pose crosses into kernel space, so the split is stated in one function
   * rather than spelled out at each call site.
   */
  geometryOf(pose: ResolvedPartPose): KernelPartPose {
    return { rot: pose.rot, tx: pose.tx, ty: pose.ty, scale: pose.scale };
  },

  /**
   * Lay uncommitted manipulations over a part pose sampled from the clip.
   *
   * The sampled half comes from the kernel's `PoseTrack.partPoseAt`, so what the
   * preview draws is resolved by the same parity-locked code the server renders
   * through. A drag in flight is the one thing that is not in the clip yet, and
   * it replaces a part WHOLE rather than per channel -- the override already
   * carries every channel, so merging channel by channel could only reintroduce
   * a value the drag had already superseded.
   */
  overlay(
    sampled: PartPoseMap,
    overrides: Readonly<Record<string, ResolvedPartPose>>,
  ): PartPoseMap {
    const partIds = Object.keys(overrides);
    if (partIds.length === 0) return sampled;
    const merged: PartPoseMap = { ...sampled };
    for (const partId of partIds) merged[partId] = PartTrack.geometryOf(overrides[partId]);
    return merged;
  },
} as const;
