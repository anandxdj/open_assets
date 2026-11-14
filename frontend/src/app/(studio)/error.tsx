"use client";

import { RouteError } from "@/components/layout/RouteError";

// Renders inside StudioShell, which already draws the Studio top bar and tool tabs.
export default function StudioError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteError error={error} retry={unstable_retry} topbar={false} homeHref="/studio" homeLabel="Back to Studio" />;
}
