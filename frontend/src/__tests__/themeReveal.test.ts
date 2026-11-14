import assert from "node:assert/strict";
import { test } from "node:test";
import { revealGeometry, shouldRevealTheme } from "../lib/theme-reveal";

test("reveals only with view transitions and without reduced motion", () => {
  assert.equal(shouldRevealTheme({ hasViewTransitions: true, reducedMotion: false }), true);
  assert.equal(shouldRevealTheme({ hasViewTransitions: true, reducedMotion: true }), false);
  assert.equal(shouldRevealTheme({ hasViewTransitions: false, reducedMotion: false }), false);
  assert.equal(shouldRevealTheme({ hasViewTransitions: false, reducedMotion: true }), false);
});

const viewport = { width: 1000, height: 600 };
const toggle = { left: 900, top: 8, width: 32, height: 32 };

test("a pointer click starts the circle at the pointer", () => {
  const g = revealGeometry({ pointer: { clientX: 912, clientY: 20, detail: 1 }, target: toggle, viewport });
  assert.equal(g.x, 912);
  assert.equal(g.y, 20);
});

test("a keyboard activation starts at the centre of the toggle", () => {
  const g = revealGeometry({ pointer: { clientX: 0, clientY: 0, detail: 0 }, target: toggle, viewport });
  assert.equal(g.x, 916);
  assert.equal(g.y, 24);
});

test("no event at all also starts at the centre of the toggle", () => {
  const g = revealGeometry({ pointer: null, target: toggle, viewport });
  assert.deepEqual([g.x, g.y], [916, 24]);
});

test("the radius reaches the farthest corner", () => {
  const g = revealGeometry({ pointer: { clientX: 912, clientY: 20, detail: 1 }, target: toggle, viewport });
  // farthest corner from (912, 20) is the bottom left: dx 912, dy 580
  assert.ok(Math.abs(g.r - Math.hypot(912, 580)) < 1e-9);
  const centre = revealGeometry({ pointer: { clientX: 500, clientY: 300, detail: 1 }, target: toggle, viewport });
  assert.ok(Math.abs(centre.r - Math.hypot(500, 300)) < 1e-9);
});
