// Golden parity tests for the TypeScript deformation kernel.
//
// This is the half of the harness that matters. The Python kernel generates the
// goldens, so its own test is a regression check; THIS file is the only
// mechanism that catches the browser and the server disagreeing. Without it, a
// user poses something, likes it, exports it, and gets something different,
// with nothing failing anywhere.
//
// Run both halves with scripts/test-anibuddy-kernel.sh, or this half alone with
// `pnpm test` from frontend/.
//
// If a case here fails, do NOT widen the tolerance. Read the diagnostic: it
// names the case, the field, the flat index, both values and the ULP distance.
// A real divergence is thousands of ULP; libm noise is one or two.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { KernelConstants } from "../constants";
import { Numeric } from "../numeric";
import { PoseTrack } from "../clip";
import { Warp } from "../warp";
import { AniBuddyKernel } from "../kernel";
import { KernelFixtures, type FixtureCase, type SerializedResult } from "../fixture-runner";
import type { Clip, KernelRig, Part } from "../types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(HERE, "../../../../../..", "fixtures", "anibuddy-kernel");
const CASE_DIR = path.join(FIXTURE_ROOT, "cases");
const GOLDEN_DIR = path.join(FIXTURE_ROOT, "golden");

// --- float32 ULP comparison -------------------------------------------------
//
// Comparing in ULP rather than with an absolute epsilon is the whole reason
// this test can be both tight and portable. The scratch buffers are module
// scoped because allocating a Float32Array per comparison across ~6,400 floats
// per run is pure waste.

const SCRATCH_FLOAT = new Float32Array(1);
const SCRATCH_INT = new Int32Array(SCRATCH_FLOAT.buffer);

/**
 * Map a float32 onto a monotonically ordered integer.
 *
 * Consecutive representable floats map to consecutive integers, so the
 * difference between two of these IS the ULP distance. Sign-magnitude is
 * converted to a signed ordering, which also collapses -0 and +0 onto the same
 * value -- they compare equal as numbers and there is no reason for the harness
 * to disagree.
 */
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

interface Divergence {
  field: string;
  index: number;
  actual: number;
  expected: number;
  ulp: number;
}

function compareFloats(
  field: string,
  actual: readonly number[],
  expected: readonly number[],
  worst: Divergence,
): Divergence {
  assert.equal(
    actual.length,
    expected.length,
    `${field}: produced ${actual.length} values, golden has ${expected.length}. ` +
      `A length mismatch is a structural divergence, not a numeric one -- the two kernels ` +
      `disagree about how many vertices or triangles this deformer emits.`,
  );
  let current = worst;
  for (let index = 0; index < actual.length; index++) {
    const ulp = ulpDistance(actual[index], expected[index]);
    if (ulp > current.ulp) {
      current = { field, index, actual: actual[index], expected: expected[index], ulp };
    }
  }
  return current;
}

function compareIntegers(field: string, actual: readonly number[], expected: readonly number[]): void {
  assert.deepEqual(
    Array.from(actual),
    Array.from(expected),
    `${field}: index arrays must match exactly. These are topology, not measurements -- ` +
      `there is no rounding that could make them differ legitimately.`,
  );
}

const NO_DIVERGENCE: Divergence = { field: "", index: -1, actual: 0, expected: 0, ulp: 0 };

function describeDivergence(caseId: string, worst: Divergence): string {
  return (
    `${caseId} diverged from the golden by ${worst.ulp} float32 ULP ` +
    `(budget ${KernelConstants.PARITY_ULP_TOLERANCE}).\n` +
    `  field:    ${worst.field}[${worst.index}]\n` +
    `  browser:  ${worst.actual}\n` +
    `  server:   ${worst.expected}\n` +
    `  delta:    ${worst.actual - worst.expected}\n` +
    `Triage order: (1) did only one kernel change? (2) is an operation order ` +
    `different -- (a*b)/c vs a*(b/c)? (3) did a reduction get vectorized into a ` +
    `pairwise sum? (4) is this the extreme-angles case, where sin/cos argument ` +
    `reduction genuinely differs between V8 and NumPy? Only (4) is benign.`
  );
}

// --- corpus -----------------------------------------------------------------

