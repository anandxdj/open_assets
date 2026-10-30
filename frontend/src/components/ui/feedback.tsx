import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "danger" | "success";

const toneIcon: Record<Tone, React.ElementType> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
};

/** Inline message in the flow of a page or panel. */
export function Notice({
  tone = "info",
  className,
  children,
  role,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  role?: "status" | "alert";
}) {
  const Icon = toneIcon[tone];
  return (
    <div role={role} className={cn("oa-notice", `oa-notice-${tone}`, className)}>
      <Icon aria-hidden className="mt-px size-4 flex-none" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Empty, gated or failed screen state with one next step. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  tone = "neutral",
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        tone === "danger" ? "border-2 border-danger bg-danger-soft" : "border-2 border-dashed border-line",
        className
      )}
    >
      {icon && (
        <span className={cn("oa-icon-box", tone === "danger" && "border-danger text-danger")}>{icon}</span>
      )}
      <h2 className="oa-h3">{title}</h2>
      {description && <p className="max-w-sm text-xs leading-[18px] text-ink-2">{description}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** Transparent assets always sit on the checkerboard. */
export function Checker({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("oa-checker", className)} {...props} />;
}
