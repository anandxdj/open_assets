/** Thrown (and caught) when an upload is cancelled by the user or by leaving the page. Never shown as a failure. */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}

/** True for our own abort error, and for the AbortError a DOM API raises when its signal fires. */
export function isUploadAbort(err: unknown): boolean {
  return (
    err instanceof UploadAbortedError ||
    (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError")
  );
}
