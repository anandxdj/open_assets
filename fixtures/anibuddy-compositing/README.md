# AniBuddy compositing channels — golden corpus

A `PartPose` carries eight channels and they split in two:

| half | channels | resolved by | guarded by |
| --- | --- | --- | --- |
| **geometry** | `rot`, `tx`, `ty`, `scale` | the deformation kernel, twice | `fixtures/anibuddy-kernel/` |
| **compositing** | `visible`, `opacity`, `zIndex`, `swapTo` | `render/partpose.py` and `editor/part-track.ts` | **this corpus** |

## Why a second corpus

The kernel corpus compares **vertices**. Compositing moves none — it decides
which layers are drawn, in what order, how strongly, and out of whose pixels.
So the two implementations can disagree about every compositing channel and the
kernel harness will report **0 ULP across all seventeen fixtures**, because that
is the honest answer to the question it asks.

They did disagree, on two counts at once, for months:

| channel | server said | browser said | symptom |
| --- | --- | --- | --- |
| `Part.opacity` | a static **gain**: multiply the resolved pose opacity by it | a **fallback** used only when no key mentions the channel | a part authored at 0.5 with a clip keying 0.5 exported at 0.25 and previewed at 0.5 |
| `PartPose.swapTo` | substitute the target's **whole posed part** | substitute the target's **pixels only** | a swapped mouth exported at the target's position, deformed by the target's rig; previewed in the referring part's slot, following the head |

Neither threw. Neither logged. Both produced a plausible frame. That is the
class of defect this corpus exists to make impossible.

## Running it

```bash
./scripts/test-anibuddy-compositing.sh
```

Or each half alone:

```bash
cd py_backend && python -m unittest tests.test_compositing_parity -v
cd frontend  && node --import tsx --test src/features/anibuddy/editor/__tests__/compositing-parity.test.ts
```

`cd frontend && pnpm test` also runs the TypeScript half, because it globs every
suite — so the kernel script covers it too, and a compositing divergence cannot
hide behind someone running only the older harness.

## The rule the corpus enforces

Stated canonically on `PartPose` in
`schemas/anibuddy/rig-document.v5.schema.json`. In short:

> **A compositing channel's REST value is the part's own authored field, and a
> key REPLACES it rather than scaling it.**

`Part.visible`, `Part.opacity` and `Part.zIndex` ARE the rest values of the pose
channels of the same name, in exactly the sense `0` is the rest value of `rot`.
Three consequences, each of which is a case below:

1. A clip that never mentions the channel composites the part exactly as
   authored.
2. A channel present in only **one** of the two bracketing keys blends against
   the part's authored value, not against a schema-wide constant — so a ghost
   drawn at 0.4 and keyed to 1 at the end of a clip ramps 0.4 → 1.
3. A resolved opacity is **never** multiplied by `Part.opacity`.

`swapTo` has no static counterpart, so its rest is "no swap", and it substitutes
pixels only: the referring part keeps its geometry, deformer, parent chain,
opacity and draw order, and the remap is the affine carrying its rect onto the
target's.

The rejected reading of `Part.opacity` — a static gain the pose modulates —
loses on two counts. It would make `opacity` the only channel in the schema
whose static field is a gain rather than a rest, breaking the symmetry with
`visible` and `zIndex`, which have never been anything else. And it makes a part
authored translucent *permanently* translucent: no keyframe can drive it to 1,
because every resolved value is scaled back down.

## Layout

- `cases/*.json` — hand-authored inputs: a list of parts reduced to what
  compositing reads (`id`, `visible`, `opacity`, `zIndex`, `rect`), optionally a
  clip, optionally the instants to sample. Every number was chosen for a reason
  stated in that file's `description`.
- `golden/*.json` — expected outputs, generated from the **Python** resolver by
  `python -m tools.gen_compositing_goldens` (run from `py_backend/`).

A golden carries, per sampled instant:

- `resolved` — one row per part in document order,
  `[partId, visible, opacity, zIndex, swapTo]`, **including parts that do not
  draw**. Emitted separately from the draw list because a part dropped from the
  composite and a part resolved wrong *then* dropped look identical there.
- `draw` — the layers that composite, back to front,
  `[partId, texturePartId, zIndex, opacity, order, sx, sy, ox, oy]`. `partId` is
  whose geometry draws and `texturePartId` whose pixels are sampled; they differ
  only under a `swapTo`.

