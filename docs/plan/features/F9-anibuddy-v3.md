# F9 — AniBuddy v3: dynamic rigs, dynamic mesh, dynamic animation

Status: approved plan (2026-08-11). This file is the contract every implementation
order reads. See `F9-anibuddy.md` (product spec) and
`F9-anibuddy-implementation.md` (current implementation) for what v1/v2 were.
The ordered build sequence lives in `F9-anibuddy-v3-orders.md` — this file is
the *what*, that one is the *order of work* and the per-order gate.

## Context

AniBuddy today can only animate one shape of creature, four ways, and the user
cannot correct the result.

Three hard limits, all in code:

1. **The skeleton is a fixed 16-joint human.** `lib/skeleton.ts:64` defines a
   literal `PARENTS` map; `hardenJoints` overwrites whatever the model returns
   with that canonical tree. `bodyPlan` accepts `quadruped | serpent | flyer |
   blob`, but no tree exists for any of them — a dragon gets a human skeleton
   with its "hands" on its wings.
2. **The animation is four hardcoded tables.** `lib/motion.ts` holds `BOUNCE`,
   `WAVE`, `BLINK` as literal arrays, and `lib/deform.ts:73` `localDelta` is a
   `switch` on literal joint ids (`elbowA`, `kneeB`, …). A tail or a wing has no
   case, so it cannot move at all — the model has no way to author motion.
3. **Frames are not editable and barely exist.** `getFramePoses` resamples a
   table at render time. There is no frame object, no timeline, and no way to
   fix a pose the model got wrong. The only editing available is weight
   painting.

The mesh is not literally static — `lib/mesh.ts` fits a lattice per image — but
it is uniform 20-column density with no part awareness, so an arm drawn against
the torso welds to it and tears when it rotates.

The concept step is a single LLM call (`api/enhance/anibuddy/prompt/route.ts`)
that turns one sentence into one prompt, with no clarification.

**Outcome:** the model defines the skeleton, the mesh follows the artwork's
actual shape with user-declarable separations, the model authors keyframe
animation from a plain-language request, and a timeline lets the user click any
frame and fix the pose by dragging joints. The concept step becomes an adaptive
interview.

Delivered as one pass. Schema goes to v3.

## Decisions (locked)

| Question | Answer |
|---|---|
| Rig topology | Full free-form graph — model defines joints, parents, roles |
| Animation format | Sparse keyframes + client interpolation |
| Frame editing | Drag joints on canvas, autokey. No per-frame vertex data |
| Frame identity | Frames are a *view* of the keyframe timeline at `t = n/fps` |
| Mesh | Contour triangulation, adaptive density, user cut lines |
| Anim generation | Single vision call: image + rig + request → keyframes |
| Concept step | Adaptive model-driven Q&A, 1–3 questions per round |
| Presets | **Deleted.** Model-only animation |
| Triangulation | Add `cdt2d` dependency |

---

## 1. Data model — `features/anibuddy/types.ts`

`PROJECT_SCHEMA_VERSION` → `3`.

```ts
/** What a joint IS, so motion generation and mesh density can reason about it
 *  without knowing anatomy. Closed set — the model picks, never invents. */
export type JointRole =
  | "root" | "spine" | "head" | "eye" | "jaw"
  | "limbUpper" | "limbLower" | "limbTip"
  | "tail" | "wing" | "ear" | "prop" | "other";

export interface Joint {
  id: string;            // model-authored, [a-zA-Z0-9_-]{1,24}
  name: string;          // model-authored human label
  role: JointRole;
  x: number;             // normalized 0..1 of prepared asset
  y: number;
  parent: string | null; // exactly one root across the rig
}

/** A user-drawn separation. Mesh triangulation will not cross it, so the arm
 *  stops welding to the torso. Normalized endpoints. */
export interface CutLine {
  id: string;
  points: [number, number][]; // polyline, ≥2 points
}

export interface Mesh {
  verts: Float32Array;   // unchanged: flat [x,y,...] normalized
  tris: Uint32Array;     // unchanged: flat [i0,i1,i2,...]
}

/** One joint's local transform delta at a keyframe. All fields optional; an
 *  absent field means "unchanged from rest". */
export interface JointPose {
  rot?: number;          // degrees, local, + = clockwise on screen
  tx?: number;           // translation, fraction of figure height
  ty?: number;
  scale?: number;        // uniform, about the joint. Used for eye-close etc.
}

export interface Keyframe {
  t: number;             // 0..1 normalized clip time
  joints: Record<string, JointPose>;
  ease?: "linear" | "ease" | "hold";   // outgoing interpolation. Default "ease"
}

export interface Clip {
  id: string;
  name: string;          // "tail wag + crouch"
  request: string;       // what the user typed. Kept for regeneration
  loop: boolean;
  keyframes: Keyframe[]; // sorted by t, t[0] === 0
  source: "model" | "edited";
}

export interface Rig {
  joints: Joint[];
  mesh: Mesh;
  weights: Weights;
  cuts: CutLine[];
  warnings: string[];
  source: "model" | "edited";
}
```

