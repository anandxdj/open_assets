import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/**
 * One settings section: a ruled band with the title and its explanation on the
 * left (desktop) and the controls on the right. Stacks on phones.
 */
export function SettingsSection({
  id,
  title,
  description,
  danger,
  children,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "grid scroll-mt-4 gap-5 border-t-[1.5px] py-7 xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-10",
        danger ? "border-danger" : "border-line"
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className={cn("oa-section", danger && "text-danger")}>
          {title}
        </h2>
        <p className="text-xs leading-[18px] text-ink-2">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-7">{children}</div>
    </section>
  );
}

/** A titled group inside a section, divided from the previous group by a light rule. */
export function SubSection({
  title,
  description,
  first,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3.5", !first && "border-t border-rule pt-7")}>
      <div className="flex flex-col gap-1">
        <h3 className="oa-label text-ink">{title}</h3>
        {description && <p className="max-w-[60ch] text-xs leading-[18px] text-ink-2">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SectionLoading({ label }: { label: string }) {
  return (
    <div role="status" className="oa-label flex items-center gap-2.5 py-3">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="danger" role="alert">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Notice>
  );
}
