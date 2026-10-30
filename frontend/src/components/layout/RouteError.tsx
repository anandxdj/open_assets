"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Crumbs, Topbar } from "@/components/layout/AppShell";

/**
 * Error boundary body for signed-in app pages. It renders inside the group's
 * layout, so the sidebar (or the workspace frame) stays and only the page is
 * replaced by a top bar (unless the layout draws one), the failure and the way back.
 */
export function RouteError({
  error,
  retry,
  homeHref = "/upload",
  homeLabel = "Back to Extract",
  topbar = true,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref?: string;
  homeLabel?: string;
  /** Turn off when the layout already draws its own top bar (Studio's tool tabs). */
  topbar?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      {/* Client error boundaries cannot export metadata; React hoists this into <head>. */}
      <title>Something went wrong · OpenAssets</title>
      {topbar && (
        <Topbar>
          <Crumbs items={[{ label: "Error" }]} />
        </Topbar>
      )}
      <main className="flex flex-1 items-center justify-center overflow-auto px-4 py-12 pb-24 md:pb-12">
        <div role="alert" className="flex w-full max-w-lg flex-col gap-3">
          <EmptyState
            tone="danger"
            headingLevel={1}
            icon={<TriangleAlert aria-hidden className="size-5" />}
            title="This page failed to load"
            description="Something went wrong while opening it. Try again, or go back and pick up from there."
            actions={
              <>
                <Button variant="primary" onClick={retry}>
                  Try again
                </Button>
                <Button asChild variant="secondary">
                  <Link href={homeHref}>{homeLabel}</Link>
                </Button>
              </>
            }
          />
          {error.digest && (
            <p className="text-center text-xs leading-[18px] text-ink-2">
              <span className="oa-label">Reference</span> <span className="oa-value">{error.digest}</span>
            </p>
          )}
        </div>
      </main>
    </>
  );
}
