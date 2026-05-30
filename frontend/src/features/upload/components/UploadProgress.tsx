"use client";

import { cn } from "@/lib/utils";

type UploadStatus = "idle" | "uploading" | "success" | "error";

const statusLabel: Record<UploadStatus, string> = {
  idle: "",
  uploading: "Uploading…",
  success: "Queued for detection · redirecting…",
  error: "",
};

interface Props {
  status: UploadStatus;
  progress: number;
  error: string | null;
}

export function UploadProgress({ status, progress, error }: Props) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error ?? "Upload failed. Please try again."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{statusLabel[status]}</span>
        <span>{progress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-200 ease-out",
            status === "success" && "bg-green-500"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
