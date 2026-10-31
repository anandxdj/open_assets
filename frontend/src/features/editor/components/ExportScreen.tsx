"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, ChevronLeft, CircleAlert, CircleCheck, Download, ImageOff, Lock, LoaderCircle, Plus } from "lucide-react";
import type { Asset, JobStatus } from "@/types";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Progress, Segmented, Switch } from "@/components/ui/controls";
import { EmptyState, Loading, Notice } from "@/components/ui/feedback";
import { ExportToCollectionButton } from "@/features/collections/components/ExportToCollectionButton";
import { resolveExportNames, saveExportPattern } from "@/features/naming/api";
import { NamingControl } from "@/features/naming/components/NamingControl";
import { useExportPreference } from "@/features/naming/useExportPreference";
import { usePlan, useEntitlement } from "@/features/plans/PlanContext";
import { ProGate } from "@/features/plans/ProGate";
import { ApiRequestError } from "@/lib/api-error";
import {
  DEFAULT_PATTERN,
  applyNamingPattern,
  cropSize,
  isDefaultPattern,
  normalizePattern,
  parsePattern,
  type NamingItem,
} from "@/lib/naming/pattern";
import { isPlanErrorCode } from "@/lib/plans";
import { useJobPolling } from "../hooks/useJobPolling";
import { startFinalize } from "../services/exportApi";
import { sanitize, zipImageUrls } from "../services/localExport";
import { isDialogOpen, isEditableTarget } from "../lib/keyboard";
import { fileNameFromUrl } from "../lib/names";

type TileSize = "s" | "m" | "l";
// Minimum tile width. On a phone the share of the row caps it, so S gives three columns, M two and L one.
const TILE_MIN: Record<TileSize, string> = {
  s: "min(120px, calc(33.333% - 11px))",
  m: "min(168px, calc(50% - 8px))",
  l: "min(240px, 100%)",
};

const CROP_IN_PROGRESS: JobStatus[] = ["detected", "removing_bg", "naming", "cropping"];
const CROP_STEP: Partial<Record<JobStatus, string>> = {
  detected: "Starting the export",
  removing_bg: "Removing the background",
  cropping: "Cutting each box",
  naming: "Naming assets with AI",
};

interface Props {
  jobId: string;
  /** One-click raw export: crop everything, package on the server, download. */
  autoRaw?: boolean;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-2 text-xs text-ink-2">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em]">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function DoneState({
  detail,
  onAgain,
  againHref,
  busy,
}: {
  detail: React.ReactNode;
  onAgain?: () => void;
  againHref?: string;
  busy?: boolean;
}) {
  return (
    <>
      <div className="flex items-start gap-2.5">
        <CircleCheck aria-hidden className="mt-0.5 size-4 flex-none text-success" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium">Download started</span>
          <span className="text-[11px] leading-4 text-ink-2">{detail}</span>
        </span>
      </div>
      <div className="flex gap-2">
        {againHref ? (
          <Button asChild variant="secondary" className="flex-1">
            <a href={againHref} rel="noopener noreferrer">
              Download again
            </a>
          </Button>
        ) : (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onAgain}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            Download again
          </Button>
        )}
        <Button asChild variant="primary" className="flex-1">
          <Link href="/upload">Done</Link>
        </Button>
      </div>
    </>
  );
}

