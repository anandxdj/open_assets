/**
 * The product shot's script: what the editor picture shows at each moment, how
 * many times it plays, and when it stops. Pure functions, no DOM and no React,
 * so the whole sequence is unit tested. `ProductShotPlayer` is the only code
 * that turns a `Frame` into attribute changes.
 *
 * One loop is 8 seconds:
 *
 *   300 ms + 80 ms * i   box i draws in (the badge counts one more)
 *   1200 ms              the selection lands on the tile named asset_006
 *   1400 ms              asset_006 is renamed, 30 ms per character
 *   2400 / 3600 / 4800   the selection moves to the next tile
 *   6000 ms              it reaches iron_sword, the frame the page is
 *                        rendered with, and holds there until 8000 ms
 *
 * After `MAX_LOOPS` loops it rests on that last frame.
 */

export const TILE_COUNT = 8;

/** Length of one loop. */
export const LOOP_MS = 8000;
/** The animation plays this many times, then rests on the final frame. */
export const MAX_LOOPS = 3;

/** First box starts drawing. */
export const BOX_START_MS = 300;
/** Gap between one box starting and the next. */
export const BOX_STAGGER_MS = 80;
/** How long one box takes to fade and scale in (a CSS transition). */
export const BOX_DRAW_MS = 240;

/** The selection moves to the next tile this often. */
export const SELECT_EVERY_MS = 1200;
/** When the first tile is selected. */
export const SELECT_START_MS = 1200;
/** Tile indexes in the order they are selected: asset_006 first, ending on iron_sword. */
export const SELECTION_ORDER = [5, 6, 7, 0, 1] as const;

/** The tile that is renamed, and what it is called before and after. */
export const RENAME_TILE = 5;
export const RENAME_FROM = "asset_006";
export const RENAME_TO = "knight_shield";
/** The rename starts this long after the tile is selected. */
export const RENAME_DELAY_MS = 200;
export const RENAME_START_MS = SELECT_START_MS + RENAME_DELAY_MS;
/** Type-on speed. */
export const CHAR_MS = 30;

export type Frame = {
  /** Boxes drawn so far, 0 to 8. The badge shows the same number. */
  shown: number;
  /** Selected tile index, or -1 before the first selection. */
  selected: number;
  /** Characters of the new name typed so far, or -1 while the old name still shows. */
  typed: number;
};

export function frameAt(t: number): Frame {
  const time = Math.max(0, Math.min(t, LOOP_MS));
  const shown =
    time < BOX_START_MS ? 0 : Math.min(TILE_COUNT, Math.floor((time - BOX_START_MS) / BOX_STAGGER_MS) + 1);
  const hops = time < SELECT_START_MS ? 0 : Math.floor((time - SELECT_START_MS) / SELECT_EVERY_MS) + 1;
  const selected = hops === 0 ? -1 : SELECTION_ORDER[Math.min(hops, SELECTION_ORDER.length) - 1];
  const typed =
    time < RENAME_START_MS ? -1 : Math.min(RENAME_TO.length, Math.floor((time - RENAME_START_MS) / CHAR_MS) + 1);
  return { shown, selected, typed };
}

/** The last frame of a loop; the page is server-rendered with it. */
export const FINAL_FRAME: Frame = frameAt(LOOP_MS);

export function sameFrame(a: Frame, b: Frame): boolean {
  return a.shown === b.shown && a.selected === b.selected && a.typed === b.typed;
}

/** The name shown on the renamed tile for a frame. */
export function renameText(typed: number): string {
  return typed < 0 ? RENAME_FROM : RENAME_TO.slice(0, typed);
}

/** Every moment in a loop at which the frame changes, ascending. */
export const CHANGE_TIMES: readonly number[] = (() => {
  const times = new Set<number>([0]);
  for (let i = 0; i < TILE_COUNT; i++) times.add(BOX_START_MS + i * BOX_STAGGER_MS);
  for (let k = 0; k < SELECTION_ORDER.length; k++) times.add(SELECT_START_MS + k * SELECT_EVERY_MS);
  for (let c = 0; c < RENAME_TO.length; c++) times.add(RENAME_START_MS + c * CHAR_MS);
  return [...times].filter((n) => n <= LOOP_MS).sort((a, b) => a - b);
})();

export type Position = {
  /** 0-based loop number. */
  loop: number;
  /** Milliseconds into that loop. */
  t: number;
  /** True once every loop has played; `t` is then the end of the last one. */
  done: boolean;
};

/** Where `playedMs` of running time lands: which loop, how far in, and whether it is over. */
export function locate(playedMs: number, loops: number = MAX_LOOPS): Position {
  const played = Math.max(0, playedMs);
  if (played >= LOOP_MS * loops) return { loop: loops - 1, t: LOOP_MS, done: true };
  return { loop: Math.floor(played / LOOP_MS), t: played % LOOP_MS, done: false };
}

/** Milliseconds of running time until the picture next changes, or null when it is over. */
export function msUntilNextChange(playedMs: number, loops: number = MAX_LOOPS): number | null {
  const at = locate(playedMs, loops);
  if (at.done) return null;
  const next = CHANGE_TIMES.find((time) => time > at.t) ?? LOOP_MS;
  return next - at.t;
}

export type RunInputs = {
  /** The visitor pressed Pause. */
  userPaused: boolean;
  /** The shot is scrolled out of view. */
  offscreen: boolean;
  /** The tab is in the background. */
  hidden: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** All loops have played. */
  finished: boolean;
};

/** Whether the clock should be running. Any one reason is enough to stop it. */
export function shouldRun(input: RunInputs): boolean {
  return !(input.userPaused || input.offscreen || input.hidden || input.reducedMotion || input.finished);
}

export type Control = "pause" | "play" | "replay";

/** What the visible button offers. Off-screen and hidden-tab pauses are automatic and not shown. */
export function controlFor(input: Pick<RunInputs, "userPaused" | "finished">): Control {
  if (input.finished) return "replay";
  return input.userPaused ? "play" : "pause";
}

/** The button's accessible name. */
export const CONTROL_LABEL: Record<Control, string> = {
  pause: "Pause animation",
  play: "Play animation",
  replay: "Replay animation",
};

/** The word shown on the button; the accessible name above contains it (WCAG 2.5.3). */
export const CONTROL_VERB: Record<Control, string> = {
  pause: "Pause",
  play: "Play",
  replay: "Replay",
};
