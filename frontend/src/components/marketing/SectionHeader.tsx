import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SECTION_TITLE } from "./site";

/** Eyebrow + large title on the left, optional aside (link, note) on the right. */
export function SectionHeader({
  eyebrow,
  title,
  titleId,
  aside,
  as: Heading = "h2",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  titleId?: string;
  aside?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-5", className)}>
      <div className="flex flex-col gap-4">
        <span className="oa-eyebrow">{eyebrow}</span>
        <Heading id={titleId} className={cn(SECTION_TITLE, "max-w-[760px]")}>
          {title}
        </Heading>
      </div>
      {aside}
    </div>
  );
}
