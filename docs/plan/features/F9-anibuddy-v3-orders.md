# F9 AniBuddy v3 — ordered implementation plan

Companion to `F9-anibuddy-v3.md` (the spec / the *what*). This file is the
*order of work*: ten work orders, each self-contained, each with its own
verification gate. Run them in numeric order. Do not start an order until the
previous one's gate is green.

Spec is authoritative on behaviour. This file is authoritative on sequence,
file paths, exact signatures, and what must not break along the way.

---

## How to run an order

Each order below is written to be handed over as a single unit of work.

1. Read `docs/plan/features/F9-anibuddy-v3.md` §for the order's subject.
2. Read every file listed under **Files** before editing any of them.
3. Implement exactly the order's scope. Nothing from a later order.
4. Run the order's **Verify** block. It must pass before the order is done.

```
cd frontend && npx tsc --noEmit && npm run lint
```

is the gate for every order. `npm run build` runs at Order 10 only (it is slow,
and nothing before Order 10 changes the route manifest in a way `tsc` misses).

There is no test runner in this repo — `frontend/package.json` has `dev`,
`build`, `start`, `lint` and nothing else. Do not add one as part of this work.
Verification is the type/lint gate plus the scripted manual passes in §Manual
passes at the bottom.

---

## Rules that apply to every order

**R1 — the gate stays green between orders.** No order may leave
`npx tsc --noEmit` failing "until a later order fixes it". This is why Order 1
is additive (see its **Compatibility rule**) rather than a clean-slate rewrite.

**R2 — non-generative invariant (F9 §2).** AniBuddy may only ever call text /
vision *reasoning* models. No AniBuddy route may call an image model or
`/api/studio/generate`. Every exported pixel must remain a resampled pixel of
the user's own artwork. If an order tempts you toward image generation, the
order is being misread.

**R3 — image input is inline only.** `rig-analysis/route.ts:135` guards with
`if (typeof image !== 'string' || !image.startsWith('data:image/')) → 400`.
That guard is an SSRF control, not a convenience check. It survives the rewrite,
and the new `animate` route gets the identical guard.

**R4 — the seven riggability requirements are not negotiable.** The
`REQUIREMENTS` array at `prompt/route.ts:21` is what makes generated art
riggable. It is copied verbatim into the v3 route and the interview may not
drop, soften, or reword any of the seven entries.

**R5 — no drive-by refactors.** Touch only files the order names. Keep the
surrounding comment density and naming style; this codebase documents *why*, not
*what*, and new code should match.

**R6 — preserve load-bearing code verbatim where an order says "verbatim".**
Specifically: the LBS `skin()` loop, the per-triangle affine warp, `SEAM_BLEED`,
the closed-form 2×2 singular-value stretch metering, `normalizeRows`, and the
manifest `preparedHash` mismatch refusal. These were derived carefully and
re-deriving them is how silent visual bugs get introduced.

**R7 — refuse rather than repair.** When a model response fails structural
validation, reject the whole response and refund. A partially-repaired joint
graph is worse than a clean refusal: it produces a rig that looks plausible and
animates wrongly.

---

## Dependency graph

```
1 ──┬─ 2 ─────────────┐
    ├─ 3 ── 4 ── 5 ───┤
    └─────────────────┤
                      ├─ 6 (needs 3,4)
                      ├─ 7 (needs 1,2,5)
                      ├─ 8 (needs 5)
                      └─ 9 (needs 1–7) ── 10
```

2, 3 are independent of each other once 1 lands. 6, 7, 8 are independent of
each other once their deps land.

---

# Order 1 — Types v3 + clip engine

**Depends on:** nothing. **Blocks:** everything.

### Files
- `frontend/src/features/anibuddy/types.ts` (extend)
- `frontend/src/features/anibuddy/lib/clip.ts` (new)

### Compatibility rule — read this first

This order is **additive**. A hard v3 rewrite of `types.ts` breaks every
consumer at once, and the gate could not be green again until Order 10 — which
would blind the per-order check for nine orders.

So in this order:

- **Add** `JointRole`, `Joint.role`, `CutLine`, `Rig.cuts`, `JointPose`, `Pose`,
  `Keyframe`, `Clip`, `QaTurn`, `AniBuddyProject.clips`,
  `AniBuddyProject.activeClipId`, `concept.transcript`.
- **Keep, marked `/** @deprecated removed in Order 9/10 */`**: `MotionId`,
  `RigAnalysis`, `Rig.bodyPlan`, `Rig.supported`, `AniBuddyProject.motion`.
- `PROJECT_SCHEMA_VERSION` stays `2` in this order. It moves to `3` in Order 9,
  together with the storage key and the manifest refusal, so the version bump
  and the format change land in the same commit.
- Patch construction sites *mechanically only* — wherever a `Joint`, `Rig`, or
  project literal now fails to typecheck because `role`, `cuts`, `clips`,
  `activeClipId`, or `transcript` is required. Give `role: "other"`,
  `cuts: []`, `clips: []`, `activeClipId: null`, `transcript: []`. Do not
  redesign anything in those files; their real rewrites are later orders.

Sites that will need the mechanical patch: `lib/skeleton.ts` (`defaultJoints`,
`buildRig`), `types.ts` `createEmptyProject`, and any `Joint` literal in
`api/enhance/anibuddy/rig-analysis/route.ts`.

### Types to add

```ts
/** What a joint IS, so motion generation and mesh density can reason about it
 *  without knowing anatomy. Closed set — the model picks, never invents. */
export type JointRole =
  | "root" | "spine" | "head" | "eye" | "jaw"
  | "limbUpper" | "limbLower" | "limbTip"
  | "tail" | "wing" | "ear" | "prop" | "other";

export const JOINT_ROLES: JointRole[] = [/* the 13 above, same order */];

export interface Joint {
  id: string;            // [A-Za-z0-9_-]{1,24}
  name: string;
  role: JointRole;       // NEW
  x: number;             // 0..1 of prepared width
  y: number;             // 0..1 of prepared height
  parent: string | null; // exactly one root across the rig
}

/** A user-drawn separation. Triangulation will not cross it and bone distance
 *  is Infinity across it, so the arm stops welding to the torso. */
export interface CutLine {
  id: string;
  points: [number, number][]; // normalized polyline, >= 2 points
}

/** One joint's local delta at a keyframe. Every field optional; absent means
 *  "unchanged from rest". */
export interface JointPose {
  rot?: number;    // degrees, local, + = clockwise on screen
  tx?: number;     // translation as a fraction of figure height
  ty?: number;
  scale?: number;  // uniform, about the joint
}

export type Pose = Record<string, JointPose>;

export interface Keyframe {
  t: number;                            // 0..1 normalized clip time
  joints: Pose;
  ease?: "linear" | "ease" | "hold";    // outgoing. Default "ease"
}

export interface Clip {
  id: string;
  name: string;      // "tail wag + crouch"
  request: string;   // what the user typed; kept for regeneration
  loop: boolean;
  keyframes: Keyframe[];  // sorted by t, keyframes[0].t === 0
  source: "model" | "edited";
}

export interface QaTurn { question: string; answer: string }
```

