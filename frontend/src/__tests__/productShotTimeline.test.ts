import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOX_START_MS,
  BOX_STAGGER_MS,
  CHANGE_TIMES,
  CHAR_MS,
  controlFor,
  FINAL_FRAME,
  frameAt,
  locate,
  LOOP_MS,
  MAX_LOOPS,
  msUntilNextChange,
  RENAME_FROM,
  RENAME_START_MS,
  RENAME_TILE,
  RENAME_TO,
  renameText,
  sameFrame,
  SELECT_EVERY_MS,
  SELECT_START_MS,
  SELECTION_ORDER,
  shouldRun,
  TILE_COUNT,
  type RunInputs,
} from "../components/landing/productShotTimeline";

const RUNNING: RunInputs = { userPaused: false, offscreen: false, hidden: false, reducedMotion: false, finished: false };

test("a loop is 8 seconds and plays 3 times", () => {
  assert.equal(LOOP_MS, 8000);
  assert.equal(MAX_LOOPS, 3);
});

test("the first frame is empty", () => {
  assert.deepEqual(frameAt(0), { shown: 0, selected: -1, typed: -1 });
  assert.deepEqual(frameAt(BOX_START_MS - 1), { shown: 0, selected: -1, typed: -1 });
});

test("boxes draw in one by one, 80ms apart", () => {
  assert.equal(frameAt(BOX_START_MS).shown, 1);
  assert.equal(frameAt(BOX_START_MS + BOX_STAGGER_MS - 1).shown, 1);
  assert.equal(frameAt(BOX_START_MS + BOX_STAGGER_MS).shown, 2);
  assert.equal(frameAt(BOX_START_MS + 7 * BOX_STAGGER_MS).shown, TILE_COUNT);
  assert.equal(frameAt(LOOP_MS).shown, TILE_COUNT);
  for (let t = 0; t < LOOP_MS; t += 10) assert.ok(frameAt(t + 10).shown >= frameAt(t).shown);
});

test("all boxes are drawn before the first selection", () => {
  assert.ok(BOX_START_MS + (TILE_COUNT - 1) * BOX_STAGGER_MS < SELECT_START_MS);
});

test("the selection moves to the next tile every 1.2 seconds", () => {
  assert.equal(SELECT_EVERY_MS, 1200);
  assert.equal(frameAt(SELECT_START_MS - 1).selected, -1);
  SELECTION_ORDER.forEach((tile, k) => {
    const at = SELECT_START_MS + k * SELECT_EVERY_MS;
    assert.equal(frameAt(at).selected, tile);
    assert.equal(frameAt(at + SELECT_EVERY_MS - 1).selected, tile);
  });
  // Each step is the next tile, wrapping from the last one to the first.
  for (let k = 1; k < SELECTION_ORDER.length; k++) {
    assert.equal(SELECTION_ORDER[k], (SELECTION_ORDER[k - 1] + 1) % TILE_COUNT);
  }
});

test("asset_006 is selected first, then renamed at 30ms per character", () => {
  assert.equal(SELECTION_ORDER[0], RENAME_TILE);
  assert.ok(RENAME_START_MS > SELECT_START_MS);
  assert.equal(frameAt(RENAME_START_MS - 1).typed, -1);
  assert.equal(renameText(-1), RENAME_FROM);
  assert.equal(frameAt(RENAME_START_MS).typed, 1);
  assert.equal(frameAt(RENAME_START_MS + CHAR_MS).typed, 2);
  assert.equal(renameText(frameAt(RENAME_START_MS + 4 * CHAR_MS).typed), "knigh");
  const done = RENAME_START_MS + (RENAME_TO.length - 1) * CHAR_MS;
  assert.equal(frameAt(done).typed, RENAME_TO.length);
  assert.equal(renameText(frameAt(done).typed), RENAME_TO);
  assert.equal(frameAt(LOOP_MS).typed, RENAME_TO.length);
});

test("the rename is finished before the selection leaves the tile", () => {
  const done = RENAME_START_MS + RENAME_TO.length * CHAR_MS;
  assert.ok(done < SELECT_START_MS + SELECT_EVERY_MS);
});

