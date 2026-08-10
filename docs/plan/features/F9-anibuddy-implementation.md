# F9 AniBuddy — Implementation Spec (Phase 1, end-to-end)

**Status:** ready to implement · **Scope:** F9 Phase 1 only · **Package manager:** pnpm (only)

This is the build spec for [`F9-anibuddy.md`](./F9-anibuddy.md). That document
states what AniBuddy is and why; this one states how it gets built, what
existing code it reuses, and where it deliberately deviates.

---

## 1. Context

`docs/plan/features/F9-anibuddy.md` specifies AniBuddy as a top-level `/anibuddy`
workspace that turns user-supplied character art into 2D puppet animation with
**no image generation anywhere in the pipeline**. The doc's §3 flow is:

> concept prompt (optional) → upload → prepare transparent asset → AI rig
> analysis → edit joints/weights → deterministic deform → export GIF/PNG/manifest

### 1.1 What is actually built

`frontend/src/features/anibuddy/components/AniBuddyWorkspace.tsx` (128 lines),
reachable at `/anibuddy` via `app/(anibuddy)/anibuddy/page.tsx`, with
`app/(enhance)/enhance/anibuddy/page.tsx` redirecting to it and a Navbar entry
added in `components/layout/Navbar.tsx`.

### 1.2 What is wrong

| # | Defect | Location |
|---|---|---|
| 1 | Motion template is section "02 / motion intent" — picked **before** any rig exists. Teaches the wrong mental model: choose motion, then hope. | `AniBuddyWorkspace.tsx:117` |
| 2 | Prompt assistant is a sidebar card emitting one hardcoded const string. Doc §3.2 makes it a step backed by `POST .../prompt`. | `:59`, `:121` |
| 3 | Export gated on `!asset \|\| !rightsConfirmed` only, and writes `rig: null`. A "portable project" with no rig cannot be reopened into an editable state, which is the entire point of §4. | `:69-77`, `:123` |
| 4 | No prepare stage — no transparency check, no background removal, no trim. Doc §3.3. | absent |
| 5 | No rig analysis, no mesh, no weights, no editor. Doc §3.4. | absent |
| 6 | No renderer and no GIF/PNG export. Doc §3.5. | absent |
| 7 | `schemaVersion: 1` manifest describes a shape that cannot round-trip. | `:70` |

Defect 1 is what the user flagged. Defects 3 and 7 are the same root cause:
stages are not gated on their prerequisites.

### 1.3 Decisions already taken

- APIs live at the doc's URL path, implemented as **Next.js route handlers**, so
  they reuse the existing credits/BYOK/provider chain.
- **Konva** for the rig editor, **raw canvas 2D** for the deformation renderer.
- **Phase 1 end-to-end.** Phase 2 (pose sheets) and Phase 3 (persistence) out.
- **pnpm only** for every install/script.

---

## 2. Reuse inventory

This is the part that most changes the size of the job. Three existing systems
cover work the naive plan would have rewritten.

### 2.1 `frontend/src/features/studio/lib/rig/` — deterministic pose engine

Built to render mannequin pose-maps that condition an image model. Its motion
data is exactly what AniBuddy needs.

| Symbol | File | Use in AniBuddy |
|---|---|---|
| `BodyPlanId` | `rigCore.ts:16` | rig body plan union, unchanged |
| `Limb2 { base, flex }` | `rigCore.ts:19` | joint angle pair |
| `SubjectBounds` | `rigCore.ts:26` | prepared-asset bbox |
| `deg()` | `rigCore.ts:80` | degrees→radians |
| `projDown/projUp/projRight()` | `rigCore.ts:83-99` | forward kinematics |
| `measureSubjectBounds()` | `rigCore.ts:182` | bbox from pixels — **already alpha-aware** (`alpha < 24` counts as background), so it works on a transparent PNG with no changes |
| `RIGS` | `poseRig.ts:39` | `BodyPlanId` → rig dispatch |
| `SpriteRig.getFrames(anim)` | `rigCore.ts:75` | **per-frame joint-angle tables** |
| `FramePose` | `biped.ts:22` | `lean, bodyY, legA, legB, armA, armB, headTilt?` |
| `IDLE` | `biped.ts:144` | usable as-is for the `idle` template |
| `P` proportions | `biped.ts:40` | thigh .245, shin .245, torso .3, neck .05, headR .075, upperArm .16, foreArm .15 — defines the joint tree |

