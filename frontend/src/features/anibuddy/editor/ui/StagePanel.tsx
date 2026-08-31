"use client";

// Pipeline state: stage progress, the export gate, and what the preview measured.
//
// `diagnostics.blockingReason` is displayed verbatim. It is authored by the Python
// validator and it is a SENTENCE, not a boolean, precisely so the UI can explain
// the lock instead of greying a button out (F9 §7.8). The client never composes
// one, never paraphrases one, and never decides that a document is fine because it
// could not find a problem itself -- the browser cannot author diagnostics (R5).
//
// The distortion numbers underneath come from the local preview kernel and are
// labelled as such. They are the same metric the server reports, measured on the
// frames the user has actually scrubbed through, which is what makes them useful
// before a render exists.

import { AlertTriangle, CheckCircle2, Loader2, Lock, Play } from "lucide-react";
import { ANIBUDDY_LIMITS } from "@/features/anibuddy/rig/index.rig";
import type { RigDocument } from "@/features/anibuddy/rig/index.rig";
import type { DistortionReport, PreviewDowngrade } from "../editor.types";
import { QUEUED_STAGES } from "../project.client";
import type {
  AniBuddyProject,
  EnqueueOptions,
  EnqueueReceipt,
  QueuedStage,
} from "../project.client";

interface StagePanelProps {
  project: AniBuddyProject;
  document: RigDocument | null;
  receipt: EnqueueReceipt | null;
  busy: boolean;
  inFlight: boolean;
  error: string | null;
  /** What the frame on screen measured. */
  frameDistortion: DistortionReport;
  /** Worst case across the whole clip, once the user asks for it. Null until then. */
  clipDistortion: DistortionReport | null;
  downgrades: readonly PreviewDowngrade[];
  clipCount: number;
  /** Frame count of the clip that would be rendered. */
  activeFrameCount: number;
  /** The clip the timeline is on, so a render can name it. Null for a still at rest. */
  activeClipId: string | null;
  draftDirty: boolean;
  /** `units` is what the credit rate multiplies; the panel shows the same number. */
  onEnqueue: (stage: QueuedStage, units: number, options?: EnqueueOptions) => void;
  onRefresh: () => void;
  onScanClip: () => void;
  canScanClip: boolean;
}

const PANEL = "border-2 border-zinc-950 bg-card p-3 dark:border-zinc-100";
const LABEL = "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500";

/**
 * `units` is what the stage's credit rate multiplies (F9 §13), so it has to track the
 * work actually being asked for: detected parts for decompose, parts for rig, clips for
 * animate, frames for render. The gateway clamps to 1..20 and prices server-side, so a
 * wrong number here cannot underpay -- it can only make the bill unexplainable.
 */
function unitsFor(
  stage: QueuedStage,
  document: RigDocument | null,
  clipCount: number,
  activeFrameCount: number,
): number {
  if (stage === "decompose") return Math.max(1, document?.parts.length ?? 1);
  if (stage === "render") return Math.max(1, activeFrameCount);
  if (stage === "animate") return Math.max(1, clipCount);
  return Math.max(1, document?.parts.length ?? 1);
}