test("the final frame is the one the page is rendered with: iron_sword selected, all eight found", () => {
  assert.deepEqual(FINAL_FRAME, { shown: 8, selected: 1, typed: RENAME_TO.length });
  assert.equal(renameText(FINAL_FRAME.typed), "knight_shield");
  // It holds for the rest of the loop.
  const last = SELECT_START_MS + (SELECTION_ORDER.length - 1) * SELECT_EVERY_MS;
  assert.ok(last < LOOP_MS);
  assert.ok(sameFrame(frameAt(last), FINAL_FRAME));
  assert.ok(sameFrame(frameAt(LOOP_MS - 1), FINAL_FRAME));
});

test("frameAt clamps times outside the loop", () => {
  assert.ok(sameFrame(frameAt(-50), frameAt(0)));
  assert.ok(sameFrame(frameAt(LOOP_MS * 5), FINAL_FRAME));
});

test("change times are sorted, inside the loop, and every frame change is one of them", () => {
  assert.equal(CHANGE_TIMES[0], 0);
  for (let i = 1; i < CHANGE_TIMES.length; i++) assert.ok(CHANGE_TIMES[i] > CHANGE_TIMES[i - 1]);
  assert.ok(CHANGE_TIMES.every((t) => t >= 0 && t <= LOOP_MS));
  const set = new Set(CHANGE_TIMES);
  for (let t = 1; t <= LOOP_MS; t++) {
    if (!sameFrame(frameAt(t), frameAt(t - 1))) assert.ok(set.has(t), `frame changes at ${t}`);
  }
});

test("locate maps running time to a loop and a position", () => {
  assert.deepEqual(locate(0), { loop: 0, t: 0, done: false });
  assert.deepEqual(locate(2500), { loop: 0, t: 2500, done: false });
  assert.deepEqual(locate(LOOP_MS), { loop: 1, t: 0, done: false });
  assert.deepEqual(locate(LOOP_MS * 2 + 100), { loop: 2, t: 100, done: false });
  assert.deepEqual(locate(-10), { loop: 0, t: 0, done: false });
});

test("it rests on the final frame after the third loop", () => {
  const end = LOOP_MS * MAX_LOOPS;
  assert.equal(locate(end - 1).done, false);
  assert.deepEqual(locate(end), { loop: 2, t: LOOP_MS, done: true });
  assert.deepEqual(locate(end + 99999), { loop: 2, t: LOOP_MS, done: true });
  assert.ok(sameFrame(frameAt(locate(end).t), FINAL_FRAME));
});

test("the loop cap can be set", () => {
  assert.equal(locate(LOOP_MS, 1).done, true);
  assert.equal(locate(LOOP_MS, 2).done, false);
});

test("msUntilNextChange steps through the loop and across its end", () => {
  assert.equal(msUntilNextChange(0), BOX_START_MS);
  assert.equal(msUntilNextChange(BOX_START_MS), BOX_STAGGER_MS);
  assert.equal(msUntilNextChange(BOX_START_MS + 10), BOX_STAGGER_MS - 10);
  // Past the last change the next one is the loop restarting.
  const last = CHANGE_TIMES[CHANGE_TIMES.length - 1];
  assert.equal(msUntilNextChange(last), LOOP_MS - last);
  assert.equal(msUntilNextChange(LOOP_MS - 1), 1);
  // Second loop behaves like the first.
  assert.equal(msUntilNextChange(LOOP_MS), BOX_START_MS);
  assert.equal(msUntilNextChange(LOOP_MS * MAX_LOOPS), null);
});

test("msUntilNextChange is always positive until the end", () => {
  for (let p = 0; p < LOOP_MS * MAX_LOOPS; p += 7) {
    const ms = msUntilNextChange(p);
    assert.ok(ms !== null && ms > 0 && ms <= LOOP_MS);
  }
});

test("it runs only when nothing asks it to stop", () => {
  assert.equal(shouldRun(RUNNING), true);
});

test("each reason alone stops it", () => {
  assert.equal(shouldRun({ ...RUNNING, userPaused: true }), false);
  assert.equal(shouldRun({ ...RUNNING, offscreen: true }), false);
  assert.equal(shouldRun({ ...RUNNING, hidden: true }), false);
  assert.equal(shouldRun({ ...RUNNING, reducedMotion: true }), false);
  assert.equal(shouldRun({ ...RUNNING, finished: true }), false);
});

test("the button offers pause, play or replay", () => {
  assert.equal(controlFor({ userPaused: false, finished: false }), "pause");
  assert.equal(controlFor({ userPaused: true, finished: false }), "play");
  assert.equal(controlFor({ userPaused: false, finished: true }), "replay");
  assert.equal(controlFor({ userPaused: true, finished: true }), "replay");
});
