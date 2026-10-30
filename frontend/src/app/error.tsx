"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/marketing/StatusPage";
import { SUPPORT_EMAIL } from "@/components/marketing/site";

/** Fallback for any public page that throws. App pages have their own boundary with the app chrome. */
export default function PublicError({
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
    <StatusPage
      eyebrow="Error"
      title={
        <>
          Something
          <br />
          went <span className="bg-brand px-[.12em] text-brand-fg">wrong</span>
        </>
      }
      description={
        <>
          <p role="alert" className="oa-lead">
            This page failed to load. That is on us, not you. Try again, and if it keeps happening, email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="oa-link">
              {SUPPORT_EMAIL}
            </a>
            {error.digest ? " with the reference below." : "."}
          </p>
          {error.digest && (
            <p className="text-xs leading-[18px] text-ink-2">
              <span className="oa-label">Reference</span> <span className="oa-value">{error.digest}</span>
            </p>
          )}
        </>
      }
      actions={
        <>
          <Button variant="primary" size="xl" onClick={() => unstable_retry()}>
            Try again
          </Button>
          <Button asChild variant="secondary" size="xl">
            <Link href="/">Go to the home page</Link>
          </Button>
        </>
      }
    >
      {/* Client error boundaries cannot export metadata; React hoists this into <head>. */}
      <title>Something went wrong · OpenAssets</title>
    </StatusPage>
  );
}
