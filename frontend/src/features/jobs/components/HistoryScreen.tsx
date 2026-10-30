"use client";

import { useState } from "react";
import Link from "next/link";
import { History, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading, Notice } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import { ClearHistoryDialog } from "@/features/jobs/components/ClearHistoryDialog";
import { RecentJobsTable } from "@/features/jobs/components/RecentJobsTable";
import { useJobList } from "@/features/jobs/useJobList";

export function HistoryScreen() {
  const { user } = useAuth();
  const { list, loadingMore, reload, loadMore, remove, clear } = useJobList(user?._id);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const hasJobs = list.kind === "ready" && list.jobs.length > 0;

  function handleLoadMore() {
    loadMore().catch(() => toast.error("Could not load more", { description: "Try again in a moment." }));
  }

  async function handleClear() {
    await clear();
    toast.success("History cleared", { description: "Jobs stay on the server until they expire." });
  }

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "History" }]} />
        <span className="flex-1" />
        {hasJobs && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)}>
            Clear list
          </Button>
        )}
      </Topbar>
      <PageBody className="flex flex-col gap-5">
        <PageTitle
          title="History"
          description="Sheets you extracted. The server keeps each job for 24 hours after its last change."
        />
        {list.kind === "loading" ? (
          <Loading label="Loading your history" />
        ) : list.kind === "error" ? (
          <Notice tone="warning">
            <span className="flex flex-wrap items-center justify-between gap-2">
              Could not load your history. {list.message}
              <Button size="sm" onClick={reload}>
                Try again
              </Button>
            </span>
          </Notice>
        ) : list.jobs.length > 0 ? (
          <>
            <RecentJobsTable jobs={list.jobs} onRemove={remove} caption="Extraction history" />
            {list.hasMore && (
              <div className="flex justify-center">
                <Button onClick={handleLoadMore} disabled={loadingMore} aria-busy={loadingMore || undefined}>
                  {loadingMore && <LoaderCircle aria-hidden className="animate-spin" />}
                  Load more
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<History aria-hidden className="size-5" />}
            title="No extractions yet"
            description="Upload a sprite sheet and it shows up here, with its status, until the job expires."
            actions={
              <Button asChild variant="primary">
                <Link href="/upload">Extract assets</Link>
              </Button>
            }
          />
        )}
      </PageBody>
      <ClearHistoryDialog open={confirmingClear} onOpenChange={setConfirmingClear} onConfirm={handleClear} />
    </>
  );
}
