"use client";

import Link from "next/link";
import { Progress } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { UpgradeAction } from "@/features/plans/UpgradeAction";
import { usePlan } from "@/features/plans/PlanContext";
import { formatPlanDate } from "@/lib/plans";

/** True when a limited plan has no sheets left this month. */
export function useSheetLimitReached(): boolean {
  const { plan } = usePlan();
  return Boolean(plan && plan.sheets.limit !== null && plan.sheets.used >= plan.sheets.limit);
}

/**
 * "N of 5 sheets this month" for free accounts, with a notice and the way up
 * when the allowance is used. During a Pro trial it shows the days left; Pro
 * accounts without an end date see nothing.
 */
export function UsageMeter() {
  const { plan } = usePlan();
  if (!plan) return null;

  const { sheets, trial } = plan;

  if (sheets.limit === null) {
    if (!trial.active || trial.daysLeft === null) return null;
    return (
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-[1.5px] border-line bg-surface px-4 py-3 text-xs leading-[18px]">
        <span className="oa-label">Pro trial</span>
        <span className="tabular-nums">
          {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left
        </span>
        <span className="text-ink-2">
          Unlimited sheets <span className="tabular-nums">· {sheets.used} used this month</span>
        </span>
      </p>
    );
  }

  const reached = sheets.used >= sheets.limit;
  const pct = Math.min(100, Math.round((sheets.used / sheets.limit) * 100));
  const reset = formatPlanDate(sheets.resetAt);

  return (
    <section aria-label="Sheet usage" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 border-[1.5px] border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-medium tabular-nums">
            {sheets.used} of {sheets.limit} sheets this month
          </p>
          <p className="text-[11px] leading-4 text-ink-2">Resets {reset}</p>
        </div>
        <Progress value={pct} label="Sheets used this month" />
      </div>
      {reached && (
        <Notice tone="warning" role="status">
          <div className="flex flex-col gap-2.5">
            <p>
              <strong className="font-bold">You have used all {sheets.limit} sheets this month.</strong> Your allowance
              resets on {reset}. Pro has no sheet limit.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <UpgradeAction />
              <Link href="/pricing" className="oa-link text-xs">
                View plans
              </Link>
            </div>
          </div>
        </Notice>
      )}
    </section>
  );
}