**Not reused:** `drawMannequin`, `drawPoseGuideSheet`, `capsule`, `dot`,
`polyTube`, `DEFAULT_COLORS`. Those draw a grey figure; AniBuddy deforms user
pixels instead. `FramePose` is consumed as *skeleton drive data*.

This is why the joint tree in §4.2 is not invented — it is the skeleton
`biped.ts` already encodes, so its pose tables apply without retargeting.

### 2.2 `frontend/src/features/studio/lib/imageProcessor.ts` — prepare stage

| Symbol | Line | Use |
|---|---|---|
| `removeUploadedBackground(dataUrl, opts)` | `:2493` | **The whole background-removal step.** Corner-samples for a solid backdrop, detects editor checkerboard (light + desaturated), flood-fills inward from the border only — so interior light areas (white collar) survive. Returns the input untouched when real transparency already exceeds `transparentSkipFraction` (default 0.02). Options: `{ transparentSkipFraction?, maxSize? }` (`:2485`). |
| `isolatePrimarySpriteComponent(url, opts)` | `:3162` | Drops stray specks / secondary blobs, keeps the largest alpha component with a centre bonus. Options `{ alphaThreshold?, minComponentFraction?, enableSplit? }`. |
| `getImageDimensions(dataUrl)` | `:1343` | ingest sizing |
| `chromaKeyToAlpha(url, opts)` | `:1475` | **not used** — magenta-only, wrong tool for arbitrary uploads |

Consequence: `lib/prepare.ts` becomes thin orchestration over existing,
already-debugged code. No hand-written flood fill.

### 2.3 `frontend/src/app/api/studio/_lib/` — LLM + credits

| Symbol | File | Use |
|---|---|---|
| `resolveKeyAndCredits(req, op, model, units)` | `openrouter.ts:41` | BYOK via `X-OpenRouter-Key`, else `Authorization` → Express `/api/usage/consume` |
| `refundCredits(eventId)` | `openrouter.ts:110` | refund on provider failure |
| `isMockMode()` | `openrouter.ts:133` | `OPENROUTER_MOCK=1` |
| `callLlm({ byok, key, model, messages, ... })` | `llm/index.ts` | Open Quota → OpenRouter chain with budget/timeout |
| `providerHeaders(result)` | `llm/index.ts` | `X-LLM-Provider` response headers |
| `LlmContentPart`, `LLM_LONG_BUDGET_MS` | `llm/interface.ts`, `llm/config.ts` | vision message parts, budget |

Reference handlers: `api/studio/prop-brief/route.ts` (text) and
`api/studio/sprite-review/route.ts` (vision + strict-JSON parsing).

---

## 3. Corrected flow

Gated linear stepper. **The active step is derived from project state, never
stored.** A stored step index is what allows gating to desync — the class of bug
behind defects 1, 3 and 7.

```ts
// hooks/useAniBuddyProject.ts
export function deriveStep(p: AniBuddyProject): StepId {
  if (!p.source)                      return 'source'
  if (!p.rightsConfirmed)             return 'source'
  if (!p.prepared)                    return 'prepare'
  if (!p.rig || !isRigValid(p.rig))   return 'rig'
  if (!p.motion)                      return 'animate'
  return 'export'
}
```

