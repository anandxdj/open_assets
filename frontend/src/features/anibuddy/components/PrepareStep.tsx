"use client";

import { useCallback, useState } from "react";
import { Check, LoaderCircle, Wand } from "lucide-react";

import {
  type PreparedAsset,
  type SourceAsset,
  DEFAULT_PREPARE_OPTIONS,
} from "@/features/anibuddy/types";
import { PrepareError, prepareAsset } from "@/features/anibuddy/lib/prepare";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Hint, Inspector, PanelSection, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

interface PrepareStepProps {
  source: SourceAsset;
  prepared: PreparedAsset | null;
  onPrepared: (prepared: PreparedAsset | null) => void;
  onContinue: () => void;
}

export function PrepareStep({ source, prepared, onPrepared, onContinue }: PrepareStepProps) {
  // Seed from the asset already on the project, so walking back into this step
  // shows the settings that actually produced what is on screen.
  const seed = prepared?.options ?? DEFAULT_PREPARE_OPTIONS;
  const [keepBackground, setKeepBackground] = useState(seed.keepBackground);
  const [keepLooseParts, setKeepLooseParts] = useState(seed.keepLooseParts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      onPrepared(await prepareAsset(source.dataUrl, { keepBackground, keepLooseParts }));
    } catch (cause) {
      // Keep whatever was already prepared. `setPrepared` also clears the rig and
      // the motion, so nulling here would destroy finished rig work because a
      // *retry* failed — and the asset that produced that rig is still valid.
      // The user flips an option and tries again, or continues with the old one.
      setError(
        cause instanceof PrepareError
          ? cause.message
          : "Preparation failed unexpectedly. Try a different image.",
      );
    } finally {
      setBusy(false);
    }
  }, [source.dataUrl, keepBackground, keepLooseParts, onPrepared]);

  return (
    <>
      <StageArea label="Before and after">
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? "Preparing the artwork…" : prepared ? "Artwork prepared." : ""}
        </p>
        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-px bg-line">
          <figure className="flex min-h-[320px] flex-col bg-sunken">
            <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
              <span className="oa-label text-ink">Supplied</span>
              <span className="oa-value text-ink-3">
                {source.width} × {source.height}
              </span>
            </figcaption>
            <div className="oa-checker relative mx-4 mb-4 min-h-[260px] flex-1 overflow-hidden border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={source.dataUrl} alt="Supplied artwork" className="absolute inset-0 size-full object-contain p-6" />
            </div>
          </figure>

          <figure className="flex min-h-[320px] flex-col bg-sunken">
            <figcaption className="flex min-h-10 flex-none flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-1">
              <span className="flex items-center gap-2">
                <span className="oa-label text-ink">Prepared</span>
                {prepared && !busy && (
                  <Badge tone="success">
                    <Check aria-hidden />
                    Ready to rig
                  </Badge>
                )}
              </span>
              <span className="oa-value whitespace-nowrap text-ink-3">
                {prepared ? `${prepared.width} × ${prepared.height} · trimmed` : ""}
              </span>
            </figcaption>
            <div className="oa-checker relative mx-4 mb-4 flex min-h-[260px] flex-1 items-center justify-center overflow-hidden border border-line">
              {busy ? (
                <div className="flex flex-col items-center gap-2.5">
                  <LoaderCircle aria-hidden className="size-8 animate-spin text-ink" />
                  <span className="text-xs leading-[18px] text-ink-2">Preparing…</span>
                </div>
              ) : prepared ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={prepared.dataUrl}
                  alt="Prepared transparent artwork"
                  className="absolute inset-0 size-full object-contain p-6"
                />
              ) : (
                <p className="max-w-[220px] px-4 text-center text-xs leading-[18px] text-ink-2">
                  Press Prepare artwork to cut the character out.
                </p>
              )}
            </div>
          </figure>
        </div>
      </StageArea>

      <Inspector
        title="Prepare"
        footer={
          <>
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button
              variant={prepared ? "secondary" : "primary"}
              block
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Wand aria-hidden />}
              {prepared ? "Prepare again" : "Prepare artwork"}
            </Button>
            <Button variant={prepared ? "primary" : "secondary"} block disabled={!prepared || busy} onClick={onContinue}>
              Continue to rig
            </Button>
          </>
        }
      >
        <PanelSection>
          <Hint>Removes the background, cleans stray specks and trims the artwork to its silhouette.</Hint>
        </PanelSection>
        <PanelSection title="Options" className="border-b-0">
          <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
            <Checkbox
              checked={keepBackground}
              onChange={(event) => setKeepBackground(event.target.checked)}
              className="mt-px"
            />
            <span className="flex flex-col gap-0.5">
              <span>Keep the original background</span>
              <span className="text-[11px] leading-4 text-ink-3">
                For art whose backdrop is part of the piece. Only works if the image already has transparency to
                trim against.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
            <Checkbox
              checked={keepLooseParts}
              onChange={(event) => setKeepLooseParts(event.target.checked)}
              className="mt-px"
            />
            <span className="flex flex-col gap-0.5">
              <span>Keep detached parts</span>
              <span className="text-[11px] leading-4 text-ink-3">
                Leave held props, floating hair or a separate tail in place instead of keeping only the largest
                shape.
              </span>
            </span>
          </label>
        </PanelSection>
      </Inspector>
    </>
  );
}
