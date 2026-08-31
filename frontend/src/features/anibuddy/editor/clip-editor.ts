// Clip and keyframe mutation. Pure functions over immutable clips.
//
// Every editor gesture that changes motion goes through here, which is what makes
// autokey a single rule instead of a rule per tool: manipulate at time t, and the
// manipulation is merged into the keyframe at t. There is no separate "record"
// mode to be in the wrong one of.
//
// Two invariants are enforced rather than validated:
//
//   - keyframes are sorted by `t` and `t` is unique within KEYFRAME_EPSILON, so a
//     drag that lands on an existing key merges into it rather than creating a
//     second key at the same instant that the sampler would silently ignore.
//   - keyframes[0].t is always 0. The animate stage rejects a proposal whose first
//     key is elsewhere (F9 §8.4), and a hand-authored clip that could violate the
//     same rule would be refused on save with nothing in the UI having warned.
//
// Channel sparsity is preserved throughout. A merge writes only the channels the
// gesture touched, because a key that mentions only the tail must not snap every
// other joint (F9 §7.7).

import { KernelConstants } from "@/features/anibuddy/kernel/index.kernel";
import {
  ANIBUDDY_LIMITS,
  type Clip,
  type Ease,
  type Keyframe,
  type PartPose,
  type RigDocument,
} from "@/features/anibuddy/rig/index.rig";
import { EditorConstants } from "./editor.constants";
import type { PoseEdit } from "./editor.types";

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sameTime(left: number, right: number): boolean {
  return Math.abs(left - right) <= KernelConstants.KEYFRAME_EPSILON;
}

function emptyKeyframe(t: number, ease: Ease): Keyframe {
  return { t, ease, joints: {}, parts: {} };
}