| Step | Entry gate | Produces |
|---|---|---|
| 0 · Concept *(skippable, no gate)* | — | copyable external-image prompt |
| 1 · Source | — | decoded, size-capped bitmap + rights confirmation |
| 2 · Prepare | source + rights confirmed | transparent, isolated, trimmed asset |
| 3 · Rig | prepared asset exists | joints + mesh + weights, user-edited |
| 4 · Animate | `isRigValid(rig)` | template + fps + live loop |
| 5 · Export | `isRigValid(rig)` | GIF, PNG frame zip, manifest |

Step 0 is reachable at any time (it is advice, not a dependency). Steps 1–5 are
strictly ordered. Completed steps are re-editable; editing an earlier step
invalidates later derived state (§4.6).

Fixes: defect 1 (motion moves 02 → step 4, after the rig), defect 3 (export
gated on `isRigValid`), defect 7 (manifest always carries a real rig).

---

## 4. Data model

`frontend/src/features/anibuddy/types.ts`:

```ts
import type { BodyPlanId, Limb2 } from '@/features/studio/lib/rig/rigCore'

export type MotionId = 'idle' | 'bounce' | 'wave' | 'blink'
export type StepId = 'concept' | 'source' | 'prepare' | 'rig' | 'animate' | 'export'

export interface Joint {
  id: string                 // stable, e.g. 'elbowA'
  name: string               // human label, e.g. 'Near elbow'
  x: number                  // normalized 0..1 of prepared asset width
  y: number                  // normalized 0..1 of prepared asset height
  parent: string | null      // Joint.id; exactly one root
}

export interface Mesh {
  verts: Float32Array        // [x0,y0, x1,y1, ...] normalized 0..1
  tris: Uint32Array          // [i0,i1,i2, ...] vertex indices
}

/** Row-major, verts.length/2 rows × bones.length cols, each row sums to 1. */
export type Weights = Float32Array

export interface Rig {
  bodyPlan: BodyPlanId
  joints: Joint[]
  mesh: Mesh
  weights: Weights
  supported: MotionId[]      // model's judgement, intersected with local checks
  warnings: string[]         // shown verbatim next to disabled templates
  source: 'model' | 'edited' // flips to 'edited' on any user change
}

export interface PreparedAsset {
  dataUrl: string            // transparent PNG
  width: number
  height: number
  bounds: SubjectBounds      // from measureSubjectBounds
  hash: string               // SHA-256 of dataUrl bytes, for manifest reopen
}

export interface AniBuddyProject {
  schemaVersion: 2
  concept: { idea: string; prompt: string | null }
  source: { name: string; dataUrl: string; width: number; height: number } | null
  rightsConfirmed: boolean
  prepared: PreparedAsset | null
  rig: Rig | null
  motion: MotionId | null
  fps: 8 | 12 | 16
  frameCount: number         // ≤ 24
  background: 'transparent' | 'white' | 'dark' | string  // hex for GIF matte
}
```

### 4.1 `isRigValid`

Guards step 4/5 entry. All must hold:

1. `joints.length >= 3`
2. exactly one joint with `parent === null`
3. every non-null `parent` resolves to an existing `Joint.id`
4. no cycles (walk to root from each joint, bounded by `joints.length`)
5. every `x`/`y` within `[0,1]`
6. `mesh.verts.length >= 6` and `mesh.tris.length >= 3`
7. `weights.length === (verts.length / 2) * boneCount`
8. every weight row sums to `1 ± 1e-3`

### 4.2 Joint tree (biped)

Chosen to match `biped.ts`'s skeleton so its pose tables apply directly.

```
hip (root)
├── torso ──── neck ──── head
│              └── eyeA, eyeB        (leaf markers, blink only)
├── shoulderA ─ elbowA ─ handA       (near, drawn in front)
├── shoulderB ─ elbowB ─ handB       (far)
├── kneeA ───── footA                (near)
└── kneeB ───── footB                (far)
```