const caseNames = readdirSync(CASE_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

const worstPerCase: Array<{ id: string; ulp: number; field: string }> = [];

describe("AniBuddy kernel golden parity", () => {
  test("the fixture corpus is present", () => {
    assert.ok(caseNames.length > 0, `no fixture cases found in ${CASE_DIR}`);
    const goldenNames = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    assert.deepEqual(
      caseNames,
      goldenNames,
      "every case needs a golden; regenerate with `python -m tools.gen_kernel_goldens` from py_backend/",
    );
  });

  for (const name of caseNames) {
    test(`matches the server kernel: ${name}`, () => {
      const fixtureCase = loadJson<FixtureCase>(path.join(CASE_DIR, name));
      const golden = loadJson<SerializedResult>(path.join(GOLDEN_DIR, name));
      const actual = KernelFixtures.evaluate(fixtureCase);

      assert.equal(actual.id, golden.id);

      let worst = NO_DIVERGENCE;

      // Keyframe interpolation. Compared as [jointId, channel, value] triples
      // so a channel that one kernel emits and the other omits shows up as a
      // structural difference rather than as a silent zero.
      assert.deepEqual(
        actual.pose.map((row) => `${row[0]}.${row[1]}`),
        golden.pose.map((row) => `${row[0]}.${row[1]}`),
        `${name}: the two kernels resolved different pose channels from the clip`,
      );
      worst = compareFloats(
        "pose",
        actual.pose.map((row) => row[2]),
        golden.pose.map((row) => row[2]),
        worst,
      );

      // Part channels, held to exactly the same standard as the joint ones --
      // same bracketing, same easing, same "absent means rest".
      assert.deepEqual(
        actual.partPose.map((row) => `${row[0]}.${row[1]}`),
        golden.partPose.map((row) => `${row[0]}.${row[1]}`),
        `${name}: the two kernels resolved different part channels from the clip`,
      );
      worst = compareFloats(
        "partPose",
        actual.partPose.map((row) => row[2]),
        golden.partPose.map((row) => row[2]),
        worst,
      );

      // Forward kinematics.
      assert.deepEqual(
        actual.joints.map((row) => row[0]),
        golden.joints.map((row) => row[0]),
        `${name}: joint identity or ordering differs`,
      );
      for (const column of [1, 2, 3] as const) {
        worst = compareFloats(
          `joints[*][${column}]`,
          actual.joints.map((row) => row[column]),
          golden.joints.map((row) => row[column]),
          worst,
        );
      }

      // Derived bones: order, rest angle, posed angle, rest length. Bone ORDER
      // is what indexes weight-matrix columns, so a reordering here would
      // silently rebind every skinned vertex.
      assert.deepEqual(
        actual.bones.map((row) => row[0]),
        golden.bones.map((row) => row[0]),
        `${name}: derived bone identity or ordering differs`,
      );
      for (const column of [1, 2, 3] as const) {
        worst = compareFloats(
          `bones[*][${column}]`,
          actual.bones.map((row) => row[column]),
          golden.bones.map((row) => row[column]),
          worst,
        );
      }

      // Part geometry.
      assert.equal(actual.parts.length, golden.parts.length, `${name}: part count differs`);
      for (let index = 0; index < golden.parts.length; index++) {
        const actualPart = actual.parts[index];
        const goldenPart = golden.parts[index];
        assert.equal(actualPart.id, goldenPart.id);
        assert.equal(actualPart.kind, goldenPart.kind);
        assert.equal(actualPart.zIndex, goldenPart.zIndex);

        compareIntegers(`${goldenPart.id}.tris`, actualPart.tris, goldenPart.tris);
        compareIntegers(
          `${goldenPart.id}.warp.triangleIndex`,
          actualPart.warp.triangleIndex,
          goldenPart.warp.triangleIndex,
        );
        assert.equal(
          actualPart.warp.flippedTriangles,
          goldenPart.warp.flippedTriangles,
          `${goldenPart.id}: orientation flip count differs`,
        );
        assert.equal(
          actualPart.warp.degenerateTriangles,
          goldenPart.warp.degenerateTriangles,
          `${goldenPart.id}: degenerate triangle count differs`,
        );

        // The part tree's world transform. Compared before the vertices so a
        // composition-order defect reports itself as one, rather than as an
        // unexplained displacement.
        worst = compareFloats(
          `${goldenPart.id}.transform`,
          actualPart.transform,
          goldenPart.transform,
          worst,
        );
        worst = compareFloats(`${goldenPart.id}.srcVerts`, actualPart.srcVerts, goldenPart.srcVerts, worst);
        worst = compareFloats(`${goldenPart.id}.dstVerts`, actualPart.dstVerts, goldenPart.dstVerts, worst);
        worst = compareFloats(
          `${goldenPart.id}.warp.matrices`,
          actualPart.warp.matrices,
          goldenPart.warp.matrices,
          worst,
        );
        worst = compareFloats(`${goldenPart.id}.warp.bled`, actualPart.warp.bled, goldenPart.warp.bled, worst);

        // maxStretch gets its own, looser, relative tolerance: sigmaMin is a
        // difference of two nearly equal quantities, so cancellation can
        // amplify a sub-ULP input difference. It is a user-facing warning, not
        // geometry.
        const stretchDelta = Math.abs(actualPart.warp.maxStretch - goldenPart.warp.maxStretch);
        const stretchAllowance =
          Math.max(1, Math.abs(goldenPart.warp.maxStretch)) *
          KernelConstants.PARITY_STRETCH_RELATIVE_TOLERANCE;
        assert.ok(
          stretchDelta <= stretchAllowance,
          `${goldenPart.id}: maxStretch ${actualPart.warp.maxStretch} vs ${goldenPart.warp.maxStretch} ` +
            `(delta ${stretchDelta}, allowance ${stretchAllowance})`,
        );
      }

      worstPerCase.push({ id: name, ulp: worst.ulp, field: worst.field || "(exact)" });
      assert.ok(worst.ulp <= KernelConstants.PARITY_ULP_TOLERANCE, describeDivergence(name, worst));
    });
  }

  after(() => {
    if (worstPerCase.length === 0) return;
    const rows = worstPerCase
      .map((row) => `  ${row.id.padEnd(32)} ${String(row.ulp).padStart(3)} ULP  ${row.field}`)
      .join("\n");
    const overall = Math.max(...worstPerCase.map((row) => row.ulp));
    // Printed so the margin is visible in CI logs. A budget nobody watches
    // erodes: if this creeps toward 4, something is drifting even while green.
    console.log(
      `\nfloat32 ULP distance from the server kernel (budget ${KernelConstants.PARITY_ULP_TOLERANCE}):\n` +
        `${rows}\n  worst overall: ${overall} ULP\n`,
    );
  });
});

// --- analytic checks --------------------------------------------------------
//
// The goldens come from the Python kernel, so a golden comparison alone would
// let a shared misunderstanding through. These assert properties derived by
// hand, and they mirror the ones in
// py_backend/tests/test_kernel_parity.py one for one.

const UNIT_RIG: KernelRig = {
  asset: { width: 100, height: 100, figureHeight: 100 },
  joints: [
    { id: "root", parent: null, x: 0.5, y: 0.5 },
    { id: "tip", parent: "root", x: 0.9, y: 0.5 },
  ],
  parts: [],
};

describe("AniBuddy kernel analytic checks", () => {
  test("rest pose leaves every joint at rest", () => {
    const skeleton = AniBuddyKernel.solve(UNIT_RIG, {});
    assert.deepEqual(skeleton.positions.get("root"), { x: 50, y: 50 });
    assert.ok(Math.abs(skeleton.positions.get("tip")!.x - 90) < 1e-12);
    assert.equal(skeleton.restAngles[0], 0);
    assert.equal(skeleton.restLengths[0], 40);
  });

  test("ninety degrees swings the tip down, matching canvas orientation", () => {
    const skeleton = AniBuddyKernel.solve(UNIT_RIG, { tip: { rot: 90 } });
    const tip = skeleton.positions.get("tip")!;
    assert.ok(Math.abs(tip.x - 50) < 1e-10, `x was ${tip.x}`);
    assert.ok(Math.abs(tip.y - 90) < 1e-10, `y was ${tip.y}`);
  });

  test("scale changes bone length, not bone angle", () => {
    const skeleton = AniBuddyKernel.solve(UNIT_RIG, { tip: { scale: 0.5 } });
    assert.ok(Math.abs(skeleton.positions.get("tip")!.x - 70) < 1e-12);
    assert.equal(skeleton.posedAngles[0], 0);
  });

  test("rotation accumulates down the chain", () => {
    const rig: KernelRig = {
      asset: { width: 100, height: 100, figureHeight: 100 },
      joints: [
        { id: "a", parent: null, x: 0.1, y: 0.5 },
        { id: "b", parent: "a", x: 0.3, y: 0.5 },
        { id: "c", parent: "b", x: 0.5, y: 0.5 },
      ],
      parts: [],
    };
    const skeleton = AniBuddyKernel.solve(rig, { b: { rot: 20 }, c: { rot: 15 } });
    assert.equal(skeleton.accumulated.get("b"), 20);
    assert.equal(skeleton.accumulated.get("c"), 35);
  });

  test("translation scales by figure height, not canvas height", () => {
    const rig: KernelRig = {
      asset: { width: 100, height: 100, figureHeight: 50 },
      joints: [{ id: "root", parent: null, x: 0.5, y: 0.5 }],
      parts: [],
    };
    const skeleton = AniBuddyKernel.solve(rig, { root: { ty: 0.5 } });
    assert.deepEqual(skeleton.positions.get("root"), { x: 50, y: 75 });
  });

  test("identity pose returns the source vertices unchanged", () => {
    // Weights chosen to sum to exactly 1 in binary, so this can be exact.
    const rig: KernelRig = {
      asset: { width: 128, height: 128, figureHeight: 128 },
      joints: [
        { id: "root", parent: null, x: 0.25, y: 0.5 },
        { id: "mid", parent: "root", x: 0.5, y: 0.5 },
        { id: "tip", parent: "mid", x: 0.75, y: 0.5 },
      ],
      parts: [
        {
          id: "strip",
          zIndex: 0,
          deformer: {
            kind: "mesh",
            boneCount: 2,
            verts: Float32Array.from([0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75]),
            tris: Uint32Array.from([0, 1, 3, 0, 3, 2]),
            weights: Float32Array.from([0.75, 0.25, 0.5, 0.5, 0.25, 0.75, 0.5, 0.5]),
          },
        },
      ],
    };
    const frame = AniBuddyKernel.evaluate(rig, {});
    assert.deepEqual(Array.from(frame.parts[0].dstVerts), Array.from(frame.parts[0].srcVerts));
  });

  test("identity warp is the identity matrix", () => {
    const verts = Float64Array.from([0, 0, 10, 0, 0, 10]);
    const batch = Warp.triangles(verts, verts, Uint32Array.from([0, 1, 2]));
    for (const [index, expected] of [1, 0, 0, 1, 0, 0].entries()) {
      assert.ok(Math.abs(batch.matrices[index] - expected) < 1e-6);
    }
    assert.equal(batch.maxStretch, 1);
    assert.equal(batch.flippedTriangles, 0);
  });

  test("uniaxial stretch is reported as its ratio", () => {
    const src = Float64Array.from([0, 0, 10, 0, 0, 10]);
    const dst = Float64Array.from([0, 0, 30, 0, 0, 10]);
    const batch = Warp.triangles(src, dst, Uint32Array.from([0, 1, 2]));
    assert.ok(Math.abs(batch.maxStretch - 3) < 1e-5, `maxStretch was ${batch.maxStretch}`);
  });

  test("a mirrored triangle is counted as flipped", () => {
    const src = Float64Array.from([0, 0, 10, 0, 0, 10]);
    const dst = Float64Array.from([0, 0, 0, 10, 10, 0]);
    assert.equal(Warp.triangles(src, dst, Uint32Array.from([0, 1, 2])).flippedTriangles, 1);
  });

  test("a degenerate source triangle is dropped", () => {
    const src = Float64Array.from([0, 0, 10, 0, 20, 0]);
    const batch = Warp.triangles(src, src, Uint32Array.from([0, 1, 2]));
    assert.equal(batch.degenerateTriangles, 1);
    assert.equal(batch.matrices.length, 0);
  });

  test("seam bleed pushes each corner exactly half a pixel outward", () => {
    const src = Float64Array.from([0, 0, 12, 0, 0, 12]);
    const batch = Warp.triangles(src, src, Uint32Array.from([0, 1, 2]));
    const centroidX = (0 + 12 + 0) / 3;
    const centroidY = (0 + 0 + 12) / 3;
    for (let corner = 0; corner < 3; corner++) {
      const before = Numeric.length(src[corner * 2] - centroidX, src[corner * 2 + 1] - centroidY);
      const after = Numeric.length(
        batch.bled[corner * 2] - centroidX,
        batch.bled[corner * 2 + 1] - centroidY,
      );
      assert.ok(
        Math.abs(after - before - KernelConstants.SEAM_BLEED) < 1e-4,
        `corner ${corner} moved ${after - before}`,
      );
    }
  });

  test("degree conversion keeps its operation order", () => {
    // (d * PI) / 180 and d * (PI / 180) are different functions. Guarded
    // because the "simplification" is tempting, invisible in review, and would
    // surface only as a parity failure.
    let divergent = 0;
    for (let value = 1; value < 4000; value++) {
      if (Numeric.radians(value) !== value * (Math.PI / 180)) divergent++;
    }
    assert.ok(divergent > 0, "if these never differ the guard is meaningless");
    assert.equal(Numeric.radians(180), (180 * Math.PI) / 180);
  });
});

// --- part transform tree ----------------------------------------------------
//
// Hand-derived, mirroring py_backend/tests/test_kernel_parity.py's PartTreeTests
// one for one. Every rig is 100x100 with the part quad on quarter boundaries, so
// the expected numbers are exact integers arrived at on paper rather than
// recorded from a run -- which is the only kind of assertion that can catch a
// misunderstanding both kernels share.

const QUAD_DEFORMER = { kind: "rigid" } as const;

function quad(id: string, overrides: Partial<Part> = {}): Part {
  return {
    id,
    zIndex: 0,
    // The rigid deformer draws Part.rect, so the quad and the part-local space
    // it is placed in are the same rectangle here.
    rect: [0.25, 0.25, 0.75, 0.75],
    pivot: [0.5, 0.5],
    boundJointId: "root",
    deformer: QUAD_DEFORMER,
    ...overrides,
  };
}

function partRig(parts: Part[], figureHeight = 100): KernelRig {
  return {
    asset: { width: 100, height: 100, figureHeight },
    joints: [{ id: "root", parent: null, x: 0.5, y: 0.5 }],
    parts,
  };
}

describe("AniBuddy part transform tree", () => {
  test("a part at rest gets exactly the identity", () => {
    // Exactly, not approximately -- the skip in evaluate depends on it.
    const frame = AniBuddyKernel.evaluate(partRig([quad("a")]), {});
    assert.deepEqual(Array.from(frame.parts[0].transform), [1, 0, 0, 0]);
    assert.deepEqual(
      Array.from(frame.parts[0].dstVerts),
      Array.from(frame.parts[0].srcVerts),
    );
  });

  test("rotation turns the part about its own pivot", () => {
    // +90 degrees is clockwise on canvas, so (25,25) swings to (75,25).
    const frame = AniBuddyKernel.evaluate(partRig([quad("a")]), {}, 1, 1, { a: { rot: 90 } });
    assert.ok(Math.abs(frame.parts[0].dstVerts[0] - 75) < 1e-4);
    assert.ok(Math.abs(frame.parts[0].dstVerts[1] - 25) < 1e-4);
  });

  test("a child composes with its parent rather than replacing it", () => {
    // Two 90-degree turns about the same pivot must total 180, not 90. Applying
    // only the child, only the parent, or the two in the wrong order all land
    // somewhere other than the opposite corner.
    const rig = partRig([quad("a"), quad("b", { parentPartId: "a" })]);
    const frame = AniBuddyKernel.evaluate(rig, {}, 1, 1, { a: { rot: 90 }, b: { rot: 90 } });
    assert.ok(Math.abs(frame.parts[1].dstVerts[0] - 75) < 1e-4);
    assert.ok(Math.abs(frame.parts[1].dstVerts[1] - 75) < 1e-4);
  });

  test("a child with no pose still follows its parent", () => {
    const rig = partRig([quad("a"), quad("b", { parentPartId: "a" })]);
    const frame = AniBuddyKernel.evaluate(rig, {}, 1, 1, { a: { rot: 90 } });
    assert.ok(Math.abs(frame.parts[1].dstVerts[0] - 75) < 1e-4);
    assert.ok(Math.abs(frame.parts[1].dstVerts[1] - 25) < 1e-4);
  });

  test("part translation scales by figure height, not canvas height", () => {
    const frame = AniBuddyKernel.evaluate(partRig([quad("a")], 50), {}, 1, 1, { a: { tx: 0.5 } });
    assert.ok(Math.abs(frame.parts[0].dstVerts[0] - 50) < 1e-9);
    assert.ok(Math.abs(frame.parts[0].dstVerts[1] - 25) < 1e-9);
  });

  test("an attachment slot moves the child pivot onto it", () => {
    // The host's slot is at 50,50 px and the child's pivot at 70,70, so
    // attaching translates the child by exactly (-20, -20) and its quad's
    // top-left corner moves from (60,60) to (40,40). Integers throughout, so
    // this can be asserted exactly.
    const rig: KernelRig = {
      asset: { width: 100, height: 100, figureHeight: 100 },
      joints: [{ id: "root", parent: null, x: 0.5, y: 0.5 }],
      parts: [
        {
          id: "host",
          zIndex: 0,
          rect: [0, 0, 0.5, 0.5],
          pivot: [0.5, 0.5],
          slots: [{ name: "tip", x: 1, y: 1 }],
          boundJointId: "root",
          deformer: { kind: "rigid" },
        },
        {
          id: "clipOn",
          zIndex: 1,
          rect: [0.6, 0.6, 0.8, 0.8],
          pivot: [0.5, 0.5],
          parentPartId: "host",
          attachSlot: "tip",
          boundJointId: "root",
          deformer: { kind: "rigid" },
        },
      ],
    };
    const frame = AniBuddyKernel.evaluate(rig, {});
    assert.deepEqual(Array.from(frame.parts[1].transform), [1, 0, -20, -20]);
    assert.deepEqual(Array.from(frame.parts[1].dstVerts.slice(0, 2)), [40, 40]);
  });

  test("parenting without a slot leaves the child where it was drawn", () => {
    // The other half of the slot contract, and the reason it is safe: a rig
    // stage that parents every part by overlap must not move any of them.
    const rig = partRig([quad("a"), quad("b", { parentPartId: "a" })]);
    const frame = AniBuddyKernel.evaluate(rig, {});
    assert.deepEqual(Array.from(frame.parts[1].transform), [1, 0, 0, 0]);
  });

  test("an unknown parent is refused", () => {
    assert.throws(
      () => AniBuddyKernel.evaluate(partRig([quad("a", { parentPartId: "ghost" })]), {}),
      /ghost/,
    );
  });

  test("a cycle is refused", () => {
    const rig = partRig([
      quad("a", { parentPartId: "b" }),
      quad("b", { parentPartId: "a" }),
    ]);
    assert.throws(() => AniBuddyKernel.evaluate(rig, {}), /cycle/);
  });

  test("a chain past the depth cap is refused", () => {
    const parts = [quad("p0")];
    for (let index = 1; index <= KernelConstants.MAX_PART_DEPTH + 1; index++) {
      parts.push(quad(`p${index}`, { parentPartId: `p${index - 1}` }));
    }
    assert.throws(
      () => AniBuddyKernel.evaluate(partRig(parts), {}),
      new RegExp(String(KernelConstants.MAX_PART_DEPTH)),
    );
  });

  test("a duplicate part id is refused", () => {
    assert.throws(() => AniBuddyKernel.evaluate(partRig([quad("a"), quad("a")]), {}));
  });

  test("an unoffered slot is refused", () => {
    const rig = partRig([quad("a"), quad("b", { parentPartId: "a", attachSlot: "nope" })]);
    assert.throws(() => AniBuddyKernel.evaluate(rig, {}), /nope/);
  });

  test("an attachment with no parent is refused", () => {
    assert.throws(() =>
      AniBuddyKernel.evaluate(partRig([quad("a", { attachSlot: "tip" })]), {}),
    );
  });
});

// --- spline taper and the bound-joint fallback ------------------------------
//
// Hand-derived, mirroring py_backend/tests/test_kernel_parity.py one for one.
// Taper is new math and the fallback used to live in each caller's adapter, so
// both are exactly the kind of rule the two kernels could have read the same
// wrong way -- which a golden comparison alone would rubber-stamp.

function straightTail(thickness: number[], segments: number): KernelRig {
  // Two joints on a horizontal line 60 px apart, at y = 50.
  return {
    asset: { width: 100, height: 100, figureHeight: 100 },
    joints: [
      { id: "root", parent: null, x: 0.2, y: 0.5 },
      { id: "tip", parent: "root", x: 0.8, y: 0.5 },
    ],
    parts: [
      {
        id: "tail",
        zIndex: 0,
        deformer: { kind: "spline", joints: ["root", "tip"], thickness, segments },
      },
    ],
  };
}

describe("AniBuddy spline taper", () => {
  test("the track interpolates linearly to a point", () => {
    // A track of [0.2, 0] over two segments gives half-widths 10, 5, 0. The
    // spine is straight and horizontal, so the normal is exactly (0, 1) and
    // each sample's rails sit at y = 50 +/- halfWidth. The middle sample lands
    // at x = 50: a two-point chain's Catmull-Rom has phantom endpoints, so its
    // bezier is (20, 30, 70, 80) and t = 0.5 gives (20 + 90 + 210 + 80) / 8.
    const frame = AniBuddyKernel.evaluate(straightTail([0.2, 0], 2), {});
    const expected = [20, 60, 20, 40, 50, 55, 50, 45, 80, 50, 80, 50];
    for (const [index, value] of expected.entries()) {
      assert.ok(
        Math.abs(frame.parts[0].dstVerts[index] - value) < 1e-4,
        `vertex component ${index} was ${frame.parts[0].dstVerts[index]}, expected ${value}`,
      );
    }
  });

  test("a one-entry track is a uniform ribbon", () => {
    const frame = AniBuddyKernel.evaluate(straightTail([0.2], 2), {});
    for (let sample = 0; sample < 3; sample++) {
      assert.ok(Math.abs(frame.parts[0].dstVerts[sample * 4 + 1] - 60) < 1e-4);
    }
  });

  test("the track is indexed along the spine, not by joint", () => {
    // Three entries over a two-joint chain: indexed by joint it would run off
    // the end at the second joint, indexed by normalized position it reaches
    // its last entry exactly at the tip.
    const frame = AniBuddyKernel.evaluate(straightTail([0.2, 0.1, 0], 4), {});
    for (const [sample, expected] of [10, 7.5, 5, 2.5, 0].entries()) {
      const rail = frame.parts[0].dstVerts[sample * 4 + 1] - 50;
      assert.ok(Math.abs(rail - expected) < 1e-4, `sample ${sample} rail was ${rail}`);
    }
  });
});

describe("AniBuddy bound-joint fallback", () => {
  // A part with no usable bound joint rides the ROOT, not the identity. The two
  // kernels used to resolve this in their own wire adapters and had drifted:
  // the server bound an unbound lattice to the root and the browser left it
  // untransformed.
  const flagRig = (part: Partial<Part>): KernelRig => ({
    asset: { width: 100, height: 100, figureHeight: 100 },
    joints: [{ id: "root", parent: null, x: 0.5, y: 0.5 }],
    parts: [{ id: "flag", zIndex: 0, rect: [0, 0, 0.5, 0.5], deformer: { kind: "rigid" }, ...part }],
  });

  test("null, missing and unknown all ride the root", () => {
    // The root translates by +25 px (figureHeight 100, tx 0.25), so every
    // corner moves with it. Were the fallback the identity, dst would equal src.
    const expected = [25, 0, 75, 0, 25, 50, 75, 50];
    for (const part of [{}, { boundJointId: null }, { boundJointId: "noSuchJoint" }]) {
      const frame = AniBuddyKernel.evaluate(flagRig(part), { root: { tx: 0.25 } });
      for (const [index, value] of expected.entries()) {
        assert.ok(
          Math.abs(frame.parts[0].dstVerts[index] - value) < 1e-9,
          `${JSON.stringify(part)}: component ${index} was ${frame.parts[0].dstVerts[index]}`,
        );
      }
    }
  });

  test("a lattice falls back the same way as a rigid part", () => {
    // The divergence that started this: same field, same rule, both kinds.
    const pose = { root: { tx: 0.25 } };
    const rigid = AniBuddyKernel.evaluate(flagRig({ boundJointId: null }), pose);
    const lattice = AniBuddyKernel.evaluate(
      flagRig({
        boundJointId: null,
        deformer: {
          kind: "lattice",
          cols: 1,
          rows: 1,
          interpolation: "bilinear",
          controlPoints: Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]),
        },
      }),
      pose,
    );
    for (let index = 0; index < rigid.parts[0].dstVerts.length; index++) {
      assert.ok(Math.abs(lattice.parts[0].dstVerts[index] - rigid.parts[0].dstVerts[index]) < 1e-9);
    }
  });
});