export const ClipEditor = {
  /** Normalized time of a frame index on a clip's sampling grid. */
  timeOfFrame(frame: number, frameCount: number): number {
    const count = Math.max(EditorConstants.MIN_FRAMES, frameCount);
    return clamp01(frame / count);
  },

  /**
   * The normalized instants a whole clip is sampled at, one per frame.
   *
   * Mirrors `PoseTrack.sample`'s own formula rather than calling it: the kernel's
   * sampler returns joint poses, and the part channels have to be resolved at the
   * SAME instants or a part and a joint keyed together drift apart. py_backend's
   * RenderService._sample_times exists for that reason and carries the identical
   * two branches, so this is the third copy of a formula that must not diverge --
   * a looping clip samples `i / count`, so the last frame is one step short of
   * the start and the wrap is seamless; a one-shot samples `i / (count - 1)`, so
   * it actually reaches its final key.
   *
   * Distinct from `timeOfFrame`, which maps the PLAYHEAD and is loop-shaped for
   * every clip because the timeline's last cell is not the clip's end.
   */
  sampleTimes(clip: Clip): number[] {
    const count = Math.max(EditorConstants.MIN_FRAMES, Math.trunc(clip.frameCount));
    return Array.from({ length: count }, (_unused, index) =>
      clip.loop ? index / count : index / (count - 1),
    );
  },

  /** Nearest frame index for a normalized time. */
  frameOfTime(t: number, frameCount: number): number {
    const count = Math.max(EditorConstants.MIN_FRAMES, frameCount);
    return Math.max(0, Math.min(count - 1, Math.round(clamp01(t) * count)));
  },

  /**
   * Snap a time onto the clip's frame grid.
   *
   * Keys are authored at frame boundaries so the playhead can actually land on
   * them. A key at t = 0.4137 on a 24-frame clip is a key the user can see on the
   * timeline and never scrub to exactly.
   */
  quantize(t: number, frameCount: number): number {
    return ClipEditor.timeOfFrame(ClipEditor.frameOfTime(t, frameCount), frameCount);
  },

  /**
   * A schema-valid clip id.
   *
   * A bare `crypto.randomUUID()` is 36 characters and the schema's id pattern
   * stops at 32, so a clip named that way is refused on save by a message about a
   * regular expression. The hex is kept and truncated, which leaves 64 bits of
   * randomness against a per-document ceiling of MAX_CLIPS.
   */
  newId(): string {
    const hex = crypto.randomUUID().replace(/-/g, "").slice(0, EditorConstants.CLIP_ID_HEX_CHARS);
    return `${EditorConstants.CLIP_ID_PREFIX}${hex}`;
  },

  /**
   * A canonical string for one clip's authored content.
   *
   * Used to answer "is what the user sees what the server holds", so `source` is
   * excluded — the server stamps it, and comparing it would report every saved
   * clip as differing. Keys are sorted at every depth because the two clips being
   * compared took different routes here: one from a reducer, one through Mongo and
   * JSON, and neither promises property order.
   */
  fingerprint(clip: Omit<Clip, "source">): string {
    const canonical = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonical);
      if (typeof value !== "object" || value === null) return value;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "source")
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return entries.map(([key, entry]) => [key, canonical(entry)]);
    };
    return JSON.stringify(canonical(clip));
  },

  /**
   * The clip as the gateway's write route takes it.
   *
   * Field by field rather than by stripping `source`, so a field added to `Clip`
   * fails this function's type instead of silently travelling to a body the
   * gateway declares strictly — and `source` stays the server's to stamp.
   */
  toDraft(clip: Clip): Omit<Clip, "source"> {
    return {
      id: clip.id,
      name: clip.name,
      request: clip.request,
      loop: clip.loop,
      fps: clip.fps,
      frameCount: clip.frameCount,
      keyframes: clip.keyframes,
    };
  },

  /** A fresh, empty, hand-authored clip with one key at t = 0. */
  create(name: string): Clip {
    return {
      id: ClipEditor.newId(),
      name: name.slice(0, 80),
      request: "",
      loop: true,
      fps: EditorConstants.DEFAULT_FPS,
      frameCount: EditorConstants.DEFAULT_FRAME_COUNT,
      keyframes: [emptyKeyframe(0, "ease")],
      source: "edited",
    };
  },

  /** The keyframe at `t`, or null. */
  keyframeAt(clip: Clip, t: number): Keyframe | null {
    return clip.keyframes.find((key) => sameTime(key.t, t)) ?? null;
  },

  /**
   * The keyframe nearest `t` within half a frame, which is the timeline's pick
   * tolerance. Half a frame either side means every authored key belongs to
   * exactly one frame cell and none is unreachable.
   */
  keyframeNear(clip: Clip, t: number): Keyframe | null {
    const tolerance = EditorConstants.KEYFRAME_PICK_FRAMES / Math.max(1, clip.frameCount);
    let best: Keyframe | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const key of clip.keyframes) {
      const distance = Math.abs(key.t - t);
      if (distance <= tolerance && distance < bestDistance) {
        best = key;
        bestDistance = distance;
      }
    }
    return best;
  },

  /**
   * Merge a pose edit into the keyframe at `t`, creating it if absent.
   *
   * This is autokey. The edit carries only the channels the gesture changed, and
   * they are merged channel-by-channel into whatever the key already held, so
   * rotating a shoulder at frame 6 does not erase the hand translation authored
   * there earlier.
   *
   * At MAX_KEYFRAMES the clip refuses a NEW key and returns unchanged; edits to
   * existing keys still land. Refusing is better than evicting one the user
   * authored on purpose (R7).
   */
  upsert(clip: Clip, time: number, edit: PoseEdit): Clip {
    const t = ClipEditor.quantize(time, clip.frameCount);
    const existing = ClipEditor.keyframeAt(clip, t);

    if (!existing && clip.keyframes.length >= ANIBUDDY_LIMITS.MAX_KEYFRAMES) return clip;

    const base = existing ?? emptyKeyframe(t, "ease");
    const merged: Keyframe = {
      t: base.t,
      ease: base.ease,
      joints: { ...base.joints },
      parts: { ...base.parts },
    };

    for (const [jointId, pose] of Object.entries(edit.joints ?? {})) {
      merged.joints[jointId] = { ...merged.joints[jointId], ...pose };
    }
    for (const [partId, pose] of Object.entries(edit.parts ?? {})) {
      merged.parts[partId] = { ...merged.parts[partId], ...(pose as PartPose) };
    }

    const keyframes = existing
      ? clip.keyframes.map((key) => (sameTime(key.t, t) ? merged : key))
      : [...clip.keyframes, merged].sort((left, right) => left.t - right.t);

    return { ...clip, keyframes, source: "edited" };
  },

  /**
   * Replace one channel record outright, for the inspector's numeric fields.
   *
   * Distinct from `upsert` because a numeric field has to be able to CLEAR a
   * channel back to rest, and a merge cannot express "remove this key". Passing
   * undefined for a channel deletes it.
   */
  setChannels(
    clip: Clip,
    time: number,
    target: { kind: "joint" | "part"; id: string },
    channels: Record<string, number | boolean | string | undefined>,
  ): Clip {
    const t = ClipEditor.quantize(time, clip.frameCount);
    const existing = ClipEditor.keyframeAt(clip, t);
    if (!existing && clip.keyframes.length >= ANIBUDDY_LIMITS.MAX_KEYFRAMES) return clip;

    const base = existing ?? emptyKeyframe(t, "ease");
    const bucket = target.kind === "joint" ? "joints" : "parts";
    const current = { ...(base[bucket] as Record<string, Record<string, unknown>>) };
    const pose = { ...(current[target.id] ?? {}) } as Record<string, unknown>;

    for (const [channel, value] of Object.entries(channels)) {
      if (value === undefined) delete pose[channel];
      else pose[channel] = value;
    }

    if (Object.keys(pose).length === 0) delete current[target.id];
    else current[target.id] = pose;

    const merged = { ...base, [bucket]: current } as Keyframe;
    const keyframes = existing
      ? clip.keyframes.map((key) => (sameTime(key.t, t) ? merged : key))
      : [...clip.keyframes, merged].sort((left, right) => left.t - right.t);

    return { ...clip, keyframes, source: "edited" };
  },

  /**
   * Remove the keyframe at `t`.
   *
   * The key at t = 0 is refused: it is the clip's rest reference, and the pipeline
   * rejects a clip whose first key sits elsewhere. Silently retiming the next key
   * to 0 to keep the invariant would change motion the user did not ask to change.
   */
  remove(clip: Clip, t: number): Clip {
    const target = ClipEditor.keyframeAt(clip, t);
    if (!target || sameTime(target.t, 0)) return clip;
    return {
      ...clip,
      keyframes: clip.keyframes.filter((key) => key !== target),
      source: "edited",
    };
  },

  /** True when a keyframe may be deleted, so the UI can disable rather than fail. */
  canRemove(clip: Clip, t: number): boolean {
    const target = ClipEditor.keyframeAt(clip, t);
    return target !== null && !sameTime(target.t, 0);
  },

  /**
   * Move a keyframe along the timeline.
   *
   * Lands on the frame grid. A move onto an existing key merges into it, later
   * channels winning, rather than leaving two keys at one instant where the
   * sampler would take whichever it met first.
   */
  move(clip: Clip, from: number, to: number): Clip {
    const source = ClipEditor.keyframeAt(clip, from);
    if (!source || sameTime(source.t, 0)) return clip;

    const t = ClipEditor.quantize(to, clip.frameCount);
    if (sameTime(t, source.t)) return clip;

    const collision = ClipEditor.keyframeAt(clip, t);
    const moved: Keyframe = collision
      ? {
          t,
          ease: source.ease,
          joints: { ...collision.joints, ...source.joints },
          parts: { ...collision.parts, ...source.parts },
        }
      : { ...source, t };

    const keyframes = clip.keyframes
      .filter((key) => key !== source && key !== collision)
      .concat(moved)
      .sort((left, right) => left.t - right.t);

    return { ...clip, keyframes, source: "edited" };
  },

  /** Set the outgoing interpolation of the key at `t`. */
  setEase(clip: Clip, t: number, ease: Ease): Clip {
    if (!ClipEditor.keyframeAt(clip, t)) return clip;
    return {
      ...clip,
      keyframes: clip.keyframes.map((key) => (sameTime(key.t, t) ? { ...key, ease } : key)),
      source: "edited",
    };
  },

  setLoop(clip: Clip, loop: boolean): Clip {
    return { ...clip, loop, source: "edited" };
  },

  /** fps, clamped to the schema ceiling. */
  setFps(clip: Clip, fps: number): Clip {
    const clamped = Math.max(1, Math.min(EditorConstants.MAX_FPS, Math.round(fps)));
    return { ...clip, fps: clamped, source: "edited" };
  },

  /**
   * Frame count, clamped to the schema ceiling.
   *
   * Keyframe times are normalized, so they survive a resample untouched -- but
   * they are re-quantized onto the new grid, because a key that is no longer on a
   * frame boundary is a key the playhead can never reach.
   */
  setFrameCount(clip: Clip, frameCount: number): Clip {
    const clamped = Math.max(
      EditorConstants.MIN_FRAMES,
      Math.min(EditorConstants.MAX_FRAMES, Math.round(frameCount)),
    );
    const seen = new Set<number>();
    const keyframes: Keyframe[] = [];
    for (const key of clip.keyframes) {
      const t = ClipEditor.quantize(key.t, clamped);
      if (seen.has(t)) continue;
      seen.add(t);
      keyframes.push({ ...key, t });
    }
    return {
      ...clip,
      frameCount: clamped,
      keyframes: keyframes.sort((left, right) => left.t - right.t),
      source: "edited",
    };
  },

  rename(clip: Clip, name: string): Clip {
    return { ...clip, name: name.slice(0, 80), source: "edited" };
  },

  /**
   * Drop channels that reference ids the document no longer has.
   *
   * Run when a stage lands a new revision. A stale channel is not harmless: an
   * unknown id makes the whole clip a rejected proposal on the server (F9 §8.4),
   * so a clip that keeps them is a clip that cannot be saved and does not say why.
   */
  sanitize(clip: Clip, document: RigDocument): Clip {
    const jointIds = new Set(document.skeleton.joints.map((joint) => joint.id));
    const partIds = new Set(document.parts.map((part) => part.id));
    return {
      ...clip,
      keyframes: clip.keyframes.map((key) => ({
        ...key,
        joints: Object.fromEntries(
          Object.entries(key.joints).filter(([jointId]) => jointIds.has(jointId)),
        ),
        parts: Object.fromEntries(
          Object.entries(key.parts).filter(([partId]) => partIds.has(partId)),
        ),
      })),
    };
  },

  /** True when any keyframe carries at least one channel. */
  hasContent(clip: Clip): boolean {
    return clip.keyframes.some(
      (key) => Object.keys(key.joints).length > 0 || Object.keys(key.parts).length > 0,
    );
  },
} as const;