Plus `warnings`, deduplicated in first-seen order exactly as `RenderReport.warn`
does — without the dedupe an unresolvable `swapTo` would appear once per sampled
instant and the golden would encode the sampling rate rather than the defect.

Every float is rounded to float32 and written with Python's shortest
round-tripping repr, so `JSON.parse` in Node recovers the identical value.

## The asymmetry, and its sharp edge

Python generates the goldens. That makes the **Python** test a *regression*
check and the **TypeScript** test the *parity* check — the same split, and the
same sharp edge, as the kernel corpus: regenerating the goldens makes a
Python-side regression disappear. Never run the generator to make a test pass.

Because the goldens come from one implementation, both test files also carry
hand-derived analytic assertions written against the schema's rule rather than
against either implementation's behaviour — a key of 0.5 on a part authored at
0.5 resolves 0.5; a translucent part keyed to 1 reaches 1; a one-sided key
halfway between 0.4 and 1 is 0.7.

## Tolerance

Opacity and the remap are compared in **float32 ULP with the same budget of 4**
the kernel harness uses. Consistency rather than necessity: nothing here reaches
libm, so these are pure IEEE arithmetic and land bit-identically today. Holding
them to the budget anyway means a future channel that *does* reach a
transcendental is already covered.

Part identity, `visible`, `zIndex`, `swapTo`, the draw list's membership and its
order are compared **exactly**. None of them is a measurement, so no rounding
could make them differ legitimately.

## Coverage

| case | what it pins down |
| --- | --- |
| `01-rest-is-the-resolved-state` | no clip at all: the authored values ARE the resolved values, and a z-index tie is broken by document order rather than by part id |
| `02-opacity-key-replaces-rest` | the divergence itself — three parts at 0.5 keyed to 0.5, 1.0 and 0.25; the multiply reading gives 0.25, 0.5 and 0.125 |
| `03-opacity-one-sided-key-blends-against-the-part` | a key on one side only ramps from `Part.opacity`, in both directions |
| `04-visible-steps-both-directions` | `visible` steps, its rest is `Part.visible`, and a part authored hidden can be revealed by a key |
| `05-zindex-steps-and-reorders-the-frame` | a limb crossing in front mid-clip: the draw list order changes, and the step is instant rather than blended |
| `06-swap-remaps-pixels-not-geometry` | the second divergence — the draw entry keeps the referring part and carries a non-identity remap on both axes; the target is still drawn as itself |
| `07-unresolvable-swap-warns-and-draws-itself` | the warning branch, compared as a string, and the dedupe |
| `08-loop-wrap-closes-onto-key-zero` | sampling past the last key of a looping clip: opacity blends toward key 0, stepped channels stay on the last key |
| `09-easing-drives-opacity-the-same-way` | all three easings on one ramp, including an absent `ease` that must be smoothstep |
| `10-cut-layers-leave-the-draw-list` | the visibility and opacity cuts, at the boundary, and that `opacity` cannot revive a part authored invisible |
| `11-degenerate-rect-falls-back-to-unit-scale` | a zero-width and a zero-height source rect in a swap, one per axis |
| `12-every-channel-on-one-part` | all four channels keyed on one part across three easings — the cross-channel desync case, which every single-channel case above would miss |

The Python test additionally asserts the corpus keeps covering each of those
branches: some case must resolve a swap, some must remap on each axis, some must
warn, some must drop a layer by each cut, some must reorder mid-clip, some must
tie on z-index, and the corpus as a whole must exercise all three easings
(including an absent one) and a loop. A corpus that stops exercising a branch
cannot protect it, and nothing else in the build would notice.

## What this harness does NOT catch

It compares resolved **state**, not pixels. Both targets could agree perfectly
here and still differ in how they composite that state — the server does
premultiplied source-over into a float32 canvas with a per-pixel triangle label
map, the browser does GPU blending — and that difference is deliberate (R4:
vertex math is shared, rasterization is not). What this corpus guarantees is
that when they draw differently, it is because they rasterize differently, not
because they disagreed about what to draw.

It also does not cover the *geometry* channels of a `PartPose`; those are the
kernel corpus's job, and the two are separate on purpose. The one place they
meet is asserted in both test files: a part's opacity and a joint's rotation,
sampled from the same clip at the same instant, must land on the same pair of
keys, because both go through `PoseTrack.bracket_index`.
