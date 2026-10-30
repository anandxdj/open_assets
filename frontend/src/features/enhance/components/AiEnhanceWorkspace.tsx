"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { ImageUp, LoaderCircle, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/controls";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { STORAGE_NOT_CONFIGURED, type AiEnhanceLimits, type AiEnhanceOptions } from "@/features/enhance/aiEnhanceApi";
import { AiComparePane } from "@/features/enhance/components/AiComparePane";
import { EnhanceTopbar } from "@/features/enhance/components/EnhanceTopbar";
import { useAiCapabilities, useAiEnhance } from "@/features/enhance/hooks/useAiEnhance";
import { useEntitlement, usePlan } from "@/features/plans/PlanContext";
import { UpgradeAction } from "@/features/plans/UpgradeAction";
import { isPlanErrorCode } from "@/lib/plans";
import {
  baseName,
  checkAiLimits,
  formatBytes,
  formatMegapixels,
  formatSize,
  outputSize,
  type Size,
} from "@/features/enhance/lib/aiLimits";

type ScaleChoice = "off" | "2" | "4";

const ACCEPT = "image/png,image/jpeg,image/webp";
const ACCEPTED_TYPES = ACCEPT.split(",");
const ACCEPTED_NAME = /\.(png|jpe?g|webp)$/i;
/** Used until the server reports its own limits. */
const FALLBACK_MAX_BYTES = 10 * 1024 * 1024;

const SCALE_OPTIONS = [
  { value: "off" as const, label: "Off" },
  { value: "2" as const, label: "2×" },
  // 4× is a Pro entitlement (maxUpscale): locked for free accounts, and the server enforces it too.
  { value: "4" as const, label: "4×" },
];

const DEFAULT_SCALE: ScaleChoice = "2";

function toOptions(scale: ScaleChoice, removeBackground: boolean): AiEnhanceOptions {
  return { scale: scale === "off" ? null : (Number(scale) as 2 | 4), removeBackground };
}

function downloadNameFor(sourceName: string, operations: { op: string; scale?: number }[]): string {
  const parts = operations.map((operation) => (operation.op === "upscale" ? `${operation.scale}x` : "no-bg"));
  return `${baseName(sourceName)}-${parts.join("-") || "enhanced"}.png`;
}

