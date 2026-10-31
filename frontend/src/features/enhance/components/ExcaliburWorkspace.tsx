"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Check, Download, ImageUp, LoaderCircle, Wand } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Range, Segmented } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { EnhanceTopbar } from "@/features/enhance/components/EnhanceTopbar";

type Background = "transparent" | "white" | "dark";
interface Recipe {
  cleanup: number;
  speckRemoval: number;
  contrast: number;
  background: Background;
  scale: 1 | 2 | 3;
}
type Size = { width: number; height: number };

const defaults: Recipe = { cleanup: 4, speckRemoval: 1, contrast: 1, background: "transparent", scale: 1 };

const ACCEPT = "image/svg+xml,image/png,image/jpeg,image/webp";
const ACCEPTED_TYPES = ACCEPT.split(",");
const ACCEPTED_NAME = /\.(svg|png|jpe?g|webp)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

const BACKGROUND_OPTIONS = [
  { value: "transparent" as const, label: "Transparent" },
  { value: "white" as const, label: "White" },
  { value: "dark" as const, label: "Dark" },
];
const SCALE_OPTIONS = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSize(size: Size | null): string {
  return size ? `${size.width} × ${size.height}` : "";
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "artwork";
}

function naturalSize(image: HTMLImageElement): Size {
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export function ExcaliburWorkspace() {
  const id = useId();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mainPane = useRef<HTMLElement | null>(null);
  // Object URLs are revoked when they are replaced and when the page unmounts.
  const live = useRef<{ source: string | null; result: string | null }>({ source: null, result: null });

  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [sourceSize, setSourceSize] = useState<Size | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<Size | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const urls = live.current;
    return () => {
      if (urls.source) URL.revokeObjectURL(urls.source);
      if (urls.result) URL.revokeObjectURL(urls.result);
    };
  }, []);

  function replaceResult(url: string | null) {
    const urls = live.current;
    if (urls.result) URL.revokeObjectURL(urls.result);
    urls.result = url;
    setResultUrl(url);
    setResultSize(null);
  }

  function choose(file: File | null | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_NAME.test(file.name)) {
      setError("Choose an SVG, PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 20 MB. Choose a smaller image.");
      return;
    }
    const urls = live.current;
    if (urls.source) URL.revokeObjectURL(urls.source);
    const url = URL.createObjectURL(file);
    urls.source = url;
    setSource({ file, url });
    setSourceSize(null);
    replaceResult(null);
    setError(null);
  }

  async function submit() {
    if (!source) return;
    setError(null);
    // On a phone the comparison sits below the settings; bring it into view.
    if (window.matchMedia("(max-width: 767px)").matches) mainPane.current?.scrollIntoView({ block: "start" });
    const form = new FormData();
    form.append("image", source.file);
    form.append("cleanup", String(recipe.cleanup));
    form.append("speckRemoval", String(recipe.speckRemoval));
    form.append("contrast", String(recipe.contrast));
    form.append("background", recipe.background);
    form.append("scale", String(recipe.scale));
    try {
      setBusy(true);
      const blob = await apiClient.postFormBlob("/api/enhance/excalibur", form);
      replaceResult(URL.createObjectURL(blob));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not enhance the image. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRecipe(defaults);
    replaceResult(null);
    setError(null);
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
    choose(event.dataTransfer.files?.[0]);
  };

  const status = busy ? "Cleaning lines…" : resultUrl ? "Enhanced image ready." : "";
  const downloadName = source ? `${baseName(source.file.name)}-enhanced.png` : "enhanced.png";

  return (
    <>
      <EnhanceTopbar active="cleanup" />
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
          aria-label="Cleanup settings"
          className="flex flex-none flex-col border-b-[1.5px] border-line bg-surface md:w-[320px] md:border-b-0 md:border-r-[1.5px]"
        >
          <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="oa-panel-sec gap-0.5">
              <h1 className="oa-section">Cleanup</h1>
              <p className="text-[11px] leading-4 text-ink-2">
                Sharpen lines and remove specks. No AI: the same settings always give the same result.
              </p>
            </div>

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
                  <Button variant="ghost" size="sm" aria-label="Replace image" onClick={openPicker}>
                    Replace
                  </Button>
                </div>
              ) : (
                <>
                  <Button variant="secondary" block onClick={openPicker}>
                    <ImageUp aria-hidden />
                    Choose image
                  </Button>
                  <span className="text-[11px] leading-4 text-ink-3">SVG, PNG, JPEG or WebP · up to 20 MB</span>
                </>
              )}
            </section>

            <section className="oa-panel-sec" aria-labelledby={`${id}-adjust`}>
              <h2 id={`${id}-adjust`} className="oa-panel-title">
                Adjust
              </h2>
              <Field
                label="Stroke clarity"
                htmlFor={`${id}-clarity`}
                aside={<span className="oa-value text-ink">{recipe.cleanup}</span>}
              >
                <Range
                  id={`${id}-clarity`}
                  min={0}
                  max={10}
                  step={1}
                  value={recipe.cleanup}
                  aria-valuetext={`${recipe.cleanup} of 10`}
                  onChange={(event) => setRecipe({ ...recipe, cleanup: Number(event.target.value) })}
                />
              </Field>
              <Field
                label="Speck removal"
                htmlFor={`${id}-specks`}
                aside={<span className="oa-value text-ink">{recipe.speckRemoval}</span>}
              >
                <Range
                  id={`${id}-specks`}
                  min={0}
                  max={10}
                  step={1}
                  value={recipe.speckRemoval}
                  aria-valuetext={`${recipe.speckRemoval} of 10`}
                  onChange={(event) => setRecipe({ ...recipe, speckRemoval: Number(event.target.value) })}
                />
              </Field>
              <Field
                label="Contrast"
                htmlFor={`${id}-contrast`}
                aside={<span className="oa-value text-ink">{recipe.contrast.toFixed(1)}×</span>}
              >
                <Range
                  id={`${id}-contrast`}
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={recipe.contrast}
                  aria-valuetext={`${recipe.contrast.toFixed(1)} times`}
                  onChange={(event) => setRecipe({ ...recipe, contrast: Number(event.target.value) })}
                />
              </Field>
            </section>

            <section className="oa-panel-sec border-b-0" aria-labelledby={`${id}-output`}>
              <h2 id={`${id}-output`} className="oa-panel-title">
                Output
              </h2>
              <div className="oa-field">
                <span className="oa-field-label" aria-hidden>
                  Background
                </span>
                <Segmented
                  ariaLabel="Background"
                  block
                  value={recipe.background}
                  options={BACKGROUND_OPTIONS}
                  onChange={(background) => setRecipe({ ...recipe, background })}
                />
              </div>
              <div className="oa-field">
                <span className="oa-field-label" aria-hidden>
                  Scale
                </span>
                <Segmented
                  ariaLabel="Output scale"
                  block
                  value={String(recipe.scale)}
                  options={SCALE_OPTIONS}
                  onChange={(scale) => setRecipe({ ...recipe, scale: Number(scale) as Recipe["scale"] })}
                />
              </div>
            </section>
          </div>

          <div className="flex flex-none flex-col gap-2 border-t-[1.5px] border-line bg-surface px-3.5 py-3">
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button variant={resultUrl && !busy ? "secondary" : "primary"} size="lg" block disabled={!source || busy} onClick={() => void submit()}>
              {busy && <LoaderCircle aria-hidden className="animate-spin" />}
              {busy ? "Enhancing…" : error && source ? "Try again" : resultUrl ? "Enhance again" : "Enhance image"}
            </Button>
            <Button variant="ghost" size="sm" className="self-center" onClick={reset}>
              Reset controls
            </Button>
          </div>
        </aside>

        <main ref={mainPane} aria-label="Comparison" className="flex min-h-[420px] flex-col bg-page md:min-h-0 md:min-w-0 md:flex-1 md:overflow-y-auto">
          {source ? (
            <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-px bg-line">
              <figure className="flex min-h-[340px] flex-col bg-page">
                <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
                  <span className="oa-label text-ink">Original</span>
                  <span className="oa-value text-ink-3">{formatSize(sourceSize)}</span>
                </figcaption>
                <div className="oa-checker relative mx-4 mb-4 min-h-[300px] flex-1 overflow-hidden border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={source.url}
                    alt="Original artwork"
                    onLoad={(event) => setSourceSize(naturalSize(event.currentTarget))}
                    className="absolute inset-0 size-full object-contain p-6"
                  />
                </div>
              </figure>

              <figure className="flex min-h-[340px] flex-col bg-page">
                <figcaption className="flex h-10 flex-none items-center justify-between gap-3 px-4">
                  <span className="flex items-center gap-2">
                    <span className="oa-label text-ink">Enhanced</span>
                    {resultUrl && !busy && (
                      <Badge tone="success">
                        <Check aria-hidden />
                        Done
                      </Badge>
                    )}
                  </span>
                  <span className="oa-value text-ink-3">{resultUrl && !busy ? formatSize(resultSize) : ""}</span>
                </figcaption>
                <div className="oa-checker relative mx-4 mb-4 flex min-h-[300px] flex-1 items-center justify-center overflow-hidden border border-line">
                  {busy ? (
                    <div className="flex flex-col items-center gap-2.5">
                      <LoaderCircle aria-hidden className="size-8 animate-spin text-ink" />
                      <span className="text-xs leading-[18px] text-ink-2">Cleaning lines…</span>
                    </div>
                  ) : resultUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resultUrl}
                        alt="Enhanced artwork"
                        onLoad={(event) => setResultSize(naturalSize(event.currentTarget))}
                        className="absolute inset-0 size-full object-contain p-6 pb-16"
                      />
                      <div className="oa-float absolute bottom-3 left-1/2 -translate-x-1/2 gap-1.5 p-1.5">
                        <Button asChild variant="primary" size="sm">
                          <a href={resultUrl} download={downloadName}>
                            <Download aria-hidden />
                            Download PNG
                          </a>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="max-w-[240px] px-4 text-center text-xs leading-[18px] text-ink-2">
                      Choose your settings, then press Enhance image to see the result here.
                    </p>
                  )}
                </div>
              </figure>
            </div>
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
                  <Wand aria-hidden className="size-6" />
                </span>
                <div className="flex flex-col gap-1">
                  <h2 className="oa-section">Polish the lines, keep the intent</h2>
                  <p className="text-xs leading-[18px] text-ink-2">
                    Drop an image here, or choose a file. SVG, PNG, JPEG or WebP up to 20 MB.
                  </p>
                </div>
                <Button size="lg" onClick={openPicker}>
                  <ImageUp aria-hidden />
                  Choose image
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
