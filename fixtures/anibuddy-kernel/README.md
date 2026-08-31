# AniBuddy deformation kernel — golden corpus

The deformation math exists **twice**:

| implementation | location | consumed by |
| --- | --- | --- |
| NumPy | `py_backend/app/modules/anibuddy/kernel/` | the server render worker, which produces the authoritative export |
| TypeScript | `frontend/src/features/anibuddy/kernel/` | the browser, for interactive posing |

There is no shared compiled kernel, so nothing makes the two agree by
construction. This corpus makes them agree by enforcement.

The failure it exists to prevent is specific and silent: a user poses a
character in the browser, likes what they see, exports it, and the server
renders something different. No exception is thrown, no log line appears, and
the only symptom is a customer saying the export "looks off".

## Running it

```bash
./scripts/test-anibuddy-kernel.sh
```

Or each half alone:

```bash
cd py_backend && python -m unittest tests.test_kernel_parity -v
cd frontend  && pnpm test
```

## Layout

- `cases/*.json` — hand-authored inputs: a rig, and either a `pose`/`partPose`
  pair or a clip plus a time. Reviewable by hand; every number was chosen for a
  reason stated in that file's `description`.
- `golden/*.json` — expected outputs, generated from the **Python** kernel by
  `python -m tools.gen_kernel_goldens` (run from `py_backend/`).

A golden carries the resolved `pose` and `partPose` as flat
`[targetId, channel, value]` triples, the posed joints and derived bones, and
per part its `transform`, `srcVerts`, `dstVerts`, `tris` and warp report.
`transform` is the part tree's world affine `(a, b, originX, originY)` — already
folded into `dstVerts`, and emitted separately so a composition-order defect
names itself instead of surfacing as an unexplained vertex displacement.

Every float in a golden is exactly representable as float32 and is written with
Python's shortest round-tripping repr, so `JSON.parse` in Node recovers the
identical value. The golden file is a lossless transport for float32, not an
approximation of one.

## The asymmetry, and its sharp edge

Python generates the goldens. That makes:

- the **Python** test a *regression* check — "did our own math move?"
- the **TypeScript** test the *parity* check — "did the browser drift from the
  server?"

The sharp edge: regenerating the goldens makes a Python-side regression
disappear. Never run the generator to make a test pass. Run it only when the
change to the math was intended, then read the diff. An intended behavioural
change shows up as large deltas in a few cases; an accidental one shows up as
tiny deltas everywhere.

Because the goldens come from one of the two implementations, a golden
comparison alone could rubber-stamp a shared misunderstanding. Both test files
therefore also carry hand-derived analytic assertions — 90° puts the tip
straight down, identity skinning returns the source verts, seam bleed moves a
corner exactly 0.5 px — that are true independent of either implementation.

## The epsilon: 4 float32 ULP

Positions, warp matrices and bled corners are compared in **units in the last
place of float32**, budget 4. Not an absolute epsilon, because the tolerance has
to scale with coordinate magnitude:

| coordinate | 1 float32 ULP | 4 ULP budget |
| --- | --- | --- |
| 1 px | 1.2e-7 px | 4.8e-7 px |
| 512 px | 6.1e-5 px | 2.4e-4 px |
| 4096 px | 4.9e-4 px | 2.0e-3 px |

An absolute epsilon tight enough for the origin would false-positive at the far
corner of a large sheet; one loose enough for the far corner would hide a real
bug near the origin.

Four is the budget for the only legitimate source of divergence. Both kernels
compute in float64 and round to float32 once, at the output boundary, so a
1 ULP float64 disagreement between V8's `Math.sin` and NumPy's `sin` propagates
through a couple of multiply-adds before that rounding absorbs it. Meanwhile
any real defect — a swapped bone column, a dropped scale, a transposed warp
matrix — moves a vertex by whole pixels, which is roughly 2^13 ULP at 1024 px.
The gap between *tolerated* and *detected* is about three orders of magnitude.

`maxStretch` gets its own, looser, relative tolerance of 1e-5, because
`sigmaMin` is the difference of two nearly equal quantities on a nearly rigid
triangle and cancellation there amplifies sub-ULP input noise. It is a
user-facing warning, not geometry. Triangle indices, flip counts and degenerate
counts are compared **exactly** — those are topology, and no rounding could
make them differ legitimately.

### What the budget is actually costing today