`Rig` gains `cuts: CutLine[]`. `AniBuddyProject` gains `clips: Clip[]` and
`activeClipId: string | null`; `concept` gains `transcript: QaTurn[]`.

`frameCount` and `fps` stay where they are — they are a clip's sampling rate,
not its content.

### Validation limits (constants, exported)

```ts
export const MAX_JOINTS = 48;
export const MIN_JOINTS = 3;
export const MAX_JOINT_DEPTH = 8;
export const MAX_KEYFRAMES = 12;
export const JOINT_ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
```

### `rigInvalidReason` — extend, do not replace

The existing checks in `types.ts:206` stay and become **load-bearing** rather
than belt-and-braces, because Order 4 removes `hardenJoints`'s forcing of the
canonical tree. Keep every one of them: single root, parent-exists, finite
coords, in-range coords, the hop-capped cycle walk at `types.ts:232`, non-empty
mesh, `weights.length === vertCount * boneCount`, per-row normalization.

Add, in this order, before the mesh checks:

- `joints.length > MAX_JOINTS` → `"This rig has too many joints (max 48)."`
- duplicate id → `` `Two joints share the id "${id}".` ``
- `!JOINT_ID_PATTERN.test(id)` → `` `Joint id "${id}" is not a valid name.` ``
- depth from root > `MAX_JOINT_DEPTH` → `"The joint tree is nested too deeply."`

Keep the existing `joints.length < 3` message unchanged.

### `lib/clip.ts` — new file, exact API

```ts
/** Resolve a clip to the pose at normalized time t (0..1). */
export function poseAt(clip: Clip, t: number): Pose;

/** Sample a clip into N poses, one per frame. Wraps when clip.loop. */
export function sampleClip(clip: Clip, frameCount: number): Pose[];

/** Insert or replace the key at t from a full pose. Used by autokey. */
export function upsertKeyframe(clip: Clip, t: number, pose: Pose): Clip;

export function removeKeyframe(clip: Clip, t: number): Clip;
export function moveKeyframe(clip: Clip, from: number, to: number): Clip;

/** Generic 4-key breathing loop, keyed by ROLE not by joint id. */
export const MOCK_CLIP: Clip;

/** Rewrite MOCK_CLIP's role keys onto whatever joints this rig actually has. */
export function retargetMockClip(joints: Joint[]): Clip;
```

Behaviour notes:

- **Interpolation is per-joint, per-channel.** Find the bracketing keys for `t`;
  blend each of `rot`/`tx`/`ty`/`scale` independently. A channel absent from
  *both* bracketing keys is absent from the result (meaning rest). A channel
  present in only one side blends against its rest value — `0` for
  `rot`/`tx`/`ty`, `1` for `scale`. This is what makes sparse keys work: a
  keyframe that only mentions the tail must not snap every other joint.
- `ease` is read from the **outgoing** (earlier) key. `"ease"` → smoothstep
  `u*u*(3-2*u)`, `"linear"` → `u`, `"hold"` → `0`. Default `"ease"`.
- `sampleClip(clip, n)` samples at `t = i / n` when `clip.loop` (so frame n-1
  flows back into frame 0 — the same reason `motion.ts:158` divides by `count`
  rather than `count - 1`), and at `t = i / (n - 1)` when it does not loop.
  Clamp `n` to `[2, MAX_FRAMES]`.
- Past the last key on a looping clip, interpolate back toward
  `keyframes[0]`. On a non-looping clip, hold the last key.
- `upsertKeyframe` matches an existing key when `|t - key.t| < 1e-4`, replaces
  its `joints` wholesale, otherwise inserts and re-sorts. It always returns a
  new `Clip` with `source: "edited"`. Never mutate the input.
- `moveKeyframe` refuses (returns the clip unchanged) when the destination
  would collide with another key or leave `keyframes[0].t !== 0`.
- `MOCK_CLIP` exists because Order 5 deletes the four presets, which removes the
  zero-credit path — without it `OPENROUTER_MOCK=1` lands on a dead timeline.
  Model it on how `rig-analysis/route.ts:48` already ships `MOCK_ANALYSIS`.
  4 keys at `t = 0, 0.25, 0.5, 0.75`, `loop: true`, small `ty` on the root and
  small counter-`rot` on `spine`/`head`, `scale` dip on `eye` roles.
  `retargetMockClip` maps each role key onto the first joint carrying that role
  and drops role keys the rig has no joint for.

### Do not, in this order

- Do not delete `MotionId`, `motion.ts`, `Rig.supported`, or `Rig.bodyPlan`.
- Do not change `PROJECT_SCHEMA_VERSION` or `STORAGE_KEY`.
- Do not touch `deform.ts`, `mesh.ts`, any route, or any component beyond the
  mechanical literal patches described above.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Both clean. The app still builds and behaves exactly as before this order —
nothing in the new types is wired up yet, by design.

---

# Order 2 — Generic deformation

**Depends on:** 1. **Blocks:** 7.

### Files
- `frontend/src/features/anibuddy/lib/deform.ts`

### Goal

Delete the hardcoded-anatomy switch so an arbitrary creature can move. The
current `localDelta` at `deform.ts:73` is a `switch` on literal joint ids
(`"torso"`, `"neck"`, `"elbowA"`, `"handA"`, `"kneeB"`, `"footB"`, …) with
`default: return 0`. A tail joint or a wing joint hits `default`, so it cannot
move at all. That single function — not the mesh — is what makes non-biped
creatures impossible today.

### Do

1. **Delete `localDelta` entirely**, and delete its doc comment about the
   `projDown → 90 - a` / `projUp → a - 90` sign conversions and A-side
   mirroring. Those conversions existed only to translate the studio's
   mannequin table conventions into local rotations. There is no table any more:
   a `JointPose.rot` is already a local rotation in degrees, clockwise positive
   on screen, and is applied directly.
