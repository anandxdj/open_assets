"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlan } from "./PlanContext";

/** Days at which the badge starts to say the trial is nearly over. */
const ENDING_SOON_DAYS = 3;

/**
 * Subtle app-chrome marker while a Pro trial is running: "Pro trial, N days
 * left", linking to the plans. Renders nothing for everyone else.
 */
export function TrialBadge({ className }: { className?: string }) {
  const { plan } = usePlan();
  const daysLeft = plan?.trial.active ? plan.trial.daysLeft : null;
  if (daysLeft === null || daysLeft === undefined) return null;

  const soon = daysLeft <= ENDING_SOON_DAYS;
  const text = `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  return (
    <Link
      href="/pricing"
      aria-label={`Pro trial, ${text}. See plans.`}
      className={cn(
        "flex items-center justify-between gap-2 border-[1.5px] border-line bg-surface px-2.5 py-2 text-[11px] leading-4 hover:bg-hover",
        className
      )}
    >
      <span className="oa-label flex items-center gap-1.5">
        {soon && <TriangleAlert aria-hidden className="size-3.5 text-warning" />}
        Pro trial
      </span>
      <span className="oa-value tabular-nums text-ink-2">{text}</span>
    </Link>
  );
}