**Removed:** `MotionId`, `bodyPlan`, `Rig.supported`, `AniBuddyProject.motion`.
**Added to project:** `clips: Clip[]`, `activeClipId: string | null`,
`concept.transcript: QaTurn[]`.

`frameCount` and `fps` stay — they are the sampling rate of a clip, not its
content.

### Validation — rewrite `rigInvalidReason`

The existing checks stay valid and become *load-bearing* rather than
belt-and-braces, because `hardenJoints` no longer forces the tree. Keep: single
root, parent-exists, finite/in-range coords, cycle detection (`types.ts:236`
already walks to the root with a hop cap), non-empty mesh, weight-matrix
dimensions, row normalization.

Add: `joints.length` in `[3, 48]`, tree depth ≤ 8, unique ids, id charset.

---

## 2. Mesh — `lib/mesh.ts` rewrite

Add dependency: `cdt2d` (+ a local `types/cdt2d.d.ts` shim; it ships no types).

Replace `buildMesh`'s lattice with:

1. **Contour trace.** Marching-squares over the alpha channel at `ALPHA_FLOOR`
   (24, unchanged — `prepare.ts` and `rigCore` agree on it). Yields one outer
   ring per connected component plus hole rings.
2. **Simplify.** Ramer–Douglas–Peucker at ~0.4% of the max edge. Keeps
   silhouette shape, kills per-pixel noise.
3. **Interior points, adaptive.** Poisson-ish sampling inside the contour where
   the local spacing is driven by the distance transform: fine where the shape
   is thin (a tail, a finger), coarse in large solid regions. Density also
   biased finer within ~1 bone-length of any joint, since that's where bending
   happens.
4. **Constraints.** Contour edges + every `CutLine` segment become constrained
   edges. `cdt2d(points, edges, { exterior: false, interior: true })`.
5. **Post-check.** Drop degenerate triangles (`|area| < MIN_TRIANGLE_AREA`).
   Cap total verts at `MAX_VERTS` (1200) by raising the sampling spacing and
   re-running, not by truncating.

Keep `buildWeights` largely as-is — inverse-distance^4, top-K=3, one Laplacian
pass. Two changes:

- **Cut-aware distance.** A vertex's distance to a bone is `Infinity` if the
  straight segment between them crosses a `CutLine`. This is the mechanism that
  makes cuts actually work; triangulating around a cut without this still lets
  the torso bone dominate the arm's vertices.
- **`TOP_K` from 3 → 4**, since free-form rigs can legitimately have more
  overlapping influences than a biped.

`normalizeRows` unchanged and still used by weight painting.

---

## 3. Deformation — `lib/deform.ts`

Delete `localDelta` entirely — the hardcoded joint-id switch is what blocks
arbitrary creatures.

`createDeformer(rig, prepared, image)` keeps its signature but takes a resolved
`Pose` (`Record<string, JointPose>`) instead of `(pose, reference)`:

- `solve(pose)` walks the tree from the root; each joint's world transform is
  `parentWorld · restLocal · delta`, where `delta` is that joint's `JointPose`
  (rot about the joint, translate scaled by figure height, uniform scale).
- Rest state is computed once from the joint positions, exactly as today
  (`restAngle`, `restLength`, `restPos` — all already there and all
  topology-agnostic).
- LBS `skin()` is unchanged; it already loops over generic bones and weights.
- Delete `applyEyelids`. Its job is now `scale` on an `eye`-role joint, driven
  by keyframes — which is more general and needs no special case.
- Keep the per-triangle affine warp, `SEAM_BLEED`, and the σmax/σmin stretch
  measurement verbatim. That code is good and is topology-independent.

Because there is no reference pose, `FrameStats` and `showDistortion` work
unchanged.

---

## 4. Animation — replace `lib/motion.ts` with `lib/clip.ts`

`motion.ts` is deleted, along with its imports from
`features/studio/lib/rig/{biped,poseRig}`. AniBuddy stops depending on the
studio's mannequin tables.

