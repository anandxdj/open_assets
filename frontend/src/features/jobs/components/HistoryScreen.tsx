"use client";

import Link from "next/link";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import { RecentJobsTable } from "@/features/jobs/components/RecentJobsTable";
import { clearRecentJobs, restoreRecentJobs, useRecentJobs } from "@/features/jobs/recentJobs";

export function HistoryScreen() {
  const { user } = useAuth();
  const userId = user?._id;
  const jobs = useRecentJobs(userId);

  function handleClear() {
    if (!userId || jobs.length === 0) return;
    const previous = jobs;
    clearRecentJobs(userId);
    toast.success("List cleared", {
      description: "Jobs stay on the server until they expire.",
      action: { label: "Undo", onClick: () => restoreRecentJobs(userId, previous) },
    });
  }

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "History" }]} />
        <span className="flex-1" />
        {jobs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear list
          </Button>
        )}
      </Topbar>
      <PageBody className="flex flex-col gap-5">
        <PageTitle
          title="History"
          description="Sheets you extracted in this browser. The server keeps each job for 24 hours after its last change."
        />
        {userId && jobs.length > 0 ? (
          <RecentJobsTable jobs={jobs} userId={userId} caption="Extraction history" />
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
    </>
  );
}
