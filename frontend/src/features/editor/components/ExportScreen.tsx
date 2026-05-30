"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  Loader2,
  Sparkles,
  Archive,
  Plus,
} from "lucide-react";
import { useJobPolling } from "@/features/editor/hooks/useJobPolling";
import { useExportCanvas } from "@/features/editor/hooks/useExportCanvas";
import { startFinalize } from "@/features/editor/services/exportApi";
import { zipImageUrls } from "@/features/editor/services/localExport";
import { ExportCanvas, CELL, GAP, COLS, LABEL_HEIGHT } from "./ExportCanvas";
import { ZoomControls } from "./ZoomControls";
import { Toolbar } from "./Toolbar";
import { ExportToCollectionButton } from "@/features/collections/components/ExportToCollectionButton";

interface Props {
  jobId: string;
  autoRaw?: boolean;
}

export function ExportScreen({ jobId, autoRaw = false }: Props) {
  const router = useRouter();
  const { job, loading: jobLoading, error: jobError } = useJobPolling(jobId);
  const { camera, setCamera, fitToScreen, activeTool, setActiveTool } = useExportCanvas();
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initializedSelection, setInitializedSelection] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [localDownloading, setLocalDownloading] = useState(false);

  // One-click raw export: fire finalize + download exactly once each.
  const autoFinalizedRef = useRef(false);
  const autoDownloadedRef = useRef(false);
  // Upscale path: auto-download the locally-zipped upscaled set exactly once.
  const upscaleDownloadedRef = useRef(false);

  // Raw path: auto-finalize ALL crops (skip upscale) as soon as they exist.
  useEffect(() => {
    if (!autoRaw || autoFinalizedRef.current) return;
    if (job?.status === "cropped" && job.assets && job.assets.length > 0) {
      autoFinalizedRef.current = true;
      setIsFinalizing(true);
      startFinalize(jobId, job.assets.map((a) => a.id), undefined, true).catch((err) => {
        console.error("Auto-finalize failed:", err);
        autoFinalizedRef.current = false;
        setIsFinalizing(false);
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

  // Select all by default once assets arrive; also fit canvas
  useEffect(() => {
    if (job?.assets && job.assets.length > 0 && !initializedSelection) {
      const assets = job.assets;
      setSelectedIds(new Set(assets.map((a) => a.id)));
      setInitializedSelection(true);

      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const { offsetWidth: w, offsetHeight: h } = containerRef.current;
        const count = assets.length;
        const cols = Math.min(count, COLS);
        const rows = Math.ceil(count / COLS);
        const contentW = cols * CELL + (cols - 1) * GAP;
        const contentH = rows * (CELL + LABEL_HEIGHT) + (rows - 1) * GAP;
        fitToScreen(w, h, contentW, contentH + rows * LABEL_HEIGHT);
      });
    }
  }, [job, initializedSelection, fitToScreen]);

  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = () => {
    if (!job?.assets) return;
    if (selectedIds.size === job.assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(job.assets.map((a) => a.id)));
    }
  };

  const handleZoom = useCallback(
    (newZoom: number) => {
      if (!containerRef.current) return;
      const { offsetWidth: w, offsetHeight: h } = containerRef.current;
      const cx = w / 2;
      const cy = h / 2;
      const cam = camera;
      const wx = (cx - cam.x) / cam.zoom;
      const wy = (cy - cam.y) / cam.zoom;
      const clamped = Math.max(0.05, Math.min(10, newZoom));
      setCamera({ zoom: clamped, x: cx - wx * clamped, y: cy - wy * clamped });
    },
    [camera, setCamera],
  );

  const handleFitToScreen = useCallback(() => {
    if (!containerRef.current || !job?.assets) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    const count = job.assets.length;
    const cols = Math.min(count, COLS);
    const rows = Math.ceil(count / COLS);
    const contentW = cols * CELL + (cols - 1) * GAP;
    const contentH = rows * (CELL + LABEL_HEIGHT) + (rows - 1) * GAP;
    fitToScreen(w, h, contentW, contentH + rows * LABEL_HEIGHT);
  }, [job, fitToScreen]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if (!inInput && job?.assets) {
        if (e.key === "h" || e.key === "H") setActiveTool("hand");
        if (e.key === "v" || e.key === "V") setActiveTool("select");
        if (e.key === "Escape") {
          setSelectedIds(new Set());
        }
        if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setSelectedIds(new Set(job.assets.map((a) => a.id)));
        }
        if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleFitToScreen();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [job, setActiveTool, handleFitToScreen]);

  // Local download: zip the selected transparent crops in the browser. Repeatable.
  const handleLocalDownload = async () => {
    if (selectedIds.size === 0 || localDownloading) return;
    const items = (job?.assets ?? [])
      .filter((a) => selectedIds.has(a.id))
      .map((a) => ({ name: String(a.name), url: String(a.cropped_url) }));
    if (items.length === 0) return;
    try {
      setLocalDownloading(true);
      await zipImageUrls(items, `assets_${jobId}.zip`);
    } catch (err) {
      console.error("Local download failed:", err);
    } finally {
      setLocalDownloading(false);
    }
  };

  // Upscale & export: server-side cloud upscale (per-asset, streamed). One-time per job
  // (the backend rejects a second finalize once the job has left the "cropped" state).
  const handleFinalize = async (skipUpscale: boolean) => {
    if (selectedIds.size === 0) return;
    try {
      setIsFinalizing(true);
      await startFinalize(jobId, Array.from(selectedIds), undefined, skipUpscale);
    } catch (err) {
      console.error("Finalize failed:", err);
      setIsFinalizing(false);
    }
  };

  // Zip the upscaled crops locally (the backend just produced the upscaled URLs).
  const zipUpscaledLocally = async () => {
    const items = (job?.assets ?? [])
      .filter((a) => a.upscaled_url)
      .map((a) => ({ name: String(a.name), url: String(a.upscaled_url) }));
    if (items.length === 0) return;
    await zipImageUrls(items, `assets_upscaled_${jobId}.zip`);
  };

  const handleDownloadUpscaled = async () => {
    if (localDownloading) return;
    try {
      setLocalDownloading(true);
      await zipUpscaledLocally();
    } catch (err) {
      console.error("Upscaled download failed:", err);
    } finally {
      setLocalDownloading(false);
    }
  };

  // Once every selected asset is upscaled (status ready), auto-download the zip — once.
  useEffect(() => {
    if (job?.status !== "ready" || upscaleDownloadedRef.current) return;
    if (!(job.assets ?? []).some((a) => a.upscaled_url)) return;
    upscaleDownloadedRef.current = true;
    zipUpscaledLocally().catch((err) => console.error("Auto-download upscaled failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.assets, jobId]);

  const upscaledCount = (job?.assets ?? []).filter((a) => a.upscaled_url).length;
  const upscaledIds = new Set((job?.assets ?? []).filter((a) => a.upscaled_url).map((a) => a.id));
  const isUpscaling = (job?.status === "finalizing" || isFinalizing) && job?.status !== "ready";
  const upscaleReady = job?.status === "ready";

  if (jobLoading || !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050506] font-mono gap-4 select-none">
        <Loader2 className="h-8 w-8 text-[#00ff66] animate-spin" />
        <p className="text-xs text-zinc-500 uppercase tracking-widest">Loading compilation slices...</p>
      </div>
    );
  }

  if (jobError || job.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050506] font-mono gap-4 p-6 text-center">
        <p className="text-sm text-red-400 font-bold border border-red-900/35 bg-red-950/10 px-4 py-2.5 rounded">
          {jobError || job.error || "Failed to segment compilation sprites"}
        </p>
        <Link
          href={`/editor/${jobId}`}
          className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white px-4 py-2 transition-colors font-bold uppercase tracking-wider"
        >
          Return to Canvas Editor
        </Link>
      </div>
    );
  }

  const assets = job.assets || [];
  const cropInProgress = ["detected", "removing_bg", "naming", "cropping"].includes(job.status);

  // One-click raw export: minimal progress panel (crop → package → download).
  if (autoRaw) {
    const ready = job.status === "ready" && !!job.downloadUrl;
    const packaging = !ready && (job.status === "cropped" || job.status === "finalizing" || isFinalizing);
    const label = ready ? "Download started" : packaging ? "Packaging ZIP…" : "Cropping assets…";
    const sub = ready
      ? "Your ZIP should begin downloading automatically."
      : packaging
        ? "Bundling every slice into a single archive."
        : "Slicing every bound from the sheet.";

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050506] font-mono gap-6 select-none px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          {ready ? (
            <Download className="h-9 w-9 text-[#00ff66]" />
          ) : (
            <Loader2 className="h-9 w-9 text-[#00ff66] animate-spin" />
          )}
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-[#00ff66]">{label}</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1.5">{sub}</p>
          </div>
        </div>

        {ready && (
          <div className="flex items-center gap-3">
            <a
              href={job.downloadUrl}
              className="py-3 px-5 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10px] flex items-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-[#00ff66] transition-all duration-200 rounded-md"
            >
              <Download className="h-4 w-4 stroke-[2.5px]" />
              Download ZIP
            </a>
            <button
              onClick={() => router.push(`/editor/${jobId}`)}
              className="py-3 px-3 bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors text-[10px] uppercase font-bold tracking-wider rounded-md"
            >
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#050506] text-zinc-100 font-mono select-none overflow-hidden">
      {/* Header */}
      <header className="shrink-0 z-40 border-b border-zinc-900/90 bg-[#050506]/85 backdrop-blur-md">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xs font-black uppercase tracking-widest text-zinc-200 flex items-center gap-2">
              <Archive className="h-4 w-4 text-[#ff7c00]" />
              Slice Compilation Review
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/upload"
              className="text-[9.5px] text-black bg-[#00ff66] hover:bg-[#00e55b] uppercase font-black border border-[#00ff66] px-3 py-1.5 rounded cursor-pointer transition-colors flex items-center gap-1.5 hover:shadow-[0_0_14px_rgba(0,255,102,0.35)]"
            >
              <Plus className="h-3 w-3 stroke-[3px]" />
              Create More
            </Link>
            <button
              onClick={handleToggleAll}
              className="text-[9.5px] text-zinc-400 hover:text-white uppercase font-bold border border-zinc-900 bg-zinc-950/40 px-3 py-1.5 rounded cursor-pointer hover:border-zinc-800 transition-colors"
            >
              {selectedIds.size === assets.length ? "Deselect All" : "Select All"}
            </button>
            <span className="text-[10px] text-[#ff7c00] font-black border border-[#ff7c00]/20 bg-[#ff7c00]/5 px-2.5 py-1.5 rounded uppercase tracking-wider">
              {selectedIds.size} / {assets.length} Selected
            </span>
          </div>
        </div>
      </header>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {assets.length === 0 ? (
          cropInProgress ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
              <Loader2 className="h-8 w-8 text-[#00ff66] animate-spin" />
              <p className="text-xs text-zinc-500 uppercase tracking-widest">Cropping assets…</p>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-zinc-500 space-y-4 flex-col">
              <p>No transparent segmented slices generated.</p>
              <Link
                href={`/editor/${jobId}`}
                className="underline text-[#ff7c00] hover:text-orange-400 uppercase font-black tracking-widest"
              >
                Return to editor and draw layers →
              </Link>
            </div>
          )
        ) : (
          <>
            <ExportCanvas
              assets={assets}
              selectedIds={selectedIds}
              camera={camera}
              onCameraChange={setCamera}
              onToggle={handleToggle}
              activeTool={activeTool}
              onSetActiveTool={setActiveTool}
              onSetSelectedIds={setSelectedIds}
              upscaledIds={upscaledIds}
            />
            <ZoomControls
              zoom={camera.zoom}
              onZoom={handleZoom}
              onFit={handleFitToScreen}
            />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
              <Toolbar activeTool={activeTool} onToolChange={setActiveTool} excludeDraw />
            </div>
          </>
        )}
      </div>


      {/* Footer */}
      <footer className="shrink-0 z-40 border-t border-zinc-800/85 bg-black/80 backdrop-blur-lg py-4 px-6 flex items-center justify-between gap-4 font-mono select-none">
        <div className="text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed">
          <span className="text-zinc-400 font-black">{selectedIds.size}</span> asset{selectedIds.size !== 1 ? "s" : ""} selected
          <br />
          <span className="text-[8px]">Hold Space + drag to pan · Scroll to zoom</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Push the selected crops into a public collection (or auto-scaffolded draft). */}
          <ExportToCollectionButton jobId={jobId} selectedIds={Array.from(selectedIds)} />

          {/* Permanent: local zip download of the selected transparent AI crops. Repeatable. */}
          <button
            onClick={handleLocalDownload}
            disabled={selectedIds.size === 0 || localDownloading}
            className="py-3 px-5 bg-zinc-900 text-zinc-300 font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-zinc-800 hover:text-white border border-zinc-700 hover:border-zinc-600 transition-all duration-200 cursor-pointer rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {localDownloading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Zipping...
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Download Selected ({selectedIds.size})
              </>
            )}
          </button>

          {/* Upscale controls — stateful (one-time cloud upscale, then local re-download). */}
          {isUpscaling ? (
            <div className="flex items-center gap-3 px-5 py-3 border border-zinc-800 bg-zinc-950/80 rounded-md select-none min-w-[240px]">
              <Loader2 className="h-4 w-4 text-[#00ff66] animate-spin shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-[9px] font-black tracking-widest text-[#00ff66] uppercase block animate-pulse">
                  Upscaling {upscaledCount} / {selectedIds.size || assets.length}…
                </span>
                <span className="text-[8px] text-zinc-500 block leading-none mt-0.5">
                  Cloud 2× upscale — slices light up as they finish
                </span>
              </div>
            </div>
          ) : upscaleReady ? (
            <>
              <button
                onClick={handleDownloadUpscaled}
                disabled={localDownloading}
                className="py-3 px-5 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-[#00ff66] transition-all duration-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="h-3.5 w-3.5 text-black" />
                Download Upscaled ZIP
              </button>
              <button
                onClick={() => router.push(`/editor/${jobId}`)}
                className="py-3 px-3 bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-colors text-[10px] uppercase font-bold tracking-wider rounded-md"
              >
                Done
              </button>
            </>
          ) : (
            <button
              onClick={() => handleFinalize(false)}
              disabled={selectedIds.size === 0 || localDownloading}
              className="py-3 px-5 bg-[#00ff66] text-black font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-1.5 hover:bg-[#00e55b] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] border border-[#00ff66] transition-all duration-200 cursor-pointer rounded-md disabled:bg-zinc-900 disabled:border-zinc-900 disabled:text-zinc-600 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Sparkles className="h-3.5 w-3.5 text-black animate-pulse" />
              Upscale & Export ({selectedIds.size})
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
