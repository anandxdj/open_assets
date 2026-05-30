"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadImage } from "@/features/upload/services/uploadApi";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function useFileUpload() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      setProgress(0);

      // Simulate progress up to 85% while real request runs
      const interval = setInterval(() => {
        setProgress((p) => (p < 85 ? p + 5 : p));
      }, 200);

      try {
        const res = await uploadImage(file);
        clearInterval(interval);
        setProgress(100);
        setStatus("success");
        router.push(`/editor/${res.jobId}`);
      } catch (err: unknown) {
        clearInterval(interval);
        setStatus("error");
        setProgress(0);
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [router]
  );

  return { upload, status, progress, error };
}