2. **Delete `applyEyelids`** (`deform.ts:230–254`). Its job is now `scale` on a
   joint whose role is `eye`, driven by keyframes — more general, no special
   case, and it falls out of the FK walk for free.
3. **Change the render signature** from
   `render(ctx, pose: AniFrame, reference: AniFrame, options)` to
   `render(ctx, pose: Pose, options)`. There is no reference pose in v3; the
   artwork's drawn pose *is* the rest pose, and a `JointPose` is already a delta
   from it.
4. **`solve(pose: Pose)`** walks the joint tree from the root, breadth-first,
   exactly as the current `solve` does. For each joint the world transform is
   `parentWorld · restLocal · delta`, where `delta` is that joint's `JointPose`:
   rotate `rot` degrees about the joint, translate `(tx, ty)` scaled by figure
   height, uniform `scale` about the joint. A joint with no entry in the pose
   gets the identity delta. Rest state (`restAngle`, `restLength`, `restPos`)
   is computed once from the joint positions exactly as today — that code is
   already topology-agnostic and needs no change.
5. **Drop the `AniFrame` import** from `lib/motion.ts`. After this order
   `deform.ts` must not import from `lib/motion.ts` at all.

### Keep verbatim (R6)

- `skin()` — `v' = Σ_j w_j · (P_j · B_j⁻¹) · v`. It already loops over generic
  bones and weight columns; it is topology-independent and correct.
- The per-triangle affine warp: `A = D · S⁻¹`, applied in canvas order
  `[a c; b d]`. Getting this transposed is a class of bug that looks like
  "the art shears slightly" and is very hard to spot.
- `SEAM_BLEED = 0.5` centroid push, `MIN_TRIANGLE_AREA = 1e-4`,
  `STRETCH_WARNING = 2.5`.
- The closed-form 2×2 singular values:

```ts
const sum = Math.hypot((a + d) / 2, (b - c) / 2);
const difference = Math.hypot((a - d) / 2, (b + c) / 2);
const sigmaMax = sum + difference;
const sigmaMin = Math.abs(sum - difference);
const stretch = sigmaMin > 1e-6 ? sigmaMax / sigmaMin : Infinity;
```

`FrameStats` and the `showDistortion` overlay keep working unchanged — they
measure the warp, and the warp is untouched.

### Callers

`export.ts:86` and `AnimateStep.tsx:101` both call the old three-arg `render`.
Order 2 does **not** rewrite them (those are Orders 9 and 7). To keep R1, adapt
them minimally: build a `Pose` from the sampled `AniFrame` at the call site, or
— simpler and preferred — have Orders 2's callers pass `{}` and note the
`TODO(order-7)` / `TODO(order-9)` in a one-line comment. The preview will render
the rest pose only until Order 7 lands. That is expected and must be stated in
the order's completion note, not hidden.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual smoke: `npm run dev`, `/anibuddy`, rig any image, open Animate. The
character renders undeformed (rest pose) without console errors. Confirm the
mesh overlay and stretch overlay still draw.

---

# Order 3 — Contour mesh + cut-aware weights

**Depends on:** 1. **Blocks:** 4, 6.

### Files
- `frontend/package.json` — add `cdt2d`
- `frontend/types/cdt2d.d.ts` (new — the package ships no types)
- `frontend/src/features/anibuddy/lib/contour.ts` (new)
- `frontend/src/features/anibuddy/lib/mesh.ts` (rewrite `buildMesh`,
  `buildWeights`)

### Why

`buildMesh` today builds a uniform 20-column alpha-clipped lattice. It is not
literally static — it fits each image — but it has no part awareness, so an arm
drawn against the torso shares vertices with it, welds to it, and tears when it
rotates.

The fix has two halves and **both are required**:

1. Triangulate along the artwork's real contour, with user cut lines as
   constrained edges.
2. Make bone distance `Infinity` across a cut line in `buildWeights`.

Half 1 alone does not work. Triangulating around a cut still lets the torso bone
dominate the arm's vertices by Euclidean distance, and the arm still drags.

### `lib/contour.ts` — new

```ts
/** Marching-squares trace of the alpha channel at ALPHA_FLOOR. Returns one
 *  outer ring per connected component, plus hole rings (wound opposite). */
export function traceContours(alpha: Uint8Array, w: number, h: number): number[][][];

/** Ramer–Douglas–Peucker. epsilon in pixels. */
export function simplify(ring: number[][], epsilon: number): number[][];

/** Chamfer distance transform: for each pixel, distance to nearest background. */
export function distanceTransform(alpha: Uint8Array, w: number, h: number): Float32Array;

/** Interior sample points whose local spacing follows the distance transform. */
export function samplePoints(
  rings: number[][][],
  dist: Float32Array,
  w: number, h: number,
  spacing: number,
): number[][];
```

`ALPHA_FLOOR` stays `24` — `prepare.ts`, `rigCore`, and `mesh.ts` all agree on
that threshold and disagreeing would put mesh vertices outside the pixels the
prepare step considers solid.

### `buildMesh(alpha, width, height, cuts)` — rewrite

New fourth parameter `cuts: CutLine[]`.

1. **Trace** contours at `ALPHA_FLOOR`.
2. **Simplify** each ring with RDP at ~0.4% of `max(width, height)`. Keeps
   silhouette shape, kills per-pixel staircase noise.
3. **Interior points, adaptive.** Poisson-ish sampling inside the rings, local
   spacing driven by the distance transform: fine where the shape is thin (a
   tail, a finger), coarse in large solid regions. Bias finer within ~1
   bone-length of any joint — that is where bending happens.
4. **Constraints.** Contour edges plus every `CutLine` segment become
   constrained edges. Call
   `cdt2d(points, edges, { exterior: false, interior: true })`.
5. **Post-check.** Drop triangles with `|area| < MIN_TRIANGLE_AREA`. Cap total
   verts at `MAX_VERTS` (1200) by **raising the sampling spacing and re-running**
   — never by truncating the vertex array, which would orphan triangle indices.
6. Emit the same `Mesh` shape as today: `verts` flat `[x,y,...]` normalized 0..1,
   `tris` flat `[i0,i1,i2,...]` `Uint32Array`.

`snapToSilhouette` is no longer needed — contour vertices are on the silhouette
by construction. Delete it, and delete `COLS`.

### `buildWeights(mesh, joints, cuts)` — two changes

Keep the shape of it: inverse distance `1 / (d^FALLOFF + ε)` with `FALLOFF = 4`,
prune to top-K, normalize, one Laplacian smoothing pass over `buildNeighbours`.

