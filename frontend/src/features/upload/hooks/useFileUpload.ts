"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadAbortedError, uploadImageWithProgress } from "@/features/upload/services/uploadApi";

/**
 * idle → uploading (bytes leaving the browser, real progress) → processing
 * (bytes sent, server storing the image and queueing detection) → success
 * (redirecting to the editor). Any failure lands in error.
 */
export type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error";

export interface UploadingFile {
  name: string;
  size: number;
  previewUrl: string;
}

export function useFileUpload() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<UploadingFile | null>(null);

  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);

  // Leaving the page cancels an upload still in flight and frees the preview.
  useEffect(
    () => () => {
      controller.current?.abort();
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    []
  );

  const upload = useCallback(
    async (next: File) => {
      if (busy.current) return;
      busy.current = true;

      if (preview.current) URL.revokeObjectURL(preview.current);
      const previewUrl = URL.createObjectURL(next);
      preview.current = previewUrl;
      const abort = new AbortController();
      controller.current = abort;

      setFile({ name: next.name, size: next.size, previewUrl });
      setError(null);
      setProgress(0);
      setStatus("uploading");

      try {
        const res = await uploadImageWithProgress(
          next,
          (fraction) => {
            setProgress(Math.round(fraction * 100));
            setStatus(fraction >= 1 ? "processing" : "uploading");
          },
          abort.signal
        );
        setProgress(100);
        setStatus("success");
        router.push(`/editor/${res.jobId}`);
        // Stay busy: the page is navigating away.
      } catch (err: unknown) {
        busy.current = false;
        setProgress(0);
        if (err instanceof UploadAbortedError) {
          setStatus("idle");
          setFile(null);
        } else {
          setStatus("error");
          setError(err instanceof Error ? err.message : "Upload failed");
        }
      } finally {
        controller.current = null;
      }
    },
    [router]
  );

  /** Stops an upload whose bytes are still being sent. */
  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  return { upload, cancel, status, progress, error, file };
}