```ts
/** Resolve a clip to the pose at normalized time t. */
export function poseAt(clip: Clip, t: number): Pose;

/** Sample a clip into N frames. Wraps when clip.loop. */
export function sampleClip(clip: Clip, frameCount: number): Pose[];

/** Insert or update a key at t from a full pose. Used by autokey. */
export function upsertKeyframe(clip: Clip, t: number, pose: Pose): Clip;

export function removeKeyframe(clip: Clip, t: number): Clip;
export function moveKeyframe(clip: Clip, from: number, to: number): Clip;
```

Interpolation: per-joint, per-channel. `ease` → smoothstep, `linear` → lerp,
`hold` → step. A joint absent from the surrounding keys interpolates from rest
(all-zero `JointPose`), which is what makes sparse keys work.

`sampleClip` replaces `getFramePoses`; `referencePose` disappears.

### Mock fixture (required)

Deleting the presets removes the zero-credit path, so `OPENROUTER_MOCK=1` would
otherwise land on a dead timeline. `lib/clip.ts` exports `MOCK_CLIP` — a
generic 4-key breathing loop keyed by *role*, retargeted onto whatever joints
the mock rig has. The animate route returns it in mock mode, matching how
`rig-analysis/route.ts:48` already ships `MOCK_ANALYSIS`.

---

## 5. API routes

### `POST /api/enhance/anibuddy/rig-analysis` — rewrite the contract

Response becomes:

```json
{"joints":[{"id":"tail1","name":"Tail base","role":"tail",
            "x":0.52,"y":0.61,"parent":"hips"}],
 "warnings":["…"]}
```

System prompt changes: describe the artwork's *actual* anatomy; choose ids and
labels; assign a `role` from the closed set; declare `parent` for each joint
with exactly one root. Emphasise: place joints only where the artwork has a
visible articulating part; a snake gets a spine chain and no limbs.

`sanitizeJoints` is rewritten to validate a graph rather than filter against a
whitelist: id charset/uniqueness/length, role in the enum, coords finite and
clamped to 0..1, parent resolves to another supplied id, exactly one root,
no cycles, count in `[3,48]`, depth ≤ 8. Reject the whole response on structural
failure (a partially-repaired graph is worse than a clean refusal) and refund —
the refund path at `rig-analysis/route.ts:221` already exists.

`hardenJoints` in `lib/skeleton.ts` is replaced by client-side re-validation of
the same rules. `defaultJoints`, `PARENTS`, `JOINT_LABELS`, `localSupport`,
`applyLocalSupport`, `EXPECTED_JOINT_IDS` are all deleted.

Manual fallback ("Place joints myself") becomes: click on the canvas to drop a
joint, pick its role, drag to set its parent. Not a pre-seeded human.

### `POST /api/enhance/anibuddy/animate` — new

Request: `{ image, rig: {joints}, request, frameHint?, model? }`
Response: `{ clip: { name, loop, keyframes } , warnings: [] }`

Single vision call. System prompt supplies the joint list with roles and rest
positions, the coordinate/angle conventions, and hard limits (≤ 12 keyframes,
`t ∈ [0,1]`, first key at `t = 0`, `rot` in ±170°, `tx`/`ty` in ±0.4,
`scale` in [0.05, 2]). Instruct it to reason about which joints its request
implies and to state in `warnings` anything the rig cannot express.

Server-side sanitize: drop unknown joint ids, clamp every channel, sort keys by
`t`, dedupe, force `keyframes[0].t = 0`, cap count. Refuse + refund when fewer
than 2 usable keyframes survive.

Same auth/credit/mock plumbing as the existing two routes
(`resolveKeyAndCredits`, `refundCredits`, `isMockMode`, `callLlm`,
`providerHeaders`, `LLM_LONG_BUDGET_MS`, `maxDuration = 120`).

### `POST /api/enhance/anibuddy/prompt` — becomes the interview

Two modes on one route, discriminated by an `action` field:

- `action: "ask"` — request `{ idea, transcript }`, response
  `{ questions: [{ id, question, options: [string], allowFree: boolean,
  multi: boolean }], done: boolean }`. Model returns 1–3 questions per round,
  chosen adaptively from the transcript. Sets `done: true` when it has enough.
- `action: "write"` — request `{ idea, transcript }`, response `{ prompt }`.
  Existing behaviour, but the transcript feeds it. The seven hard requirements
  at `prompt/route.ts:21` (`REQUIREMENTS`) are preserved verbatim — they are
  what makes the art riggable, and they are not negotiable by the interview.

Cap rounds at 6 server-side. `ConceptStep` gets "Write it now" always
available.

