"use client";
// Credit balance for the Studio and AniBuddy top bars, and the notice that
// appears when a request is refused for lack of credits.

import type { ReactNode } from "react";
import { CircleAlert, Coins, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/feedback";
import { useCredits } from "@/features/usage/CreditsProvider";
import { LOW_CREDITS, formatResetDate } from "@/features/usage/credits";

export function CreditsBadge({ className }: { className?: string }) {
  const { credits, loading } = useCredits();

  if (!credits) {
    return (
      <Badge tone={loading ? "neutral" : "warning"} className={className} role="status">
        {loading ? <Coins aria-hidden /> : <TriangleAlert aria-hidden />}
        {loading ? "AI credits" : "AI credits unavailable"}
        {loading && <span className="sr-only"> loading</span>}
      </Badge>
    );
  }

  const out = credits.credits <= 0;
  const low = credits.credits <= LOW_CREDITS;
  const Icon = out ? CircleAlert : low ? TriangleAlert : Coins;
  const reset = formatResetDate(credits.resetAt);
  return (
    <Badge
      tone={out ? "danger" : low ? "warning" : "neutral"}
      className={className}
      role="status"
      title={`${credits.credits} of ${credits.monthlyGrant} monthly AI credits left. Resets ${reset}.`}
    >
      <Icon aria-hidden />
      {credits.credits}
      {/* Phones keep the number and drop the noun to fit beside the tabs. */}
      <span className="max-sm:sr-only">{credits.credits === 1 ? " AI credit" : " AI credits"}</span>
      <span className="sr-only">
        {" "}left of {credits.monthlyGrant}, reset {reset}
      </span>
    </Badge>
  );
}

/**
 * Shown when the balance is empty or a request was refused for lack of
 * credits. `children` is the tool-specific way forward (for Studio, add your
 * own key); the reset date is always stated.
 */
export function CreditsNotice({ children }: { children?: ReactNode }) {
  const { credits, shortfall } = useCredits();
  const empty = credits ? credits.credits <= 0 : false;
  if (!shortfall && !empty) return null;

  const reset = formatResetDate(credits?.resetAt);
  const headline = empty || !credits ? "You are out of AI credits." : `Not enough AI credits for that. You have ${credits.credits} left.`;
  return (
    <div className="flex-none border-b-[1.5px] border-line bg-page px-3 py-2 md:px-5">
      <Notice tone="warning" role="alert">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 text-xs leading-[18px]">
            <strong className="font-bold">{headline}</strong>{" "}
            {credits ? `Your ${credits.monthlyGrant} monthly AI credits return on ${reset}.` : `They reset on ${reset}.`}
          </p>
          {children}
        </div>
      </Notice>
    </div>
  );
}
