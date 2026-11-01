"use client";

import { useEffect, useRef } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import { Checker } from "@/components/ui/feedback";
import { isBusy, isCancellable, type UploadStatus, type UploadingFile } from "@/features/upload/lib/uploadController";
import { cn } from "@/lib/utils";

const MAX_BYTES = 20 * 1024 * 1024;

// Matches the formats the upload API accepts.
const ACCEPT = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

function rejectionMessage(rejections: FileRejection[]): string {
  if (rejections.length > 1) return "Drop one image at a time.";
  const code = rejections[0]?.errors[0]?.code;
  if (code === "file-too-large") return "That image is larger than 20 MB. Choose a smaller file.";
  if (code === "file-invalid-type") return "That file type is not supported. Choose a PNG, JPEG or WebP image.";
  if (code === "too-many-files") return "Drop one image at a time.";
  return "That file cannot be uploaded. Choose a PNG, JPEG or WebP image up to 20 MB.";
}

export const PHASE_TEXT: Record<Exclude<UploadStatus, "idle" | "error">, { verb: string; hint: string }> = {
  preparing: { verb: "Preparing", hint: "Getting the image ready. Nothing is sent yet" },
  uploading: { verb: "Uploading", hint: "Next: detection opens in the editor" },
  processing: { verb: "Saving", hint: "Storing the image and queueing detection…" },
  success: { verb: "Uploaded", hint: "Queued for detection · opening editor…" },
};

function UploadingPanel({
  file,
  status,
  progress,
  onCancel,
}: {
  file: UploadingFile;
  status: keyof typeof PHASE_TEXT;
  progress: number;
  onCancel: () => void;
}) {
  const phase = PHASE_TEXT[status];
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancellable = isCancellable(status);

  // The control that started this (Choose file, a sample button) is gone or disabled. Put focus on
  // Cancel while it can be used, and on the panel itself once it cannot, so keyboard focus is never
  // dropped on <body> and the next Tab or Shift+Tab starts from here.
  useEffect(() => {
    const active = document.activeElement;
    const nowhere = !active || active === document.body || active.matches(":disabled");
    if (!nowhere && !panelRef.current?.contains(active)) return; // the user is somewhere else on purpose
    if (!nowhere && active === cancelRef.current) return;
    (cancellable ? cancelRef.current : panelRef.current)?.focus();
  }, [cancellable]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="group"
      aria-label="Upload progress"
      className="flex min-h-[280px] flex-col items-center justify-center gap-6 border-[1.5px] border-line bg-surface px-4 py-8 focus-visible:[outline-offset:-4px] sm:px-8"
    >
      <Checker className="aspect-[2/1] w-[280px] max-w-full overflow-hidden border border-line">
        {file.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.previewUrl} alt={`Preview of ${file.name}`} className="size-full object-contain" />
        ) : (
          <span className="flex size-full items-center justify-center text-ink-3">
            <ImageIcon aria-hidden className="size-8" />
          </span>
        )}
      </Checker>
      <div className="flex w-full max-w-[420px] flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-xs font-medium">
            {phase.verb} <span className="oa-value">{file.name}</span>
          </span>
          <span className="oa-value flex-none text-ink-2" aria-hidden>
            {progress}%
          </span>
        </div>
        <Progress value={progress} label={`${phase.verb} ${file.name}`} />
        <div className="flex min-h-7 items-center justify-between gap-3">
          <span className="text-[11px] leading-4 text-ink-2">{phase.hint}</span>
          {cancellable && (
            <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel}>
              Cancel
              <span className="sr-only"> upload of {file.name}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Three states from the design: idle (drop or choose), drag-over (release to
 * upload) and uploading (preview, real progress, cancel while sending).
 */
export function DropZone({
  status,
  progress,
  file,
  onFile,
  onCancel,
  onReject,
  locked = false,
}: {
  status: UploadStatus;
  progress: number;
  file: UploadingFile | null;
  onFile: (file: File) => void;
  onCancel: () => void;
  onReject: (message: string) => void;
  /** Nothing can be uploaded right now (for example the monthly allowance is used). */
  locked?: boolean;
}) {
  const busy = isBusy(status);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const wasBusy = useRef(false);

  // The panel is replaced by the drop zone again (cancelled, or the upload failed). Focus was on
  // the panel's Cancel button, now gone: bring it back to "Choose file", the control that starts
  // the next upload, unless the user has already moved on to something else.
  useEffect(() => {
    const returned = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!returned) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.matches(":disabled") && active.isConnected) return;
    chooseRef.current?.focus();
  }, [busy]);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDropAccepted: (files) => {
      if (files[0]) onFile(files[0]);
    },
    onDropRejected: (rejections) => onReject(rejectionMessage(rejections)),
    accept: ACCEPT,
    maxSize: MAX_BYTES,
    multiple: false,
    disabled: busy || locked,
    // The visible "Choose file" button opens the picker; the area only takes drops.
    noClick: true,
    noKeyboard: true,
  });

  if (busy && file) {
    return <UploadingPanel file={file} status={status} progress={progress} onCancel={onCancel} />;
  }

  return (
    <div
      {...getRootProps({ className: cn("oa-drop min-h-[280px]", locked && "opacity-60") })}
      data-over={isDragActive || undefined}
      aria-disabled={locked || undefined}
    >
      <input {...getInputProps()} aria-label="Choose an image to extract" />
      {isDragActive ? (
        <>
          <span
            className={cn(
              "oa-icon-box size-12",
              isDragReject ? "border-danger text-danger" : "border-brand text-brand-text"
            )}
          >
            <Upload aria-hidden className="size-6" />
          </span>
          <span className={cn("oa-section", isDragReject ? "text-danger" : "text-brand-text")}>
            {isDragReject ? "Only PNG, JPEG or WebP images" : "Release to upload"}
          </span>
        </>
      ) : (
        <>
          <span className="oa-icon-box size-12">
            <Upload aria-hidden className="size-6" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="oa-section">{locked ? "No sheets left this month" : "Drop an image here"}</span>
            <span className="text-xs leading-[18px] text-ink-2">
              PNG, JPEG or WebP · up to 20 MB · one sheet at a time
            </span>
          </div>
          <Button ref={chooseRef} variant="primary" size="lg" onClick={open} disabled={locked}>
            Choose file
          </Button>
        </>
      )}
    </div>
  );
}