Rest positions seed from `biped.ts:40` `P` proportions against the prepared
asset's `SubjectBounds`, then get overwritten by the model's estimates, then by
the user's drags. Other body plans map analogously to `quadruped.ts`,
`serpent.ts`, `flyer.ts`, `blob.ts`.

---

## 5. API routes

### 5.1 Placement

```
frontend/src/app/api/enhance/anibuddy/prompt/route.ts
frontend/src/app/api/enhance/anibuddy/rig-analysis/route.ts
```

URL matches doc §4. Implemented in Next rather than the Express backend because
`callLlm` + `resolveKeyAndCredits` + the Open Quota chain already live there;
duplicating that in `backend/src/modules/enhance/` would fork the provider
fallback logic.

> **Read before writing.** `frontend/AGENTS.md` warns this Next (16.2.6, React
> 19.2.4) diverges from training data and says to read
> `node_modules/next/dist/docs/`. That directory is **not present** in the
> current checkout (deps not installed), so the in-repo
> `app/api/studio/*/route.ts` handlers are the authoritative convention
> reference. Run `pnpm install` in `frontend/` and re-check the bundled docs
> before writing the handlers.

### 5.2 Shared shape

Both follow `prop-brief/route.ts` exactly:

```ts
export const maxDuration = 120

// AniBuddy is a NON-GENERATIVE feature. This route may only call a text/vision
// reasoning model. It must never call an image model or /api/studio/generate.
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    // ...validate...
    const auth = await resolveKeyAndCredits(request, 'anibuddy-rig', modelId, 1)
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    if (isMockMode()) return NextResponse.json(MOCK_FIXTURE)

    const result = await callLlm({ byok: auth.byok, key: auth.key, model: modelId, messages, maxTokens, temperature: 0.2, title: 'AniBuddy - Rig Analysis', referer: request.headers.get('referer'), signal: request.signal, budgetMs: LLM_LONG_BUDGET_MS })

    if (!result.ok) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json({ error: result.error }, { status: result.status || 502 })
    }
    // ...parse strict JSON, clamp, return with providerHeaders(result)...
  } catch (error) { /* 500 */ }
}
```

Each ships a mock fixture so `OPENROUTER_MOCK=1` exercises the full client
pipeline with zero spend.

### 5.3 `POST /api/enhance/anibuddy/prompt`

Request `{ idea: string, view?: 'front' | 'three-quarter', model?: string }`.
Response `{ prompt: string }`. `maxTokens: 400`, no image.

System prompt requires the output to demand: exactly one character, full body in
frame, clean readable silhouette, arms separated from the torso, consistent
proportions, transparent or flat removable background, the requested view, and
no scenery/text/extra characters. It must also state that the prompt is for an
**external** image tool — AniBuddy does not generate images.

### 5.4 `POST /api/enhance/anibuddy/rig-analysis`

Request `{ image: string /* data:image/png prepared asset */, model?: string }`.
Reject anything not starting with `data:image/`, mirroring
`sprite-review/route.ts:.startsWith('data:image/')`.

Response is `RigAnalysis`, **joints only**:

```ts
type RigAnalysis = {
  bodyPlan: BodyPlanId
  joints: { id: string; name: string; x: number; y: number; parent: string | null }[]
  supported: MotionId[]
  warnings: string[]
}
```

