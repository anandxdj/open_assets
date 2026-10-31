/**
 * The upload state machine, free of React so it can be tested without a DOM.
 *
 *   idle ──start(loader)──▶ preparing ──▶ uploading ──▶ processing ──▶ success
 *     ▲  ──start(file)────────────────────▲     │            │
 *     │                                         ▼            ▼
 *     └──────────── cancel() ◀──────────── (user)          error
 *
 * - `preparing` is the client side step before any byte is sent (rasterising a
 *   sample, reading a file): it can be cancelled, and nothing is sent after.
 * - `uploading` is the request with its bytes still leaving the browser: cancel
 *   aborts it (AbortController), so the server never gets a whole body and no job
 *   is created.
 * - `processing` and `success` begin once every byte is sent. The server may
 *   already have stored the sheet and created the job, so cancel() refuses.
 *   Pretending to cancel then would leave an orphan job behind.
 *
 * A cancel is never an error: it lands in `idle` with `cancelled: true` and no
 * message. A stale run (one that was cancelled) can no longer change the state,
 * so a new upload may start the moment the old one is cancelled.
 */

import { UploadAbortedError, isUploadAbort } from "./uploadErrors";

export type UploadStatus = "idle" | "preparing" | "uploading" | "processing" | "success" | "error";

export interface UploadingFile {
  name: string;
  size: number;
  /** Object URL of the sheet; null while it is still being prepared. */
  previewUrl: string | null;
}

export interface UploadState {
  status: UploadStatus;
  progress: number;
  error: string | null;
  /** Machine code of the last failure, for example SHEET_LIMIT. */
  errorCode: string | null;
  file: UploadingFile | null;
  /** True after the user cancelled, until the next upload starts. */
  cancelled: boolean;
}

/** A file, or a step that produces one (and should stop when its signal aborts). */
export type UploadSource = File | ((signal: AbortSignal) => Promise<File>);

export interface UploadDeps {
  send: (file: File, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<{ jobId: string }>;
  onChange: (state: UploadState) => void;
  onNavigate: (jobId: string) => void;
  createPreviewUrl: (file: File) => string;
  revokePreviewUrl: (url: string) => void;
  /** Machine code of an error, if it has one. */
  errorCode?: (err: unknown) => string | null;
}

export const INITIAL_UPLOAD_STATE: UploadState = {
  status: "idle",
  progress: 0,
  error: null,
  errorCode: null,
  file: null,
  cancelled: false,
};

/** Phases in which Cancel does something. */
export function isCancellable(status: UploadStatus): boolean {
  return status === "preparing" || status === "uploading";
}

/** Phases that own the drop zone: nothing else may be started. */
export function isBusy(status: UploadStatus): status is Exclude<UploadStatus, "idle" | "error"> {
  return status === "preparing" || status === "uploading" || status === "processing" || status === "success";
}

export function createUploadController(deps: UploadDeps) {
  let state: UploadState = INITIAL_UPLOAD_STATE;
  let abort: AbortController | null = null;
  let preview: string | null = null;
  // Bumped on every start and cancel: a run whose id is out of date is stale.
  let run = 0;
  let disposed = false;

  function set(patch: Partial<UploadState>) {
    state = { ...state, ...patch };
    if (!disposed) deps.onChange(state);
  }

  function releasePreview() {
    if (preview) deps.revokePreviewUrl(preview);
    preview = null;
  }

  /** Begins an upload. Returns false, and does nothing, while another is busy. */
  async function start(source: UploadSource, meta: { name: string; size?: number } = { name: "Image" }): Promise<boolean> {
    if (disposed || abort || isBusy(state.status)) return false;

    const id = ++run;
    const ctl = new AbortController();
    abort = ctl;
    const stale = () => id !== run || ctl.signal.aborted;

    releasePreview();
    set({
      status: typeof source === "function" ? "preparing" : "uploading",
      progress: 0,
      error: null,
      errorCode: null,
      cancelled: false,
      file:
        typeof source === "function"
          ? { name: meta.name, size: meta.size ?? 0, previewUrl: null }
          : null,
    });

    try {
      let file: File;
      if (typeof source === "function") {
        file = await source(ctl.signal);
        // Cancelled while the file was being prepared: the sheet is dropped and never sent.
        if (stale()) return true;
      } else {
        file = source;
      }

      preview = deps.createPreviewUrl(file);
      set({ status: "uploading", progress: 0, file: { name: file.name, size: file.size, previewUrl: preview } });

      const res = await deps.send(
        file,
        (fraction) => {
          if (stale()) return;
          set({ progress: Math.round(fraction * 100), status: fraction >= 1 ? "processing" : "uploading" });
        },
        ctl.signal
      );
      if (stale()) return true;
      set({ progress: 100, status: "success" });
      // Stay busy: the page is navigating away.
      deps.onNavigate(res.jobId);
    } catch (err: unknown) {
      if (stale() && !isUploadAbort(err)) return true; // a cancelled run failing late says nothing
      if (id !== run) return true;
      abort = null;
      releasePreview();
      if (isUploadAbort(err)) {
        // Aborted by something other than cancel(): treated as a cancel, never as a failure.
        set({ status: "idle", progress: 0, file: null, cancelled: true });
      } else {
        set({
          status: "error",
          progress: 0,
          file: null,
          error: err instanceof Error && err.message ? err.message : "Upload failed",
          errorCode: deps.errorCode?.(err) ?? null,
        });
      }
    }
    return true;
  }

  /**
   * Stops an upload that has not finished sending. Returns false when there is
   * nothing to cancel, or when every byte is already on its way (see above).
   */
  function cancel(): boolean {
    if (!abort || !isCancellable(state.status)) return false;
    const ctl = abort;
    abort = null;
    run += 1; // the running upload is now stale
    releasePreview();
    set({ status: "idle", progress: 0, file: null, error: null, errorCode: null, cancelled: true });
    ctl.abort(new UploadAbortedError());
    return true;
  }

  /** Marks the controller live again (React runs effects twice in development: mount, cleanup, mount). */
  function attach() {
    disposed = false;
  }

  /** The page is closing: abort whatever is in flight and free the preview. */
  function dispose() {
    disposed = true;
    run += 1;
    abort?.abort(new UploadAbortedError());
    abort = null;
    releasePreview();
  }

  return { start, cancel, attach, dispose, getState: () => state };
}

export type UploadController = ReturnType<typeof createUploadController>;