describe("AniBuddy part channel sampling", () => {
  // partPoseAt must behave exactly as poseAt does.
  const mixed: Clip = {
    id: "test",
    loop: false,
    keyframes: [
      { t: 0, joints: { a: { rot: 0 } }, parts: { lid: { scale: 2 } }, ease: "linear" },
      { t: 1, joints: { a: { rot: 4 } }, parts: { lid: { rot: 4 } }, ease: "linear" },
    ],
  };

  test("an absent part channel falls back to rest", () => {
    // The key at t=1 omits scale, so scale decays toward 1, not toward 2.
    const pose = PoseTrack.partPoseAt(mixed, 0.5);
    assert.ok(Math.abs(pose.lid.scale! - 1.5) < 1e-6, `scale was ${pose.lid.scale}`);
    assert.ok(Math.abs(pose.lid.rot! - 2) < 1e-6);
  });

  test("part and joint channels ease by the same progress", () => {
    // One bracket, one easing curve. A desync here has no visible symptom.
    for (const time of [0.2, 0.5, 0.8]) {
      const joints = PoseTrack.poseAt(mixed, time);
      const parts = PoseTrack.partPoseAt(mixed, time);
      assert.equal(joints.a.rot, parts.lid.rot);
    }
  });

  test("a clip with no part keys resolves to an empty part pose", () => {
    const jointsOnly: Clip = {
      id: "joints-only",
      loop: false,
      keyframes: [
        { t: 0, joints: { a: { rot: 0 } } },
        { t: 1, joints: { a: { rot: 10 } } },
      ],
    };
    assert.deepEqual(PoseTrack.partPoseAt(jointsOnly, 0.5), {});
  });
});

