import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiUnavailableReason,
  describeBackground,
  keyerMayRun,
  plannedMethod,
  readBackgroundCapabilities,
  type BackgroundCapabilities,
} from "../features/editor/lib/backgroundRemoval";
import type { SheetBackground } from "../types";

const WITH_AI: BackgroundCapabilities = { server: true, ai: true, aiProvider: "Cloudinary" };
const NO_AI: BackgroundCapabilities = { server: true, ai: false, aiProvider: null };
const WHITE: SheetBackground = { kind: "flat", color: "#ffffff" };
const GREEN: SheetBackground = { kind: "chroma", color: "#00ff00" };
const COMPLEX: SheetBackground = { kind: "complex" };
const CLEAR: SheetBackground = { kind: "transparent" };

test("status line: each classification says what will happen", () => {
  assert.equal(describeBackground(WHITE, "auto", WITH_AI).text, "White background (#FFFFFF): removed on our server, free.");
  assert.equal(describeBackground(WHITE, "auto", NO_AI).text, "White background (#FFFFFF): removed on our server, free.");
  assert.equal(describeBackground(GREEN, "auto", WITH_AI).text, "Chroma-key background (#00FF00): removed on our server, free.");
  assert.equal(describeBackground({ kind: "flat", color: "#f4e4c8" }, "auto", WITH_AI).text, "Flat colour background (#F4E4C8): removed on our server, free.");
  assert.equal(describeBackground({ kind: "flat", color: "#000000" }, "auto", WITH_AI).text, "Black background (#000000): removed on our server, free.");
  assert.equal(describeBackground(COMPLEX, "auto", WITH_AI).text, "Gradient or textured background: AI removal (uses Cloudinary credits).");
  assert.equal(
    describeBackground(COMPLEX, "auto", NO_AI).text,
    "Gradient or textured background. AI removal is not available on this server; the background will be kept.",
  );
  assert.equal(describeBackground(CLEAR, "auto", WITH_AI).text, "Already transparent.");
  assert.equal(describeBackground(undefined, "auto", WITH_AI).tone, "note");
  assert.equal(describeBackground(WHITE, "auto", null).text, "Checking what this server can do.");
});

test("status line follows the chosen mode", () => {
  assert.match(describeBackground(WHITE, "none", WITH_AI).text, /kept as it is/);
  assert.match(describeBackground(COMPLEX, "flat", WITH_AI).text, /not one plain colour, so it will be kept/);
  assert.match(describeBackground(WHITE, "ai", WITH_AI).text, /AI removal \(uses Cloudinary credits\)/);
  assert.match(describeBackground(WHITE, "ai", NO_AI).text, /AI removal is not available on this server/);
  assert.equal(describeBackground(CLEAR, "ai", WITH_AI).text, "Already transparent.");
  assert.match(describeBackground(COMPLEX, "auto", { server: true, ai: true, aiProvider: "ImageKit" }).text, /uses ImageKit credits/);
});

test("planned method mirrors the server routing", () => {
  assert.equal(plannedMethod(WHITE, "auto", WITH_AI), "server");
  assert.equal(plannedMethod(GREEN, "flat", NO_AI), "server");
  assert.equal(plannedMethod(COMPLEX, "auto", WITH_AI), "ai");
  assert.equal(plannedMethod(COMPLEX, "auto", NO_AI), "none");
  assert.equal(plannedMethod(COMPLEX, "flat", WITH_AI), "none");
  assert.equal(plannedMethod(WHITE, "ai", WITH_AI), "ai");
  assert.equal(plannedMethod(WHITE, "ai", NO_AI), "none");
  assert.equal(plannedMethod(WHITE, "none", WITH_AI), "none");
  assert.equal(plannedMethod(CLEAR, "flat", WITH_AI), "none");
  assert.equal(plannedMethod(undefined, "auto", WITH_AI), "unknown");
});

test("the enclosed-background switch shows whenever the server keyer will run, on any provider", () => {
  for (const caps of [WITH_AI, NO_AI]) {
    assert.equal(keyerMayRun(WHITE, "auto", caps), true);
    assert.equal(keyerMayRun(GREEN, "flat", caps), true);
    assert.equal(keyerMayRun(undefined, "auto", caps), true, "an unclassified sheet may be keyed");
    assert.equal(keyerMayRun(COMPLEX, "auto", caps), false);
    assert.equal(keyerMayRun(WHITE, "none", caps), false);
    assert.equal(keyerMayRun(CLEAR, "auto", caps), false);
  }
  assert.equal(keyerMayRun(WHITE, "ai", WITH_AI), false, "AI ignores the switch");
  assert.equal(keyerMayRun(WHITE, "auto", null), false, "hidden until the plan has loaded");
});

test("AI is disabled with a reason when the server has none, and while the plan loads", () => {
  assert.equal(aiUnavailableReason(WITH_AI), null);
  assert.equal(aiUnavailableReason(NO_AI), "Not available on this server.");
  assert.match(aiUnavailableReason(null) ?? "", /Checking/);
});

test("capabilities from an older server map to the same facts", () => {
  assert.deepEqual(readBackgroundCapabilities(undefined), null);
  assert.deepEqual(readBackgroundCapabilities({ backgroundRemoval: WITH_AI }), WITH_AI);
  assert.deepEqual(readBackgroundCapabilities({ enclosedBackground: true, aiUpscale: false }), { server: true, ai: false, aiProvider: null });
  assert.deepEqual(readBackgroundCapabilities({ enclosedBackground: false, aiUpscale: true }), { server: false, ai: true, aiProvider: null });
});
