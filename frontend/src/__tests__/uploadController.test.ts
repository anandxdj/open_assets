import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createUploadController,
  INITIAL_UPLOAD_STATE,
  isBusy,
  isCancellable,
  type UploadDeps,
  type UploadState,
} from "../features/upload/lib/uploadController";
import { UploadAbortedError } from "../features/upload/lib/uploadErrors";

/** A File stand-in: the controller only reads name and size. */
function fakeFile(name = "sheet.png", size = 1234): File {
  return { name, size } as unknown as File;
}

interface Harness {
  controller: ReturnType<typeof createUploadController>;
  states: UploadState[];
  navigated: string[];
  sends: { file: File; signal: AbortSignal; progress: (fraction: number) => void; resolve: (jobId: string) => void; reject: (err: unknown) => void }[];
  previews: { created: string[]; revoked: string[] };
}

/** A controller whose network is a list of pending requests the test settles by hand. */
function harness(overrides: Partial<UploadDeps> = {}): Harness {
  const states: UploadState[] = [];
  const navigated: string[] = [];
  const sends: Harness["sends"] = [];
  const previews = { created: [] as string[], revoked: [] as string[] };
  const controller = createUploadController({
    send: (file, progress, signal) =>
      new Promise((resolve, reject) => {
        sends.push({ file, signal, progress, resolve: (jobId) => resolve({ jobId }), reject });
        // A real request rejects when its signal aborts.
        signal.addEventListener("abort", () => reject(new UploadAbortedError()), { once: true });
      }),
    onChange: (state) => states.push(state),
    onNavigate: (jobId) => navigated.push(jobId),
    createPreviewUrl: (file) => {
      const url = `blob:${file.name}:${previews.created.length}`;
      previews.created.push(url);
      return url;
    },
    revokePreviewUrl: (url) => previews.revoked.push(url),
    errorCode: (err) => (err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : null),
    ...overrides,
  });
  return { controller, states, navigated, sends, previews };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("starts idle, and cancel with nothing running does nothing", () => {
  const { controller, states } = harness();
  assert.deepEqual(controller.getState(), INITIAL_UPLOAD_STATE);
  assert.equal(controller.cancel(), false);
  assert.equal(states.length, 0);
  assert.equal(controller.getState().cancelled, false);
});

test("phase helpers: cancel works before every byte is sent, not after", () => {
  assert.deepEqual(
    (["idle", "preparing", "uploading", "processing", "success", "error"] as const).map(isCancellable),
    [false, true, true, false, false, false]
  );
  assert.deepEqual(
    (["idle", "preparing", "uploading", "processing", "success", "error"] as const).map(isBusy),
    [false, true, true, true, true, false]
  );
});

test("a chosen file starts the request in the same tick, with a preview and no progress", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile("a.png", 99));
  // The request is already out: there is no gap between "submit" and "network" to cancel into.
  assert.equal(h.sends.length, 1);
  assert.equal(h.controller.getState().status, "uploading");
  assert.deepEqual(h.controller.getState().file, { name: "a.png", size: 99, previewUrl: "blob:a.png:0" });
  h.sends[0].resolve("job1");
  await started;
  assert.equal(h.controller.getState().status, "success");
  assert.deepEqual(h.navigated, ["job1"]);
});

test("cancel right after submit aborts the request: no job, no error, no navigation", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  assert.equal(h.controller.cancel(), true);
  await started;
  assert.equal(h.sends[0].signal.aborted, true);
  const state = h.controller.getState();
  assert.equal(state.status, "idle");
  assert.equal(state.cancelled, true);
  assert.equal(state.error, null);
  assert.equal(state.errorCode, null);
  assert.equal(state.progress, 0);
  assert.equal(state.file, null);
  assert.deepEqual(h.navigated, []);
  assert.equal(h.states.some((s) => s.status === "error"), false, "a cancel never passes through error");
  assert.deepEqual(h.previews.revoked, h.previews.created, "the preview is freed");
});

test("cancel during the upload resets progress and frees the preview", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  h.sends[0].progress(0.4);
  assert.equal(h.controller.getState().progress, 40);
  assert.equal(h.controller.getState().status, "uploading");
  assert.equal(h.controller.cancel(), true);
  await started;
  assert.equal(h.controller.getState().status, "idle");
  assert.equal(h.controller.getState().progress, 0);
  assert.equal(h.controller.getState().cancelled, true);
  assert.deepEqual(h.navigated, []);
  assert.equal(h.previews.revoked.length, 1);
});

test("progress from a cancelled request is ignored", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  h.controller.cancel();
  h.sends[0].progress(0.9);
  h.sends[0].progress(1);
  await started;
  assert.equal(h.controller.getState().status, "idle");
  assert.equal(h.controller.getState().progress, 0);
});

test("a response that arrives after cancel is dropped", async () => {
  // A transport that cannot abort: the answer still comes back.
  const sends: { resolve: (jobId: string) => void }[] = [];
  const h = harness({
    send: () =>
      new Promise((resolve) => {
        sends.push({ resolve: (jobId) => resolve({ jobId }) });
      }),
  });
  const started = h.controller.start(fakeFile());
  h.controller.cancel();
  sends[0].resolve("late");
  await started;
  assert.deepEqual(h.navigated, []);
  assert.equal(h.controller.getState().status, "idle");
});