---

## 6. UI

### `ConceptStep.tsx` — interview

Chat-like transcript. Each round renders question cards with tappable option
chips plus a free-text field. Answers append to `concept.transcript` and
trigger the next `ask`. "Write it now" jumps to `write`. Final prompt panel and
copy button are unchanged.

### `RigStep.tsx` + `RigCanvas.tsx` — three tools

`RigTool` becomes `"joints" | "cuts" | "weights"`.

- **joints**: drag (existing Konva `Circle` + `dragBoundFunc` clamp, unchanged),
  plus click-empty-space to add, right-click to delete, and a parent picker in
  the sidebar. Role dropdown per selected joint.
- **cuts**: draw polylines over the artwork. Each completed cut triggers a mesh
  rebuild + reweight. This is the tool that fixes arm-welded-to-torso.
- **weights**: unchanged. `paintAt` + `normalizeRows` already work on any
  bone count.

Sidebar bone `<select>` is unchanged — it already derives from `getBones`.

### `AnimateStep.tsx` — request box + timeline

Replaces the four motion cards with:

1. **Request field.** "Describe the motion" → free text → `Generate` →
   `/animate`. Clip list below for multiple clips per project.
2. **Timeline strip.** One cell per frame (`frameCount` cells). Keyframed times
   are marked. Click a cell → scrub the preview to `t = n/frameCount` and pause.
3. **Pose editing.** With the preview paused on a frame, the canvas shows
   draggable joints at their *posed* positions. Dragging one solves the local
   rotation that puts the joint there and writes it into the pose, then
   `upsertKeyframe` at the current `t`. Clip `source` flips to `"edited"`.
4. Keep verbatim: FPS buttons, frame-count slider, play/pause, the stretch
   overlay, `STRETCH_WARNING` banner, and `rig.warnings` display. Delete the
   `rig.supported` gating.

`ExportStep` and `StepRail` change only where they reference `motion`.

---

## 7. Persistence

- `types.ts`: `PROJECT_SCHEMA_VERSION = 3`.
- `project-io.ts`: `serializeRig`/`deserializeRig` gain `cuts` (plain JSON
  already) — typed-array handling for `mesh`/`weights` is unchanged. Clips are
  plain JSON.
- `manifest.ts`: `parseManifest` currently throws a specific message for
  `schemaVersion === 1` (`manifest.ts:80`). Add the same for `2`, naming the
  reason: the rig format changed from a fixed skeleton to a free-form one and
  does not round-trip. The `preparedHash` check and `restoreProject`'s
  mismatch refusal are unchanged and still correct.
- `useAniBuddyProject.ts`: `deriveStep` drops `if (!project.motion)` in favour
  of `if (project.clips.length === 0) return "animate"`. `stepLockReason`
  likewise. `STORAGE_KEY` → `"anibuddy:project:v3"` so a v2 blob is ignored
  rather than parsed and rejected on every mount.

---

## 8. Files

**New**
- `lib/clip.ts` — keyframe resolve/sample/edit + `MOCK_CLIP`
- `lib/contour.ts` — marching squares, RDP, distance transform, adaptive sampling
- `app/api/enhance/anibuddy/animate/route.ts`
- `components/Timeline.tsx`
- `types/cdt2d.d.ts`

**Rewritten**
- `types.ts`, `lib/mesh.ts`, `lib/deform.ts`, `lib/skeleton.ts` (shrinks to
  graph validation only), `api/.../rig-analysis/route.ts`,
  `api/.../prompt/route.ts`, `components/{ConceptStep,RigStep,RigCanvas,
  AnimateStep}.tsx`

**Deleted**
- `lib/motion.ts` and its `features/studio/lib/rig/{biped,poseRig}` imports

**Touched**
- `lib/export.ts` (`ExportInput.motion` → `clip`, `getFramePoses` →
  `sampleClip`, README text), `lib/project-io.ts`, `lib/manifest.ts`,
  `hooks/useAniBuddyProject.ts`, `components/StepRail.tsx`,
  `components/ExportStep.tsx`, `package.json`

---

## 9. Execution — Claude orchestrates, Codex implements

Claude does not write the implementation. Each work order goes to Codex via the
`codex:codex-rescue` subagent (`codex-companion.mjs task --write`), one order per
run, in dependency order. Between runs Claude reads the diff, runs the gate, and
either accepts or sends a correction as `--resume`.

Prompts follow the plugin's `gpt-5-4-prompting` contract: `<task>` with the
concrete scope and the exact file paths, `<completeness_contract>`,
`<verification_loop>` (must leave `tsc --noEmit` clean), `<action_safety>`
(no unrelated refactors), `<missing_context_gating>` (read the repo, do not
invent conventions).

