"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileImage, FolderOpen, Loader2, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AniBuddyProject,
  type SourceAsset,
  MAX_SOURCE_EDGE,
} from "@/features/anibuddy/types";
import { PrepareError, prepareAsset } from "@/features/anibuddy/lib/prepare";
import {
  type AniBuddyManifest,
  ManifestError,
  manifestPrepareOptions,
  parseManifest,
  restoreProject,
} from "@/features/anibuddy/lib/manifest";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Decode to a data URL rather than an object URL. The pixels have to survive
 * being handed to the prepare pipeline, the rig-analysis request body, and the
 * canvas renderer; an object URL is revoked out from under all three.
 */
function readAsset(file: File): Promise<SourceAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new Image();
      image.onerror = () => reject(new Error("That file is not a readable image."));
      image.onload = () =>
        resolve({
          name: file.name,
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

interface SourceStepProps {
  source: SourceAsset | null;
  rightsConfirmed: boolean;
  /** A parsed project waiting on its artwork — from a project file, or from a
   *  reloaded session whose pixels localStorage could not hold. */
  pending: AniBuddyManifest | null;
  onSource: (source: SourceAsset | null) => void;
  onRights: (confirmed: boolean) => void;
  onPending: (manifest: AniBuddyManifest | null) => void;
  onImportProject: (project: AniBuddyProject) => void;
  onContinue: () => void;
}

export function SourceStep({
  source,
  rightsConfirmed,
  pending,
  onSource,
  onRights,
  onPending,
  onImportProject,
  onContinue,
}: SourceStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manifestInput = useRef<HTMLInputElement | null>(null);

  const accept = useCallback(
    async (file: File) => {
      setError(null);
      try {
        onSource(await readAsset(file));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That file could not be read.");
      }
    },
    [onSource],
  );

  const reopen = useCallback(
    async (manifest: AniBuddyManifest, file: File) => {
      setBusy(true);
      setError(null);
      try {
        const asset = await readAsset(file);
        // Same settings as the original run, or the hash check would reject the
        // correct artwork for the wrong reason.
        const prepared = await prepareAsset(asset.dataUrl, manifestPrepareOptions(manifest));
        onImportProject(restoreProject(manifest, prepared, asset.dataUrl, asset.name));
      } catch (cause) {
        // ManifestError (hash mismatch) and PrepareError both carry text written
        // for the user; anything else does not.
        setError(
          cause instanceof ManifestError || cause instanceof PrepareError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : "That project could not be reopened.",
        );
      } finally {
        setBusy(false);
      }
    },
    [onImportProject],
  );

  const chooseManifest = useCallback(
    async (file: File) => {
      setError(null);
      try {
        onPending(parseManifest(JSON.parse(await file.text())));
      } catch (cause) {
        onPending(null);
        setError(
          cause instanceof ManifestError
            ? cause.message
            : "That file is not a readable AniBuddy project.",
        );
      }
    },
    [onPending],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/png": [], "image/webp": [], "image/jpeg": [] },
    maxSize: MAX_BYTES,
    maxFiles: 1,
    multiple: false,
    disabled: busy,
    onDrop: (files) => {
      const file = files[0];
      if (!file) return;
      if (pending) void reopen(pending, file);
      else void accept(file);
    },
    onDropRejected: (rejections) =>
      setError(rejections[0]?.errors[0]?.message ?? "That file was rejected."),
  });

  const oversized =
    source !== null && Math.max(source.width, source.height) > MAX_SOURCE_EDGE;

  return (
    <section className="border-2 border-zinc-950 bg-white p-5 dark:border-zinc-100 dark:bg-zinc-900 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            01 / supplied artwork
          </p>
          <h2 className="mt-1 text-xl font-black tracking-tight">
            {pending ? "Reopen a saved project" : "Add one character"}
          </h2>
        </div>
        {!pending && source && rightsConfirmed && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Ready to prepare
          </span>
        )}
      </div>

      {pending && (
        <div className="mb-5 border-l-2 border-fuchsia-600 pl-4">
          <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
            This project holds a rig but no pixels. Supply{" "}
            <strong>{pending.sourceName ?? "the original artwork"}</strong> — the exact image it was
            rigged against — and your joints, motion, and settings come back.
          </p>
          <button
            type="button"
            onClick={() => {
              onPending(null);
              setError(null);
            }}
            className="mt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 underline underline-offset-4 hover:text-zinc-950 dark:hover:text-zinc-100"
          >
            Cancel reopen
          </button>
        </div>
      )}

      {pending || !source ? (
        <div
          {...getRootProps()}
          className={cn(
            "flex min-h-64 flex-col items-center justify-center border-2 border-dashed px-6 text-center transition-colors",
            busy ? "cursor-wait opacity-60" : "cursor-pointer",
            isDragActive
              ? "border-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/30"
              : "border-zinc-300 hover:border-zinc-950 dark:border-zinc-700 dark:hover:border-zinc-100",
          )}
        >
          <input {...getInputProps()} />
          {busy ? (
            <>
              <Loader2 className="mb-4 h-7 w-7 animate-spin text-fuchsia-700 dark:text-fuchsia-300" />
              <p className="font-bold">Preparing and checking against the saved rig…</p>
            </>
          ) : (
            <>
              <UploadCloud className="mb-4 h-7 w-7 text-fuchsia-700 dark:text-fuchsia-300" />
              <p className="font-bold">
                {pending
                  ? "Drop the original image here, or browse"
                  : "Drop a character image here, or browse"}
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {pending
                  ? "It is re-prepared with the same settings and fingerprinted. A different image is refused rather than rigged wrongly."
                  : "PNG is best. Use one mostly front-facing character with a clean silhouette. JPG and WebP also work for preparation."}
              </p>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-500">
                PNG · JPG · WebP / up to 20 MB
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[13rem_1fr]">
          <div className="grid min-h-56 place-items-center overflow-hidden bg-[linear-gradient(45deg,#e4e4e7_25%,transparent_25%),linear-gradient(-45deg,#e4e4e7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e4e4e7_75%),linear-gradient(-45deg,transparent_75%,#e4e4e7_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] dark:bg-[linear-gradient(45deg,#27272a_25%,transparent_25%),linear-gradient(-45deg,#27272a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#27272a_75%),linear-gradient(-45deg,transparent_75%,#27272a_75%)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={source.dataUrl}
              alt="Supplied character artwork"
              className="max-h-64 max-w-full object-contain"
            />
          </div>
          <div className="flex flex-col justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-bold">
                <FileImage className="h-4 w-4 text-fuchsia-700" />
                {source.name}
              </p>
              <p className="mt-2 font-mono text-xs text-zinc-500">
                {source.width} × {source.height}px · local browser asset
              </p>
              {oversized && (
                <p className="mt-3 text-sm leading-6 text-amber-700 dark:text-amber-300">
                  Larger than {MAX_SOURCE_EDGE}px, so preparation will downscale it. Rig and export
                  work at the downscaled size.
                </p>
              )}
              <p className="mt-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Next, preparation makes the background transparent and trims the artwork. Your
                pixels stay in this browser until you run rig analysis.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSource(null)}
              className="flex w-fit items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-600 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Choose another file
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">
          {error}
        </p>
      )}

      {!pending && (
        <>
          <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-zinc-200 pt-4 text-sm leading-5 dark:border-zinc-700">
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => onRights(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-fuchsia-700"
            />
            <span>I have the rights or permission to animate this artwork.</span>
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onContinue}
              disabled={!source || !rightsConfirmed}
              className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue to preparation
            </button>

            <input
              ref={manifestInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset first, so picking the same file twice fires again.
                event.target.value = "";
                if (file) void chooseManifest(file);
              }}
            />
            <button
              type="button"
              onClick={() => manifestInput.current?.click()}
              className="flex items-center gap-2 border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider dark:border-zinc-100"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open a project file
            </button>
          </div>
        </>
      )}
    </section>
  );
}
