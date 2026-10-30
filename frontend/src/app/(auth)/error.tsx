"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro } from "@/components/auth/AuthParts";

/** Renders inside the auth layout's form column, so the logo and showcase stay. */
export default function AuthError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <title>Something went wrong · OpenAssets</title>
      <AuthIntro title="Something went wrong">This page failed to load. Try again, or head back to sign in.</AuthIntro>
      {error.digest && (
        <Notice tone="danger" role="alert">
          <span className="oa-label">Reference</span> <span className="oa-value">{error.digest}</span>
        </Notice>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" size="lg" onClick={() => unstable_retry()}>
          Try again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </>
  );
}