Parse with the loose-JSON approach from `sprite-review/route.ts:parseReview` —
strip ``` fences, then fall back to the outermost `{...}` slice. On unparseable
output, **fail loudly** (502) rather than the sprite-review "treat as approved"
default: a silent empty rig would strand the user at step 3 with no explanation.

#### Deliberate deviation from doc §4

Doc §4 says this endpoint returns "proposed joints, mesh topology, weights, and
supported animation templates". This spec asks for **joints and templates only**;
mesh and weights are generated deterministically on the client (§6.1, §6.2).

Rationale: a few hundred triangles plus a full weight matrix is a large,
error-prone payload, and a hallucinated triangle list produces deformation that
is visibly broken with no way for the user to diagnose it. Joints are ~16 numbers
a vision model estimates well, and they are directly draggable. Everything
downstream stays deterministic — which is also what §2's non-goals promise.
Doc §6 already treats analysis as "a draft"; this narrows the draft to the part
worth drafting.

#### Client-side hardening (never trust the response)

1. Clamp every `x`/`y` into the prepared asset's alpha bbox.
2. Drop joints naming a missing `parent`; re-root orphans to `hip`.
3. Break cycles by cutting the offending edge.
4. Fill missing expected joints from the `P`-proportion defaults.
5. Intersect `supported` with local structural checks (§7.2).

---

## 6. Client pipeline

### 6.1 `lib/prepare.ts`

```ts
export async function prepareAsset(sourceDataUrl: string): Promise<PreparedAsset>
```

1. Downscale to ≤2048px longest edge (doc §6 memory cap).
2. `removeUploadedBackground(url, { maxSize: 2048 })` — already no-ops on genuinely
   transparent PNGs.
3. `isolatePrimarySpriteComponent(url, { alphaThreshold: 32 })` — drop specks.
4. `measureSubjectBounds(imageData.data, w, h)` → `SubjectBounds`. On `null`
   (essentially empty), surface "we could not find a character in this image"
   and stay on step 2.
5. Trim to bbox + 2% margin, re-encode PNG.
6. `crypto.subtle.digest('SHA-256', bytes)` → `hash`.

UI shows before/after with a checkerboard backdrop and a "keep original
background" escape hatch for art whose background is intentional.

### 6.2 `lib/mesh.ts`

**Lattice.** Overlay a `cols × rows` grid (cols = 20, rows derived from aspect,
capped so `verts ≤ 1200`). Keep a cell if any corner has `alpha > 24`. Emit two
triangles per kept cell. Snap boundary vertices to the nearest alpha edge along
their row/column so the mesh hugs the silhouette instead of stair-stepping.

Grid over Delaunay deliberately: a lattice is stable, has predictable vertex
count, and produces no sliver triangles — slivers are what make affine warping
visibly tear.

**Weights (linear blend skinning bind).** Bones are parent→child joint segments.
For vertex `v` and bone `j`, `d_j` = distance from `v` to segment `j`:

```
w_j = 1 / (d_j^4 + ε)      ε = 1e-6
keep the top K = 3 bones, zero the rest
normalize so Σ w_j = 1
```

Exponent 4 gives a tight falloff — limbs stay independent rather than dragging
the torso. Then one Laplacian smoothing pass over mesh neighbours to remove
weight discontinuities that read as creases.

### 6.3 `lib/motion.ts`

```ts
export function getFramePoses(bodyPlan: BodyPlanId, motion: MotionId, frameCount: number): FramePose[]
```

- `idle` → `RIGS[bodyPlan].getFrames('idle')` verbatim (`biped.ts:144`).
- `bounce` → local table: whole-body vertical `bodyY` sine with knee flex
  counter-phase, looping. Shaped after the existing `JUMP` curve (`biped.ts:155`)
  but retimed so frame N flows into frame 0.
- `wave` → local table: `armA` shoulder/elbow sweep, everything else held at
  `IDLE` values so only the arm moves.
- `blink` → local table: `IDLE` pose plus an `eyeOpen: number` channel consumed
  by the renderer as a vertical scale about the eye joints.

Local tables live in `lib/motion.ts` in the **same `FramePose` shape and
conventions** as `biped.ts` (angles from straight-down, + = forward; `bodyY` a
fraction of figure height, + = up) so they stay interchangeable with the studio
tables.

### 6.4 `lib/deform.ts`

**Forward kinematics.** Walk the joint tree from `hip`. Each joint's posed
position comes from its parent's posed position plus the rest bone length
projected at the posed angle, via `projDown/projUp/projRight` (`rigCore.ts:83`).
`FramePose` supplies the angles; `lean` rotates `torso`, `bodyY` translates
`hip`, `headTilt` rotates `head`.

**Skinning.** For bone `j`, rest transform `B_j` and posed transform `P_j` are
2D rigid transforms (translate-rotate; optional uniform scale from bone length
ratio). Posed vertex:

```
v' = Σ_j  w_j · (P_j · B_j⁻¹) · v
```

**Per-triangle affine warp.** For source triangle `(s0,s1,s2)` → dest
`(d0,d1,d2)`:

```
S = [[s1x-s0x, s2x-s0x], [s1y-s0y, s2y-s0y]]
D = [[d1x-d0x, d2x-d0x], [d1y-d0y, d2y-d0y]]
A = D · S⁻¹                       // 2×2
t = d0 − A·s0
```

`ctx.setTransform(a, b, c, d, e, f)` is the matrix `[a c e; b d f]`, so
`a=A00, b=A10, c=A01, d=A11, e=t.x, f=t.y`.

```ts
ctx.save()
ctx.beginPath(); ctx.moveTo(d0.x,d0.y); ctx.lineTo(d1.x,d1.y); ctx.lineTo(d2.x,d2.y); ctx.closePath(); ctx.clip()
ctx.setTransform(a, b, c, d, e, f)
ctx.drawImage(sourceBitmap, 0, 0)
ctx.restore()
```

**Seams.** Adjacent clipped triangles leave hairline gaps from antialiasing.
Expand each destination triangle ~0.5px about its centroid before clipping.

**Distortion warning.** Per triangle, compute `σmax/σmin` of `A` (singular
values). If any triangle exceeds ~2.5, or `det(A) < 0` (flipped), surface the
doc §6 "mesh distortion warning" and offer a distortion heat-map overlay. This
is the doc §7 requirement that unsupported motions *disclose* limitations.

Same function serves live preview and offscreen export frames, so the two cannot
drift.

### 6.5 `lib/export.ts`

- **PNG frames** — render each frame to an offscreen canvas at native prepared
  size, `toBlob('image/png')`, collect into `jszip` (already a dependency at
  `3.10.1`), download `anibuddy-frames.zip`. Full alpha preserved.
- **GIF** — `gifenc`: `quantize(rgba, 256)` → `applyPalette` → `writeFrame(index,
  w, h, { palette, delay: 1000/fps, transparent: true, transparentIndex })` →
  `finish()` → `bytes()`. GIF carries only **1-bit alpha**, so frames are matted
  against `project.background` first and the UI says so plainly. Cap output at
  512px longest edge. On encoder failure, fall back to the PNG zip and say why —
  doc §6's stated mitigation.
- **Manifest** — §8.

---

## 7. UI

`AniBuddyWorkspace.tsx` becomes the step host. **Keep its existing visual
language**: mono uppercase eyebrows with `NN / label` numbering, hard 2px
borders, fuchsia accent, checkerboard preview backdrop, and the rights checkbox
at `:114`.

### 7.1 Components (`features/anibuddy/components/`)

| Component | Contents |
|---|---|
| `StepRail` | 6 steps, states done / current / locked; locked entries show the gate reason ("needs a prepared asset") rather than being silently dead |
| `ConceptStep` | idea textarea → `POST .../prompt` → generated prompt, copy button, "Skip — I already have art" |
| `SourceStep` | existing `react-dropzone` block (`:51-57`, `:100-113`) plus the rights checkbox; the checkbox now genuinely gates progress |
| `PrepareStep` | before/after, tolerance controls, "keep original background", warning when no character is found |
| `RigStep` | Konva editor (§7.2) |
| `AnimateStep` | template cards (moved from `:117`), fps 8/12/16, live loop, distortion warnings |
| `ExportStep` | GIF / PNG zip / manifest, background picker for the GIF matte, explicit "no image generation was used" note |

### 7.2 `RigStep` — Konva

`react-konva@19.2.4` `Stage` sized to the prepared asset:

- `Layer 1` — `Konva.Image` of the prepared asset.
- `Layer 2` — bones as `Line`s, joints as draggable `Circle`s (radius ~8, larger
  invisible hit area). `dragBoundFunc` clamps into the asset rect.
- `Layer 3` — optional mesh wireframe + weight heat-map for the selected bone.
- Weight brush — pointer-drag adds/subtracts influence for the selected bone on
  nearby verts, then re-normalizes the affected rows.

Konva earns its place here purely on drag hit-testing. Any joint edit sets
`rig.source = 'edited'` and recomputes weights for affected verts.

Template availability is intersected with local structure checks, so a bad model
`supported` list cannot enable a broken motion:

- `wave` requires `shoulderA` + `elbowA` present and the arm's bbox not fully
  inside the torso bbox (otherwise the arm has no separable pixels — the doc's
  "needs a visible arm" at `:13`).
- `blink` requires `eyeA`/`eyeB` within the head circle.
- Unavailable templates render disabled with the model's `warnings` text.

### 7.3 `useAniBuddyProject`

`useReducer` over `AniBuddyProject`. Actions: `setIdea`, `setPrompt`, `setSource`,
`confirmRights`, `setPrepared`, `setRig`, `editJoint`, `paintWeight`,
`setMotion`, `setFps`, `setBackground`, `importManifest`, `reset`.

Persisted to `localStorage` (debounced 500ms) **minus `source.dataUrl` and
`prepared.dataUrl`** — base64 bitmaps will blow the ~5MB quota. On reload the
project restores with pixels missing and the derived step lands back on
`source`, prompting re-supply. Doc §2 keeps v1 local-first; F1 later adds real
persistence.

---

## 8. Manifest

`schemaVersion: 2`. The shipped `1` (`:69-77`) has a different, non-round-trippable
shape; readers reject `1` with "created by an earlier preview of AniBuddy".

Contains the full `AniBuddyProject` **minus pixel data**, plus
`prepared.hash` and `source.name`. Reopening asks the user to re-supply the image,
re-runs `prepareAsset`, and compares hashes:

- match → restore rig edits, motion, fps, background
- mismatch → refuse, explain that the rig's joint positions belong to different
  artwork

Refusing on mismatch is the point: joints are normalized coordinates, so pairing
them with a different image yields a silently wrong rig.

---

## 9. Usage ops

`resolveKeyAndCredits` takes a typed `op` and the backend independently validates
it, so adding `anibuddy-prompt` and `anibuddy-rig` means editing **all four**
sites or requests fail zod validation at `/api/usage/consume`:

| File | Line | Change |
|---|---|---|
| `frontend/src/app/api/studio/_lib/openrouter.ts` | `:21` | add to `UsageOp` union |
| `backend/src/modules/usage/dto/consume.schema.ts` | `:4` | add to `z.enum` |
| `backend/src/modules/usage/usage.model.ts` | `:8`, `:27` | add to TS union **and** mongoose `enum` |
| `backend/src/modules/usage/usage.service.ts` | `:14` | `costPerUnit` — both are reasoning ops, same branch as `scene-brief`/`sprite-review` (`:20`) |

---

## 10. Files

**New — `frontend/src/features/anibuddy/`**

```
types.ts
lib/prepare.ts      lib/mesh.ts    lib/motion.ts
lib/deform.ts       lib/export.ts  lib/manifest.ts
hooks/useAniBuddyProject.ts
components/{StepRail,ConceptStep,SourceStep,PrepareStep,RigStep,AnimateStep,ExportStep}.tsx
```

**New — API**
`frontend/src/app/api/enhance/anibuddy/{prompt,rig-analysis}/route.ts`

**Modified**
`features/anibuddy/components/AniBuddyWorkspace.tsx` (step host) · the four
usage-op files · `frontend/package.json` (`gifenc`)

**Untouched**
`app/(enhance)/enhance/anibuddy/page.tsx` — 5-line redirect, keeps old links
alive · `components/layout/Navbar.tsx` — entry already correct

---

## 11. Dependency

```bash
cd frontend && pnpm add gifenc
```

`gifenc` (MIT, ~10KB, no worker required) over hand-writing an LZW/GIF89a
encoder. `jszip@3.10.1` already covers the PNG zip. No other new dependency —
Konva, react-konva, react-dropzone are all present.

---

## 12. Build order

Each step is independently verifiable; nothing is stubbed and left behind.

| # | Task | Done when |
|---|---|---|
| 1 | `types.ts`, `useAniBuddyProject`, `deriveStep`, `isRigValid`, `StepRail` | steps lock/unlock correctly against hand-set state |
| 2 | Rework `AniBuddyWorkspace` into the step host; move motion picker to step 4; gate export | **defects 1 + 3 fixed and demoable** |
| 3 | `lib/prepare.ts` + `PrepareStep` | opaque-background JPG → clean trimmed transparent PNG |
| 4 | Usage ops (4 files) + `/prompt` route + `ConceptStep` | prompt round-trips under mock and real |
| 5 | `lib/mesh.ts` | wireframe overlay hugs the silhouette; weights normalized |
| 6 | `/rig-analysis` route + clamping + `RigStep` Konva editor | joints land plausibly and drag smoothly |
| 7 | `lib/motion.ts` + `lib/deform.ts` + `AnimateStep` | idle loop renders from real pixels at 12fps |
| 8 | `lib/export.ts` + `lib/manifest.ts` + `ExportStep` | GIF + zip + manifest download |
| 9 | Manifest reopen + hash mismatch refusal | round-trip restores rig; wrong image refused |
| 10 | Distortion warnings + template gating | `wave` disabled with reason on an armless image |

Step 2 alone resolves the reported defect, so the flow fix is verifiable well
before the renderer lands.

---

## 13. Verification

```bash
cd frontend && pnpm install && pnpm dev      # :3000
cd backend  && pnpm install && pnpm dev      # :4000, needed for credits
```

1. **Gating** — with no asset, steps 3–5 unreachable; export disabled until
   `isRigValid`. Directly re-tests defects 1, 3.
2. **Credit-free API** — `OPENROUTER_MOCK=1` on the Next server; exercise both
   routes with zero spend. Then one real call each.
3. **Auth matrix** — signed out → 401 `AUTH_REQUIRED`; signed in → credits
   deducted via `/api/usage/consume` (fails with a zod error if §9 is
   incomplete — that is the intended tripwire); `X-OpenRouter-Key` header → BYOK,
   no deduction.
4. **Refund** — force a provider failure (bad `OPENROUTER_API_KEY`); confirm
   `refundCredits` restores the balance.
5. **Doc §7 walkthrough** — fox prompt → upload transparent fox → prepare →
   accept then edit the rig → preview idle and wave → export GIF + PNG zip +
   manifest.
6. **Reopen** — import manifest, re-supply the fox: joint edits and fps survive.
   Re-supply a *different* image: refused on hash mismatch.
7. **Non-generation proof** — DevTools Network across a whole session shows only
   `/api/enhance/anibuddy/*` and `/api/usage/*`. No `/api/studio/generate`, no
   image-model call. This is the doc's core promise and the one regression that
   would make the feature dishonest.
8. **Limits disclosed** — an image with no separable arm shows `wave` disabled
   with the warning; a large stretch shows the distortion overlay rather than
   silently smearing.
9. **Memory caps** — a 6000px source downscales to 2048; 24 frames at 512px
   encodes without tab crash.
10. `cd frontend && pnpm lint`; backend test suite for the usage-op change.
