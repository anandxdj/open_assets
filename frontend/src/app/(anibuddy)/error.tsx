"use client";

import { RouteError } from "@/components/layout/RouteError";

export default function AniBuddyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteError error={error} retry={unstable_retry} homeHref="/upload" homeLabel="Back to Extract" />;
}