describe("AniBuddy keyframe interpolation", () => {
  const clip = (loop: boolean): Clip => ({
    id: "test",
    loop,
    keyframes: [
      { t: 0, joints: { a: { rot: 0 } }, ease: "linear" },
      { t: 0.5, joints: { a: { rot: 10, scale: 2 } }, ease: "hold" },
      { t: 1, joints: { a: { rot: 20 } } },
    ],
  });

  test("landing on a key returns that key", () => {
    const pose = PoseTrack.poseAt(clip(false), 0.5);
    assert.ok(Math.abs(pose.a.rot! - 10) < 1e-6);
    assert.ok(Math.abs(pose.a.scale! - 2) < 1e-6);
  });

  test("linear easing interpolates proportionally", () => {
    assert.ok(Math.abs(PoseTrack.poseAt(clip(false), 0.25).a.rot! - 5) < 1e-6);
  });

  test("hold easing stays on the starting key", () => {
    assert.ok(Math.abs(PoseTrack.poseAt(clip(false), 0.75).a.rot! - 10) < 1e-6);
  });

  test("an absent channel falls back to rest, not to the neighbour", () => {
    const decaying: Clip = {
      id: "test",
      loop: false,
      keyframes: [
        { t: 0, joints: { a: { scale: 2 } }, ease: "linear" },
        { t: 1, joints: { a: { rot: 4 } }, ease: "linear" },
      ],
    };
    const pose = PoseTrack.poseAt(decaying, 0.5);
    assert.ok(Math.abs(pose.a.scale! - 1.5) < 1e-6, `scale was ${pose.a.scale}`);
    assert.ok(Math.abs(pose.a.rot! - 2) < 1e-6);
  });

  test("an absent ease is smoothstep", () => {
    const smooth: Clip = {
      id: "test",
      loop: false,
      keyframes: [
        { t: 0, joints: { a: { rot: 0 } } },
        { t: 1, joints: { a: { rot: 100 } } },
      ],
    };
    // smoothstep(0.25) = 0.25^2 * (3 - 0.5) = 0.15625
    assert.ok(Math.abs(PoseTrack.poseAt(smooth, 0.25).a.rot! - 15.625) < 1e-6);
  });

  test("a looping clip wraps back onto its first key", () => {
    assert.ok(PoseTrack.poseAt(clip(true), 0.999).a.rot! < 20);
    assert.ok(Math.abs(PoseTrack.poseAt(clip(false), 1).a.rot! - 20) < 1e-6);
  });

  test("an empty clip is an empty pose", () => {
    assert.deepEqual(PoseTrack.poseAt({ id: "empty", loop: true, keyframes: [] }, 0.4), {});
  });
});
