# Custom naming patterns

Pro accounts (`customNamingPatterns`) choose how exported files are named with a
pattern. Everyone else always gets the default pattern, `{name}`, which gives the
names exports had before patterns existed: the AI name (or the name you gave the
asset), cleaned for a file name, with `_2`, `_3` on duplicates.

## The pattern language

A pattern is literal text plus tokens in braces.

| Token | Is | Example |
|---|---|---|
| `{name}` | the asset name | `fire_sword` |
| `{index}` | position in this export, from 1 | `1` |
| `{index:03}` | the same, zero-padded (any width 1 to 8) | `001` |
| `{sheet}` | the source file name, without its extension | `sprites` |
| `{w}` `{h}` | width and height in px of the exported image (after upscaling) | `128` `96` |
| `{scale}` | upscale factor: 1 (not upscaled), 2 or 4 | `2` |
| `{date}` | export date, `YYYY-MM-DD`, UTC | `2026-03-15` |

```
{name}                      fire_sword.png                 (default)
{sheet}_{index:03}_{name}   sprites_001_fire_sword.png
{name}@{scale}x             fire_sword@2x.png
icon-{index}-{w}x{h}        icon-1-128x96.png
```

Rules:

- 1 to 100 characters, trimmed. Must contain `{name}` or `{index}`, so names differ.
- Unknown tokens, unmatched braces and bad formats are errors. There is no escaping:
  braces are for tokens only. Tokens are case-sensitive.
- No `/` or `\` (file names are flat) and no control characters.
- Every token value is cleaned the way names always were: anything other than
  letters, digits, `-` and `_` becomes `_` (runs collapse), at most 80 characters,
  empty becomes `asset` (`sheet` for `{sheet}`).
- The finished name keeps only letters, digits and `- _ . @`; anything else becomes
  `_`. Runs of dots collapse, leading and trailing dots go, and it is cut to 120
  characters before `.png` is added.
- Names that still collide get `_2`, `_3` in order. Comparison is exact (case
  sensitive), as it has always been, so the same input always gives the same output.

## One module, two copies

`backend/src/modules/naming/pattern.ts` is pure (no imports). `frontend/src/lib/naming/pattern.ts`
is a byte-for-byte copy used for the live preview; a backend test fails when they
differ, and another runs both on the same inputs. Change both together
(`cp backend/src/modules/naming/pattern.ts frontend/src/lib/naming/pattern.ts`).

The function other code calls:

```ts
applyNamingPattern(pattern, items: { name, width?, height? }[], { sheet?, scale?, date? })
  // { ok: true, pattern, stems, fileNames } | { ok: false, issues }
```

`nameExportAssets` (`modules/naming/exportNames.ts`) wraps it for a job: it takes the
selected assets, the job's boxes and sheet size, works out each crop's size (times
the upscale factor) and throws 400 `INVALID_PATTERN` for a bad pattern.

## Who applies it

The server applies and enforces the pattern; the web app only previews it.

| Where | How |
|---|---|
| `POST /api/finalize` | takes `namingPattern`; the worker sets `file_name` on every selected asset (`processFinalize`), and the web app zips the upscaled set with those names |
| `POST /api/jobs/:jobId/export-names` | `{ selectedIds?, namingPattern? }` gives `{ pattern, scale, files: [{ id, name, stem, fileName }] }`; the web app uses it for the plain (not upscaled) ZIP when the pattern is not the default |
| `POST /api/collections/:id/folders/:folderId/images` | takes `namingPattern`; the saved image names are the pattern's file names (no `.png`). The default pattern keeps each asset's name untouched, as before |

A pattern that is not the default needs the entitlement: 403 `PLAN_REQUIRED`
(`details.entitlement: "customNamingPatterns"`). An invalid pattern is 400
`INVALID_PATTERN` with `details.issues`. A request without a pattern uses the saved
default for Pro and the default pattern for everyone else, so a lapsed Pro account
never gets a stored pattern applied.

## The saved default

A user preference, `exportNamingPattern` on the user.

| Method | Path | |
|---|---|---|
| GET | `/api/preferences/export` | `{ namingPattern, savedPattern }`: what exports use, and what is stored |
| PUT | `/api/preferences/export` | `{ namingPattern: string \| null }`; `null` or `{name}` clears it (allowed on any plan), anything else needs Pro |

It pre-fills the Naming control on the export screen, and is edited under Settings,
Export.

## Not covered

The editor's one-click "raw" export (`exportBoxesAsZip`) cuts boxes in the browser
with no server round trip, so it keeps its own box-label names.
