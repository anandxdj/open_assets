/**
 * Decisions behind the scroll-in reveal (components/marketing/Reveal.tsx). No DOM here, so it is unit-tested.
 *
 * The server HTML is always visible. After hydration a block is marked pending only when that is safe and
 * useful: the browser can observe scrolling, the visitor has not asked for less motion, the block is below the
 * fold at that moment, and nothing (a hash link) is pointing at it.
 */

/** IntersectionObserver options: a block reveals once 15% of it is above the bottom 10% of the viewport. */
export const REVEAL_THRESHOLD = 0.15;
export const REVEAL_ROOT_MARGIN = "0px 0px -10% 0px";

/** Blocks that reveal together stagger over at most 4 steps of 60ms (0, 60, 120, 180ms). */
export const REVEAL_MAX_STEPS = 4;
export const REVEAL_STEP_MS = 60;

/** The reveal may arm only where it can observe scrolling and motion is allowed. */
export function canArmReveal(env: { hasObserver: boolean; reducedMotion: boolean }): boolean {
  return env.hasObserver && !env.reducedMotion;
}

/** Stagger step of the n-th block revealed in one batch: 0..REVEAL_MAX_STEPS-1, then it stops growing. */
export function staggerStep(position: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.min(Math.floor(position), REVEAL_MAX_STEPS - 1);
}

/** Delay in ms for a stagger step. */
export function staggerDelayMs(position: number): number {
  return staggerStep(position) * REVEAL_STEP_MS;
}

/**
 * Whether a block starts pending. `top` and `bottom` are its viewport-relative edges at load.
 * Anything touching or above the viewport (the hero, a restored scroll position) stays visible, and so does
 * a block that is, contains or sits inside the target of the page's hash or of a hash link just followed.
 */
export function startsPending(input: {
  armed: boolean;
  top: number;
  bottom: number;
  viewportHeight: number;
  relatedToHashTarget: boolean;
}): boolean {
  if (!input.armed) return false;
  if (input.relatedToHashTarget) return false;
  if (input.bottom <= 0) return false;
  if (input.top < input.viewportHeight) return false;
  return true;
}

/**
 * The element a hash link points at, as far as the reveal cares: `#main-content` (the skip link) names the
 * whole page and must not reveal everything, so anything that is not a specific section is ignored.
 */
export function isRevealTarget(tagName: string | null | undefined): boolean {
  if (!tagName) return false;
  const tag = tagName.toLowerCase();
  return tag !== "main" && tag !== "body" && tag !== "html";
}