function AssetTile({
  asset,
  fileName,
  selected,
  upscaled,
  scale,
  dims,
  onToggle,
  onMeasure,
}: {
  asset: Asset;
  /** The file name this asset gets in the ZIP. */
  fileName: string;
  selected: boolean;
  upscaled: boolean;
  scale: number;
  dims?: { w: number; h: number };
  onToggle: (id: string) => void;
  onMeasure: (id: string, w: number, h: number) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        className="flex w-full flex-col gap-2 text-left"
        onClick={() => onToggle(asset.id)}
      >
        <span className="oa-tile oa-checker w-full" data-selected={selected || undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.cropped_url}
            alt=""
            draggable={false}
            className="h-[62%] w-[62%] object-contain"
            onLoad={(e) => onMeasure(asset.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
          {selected ? (
            <span aria-hidden className="absolute left-0 top-0 flex size-5 items-center justify-center bg-brand text-brand-fg">
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <span aria-hidden className="absolute left-1.5 top-1.5 size-[18px] border-[1.5px] border-line-strong bg-surface" />
          )}
          {upscaled && (
            <Badge className="absolute right-1.5 top-1.5 bg-surface text-ink">
              {scale}×
            </Badge>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <span className="oa-value truncate text-[12.5px]" title={fileName}>
            {fileName}
          </span>
          <span className="text-[11px] leading-4 tabular-nums text-ink-3">
            {dims ? `${dims.w} × ${dims.h} px` : " "}
            {upscaled && <span className="sr-only">, upscaled</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ExportScreen({ jobId, autoRaw = false }: Props) {
  const { job, loading: jobLoading, error: jobError } = useJobPolling(jobId);

  // null = everything selected (the default once assets arrive).
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [tileSize, setTileSize] = useState<TileSize>("m");
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const [upscaleOn, setUpscaleOn] = useState(false);
  // 2× for everyone; 4× is a Pro entitlement (the server enforces it too).
  const [upscaleScale, setUpscaleScale] = useState<2 | 4>(2);
  const { refresh: refreshPlan, plan } = usePlan();
  const { value: maxUpscale, ready: planReady } = useEntitlement("maxUpscale");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [upscaleTotal, setUpscaleTotal] = useState<number | null>(null);
  const [localDownloading, setLocalDownloading] = useState(false);
  const [lastDownload, setLastDownload] = useState<{ count: number; fileName: string } | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  // Naming: the pattern for this export. Plans with custom patterns start from their saved default
  // (null = not edited here); the server applies and enforces it, this screen only previews.
  const pref = useExportPreference();
  const [patternDraft, setPatternDraft] = useState<string | null>(null);
  const [savingPattern, setSavingPattern] = useState(false);

  // One-click raw export: fire finalize + download exactly once each.
  const autoFinalizedRef = useRef(false);
  const autoDownloadedRef = useRef(false);
  // Upscale path: auto-download the locally zipped upscaled set exactly once.
  const upscaleDownloadedRef = useRef(false);

  const jobAssets = job?.assets;
  const assets = useMemo(() => jobAssets ?? [], [jobAssets]);
  const allIds = useMemo(() => assets.map((a) => a.id), [assets]);
  const selectedIds = useMemo(() => selection ?? new Set(allIds), [selection, allIds]);
  const selectedCount = assets.filter((a) => selectedIds.has(a.id)).length;

  const pattern = pref.allowed ? (patternDraft ?? pref.saved) : DEFAULT_PATTERN;
  const patternOk = parsePattern(pattern).ok;
  const customPattern = pref.allowed && !isDefaultPattern(pattern);
  // Nothing is safe to send while the saved default is still loading or the pattern is invalid.
  const namingBlocked = pref.allowed && (pref.loading || !patternOk);

  const zipName = `assets_${jobId}.zip`;
  const upscaledZipName = `assets_upscaled_${jobId}.zip`;

  // Raw path: auto-finalize ALL crops (skip upscale) as soon as they exist.
  useEffect(() => {
    if (!autoRaw || autoFinalizedRef.current) return;
    if (job?.status === "cropped" && job.assets && job.assets.length > 0) {
      autoFinalizedRef.current = true;
      startFinalize(jobId, job.assets.map((a) => a.id), undefined, true).catch((err) => {
        console.error("Auto-finalize failed:", err);
        // Next poll retries.
        autoFinalizedRef.current = false;
        setAutoError(errorMessage(err, "Packaging failed."));
      });
    }
  }, [autoRaw, job?.status, job?.assets, jobId]);

  // Raw path: trigger the browser download once the ZIP is ready.
  useEffect(() => {
    if (!autoRaw || autoDownloadedRef.current) return;
    if (job?.status === "ready" && job.downloadUrl) {
      autoDownloadedRef.current = true;
      const a = document.createElement("a");
      a.href = job.downloadUrl;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }, [autoRaw, job?.status, job?.downloadUrl]);

  // Zip the upscaled crops locally (the backend produced the upscaled URLs).
  async function zipUpscaledLocally() {
    // `file_name` is what the server's naming pattern gave each asset when the upscale started.
    const items = assets
      .filter((a) => a.upscaled_url)
      .map((a) => ({ name: String(a.name), url: String(a.upscaled_url), fileName: a.file_name }));
    if (items.length === 0) return;
    await zipImageUrls(items, upscaledZipName);
  }

  const autoDownloadUpscaled = useEffectEvent(() => {
    zipUpscaledLocally().catch((err) => {
      console.error("Auto-download upscaled failed:", err);
      toast.error("Could not build the upscaled ZIP", { description: errorMessage(err, "Use Download again.") });
    });
  });

  // Once every selected asset is upscaled (status ready), auto-download the ZIP once.
  useEffect(() => {
    if (job?.status !== "ready" || upscaleDownloadedRef.current) return;
    if (!(job.assets ?? []).some((a) => a.upscaled_url)) return;
    upscaleDownloadedRef.current = true;
    autoDownloadUpscaled();
  }, [job?.status, job?.assets]);

  function changeSelection(next: Set<string>) {
    setSelection(next);
    setLastDownload(null);
  }

  function handleToggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    changeSelection(next);
  }

  function handleToggleAll() {
    changeSelection(selectedCount === assets.length ? new Set() : new Set(allIds));
  }

  function handleMeasure(id: string, w: number, h: number) {
    setDims((prev) => (prev[id] ? prev : { ...prev, [id]: { w, h } }));
  }

  // Local download: zip the selected transparent crops in the browser. Repeatable.
  async function handleLocalDownload() {
    if (selectedCount === 0 || localDownloading || namingBlocked) return;
    const selected = assets.filter((a) => selectedIds.has(a.id));
    if (selected.length === 0) return;
    setLocalDownloading(true);
    try {
      // The default pattern keeps the names exports always had. A custom one is applied by the
      // server (which checks the plan), so the ZIP carries exactly the names it returns.
      let fileNames: Map<string, string> | null = null;
      if (customPattern) {
        const named = await resolveExportNames(jobId, selected.map((a) => a.id), pattern);
        fileNames = new Map(named.files.map((f) => [f.id, f.fileName]));
      }
      const items = selected.map((a) => ({
        name: String(a.name),
        url: String(a.cropped_url),
        fileName: fileNames?.get(a.id),
      }));
      const count = await zipImageUrls(items, zipName);
      setLastDownload({ count, fileName: zipName });
    } catch (err) {
      console.error("Local download failed:", err);
      if (handlePlanError(err)) return;
      toast.error("Could not build the ZIP", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setLocalDownloading(false);
    }
  }

  // Upscale and export: server-side AI upscale (2× or 4×), streamed per asset. One time per job
  // (the backend rejects a second finalize once the job has left "cropped").
  async function handleUpscale() {
    if (selectedCount === 0 || isFinalizing || namingBlocked) return;
    setIsFinalizing(true);
    setUpscaleTotal(selectedCount);
    try {
      // The pattern goes along for plans that have custom ones, so the server names the files
      // as shown here even when it differs from the saved default.
      await startFinalize(
        jobId,
        Array.from(selectedIds),
        undefined,
        false,
        upscaleScale,
        pref.allowed ? normalizePattern(pattern) : undefined,
      );
    } catch (err) {
      console.error("Finalize failed:", err);
      if (err instanceof ApiRequestError && isPlanErrorCode(err.code)) {
        // The plan changed under us (for example the trial ended): fall back to 2× and the
        // default names, and re-read the plan.
        setUpscaleScale(2);
        setPatternDraft(null);
        void refreshPlan();
      }
      toast.error("Could not start upscaling", { description: errorMessage(err, "Try again in a moment.") });
      setIsFinalizing(false);
    }
  }

  // The plan changed under us while naming (for example the trial ended): go back to the default
  // names, re-read the plan so the control locks, and say so. Returns true when it was that.
  function handlePlanError(err: unknown): boolean {
    if (!(err instanceof ApiRequestError) || err.code !== "PLAN_REQUIRED") return false;
    setPatternDraft(null);
    void refreshPlan();
    toast.error("Custom naming patterns need Pro", { description: err.message });
    return true;
  }

  // Keeps the pattern in the field as the default for this account and for future exports.
  async function handleSaveDefault() {
    if (!pref.allowed || !patternOk || savingPattern) return;
    setSavingPattern(true);
    try {
      const next = await saveExportPattern(isDefaultPattern(pattern) ? null : normalizePattern(pattern));
      if (pref.loaded) {
        pref.adopt(next);
        setPatternDraft(null);
      } else {
        pref.reload();
      }
      toast.success("Saved as your default pattern");
    } catch (err) {
      console.error("Saving the naming pattern failed:", err);
      if (handlePlanError(err)) return;
      toast.error("Could not save the pattern", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setSavingPattern(false);
    }
  }

  async function handleDownloadUpscaled() {
    if (localDownloading) return;
    setLocalDownloading(true);
    try {
      await zipUpscaledLocally();
    } catch (err) {
      console.error("Upscaled download failed:", err);
      toast.error("Could not build the upscaled ZIP", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setLocalDownloading(false);
    }
  }

  // Escape clears the selection, Ctrl+A selects every asset.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (assets.length === 0 || e.defaultPrevented) return;
    if (isEditableTarget(e.target) || isDialogOpen()) return;
    if (e.key === "Escape") changeSelection(new Set());
    if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      changeSelection(new Set(allIds));
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const status = job?.status;
  const failed = Boolean(jobError) || status === "failed";
  const fileName = job?.fileName?.trim() || fileNameFromUrl(job?.cloudinaryUrl) || "Sheet";
  const cropInProgress = Boolean(status && CROP_IN_PROGRESS.includes(status));
  const cropDone = assets.length > 0 && !cropInProgress;

  const upscaledIds = new Set(assets.filter((a) => a.upscaled_url).map((a) => a.id));
  const upscaledCount = upscaledIds.size;
  const upscaling = !autoRaw && (status === "finalizing" || isFinalizing) && status !== "ready";
  const upscaleDone = !autoRaw && status === "ready" && upscaledCount > 0;
  const canUpscale = status === "cropped" && !upscaling;
  const upscaleChecked = upscaleDone || upscaling || (canUpscale && upscaleOn);
  const upscaleTarget = upscaleTotal ?? (selectedCount || assets.length);
  const upscalePct = upscaleTarget ? Math.min(100, Math.round((upscaledCount / upscaleTarget) * 100)) : 0;

  // Naming preview, from the same pattern module the server runs. It names the selected assets
  // (all of them when none are selected). Sizes come from the boxes times the upscale factor, as
  // on the server. Once the upscale has started the server's names are fixed: those are shown.
  const namesFixed = upscaling || upscaleDone;
  const previewScale = upscaleDone ? (job?.upscaleScale ?? upscaleScale) : upscaleChecked ? upscaleScale : 1;
  const boxById = new Map((job?.boxes ?? []).map((b) => [b.id, b]));
  const toNamingItem = (a: Asset): NamingItem => {
    const box = boxById.get(a.id);
    const size = box ? cropSize(box, job?.imageWidth ?? 0, job?.imageHeight ?? 0) : null;
    return {
      name: String(a.name),
      ...(size ? { width: size.width * previewScale, height: size.height * previewScale } : {}),
    };
  };
  const selectedAssets = assets.filter((a) => selectedIds.has(a.id));
  const namingContext = { sheet: job?.fileName, scale: previewScale };
  const previewItems = (selectedAssets.length > 0 ? selectedAssets : assets).map(toNamingItem);
  const setNames = namesFixed ? assets.map((a) => a.file_name).filter((n): n is string => Boolean(n)) : [];
  // Until the worker has set them (the first moments of an upscale) the pattern's preview stands in.
  const fixedNames = setNames.length > 0 ? setNames : undefined;
  const tileNames = new Map<string, string>();
  if (customPattern && patternOk && !namesFixed && selectedAssets.length > 0) {
    const named = applyNamingPattern(pattern, selectedAssets.map(toNamingItem), namingContext);
    if (named.ok) selectedAssets.forEach((a, i) => tileNames.set(a.id, named.fileNames[i] ?? ""));
  }
  const tileFileName = (a: Asset) => a.file_name || tileNames.get(a.id) || `${sanitize(String(a.name))}.png`;

  // Raw one-click states.
  const rawReady = status === "ready" && Boolean(job?.downloadUrl);
  const rawPackaging = !rawReady && (status === "cropped" || status === "finalizing");

  let announcement = "";
  if (autoRaw) announcement = rawReady ? "Download started" : rawPackaging ? "Packaging the ZIP" : "Cropping assets";
  else if (upscaling) announcement = `Upscaling ${upscaleTarget} assets`;
  else if (upscaleDone || lastDownload) announcement = "Download started";
  else if (localDownloading) announcement = "Building the ZIP";

  let badge: React.ReactNode = null;
  if (failed) {
    badge = <StatusBadge status="failed" />;
  } else if (assets.length > 0) {
    badge = (
      <Badge tone="success">
        <Check aria-hidden />
        {assets.length} {autoRaw ? "cropped" : "named"}
      </Badge>
    );
  } else if (status) {
    badge = <StatusBadge status={status} />;
  }

  // "with AI" only when the server's storage provider runs an AI upscaler; local storage resizes.
  // Plain until the plan has loaded, so the label never claims more than the server does.
  const upscaleLabel = `Upscale ${upscaleDone ? (job?.upscaleScale ?? upscaleScale) : upscaleScale}×${
    plan?.capabilities?.aiUpscale ? " with AI" : ""
  }`;
  let upscaleHelp = `Runs once per sheet. Tiles show ${upscaleScale}× as they finish.`;
  if (upscaleDone) upscaleHelp = "Done. Your upscaled assets are ready.";
  else if (cropInProgress) upscaleHelp = "Available when cropping finishes.";
  else if (!canUpscale && !upscaling) upscaleHelp = "This sheet is already packaged, so upscaling is off.";

  const scaleLocked = planReady && maxUpscale < 4;
  const showScale = !autoRaw && (canUpscale || (upscaleOn && !upscaleDone));

  const topbar = (
    <Topbar className="gap-2 pl-2 md:gap-3 md:pl-2">
      <Button asChild variant="ghost" icon>
        <Link href="/upload" aria-label="Back to Extract">
          <ChevronLeft aria-hidden />
        </Link>
      </Button>
      <Crumbs
        items={[
          { label: "Extract", href: "/upload" },
          { label: <span className="oa-value text-[13px]">{fileName}</span> },
          { label: "Export" },
        ]}
      />
      <span role="status" className="flex-none">
        {badge}
      </span>
      <span className="flex-1" />
      <Button asChild variant="ghost" size="sm">
        <Link href="/upload">
          <Plus aria-hidden />
          <span className="hidden sm:inline">Extract another</span>
          <span className="sm:hidden">New</span>
        </Link>
      </Button>
    </Topbar>
  );

  if (jobLoading || !job) {
    return (
      <>
        {topbar}
        <div className="flex flex-1 items-center justify-center">
          <Loading label="Loading assets" />
        </div>
      </>
    );
  }

  if (failed) {
    return (
      <>
        {topbar}
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 md:p-6">
          <EmptyState
            tone="danger"
            icon={<CircleAlert aria-hidden />}
            title="Export failed"
            description={jobError ?? job.error ?? "We could not cut the assets from this sheet."}
            actions={
              <Button asChild variant="primary">
                <Link href="/upload">Extract another</Link>
              </Button>
            }
            className="w-full max-w-md"
          />
        </main>
      </>
    );
  }

  const allSelected = assets.length > 0 && selectedCount === assets.length;

  return (
    <>
      {topbar}
      <h1 className="sr-only">Export {fileName}</h1>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <main className="min-w-0 flex-none bg-page px-4 pb-10 pt-5 md:px-6 lg:flex-1 lg:overflow-y-auto">
          {assets.length === 0 ? (
            cropInProgress ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <div className="oa-float w-[min(320px,100%)] flex-col items-stretch gap-2 p-5">
                  <span className="oa-section flex items-center gap-2.5">
                    <LoaderCircle aria-hidden className="size-4 animate-spin text-info" />
                    Cropping assets
                  </span>
                  <p className="text-xs leading-[18px] text-ink-2">
                    {(status && CROP_STEP[status]) ?? "Working on it"}. Your assets appear here when they are cut.
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                className="mt-6"
                icon={<ImageOff aria-hidden />}
                title="No assets to export"
                description="Nothing was cut from this sheet. Start again and draw boxes around the assets you want."
                actions={
                  <Button asChild variant="primary">
                    <Link href="/upload">Extract another</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedCount > 0 && !allSelected}
                    onChange={handleToggleAll}
                  />
                  <span className="sr-only">Select all, </span>
                  <span className="tabular-nums">
                    {selectedCount} of {assets.length} selected
                  </span>
                </label>
                <span className="flex-1" />
                <Segmented<TileSize>
                  ariaLabel="Tile size"
                  value={tileSize}
                  onChange={setTileSize}
                  options={[
                    { value: "s", label: "S", ariaLabel: "Small tiles" },
                    { value: "m", label: "M", ariaLabel: "Medium tiles" },
                    { value: "l", label: "L", ariaLabel: "Large tiles" },
                  ]}
                />
              </div>
              <ul
                aria-label="Assets"
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN[tileSize]}, 1fr))` }}
              >
                {assets.map((asset) => (
                  <AssetTile
                    key={asset.id}
                    asset={asset}
                    fileName={tileFileName(asset)}
                    selected={selectedIds.has(asset.id)}
                    upscaled={upscaledIds.has(asset.id)}
                    scale={job.upscaleScale ?? upscaleScale}
                    dims={dims[asset.id]}
                    onToggle={handleToggle}
                    onMeasure={handleMeasure}
                  />
                ))}
              </ul>
            </>
          )}
        </main>

        <aside
          aria-label="Export settings"
          className="flex w-full flex-none flex-col border-t-[1.5px] border-line bg-surface lg:w-[320px] lg:border-l-[1.5px] lg:border-t-0"
        >
          <h2 className="oa-panel-head">Export</h2>
          <div className="min-h-0 flex-1 lg:overflow-y-auto">
            <div className="oa-panel-sec">
              <h3 className="oa-panel-title">Output</h3>
              <dl className="flex flex-col gap-2.5">
                {autoRaw ? (
                  <>
                    <Prop label="Format">PNG</Prop>
                    <Prop label="Names">Your box labels</Prop>
                    <Prop label="Delivery">One ZIP, downloads on its own</Prop>
                  </>
                ) : (
                  <>
                    <Prop label="Format">PNG, transparent</Prop>
                    <Prop label="Names">
                      {(namesFixed ? job.namingPattern && !isDefaultPattern(job.namingPattern) : customPattern) ? (
                        <>
                          Your pattern, <span className="oa-value break-all">{namesFixed ? job.namingPattern : pattern}</span>
                        </>
                      ) : (
                        <>
                          AI names, duplicates get <span className="oa-value">_2</span>
                        </>
                      )}
                    </Prop>
                    <Prop label="File">
                      <span className="oa-value block truncate">{upscaleChecked ? upscaledZipName : zipName}</span>
                    </Prop>
                  </>
                )}
              </dl>
            </div>

            {!autoRaw && (
              <div className="oa-panel-sec">
                <h3 className="oa-panel-title">Naming</h3>
                <NamingControl
                  value={namesFixed ? (job.namingPattern ?? DEFAULT_PATTERN) : pattern}
                  onChange={setPatternDraft}
                  items={previewItems}
                  context={namingContext}
                  mode={pref.mode}
                  frozenNote={namesFixed ? "Names were set when the upscale started." : undefined}
                  fixedNames={fixedNames}
                >
                  <Button
                    size="sm"
                    disabled={!patternOk || normalizePattern(pattern) === pref.saved || savingPattern || namesFixed}
                    aria-busy={savingPattern || undefined}
                    onClick={() => void handleSaveDefault()}
                  >
                    {savingPattern && <LoaderCircle aria-hidden className="animate-spin" />}
                    Save as default
                  </Button>
                </NamingControl>
              </div>
            )}

            {!autoRaw && (
              <div className="oa-panel-sec">
                <h3 className="oa-panel-title">Upscale</h3>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium">
                      {upscaleLabel}
                    </span>
                    <span id="upscale-help" className="text-[11px] leading-4 text-ink-2">
                      {upscaleHelp}
                    </span>
                  </span>
                  <Switch
                    checked={upscaleChecked}
                    onCheckedChange={setUpscaleOn}
                    disabled={!canUpscale}
                    aria-label={upscaleLabel}
                    aria-describedby="upscale-help"
                  />
                </div>
                {showScale && (
                  <div className="mt-3 flex flex-col gap-2">
                    <span className="oa-field-label">Factor</span>
                    <Segmented<"2" | "4">
                      ariaLabel="Upscale factor"
                      value={String(upscaleScale) as "2" | "4"}
                      onChange={(v) => setUpscaleScale(v === "4" ? 4 : 2)}
                      options={[
                        { value: "2", label: "2×", disabled: !canUpscale },
                        {
                          value: "4",
                          label: "4×",
                          icon: scaleLocked ? <Lock aria-hidden /> : undefined,
                          ariaLabel: scaleLocked ? "4×, needs Pro" : undefined,
                          disabled: !canUpscale || scaleLocked || !planReady,
                        },
                      ]}
                    />
                    {scaleLocked && <ProGate feature="4× upscale" />}
                  </div>
                )}
              </div>
            )}

            <div className="oa-panel-sec border-b-0">
              <h3 className="oa-panel-title">Also save to a collection</h3>
              <p className="text-[11px] leading-4 text-ink-2">
                Adds the selected assets to one of your collections.
                {customPattern && !autoRaw ? " Their names follow your naming pattern." : ""}
              </p>
              <div className="self-start">
                <ExportToCollectionButton
                  jobId={jobId}
                  selectedIds={Array.from(selectedIds)}
                  disabled={!cropDone || selectedCount === 0 || namingBlocked}
                  namingPattern={pref.allowed && !autoRaw ? normalizePattern(pattern) : undefined}
                />
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 flex flex-none flex-col gap-2 border-t-[1.5px] border-line bg-surface px-3.5 py-3">
            <p role="status" className="sr-only">
              {announcement}
            </p>
            {autoRaw ? (
              rawReady ? (
                <DoneState
                  againHref={job.downloadUrl}
                  detail={`${assets.length} PNG${assets.length === 1 ? "" : "s"} in one ZIP.`}
                />
              ) : (
                <>
                  <div className="flex items-start gap-2.5">
                    <LoaderCircle aria-hidden className="mt-0.5 size-4 flex-none animate-spin text-info" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium">{rawPackaging ? "Packaging the ZIP" : "Cropping assets"}</span>
                      <span className="text-[11px] leading-4 text-ink-2">
                        {rawPackaging ? "Bundling every asset into one archive." : "Cutting every box from the sheet."} The
                        ZIP downloads when it is ready.
                      </span>
                    </span>
                  </div>
                  {autoError && status === "cropped" && (
                    <Notice tone="danger" className="text-[11px] leading-4">
                      Packaging failed: {autoError} Trying again.
                    </Notice>
                  )}
                </>
              )
            ) : upscaling ? (
              <>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium tabular-nums">
                    Upscaling {upscaledCount} of {upscaleTarget}
                  </span>
                  <span className="oa-value tabular-nums text-ink-2">{upscalePct}%</span>
                </div>
                <Progress value={upscalePct} label="Upscaling progress" />
                <p className="text-[11px] leading-4 text-ink-2">The ZIP downloads when it finishes.</p>
              </>
            ) : upscaleDone ? (
              <DoneState
                busy={localDownloading}
                onAgain={() => void handleDownloadUpscaled()}
                detail={
                  <>
                    {upscaledCount} upscaled PNG{upscaledCount === 1 ? "" : "s"} ·{" "}
                    <span className="oa-value">{upscaledZipName}</span>
                  </>
                }
              />
            ) : lastDownload ? (
              <DoneState
                busy={localDownloading}
                onAgain={() => void handleLocalDownload()}
                detail={
                  <>
                    {lastDownload.count} PNG{lastDownload.count === 1 ? "" : "s"} ·{" "}
                    <span className="oa-value">{lastDownload.fileName}</span>
                  </>
                }
              />
            ) : (
              <Button
                variant={cropDone && selectedCount > 0 && !namingBlocked ? "primary" : "secondary"}
                size="lg"
                block
                disabled={!cropDone || selectedCount === 0 || localDownloading || namingBlocked}
                onClick={() => void (upscaleChecked ? handleUpscale() : handleLocalDownload())}
              >
                {localDownloading ? (
                  <>
                    <LoaderCircle aria-hidden className="animate-spin" />
                    Building the ZIP
                  </>
                ) : (
                  <>
                    <Download aria-hidden />
                    {upscaleChecked ? "Upscale and download" : "Download"} {selectedCount} asset{selectedCount === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