1. **Cut-aware distance.** A vertex's distance to a bone is `Infinity` when the
   straight segment from vertex to the bone's nearest point crosses any
   `CutLine` segment. Standard segment-segment intersection. This is the
   mechanism that makes cuts do anything.
2. **`TOP_K` 3 → 4.** Free-form rigs can legitimately have more overlapping
   influences than a biped.

Edge case that must be handled explicitly: a vertex cut off from **every** bone
gets all-`Infinity` distances and would produce a NaN row. Fall back to the
single nearest bone ignoring cuts, and push a rig warning naming the count of
such vertices. A NaN weight row propagates to `NaN` vertex positions and the
character vanishes with no error.

`normalizeRows(weights, boneCount, rows)` is **unchanged** and still exported —
`RigCanvas.paintAt` depends on it.

### `types/cdt2d.d.ts`

```ts
declare module "cdt2d" {
  export default function cdt2d(
    points: number[][],
    edges?: number[][],
    options?: { delaunay?: boolean; interior?: boolean; exterior?: boolean; infinity?: boolean },
  ): number[][];
}
```

Confirm `tsconfig.json` picks up `frontend/types/` (via `include` or
`typeRoots`); add it if it does not.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual: `npm run dev`, rig an image, toggle **Show mesh**. Triangles follow the
silhouette instead of forming a grid, and are visibly denser at thin parts
(fingers, tail, ears) than in the middle of a torso. Triangle count stays under
`MAX_VERTS`-implied bounds — the count is printed at `RigStep.tsx:257`.

Cuts have no UI yet (that is Order 6). Verify the cut path by passing a
hardcoded `cuts` array in a scratch call, or defer the cut verification to
Order 6 and say so.

---

# Order 4 — Graph validation replaces the biped lock

**Depends on:** 3. **Blocks:** 5.

### Files
- `frontend/src/features/anibuddy/lib/skeleton.ts` (shrink)

### Goal

Today `skeleton.ts` is the biped lock. `PARENTS` at line 64 hardcodes a 16-joint
tree, and `hardenJoints` **forces** every incoming joint onto it: unknown ids
are dropped, missing joints are filled from `defaultJoints`, parentage is
clamped to the canonical tree — which makes cycles and orphans structurally
impossible rather than merely detected.

v3 rigs are free-form. The model can propose any acyclic tree. The safety that
`hardenJoints` provided moves into `rigInvalidReason` (extended in Order 1) and
into a small new validator here. `skeleton.ts` shrinks to two things:

### Keep

- `JOINT_LABELS` (16 entries) — still used as display names by the rig editor
  when a model joint arrives without one. Mark `@deprecated`-ish: it becomes a
  *fallback dictionary*, not a whitelist.
- `alphaBox` — used by `applyLocalSupport` and by the mesh builder in
  Order 3 for per-joint density bias.
- `buildRig(analysis, prepared, alpha, fallbackBodyPlan)` — its shape. See below.
- `rebindWeights(rig)` and `applyLocalSupport(rig, alpha, prepared)` — unchanged
  in behaviour. (Rebind is a one-liner today; keep it wherever it is.)

### Change

1. **Delete `PARENTS`, `EXPECTED_JOINT_IDS`, `defaultJoints`, and the
   forcing loop inside `hardenJoints`.** Replace with `sanitizeJointGraph`:

```ts
/** Validate a model-proposed joint graph. Throws JointGraphError on any
 *  structural violation — R7, refuse rather than repair. */
export class JointGraphError extends Error {}

export function sanitizeJointGraph(
  proposed: Array<{ id: string; name?: string; role?: JointRole; x: number; y: number; parent: string | null }>,
  bounds: SubjectBounds,
  width: number,
  height: number,
): Joint[];
```

Checks, in order (each throws with a message naming the joint):

- `< MIN_JOINTS` joints total (keep the old `joints.length < 3` behaviour as
  part of this).
- id fails `JOINT_ID_PATTERN`, or duplicates another id.
- role not in `JOINT_ROLES` → fall back to `"other"` (the model's word choices
  drift; positions are load-bearing, labels are not).
- `parent` references a missing id.
- more than one root, or no root.
- depth from root exceeds `MAX_JOINT_DEPTH` (walk, cycle-safe: stop after
  `joints.length` hops).
- any coordinate non-finite or outside `[0,1]`.

After validation passes, clamp coordinates to the bounds rectangle *within*
`[0,1]` exactly as today — that is a defensible repair (a joint 0.5px outside
still belongs to the pixel it overlaps), everything above is a refusal.

2. **`buildRig`** keeps its signature and keeps intersecting the model-claimed
   `supported` list with `applyLocalSupport`. The `fallbackBodyPlan = "biped"`
   default and the `Rig.bodyPlan` field are `@deprecated` until Order 10 deletes
   them; keep passing them through so nothing else changes. `Rig.source` still
   flips to `"edited"` on any user edit.

3. **`applyLocalSupport`'s `alphaBox` call stays.** The hardcoded probe geometry
   around `head`/`armA` that gates `wave`/`blink` is deprecated but harmless;
   Order 10 deletes it together with `supported`. Do not spend time reworking
   it now.

### What loses its guard — say it in the completion note

With `hardenJoints` gone, `rigInvalidReason`'s extended checks from Order 1 are
the only thing between a bad graph and a silent broken render. They were already
all present and enforced by the step lock; now they are the *only* enforcement.
Confirm at the gate that every check in `types.ts:206` still fires.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual: `npm run dev`, rig an image with a **non-biped** result (any of the
`BODY_PLANS` mock produces, or a `biped` one). The rig builds and animates
instead of being clamped back to the canonical tree. There are no code paths
left that mention `PARENTS` or `EXPECTED_JOINT_IDS` — grep for both.

---

# Order 5 — API routes: analysis, animation, interview

**Depends on:** 4. **Blocks:** 6, 7, 8.

### Files
- `frontend/src/app/api/enhance/anibuddy/rig-analysis/route.ts` (rewrite)
- `frontend/src/app/api/enhance/anibuddy/animate/route.ts` (new)
- `frontend/src/app/api/enhance/anibuddy/prompt/route.ts` (rewrite)
- `frontend/src/features/anibuddy/api/anibuddyClient.ts` (add `requestAnimation`,
  `requestPromptTurn`)

### 5a — `rig-analysis/route.ts` rewrite

The v1 route returns a 16-joint whitelisted biped. v3 returns a **free-form
joint graph**: any count (3–`MAX_JOINTS`), any roles, any tree.

