# F9 — AniBuddy: Non-Generative Character Animation

> **Theme D · Refine existing artwork.** AniBuddy is an Enhance workspace for
> turning user-supplied character artwork into editable 2D puppet animation.
>
> **Priority:** P2 · **Effort:** XL, phased · **Depends on:** F8 Phase 1 for the
> Enhance shell; benefits from F1 for later saved-project support.

---

## 1. Problem

Users may have a character concept but do not want OpenAssets to generate a new
image for every animation frame. They need a workflow that helps them create a
consistent external reference, upload it, isolate it, rig it, and export a GIF
or frame sequence based on the pixels they already own.

The existing Sprite Studio solves a different problem: it generates anchor art
and pose sheets through image models. AniBuddy must stay outside Studio so its
core promise is clear: AI may help write text or analyse a rig, but it never
generates image pixels or claims to create unseen views of a character.

## 2. Goals / non-goals

**Goals**

- Let a user turn an idea into a copyable prompt for an external image tool,
  then upload the result as a transparent single character or multi-pose sheet.
- Reuse extraction to remove backgrounds, split sheets, and give pose assets
  human-readable names.
- Have AI reasoning propose an editable mesh, joints, weights, and safe motion
  controls; render frames through deterministic 2D deformation.
- Export a looping GIF, transparent PNG frame sequence, and a portable project
  manifest.
- Keep v1 local-first while allowing a later F1-backed save flow.

**Non-goals**

- No prompt-to-image, image-to-image, or hidden image-generation request.
- No claim that one front-facing image can make a convincing full turn, reveal
  occluded limbs, or create arbitrary new poses.
- No multi-layer compositing, pose-sheet interpolation, or account-persisted
  project model in the first release.

## 3. User flow and boundaries

1. A user opens **Enhance → AniBuddy — Animate your character**.
2. Optional prompt assistant turns a short concept into a copyable prompt for an
   external image tool; it asks for one character, clean silhouette,
   consistent proportions, a transparent or removable background, and a chosen
   view/pose set.
3. The user uploads either one cut-out character or a pose sheet. Existing
   extraction/background-removal primitives prepare transparent assets.
4. AniBuddy asks its reasoning model to suggest an editable mesh and a limited
   animation template. The user can move joints, correct weights, and preview
   the loop.
5. A deterministic renderer deforms source pixels into each frame; the user
   exports GIF, PNG frames, and a JSON project manifest.

The animation is described consistently as **2D puppet animation**. V1 starts
with mostly front-facing, single-subject art and constrained loops (`idle`,
`bounce`, `wave`, `blink`). The UI warns before motions that are likely to
stretch a silhouette or expose empty regions.

## 4. Interfaces and data

AniBuddy has independent APIs under Enhance:

| Interface | Purpose |
|---|---|
| `POST /api/enhance/anibuddy/prompt` | Converts an idea into a copyable external-image prompt. |
| `POST /api/enhance/anibuddy/rig-analysis` | Receives a prepared transparent asset and returns proposed joints, mesh topology, weights, and supported animation templates. |

Both APIs use the established reasoning-model credit/BYOK path. They return
structured text/geometry only and are prohibited from calling image-generation
routes.

The browser owns the v1 `AniBuddyProject`: source asset references, extracted
pose assets when present, rig geometry, joint/weight edits, selected template,
timeline/FPS, composition settings, and output metadata. Exporting a manifest
makes the project portable and reopening it restores the editable state.

## 5. Phased tasks

**Phase 1 — Safe single-character AniBuddy** *(L)*
1. Add the AniBuddy route inside the Enhance shell with upload, preparation,
   project-state, and export UI.
2. Implement prompt assistance and rig analysis using existing credits/BYOK
   rules, with explicit non-generation labels and error handling.
3. Build editable mesh/joint/weight controls and deterministic canvas/WebGL
   deformation for limited templates.
4. Export GIF, transparent PNG frames, and the project manifest; keep all
   project state local.

**Phase 2 — Pose-sheet workflow** *(L)*
5. Feed uploaded pose sheets through extraction, frame review, and naming.
6. Let users sequence approved supplied poses with compatible mesh motion;
   never synthesize missing pose pixels.

**Phase 3 — Compositions and persistence** *(L, after F1)*
7. Allow optional existing sprite layers and controlled layer timelines.
8. Reuse Collections save/reopen infrastructure for authenticated projects and
   exports without replacing portable local manifests.

## 6. Risks & mitigations

- **Unrealistic animation expectations from a single image.** → Limit v1
  templates, show mesh distortion warnings, and clearly explain the 2D puppet
  boundary before export.
- **Bad AI rig suggestions.** → Treat analysis as a draft; all joints, weights,
  and template choices are editable and rendering never proceeds from a hidden
  model-generated frame.
- **Browser memory and GIF performance.** → Cap source/frame dimensions and
  duration; render progressively; offer PNG frames if GIF encoding fails.
- **IP and character rights.** → Require users to confirm they have rights to
  uploaded/external art; use fictional characters only as examples, not supplied
  assets.
- **Credit confusion.** → Separate reasoning costs from rendering, and show
  that local deformation/export consumes no image-generation credit.

## 7. Verification / definition of done

- A user can create a fox prompt, upload a single transparent fox, accept or
  edit a proposed rig, preview an idle/wave loop, and export GIF, PNG frames,
  and a reopenable manifest without image generation.
- A user can upload a pose sheet, review its extracted named frames, and export
  a sequence made only from supplied poses and deterministic deformation.
- Prompt and rig-analysis endpoints honour BYOK/credit authorization, while the
  deformation renderer works with no image-generation endpoint call.
- Large rotations and unsupported motions disclose visual limitations instead of
  implying that missing character views will be invented.

