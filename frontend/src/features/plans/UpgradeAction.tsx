"use client";

import Link from "next/link";
import { toast } from "sonner";
import { LoaderCircle, Lock } from "lucide-react";
import { SALES_EMAIL } from "@/components/marketing/site";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api-error";
import { TRIAL_DAYS } from "@/lib/plans";
import { usePlan } from "./PlanContext";

/** Subject only: nothing about the person goes into the URL. */
export const UPGRADE_MAILTO = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Upgrade to OpenAssets Pro")}`;

/** Small "Pro" marker for a locked control. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <Badge className={className}>
      <Lock aria-hidden />
      Pro
    </Badge>
  );
}

/**
 * The way up from a Pro gate while there are no payments:
 * - eligible for the trial: "Start 14-day trial" (starts it in place)
 * - otherwise: "Contact us to upgrade" (mailto, subject only)
 * - already on Pro: renders nothing
 * - plan unavailable: a link to the pricing page
 */
export function UpgradeAction({
  variant = "secondary",
  size = "sm",
  block,
  className,
  onStarted,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  block?: boolean;
  className?: string;
  /** Called after the trial has started, for example to retry the blocked action. */
  onStarted?: () => void;
}) {
  const { plan, loading, starting, startTrial, refresh } = usePlan();

  if (loading) return null;

  if (!plan) {
    return (
      <Button asChild variant={variant} size={size} block={block} className={className}>
        <Link href="/pricing">See plans</Link>
      </Button>
    );
  }
  if (plan.effectivePlan === "pro") return null;

  if (!plan.trial.eligible) {
    return (
      <Button asChild variant={variant} size={size} block={block} className={className}>
        <a href={UPGRADE_MAILTO}>Contact us to upgrade</a>
      </Button>
    );
  }

  async function handleStart() {
    if (starting) return;
    try {
      await startTrial();
      toast.success(`Your ${TRIAL_DAYS}-day Pro trial has started`, {
        description: "Unlimited sheets, 4× upscale and the detection controls are on.",
      });
      onStarted?.();
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "TRIAL_USED" || err.code === "ALREADY_PRO")) {
        await refresh();
      }
      toast.error("Couldn't start the trial", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      block={block}
      className={className}
      aria-disabled={starting || undefined}
      onClick={() => void handleStart()}
    >
      {starting && <LoaderCircle aria-hidden className="animate-spin" />}
      Start {TRIAL_DAYS}-day trial
    </Button>
  );
}
