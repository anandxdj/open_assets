"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProBadge, UpgradeAction } from "./UpgradeAction";

/**
 * The one way a Pro-only feature says it is locked, so every gate looks and
 * reads the same.
 *
 * - layout "inline" (default): a ruled box inside a panel or form. A Pro badge,
 *   "{feature} is part of Pro.", a "See plans" link and the upgrade action.
 * - layout "block": a dashed box for a whole settings section, with the lock
 *   icon, the feature name, a sentence on what it gives and the upgrade action.
 *
 * Render it only while the feature is locked and the plan has loaded (see
 * `useEntitlement().ready`). The locked control itself stays visible and
 * disabled with an accessible name that says "needs Pro".
 */
export function ProGate({
  feature,
  plural = false,
  description,
  layout = "inline",
  onStarted,
  className,
}: {
  /** What is locked, as a noun phrase: "4× upscale", "Custom naming patterns". */
  feature: string;
  /** The feature name is plural ("Threshold and padding"), so the sentence says "are". */
  plural?: boolean;
  /** Block layout only: what the feature gives, one or two sentences. */
  description?: React.ReactNode;
  layout?: "inline" | "block";
  /** Called after the trial has started, for example to reload the locked data. */
  onStarted?: () => void;
  className?: string;
}) {
  if (layout === "block") {
    return (
      <div className={cn("flex max-w-[560px] items-start gap-3 border-[1.5px] border-dashed border-line p-4", className)}>
        <span className="oa-icon-box" aria-hidden>
          <Lock className="size-4" />
        </span>
        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-xs font-bold leading-[18px]">
              {feature}
              <ProBadge />
            </p>
            {description && <p className="text-xs leading-[18px] text-ink-2">{description}</p>}
          </div>
          <UpgradeAction onStarted={onStarted} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-2 border-[1.5px] border-line px-2.5 py-2.5", className)}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-2">
        <ProBadge />
        <span>
          {feature} {plural ? "are" : "is"} part of Pro.{" "}
          <Link href="/pricing" className="oa-link">
            See plans
          </Link>
        </span>
      </p>
      <UpgradeAction onStarted={onStarted} />
    </div>
  );
}
