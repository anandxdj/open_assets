/**
 * Decision logic for the theme reveal: the new theme grows as a circle from the
 * place the person clicked (ThemeToggle, globals.css). Kept free of the DOM so
 * it can be unit tested.
 */

/** Reveal only when the browser can do it and the person has not asked for less motion. */
export function shouldRevealTheme({ hasViewTransitions, reducedMotion }: { hasViewTransitions: boolean; reducedMotion: boolean }): boolean {
  return hasViewTransitions && !reducedMotion;
}

export type Rect = { left: number; top: number; width: number; height: number };

export type RevealGeometry = {
  /** Circle centre, in viewport pixels. */
  x: number;
  y: number;
  /** Radius that reaches the farthest corner of the viewport. */
  r: number;
};

/**
 * Where the circle starts and how far it must grow.
 *
 * A pointer click starts at the pointer. A keyboard activation (Enter or Space
 * on a button reports `detail` 0 and no real coordinates) starts at the centre
 * of the control, so the reveal still comes from the thing that was pressed.
 */
export function revealGeometry({
  pointer,
  target,
  viewport,
}: {
  /** Coordinates and `detail` of the click event; null when there was no event. */
  pointer: { clientX: number; clientY: number; detail: number } | null;
  /** The toggle's bounding box. */
  target: Rect;
  viewport: { width: number; height: number };
}): RevealGeometry {
  const fromPointer = pointer !== null && pointer.detail > 0;
  const x = fromPointer ? pointer.clientX : target.left + target.width / 2;
  const y = fromPointer ? pointer.clientY : target.top + target.height / 2;
  const r = Math.hypot(Math.max(x, viewport.width - x), Math.max(y, viewport.height - y));
  return { x, y, r };
}
