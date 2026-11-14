import { ApiError } from '../../common/utils/ApiError';
import { assertEntitled } from './entitlements';
import { DETECTION_LIMITS } from './plans.types';
import type { PlanSubject } from './plans.types';

/**
 * Detection threshold and box padding are Pro controls. Free accounts always
 * run with the defaults, which are the values detection used before these
 * controls existed (threshold 50 is the unchanged cut-off, padding 0 is a
 * tight box).
 */
export interface DetectionTuning {
  /** 1 to 100. Higher ignores fainter pixels (fewer, tighter boxes); lower picks up more. */
  threshold: number;
  /** Pixels added on every side of each box, clamped to the sheet. */
  padding: number;
}

export const DEFAULT_DETECTION_TUNING: DetectionTuning = {
  threshold: DETECTION_LIMITS.threshold.default,
  padding: DETECTION_LIMITS.padding.default,
};

function readInt(name: string, raw: unknown, range: { min: number; max: number }): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < range.min || raw > range.max) {
    throw ApiError.badRequest(`${name} must be a whole number from ${range.min} to ${range.max}`);
  }
  return raw;
}

/**
 * Validates the optional `threshold` and `padding` from a request body and
 * applies the plan gate. Omitted values take the defaults. A free user who
 * sends a value other than the default gets 403 PLAN_REQUIRED; sending the
 * default is harmless and allowed.
 */
export function resolveDetectionTuning(
  subject: PlanSubject,
  input: { threshold?: unknown; padding?: unknown },
  now: Date = new Date(),
): DetectionTuning {
  const tuning = { ...DEFAULT_DETECTION_TUNING };
  if (input.threshold !== undefined && input.threshold !== null) {
    tuning.threshold = readInt('threshold', input.threshold, DETECTION_LIMITS.threshold);
  }
  if (input.padding !== undefined && input.padding !== null) {
    tuning.padding = readInt('padding', input.padding, DETECTION_LIMITS.padding);
  }
  const custom =
    tuning.threshold !== DEFAULT_DETECTION_TUNING.threshold || tuning.padding !== DEFAULT_DETECTION_TUNING.padding;
  if (custom) assertEntitled(subject, 'paddingThresholdControls', now);
  return tuning;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grows every box by `padding` px on each side, kept inside the sheet. */
export function padBoxes<T extends Box>(boxes: T[], padding: number, imageWidth: number, imageHeight: number): T[] {
  if (padding <= 0) return boxes;
  return boxes.map((box) => {
    const x = Math.max(0, box.x - padding);
    const y = Math.max(0, box.y - padding);
    const right = Math.min(imageWidth, box.x + box.width + padding);
    const bottom = Math.min(imageHeight, box.y + box.height + padding);
    return { ...box, x, y, width: right - x, height: bottom - y };
  });
}