Response type (client-side, in `types.ts`, replacing `RigAnalysis`'s joints
shape while the deprecated name lives on):

```ts
export interface RigAnalysisV3 {
  joints: Array<{
    id: string; name: string; role: JointRole;
    x: number; y: number; parent: string | null;
  }>;
  warnings: string[];
  // @deprecated — kept for Order 4's intersection until Order 10
  bodyPlan: BodyPlanId;
  supported: MotionId[];
}
```

Keep, unchanged:

- `maxDuration = 120`, the refund paths at the old lines 207/221, the 502
  refusal when the graph fails, `temperature: 0.2`, `maxTokens: 1200`,
  `DEFAULT_MODEL = OPENROUTER_FALLBACK_MODEL`.
- **The SSRF guard (R3).** `if (typeof image !== 'string' || !image.startsWith('data:image/'))` → 400.
- `extractText`, `parseAnalysis`, the fence-strip and outermost-`{}` slicing.

Prompt the model for: all visible joints, each with a `role` from `JOINT_ROLES`
(the 13, spelled out in the prompt), a position (normalized), a parent, plus the
three v1 extras the downstream code still consumes — `bodyPlan` from the five
`BODY_PLANS`, `supported` from `MOTIONS`, and `warnings`. Tell the model the
joint count may be anything from 3 to 48 and to add a joint for anything that
moves: ears, tail, wings, fins, tentacle segments, props. Give it the
one-root rule, and tell it to place at least one `limbTip`/`eye` where present
so the local support checks have something to intersect.

The mock (`MOCK_ANALYSIS`) is **kept and expanded**: it must still be a full
free-form graph now. Give the mock a tail joint and an ear joint so the
non-biped path is exercisable offline — the tail is exactly the case that v1
could never represent.

`sanitizeJoints` (whitelist filter + clamp) is replaced by the Order 4
`sanitizeJointGraph` call; the route catches `JointGraphError` and refunds then
502s with the error's message.

### 5b — `animate/route.ts` (new)

Single vision call. One request, one response — no plan-then-animate two-pass
(that was considered and rejected in planning; the user chose single-call).

- `POST /api/enhance/anibuddy/animate`
- Request body:

```ts
{
  image: string;      // inline data:image/* — R3, same guard as rig-analysis
  rig: Rig;           // client serialized, mesh + weights included
  request: string;    // the user's motion request, e.g. "hop three times"
}
```

- Response body:

```ts
{
  clip: Clip;         // keyframes at t = 0..1, source: "model"
  warnings: string[];
}
```

- Same `maxDuration = 120`, refund-on-failure, `temperature: 0.2`,
  `maxTokens: 2400` (a full keyframe list is the biggest single response
  AniBuddy asks for).
- System prompt contains: the rig's joint tree with ids and roles; the artwork
  as a vision image; the request. Ask for keyframes only — no prose. Keyframe
  values must be small (say: rotations < 30°, translations < 8% of figure
  height) and every joint the motion involves should appear in at least one
  keyframe. Require `keyframes[0].t === 0` and strictly increasing `t`.
- Validation on the response (reject + refund on any failure, R7):
  - parses; every `t` in `[0,1]`, strictly increasing, first is `0`.
  - only joints present in the rig appear in any pose; unknown joint ids reject
    the whole response.
  - keyframe count ≤ `MAX_KEYFRAMES`.
  - `rot`/`tx`/`ty`/`scale` finite; `scale` in `[0.2, 5]`.
  - if the response cannot be salvaged **as a whole**, 502. Never partially
    apply a clip.
- `request` length guard: `1..500` chars, else 400.

### 5c — `prompt/route.ts` rewrite: the interview

The v1 route is one-shot `{idea, view} → prompt`. v3 is a **model-driven
interview**: `ask` returns a question, `write` returns the finished prompt.
Both hit the same route.

- `POST /api/enhance/anibuddy/prompt` with body
  `{ action: "ask" | "write", idea: string, transcript: QaTurn[] }`.
- `ask` response:

```ts
{
  questions: Array<{
    id: string;
    question: string;
    options: string[];      // tappable chips; may be empty
    allowFree: boolean;     // show a free-text field alongside the chips
    multi: boolean;         // chips are multi-select
  }>;                       // 1–3 per round, chosen adaptively
  done: boolean;            // true = enough context, switch the UI to "write"
}
```

- `write` response: `{ prompt: string }`.
- **Cap rounds at 6 server-side.** `transcript.length >= 6` forces
  `done: true` regardless of what the model wants, so the interview cannot
  loop forever on a user's credit.
- Budget: `LLM_LONG_BUDGET_MS` (100s, `maxDuration = 120`) for both actions.
- The interview keeps working as the concept step's prompt builder: the seven
  `REQUIREMENTS` (R4) are copied **verbatim** into the `write` system prompt,
  and that prompt says they are hard constraints the generated prompt must
  encode. The interview is about *what the user wants* (subject, art style,
  palette, mood, level of detail, silhouette readability, reference points),
  not about *negotiating the requirements*.
- `view` handling: keep `VIEWS = { front: 'front-facing', 'three-quarter': 'three-quarter' }`
  and the v1 system-prompt clause that names the chosen view.
- Keep `cleanPrompt` (fence strip, `^(?:prompt|output)\s*[:\-]\s*`, surrounding
  quote strip), the refund when `prompt.length < 40`, `maxTokens: 400` for
  `write`. Use `temperature: 0.4` for `write` and `0.3` for `ask` (questions
  should stay on-track).
- Mock mode: `ask` returns a fixed 2-round script then `done: true`; `write`
  returns `MOCK_PROMPT`. Zero spend, and the interview UI is exercisable
  offline.

### 5d — client

`anibuddyClient.ts` gains:

```ts
export function requestAnimation(input: {
  image: string;
  rig: Rig;
  request: string;
}): Promise<{ clip: Clip; warnings: string[] }>;

export function requestPromptTurn(input: {
  mode: "ask" | "write";
  idea: string;
  transcript: QaTurn[];
}): Promise<{ question?: string; done?: boolean; prompt?: string }>;
```

`requestRigAnalysis` keeps its name and route; its `RigAnalysis` return type
becomes `RigAnalysisV3`.

`requestRigAnalysis` keeps its name and route; its `RigAnalysis` return type
becomes `RigAnalysisV3`.

### Verify (whole order)

```
cd frontend && npx tsc --noEmit && npm run lint
```

Greps that must come back clean (R2):

