"use client";

import Link from "next/link";
import { Ellipsis, SquarePen, X } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { SafeImage } from "@/components/ui/safe-image";
import { BackdropGroup, BackdropSurface } from "@/features/backdrop/BackdropSurface";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";
import type { JobSummary } from "@/types";

type PrimaryAction = { label: string; href: string };

function primaryAction(job: JobSummary): PrimaryAction {
  const editor = `/editor/${job.jobId}`;
  switch (job.status) {
    case "ready":
      return { label: "Export", href: `${editor}/export` };
    case "detected":
      return { label: "Review", href: editor };
    default:
      return { label: "Open", href: editor };
  }
}

const displayName = (job: JobSummary) => job.fileName ?? "Untitled sheet";

type TableProps = {
  jobs: JobSummary[];
  /** Rejects when the server refused; the table then tells the user. */
  onRemove: (jobId: string) => Promise<void>;
  caption: string;
};

/**
 * Table of the signed-in user's extraction jobs as the server lists them, with
 * each job's status. Removing a row only takes it off the list. The thumbnails
 * share one Backdrop, decided from all of the sheets together.
 */
export function RecentJobsTable(props: TableProps) {
  return (
    <BackdropGroup srcs={props.jobs.map((job) => job.imageUrl)}>
      <JobsTable {...props} />
    </BackdropGroup>
  );
}

function JobsTable({ jobs, onRemove, caption }: TableProps) {
  const now = useNow();

  function remove(job: JobSummary) {
    onRemove(job.jobId).then(
      () => toast.success("Removed from the list", { description: displayName(job) }),
      () => toast.error("Could not remove it", { description: `${displayName(job)} is still in your list. Try again.` })
    );
  }

  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Sheet</th>
            <th scope="col" className="hidden sm:table-cell">
              Assets
            </th>
            <th scope="col" className="hidden sm:table-cell">
              Status
            </th>
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
            const action = primaryAction(job);
            const name = displayName(job);
            const created = Date.parse(job.createdAt);
            return (
              <tr key={job.jobId}>
                <td>
                  <span className="flex items-center gap-3">
                    <BackdropSurface as="span" src={job.imageUrl} className="flex h-8 w-12 flex-none items-center justify-center overflow-hidden border border-line">
                      <SafeImage src={job.imageUrl} loading="lazy" className="size-full object-contain" fallbackClassName="border-0" />
                    </BackdropSurface>
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="oa-value max-w-[104px] truncate text-[13px] sm:max-w-[240px]" title={name}>
                        {name}
                      </span>
                      {/* Phones have no room for the Assets and Status columns, so they sit under the name. */}
                      <span className="flex flex-col items-start gap-1 sm:hidden">
                        <StatusBadge status={job.status} />
                        {job.assetCount > 0 && <span className="text-[11px] leading-4 text-ink-3">{job.assetCount} {job.assetCount === 1 ? "asset" : "assets"}</span>}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="hidden text-ink-2 sm:table-cell">{job.assetCount > 0 ? job.assetCount : "—"}</td>
                <td className="hidden sm:table-cell">
                  <span title={job.status === "failed" ? job.error : undefined}>
                    <StatusBadge status={job.status} />
                  </span>
                </td>
                <td className="hidden text-ink-2 sm:table-cell">
                  <time dateTime={Number.isFinite(created) ? job.createdAt : undefined} title={formatFullDate(created)}>
                    {formatRelativeTime(created, now)}
                  </time>
                </td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <Button asChild size="sm">
                      <Link href={action.href}>
                        {action.label}
                        <span className="sr-only"> {name}</span>
                      </Link>
                    </Button>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="sm" icon aria-label={`More actions for ${name}`}>
                          <Ellipsis aria-hidden />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        {action.label !== "Open" && (
                          <MenuItem asChild>
                            <Link href={`/editor/${job.jobId}`}>
                              <SquarePen aria-hidden />
                              Open in editor
                            </Link>
                          </MenuItem>
                        )}
                        <MenuItem onSelect={() => remove(job)}>
                          <X aria-hidden />
                          Remove from list
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
