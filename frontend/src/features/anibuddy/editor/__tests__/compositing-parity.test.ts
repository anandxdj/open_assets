// Golden parity tests for the TypeScript compositing-channel resolver.
//
// The half of the compositing harness that matters. The Python resolver
// generates the goldens, so its own test is a regression check; THIS file is the
// only mechanism that catches the browser and the server disagreeing about what
// a `PartPose` compositing channel MEANS.
//
// It exists because ../../kernel/__tests__/parity.test.ts structurally cannot.
// That corpus compares vertices, and none of these four channels moves one. The
// two implementations disagreed for months on two separate counts -- the server
// multiplied resolved opacity by `Part.opacity` while the browser treated that
// field as a fallback, and the server substituted a `swapTo` target's whole
// posed part while the browser substituted only its pixels -- and the vertex
// harness reported 0 ULP across all seventeen fixtures the entire time.
//
// Run both halves with scripts/test-anibuddy-compositing.sh, or this half alone
// with `pnpm test` from frontend/.
//
// If a case here fails, do NOT regenerate the goldens. Read the diagnostic: it
// names the case, the instant, the part and the field.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { KernelConstants, PoseTrack } from "../../kernel/index.kernel";
import type { Clip } from "@/features/anibuddy/rig/index.rig";
import { CompositingConstants } from "../compositing.constants";
import { PartTrack } from "../part-track";
import { RigAdapter } from "../rig-adapter";
import {
  CompositingFixtures,
  type CompositingCase,
  type SerializedCompositing,
  type SerializedFrame,
} from "../compositing-fixtures";
import type { CompositingClip, CompositingPart } from "../editor.types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../../../../..", "fixtures", "anibuddy-compositing");
const CASE_DIR = path.join(FIXTURE_ROOT, "cases");
const GOLDEN_DIR = path.join(FIXTURE_ROOT, "golden");

// --- float32 ULP comparison -------------------------------------------------
//
// Identical machinery to the kernel harness, for consistency rather than
// necessity: nothing here calls libm, so opacity and the remap are pure IEEE
// arithmetic and land bit-identically. Holding them to the same budget means a
// future channel that DOES reach a transcendental is already covered.

const SCRATCH_FLOAT = new Float32Array(1);
const SCRATCH_INT = new Int32Array(SCRATCH_FLOAT.buffer);

function orderedBits(value: number): number {
  SCRATCH_FLOAT[0] = value;
  const bits = SCRATCH_INT[0];
  const magnitude = bits & 0x7fffffff;
  return bits < 0 ? -magnitude : magnitude;
}

function ulpDistance(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b ? 0 : Infinity;
  return Math.abs(orderedBits(a) - orderedBits(b));
}

function assertClose(label: string, actual: number, expected: number): number {
  const ulp = ulpDistance(actual, expected);
  assert.ok(
    ulp <= KernelConstants.PARITY_ULP_TOLERANCE,
    `${label}: browser ${actual} vs server ${expected} ` +
      `(${ulp} float32 ULP, budget ${KernelConstants.PARITY_ULP_TOLERANCE}). ` +
      `Triage order: (1) does one side still multiply by Part.opacity? ` +
      `(2) does one side blend a one-sided key against a constant instead of ` +
      `against the part's own value? (3) did the two bracket different keys?`,
  );
  return ulp;
}

// --- corpus -----------------------------------------------------------------

