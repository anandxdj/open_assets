"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  ENTITLEMENT_TABLE,
  type EntitlementKey,
  type Entitlements,
  type PlanStatus,
} from "@/lib/plans";
import { getMyPlan, startTrialRequest } from "./api";

interface PlanContextValue {
  /** The signed-in user's plan, or null while loading, signed out or when the request failed. */
  plan: PlanStatus | null;
  /** True until the first answer (or failure) for the current session. */
  loading: boolean;
  refresh: () => Promise<PlanStatus | null>;
  /** True while the trial request is in flight. */
  starting: boolean;
  /** Starts the 14-day trial and updates the plan everywhere. Throws ApiRequestError. */
  startTrial: () => Promise<PlanStatus>;
  /** Adopt a PlanStatus returned by another call. */
  setPlan: (plan: PlanStatus) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

/** A plan answer and the user it belongs to, so a sign-out or switch never shows the wrong one. */
type Fetched = { userId: string; plan: PlanStatus | null };

/** One shared fetch of GET /api/plans/me for the whole app. Mounted inside AuthProvider. */
export function PlanProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?._id ?? null;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [starting, setStarting] = useState(false);

  const plan = userId && fetched?.userId === userId ? fetched.plan : null;
  const loading = authLoading || (userId !== null && fetched?.userId !== userId);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    try {
      const next = await getMyPlan();
      setFetched({ userId, plan: next });
      return next;
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading || !userId) return;
    let cancelled = false;
    getMyPlan()
      .then((next) => {
        if (!cancelled) setFetched({ userId, plan: next });
      })
      .catch(() => {
        if (!cancelled) setFetched({ userId, plan: null });
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  const setPlan = useCallback(
    (next: PlanStatus) => {
      if (userId) setFetched({ userId, plan: next });
    },
    [userId]
  );

  const startTrial = useCallback(async () => {
    setStarting(true);
    try {
      const next = await startTrialRequest();
      setPlan(next);
      return next;
    } finally {
      setStarting(false);
    }
  }, [setPlan]);

  const value = useMemo(
    () => ({ plan, loading, refresh, starting, startTrial, setPlan }),
    [plan, loading, refresh, starting, startTrial, setPlan]
  );
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

/**
 * The signed-in user's plan: effective plan, entitlements, sheets used this
 * month, reset date and trial state. `plan` is null until it has loaded.
 */
export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within PlanProvider");
  return ctx;
}

/**
 * One entitlement for the signed-in user. While the plan is loading, `ready`
 * is false and `value` is the free value, so show a neutral state, not a lock.
 *
 *   const { allowed, ready } = useEntitlement("paddingThresholdControls");
 */
export function useEntitlement<K extends EntitlementKey>(
  key: K
): { value: Entitlements[K]; allowed: boolean; ready: boolean } {
  const { plan } = usePlan();
  const value = (plan?.entitlements ?? ENTITLEMENT_TABLE.free)[key];
  const raw = value as boolean | number | null;
  const allowed = typeof raw === "boolean" ? raw : raw === null || raw > 0;
  return { value, allowed, ready: plan !== null };
}
