import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, CircleAlert, Clock, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types";

export const badgeVariants = cva("oa-badge", {
  variants: {
    tone: {
      neutral: "",
      /** Orange fill: selected objects only. Roles, plans and statuses never use it. */
      accent: "oa-badge-accent",
      pro: "oa-badge-pro",
      success: "oa-badge-success",
      warning: "oa-badge-warning",
      danger: "oa-badge-danger",
      info: "oa-badge-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type StatusMeta = { label: string; tone: NonNullable<BadgeProps["tone"]>; icon: "clock" | "spin" | "check" | "warn" | "fail" };

const JOB_STATUS: Record<JobStatus, StatusMeta> = {
  uploaded: { label: "Queued", tone: "neutral", icon: "clock" },
  queued: { label: "Queued", tone: "neutral", icon: "clock" },
  removing_bg: { label: "Removing background", tone: "info", icon: "spin" },
  detecting: { label: "Detecting", tone: "info", icon: "spin" },
  detected: { label: "Ready to review", tone: "success", icon: "check" },
  naming: { label: "Naming", tone: "info", icon: "spin" },
  cropping: { label: "Cropping", tone: "info", icon: "spin" },
  cropped: { label: "Ready to export", tone: "success", icon: "check" },
  finalizing: { label: "Finalizing", tone: "info", icon: "spin" },
  ready: { label: "Ready", tone: "success", icon: "check" },
  failed: { label: "Failed", tone: "danger", icon: "fail" },
};

export function jobStatusMeta(status: JobStatus): StatusMeta {
  return JOB_STATUS[status] ?? { label: status, tone: "neutral", icon: "clock" };
}

/** Status = icon + words + colour, never colour alone. */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: JobStatus;
  label?: string;
  className?: string;
}) {
  const meta = jobStatusMeta(status);
  const Icon =
    meta.icon === "spin" ? LoaderCircle : meta.icon === "check" ? Check : meta.icon === "warn" ? TriangleAlert : meta.icon === "fail" ? CircleAlert : Clock;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon aria-hidden className={meta.icon === "spin" ? "animate-spin" : undefined} />
      {label ?? meta.label}
    </Badge>
  );
}
