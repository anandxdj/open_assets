// Fixture adapter for the compositing parity harness.
//
// The mirror of py_backend/app/modules/anibuddy/compositing_fixtures.py. It
// adapts one particular wire format -- the compositing fixture corpus -- into the
// structural inputs `PartTrack` declares, and serializes the resolved
// compositing state back out. That is the same job the editor does for the wire
// document and the render worker does for its own, so it is test scaffolding and
// a worked example of the adapter boundary at the same time.
//
// Why this corpus exists at all: ../kernel/__tests__/parity.test.ts compares
// VERTICES, and compositing moves none. The browser and the server can disagree
// about a part's opacity, its visibility, its draw order and which artwork it
// samples while agreeing at 0 ULP across all seventeen vertex cases. They did,
// for months, on two counts at once.
//
// No file access here: objects in, objects out. The test file owns the
// filesystem.

import { PartTrack } from "./part-track";
import type {
  CompositingClip,
  CompositingKeyframe,
  CompositingPart,
} from "./editor.types";
import type { PartPose } from "@/features/anibuddy/rig/index.rig";

/**
 * Times a case samples when it does not name its own.
 *
 * Deliberately not the keyframe times: a bracketing or easing difference is
 * largest strictly BETWEEN keys, and a sweep that only landed on keys would miss
 * it. The endpoints are included because 0 and 1 are where clamping and loop
 * wrap live. Mirrors DEFAULT_TIMES in the Python adapter.
 */
export const DEFAULT_TIMES: readonly number[] = Object.freeze([
  0, 0.125, 0.25, 0.5, 0.75, 0.875, 1,
]);

/** Rect a part falls back to: the whole sheet, under which every remap is the
 *  identity -- so the default cannot accidentally make a remap case pass. */
const FULL_SHEET_RECT = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** A resolved-channel row: `[partId, visible, opacity, zIndex, swapTo]`. */
export type ResolvedRow = [string, boolean, number, number, string | null];

/**
 * A draw row: `[partId, texturePartId, zIndex, opacity, order, sx, sy, ox, oy]`.
 *
 * Flat because a flat row is diffable, and one row per line in the golden means
 * a reviewer sees a changed opacity next to the part it belongs to.
 */
export type DrawRow = [string, string, number, number, number, number, number, number, number];

export interface SerializedFrame {
  time: number;
  resolved: ResolvedRow[];
  draw: DrawRow[];
}

export interface SerializedCompositing {
  id: string;
  frames: SerializedFrame[];
  warnings: string[];
}

/** The shape a compositing fixture case has on disk. Intentionally loose. */
export interface CompositingCase {
  id: string;
  description?: string;
  parts: Array<Record<string, unknown>>;
  clip?: Record<string, unknown> | null;
  times?: number[];
}

function readRect(data: unknown): CompositingPart["rect"] {
  if (data === undefined || data === null) return FULL_SHEET_RECT;
  const rect = data as Record<string, unknown>;
  return {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  };
}

function readPart(data: Record<string, unknown>): CompositingPart {
  return {
    id: String(data.id),
    visible: data.visible === undefined ? true : Boolean(data.visible),
    opacity: data.opacity === undefined ? 1 : Number(data.opacity),
    zIndex: data.zIndex === undefined ? 0 : Number(data.zIndex),
    rect: readRect(data.rect),
  };
}

/**
 * One part's four compositing channels.
 *
 * Absent and explicitly null both become `undefined`, because the schema has no
 * way to say "null" for these -- an absent channel is the sparsity rule and a
 * JSON null in a hand-written case means the same thing.
 */
function readPose(data: Record<string, unknown>): PartPose {
  const pose: PartPose = {};
  if (data.visible !== undefined && data.visible !== null) pose.visible = Boolean(data.visible);
  if (data.opacity !== undefined && data.opacity !== null) pose.opacity = Number(data.opacity);
  if (data.zIndex !== undefined && data.zIndex !== null) pose.zIndex = Number(data.zIndex);
  if (data.swapTo !== undefined && data.swapTo !== null) pose.swapTo = String(data.swapTo);
  return pose;
}

function readKeyframe(data: Record<string, unknown>): CompositingKeyframe {
  const poses = (data.parts ?? {}) as Record<string, Record<string, unknown>>;
  const parts: Record<string, PartPose> = {};
  for (const partId of Object.keys(poses)) parts[partId] = readPose(poses[partId]);
  const key: CompositingKeyframe = { t: Number(data.t), parts };
  // Left off entirely when the case omits it, so the smoothstep default is
  // exercised rather than papered over with an explicit "ease".
  if (data.ease !== undefined && data.ease !== null) {
    key.ease = data.ease as CompositingKeyframe["ease"];
  }
  return key;
}

export const CompositingFixtures = {
  readParts(fixtureCase: CompositingCase): CompositingPart[] {
    return fixtureCase.parts.map(readPart);
  },

  /**
   * The case's clip, or null for a still at rest.
   *
   * A case with no clip is not a degenerate one: it is what pins down that the
   * rest values ARE the resolved values when nothing animates, which is half of
   * the rule the two implementations disagreed about.
   */
  readClip(fixtureCase: CompositingCase): CompositingClip | null {
    const data = fixtureCase.clip;
    if (data === undefined || data === null) return null;
    return {
      loop: Boolean(data.loop),
      keyframes: (data.keyframes as Array<Record<string, unknown>>).map(readKeyframe),
    };
  },

  times(fixtureCase: CompositingCase): readonly number[] {
    return fixtureCase.times ?? DEFAULT_TIMES;
  },

  /**
   * Resolve a case to the golden document shape.
   *
   * Warnings are collected across the whole sweep and deduplicated in first-seen
   * order, mirroring `RenderReport.warn`. Without the dedupe an unresolvable
   * `swapTo` would appear once per sampled time and the golden would encode the
   * sampling rate rather than the defect.
   *
   * Every float goes through `Math.fround` for the same reason the kernel
   * goldens do: a value written from a float64 is not recoverable bit for bit
   * from the golden, so the file would encode a difference the implementations
   * do not have.
   */
  evaluate(fixtureCase: CompositingCase): SerializedCompositing {
    const parts = CompositingFixtures.readParts(fixtureCase);
    const clip = CompositingFixtures.readClip(fixtureCase);
    const keys = clip ? clip.keyframes : [];
    const loop = clip ? clip.loop : false;

    const warnings: string[] = [];
    const warn = (message: string): void => {
      if (!warnings.includes(message)) warnings.push(message);
    };

    const frames = CompositingFixtures.times(fixtureCase).map((time) => {
      // Every part's channels, in document order, including the ones that do not
      // draw. A part dropped from the composite and a part resolved wrong then
      // dropped look identical in the draw list, so the resolved state is
      // emitted separately from the draw list on purpose.
      const resolved: ResolvedRow[] = parts.map((part) => {
        const pose = PartTrack.resolveOne(part, keys, loop, time);
        return [part.id, pose.visible, Math.fround(pose.opacity), pose.zIndex, pose.swapTo];
      });

      const draw: DrawRow[] = PartTrack.compositeOrder(parts, clip, time, warn).map(
        (entry) => [
          entry.partId,
          entry.texturePartId,
          entry.zIndex,
          Math.fround(entry.opacity),
          entry.order,
          Math.fround(entry.uvRemap[0]),
          Math.fround(entry.uvRemap[1]),
          Math.fround(entry.uvRemap[2]),
          Math.fround(entry.uvRemap[3]),
        ],
      );

      return { time: Math.fround(time), resolved, draw };
    });

    return { id: fixtureCase.id, frames, warnings };
  },
} as const;
