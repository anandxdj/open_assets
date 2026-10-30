"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, CircleAlert, Keyboard, LoaderCircle, Redo2, TriangleAlert, Undo2 } from "lucide-react";
import type { JobStatus } from "@/types";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/feedback";
import { useEntitlement, usePlan } from "@/features/plans/PlanContext";
import { redetectJob, type DetectionMode } from "@/features/upload/services/uploadApi";
import { ApiRequestError } from "@/lib/api-error";
import { DETECTION_LIMITS, isPlanErrorCode } from "@/lib/plans";
import { useJobPolling } from "../hooks/useJobPolling";
import { useCanvasEditor } from "../hooks/useCanvasEditor";
import { startExport } from "../services/exportApi";
import { exportBoxesAsZip } from "../services/localExport";
import { isDialogOpen, isEditableTarget } from "../lib/keyboard";
import { fileNameFromUrl } from "../lib/names";
import { SmartDetectionCanvas } from "./SmartDetectionCanvas";
import { DetectionsPanel } from "./DetectionsPanel";
import { PropertiesPanel, type DetectionControls } from "./PropertiesPanel";
import { DetectionStatusCard } from "./DetectionStatusCard";
import { ReviewNotice } from "./ReviewNotice";
import { Toolbar } from "./Toolbar";
import { ZoomControls } from "./ZoomControls";
import { ShortcutsDialog } from "./ShortcutsDialog";