| # | Work order | Scope | Depends on |
|---|---|---|---|
| 1 | **Types + clip engine** | `types.ts` v3 (roles, `CutLine`, `JointPose`, `Keyframe`, `Clip`, rewritten `rigInvalidReason`), new `lib/clip.ts` (`poseAt`, `sampleClip`, `upsertKeyframe`, `removeKeyframe`, `moveKeyframe`, `MOCK_CLIP`) | — |
| 2 | **Generic deform** | `lib/deform.ts`: delete `localDelta` + `applyEyelids`, FK over arbitrary tree, pose-driven. Keep LBS, affine warp, `SEAM_BLEED`, stretch metering verbatim | 1 |
| 3 | **Contour mesh** | add `cdt2d` + `types/cdt2d.d.ts`, new `lib/contour.ts`, rewrite `lib/mesh.ts` (`buildMesh` with cuts, cut-aware `buildWeights`, `TOP_K` 4) | 1 |
| 4 | **Graph validation** | `lib/skeleton.ts` shrinks to graph validation; delete `PARENTS`, `defaultJoints`, `JOINT_LABELS`, `localSupport`, `applyLocalSupport`, `EXPECTED_JOINT_IDS`; `buildRig`/`rebindWeights` take cuts | 1, 3 |
| 5 | **Routes** | rewrite `rig-analysis/route.ts` contract + graph sanitizer; new `animate/route.ts`; `prompt/route.ts` → `ask`/`write` interview. Same auth/credit/mock plumbing | 1, 4 |
| 6 | **Rig UI** | `RigCanvas.tsx` + `RigStep.tsx`: three tools, joint add/delete/reparent, role picker, cut drawing | 3, 4 |
| 7 | **Animate UI** | new `components/Timeline.tsx`, rewrite `AnimateStep.tsx` (request box, clip list, timeline strip, autokey pose editing) | 1, 2, 5 |
| 8 | **Concept UI** | `ConceptStep.tsx` interview transcript, option chips, "Write it now" | 5 |
| 9 | **Persistence + export** | `project-io.ts` cuts/clips, `manifest.ts` v2 refusal, `useAniBuddyProject.ts` derive/lock/storage key, `export.ts` clip-based, `StepRail`/`ExportStep` | 1–7 |
| 10 | **Delete + gate** | remove `lib/motion.ts` and its studio-rig imports; full `tsc --noEmit && lint && build` | all |

Orders 2, 3 and 4 are independent of each other once 1 lands, and 6/7/8 are
independent once their deps land — those can run as parallel Codex threads.

**Claude's side of the contract:** after every order run
`npx tsc --noEmit && npm run lint` in `frontend/`. Codex's self-reported green
does not count. Order 10 does not start until 1–9 each pass.

## 10. Verification

No test runner exists (`package.json` has `lint` + `build` only), so
verification is build gates plus manual passes.

**Gates**
```
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

**Mock pass** — `OPENROUTER_MOCK=1 npm run dev`, `/anibuddy`, zero spend:
1. Concept: answer 2 interview rounds, confirm questions adapt to the answers,
   confirm "Write it now" short-circuits and the prompt still carries all seven
   `REQUIREMENTS`.
2. Upload + prepare a transparent PNG.
3. Rig: `MOCK_ANALYSIS` produces a free-form graph. Toggle the mesh — triangles
   follow the silhouette, denser at thin parts. Draw a cut between an arm and
   the torso; confirm the mesh re-triangulates along it and the arm's weights
   stop bleeding into the body.
4. Animate: `MOCK_CLIP` loads. Click frame 4, drag a joint, confirm a keyframe
   appears on the timeline at that cell and the preview updates.
5. Export GIF + PNG zip; frame count matches, loop is seamless.
6. Save manifest, reload the page, reopen with the same image → restores.
   Reopen with a *different* image → refuses with the hash-mismatch message.

**Live pass** — one real key, one non-biped subject (a dragon or a snake):
7. `/animate` with "tail wags while it crouches" produces keys on the tail
   joints specifically. This is the acceptance test for the whole rework — it
   is impossible in the current build.
8. Confirm `warnings` surface when the request exceeds the rig.
9. Confirm a v2 manifest is refused by name, not silently mangled.

**Non-generation invariant (F9 §2, unchanged)**: grep the three routes for
`studio/generate` and any image-model id — all three must call `callLlm` only.
Every exported pixel remains a resampled source pixel.
