// Pure canvas rules: hit testing, marquee selection and which gesture a mouse
// press starts. No DOM, so node --test can cover them.

import type { Tool } from "../hooks/useCanvasEditor";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Box extends Rect {
  id: string;
}

export interface Point {
  x: number;
  y: number;
}

/** A marquee smaller than this (in screen px) counts as a click, not a drag. */
export const MARQUEE_MIN_SCREEN_PX = 4;

/** Boxes under a world-space point, topmost (drawn last) first. */
export function boxesAtPoint<T extends Box>(boxes: readonly T[], p: Point, slop = 0): T[] {
  const hits: T[] = [];
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const b = boxes[i];
    if (p.x >= b.x - slop && p.x <= b.x + b.width + slop && p.y >= b.y - slop && p.y <= b.y + b.height + slop) {
      hits.push(b);
    }
  }
  return hits;
}

/** Ids of the boxes the marquee fully encloses. Touching the marquee edge counts as inside. */
export function enclosedBoxIds(marquee: Rect, boxes: readonly Box[]): string[] {
  const right = marquee.x + marquee.width;
  const bottom = marquee.y + marquee.height;
  return boxes
    .filter((b) => b.x >= marquee.x && b.y >= marquee.y && b.x + b.width <= right && b.y + b.height <= bottom)
    .map((b) => b.id);
}

/** The selection after a marquee: replaces it, or with Shift adds to what was selected when the drag began. */
export function applyMarquee(base: ReadonlySet<string>, enclosed: readonly string[], additive: boolean): Set<string> {
  return additive ? new Set([...base, ...enclosed]) : new Set(enclosed);
}

export function marqueeFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** True once the pointer has travelled far enough, in screen px, for a press to be a drag. */
export function movedPastThreshold(from: Point, to: Point, threshold = MARQUEE_MIN_SCREEN_PX): boolean {
  return Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold;
}

export type Gesture = "pan" | "draw" | "marquee" | "box" | "none";

/**
 * What a left-button press on the canvas starts.
 * - Hand tool or held Space pans.
 * - Draw tool draws a box.
 * - Select area tool: every drag is a marquee, even over a box.
 * - Select tool: a drag over empty space is a marquee; over a box it moves the box,
 *   unless Shift is held, which starts a marquee anywhere.
 */
export function pressGesture(opts: { tool: Tool; shiftKey: boolean; spaceHeld: boolean; overBox: boolean }): Gesture {
  const { tool, shiftKey, spaceHeld, overBox } = opts;
  if (tool === "hand" || spaceHeld) return "pan";
  if (tool === "draw") return "draw";
  if (tool === "marquee") return "marquee";
  if (shiftKey) return "marquee";
  return overBox ? "box" : "marquee";
}

export function selectionMessage(count: number): string {
  if (count === 0) return "No boxes selected";
  return `${count} box${count === 1 ? "" : "es"} selected`;
}
