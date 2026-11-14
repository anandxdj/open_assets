"use client";

import { useEntitlement } from "@/features/plans/PlanContext";
import { useRemote } from "@/features/settings/useRemote";
import { DEFAULT_PATTERN } from "@/lib/naming/pattern";
import { getExportPreferences, type ExportPreferences } from "./api";

/**
 * The signed-in user's saved default naming pattern and whether their plan has
 * custom patterns. Only plans with the entitlement load it; for the rest the
 * saved pattern is the default one (the server never applies a stored pattern to
 * them either).
 */
export function useExportPreference() {
  const { allowed, ready } = useEntitlement("customNamingPatterns");
  const remote = useRemote<ExportPreferences | null>(
    async () => (allowed ? getExportPreferences() : null),
    allowed ? "saved" : "default",
    "Could not load your naming pattern.",
  );

  return {
    /** The plan includes custom naming patterns. */
    allowed,
    /** What the control shows: not locked and not editable until the plan is known. */
    mode: (!ready ? "loading" : allowed ? "editable" : "locked") as "editable" | "locked" | "loading",
    /** The saved default pattern, or the default pattern when none is saved. */
    saved: remote.data?.savedPattern ?? DEFAULT_PATTERN,
    /** True while the saved pattern is still being read, so it is not yet the pre-filled value. */
    loading: allowed && remote.status === "loading",
    error: allowed && remote.status === "error" ? remote.error : undefined,
    loaded: remote.data !== undefined,
    reload: remote.reload,
    /** Adopts what a save returned, without another request. */
    adopt: (next: ExportPreferences) => remote.mutate(() => next),
  };
}
