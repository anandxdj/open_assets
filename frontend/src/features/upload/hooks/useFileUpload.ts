"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError } from "@/lib/api-error";
import { uploadImageWithProgress } from "@/features/upload/services/uploadApi";
import {
  createUploadController,
  INITIAL_UPLOAD_STATE,
  type UploadController,
  type UploadSource,
  type UploadState,
} from "@/features/upload/lib/uploadController";

export type { UploadStatus, UploadingFile } from "@/features/upload/lib/uploadController";

/**
 * idle → preparing (client side work before any byte is sent) → uploading (bytes
 * leaving the browser, real progress) → processing (bytes sent, server storing the
 * image and queueing detection) → success (redirecting to the editor). Any failure
 * lands in error. Cancel works in preparing and uploading and ends in idle with
 * `cancelled` set, never in error. The rules live in uploadController.ts.
 */
export function useFileUpload() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>(INITIAL_UPLOAD_STATE);

  const [controller] = useState<UploadController>(() =>
    createUploadController({
      send: uploadImageWithProgress,
      onChange: setState,
      // The app router instance is stable for the life of the page.
      onNavigate: (jobId) => router.push(`/editor/${jobId}`),
      createPreviewUrl: (file) => URL.createObjectURL(file),
      revokePreviewUrl: (url) => URL.revokeObjectURL(url),
      errorCode: (err) => (err instanceof ApiRequestError ? (err.code ?? null) : null),
    })
  );

  // Leaving the page cancels an upload still in flight and frees the preview.
  useEffect(() => {
    controller.attach();
    return () => controller.dispose();
  }, [controller]);

  /** Uploads a file, or runs a step that makes one first (cancellable while it runs). */
  const upload = useCallback(
    (source: UploadSource, meta?: { name: string; size?: number }) => controller.start(source, meta),
    [controller]
  );

  /** Stops an upload whose bytes are still being sent, or a file still being prepared. */
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return { upload, cancel, ...state };
}