At the time of writing, on Windows with NumPy 2.4.3 and Node 22.14, all
seventeen cases in this corpus agree at **0 ULP** — the two kernels are
bit-identical, part transform tree included, and they stayed at 0 through the
schema/kernel reconciliation that rewrote the lattice's control-point form and
gave the spline a taper track.
The 4 ULP budget is headroom for other platforms
(Linux CI, a different NumPy SIMD path, a future V8), not a margin currently
being consumed. The test prints the worst observed distance per case on every
run; if that number starts creeping toward 4 while still green, something is
drifting.

## Coverage

| case | what it pins down |
| --- | --- |
| `01-rigid-square` | rigid parts inherit the accumulated chain angle, not just their own bone's delta |
| `02-mesh-lbs-nonsquare` | 640x960 sheet — a kernel rotating in normalized space shears here |
| `03-lattice-bilinear` | bilinear FFD over ABSOLUTE part-local control points; a moved point scales by rect width for x and rect height for y, and an unmoved one must land on exactly the rest grid's float |
| `04-lattice-bicubic` | 288 triangles of Catmull-Rom surface plus rim clamping |
| `05-spline-tail` | 24-segment ribbon over a curling five-joint chain |
| `06-mixed-large-sheet` | all four deformers, 2048x1536, non-uniform destination scale |
| `07-clip-loop-wrap` | loop wraparound past the last key, smoothstep across the synthetic span |
| `08-clip-hold-segment` | `hold` easing, and an orientation flip |
| `09-degenerate-and-flipped` | zero-area source triangle dropped identically by both |
| `10-extreme-angles` | multi-turn rotations, where sin/cos argument reduction differs most |
| `11-dense-weights-deep-chain` | eight bones, every vertex bound to all of them, weights over three orders of magnitude |
| `12-part-tree-nested-pivots` | a three-level part chain, each level rotating and scaling about its own pivot — the case that pins composition order |
| `13-attach-slot-reanchor` | two identical swords differing only in which slot they name, plus a parented part with no slot that must not move |
| `14-part-clip-channel-sparsity` | part channels sampled from a clip: absent means rest, and parts bracket the same keys as joints |
| `15-part-tree-over-all-deformers` | one part transform over each of the four deformers, including the mesh part that has no single joint transform to fold into |
| `16-spline-taper` | a three-entry thickness track over a five-joint chain at 17 segments, so nothing lines up: the track is indexed along the SPINE, not by joint |
| `17-unbound-parts-ride-the-root` | `boundJointId` absent, null and naming a joint that is not there — all three ride the root, under a root that is posed so that "rides the root" and "rides nothing" differ |

The Python test asserts the corpus keeps covering all four deformer kinds and
still produces at least one degenerate triangle, one orientation flip and one
part past the stretch warning threshold — a corpus that stops exercising a
branch cannot protect it. The same rule is applied to the part tree: some case
must produce a non-identity part transform, some case must nest a part two
levels deep, some case must attach to a slot, and some case must animate a part
channel from a clip rather than from a literal pose block.

## What this harness does NOT catch

**Anything that is not a vertex.** This corpus compares geometry, and a
`PartPose`'s four *compositing* channels — `visible`, `opacity`, `zIndex`,
`swapTo` — move none. The two targets can disagree about which layers draw, in
what order, how strongly and out of whose pixels, and every case here will still
report 0 ULP, because that is the honest answer to the question this corpus
asks. They did disagree, on two counts at once and for months, while this table
read all zeros. `fixtures/anibuddy-compositing/` is the corpus that covers them;
neither harness substitutes for the other.

Mutation testing (deliberately breaking the TypeScript kernel and checking the
harness notices) gives:

| injected defect | detected |
| --- | --- |
| `(d * PI) / 180` folded to `d * (PI / 180)` | yes, 1 case |
| `SEAM_BLEED` 0.5 → 0.49 | yes, all cases |
| weight matrix column indexing transposed | yes, 7 cases |
| bone rotates about the child joint instead of the parent | yes, 9 cases |
| warp matrix `b` and `c` transposed | yes, all cases |
| **skinning reduction run in reverse bone order** | **no** |

That last row is honest rather than reassuring. Reversing the accumulation
order changes the float64 sum by ~1 ULP of float64, and rounding to float32 at
the boundary absorbs it — even on case 11, with eight dense weights spanning
three orders of magnitude. Reduction order is therefore enforced by the
documented rule and by code review, **not** by this harness. It still matters:
it would become observable the moment any output widens to float64, and NumPy's
`sum`/`matmul` reassociate freely, so the ban on them in the kernel stands.
