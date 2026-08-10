# F10 — Background-Aware Asset Detection

> **Theme B · Make the foundation real.** Prevent opaque sprite sheets with dark,
> black, or non-white canvases from being detected as one full-image asset.
>
> **Priority:** P1 · **Effort:** M · **Depends on:** None.

---

## Problem

The original Python detector used one inverse grayscale threshold intended for a
white background. On a black sheet, that mask marks the black canvas as
foreground, connecting every sprite into a full-sheet contour.

## Design

- Build multiple temporary masks from the original source: alpha, bright-on-dark,
  dark-on-light, sampled border-colour distance, and adaptive threshold.
- Score candidates by valid box count, foreground coverage, border coverage, and
  full-sheet-contour penalties; persist the best mode and confidence with the job.
- Return a warning instead of failing the job when no trustworthy boxes are
  found, so users can still use the editor.
- Add authenticated re-detection against the stored original image with Auto,
  dark, light, and custom-colour background modes. Existing draw/edit/delete box
  controls remain the final fallback.

## Verification

- Dark-background sheets with bright or coloured sprites produce separate boxes.
- Light-background sheets and transparent PNGs retain their expected detection
  behavior.
- A full-sheet or empty result opens the editor with a recovery warning, not a
  terminal job failure.
- Re-detection changes boxes and detection metadata only; it does not re-upload
  or alter the source image.
