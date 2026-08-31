"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadImage } from "@/features/upload/services/uploadApi";
import type { UploadResponse } from "@/types";
import { createEditorProject } from "@/features/editor/services/projectApi";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface BatchUploadResult {
  file: File;
  response?: UploadResponse;
  error?: string;
}

export function useFileUpload() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [results, setResults] = useState<BatchUploadResult[]>([]);

  const upload = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      setProgress(0);
      setCompleted(0);
      setTotal(1);
      setResults([]);

      // Simulate progress up to 85% while real request runs
      const interval = setInterval(() => {
        setProgress((p) => (p < 85 ? p + 5 : p));
      }, 200);

      try {
        const res = await uploadImage(file);
        clearInterval(interval);
        setProgress(100);
        setCompleted(1);
        setResults([{ file, response: res }]);
        setStatus("success");
        router.push(`/editor/${res.jobId}`);
        return res;
      } catch (err: unknown) {
        clearInterval(interval);
        setStatus("error");
        setProgress(0);
        const message = err instanceof Error ? err.message : "Upload failed";
        setError(message);
        setResults([{ file, error: message }]);
        throw err;
      }
    },
    [router]
  );

  const uploadMany = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return [];

      setStatus("uploading");
      setError(null);
      setProgress(0);
      setCompleted(0);
      setTotal(files.length);
      setResults([]);

      const batchResults: BatchUploadResult[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
          // Send the original File object. No canvas decode, resize, or re-encoding.
          const response = await uploadImage(file);
          batchResults.push({ file, response });
        } catch (err: unknown) {
          batchResults.push({
            file,
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }

        const finished = index + 1;
        setCompleted(finished);
        setProgress(Math.round((finished / files.length) * 100));
        setResults([...batchResults]);
      }

      const successful = batchResults.filter(
        (result): result is BatchUploadResult & { response: UploadResponse } => Boolean(result.response),
      );
      const failedCount = batchResults.length - successful.length;

      if (successful.length === 0) {
        setStatus("error");
        setProgress(0);
        setError("None of the images could be uploaded. Please try again.");
        return batchResults;
      }

      setStatus("success");
      if (failedCount > 0) setError(`${failedCount} of ${files.length} images failed to upload.`);

      if (successful.length === 1) {
        router.push(`/editor/${successful[0].response.jobId}`);
      } else {
        try {
          const project = await createEditorProject(
            successful.map((result) => ({ jobId: result.response.jobId, name: result.file.name })),
            `Asset batch · ${new Date().toLocaleDateString()}`,
          );
          router.push(`/editor/projects/${project.id}`);
        } catch (projectError) {
          setStatus("error");
          setProgress(0);
          setError(projectError instanceof Error ? projectError.message : "The project could not be created.");
        }
      }
      return batchResults;
    },
    [router]
  );

  return { upload, uploadMany, status, progress, error, completed, total, results };
}