test("a new upload works right after a cancel, and only it navigates", async () => {
  const h = harness();
  const first = h.controller.start(fakeFile("one.png"));
  h.controller.cancel();
  await first;
  const second = h.controller.start(fakeFile("two.png"));
  assert.equal(h.sends.length, 2);
  assert.equal(h.controller.getState().cancelled, false, "starting again clears the cancelled flag");
  assert.equal(h.controller.getState().file?.name, "two.png");
  h.sends[1].progress(0.5);
  h.sends[1].resolve("job2");
  await second;
  assert.equal(h.controller.getState().status, "success");
  assert.deepEqual(h.navigated, ["job2"]);
});

test("cancelling twice is harmless", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  assert.equal(h.controller.cancel(), true);
  assert.equal(h.controller.cancel(), false);
  await started;
  assert.equal(h.controller.getState().status, "idle");
});

test("cancel while preparing: the loader result is dropped and nothing is ever sent", async () => {
  const h = harness();
  let release: (file: File) => void = () => {};
  let seenSignal: AbortSignal | undefined;
  const started = h.controller.start(
    (signal) => {
      seenSignal = signal;
      return new Promise<File>((resolve) => {
        release = resolve;
      });
    },
    { name: "sample.png" }
  );
  assert.equal(h.controller.getState().status, "preparing");
  assert.deepEqual(h.controller.getState().file, { name: "sample.png", size: 0, previewUrl: null });
  assert.equal(h.controller.cancel(), true);
  assert.equal(seenSignal?.aborted, true, "the loader is told to stop");
  release(fakeFile("sample.png"));
  await started;
  assert.equal(h.sends.length, 0, "no request was sent");
  assert.equal(h.previews.created.length, 0, "no preview was made");
  assert.equal(h.controller.getState().status, "idle");
  assert.equal(h.controller.getState().cancelled, true);
  assert.equal(h.controller.getState().error, null);
  assert.deepEqual(h.navigated, []);
});

test("preparing leads to uploading, then success", async () => {
  const h = harness();
  const started = h.controller.start(async () => fakeFile("made.png", 5), { name: "made.png" });
  assert.equal(h.controller.getState().status, "preparing");
  await tick();
  assert.equal(h.controller.getState().status, "uploading");
  assert.equal(h.controller.getState().file?.previewUrl, "blob:made.png:0");
  h.sends[0].resolve("job3");
  await started;
  assert.deepEqual(h.navigated, ["job3"]);
});

test("a loader that fails ends in error with its message, nothing sent, and a retry works", async () => {
  const h = harness();
  await h.controller.start(() => Promise.reject(new Error("Could not create the sample image.")), { name: "s.png" });
  const state = h.controller.getState();
  assert.equal(state.status, "error");
  assert.equal(state.error, "Could not create the sample image.");
  assert.equal(h.sends.length, 0);
  const retry = h.controller.start(fakeFile());
  assert.equal(h.controller.getState().status, "uploading");
  assert.equal(h.controller.getState().error, null);
  h.sends[0].resolve("ok");
  await retry;
  assert.equal(h.controller.getState().status, "success");
});

test("the request failing is an error with its code, not a cancel", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  h.sends[0].reject(Object.assign(new Error("Monthly limit reached"), { code: "SHEET_LIMIT" }));
  await started;
  const state = h.controller.getState();
  assert.equal(state.status, "error");
  assert.equal(state.error, "Monthly limit reached");
  assert.equal(state.errorCode, "SHEET_LIMIT");
  assert.equal(state.cancelled, false);
  assert.equal(state.file, null);
  assert.equal(h.previews.revoked.length, 1);
  // Cancel has nothing to stop once it failed.
  assert.equal(h.controller.cancel(), false);
});

test("once every byte is sent, cancel refuses and the upload completes", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  h.sends[0].progress(1);
  assert.equal(h.controller.getState().status, "processing");
  assert.equal(h.controller.cancel(), false, "the server may already have made the job");
  assert.equal(h.sends[0].signal.aborted, false);
  h.sends[0].resolve("job9");
  await started;
  assert.equal(h.controller.getState().status, "success");
  assert.deepEqual(h.navigated, ["job9"]);
  assert.equal(h.controller.cancel(), false, "and not after success either");
});

test("a second start while busy is ignored", async () => {
  const h = harness();
  const first = h.controller.start(fakeFile("one.png"));
  assert.equal(await h.controller.start(fakeFile("two.png")), false);
  assert.equal(h.sends.length, 1);
  assert.equal(h.controller.getState().file?.name, "one.png");
  h.sends[0].resolve("j");
  await first;
  assert.equal(await h.controller.start(fakeFile("three.png")), false, "success keeps the page busy while it navigates");
});

test("leaving the page aborts the request, frees the preview and stays quiet", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  const before = h.states.length;
  h.controller.dispose();
  await started;
  assert.equal(h.sends[0].signal.aborted, true);
  assert.equal(h.previews.revoked.length, 1);
  assert.equal(h.states.length, before, "no state change reaches an unmounted component");
  assert.deepEqual(h.navigated, []);
});

test("attach makes a disposed controller usable again (React strict mode mounts twice)", async () => {
  const h = harness();
  h.controller.dispose();
  h.controller.attach();
  const started = h.controller.start(fakeFile());
  h.sends[0].resolve("again");
  await started;
  assert.deepEqual(h.navigated, ["again"]);
});

test("an abort the request raises on its own counts as a cancel, not a failure", async () => {
  const h = harness();
  const started = h.controller.start(fakeFile());
  h.sends[0].reject(new UploadAbortedError());
  await started;
  assert.equal(h.controller.getState().status, "idle");
  assert.equal(h.controller.getState().cancelled, true);
  assert.equal(h.controller.getState().error, null);
});
