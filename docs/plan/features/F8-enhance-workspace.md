# F8 — Enhance Workspace

> **Theme D · Refine existing artwork.** Add a top-level **Enhance** workspace for
> improving user-supplied images without sending them through Studio's image-
> generation pipeline.
>
> **Priority:** P1 · **Effort:** L (ship Excalibur first; Cloudinary enhancement
> follows) · **Depends on:** F3 only for provider-neutral capability reporting.

---

## 1. Problem

OpenAssets has a strong extraction flow and a generation-focused Studio, but no
home for users who already have an asset and simply want to improve it. A sparse
line-art asset — for example an Excalibur-style sword drawing with outlines and
labels but no rendered surface — should be polishable without asking an image
model to invent a new asset.

Studio is not the right place for this work. Its five tools, model settings, and
credit language are about generating imagery. Combining those concerns would
make the product harder to understand and would blur the promise that refinement
can preserve an existing design.

## 2. Goals / non-goals

**Goals**

- Add **Enhance** beside Upload, My Collections, Browse, and Studio in global
  navigation, with its own `/enhance` route group and shell.
- Give users one landing page that clearly separates three jobs: deterministic
  line-art enhancement, Cloudinary-backed AI enhancement, and AniBuddy
  animation (specified separately in F9).
- Preserve source pixels and make every result reproducible from a saved
  transformation recipe.
- Expose Cloudinary functionality only when it is both configured and enabled
  for the active account.

**Non-goals**

- Do not add an image-generation model, prompt-to-image action, or Studio mode.
- Do not promise a provider-neutral AI feature set while ImageKit parity is
  unresolved (F3).
- Do not turn Enhance into a general raster editor; it is a focused pipeline
  with clear presets and adjustments.

## 3. Product design

### 3.1 Workspace and routes

`/enhance` is a tool picker, not a Studio tab. It contains three cards:

| Tool | User-facing promise | Route |
|---|---|---|
| **Excalibur Enhance** | Polish outline artwork | `/enhance/excalibur` |
| **AI Enhance** | Improve with Cloudinary | `/enhance/ai` |
| **AniBuddy** | Animate your character | `/enhance/anibuddy` |

The first two tools share an input rail, before/after comparison, parameter
panel, and export bar. AniBuddy owns a separate animation workspace under the
same Enhance shell. Enhancing operations require sign-in, so uploads, provider
work, usage tracking, and later collection saving have a consistent owner.

### 3.2 Excalibur Enhance — deterministic path

This path is for line-art, sparse iconography, diagrams, and low-detail art
whose identity must remain under the user's control. It uses deterministic,
server-side image processing rather than image generation.

The baseline pipeline offers these independently adjustable operations:

1. Decode safely, normalize orientation and color, then preserve alpha.
2. Reduce noise; repair small breaks in outlines; smooth jagged edges while
   keeping intentional hard corners selectable.
3. Improve contrast and line visibility; provide white, dark, transparent, and
   custom background treatments.
4. Apply controlled flat fills or palette styling to enclosed regions; never
   infer unbounded new objects, texture, or scenery.
5. Restore resolution with a deterministic upscale/sharpen pass and export PNG.

The UI must offer a reset-to-original control, a side-by-side or draggable
before/after comparison, and presets such as `Clean outline`, `Dark display`,
and `Flat-color asset`. A recipe records the operation order and parameter
values, so the same result can be recreated.

### 3.3 AI Enhance — Cloudinary capability path

AI Enhance is a Cloudinary-backed enhancement surface, not a promise of a
specific model. On load, the client requests server-authoritative capabilities.
The UI renders only operations supported by the configured Cloudinary account,
such as enabled upscale, restoration, background removal, or other configured
AI transformations.

Every operation must display a plain-language description, cost/credit behavior
if any, and the outcome if Cloudinary rejects or lacks the transformation. The
backend owns Cloudinary credentials and generates/executes transformations; the
browser never receives provider secrets. If `STORAGE_PROVIDER=imagekit` is
active, Cloudinary-only controls are unavailable with an explanation rather than
failing after upload. F3 can later broaden the capability contract to ImageKit.

## 4. Interfaces and data

The implementation adds an Enhance-specific contract rather than extending
Studio's generation APIs:

| Interface | Purpose |
|---|---|
| `GET /api/enhance/capabilities` | Returns active provider, availability, and supported AI-enhancement operations. |
| `POST /api/enhance/excalibur` | Accepts a source asset plus deterministic recipe and returns an enhanced asset and canonical recipe. |
| `POST /api/enhance/ai` | Accepts an allowed Cloudinary operation and parameters; validates capability and returns the transformed asset and recipe. |

An `EnhancementRecipe` stores `tool`, source asset reference, ordered operations,
parameters, active provider, and output metadata. Results remain downloadable as
PNG. Saving to Collections is deliberately deferred to F1's shared save flow.

## 5. Phased tasks

**Phase 1 — Workspace + Excalibur path** *(M)*
1. Add the global Enhance navigation item, route group, auth guard, landing
   cards, and common before/after/export components.
2. Add safe image ingest and deterministic Excalibur processing through the
   existing Python/OpenCV-capable image service.
3. Ship presets, adjustable operations, recipe output, and PNG export.

**Phase 2 — Cloudinary AI Enhance** *(M)*
4. Add the capability endpoint and Cloudinary account/configuration checks.
5. Implement the supported Cloudinary operations with provider-owned credentials,
   recipe recording, actionable errors, and usage accounting where applicable.
6. Keep unsupported and non-Cloudinary configurations visibly unavailable.

**Phase 3 — Bridge to saved work** *(S, after F1)*
7. Reuse F1's Save to Collection flow for enhanced outputs and recipes.

## 6. Risks & mitigations

- **“AI enhancement” becomes an unbounded promise.** → Treat the capability
  response as the source of truth and document the account-dependent feature
  matrix in the UI.
- **Deterministic processing looks like weak generation.** → Focus copy and
  presets on line preservation, cleanup, and controlled styling; show the
  source comparison continuously.
- **Provider drift.** → Keep capability validation on the server and record the
  provider in every recipe.
- **Large or malicious images.** → Reuse existing upload dimension, type, and
  SSRF protections before decoding or forwarding to a provider.

## 7. Verification / definition of done

- An outline-only sword can be cleaned, filled, placed on a light or dark
  background, upscaled, compared to its source, and exported without any image
  generation request.
- Replaying an Excalibur recipe produces the same deterministic output.
- Cloudinary-enabled operations are available only when the server reports them;
  disabled operations and ImageKit configurations fail safely and explain why.
- Existing Studio routes and image-generation settings remain absent from
  Enhance.