export function StagePanel({
  project,
  document,
  receipt,
  busy,
  inFlight,
  error,
  frameDistortion,
  clipDistortion,
  downgrades,
  clipCount,
  activeFrameCount,
  activeClipId,
  draftDirty,
  onEnqueue,
  onRefresh,
  onScanClip,
  canScanClip,
}: StagePanelProps) {
  const progress = project.stageProgress;
  const blockingReason = document?.diagnostics.blockingReason ?? null;
  // A render samples the revision the server holds, so only a clip that is really
  // on it can be named. An unsaved draft is not a clip the renderer could find,
  // and asking for it by name would spend credits on a refusal.
  const renderableClipId =
    activeClipId !== null && (document?.clips ?? []).some((clip) => clip.id === activeClipId)
      ? activeClipId
      : null;
  const activeClipIsUnsaved = activeClipId !== null && renderableClipId === null;
  // The clip-wide scan wins the headline when it exists: the frame the user is parked
  // on is rarely the worst one.
  const distortion = clipDistortion ?? frameDistortion;
  const stretchWarning = distortion.maxStretch > ANIBUDDY_LIMITS.STRETCH_WARNING;

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={LABEL}>Pipeline</h3>
          <button
            type="button"
            onClick={onRefresh}
            className="border-2 border-zinc-300 px-2 py-1 font-mono text-[10px] font-bold uppercase dark:border-zinc-700"
          >
            Refresh
          </button>
        </div>

        <p className="mt-2 flex items-center gap-2 font-mono text-[11px]">
          {inFlight ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-700" />
          ) : project.status === "failed" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          )}
          <span className="font-bold uppercase tracking-[0.12em]">{project.status}</span>
          <span className="text-zinc-500">
            revision {project.currentRevision} · pipeline {project.pipelineVersion} · kernel{" "}
            {project.kernelVersion}
          </span>
        </p>

        <div className="mt-3">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            <span>{progress.stage ?? "no stage"}</span>
            <span>
              {progress.status} · {progress.percent}%
            </span>
          </div>
          <div className="mt-1 h-2 border-2 border-zinc-950 dark:border-zinc-100">
            <div
              className="h-full bg-fuchsia-700 transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
            />
          </div>
          {progress.message && (
            <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">{progress.message}</p>
          )}
          {progress.error && (
            <p className="mt-2 border-2 border-red-500 bg-red-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-red-950/30 dark:text-red-100">
              {progress.error}
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {QUEUED_STAGES.map((stage) => {
            const units = unitsFor(stage, document, clipCount, activeFrameCount);
            return (
              <button
                key={stage}
                type="button"
                disabled={busy || inFlight}
                onClick={() =>
                  onEnqueue(
                    stage,
                    units,
                    stage === "render" && renderableClipId !== null
                      ? { render: { clipId: renderableClipId } }
                      : undefined,
                  )
                }
                title={
                  stage === "render"
                    ? renderableClipId === null
                      ? `Renders a single still at rest. Bills ${units} unit${units === 1 ? "" : "s"}.`
                      : `Renders the '${renderableClipId}' clip. Bills ${units} unit${units === 1 ? "" : "s"}.`
                    : `Bills ${units} unit${units === 1 ? "" : "s"} at this stage's rate`
                }
                className="inline-flex items-center gap-1 border-2 border-zinc-950 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] disabled:opacity-40 dark:border-zinc-100"
              >
                <Play className="h-3 w-3" />
                {stage}
                <span className="text-zinc-500">×{units}</span>
              </button>
            );
          })}
        </div>

        {receipt && (
          <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">
            Last enqueue: {receipt.stage} cost {receipt.cost} credit
            {receipt.cost === 1 ? "" : "s"}, {receipt.remaining} remaining.
          </p>
        )}
        {error && (
          <p className="mt-2 border-2 border-red-500 bg-red-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-red-950/30 dark:text-red-100">
            {error}
          </p>
        )}
        {(draftDirty || activeClipIsUnsaved) && (
          <p className="mt-2 border-2 border-amber-500 bg-amber-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-amber-950/30 dark:text-amber-100">
            {activeClipIsUnsaved
              ? "The clip on the timeline is not on this revision, so render would sample the rig at rest. Save it from the timeline first."
              : "Some clip edits are still local to this browser. Save them from the timeline to put them on a revision the pipeline can read."}
          </p>
        )}
      </section>

      <section className={PANEL}>
        <h3 className={LABEL}>Export gate</h3>
        {!document ? (
          <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">
            No revision yet. Run decompose to produce one.
          </p>
        ) : blockingReason === null ? (
          <p className="mt-2 flex items-start gap-2 font-mono text-[11px] leading-5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            The server reports this revision as structurally valid and renderable.
          </p>
        ) : (
          <p className="mt-2 flex items-start gap-2 border-2 border-red-500 bg-red-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-red-950/30 dark:text-red-100">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {blockingReason}
          </p>
        )}

        {document && (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-y-1 font-mono text-[11px]">
              <dt className="text-zinc-500">Server maxStretch</dt>
              <dd className="tabular-nums">×{document.diagnostics.maxStretch.toFixed(2)}</dd>
              <dt className="text-zinc-500">Server flipped tris</dt>
              <dd className="tabular-nums">{document.diagnostics.flippedTriangles}</dd>
              <dt className="text-zinc-500">Isolated verts</dt>
              <dd className="tabular-nums">{document.diagnostics.isolatedVertices}</dd>
              <dt className="text-zinc-500">Foreground covered</dt>
              <dd className="tabular-nums">
                {document.diagnostics.foregroundPixels === 0
                  ? "n/a"
                  : `${Math.round((document.diagnostics.coveredForegroundPixels / document.diagnostics.foregroundPixels) * 100)}%`}
              </dd>
            </dl>
            {document.diagnostics.warnings.map((warning) => (
              <p key={warning} className="mt-2 font-mono text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                {warning}
              </p>
            ))}
            {!document.revision.accepted && (
              <p className="mt-2 border-2 border-amber-500 bg-amber-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-amber-950/30 dark:text-amber-100">
                Revision {document.revision.index} is a proposal, not accepted work.{" "}
                {document.revision.reason}
              </p>
            )}
          </>
        )}
      </section>

      <section className={PANEL}>
        <div className="flex items-center justify-between gap-2">
          <h3 className={LABEL}>Preview distortion</h3>
          <button
            type="button"
            disabled={!canScanClip}
            onClick={onScanClip}
            className="border-2 border-zinc-300 px-2 py-1 font-mono text-[10px] font-bold uppercase disabled:opacity-40 dark:border-zinc-700"
          >
            Scan clip
          </button>
        </div>
        <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-500">
          {clipDistortion
            ? "Worst case across every frame of this clip, by the same metric the server reports."
            : "This frame only, by the same metric the server reports. Scan the clip for its worst frame."}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-y-1 font-mono text-[11px]">
          <dt className="text-zinc-500">Worst stretch</dt>
          <dd className={`tabular-nums ${stretchWarning ? "text-amber-700 dark:text-amber-300" : ""}`}>
            ×{distortion.maxStretch.toFixed(2)}
          </dd>
          <dt className="text-zinc-500">Flipped triangles</dt>
          <dd className={`tabular-nums ${distortion.flippedTriangles > 0 ? "text-red-600" : ""}`}>
            {distortion.flippedTriangles}
          </dd>
          <dt className="text-zinc-500">Degenerate skipped</dt>
          <dd className="tabular-nums">{distortion.degenerateTriangles}</dd>
        </dl>
        {(stretchWarning || distortion.flippedTriangles > 0) && (
          <p className="mt-2 flex items-start gap-2 border-2 border-amber-500 bg-amber-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {distortion.flippedTriangles > 0
              ? "Some triangles fold over themselves in this clip. The affected parts are tinted red on the canvas."
              : `Some artwork is stretched past ×${ANIBUDDY_LIMITS.STRETCH_WARNING} in this clip. The affected parts are tinted amber${distortion.worstPartId ? `; the worst is ${distortion.worstPartId}` : ""}.`}
          </p>
        )}
        {downgrades.length > 0 && (
          <div className="mt-3">
            <h4 className={LABEL}>Preview limits</h4>
            <ul className="mt-1 space-y-1">
              {downgrades.map((entry) => (
                <li key={`${entry.partId}-${entry.reason}`} className="font-mono text-[11px] leading-5 text-zinc-500">
                  <span className="font-bold">{entry.partId}</span>: {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
