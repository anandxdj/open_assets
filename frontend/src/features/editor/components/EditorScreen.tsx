"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useJobPolling } from "@/features/editor/hooks/useJobPolling";
import { useCanvasEditor } from "@/features/editor/hooks/useCanvasEditor";
import { SmartDetectionCanvas } from "./SmartDetectionCanvas";
import { AssetPanel } from "./AssetPanel";
import { LayerProperties } from "./LayerProperties";
import { Toolbar } from "./Toolbar";
import { ZoomControls } from "./ZoomControls";
import { ShortcutsLegend } from "./ShortcutsLegend";
import { buttonVariants } from "@/components/ui/button";
import { startExport } from "@/features/editor/services/exportApi";
import { Zap } from "lucide-react";
import {
  CircularProgress,
  CircularProgressIndicator,
  CircularProgressTrack,
  CircularProgressRange,
} from "@/components/ui/circular-progress";

export function EditorScreen({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { job, loading, error } = useJobPolling(jobId);
  const canvas = useCanvasEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

  // Redirect if job has already advanced past the editing stage
  useEffect(() => {
    if (!job) return;
    if (job.status === "cropped" || job.status === "finalizing" || job.status === "ready") {
      router.replace(`/editor/${jobId}/export`);
    }
  }, [job?.status, jobId, router]);

  // Initialize boxes + fit to screen when job arrives
  useEffect(() => {
    if (job?.status === "detected" && !initializedRef.current) {
      initializedRef.current = true;
      canvas.initBoxes(job.boxes);
      // Defer so container has rendered dimensions
      requestAnimationFrame(() => {
        if (containerRef.current) {
          const { offsetWidth: w, offsetHeight: h } = containerRef.current;
          canvas.fitToScreen(w, h, job.imageWidth, job.imageHeight);
        }
      });
    }
  }, [job]);

  const handleFitToScreen = useCallback(() => {
    if (!containerRef.current || !job) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    canvas.fitToScreen(w, h, job.imageWidth, job.imageHeight);
  }, [job, canvas.fitToScreen]);

  const handleZoom = useCallback((newZoom: number) => {
    if (!containerRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    const cx = w / 2;
    const cy = h / 2;
    const cam = canvas.camera;
    const wx = (cx - cam.x) / cam.zoom;
    const wy = (cy - cam.y) / cam.zoom;
    const clamped = Math.max(0.05, Math.min(10, newZoom));
    canvas.setCamera({ zoom: clamped, x: cx - wx * clamped, y: cy - wy * clamped });
  }, [canvas.camera, canvas.setCamera]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if (!inInput) {
        if (e.key === "h" || e.key === "H") canvas.setActiveTool("hand");
        if (e.key === "v" || e.key === "V") canvas.setActiveTool("select");
        if (e.key === "r" || e.key === "R") canvas.setActiveTool("draw");
        
        if (e.key === "Escape") { 
          canvas.setActiveTool("select"); 
          canvas.clearSelection(); 
        }
        
        if ((e.key === "Delete" || e.key === "Backspace") && canvas.selectedIds.size > 0) {
          canvas.deleteSelected();
        }
        
        if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleFitToScreen();
        }

        // Ctrl + A / Cmd + A (Select All)
        if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          canvas.setSelectedIds(new Set(canvas.boxes.map((b) => b.id)));
        }

        // Ctrl + Z / Cmd + Z (Undo) and Shift + Ctrl + Z / Shift + Cmd + Z (Redo)
        if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          if (e.shiftKey) {
            canvas.redo();
          } else {
            canvas.undo();
          }
        }

        // Ctrl + Y / Cmd + Y (Redo)
        if ((e.key === "y" || e.key === "Y") && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          canvas.redo();
        }

        // Discrete arrow keys nudging
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && canvas.selectedIds.size > 0) {
          e.preventDefault();
          const amount = e.shiftKey ? 10 : 1;
          let dx = 0;
          let dy = 0;
          if (e.key === "ArrowUp") dy = -amount;
          if (e.key === "ArrowDown") dy = amount;
          if (e.key === "ArrowLeft") dx = -amount;
          if (e.key === "ArrowRight") dx = amount;

          canvas.selectedIds.forEach((id) => {
            const box = canvas.boxes.find((b) => b.id === id);
            if (box) {
              canvas.updateBox(id, { x: box.x + dx, y: box.y + dy });
            }
          });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvas.selectedIds, canvas.boxes, canvas.updateBox, canvas.setSelectedIds, canvas.undo, canvas.redo, handleFitToScreen]);

  if (error || job?.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-zinc-950">
        <p className="text-red-400 text-sm">{error ?? job?.error ?? "Detection failed"}</p>
        <Link href="/upload" className={buttonVariants({ variant: "outline" })}>
          Try again
        </Link>
      </div>
    );
  }

  if (loading || !job || job.status !== "detected") {
    const statusLabel: Record<string, string> = {
      uploaded: "Upload received — queuing for detection…",
      queued: "Queued for detection…",
      detecting: "Detecting assets…",
    };
    const label = job?.status
      ? (statusLabel[job.status] ?? "Processing…")
      : "Upload received — detecting assets…";

    return (
      <div className="flex h-screen overflow-hidden bg-zinc-950">
        <div className="flex-1 overflow-auto flex items-start justify-center p-6">
          <div className="max-w-4xl w-full space-y-3 mt-8">
            <div className="animate-pulse rounded-lg bg-zinc-800 h-[480px] w-full" />
            <div className="flex items-center gap-3">
              <CircularProgress>
                <CircularProgressIndicator>
                  <CircularProgressTrack />
                  <CircularProgressRange />
                </CircularProgressIndicator>
              </CircularProgress>
              <p className="text-sm text-zinc-400">{label}</p>
            </div>
          </div>
        </div>
        <div className="w-72 flex-shrink-0 border-l border-zinc-800 bg-zinc-900">
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="animate-pulse h-4 w-32 rounded bg-zinc-800" />
          </div>
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3">
                <div className="h-3 w-3 rounded-sm bg-zinc-800 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded bg-zinc-800 w-3/4" />
                  <div className="h-2.5 rounded bg-zinc-800 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const singleSelectedId = canvas.selectedIds.size === 1 ? Array.from(canvas.selectedIds)[0] : null;
  const selectedBox = singleSelectedId ? canvas.boxes.find(b => b.id === singleSelectedId) : null;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      {/* 1. Left Sidebar: Layers/Detections and Proceed pipeline engine */}
      <AssetPanel
        jobId={jobId}
        imageUrl={job.cloudinaryUrl}
        imageWidth={job.imageWidth}
        imageHeight={job.imageHeight}
        boxes={canvas.boxes}
        selectedIds={canvas.selectedIds}
        jobStatus={job.status}
        onToggle={canvas.toggleId}
        onUpdate={canvas.updateBox}
        onDelete={canvas.deleteBox}
        onDeleteSelected={canvas.deleteSelected}
      />

      {/* 2. Center Viewport: Canvas workspace */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <SmartDetectionCanvas
          imageUrl={job.cloudinaryUrl}
          imageWidth={job.imageWidth}
          imageHeight={job.imageHeight}
          boxes={canvas.boxes}
          selectedIds={canvas.selectedIds}
          activeTool={canvas.activeTool}
          camera={canvas.camera}
          onCameraChange={canvas.setCamera}
          onToggle={canvas.toggleId}
          onClearSelection={canvas.clearSelection}
          onSetSelectedIds={canvas.setSelectedIds}
          onUpdate={canvas.updateBoxSilently}
          onAddBox={canvas.addBox}
          onSetActiveTool={canvas.setActiveTool}
          drawingBox={canvas.drawingBox}
          onDrawingBoxChange={canvas.setDrawingBox}
          onDeleteBox={canvas.deleteBox}
          onSaveHistory={canvas.saveHistory}
        />
        <ZoomControls
          zoom={canvas.camera.zoom}
          onZoom={handleZoom}
          onFit={handleFitToScreen}
        />
        <ShortcutsLegend />
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <Toolbar activeTool={canvas.activeTool} onToolChange={canvas.setActiveTool} />
        </div>
      </div>

      {/* 3. Right Sidebar: Contextual selected box property editor (Figma-Style) */}
      {selectedBox && (
        <div className="w-80 flex-shrink-0 border-l border-zinc-800 bg-[#070708] flex flex-col h-full overflow-y-auto select-none">
          <div className="px-4 py-3.5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-black/50 select-none">
            <span className="text-[10px] font-black tracking-widest text-[#ff7c00] uppercase">
              [ 00_PROP ] LAYER PROPERTIES
            </span>
          </div>
          <LayerProperties
            box={selectedBox}
            imageUrl={job.cloudinaryUrl}
            imageWidth={job.imageWidth}
            imageHeight={job.imageHeight}
            onUpdate={canvas.updateBox}
            onDelete={canvas.deleteBox}
          />
        </div>
      )}
    </div>
  );
}
