"use client";

import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AniBuddyProject,
  type StepId,
  STEP_ORDER,
  hasPixels,
  isRigValid,
} from "@/features/anibuddy/types";
import { stepLockReason } from "@/features/anibuddy/hooks/useAniBuddyProject";

export const STEP_META: Record<StepId, { label: string; blurb: string }> = {
  concept: { label: "Concept", blurb: "Optional" },
  source: { label: "Your artwork", blurb: "Add one character" },
  prepare: { label: "Prepare", blurb: "Cut out" },
  rig: { label: "Rig", blurb: "Place joints" },
  animate: { label: "Animate", blurb: "Add motion" },
  export: { label: "Export", blurb: "GIF, PNG, project" },
};

/** A step is done when its own output exists — not merely when it was visited. */
function isStepDone(project: AniBuddyProject, step: StepId): boolean {
  switch (step) {
    case "concept":
      return project.concept.prompt !== null;
    case "source":
      return hasPixels(project.source) && project.rightsConfirmed;
    case "prepare":
      return hasPixels(project.prepared);
    case "rig":
      return isRigValid(project.rig);
    case "animate":
      return project.clips.length > 0;
    case "export":
      return false; // Terminal: nothing downstream depends on it.
    default:
      return false;
  }
}

/** Short status under each step name, from what the project already holds. */
function stepNote(project: AniBuddyProject, step: StepId): string {
  switch (step) {
    case "concept":
      return project.concept.prompt ? "Prompt ready" : STEP_META.concept.blurb;
    case "source":
      return project.source?.name ?? STEP_META.source.blurb;
    case "prepare":
      return project.prepared ? `${project.prepared.width} × ${project.prepared.height}` : STEP_META.prepare.blurb;
    case "rig":
      return project.rig ? `${project.rig.joints.length} joints` : STEP_META.rig.blurb;
    case "animate":
      return project.clips.length
        ? `${project.clips.length} ${project.clips.length === 1 ? "clip" : "clips"}`
        : STEP_META.animate.blurb;
    default:
      return STEP_META[step].blurb;
  }
}

interface StepRailProps {
  project: AniBuddyProject;
  activeStep: StepId;
  onSelect: (step: StepId) => void;
}

export function StepRail({ project, activeStep, onSelect }: StepRailProps) {
  return (
    <nav
      aria-label="AniBuddy steps"
      className="flex flex-none flex-col border-b-[1.5px] border-line bg-surface md:w-[212px] md:border-b-0 md:border-r-[1.5px]"
    >
      <ol className="flex gap-0.5 overflow-x-auto p-2 md:flex-col md:overflow-y-auto md:px-2 md:py-2.5">
        {STEP_ORDER.map((step, index) => {
          const meta = STEP_META[step];
          const lockReason = stepLockReason(project, step);
          const locked = lockReason !== null;
          const done = isStepDone(project, step);
          const active = step === activeStep;
          const note = locked ? lockReason : stepNote(project, step);

          return (
            <li key={step} className="min-w-[180px] md:min-w-0">
              <button
                type="button"
                disabled={locked}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  "oa-nav-item h-auto min-h-10 w-full items-start whitespace-normal py-1.5 text-left",
                  active && "bg-inverse text-inverse-fg hover:bg-inverse hover:text-inverse-fg",
                  locked && "cursor-not-allowed text-ink-3 hover:bg-transparent hover:text-ink-3",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-px flex size-5 flex-none items-center justify-center text-[11px] font-bold",
                    done
                      ? "bg-success-soft text-success"
                      : active
                        ? "border-[1.5px] border-brand"
                        : "border-[1.5px] border-line-strong",
                    locked && !done && "border-line",
                  )}
                >
                  {done ? (
                    <Check className="size-3" strokeWidth={2.5} />
                  ) : locked ? (
                    <Lock className="size-3" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{meta.label}</span>
                  {/* Locked steps explain themselves rather than sitting silently dead. */}
                  <span
                    className={cn(
                      "break-words text-[11px] font-normal normal-case leading-4 tracking-normal",
                      active ? "text-inherit opacity-80" : "text-ink-3",
                    )}
                  >
                    {note}
                  </span>
                  <span className="sr-only">{done ? "(done)" : locked ? "(locked)" : ""}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
