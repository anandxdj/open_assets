"use client";

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { SectionLoading } from "@/features/settings/components/parts";
import { usePlan } from "@/features/plans/PlanContext";
import { UpgradeAction } from "@/features/plans/UpgradeAction";
import { TRIAL_DAYS, type PlanStatus } from "@/lib/plans";

/** Resets and plan ends are UTC dates, so they are shown as UTC dates. */
const longDate = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });
const fmt = (iso: string) => longDate.format(new Date(iso));

function planNote(plan: PlanStatus): string | null {
  if (plan.effectivePlan === "pro") {
    const until = plan.proEndsAt ? ` until ${fmt(plan.proEndsAt)}` : "";
    if (plan.planSource === "trial") return `Trial${until}`;
    if (plan.planSource === "billing") return `Billing${until}`;
    return `Granted by OpenAssets${until}`;
  }
  return plan.trial.used ? "Trial used" : null;
}

function Included({ yes }: { yes: boolean }) {
  return yes ? (
    <>
      <Check aria-hidden className="size-4" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <Minus aria-hidden className="size-4 text-ink-3" />
      <span className="sr-only">Not included</span>
    </>
  );
}

function TrialNotice({ plan }: { plan: PlanStatus }) {
  const { trial } = plan;
  if (trial.active && trial.endsAt && trial.daysLeft !== null) {
    return (
      <Notice tone="info" role="status">
        Your Pro trial ends on {fmt(trial.endsAt)}: {trial.daysLeft} day{trial.daysLeft === 1 ? "" : "s"} left. After
        that your account goes back to Free.
      </Notice>
    );
  }
  if (plan.effectivePlan === "free" && trial.eligible) {
    return (
      <Notice tone="info">
        <div className="flex flex-col items-start gap-2.5">
          <p>Try Pro free for {TRIAL_DAYS} days: unlimited sheets, 4× upscale and finer detection controls.</p>
          <UpgradeAction variant="primary" />
        </div>
      </Notice>
    );
  }
  return null;
}

/**
 * The effective plan (never the raw stored one), what it includes, this month's
 * sheets and the trial state, all from GET /api/plans/me through usePlan().
 */
export function PlanOverview() {
  const { plan, loading } = usePlan();

  if (loading) return <SectionLoading label="Loading plan" />;
  if (!plan) {
    return (
      <Notice tone="warning" role="status">
        Could not load your plan. Reload the page to try again.
      </Notice>
    );
  }

  const { entitlements: e, sheets } = plan;
  const isPro = plan.effectivePlan === "pro";
  const note = planNote(plan);
  const sheetPct = sheets.limit ? Math.min(100, Math.round((sheets.used / sheets.limit) * 100)) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="oa-label">Current plan</span>
          <Badge tone={isPro ? "accent" : "neutral"}>{isPro ? "Pro" : "Free"}</Badge>
          {note && <span className="text-xs text-ink-2">{note}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {!isPro && !plan.trial.eligible && <UpgradeAction />}
          <Button asChild>
            <Link href="/pricing">Compare plans</Link>
          </Button>
        </div>
      </div>

      <TrialNotice plan={plan} />

      <div className="flex max-w-[460px] flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p>
            <span className="oa-h2 tabular-nums">{sheets.used}</span>{" "}
            <span className="text-xs text-ink-2">
              {sheets.limit === null ? "sheets this month, no limit" : `of ${sheets.limit} sheets this month`}
            </span>
          </p>
          {sheets.limit !== null && (
            <p className="text-xs text-ink-2">
              Resets on <time dateTime={sheets.resetAt}>{fmt(sheets.resetAt)}</time>
            </p>
          )}
        </div>
        {sheets.limit !== null && <Progress value={sheetPct} label="Sheets used this month" />}
      </div>

      {sheets.limit !== null && sheets.used >= sheets.limit && (
        <Notice tone="warning" role="status">
          You have used all {sheets.limit} sheets this month. Your allowance resets on {fmt(sheets.resetAt)}.
        </Notice>
      )}

      <div className="oa-table-box max-w-[560px]">
        <table className="oa-table">
          <caption className="sr-only">What your plan includes</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">{isPro ? "Your plan: Pro" : "Your plan: Free"}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                Sheets per month
              </th>
              <td className="oa-value">{e.sheetsPerMonth === null ? "Unlimited" : e.sheetsPerMonth}</td>
            </tr>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                Upscale on export
              </th>
              <td className="oa-value">Up to {e.maxUpscale}×</td>
            </tr>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                Padding and threshold controls
              </th>
              <td>
                <Included yes={e.paddingThresholdControls} />
              </td>
            </tr>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                Custom naming patterns
              </th>
              <td>
                <Included yes={e.customNamingPatterns} />
              </td>
            </tr>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                API keys
              </th>
              <td className="oa-value">{e.apiKeys > 0 ? `Up to ${e.apiKeys}` : <Included yes={false} />}</td>
            </tr>
            <tr>
              <th scope="row" className="border-b border-rule bg-transparent text-xs font-normal normal-case leading-[18px] tracking-normal text-ink">
                Team sharing
              </th>
              <td>
                <Included yes={e.teamSharing} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
