import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import type { JobResponse } from "@/types";
import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "pending";

/**
 * Detection steps derived from the job: the worker records the transparency
 * check (isTransparent) before it starts looking for boxes.
 */
function detectionSteps(job: JobResponse | null): { label: string; state: StepState }[] {
  const status = job?.status;
  const queued = !job || status === "uploaded" || status === "queued";
  const backgroundChecked = job?.isTransparent !== undefined || status === "detected";
  const detected = status === "detected";

  const upload: StepState = job ? "done" : "active";
  const background: StepState = backgroundChecked ? "done" : queued ? "pending" : "active";
  const boxes: StepState = detected ? "done" : backgroundChecked ? "active" : "pending";
  const review: StepState = detected ? "done" : "pending";

  return [
    { label: "Upload received", state: upload },
    { label: background === "active" ? "Checking the background" : "Background checked", state: background },
    { label: "Finding asset boxes", state: boxes },
    { label: "Ready to review", state: review },
  ];
}

const STATE_TEXT: Record<StepState, string> = { done: "done", active: "in progress", pending: "not started" };

/** Centred card on the canvas while detection runs. */
export function DetectionStatusCard({ job, className }: { job: JobResponse | null; className?: string }) {
  const steps = detectionSteps(job);
  const queued = job?.status === "uploaded" || job?.status === "queued";

  return (
    <div
      role="status"
      className={cn("oa-float w-[min(320px,calc(100%-32px))] flex-col items-stretch gap-3.5 p-5", className)}
    >
      <h2 className="oa-section">Detecting assets</h2>
      <ol className="flex flex-col gap-2.5 text-xs">
        {steps.map((step) => (
          <li
            key={step.label}
            className={cn(
              "flex items-center gap-2.5",
              step.state === "active" && "font-medium",
              step.state === "pending" && "text-ink-3"
            )}
          >
            {step.state === "done" ? (
              <CircleCheck aria-hidden className="size-4 flex-none text-success" />
            ) : step.state === "active" ? (
              <LoaderCircle aria-hidden className="size-4 flex-none animate-spin text-info" />
            ) : (
              <Circle aria-hidden className="size-4 flex-none" />
            )}
            {step.label}
            <span className="sr-only">, {STATE_TEXT[step.state]}</span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] leading-4 text-ink-2">
        {queued ? "Waiting for a free detector. " : ""}Detection keeps running if you leave this page.
      </p>
    </div>
  );
}
