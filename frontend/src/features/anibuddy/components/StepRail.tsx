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
  concept: { label: "Concept", blurb: "Optional prompt for an external tool" },
  source: { label: "Your artwork", blurb: "Upload one character, confirm rights" },
  prepare: { label: "Prepare", blurb: "Transparent, isolated, trimmed" },
  rig: { label: "Rig", blurb: "Joints and mesh weights you can edit" },
  animate: { label: "Animate", blurb: "Give it something to do — or animate it by hand" },
  export: { label: "Export", blurb: "GIF, PNG frames, project manifest" },
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

interface StepRailProps {
  project: AniBuddyProject;
  activeStep: StepId;
  onSelect: (step: StepId) => void;
}

export function StepRail({ project, activeStep, onSelect }: StepRailProps) {
  return (
    <nav aria-label="AniBuddy steps" className="border-2 border-zinc-950 dark:border-zinc-100">
      <p className="border-b-2 border-zinc-950 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:border-zinc-100">
        Pipeline
      </p>
      <ol>
        {STEP_ORDER.map((step, index) => {
          const meta = STEP_META[step];
          const lockReason = stepLockReason(project, step);
          const locked = lockReason !== null;
          const done = isStepDone(project, step);
          const active = step === activeStep;

          return (
            <li key={step} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
              <button
                type="button"
                disabled={locked}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                  active && "bg-fuchsia-50 dark:bg-fuchsia-950/30",
                  locked
                    ? "cursor-not-allowed opacity-55"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center border font-mono text-[10px] font-bold",
                    done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : active
                        ? "border-fuchsia-700 text-fuchsia-700 dark:text-fuchsia-300"
                        : "border-zinc-400 text-zinc-500 dark:border-zinc-600",
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : locked ? (
                    <Lock className="h-3 w-3" aria-hidden />
                  ) : (
                    String(index).padStart(2, "0")
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn("block font-bold leading-5", active && "text-fuchsia-800 dark:text-fuchsia-200")}>
                    {meta.label}
                  </span>
                  {/* Locked steps explain themselves rather than sitting silently dead. */}
                  <span className="mt-0.5 block text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    {locked ? lockReason : meta.blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
