"use client";
// The signed-in user's credit balance (GET /api/usage/me). Mount it inside
// AuthGate. It refreshes whenever a spending request finishes (studioPost
// announces that), when the tab regains focus, and on demand.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiClient } from "@/lib/api-client";
import { CREDITS_EVENT, type CreditsInfo, type CreditsOutcome } from "@/features/usage/credits";

type CreditsContextValue = {
  /** null until the first load succeeds. */
  credits: CreditsInfo | null;
  loading: boolean;
  /** A request was refused for lack of credits and nothing has succeeded since. */
  shortfall: boolean;
  refresh: () => Promise<void>;
};

const CreditsContext = createContext<CreditsContextValue | null>(null);

/** Spends often arrive in bursts (a sprite sheet is several calls): coalesce them. */
const REFRESH_DELAY_MS = 250;

export function CreditsProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [shortfall, setShortfall] = useState(false);
  const latest = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    const mine = ++latest.current;
    // A failed refresh keeps the last known balance rather than blanking the chrome.
    return apiClient.get<{ data: CreditsInfo }>("/api/usage/me").then(
      (res) => {
        if (mine !== latest.current) return;
        setCredits(res.data);
        setLoading(false);
      },
      () => {
        if (mine === latest.current) setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    void refresh();
    const schedule = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void refresh(), REFRESH_DELAY_MS);
    };
    const onActivity = (event: Event) => {
      const outcome = (event as CustomEvent<CreditsOutcome>).detail;
      if (outcome === "insufficient") setShortfall(true);
      else if (outcome === "ok") setShortfall(false);
      schedule();
    };
    window.addEventListener(CREDITS_EVENT, onActivity);
    window.addEventListener("focus", schedule);
    return () => {
      window.removeEventListener(CREDITS_EVENT, onActivity);
      window.removeEventListener("focus", schedule);
      window.clearTimeout(timer.current);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ credits, loading, shortfall, refresh }),
    [credits, loading, shortfall, refresh],
  );
  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits(): CreditsContextValue {
  const ctx = useContext(CreditsContext);
  if (!ctx) throw new Error("useCredits must be used inside <CreditsProvider>");
  return ctx;
}
