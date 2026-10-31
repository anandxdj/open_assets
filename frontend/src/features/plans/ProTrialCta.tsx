"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/context/AuthContext";
import { ApiRequestError } from "@/lib/api-error";
import { TRIAL_DAYS, TRIAL_REGISTER_HREF } from "@/lib/plans";
import { usePlan } from "./PlanContext";
import { clearTrialIntent, hasTrialIntent, markTrialIntent } from "./trial-intent";
import { UPGRADE_MAILTO, toastTrialStarted } from "./UpgradeAction";

const LABEL = `Start ${TRIAL_DAYS}-day trial`;

/**
 * The Pro plan's call to action on the pricing page and the landing page.
 *
 * - signed out: register, with `next` set back to /pricing?trial=1
 * - back on /pricing?trial=1 after sign-up (and this browser remembers the
 *   click): the trial starts by itself
 * - signed in and eligible: starts the trial in place
 * - trial running, Pro granted, or trial already used: the matching state
 */
export function ProTrialCta() {
  const { user, loading: authLoading } = useAuth();
  const { plan, loading: planLoading, starting, startTrial, refresh } = usePlan();
  const autoTried = useRef(false);

  async function start() {
    if (starting) return;
    try {
      await startTrial();
      clearTrialIntent();
      toastTrialStarted();
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "TRIAL_USED" || err.code === "ALREADY_PRO")) {
        clearTrialIntent();
        await refresh();
      }
      toast.error("Could not start the trial", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    }
  }

  // Back from sign-up on /pricing?trial=1: start the trial once, only if this
  // browser remembers the click, so the link alone can never start one.
  useEffect(() => {
    if (autoTried.current || authLoading || planLoading || !user || !plan) return;
    const asked =
      window.location.pathname === "/pricing" && new URLSearchParams(window.location.search).get("trial") === "1";
    if (!asked) return;
    autoTried.current = true;
    if (plan.trial.eligible && hasTrialIntent()) {
      void start();
    } else {
      clearTrialIntent();
    }
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, planLoading, user, plan]);

  const signedOutLink = (
    <Button asChild variant="primary" size="lg" block>
      <Link href={TRIAL_REGISTER_HREF} onClick={markTrialIntent}>
        {LABEL}
      </Link>
    </Button>
  );

  // Session still restoring: the same link, so the layout does not jump.
  if (authLoading) return signedOutLink;
  if (!user) return signedOutLink;

  if (planLoading || !plan) {
    return (
      <Button variant="primary" size="lg" block aria-disabled="true">
        {LABEL}
      </Button>
    );
  }

  if (plan.effectivePlan === "pro") {
    const daysLeft = plan.trial.active ? plan.trial.daysLeft : null;
    return (
      <div className="flex flex-col gap-2">
        <Button asChild variant="primary" size="lg" block>
          <Link href="/upload">Open app</Link>
        </Button>
        <p role="status" className="text-xs leading-[18px] text-ink-2">
          {daysLeft !== null
            ? `Pro trial active, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`
            : "You are on Pro."}
        </p>
      </div>
    );
  }

  if (!plan.trial.eligible) {
    return (
      <div className="flex flex-col gap-2">
        <Button asChild variant="primary" size="lg" block>
          <a href={UPGRADE_MAILTO}>Contact us to upgrade</a>
        </Button>
        <p className="text-xs leading-[18px] text-ink-2">Your Pro trial has already been used.</p>
      </div>
    );
  }

  return (
    <Button
      variant="primary"
      size="lg"
      block
      aria-disabled={starting || undefined}
      onClick={() => void start()}
    >
      {starting && <LoaderCircle aria-hidden className="animate-spin" />}
      {LABEL}
    </Button>
  );
}