const caseNames = readdirSync(CASE_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function compareFrame(label: string, actual: SerializedFrame, golden: SerializedFrame): number {
  let worst = 0;

  assert.equal(
    actual.resolved.length,
    golden.resolved.length,
    `${label}: resolved a different number of parts`,
  );
  for (let index = 0; index < golden.resolved.length; index++) {
    const [partId, visible, opacity, zIndex, swapTo] = actual.resolved[index];
    const [goldenId, goldenVisible, goldenOpacity, goldenZ, goldenSwap] = golden.resolved[index];
    // Identity, visibility, draw order and swap target are compared EXACTLY.
    // None of them is a measurement, so no rounding could make them differ.
    assert.equal(partId, goldenId, `${label}: part order differs`);
    assert.equal(visible, goldenVisible, `${label}: ${partId}.visible differs`);
    assert.equal(zIndex, goldenZ, `${label}: ${partId}.zIndex differs`);
    assert.equal(swapTo, goldenSwap, `${label}: ${partId}.swapTo differs`);
    worst = Math.max(worst, assertClose(`${label}: ${partId}.opacity`, opacity, goldenOpacity));
  }

  assert.deepEqual(
    actual.draw.map((row) => `${row[0]}<-${row[1]}@${row[2]}#${row[4]}`),
    golden.draw.map((row) => `${row[0]}<-${row[1]}@${row[2]}#${row[4]}`),
    `${label}: the draw list differs in which layers draw, in what order, or out ` +
      `of whose pixels. Each entry reads partId<-texturePartId@zIndex#documentOrder.`,
  );
  for (let index = 0; index < golden.draw.length; index++) {
    const row = actual.draw[index];
    const goldenRow = golden.draw[index];
    worst = Math.max(worst, assertClose(`${label}: draw[${row[0]}].opacity`, row[3], goldenRow[3]));
    const remap = [row[5], row[6], row[7], row[8]];
    const goldenRemap = [goldenRow[5], goldenRow[6], goldenRow[7], goldenRow[8]];
    for (let component = 0; component < remap.length; component++) {
      worst = Math.max(
        worst,
        assertClose(
          `${label}: draw[${row[0]}].uvRemap[${component}]`,
          remap[component],
          goldenRemap[component],
        ),
      );
    }
  }

  return worst;
}

describe("AniBuddy compositing golden parity", () => {
  test("the fixture corpus is present", () => {
    assert.ok(caseNames.length > 0, `no fixture cases found in ${CASE_DIR}`);
    const goldenNames = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    assert.deepEqual(
      caseNames,
      goldenNames,
      "every case needs a golden; regenerate with `python -m tools.gen_compositing_goldens` from py_backend/",
    );
  });

  for (const name of caseNames) {
    test(`matches the server resolver: ${name}`, () => {
      const fixtureCase = loadJson<CompositingCase>(path.join(CASE_DIR, name));
      const golden = loadJson<SerializedCompositing>(path.join(GOLDEN_DIR, name));
      const actual = CompositingFixtures.evaluate(fixtureCase);

      assert.equal(actual.id, golden.id);
      assert.deepEqual(
        actual.warnings,
        golden.warnings,
        `${name}: the two resolvers disagree about which swaps are unresolvable, ` +
          `or about how to say so`,
      );
      assert.equal(
        actual.frames.length,
        golden.frames.length,
        `${name}: sampled a different number of instants`,
      );

      for (let index = 0; index < golden.frames.length; index++) {
        assert.equal(
          actual.frames[index].time,
          golden.frames[index].time,
          `${name}: frame ${index} sampled a different instant`,
        );
        compareFrame(
          `${name} @ t=${golden.frames[index].time}`,
          actual.frames[index],
          golden.frames[index],
        );
      }
    });
  }
});

// --- analytic checks --------------------------------------------------------
//
// The goldens come from the Python resolver, so a golden comparison alone would
// let a shared misunderstanding through. These assert the rule the JSON Schema
// states on `PartPose`, derived by hand, and they mirror the ones in
// py_backend/tests/test_compositing_parity.py one for one.

function part(id: string, overrides: Partial<CompositingPart> = {}): CompositingPart {
  return {
    id,
    visible: true,
    opacity: 1,
    zIndex: 0,
    rect: { x: 0, y: 0, width: 1, height: 1 },
    ...overrides,
  };
}

const silent = (): void => {};

describe("Part.opacity is the rest value of PartPose.opacity", () => {
  test("no clip resolves the part exactly as authored", () => {
    const resolved = PartTrack.resolveOne(
      part("p", { opacity: 0.375, zIndex: -3 }),
      [],
      false,
      0.5,
    );
    assert.equal(resolved.visible, true);
    assert.equal(resolved.opacity, 0.375);
    assert.equal(resolved.zIndex, -3);
    assert.equal(resolved.swapTo, null);
  });

  test("a key replaces the rest opacity and never scales it", () => {
    // 0.5 authored, 0.5 keyed, resolves 0.5. Multiplying would give 0.25.
    const clip: CompositingClip = {
      loop: false,
      keyframes: [
        { t: 0, ease: "linear", parts: { p: { opacity: 0.5 } } },
        { t: 1, ease: "linear", parts: { p: { opacity: 0.5 } } },
      ],
    };
    for (const time of [0, 0.25, 0.5, 1]) {
      const resolved = PartTrack.resolveOne(part("p", { opacity: 0.5 }), clip.keyframes, false, time);
      assert.ok(Math.abs(resolved.opacity - 0.5) < 1e-12, `at t=${time} it was ${resolved.opacity}`);
    }
  });

  test("a key can drive a translucent part to fully opaque", () => {
    // The property the multiply reading cannot express at all.
    const clip: CompositingClip = {
      loop: false,
      keyframes: [{ t: 0, ease: "hold", parts: { p: { opacity: 1 } } }],
    };
    assert.equal(
      PartTrack.resolveOne(part("p", { opacity: 0.25 }), clip.keyframes, false, 0.5).opacity,
      1,
    );
  });

  test("a one-sided key blends against the part, not against 1", () => {
    // Authored 0.4, keyed to 1 at t=1 only, linear. Halfway is 0.7 by hand:
    // 0.4 + (1 - 0.4) * 0.5. Blending against a schema-wide 1 would give a flat
    // 1 for the entire clip.
    const clip: CompositingClip = {
      loop: false,
      keyframes: [
        { t: 0, ease: "linear", parts: {} },
        { t: 1, ease: "linear", parts: { p: { opacity: 1 } } },
      ],
    };
    for (const [time, expected] of [
      [0, 0.4],
      [0.5, 0.7],
      [1, 1],
    ] as const) {
      const resolved = PartTrack.resolveOne(part("p", { opacity: 0.4 }), clip.keyframes, false, time);
      assert.ok(
        Math.abs(resolved.opacity - expected) < 1e-12,
        `at t=${time} it was ${resolved.opacity}, expected ${expected}`,
      );
    }
  });

  test("visible and zIndex fall back to the part when a key is silent", () => {
    const clip: CompositingClip = {
      loop: false,
      keyframes: [
        { t: 0, ease: "linear", parts: { p: { visible: true, zIndex: 2 } } },
        { t: 0.5, ease: "linear", parts: { p: { opacity: 1 } } },
      ],
    };
    const authored = part("p", { visible: false, zIndex: 11 });
    const early = PartTrack.resolveOne(authored, clip.keyframes, false, 0.25);
    const late = PartTrack.resolveOne(authored, clip.keyframes, false, 0.75);
    assert.deepEqual([early.visible, early.zIndex], [true, 2]);
    assert.deepEqual(
      [late.visible, late.zIndex],
      [false, 11],
      "absent means REST, not 'hold what the previous key left'",
    );
  });

  test("stepped channels take the earlier key whole", () => {
    const clip: CompositingClip = {
      loop: false,
      keyframes: [
        { t: 0, ease: "linear", parts: { p: { zIndex: 0 } } },
        { t: 1, ease: "linear", parts: { p: { zIndex: 10 } } },
      ],
    };
    for (const time of [0.01, 0.5, 0.99]) {
      assert.equal(PartTrack.resolveOne(part("p"), clip.keyframes, false, time).zIndex, 0);
    }
  });
});

describe("compositing and geometry share one bracketing search", () => {
  test("opacity eases by exactly the curve the kernel reports", () => {
    // Smoothstep, so a linear-vs-eased difference is visible at every sample.
    const clip: CompositingClip = {
      loop: false,
      keyframes: [
        { t: 0, parts: { p: { opacity: 0 } } },
        { t: 1, parts: { p: { opacity: 1 } } },
      ],
    };
    for (const time of [0.125, 0.25, 0.4, 0.6, 0.875]) {
      const resolved = PartTrack.resolveOne(part("p", { opacity: 0 }), clip.keyframes, false, time);
      assert.ok(
        Math.abs(resolved.opacity - PoseTrack.ease(time, undefined)) < 1e-12,
        `at t=${time} opacity was ${resolved.opacity}`,
      );
    }
  });

  test("a part's opacity and a joint's rotation land on the same keys", () => {
    // The real path, and the desync with no visible symptom. ONE wire clip:
    // `rot` is resolved through the kernel's own sampler after the same adapter
    // the editor uses, `opacity` through the compositing resolver. Both ramp
    // over the same span, so rot / 40 must equal opacity. Mirrors
    // test_the_render_stage_and_the_kernel_bracket_the_same_wire_clip.
    const clip: Clip = {
      id: "clip_shared",
      name: "shared",
      request: "",
      loop: false,
      fps: 12,
      frameCount: 8,
      source: "edited",
      keyframes: [
        { t: 0, ease: "ease", joints: { j: { rot: 0 } }, parts: { p: { opacity: 0 } } },
        { t: 1, ease: "ease", joints: { j: { rot: 40 } }, parts: { p: { opacity: 1 } } },
      ],
    };
    const kernelClip = RigAdapter.toKernelClip(clip);

    for (const time of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const joints = PoseTrack.poseAt(kernelClip, time);
      const composite = PartTrack.resolveOne(part("p", { opacity: 0 }), clip.keyframes, false, time);
      assert.ok(
        Math.abs(joints.j.rot! / 40 - composite.opacity) < 1e-12,
        `at t=${time}: rot/40 = ${joints.j.rot! / 40}, opacity = ${composite.opacity}`,
      );
    }
  });

  test("a looping clip wraps the compositing channels onto key 0", () => {
    const clip: CompositingClip = {
      loop: true,
      keyframes: [
        { t: 0, ease: "linear", parts: { p: { opacity: 0 } } },
        { t: 0.5, ease: "linear", parts: { p: { opacity: 1 } } },
      ],
    };
    // Past the last key the span is 0.5 -> 1.5, so t = 0.75 is halfway back to
    // key 0's 0. Without the wrap the value would hold at 1.
    const resolved = PartTrack.resolveOne(part("p", { opacity: 0.5 }), clip.keyframes, true, 0.75);
    assert.ok(Math.abs(resolved.opacity - 0.5) < 1e-12, `it was ${resolved.opacity}`);
  });
});

describe("composite order, the two cuts, and what a swap moves", () => {
  test("document order breaks a z-index tie", () => {
    const entries = PartTrack.compositeOrder(
      [part("second", { zIndex: 1 }), part("first", { zIndex: 1 })],
      null,
      0,
      silent,
    );
    assert.deepEqual(
      entries.map((entry) => entry.partId),
      ["second", "first"],
      "an id-based tie-break would sort 'first' ahead of 'second'",
    );
  });

  test("hidden and transparent layers leave the list", () => {
    const entries = PartTrack.compositeOrder(
      [part("drawn"), part("hidden", { visible: false }), part("clear", { opacity: 0 })],
      null,
      0,
      silent,
    );
    assert.deepEqual(
      entries.map((entry) => entry.partId),
      ["drawn"],
    );
  });

  test("a swap keeps the referring part's geometry, z-index and opacity", () => {
    const source = part("mouth", {
      zIndex: 4,
      opacity: 0.75,
      rect: { x: 0.125, y: 0.25, width: 0.125, height: 0.2 },
    });
    const target = part("open", {
      zIndex: 9,
      opacity: 0.2,
      rect: { x: 0.5, y: 0.5, width: 0.25, height: 0.1 },
    });
    const clip: CompositingClip = {
      loop: false,
      keyframes: [{ t: 0, ease: "hold", parts: { mouth: { swapTo: "open" } } }],
    };
    const entries = PartTrack.compositeOrder([source, target], clip, 0, silent);

    assert.equal(entries[0].partId, "mouth", "geometry stays the referrer's");
    assert.equal(entries[0].texturePartId, "open", "pixels come from the target");
    assert.equal(entries[0].zIndex, 4, "draw order stays the referrer's");
    assert.equal(entries[0].opacity, 0.75, "opacity stays the referrer's");
    // scale 0.25/0.125 = 2 and 0.1/0.2 = 0.5; offsets 0.5 - 0.125*2 and
    // 0.5 - 0.25*0.5. All exact in binary, so this is an equality.
    assert.deepEqual(Array.from(entries[0].uvRemap), [2, 0.5, 0.25, 0.375]);
    assert.equal(entries[1].partId, "open", "the target is still drawn as itself");
  });

  test("an unresolvable swap warns and draws the part as itself", () => {
    const warnings: string[] = [];
    const clip: CompositingClip = {
      loop: false,
      keyframes: [{ t: 0, ease: "hold", parts: { p: { swapTo: "ghost" } } }],
    };
    const entries = PartTrack.compositeOrder([part("p")], clip, 0, (message) =>
      warnings.push(message),
    );

    assert.equal(entries[0].texturePartId, "p");
    assert.deepEqual(
      Array.from(entries[0].uvRemap),
      Array.from(CompositingConstants.IDENTITY_UV_REMAP),
    );
    assert.deepEqual(warnings, [CompositingConstants.UNRESOLVED_SWAP_WARNING("p", "ghost")]);
  });

  test("a zero-sized source rect falls back to unit scale on that axis only", () => {
    const remap = PartTrack.uvRemap(
      part("flat", { rect: { x: 0.25, y: 0.25, width: 0, height: 0.5 } }),
      part("solid", { rect: { x: 0.5, y: 0, width: 0.25, height: 0.25 } }),
    );
    assert.equal(remap[0], CompositingConstants.IDENTITY_UV_REMAP[0]);
    assert.equal(remap[1], 0.5);
  });
});
