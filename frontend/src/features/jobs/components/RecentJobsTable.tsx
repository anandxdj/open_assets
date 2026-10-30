"use client";

import Link from "next/link";
import { Ellipsis, ImageOff, LoaderCircle, RotateCcw, SquarePen, TimerOff, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { removeRecentJob, type RecentJob } from "@/features/jobs/recentJobs";
import { useJobStatuses, type JobState } from "@/features/jobs/useJobStatuses";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";

type PrimaryAction = { label: string; href: string };

function primaryAction(jobId: string, state: JobState): PrimaryAction | null {
  if (state.kind === "expired") return null;
  const editor = `/editor/${jobId}`;
  if (state.kind !== "found") return { label: "Open", href: editor };
  switch (state.job.status) {
    case "ready":
      return { label: "Export", href: `${editor}/export` };
    case "detected":
      return { label: "Review", href: editor };
    default:
      return { label: "Open", href: editor };
  }
}

function assetCount(state: JobState): string {
  if (state.kind !== "found") return "—";
  const n = state.job.assets?.length || state.job.boxes?.length || 0;
  return n > 0 ? String(n) : "—";
}

function StatusCell({ state }: { state: JobState }) {
  switch (state.kind) {
    case "loading":
      return (
        <Badge>
          <LoaderCircle aria-hidden className="animate-spin" />
          Checking
        </Badge>
      );
    case "expired":
      return (
        <Badge title="Jobs are deleted from the server 24 hours after their last change">
          <TimerOff aria-hidden />
          Expired
        </Badge>
      );
    case "error":
      return (
        <Badge tone="warning" title={state.message}>
          <TriangleAlert aria-hidden />
          Unavailable
        </Badge>
      );
    case "found":
      return (
        <span title={state.job.status === "failed" ? state.job.error : undefined}>
          <StatusBadge status={state.job.status} />
        </span>
      );
  }
}

/**
 * Table of extraction jobs remembered in this browser, with each job's live
 * status from the server. Expired jobs (404) can only be removed.
 */
export function RecentJobsTable({
  jobs,
  userId,
  caption,
}: {
  jobs: RecentJob[];
  userId: string;
  caption: string;
}) {
  const { get, retry } = useJobStatuses(jobs.map((j) => j.id));
  const now = useNow();
  const checking = jobs.filter((j) => get(j.id).kind === "loading").length;

  function remove(job: RecentJob) {
    removeRecentJob(userId, job.id);
    toast.success("Removed from the list", { description: job.fileName });
  }

  return (
    <>
      <p role="status" className="sr-only">
        {checking > 0 ? `Checking the status of ${checking} ${checking === 1 ? "extraction" : "extractions"}` : ""}
      </p>
      <div className="oa-table-box">
        <table className="oa-table" aria-busy={checking > 0 || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Sheet</th>
              <th scope="col">Assets</th>
              <th scope="col">Status</th>
              <th scope="col" className="hidden sm:table-cell">
                Created
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const state = get(job.id);
              const action = primaryAction(job.id, state);
              const thumb = state.kind === "found" ? state.job.cloudinaryUrl : undefined;
              return (
                <tr key={job.id}>
                  <td>
                    <span className="flex items-center gap-3">
                      <span className="oa-checker flex h-8 w-12 flex-none items-center justify-center overflow-hidden border border-line">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" loading="lazy" className="size-full object-contain" />
                        ) : (
                          <ImageOff aria-hidden className="size-4 text-ink-3" />
                        )}
                      </span>
                      <span className="oa-value max-w-[240px] truncate text-[13px]" title={job.fileName}>
                        {job.fileName}
                      </span>
                    </span>
                  </td>
                  <td className="text-ink-2">{assetCount(state)}</td>
                  <td>
                    <StatusCell state={state} />
                  </td>
                  <td className="hidden text-ink-2 sm:table-cell">
                    <time dateTime={new Date(job.createdAt).toISOString()} title={formatFullDate(job.createdAt)}>
                      {formatRelativeTime(job.createdAt, now)}
                    </time>
                  </td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      {action ? (
                        <>
                          <Button asChild size="sm">
                            <Link href={action.href}>
                              {action.label}
                              <span className="sr-only"> {job.fileName}</span>
                            </Link>
                          </Button>
                          <Menu>
                            <MenuTrigger asChild>
                              <Button variant="ghost" size="sm" icon aria-label={`More actions for ${job.fileName}`}>
                                <Ellipsis aria-hidden />
                              </Button>
                            </MenuTrigger>
                            <MenuContent>
                              {action.label !== "Open" && (
                                <MenuItem asChild>
                                  <Link href={`/editor/${job.id}`}>
                                    <SquarePen aria-hidden />
                                    Open in editor
                                  </Link>
                                </MenuItem>
                              )}
                              {state.kind === "error" && (
                                <MenuItem onSelect={() => retry(job.id)}>
                                  <RotateCcw aria-hidden />
                                  Check again
                                </MenuItem>
                              )}
                              <MenuItem onSelect={() => remove(job)}>
                                <X aria-hidden />
                                Remove from list
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        </>
                      ) : (
                        <Button size="sm" onClick={() => remove(job)}>
                          Remove
                          <span className="sr-only"> {job.fileName}</span>
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