export function AiEnhanceWorkspace() {
  const id = useId();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mainPane = useRef<HTMLElement | null>(null);
  // The source object URL is revoked when it is replaced and when the page unmounts.
  const sourceUrl = useRef<string | null>(null);

  const capabilities = useAiCapabilities();
  const enhance = useAiEnhance();

  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [sourceSize, setSourceSize] = useState<Size | null>(null);
  const [resultSize, setResultSize] = useState<Size | null>(null);
  const [chosenScale, setScale] = useState<ScaleChoice>(DEFAULT_SCALE);
  const { value: maxUpscale, ready: planReady } = useEntitlement("maxUpscale");
  const { refresh: refreshPlan } = usePlan();
  const scaleLocked = planReady && maxUpscale < 4;
  // A free account (or a trial that just ended) never carries 4× into a request.
  const scale: ScaleChoice = scaleLocked && chosenScale === "4" ? DEFAULT_SCALE : chosenScale;
  const [removeBackground, setRemoveBackground] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(
    () => () => {
      if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    },
    []
  );

  const caps = capabilities.state.status === "ready" ? capabilities.state.data : null;
  const unavailable = caps !== null && !caps.available;
  const limits: AiEnhanceLimits | null = caps?.limits ?? null;
  const maxBytes = limits?.maxBytes ?? FALLBACK_MAX_BYTES;
  const options = useMemo(() => toOptions(scale, removeBackground), [scale, removeBackground]);
  const noOperation = options.scale === null && !options.removeBackground;
  const busy = enhance.busy;

  const limitMessage = useMemo(() => {
    if (!source || !limits || !caps) return null;
    return checkAiLimits({ size: sourceSize, bytes: source.file.size }, options, limits, caps.providerLabel);
  }, [source, sourceSize, limits, caps, options]);

  const expected = sourceSize ? outputSize(sourceSize, options.scale) : null;

  function choose(file: File | null | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_NAME.test(file.name)) {
      setPickError(
        file.type === "image/svg+xml" || /\.svg$/i.test(file.name)
          ? "AI enhance doesn't take SVG. Use Cleanup to render it as a PNG."
          : "Choose a PNG, JPEG or WebP image."
      );
      return;
    }
    if (file.size > maxBytes) {
      setPickError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`);
      return;
    }
    if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    const url = URL.createObjectURL(file);
    sourceUrl.current = url;
    enhance.reset();
    setSource({ file, url });
    setSourceSize(null);
    setResultSize(null);
    setPickError(null);
  }

  async function submit() {
    if (!source) return;
    setResultSize(null);
    // On a phone the result sits below the options; bring it into view.
    if (window.matchMedia("(max-width: 767px)").matches) mainPane.current?.scrollIntoView({ block: "start" });
    const failure = await enhance.run(source.file, options);
    // The server can lose its credentials after the page loaded; refresh what we know.
    if (failure?.code === STORAGE_NOT_CONFIGURED) capabilities.retry();
    // The plan changed under us (for example the trial ended): re-read it so 4× locks.
    if (isPlanErrorCode(failure?.code)) void refreshPlan();
  }

  function resetOptions() {
    enhance.reset();
    setScale(DEFAULT_SCALE);
    setRemoveBackground(false);
    setResultSize(null);
    setPickError(null);
  }

  const openPicker = () => fileInput.current?.click();

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (!unavailable) choose(event.dataTransfer.files?.[0]);
  };

  const controlsDisabled = busy || unavailable;
  const canRun =
    Boolean(source) && !busy && capabilities.state.status === "ready" && !unavailable && !noOperation && !limitMessage;

  const status = busy
    ? enhance.phase === "uploading"
      ? `Uploading ${enhance.uploadProgress}%`
      : "Enhancing…"
    : enhance.phase === "ready"
      ? "Enhanced image ready."
      : "";

  const runError = enhance.error;
  const notConfigured = runError?.code === STORAGE_NOT_CONFIGURED;
  const upscaleHelp =
    options.scale === null
      ? "Keeps the original size."
      : `${options.scale === 2 ? "Doubles" : "Quadruples"} the width and height.${expected ? ` Output ${formatSize(expected)} px.` : ""}`;

  return (
    <>
      <EnhanceTopbar active="ai" />
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          // Reset so choosing the same file again still fires.
          event.target.value = "";
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-14 md:flex-row md:overflow-hidden md:pb-0">
        <aside
          aria-label="AI enhance settings"
          className="flex flex-none flex-col border-b-[1.5px] border-line bg-surface md:w-[320px] md:border-b-0 md:border-r-[1.5px]"
        >
          <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="oa-panel-sec gap-0.5">
              <h1 className="oa-section">AI enhance</h1>
              <p className="text-[11px] leading-4 text-ink-2">
                Upscale artwork, remove its background, or both.
                {caps?.available ? ` Runs on ${caps.providerLabel}.` : ""}
              </p>
            </div>

            {capabilities.state.status === "error" && (
              <div className="oa-panel-sec">
                <Notice tone="warning" role="alert">
                  <p>Couldn&apos;t check what AI enhance supports. {capabilities.state.message}</p>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={capabilities.retry}>
                    Try again
                  </Button>
                </Notice>
              </div>
            )}

            {unavailable && caps && (
              <div className="oa-panel-sec">
                <Notice tone="warning" role="status">
                  <p className="font-bold">Storage provider not configured</p>
                  <p className="mt-1">{caps.message ?? "AI enhance isn't available on this server."}</p>
                </Notice>
              </div>
            )}

            <section className="oa-panel-sec" aria-labelledby={`${id}-source`}>
              <h2 id={`${id}-source`} className="oa-panel-title">
                Source
              </h2>
              {source ? (
                <div className="flex items-center gap-2.5">
                  <span className="oa-checker flex size-11 flex-none items-center justify-center border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={source.url} alt="" className="max-h-8 max-w-8 object-contain" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="oa-value truncate text-ink" title={source.file.name}>
                      {source.file.name}
                    </span>
                    <span className="text-[11px] leading-4 text-ink-3">
                      {[formatSize(sourceSize), formatBytes(source.file.size)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" aria-label="Replace image" disabled={controlsDisabled} onClick={openPicker}>
                    Replace
                  </Button>
                </div>
              ) : (
                <>
                  <Button variant="secondary" block disabled={controlsDisabled} onClick={openPicker}>
                    <ImageUp aria-hidden />
                    Choose image
                  </Button>
                  <span className="text-[11px] leading-4 text-ink-3">
                    PNG, JPEG or WebP · up to {formatBytes(maxBytes)}
                  </span>
                </>
              )}
              {pickError && (
                <Notice tone="warning" role="alert">
                  {pickError}
                </Notice>
              )}
            </section>

            <section className="oa-panel-sec" aria-labelledby={`${id}-upscale`}>
              <h2 id={`${id}-upscale`} className="oa-panel-title">
                Upscale
              </h2>
              <Segmented
                ariaLabel="Upscale"
                block
                value={scale}
                options={SCALE_OPTIONS.map((option) => ({
                  ...option,
                  disabled: controlsDisabled || (option.value === "4" && (scaleLocked || !planReady)),
                  icon: option.value === "4" && scaleLocked ? <Lock aria-hidden /> : undefined,
                  ariaLabel: option.value === "4" && scaleLocked ? "4×, needs Pro" : undefined,
                }))}
                onChange={setScale}
              />
              <span className="text-[11px] leading-4 text-ink-3">{upscaleHelp}</span>
              {scaleLocked && (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-[11px] leading-4 text-ink-2">
                    4× is part of Pro.{" "}
                    <Link href="/pricing" className="oa-link">
                      See plans
                    </Link>
                  </p>
                  <UpgradeAction />
                </div>
              )}
              {limits && options.scale !== null && (
                <span className="text-[11px] leading-4 text-ink-3">
                  Takes images under {formatMegapixels(limits.maxUpscaleInputPixels)}.
                </span>
              )}
            </section>

            <section className="oa-panel-sec" aria-labelledby={`${id}-background`}>
              <h2 id={`${id}-background`} className="oa-panel-title">
                Background
              </h2>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span id={`${id}-bg-label`} className="oa-field-label">
                    Remove background
                  </span>
                  <span id={`${id}-bg-help`} className="oa-field-help">
                    {options.scale === null
                      ? "Makes the background transparent."
                      : "Runs after the upscale, because upscaling fills in transparency."}
                  </span>
                </div>
                <Switch
                  checked={removeBackground}
                  onCheckedChange={setRemoveBackground}
                  disabled={controlsDisabled}
                  aria-labelledby={`${id}-bg-label`}
                  aria-describedby={`${id}-bg-help`}
                />
              </div>
            </section>

            <section className="oa-panel-sec border-b-0" aria-labelledby={`${id}-output`}>
              <h2 id={`${id}-output`} className="oa-panel-title">
                Output
              </h2>
              <dl className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="oa-field-label">Format</dt>
                  <dd className="oa-value text-ink">PNG</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="oa-field-label">Size</dt>
                  <dd className="oa-value text-ink">{expected ? `${formatSize(expected)} px` : "Set by your image"}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="flex flex-none flex-col gap-2 border-t-[1.5px] border-line bg-surface px-3.5 py-3">
            {runError && (
              <Notice tone={notConfigured ? "warning" : "danger"} role="alert">
                {runError.message}
              </Notice>
            )}
            {!runError && limitMessage && (
              <Notice tone="warning" role="alert">
                {limitMessage}
              </Notice>
            )}
            {!runError && !limitMessage && noOperation && source && (
              <Notice tone="info">Turn on an upscale or remove the background to continue.</Notice>
            )}
            <Button variant="primary" size="lg" block disabled={!canRun} onClick={() => void submit()}>
              {busy && <LoaderCircle aria-hidden className="animate-spin" />}
              {busy ? "Enhancing…" : enhance.phase === "ready" ? "Enhance again" : "Enhance image"}
            </Button>
            <Button variant="ghost" size="sm" className="self-center" disabled={busy} onClick={resetOptions}>
              Reset options
            </Button>
          </div>
        </aside>

        <main
          ref={mainPane}
          aria-label="Comparison"
          className="flex min-h-[420px] flex-col bg-page md:min-h-0 md:min-w-0 md:flex-1 md:overflow-y-auto"
        >
          {unavailable && caps ? (
            <div className="flex flex-1 p-4 md:p-6">
              <EmptyState
                className="flex-1 justify-center"
                icon={<Sparkles aria-hidden className="size-5" />}
                title="AI enhance isn't available here"
                description={`${caps.message ?? "Storage isn't configured on this server."} Ask whoever runs this server to add storage credentials. Cleanup works without them.`}
                actions={
                  <Button asChild variant="primary">
                    <Link href="/enhance/excalibur">Go to cleanup</Link>
                  </Button>
                }
              />
            </div>
          ) : source ? (
            <AiComparePane
              sourceUrl={source.url}
              sourceSize={sourceSize}
              onSourceSize={setSourceSize}
              phase={enhance.phase}
              uploadProgress={enhance.uploadProgress}
              elapsed={enhance.elapsed}
              result={enhance.result}
              resultSize={resultSize}
              onResultSize={setResultSize}
              onCancel={enhance.cancel}
              downloadName={
                enhance.result
                  ? downloadNameFor(source.file.name, enhance.result.job.recipe.operations)
                  : "enhanced.png"
              }
            />
          ) : (
            <div className="flex flex-1 p-4 md:p-6">
              <div
                className="oa-drop flex-1"
                data-over={dragOver}
                onDragEnter={onDragOver}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <span className="oa-icon-box size-12">
                  <Sparkles aria-hidden className="size-6" />
                </span>
                <div className="flex flex-col gap-1">
                  <h2 className="oa-section">Make it bigger, cut it out</h2>
                  <p className="text-xs leading-[18px] text-ink-2">
                    Drop an image here, or choose a file. PNG, JPEG or WebP up to {formatBytes(maxBytes)}.
                  </p>
                </div>
                <Button variant="primary" size="lg" onClick={openPicker}>
                  <ImageUp aria-hidden />
                  Choose image
                </Button>
                {pickError && (
                  <Notice tone="warning" role="alert" className="max-w-sm text-left">
                    {pickError}
                  </Notice>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
