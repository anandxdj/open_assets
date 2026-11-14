"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FolderOpen, ImageUp, LoaderCircle, X } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Hint, Inspector, PanelSection, Prop, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

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

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: { "image/png": [], "image/webp": [], "image/jpeg": [] },
    maxSize: MAX_BYTES,
    maxFiles: 1,
    multiple: false,
    disabled: busy,
    noClick: true,
    noKeyboard: true,
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
  const showDrop = Boolean(pending) || !source;

  return (
    <>
      <StageArea label="Artwork">
        {showDrop ? (
          <div className="flex flex-1 p-4 md:p-6">
            <div
              {...getRootProps({
                className: "oa-drop flex-1",
                "aria-busy": busy || undefined,
              })}
              data-over={isDragActive}
            >
              <input {...getInputProps()} aria-label="Choose a character image" />
              {busy ? (
                <>
                  <LoaderCircle aria-hidden className="size-8 animate-spin text-ink" />
                  <p className="oa-section" role="status">
                    Checking the image against the saved rig…
                  </p>
                </>
              ) : (
                <>
                  <span className="oa-icon-box size-12">
                    <ImageUp aria-hidden className="size-6" />
                  </span>
                  <div className="flex max-w-md flex-col gap-1">
                    <h3 className="oa-section">
                      {pending ? "Add the original image" : "Add one character"}
                    </h3>
                    <p className="text-xs leading-[18px] text-ink-2">
                      {pending
                        ? "It's prepared with the same settings and fingerprinted. A different image is refused rather than rigged wrongly."
                        : "Drop an image here. PNG works best: one mostly front-facing character with a clean silhouette. JPEG and WebP work too."}
                    </p>
                  </div>
                  <Button size="lg" onClick={open}>
                    <ImageUp aria-hidden />
                    Choose image
                  </Button>
                  <Hint>PNG, JPEG or WebP · up to 20 MB</Hint>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-4 md:p-8">
            <div className="oa-checker relative h-full min-h-[300px] w-full max-w-[560px] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source.dataUrl}
                alt="Supplied character artwork"
                className="absolute inset-0 size-full object-contain p-6"
              />
            </div>
          </div>
        )}
      </StageArea>

      <Inspector
        title={pending ? "Reopen project" : "Your artwork"}
        footer={
          !pending && (
            <>
              <Button variant="primary" block disabled={!source || !rightsConfirmed} onClick={onContinue}>
                Continue to preparation
              </Button>
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
              <Button variant="ghost" size="sm" className="self-center" onClick={() => manifestInput.current?.click()}>
                <FolderOpen aria-hidden />
                Open a project file
              </Button>
            </>
          )
        }
      >
        {pending && (
          <PanelSection>
            <Notice tone="info">
              This project holds a rig but no pixels. Add{" "}
              <span className="oa-value font-bold">{pending.sourceName ?? "the original artwork"}</span>, the exact
              image it was rigged against, and your joints, motion and settings come back.
            </Notice>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                onPending(null);
                setError(null);
              }}
            >
              Cancel reopen
            </Button>
          </PanelSection>
        )}

        {!pending && source && (
          <PanelSection
            title="Source"
            aside={rightsConfirmed ? <Badge tone="success">Ready</Badge> : undefined}
          >
            <Prop label="File">
              <span className="oa-value block truncate text-ink" title={source.name}>
                {source.name}
              </span>
            </Prop>
            <Prop label="Size">
              <span className="oa-value text-ink">
                {source.width} × {source.height}
              </span>
            </Prop>
            {oversized && (
              <Notice tone="warning">
                Larger than {MAX_SOURCE_EDGE}px, so preparation will scale it down. Rig and export use the smaller
                size.
              </Notice>
            )}
            <Hint>
              Next, preparation makes the background transparent and trims the artwork. Your pixels stay in this
              browser until you run rig analysis.
            </Hint>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => onSource(null)}>
              <X aria-hidden />
              Choose another file
            </Button>
          </PanelSection>
        )}

        {!pending && !source && (
          <PanelSection>
            <Hint>Add one character to start. You can also reopen a project file you saved earlier.</Hint>
          </PanelSection>
        )}

        {!pending && (
          <PanelSection className="border-b-0">
            <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
              <Checkbox
                checked={rightsConfirmed}
                onChange={(event) => onRights(event.target.checked)}
                className="mt-px"
              />
              <span>I have the rights or permission to animate this artwork.</span>
            </label>
          </PanelSection>
        )}

        {error && (
          <PanelSection className="border-b-0">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </PanelSection>
        )}
      </Inspector>
    </>
  );
}
