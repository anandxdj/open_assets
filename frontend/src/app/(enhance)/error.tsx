"use client";

import { RouteError } from "@/components/layout/RouteError";

export default function EnhanceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteError error={error} retry={unstable_retry} homeHref="/enhance" homeLabel="Back to Enhance" />;
}