```
grep -rn "studio/generate" frontend/src/app/api/enhance/anibuddy/     # no hits
grep -rn "OPENQUOTA_VISION_MODEL\|image model" frontend/src/app/api/enhance/anibuddy/  # animate route only
```

Manual, `OPENROUTER_MOCK=1` (or the repo's mock switch — the routes all honour
`isMockMode`):

1. Rig a fresh image → joints come back free-form; a tail/ear mock exercise
   works offline.
2. Concept step: `ask` twice, get questions back, answer them, `done` flips,
   `write` returns a prompt containing at least two of the seven requirements
   in spirit (mock returns `MOCK_PROMPT` — check it against the REQUIREMENTS).
3. Animate: no UI yet, so call `requestAnimation` from a console/scratch
   context and confirm the returned `Clip` passes `poseAt`/`sampleClip`
   without throwing, and that unknown-joint ids in a forged response are
   rejected (unit-style check in the route's validation function).
4. A forged `image: "https://..."` to `rig-analysis` and `animate` returns
   400, not a fetch (R3).

---

# Order 6 — Rig editor: free-form tools

**Depends on:** 3, 4. **Blocks:** 9.

### Files
- `frontend/src/features/anibuddy/components/RigCanvas.tsx`
- `frontend/src/features/anibuddy/components/RigStep.tsx`
- `frontend/src/features/anibuddy/lib/skeleton.ts` (small addition)

### Goal

The rig editor becomes a real editor for an arbitrary graph: joints that can be
added, deleted, and reparented; a role picker; cut lines drawn with a pen tool;
the weight brush unchanged.

### `RigTool` grows a third member

```ts
export type RigTool = "joints" | "cuts" | "weights";
```

Joints tool keeps today's behaviour (drag to move, click to select). Cuts tool:
pointer down starts a polyline, each move appends a point, pointer up commits a
`CutLine` (id = `cut-<n>`, `points` normalized). A `Delete`/backspace or a
trash button on the selected cut removes it. Weights tool unchanged — `paintAt`
and `normalizeRows` still drive it, and its brush math is untouched (R6).

### New rig actions (dispatch into `useAniBuddyProject` via a new action; see Order 9 for the reducer)

Every action returns a new `Rig` with `source: "edited"` (and, where the mesh
or weights depend on the change, a rebuild — see below):

- `addJoint(x, y)` → id `j1, j2, …` (smallest unused), `name: "Joint n"`,
  `role: "other"`, `parent: <currently selected joint>` (null when none
  selected), clamped to `[0,1]`.
- `deleteJoint(id)` → removes the joint; its children are reparented to the
  deleted joint's parent. Never leaves the rig with zero roots.
- `reparent(id, parentId | null)` → `parentId` must not be `id` or one of `id`'s
  descendants (cycle guard — reuse the hop-capped walk). `null` allowed only
  when the rig currently has no other root.
- `setJointRole(id, role)`.
- `renameJoint(id, name)`.
- `addCut(points)`, `deleteCut(id)`.
- `moveJoint` (existing behaviour — the drag path through `rebind` stays).

**Rebuild rule.** The mesh is a function of the image alpha and the cuts, so
`addCut`/`deleteCut` rebuild the mesh and weights (Order 3's `buildMesh` +
`buildWeights`). Joint add/delete/reparent/move do **not** rebuild the mesh —
they rebuild weights only, via `rebindWeights`. Mesh rebuild is the expensive
step; never run it on every drag.

### Role picker

The selected joint's inspector gains a `<select>` bound to `JOINT_ROLES`
(13 options, from Order 1). Changing it dispatches `setJointRole`. The joint
colour on canvas follows the role: limbs vs head vs tail get distinct hues so
the user can see at a glance which part the model chose (and fix it when wrong).

### Bones list

The sidebar's `<select>` of bones (from `getBones`) gains the parent-changing
behaviour: picking a different parent for the child joint dispatches
`reparent`. Rename and delete are small buttons next to the entry.

### `skeleton.ts` addition

`roleColor(role: JointRole): string` — a small map used by both `RigCanvas`
and the role picker. Keep the swatch palette in one place.

### RigStep wiring

- `analyze()` continues to call `requestRigAnalysis`, then `buildRig`
  (Order 4's version — which now returns free-form graphs).
- `startManual()` passes an empty proposed graph, which Order 4's
  `sanitizeJointGraph` rejects below `MIN_JOINTS` — so manual mode must seed
  with a minimal 3-joint spine (`root` → `spine` → `head`, evenly spaced) or
  call `addJoint` on `null` selection twice. Pick the seed; it must never
  throw.
- Tool state is local to `RigStep` (a `useState<RigTool>`), not persisted.
  Persisted state only stores the data: joints, cuts, weights, mesh.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual, `OPENROUTER_MOCK=1`:

1. Rig → the free-form joints from Order 5 render and are grabbable.
2. Add a joint on the tail; it appears in the graph with role "other" and
   parent = previously selected joint.
3. Draw a cut between arm and torso; the mesh rebuilds along it, and toggling
   **Show mesh** shows triangles respecting the cut.
4. Reparent a limb tip under a new joint; export-step lock (`rigInvalidReason`)
   stays green and `getBones` reflects the new parent.
5. Delete a joint mid-tree; its children reparent to the grandparent; roots
   stay at exactly 1.
6. Cycle attempt: try to reparent a joint under its own child — refused, lock
   stays green.

---

# Order 7 — Timeline, request box, autokey

**Depends on:** 1, 2, 5. **Blocks:** 9.

### Files
- `frontend/src/features/anibuddy/components/AnimateStep.tsx` (rewrite)
- `frontend/src/features/anibuddy/components/Timeline.tsx` (new)
- `frontend/src/features/anibuddy/hooks/useAniBuddyProject.ts` (clip actions)
- `frontend/src/features/anibuddy/lib/deform.ts` (call-site, the Order 2 TODO
  is resolved here)

### Goal

The four motion cards are gone. Animate becomes: type a request → watch the
model's clip play → scrub a timeline → click a frame, drag a joint, autokey
writes the pose.

### Layout

- **Request box** (top): a text input "What should it do?" + Generate button.
  Dispatches `requestAnimation({ image: prepared.dataUrl, rig, request })`.
  While loading: spinner; the button is disabled; a cancel path is not needed
  (the 100s budget bounds it).
- **Clip list** (left): one row per `project.clips` — name, `source` badge
  ("model"/"edited"), play/pause, duplicate, rename, delete. Selecting a row
  sets `activeClipId`. A "New" button creates an empty clip from the current
  rig (a single key at `t=0`), so the user can also animate by hand with no
  request at all.
- **Canvas** (centre): the deformer preview, rAF loop, `interval = 1000 / fps`,
  the same `worst`/`folds` stretch accumulators, the stretch-overlay toggle,
  the `distorted` banner — all kept from v1. The pose for the current frame
  comes from `poseAt(activeClip, t)` (Order 1) instead of `getFramePoses`
  (which is deleted with `motion.ts` in Order 10).
- **Timeline** (bottom, new `Timeline.tsx`): N cells where `N = project.frameCount`.
  A cell at index `i` shows a diamond when a keyframe exists at `t = i / N`
  (clamped into the nearest cell). Click a cell → scrub to it and pause. Drag a
  diamond horizontally to `moveKeyframe` (Order 1). Right-click or a small ×
  removes the key (`removeKeyframe`). The current-time playhead renders as a
  vertical line.
- **Pose editing (autokey).** Paused at frame `i`, dragging any joint on the
  canvas solves that joint's local rotation from the drag delta exactly as v1
  did (`RigStep`'s drag math, moved into a shared helper), then writes
  `upsertKeyframe(activeClip, t = i / N, pose)` where `pose` is the pose
  *including all channels the user touched since the key was created* — the
  key accumulates the drag, it does not replace a previously authored
  unrelated channel. The clip becomes `source: "edited"` (upsertKeyframe
  already guarantees this).
- **Ease picker**: small per-key menu (or a clip-wide default) for
  `linear | ease | hold`, writing `Keyframe.ease`.

### Clip lifecycle (reducer actions, Order 9 wires them)

```ts
{ type: "setActiveClip"; id: string | null }
{ type: "upsertKeyframe"; clipId: string; t: number; pose: Pose }
{ type: "removeKeyframe"; clipId: string; t: number }
{ type: "moveKeyframe"; clipId: string; from: number; to: number }
{ type: "addClip"; clip: Clip }            // from requestAnimation result
{ type: "renameClip"; clipId: string; name: string }
{ type: "deleteClip"; clipId: string }
{ type: "toggleClipLoop"; clipId: string }
{ type: "setClipSource"; clipId: string; source: "model" | "edited" }
```

`deleteClip` keeps `activeClipId` pointing at a surviving clip (or null). The
cascade rules from `useAniBuddyProject` stay: `setSource` clears everything
including `clips`; `setPrepared` clears `rig` and `clips`.

### Preview pose plumbing (resolves the Order 2 TODO)

`deform.ts`'s `render(ctx, pose, options)` is the only call surface now. The
preview builds the `Pose` with `poseAt(activeClip, t)` — no `AniFrame` import
remains anywhere in the AniBuddy feature by the end of this order (check
`grep -rn "lib/motion" frontend/src/features/anibuddy/`; only the to-be-deleted
`motion.ts` itself may still match).

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual, `OPENROUTER_MOCK=1`:

1. Request "hop" → a clip appears (mock or model), plays on the canvas,
   loops.
2. Scrub to a frame, drag a joint → a diamond appears at that cell; the clip's
   badge flips to "edited"; the pose persists across a scrub away and back.
3. `moveKeyframe` drag and `removeKeyframe` work; deleting the only key leaves
   an empty clip that still renders rest pose.
4. The stretch overlay and distorted banner behave as in v1.

---

# Order 8 — Concept interview UI

**Depends on:** 5. **Blocks:** 9.

### Files
- `frontend/src/features/anibuddy/components/ConceptStep.tsx` (rewrite)
- `frontend/src/features/anibuddy/lib/clip.ts` (no change — types only, used by
  the transcript)

### Goal

The one-shot `{idea, view} → prompt` box becomes the interview transcript from
Order 5c.

### Behaviour

1. Textarea for the seed idea (kept from v1) + "Start interview" button.
2. Each round: POST `ask` with `{ action: "ask", idea, transcript }`. Render
   each returned question with its chip options (tappable) and its free-text
   field (when `allowFree`). Multi-select chips collect into the answer on
   "Next".
3. Append `{ question, answer }` to `project.concept.transcript` (Order 1's
   `QaTurn`), POST `write` when `done` or when the user hits "Write my prompt"
   early.
4. The transcript renders as a conversation above the composer — the user sees
   the whole interview history, and can re-answer a question by tapping back.
   Re-answering truncates the transcript at that turn (later turns are
   meaningless once an earlier answer changes).
5. "Skip — I already have art" is kept from v1.
6. When `transcript.length >= 6` the server force-ends the interview; the UI
   just shows the Write button lit up.
7. The result lands in `project.concept.prompt` exactly as v1 — everything
   downstream (copy-to-clipboard flash, `isStepDone("concept")` in
   `StepRail.tsx:29`) is untouched.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual, `OPENROUTER_MOCK=1`:

1. Idea → two rounds of questions with chips → done → prompt appears; copy
   button flashes.
2. Back-navigation truncates the transcript; "Write" from round 1 still
   produces a prompt.
3. `StepRail` shows concept complete once `prompt !== null`.

---

# Order 9 — Persistence v3 + export wiring

**Depends on:** 1–7 (everything except 10). **Blocks:** 10.

### Files
- `frontend/src/features/anibuddy/hooks/useAniBuddyProject.ts`
- `frontend/src/features/anibuddy/types.ts` (schema bump)
- `frontend/src/features/anibuddy/lib/project-io.ts` (`SerializedProject` +
  `deserializeProject` learn `clips`/`activeClipId`/`transcript`)
- `frontend/src/features/anibuddy/lib/manifest.ts` (version refusal text)
- `frontend/src/features/anibuddy/lib/export.ts` (pose-driven render)
- `frontend/src/features/anibuddy/components/ExportStep.tsx`
- `frontend/src/features/anibuddy/components/AniBuddyWorkspace.tsx`
- `frontend/src/features/anibuddy/components/StepRail.tsx`

`lib/motion.ts` is **not** deleted in this order — it goes in Order 10, after
its last caller is gone.

### Changes

1. **`PROJECT_SCHEMA_VERSION` 2 → 3** and `STORAGE_KEY` `"anibuddy:project:v2"`
   → `"anibuddy:project:v3"` in the same commit (R1). `deserializeProject`
   learns to read `clips`, `activeClipId`, `concept.transcript`, defaulting
   `[]`/`null`/`[]` when absent.

   **Manifest version policy.** `deserializeProject` rejects any
   `schemaVersion !== PROJECT_SCHEMA_VERSION` (`project-io.ts:57`), so a v2
   manifest would fall through to `parseManifest`'s generic
   "schema version 2, which this build does not understand" message
   (`manifest.ts:85`). That is accurate but unhelpful. Add an explicit branch
   beside the version-1 one at `manifest.ts:80`:

   ```
   if (candidate.schemaVersion === 2) throw new ManifestError(
     "This project was saved before AniBuddy's rig became free-form. Its fixed-skeleton rig and motion preset do not round-trip into the new format. Re-rig the artwork to carry on.",
   );
   ```

   Leave the version-1 branch untouched. A v2 **localStorage** blob needs no
   refusal — the key changed, so it is simply not read.
2. **`deriveStep`** (`useAniBuddyProject.ts:45`): the `if (!project.motion)
   return "animate"` branch becomes `if (project.clips.length === 0)`. All
   `motion` reducer fields become clip fields; the `setRig` cascade that
   dropped a motion the new rig did not support is replaced by: when a new rig
   replaces the old one, drop clips that reference joints the new rig does not
   have, and re-key the rest to the new joint ids if possible (mapping by id
   and dropping orphaned joints from the poses; if a clip ends up with no
   valid joints it is deleted).
3. **`setActiveClip`** on `null` keeps the current clip loaded but paused;
   `deleteClip` of the active one falls back to the nearest surviving clip.
4. **`ExportStep`** takes `clip: Clip` (the active one) instead of
   `motion: MotionId`. `export.ts`'s `ExportInput` swaps `motion: MotionId`
   for `clip: Clip`; `createRunner` builds `Pose[]` via `sampleClip(clip,
   frameCount)` (Order 1) instead of `getFramePoses`. `exportBaseName` drops
   its `motion` parameter (suffix becomes the clip name sanitized the same
   way).
5. **`AniBuddyWorkspace`** passes `activeClip` (the resolved clip for
   `activeClipId`, or null) down; `ExportStep` renders only when
   `state.prepared && state.rig && activeClip`.
6. **`StepRail`'s `isStepDone("animate")`** becomes `project.clips.length > 0`
   (`project.motion !== null` is gone). Its "Pick a motion" blurb becomes
   "Give it something to do — or animate it by hand".
7. `useAniBuddyProject`'s `setMotion` action is deleted; the clip actions from
   Order 7 are wired into the reducer. The `setPrepared`/`setSource` cascades
   now also clear `clips` and `activeClipId` (they were already cleared via
   `motion: null`; keep that behaviour).
8. `types.ts` `createEmptyProject` gains `clips: [], activeClipId: null,
   transcript: []`.

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint
```

Manual:

1. Build a project (mock mode), export a GIF — frames render from the clip, not
   the old templates. PNG fallback and manifest export still work.
2. Refresh the tab → project restores (v3 key) with clips intact.
3. A leftover `anibuddy:project:v2` localStorage blob is ignored, not parsed —
   the workspace opens empty rather than erroring.
4. A **v2 manifest file** is refused by name with the new message, not with the
   generic "does not understand" one.
5. Manifest round-trip with a clip, reopen with the same image → clip
   survives; with a different image → still refuses (R6).

---

# Order 10 — Delete `motion.ts` + full gate

**Depends on:** 9. **Blocks:** nothing.

### Files
- `frontend/src/features/anibuddy/lib/motion.ts` (delete)
- `frontend/src/features/anibuddy/types.ts` (delete `MotionId`,
  `Rig.bodyPlan`, `Rig.supported`, `RigAnalysis`, `RigAnalysisV3` leftovers)
- `frontend/src/features/anibuddy/lib/skeleton.ts` (delete the
  `applyLocalSupport` probe + `LOCAL_WARNING_PREFIXES` + `alphaBox` if nothing
  else uses it; keep `JOINT_LABELS` and `rebindWeights`)
- `frontend/src/features/anibuddy/lib/deform.ts` (delete `eyeOpen` remnants if
  any survive)
- `frontend/src/app/api/enhance/anibuddy/rig-analysis/route.ts` (drop
  `BODY_PLANS`, `MOTIONS`, `bodyPlan`, `supported` from the response)
- `frontend/src/app/api/enhance/anibuddy/animate/route.ts` (drop the deprecated
  fields from its response too)
- `frontend/src/app/api/enhance/anibuddy/prompt/route.ts` (drop the `view`
  clause only if `VIEWS`/view parameter is also dropped from the client — it
  can stay; the interview covers it)

### Verify

```
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

The full gate. `grep -rn "MotionId\|lib/motion\|bodyPlan\|RigAnalysisV3\b" frontend/src/features/anibuddy frontend/src/app/api/enhance/anibuddy` returns nothing. `npm run build` is the route-manifest check — it is why this order exists.

Manual full pass, `OPENROUTER_MOCK=1`:

1. Fresh project: concept interview → prompt; upload → prepare → rig (free-form
   joints, cut lines, weight brush) → animate (request a clip, edit frames,
   scrub) → export GIF/PNG/manifest.
2. Reload persistence, manifest reopen with the same image, manifest reopen
   with a different image (refuses).
3. The stretch overlay, distorted banner, and step lock messages all still
   work.

---

## Manual passes

Everything below runs against `npm run dev` with `OPENROUTER_MOCK=1` unless it
says otherwise. "Mock" means the routes' `isMockMode` path — no real LLM call,
no credit spend.

| # | Order | Pass |
|---|-------|------|
| 1 | 2 | Rig any image; Animate renders rest pose without console errors |
| 2 | 3 | Toggle Show mesh: silhouette-following triangles, denser at thin parts |
| 3 | 4 | Rig a non-biped; joints are not clamped to the canonical tree |
| 4 | 5 | Concept interview runs 2 rounds then writes; forged remote image → 400 on both routes |
| 5 | 6 | Add/delete/reparent joints; cut between arm and torso; weights brush still works |
| 6 | 7 | Request → clip plays; autokey writes diamonds; move/remove keys |
| 7 | 8 | Interview transcript, back-navigation, chips + free text |
| 8 | 9 | v3 persistence, v2 migration, export from clip, manifest round-trip |
| 9 | 10 | Full fresh-project pass + rebuild |

## Definition of done

- Every order's Verify block green, in order, with R1 holding between orders.
- Orders 2, 3, 4, 5, 6, 7, 8, 9 each exercised once manually per the table.
- The three R2 greps clean; the R3 guard present in both image routes; the
  seven REQUIREMENTS verbatim in the v3 prompt route (R4).
- The rig a user exports is the rig they see in the preview: same mesh, same
  weights, same pose at every t.

<!-- ORDERS-END -->
