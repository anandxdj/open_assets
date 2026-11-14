import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canArmReveal,
  isInViewOrAbove,
  isRevealTarget,
  REVEAL_MAX_STEPS,
  REVEAL_ROOT_MARGIN,
  REVEAL_THRESHOLD,
  revealsOnRestore,
  staggerDelayMs,
  staggerStep,
  startsPending,
} from "../lib/reveal";

const base = { armed: true, top: 1200, bottom: 1600, viewportHeight: 900, relatedToHashTarget: false };

test("observer options match the brief", () => {
  assert.equal(REVEAL_THRESHOLD, 0.15);
  assert.equal(REVEAL_ROOT_MARGIN, "0px 0px -10% 0px");
});

test("arms only with an observer and without reduced motion", () => {
  assert.equal(canArmReveal({ hasObserver: true, reducedMotion: false }), true);
  assert.equal(canArmReveal({ hasObserver: false, reducedMotion: false }), false);
  assert.equal(canArmReveal({ hasObserver: true, reducedMotion: true }), false);
  assert.equal(canArmReveal({ hasObserver: false, reducedMotion: true }), false);
});

test("a block below the fold starts pending", () => {
  assert.equal(startsPending(base), true);
  assert.equal(startsPending({ ...base, top: 900 }), true);
});

test("nothing is pending when the reveal is not armed", () => {
  assert.equal(startsPending({ ...base, armed: false }), false);
});

test("above the fold and straddling the fold stay visible", () => {
  assert.equal(startsPending({ ...base, top: 40, bottom: 500 }), false);
  assert.equal(startsPending({ ...base, top: 700, bottom: 1100 }), false);
  assert.equal(startsPending({ ...base, top: 899.5, bottom: 1100 }), false);
});

test("blocks already scrolled past (restored scroll) stay visible", () => {
  assert.equal(startsPending({ ...base, top: -1400, bottom: -200 }), false);
  assert.equal(startsPending({ ...base, top: -600, bottom: 0 }), false);
  assert.equal(startsPending({ ...base, top: -600, bottom: 120 }), false);
});

test("a block tied to the hash target stays visible even below the fold", () => {
  assert.equal(startsPending({ ...base, relatedToHashTarget: true }), false);
});

test("stagger steps count from 0 and cap at four steps", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(staggerStep), [0, 1, 2, 3, 3, 3, 3]);
  assert.equal(REVEAL_MAX_STEPS, 4);
});

test("stagger delay is 60ms per step, at most 180ms", () => {
  assert.deepEqual([0, 1, 2, 3, 7].map(staggerDelayMs), [0, 60, 120, 180, 180]);
});

test("stagger ignores nonsense positions", () => {
  assert.equal(staggerStep(-2), 0);
  assert.equal(staggerStep(Number.NaN), 0);
  assert.equal(staggerStep(1.9), 1);
});

test("hash targets: sections count, the whole page does not", () => {
  assert.equal(isRevealTarget("SECTION"), true);
  assert.equal(isRevealTarget("div"), true);
  assert.equal(isRevealTarget("MAIN"), false);
  assert.equal(isRevealTarget("body"), false);
  assert.equal(isRevealTarget("HTML"), false);
  assert.equal(isRevealTarget(null), false);
  assert.equal(isRevealTarget(undefined), false);
});

test("a page restored from the bfcache reveals what is in view or above, and keeps the rest pending", () => {
  const viewportHeight = 900;
  assert.equal(revealsOnRestore({ top: -1400, viewportHeight }), true);
  assert.equal(revealsOnRestore({ top: 0, viewportHeight }), true);
  assert.equal(revealsOnRestore({ top: 700, viewportHeight }), true);
  assert.equal(revealsOnRestore({ top: 899.5, viewportHeight }), true);
  assert.equal(revealsOnRestore({ top: 900, viewportHeight }), false);
  assert.equal(revealsOnRestore({ top: 2400, viewportHeight }), false);
});

test("the restore rule is the one scroll restoration uses at load", () => {
  const viewportHeight = 900;
  for (const top of [-1400, -1, 0, 450, 899, 900, 901, 3000]) {
    assert.equal(isInViewOrAbove({ top, viewportHeight }), revealsOnRestore({ top, viewportHeight }));
    // Pending at load (below the fold, no hash) exactly when the restore rule would not reveal it.
    const pending = startsPending({ armed: true, top, bottom: top + 400, viewportHeight, relatedToHashTarget: false });
    assert.equal(pending, !revealsOnRestore({ top, viewportHeight }));
  }
});
