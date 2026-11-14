import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMarquee,
  boxesAtPoint,
  enclosedBoxIds,
  marqueeFromPoints,
  movedPastThreshold,
  pressGesture,
  selectionMessage,
  type Box,
} from "../features/editor/lib/canvasGeometry";
import { DIM_OUTSIDE_KEY, readDimOutside, writeDimOutside } from "../features/editor/lib/canvasPrefs";

// A 3 x 2 grid of touching 10 px boxes: a1 a2 a3 / b1 b2 b3.
const grid: Box[] = [
  { id: "a1", x: 0, y: 0, width: 10, height: 10 },
  { id: "a2", x: 10, y: 0, width: 10, height: 10 },
  { id: "a3", x: 20, y: 0, width: 10, height: 10 },
  { id: "b1", x: 0, y: 10, width: 10, height: 10 },
  { id: "b2", x: 10, y: 10, width: 10, height: 10 },
  { id: "b3", x: 20, y: 10, width: 10, height: 10 },
];

test("boxesAtPoint returns the topmost box first and nothing on empty space", () => {
  const stacked: Box[] = [
    { id: "under", x: 0, y: 0, width: 20, height: 20 },
    { id: "over", x: 5, y: 5, width: 5, height: 5 },
  ];
  assert.deepEqual(boxesAtPoint(stacked, { x: 6, y: 6 }).map((b) => b.id), ["over", "under"]);
  assert.deepEqual(boxesAtPoint(stacked, { x: 15, y: 15 }).map((b) => b.id), ["under"]);
  assert.deepEqual(boxesAtPoint(stacked, { x: 40, y: 40 }), []);
  assert.deepEqual(boxesAtPoint(stacked, { x: 21, y: 21 }, 2).map((b) => b.id), ["under"]);
});

test("a point on the shared edge of touching boxes hits both", () => {
  assert.deepEqual(boxesAtPoint(grid, { x: 10, y: 5 }).map((b) => b.id).sort(), ["a1", "a2"]);
});

test("enclosedBoxIds needs a box fully inside the marquee, edges included", () => {
  assert.deepEqual(enclosedBoxIds({ x: 0, y: 0, width: 20, height: 10 }, grid), ["a1", "a2"]);
  assert.deepEqual(enclosedBoxIds({ x: 1, y: 0, width: 19, height: 10 }, grid), ["a2"]);
  assert.equal(enclosedBoxIds({ x: 0, y: 0, width: 30, height: 20 }, grid).length, 6);
  assert.deepEqual(enclosedBoxIds({ x: 2, y: 2, width: 5, height: 5 }, grid), []);
});

test("applyMarquee replaces the selection, or with Shift adds to the starting selection", () => {
  const base = new Set(["b3"]);
  assert.deepEqual([...applyMarquee(base, ["a1", "a2"], false)].sort(), ["a1", "a2"]);
  assert.deepEqual([...applyMarquee(base, ["a1", "b3"], true)].sort(), ["a1", "b3"]);
  assert.deepEqual([...applyMarquee(base, [], true)], ["b3"]);
  assert.deepEqual([...applyMarquee(base, [], false)], []);
  assert.deepEqual([...base], ["b3"], "the base set is not mutated");
});

test("marqueeFromPoints normalises a drag in any direction", () => {
  assert.deepEqual(marqueeFromPoints({ x: 30, y: 20 }, { x: 10, y: 5 }), { x: 10, y: 5, width: 20, height: 15 });
});

test("movedPastThreshold separates a click from a drag", () => {
  assert.equal(movedPastThreshold({ x: 0, y: 0 }, { x: 3, y: 3 }), false);
  assert.equal(movedPastThreshold({ x: 0, y: 0 }, { x: 4, y: 0 }), true);
  assert.equal(movedPastThreshold({ x: 5, y: 5 }, { x: 5, y: 1 }), true);
});

test("pressGesture: select tool", () => {
  const base = { tool: "select" as const, shiftKey: false, spaceHeld: false };
  assert.equal(pressGesture({ ...base, overBox: false }), "marquee");
  assert.equal(pressGesture({ ...base, overBox: true }), "box");
  assert.equal(pressGesture({ ...base, shiftKey: true, overBox: true }), "marquee");
  assert.equal(pressGesture({ ...base, shiftKey: true, overBox: false }), "marquee");
});

test("pressGesture: select area tool marquees everywhere", () => {
  const base = { tool: "marquee" as const, shiftKey: false, spaceHeld: false };
  assert.equal(pressGesture({ ...base, overBox: true }), "marquee");
  assert.equal(pressGesture({ ...base, overBox: false }), "marquee");
});

test("pressGesture: hand, Space and draw win over the select rules", () => {
  assert.equal(pressGesture({ tool: "hand", shiftKey: true, spaceHeld: false, overBox: true }), "pan");
  assert.equal(pressGesture({ tool: "select", shiftKey: false, spaceHeld: true, overBox: true }), "pan");
  assert.equal(pressGesture({ tool: "marquee", shiftKey: false, spaceHeld: true, overBox: false }), "pan");
  assert.equal(pressGesture({ tool: "draw", shiftKey: true, spaceHeld: false, overBox: true }), "draw");
});

test("selectionMessage", () => {
  assert.equal(selectionMessage(0), "No boxes selected");
  assert.equal(selectionMessage(1), "1 box selected");
  assert.equal(selectionMessage(30), "30 boxes selected");
});

test("dim preference is off by default and survives broken storage", () => {
  const data = new Map<string, string>();
  const ok = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  assert.equal(readDimOutside(ok), false);
  writeDimOutside(true, ok);
  assert.equal(data.get(DIM_OUTSIDE_KEY), "1");
  assert.equal(readDimOutside(ok), true);
  writeDimOutside(false, ok);
  assert.equal(readDimOutside(ok), false);

  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readDimOutside(broken), false);
  assert.doesNotThrow(() => writeDimOutside(true, broken));
  assert.equal(readDimOutside(null), false);
});
