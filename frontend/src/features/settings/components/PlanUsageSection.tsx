"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { PlanOverview } from "@/features/settings/components/PlanOverview";
import { SectionError, SectionLoading, SubSection } from "@/features/settings/components/parts";
import { getUsage, listUsageEvents } from "@/features/settings/api";
import { useRemote } from "@/features/settings/useRemote";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";
import { cn } from "@/lib/utils";
import type { Usage, UsageEvent, UsageOp } from "@/types/account";

const PAGE_SIZE = 10;

const OP_LABEL: Record<UsageOp, string> = {
  extend: "Extend image",
  generate: "Generate image",
  "scene-brief": "Scene brief",
  "prop-brief": "Prop brief",
  "tile-review": "Tile review",
  "sprite-review": "Sprite review",
  "anibuddy-prompt": "AniBuddy prompt",
  "anibuddy-rig": "AniBuddy rig",
  "anibuddy-animate": "AniBuddy animation",
};

const resetDate = new Intl.DateTimeFormat("en", { dateStyle: "long" });

/* ------------------------------ credits -------------------------------- */

// The plan itself (effective plan, limits, trial) is PlanOverview, from
// /api/plans/me. This block is only the Studio AI credits; the stored
// `usage.plan` is deliberately not shown (an expired trial still stores "pro").
function Credits({ usage }: { usage: Usage }) {
  const left = Math.max(0, usage.credits);
  const percent = usage.monthlyGrant > 0 ? (left / usage.monthlyGrant) * 100 : 0;
  const reset = new Date(usage.resetAt);
  const resetLabel = Number.isNaN(reset.getTime()) ? null : resetDate.format(reset);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-[460px] flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p>
            <span className="oa-h2">{left}</span>{" "}
            <span className="text-xs text-ink-2">of {usage.monthlyGrant} AI credits left</span>
          </p>
          {resetLabel && (
            <p className="text-xs text-ink-2">
              Resets on <time dateTime={usage.resetAt}>{resetLabel}</time>
            </p>
          )}
        </div>
        <Progress value={percent} label="AI credits left this month" />
      </div>

      {left === 0 && (
        <Notice tone="warning" role="status">
          You have used all your AI credits for this month.
          {resetLabel ? ` They reset on ${resetLabel}.` : ""}
        </Notice>
      )}
    </div>
  );
}

/* ------------------------------ usage history -------------------------- */

function StatusBadge({ status }: { status: UsageEvent["status"] }) {
  return status === "refunded" ? (
    <Badge tone="info">
      <Undo2 aria-hidden />
      Refunded
    </Badge>
  ) : (
    <Badge>Used</Badge>
  );
}

function UsageHistory() {
  const [page, setPage] = useState(1);
  const events = useRemote(async () => (await listUsageEvents(page, PAGE_SIZE)).data, page, "Could not load your usage history.");
  const now = useNow();

  if (events.status === "error") return <SectionError message={events.error ?? ""} onRetry={events.reload} />;
  const data = events.data;
  if (data === undefined) return <SectionLoading label="Loading usage" />;

  if (data.total === 0) {
    return (
      <div className="border-[1.5px] border-dashed border-line p-4">
        <p className="text-xs font-bold leading-[18px]">No usage yet</p>
        <p className="text-xs leading-[18px] text-ink-2">
          AI credits are spent when Studio and AniBuddy generate for you. Each use is listed here.
        </p>
      </div>
    );
  }

  const first = (data.page - 1) * data.limit + 1;
  const last = first + data.items.length - 1;
  const loading = events.status === "loading";

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("oa-table-box transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
        <table className="oa-table">
          <caption className="sr-only">Recent AI credit usage, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              <th scope="col" className="text-right">
                AI credits
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((e) => {
              const ms = Date.parse(e.createdAt);
              return (
                <tr key={e.id}>
                  <td className="text-ink-2">
                    <time dateTime={e.createdAt} title={formatFullDate(ms)}>
                      {formatRelativeTime(ms, now)}
                    </time>
                  </td>
                  <td>
                    <span className="flex flex-col gap-0.5">
                      <span>
                        {OP_LABEL[e.op] ?? e.op}
                        {e.units > 1 && <span className="text-ink-3"> ×{e.units}</span>}
                      </span>
                      <span className="block max-w-[240px] truncate text-[11px] text-ink-3" title={e.modelId}>
                        {e.modelId}
                      </span>
                    </span>
                  </td>
                  <td className="text-right">{e.cost}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-2" aria-live="polite">
          {first}–{last} of {data.total}
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" icon aria-label="Newer usage" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button size="sm" icon aria-label="Older usage" disabled={!data.hasMore || loading} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- section ------------------------------ */

export function PlanUsageContent() {
  const usage = useRemote(async () => (await getUsage()).data, "usage", "Could not load your plan.");

  return (
    <>
      <SubSection first title="Plan" description="What your account includes right now.">
        <PlanOverview />
      </SubSection>
      <SubSection title="AI credits" description="Studio and AniBuddy generations spend AI credits.">
        {usage.status === "error" ? (
          <SectionError message={usage.error ?? ""} onRetry={usage.reload} />
        ) : usage.data === undefined ? (
          <SectionLoading label="Loading AI credits" />
        ) : (
          <Credits usage={usage.data} />
        )}
      </SubSection>
      <SubSection title="Recent usage">
        <UsageHistory />
      </SubSection>
    </>
  );
}
