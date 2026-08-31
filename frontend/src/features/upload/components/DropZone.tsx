"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileUpload } from "@/features/upload/hooks/useFileUpload";
import { UploadProgress } from "./UploadProgress";

export function DropZone() {
  const { uploadMany, status, progress, error, completed, total } = useFileUpload();
  const uploading = status === "uploading";

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) void uploadMany(accepted);
    },
    [uploadMany]
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    maxSize: 10 * 1024 * 1024,
    multiple: true,
    maxFiles: 20,
    disabled: uploading,
  });

  const selectionLabel = acceptedFiles.length === 1
    ? acceptedFiles[0].name
    : `${acceptedFiles.length} images selected`;

  return (
    <div className="flex flex-col gap-4">
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors cursor-pointer",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-accent/30",
          uploading && "pointer-events-none opacity-60"
        )}
      >
        <input {...getInputProps()} />
        <div className="rounded-full bg-muted p-3">
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
        </div>
        {isDragActive ? (
            <p className="text-sm font-medium">Drop your images here</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Drop images here, or{" "}
                <span className="text-primary underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WebP · up to 20 images · 10 MB each</p>
            </div>
          </>
        )}
        {acceptedFiles.length > 0 && !uploading && status === "idle" && (
          <p className="absolute bottom-3 text-xs text-muted-foreground">
            {selectionLabel}
          </p>
        )}
      </div>

      {(status !== "idle" || error) && (
        <UploadProgress
          status={status}
          progress={progress}
          error={error}
          completed={completed}
          total={total}
        />
      )}

    </div>
  );
}