// Once boxes are cut the sheet can no longer be edited; export takes over.
const PAST_EDITING: JobStatus[] = ["cropped", "finalizing", "ready"];
const EXPORT_RUNNING: JobStatus[] = ["removing_bg", "naming", "cropping"];
const DETECTING: JobStatus[] = ["uploaded", "queued", "detecting"];

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function EditorScreen({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { job, loading, error } = useJobPolling(jobId);
  const {
    activeTool, setActiveTool,
    camera, setCamera,
    boxes,
    selectedIds, setSelectedIds,
    drawingBox, setDrawingBox,
    toggleId, clearSelection,
    updateBoxSilently, moveBoxes, deleteBox, deleteSelected, addBox, initBoxes,
    fitToScreen,
    saveHistory, undo, redo, canUndo, canRedo,
  } = useCanvasEditor();

  const stageRef = useRef<HTMLElement>(null);
  const initializedRef = useRef(false);
  const [redetecting, setRedetecting] = useState(false);
  const [detectMode, setDetectMode] = useState<DetectionMode>("auto");
  // Starting value for the colour picker; the user picks the real sheet background.
  const [customBackground, setCustomBackground] = useState("#000000");
  // Pro controls. Free accounts always detect with the defaults.
  const [threshold, setThreshold] = useState<number>(DETECTION_LIMITS.threshold.default);
  const [padding, setPadding] = useState<number>(DETECTION_LIMITS.padding.default);
  const { allowed: tuningAllowed, ready: planReady } = useEntitlement("paddingThresholdControls");
  const { refresh: refreshPlan } = usePlan();
  // Result of the last re-detect in this session; null until the user re-detects.
  const [redetected, setRedetected] = useState<{ warning?: string } | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [exporting, setExporting] = useState<"raw" | "smart" | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const status = job?.status;

  // Redirect if the job has already advanced past the editing stage.
  useEffect(() => {
    if (status && PAST_EDITING.includes(status)) {
      router.replace(`/editor/${jobId}/export`);
    }
  }, [status, jobId, router]);

  // Load the detected boxes and fit the sheet once, when detection finishes.
  useEffect(() => {
    if (!job || job.status !== "detected" || initializedRef.current) return;
    initializedRef.current = true;
    initBoxes(job.boxes);
    const { imageWidth, imageHeight } = job;
    // Defer so the stage has its rendered size.
    requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (stage) fitToScreen(stage.offsetWidth, stage.offsetHeight, imageWidth, imageHeight);
    });
  }, [job, initBoxes, fitToScreen]);

  const imageWidth = job?.imageWidth ?? 0;
  const imageHeight = job?.imageHeight ?? 0;

  const handleFitToScreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !imageWidth || !imageHeight) return;
    fitToScreen(stage.offsetWidth, stage.offsetHeight, imageWidth, imageHeight);
  }, [fitToScreen, imageWidth, imageHeight]);

  const handleZoom = useCallback((newZoom: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const cx = stage.offsetWidth / 2;
    const cy = stage.offsetHeight / 2;
    const wx = (cx - camera.x) / camera.zoom;
    const wy = (cy - camera.y) / camera.zoom;
    const clamped = Math.max(0.05, Math.min(10, newZoom));
    setCamera({ zoom: clamped, x: cx - wx * clamped, y: cy - wy * clamped });
  }, [camera, setCamera]);

  async function handleRedetect() {
    if (redetecting) return;
    setRedetecting(true);
    setReviewDismissed(false);
    try {
      const result = await redetectJob(jobId, {
        mode: detectMode,
        backgroundColor: detectMode === "sampled" ? customBackground : undefined,
        ...(tuningAllowed ? { threshold, padding } : {}),
      });
      initBoxes(result.boxes);
      clearSelection();
      setRedetected({ warning: result.detectionWarning });
      const count = result.boxes.length;
      const confidence = Math.round(result.detectionConfidence * 100);
      toast.success(`Found ${count} box${count === 1 ? "" : "es"}`, {
        description: `Detected with the ${result.detectionMode} background setting, ${confidence}% confidence.`,
      });
    } catch (err) {
      if (err instanceof ApiRequestError && isPlanErrorCode(err.code)) {
        // The plan changed under us (for example the trial ended): re-read it so the controls lock.
        void refreshPlan();
      }
      toast.error("Detection failed", { description: errorMessage(err, "Try another background setting.") });
    } finally {
      setRedetecting(false);
    }
  }

  // Raw: cut every box locally in the browser and download a ZIP (no cloud).
  async function handleRawExport() {
    if (!job || boxes.length === 0 || exporting) return;
    const zipName = `assets_${jobId}.zip`;
    setExporting("raw");
    try {
      const count = await exportBoxesAsZip(job.cloudinaryUrl, boxes, zipName);
      toast.success(`Downloaded ${count} asset${count === 1 ? "" : "s"}`, { description: zipName });
    } catch (err) {
      toast.error("Couldn't build the ZIP", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setExporting(null);
    }
  }

  // Name and export: run the cloud pipeline, then hand off to the export screen.
  async function handleSmartExport() {
    if (boxes.length === 0 || exporting) return;
    setExporting("smart");
    try {
      await startExport(jobId, boxes, false);
      router.push(`/editor/${jobId}/export`);
    } catch (err) {
      toast.error("Couldn't start the export", { description: errorMessage(err, "Try again in a moment.") });
      setExporting(null);
    }
  }

  // Keyboard shortcuts (listed in ShortcutsDialog).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (status !== "detected" || e.defaultPrevented) return;
    if (isEditableTarget(e.target) || isDialogOpen()) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (e.key === "?") {
      e.preventDefault();
      setShortcutsOpen(true);
      return;
    }

    if (!mod && !e.altKey) {
      if (key === "h") setActiveTool("hand");
      if (key === "v") setActiveTool("select");
      if (key === "r") setActiveTool("draw");
    }

    if (e.key === "Escape") {
      setActiveTool("select");
      clearSelection();
    }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
      e.preventDefault();
      deleteSelected();
    }

    if (mod && e.key === "0") {
      e.preventDefault();
      handleFitToScreen();
    }

    if (mod && key === "a") {
      e.preventDefault();
      setSelectedIds(new Set(boxes.map((b) => b.id)));
    }

    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }

    if (mod && key === "y") {
      e.preventDefault();
      redo();
    }

    if (e.key.startsWith("Arrow") && selectedIds.size > 0) {
      e.preventDefault();
      const amount = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0;
      const dy = e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0;
      moveBoxes(selectedIds, dx, dy);
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const failed = Boolean(error) || status === "failed";
  const detected = status === "detected";
  const exportRunning = Boolean(status && EXPORT_RUNNING.includes(status));
  const fileName = job?.fileName?.trim() || fileNameFromUrl(job?.cloudinaryUrl) || "Sheet";

  const wholeSheet =
    detected &&
    boxes.length === 1 &&
    boxes[0].width >= imageWidth * 0.9 &&
    boxes[0].height >= imageHeight * 0.9;
  const warning = redetected ? redetected.warning : job?.detectionWarning;
  const needsReview = detected && (Boolean(warning) || wholeSheet);

  const detection: DetectionControls = {
    mode: detectMode,
    onModeChange: setDetectMode,
    colour: customBackground,
    onColourChange: setCustomBackground,
    redetecting,
    onRedetect: () => void handleRedetect(),
    tuning: {
      allowed: tuningAllowed,
      ready: planReady,
      threshold,
      onThresholdChange: setThreshold,
      padding,
      onPaddingChange: setPadding,
    },
  };

  let badge: React.ReactNode;
  if (failed) {
    badge = <StatusBadge status="failed" />;
  } else if (redetecting || !job || (status && DETECTING.includes(status))) {
    badge = (
      <Badge tone="info">
        <LoaderCircle aria-hidden className="animate-spin" />
        Detecting
      </Badge>
    );
  } else if (detected) {
    badge = needsReview ? (
      <Badge tone="warning">
        <TriangleAlert aria-hidden />
        Needs review
      </Badge>
    ) : (
      <Badge tone="success">
        <Check aria-hidden />
        {boxes.length} detected
      </Badge>
    );
  } else if (status) {
    badge = <StatusBadge status={status} />;
  }

  const canExport = detected && boxes.length > 0 && exporting === null;

  return (
    <>
      <Topbar className="gap-2 pl-2 md:gap-3 md:pl-2">
        <Button asChild variant="ghost" icon>
          <Link href="/upload" aria-label="Back to Extract">
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <Crumbs items={[{ label: "Extract", href: "/upload" }, { label: <span className="oa-value text-[13px]">{fileName}</span> }]} />
        <span role="status" className="sr-only flex-none sm:not-sr-only">
          {badge}
        </span>
        <span className="flex-1" />
        <div className="hidden items-center gap-0.5 sm:flex">
          <Button variant="ghost" size="sm" icon aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={!detected || !canUndo} onClick={undo}>
            <Undo2 aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" disabled={!detected || !canRedo} onClick={redo}>
            <Redo2 aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Keyboard shortcuts (?)"
            title="Keyboard shortcuts (?)"
            aria-haspopup="dialog"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard aria-hidden />
          </Button>
        </div>
        <span aria-hidden className="oa-vsep hidden sm:block" />
        <Button
          variant="secondary"
          disabled={!canExport}
          aria-describedby="raw-export-note"
          title="Cut in your browser and download a ZIP"
          onClick={() => void handleRawExport()}
        >
          {exporting === "raw" && <LoaderCircle aria-hidden className="animate-spin" />}
          {exporting === "raw" ? "Zipping" : "Raw ZIP"}
        </Button>
        <Button
          variant="primary"
          disabled={!canExport}
          aria-describedby="smart-export-note"
          title="Remove the background, name each asset with AI, then export"
          onClick={() => void handleSmartExport()}
        >
          {exporting === "smart" ? (
            <>
              <LoaderCircle aria-hidden className="animate-spin" />
              Starting
            </>
          ) : (
            <>
              <span className="hidden sm:inline">Name and export</span>
              <span className="sm:hidden">Export</span>
              <span className="oa-count">{boxes.length}</span>
            </>
          )}
        </Button>
        <span id="raw-export-note" className="sr-only">
          Cuts every box in your browser and downloads a ZIP. Keeps the sheet background and your labels.
        </span>
        <span id="smart-export-note" className="sr-only">
          Removes the background, names each asset with AI, then opens the export page.
        </span>
      </Topbar>

      {failed ? (
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-sunken p-4 md:p-6">
          <EmptyState
            tone="danger"
            icon={<CircleAlert aria-hidden />}
            title="Detection failed"
            description={error ?? job?.error ?? "We couldn't find assets on this sheet."}
            actions={
              <Button asChild variant="primary">
                <Link href="/upload">Try again</Link>
              </Button>
            }
            className="w-full max-w-md"
          />
        </main>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <DetectionsPanel
            className="order-2 w-full flex-none border-t-[1.5px] border-line lg:order-none lg:w-[248px] lg:border-r-[1.5px] lg:border-t-0"
            loading={!detected}
            imageUrl={job?.cloudinaryUrl ?? ""}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            boxes={boxes}
            selectedIds={selectedIds}
            onToggle={toggleId}
            onSetSelectedIds={setSelectedIds}
            onDeleteSelected={deleteSelected}
            onDrawBox={() => setActiveTool("draw")}
          />

          <section
            ref={stageRef}
            aria-label="Canvas"
            className="oa-stage order-1 h-[min(560px,65dvh)] min-h-[360px] flex-none lg:order-none lg:h-auto lg:min-h-0 lg:flex-1"
            style={detected ? { backgroundPosition: `${camera.x}px ${camera.y}px` } : undefined}
          >
            {detected && job ? (
              <>
                <SmartDetectionCanvas
                  imageUrl={job.cloudinaryUrl}
                  imageWidth={job.imageWidth}
                  imageHeight={job.imageHeight}
                  boxes={boxes}
                  selectedIds={selectedIds}
                  activeTool={activeTool}
                  camera={camera}
                  onCameraChange={setCamera}
                  onToggle={toggleId}
                  onClearSelection={clearSelection}
                  onSetSelectedIds={setSelectedIds}
                  onUpdate={updateBoxSilently}
                  onAddBox={addBox}
                  onSetActiveTool={setActiveTool}
                  drawingBox={drawingBox}
                  onDrawingBoxChange={setDrawingBox}
                  onDeleteBox={deleteBox}
                  onSaveHistory={saveHistory}
                />

                {needsReview && !reviewDismissed && (
                  <ReviewNotice
                    className="absolute left-1/2 top-4 z-10 -translate-x-1/2"
                    wholeSheet={wholeSheet}
                    warning={warning}
                    detection={detection}
                    onDismiss={() => setReviewDismissed(true)}
                  />
                )}

                <div className="pointer-events-none absolute bottom-5 left-4 z-10 hidden items-center gap-3 text-[11px] text-ink-3 md:flex lg:hidden xl:flex">
                  <span className="flex items-center gap-1">
                    <Kbd>Space</Kbd> drag to pan
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd>Alt</Kbd> drag to duplicate
                  </span>
                </div>

                <Toolbar
                  className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
                  activeTool={activeTool}
                  onToolChange={setActiveTool}
                />

                <ZoomControls
                  className="absolute bottom-4 right-4 z-10"
                  zoom={camera.zoom}
                  onZoom={handleZoom}
                  onFit={handleFitToScreen}
                />
              </>
            ) : (
              <>
                {job?.cloudinaryUrl && (
                  <div className="absolute inset-0 flex items-center justify-center p-8 md:p-12">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={job.cloudinaryUrl}
                      alt=""
                      className="oa-checker max-h-full max-w-full border border-line object-contain opacity-55"
                    />
                  </div>
                )}
                {exportRunning ? (
                  <div
                    role="status"
                    className="oa-float absolute left-1/2 top-1/2 w-[min(320px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col items-stretch gap-3.5 p-5"
                  >
                    <h2 className="oa-section">Export in progress</h2>
                    <p className="text-xs leading-[18px] text-ink-2">
                      These boxes are being cut and named. Follow along on the export page.
                    </p>
                    <Button asChild variant="secondary" size="sm" className="self-start">
                      <Link href={`/editor/${jobId}/export`}>Open export</Link>
                    </Button>
                  </div>
                ) : (
                  <DetectionStatusCard
                    job={loading ? null : job}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                  />
                )}
              </>
            )}
          </section>

          <PropertiesPanel
            className="order-3 w-full flex-none border-t-[1.5px] border-line lg:order-none lg:w-[280px] lg:border-l-[1.5px] lg:border-t-0"
            loading={!detected}
            fileName={fileName}
            imageUrl={job?.cloudinaryUrl ?? ""}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            boxes={boxes}
            selectedIds={selectedIds}
            onBeginEdit={saveHistory}
            onEdit={updateBoxSilently}
            onDeleteBox={deleteBox}
            onDeleteSelected={deleteSelected}
            detection={detection}
          />
        </div>
      )}

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
