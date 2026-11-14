import Link from "next/link";
import { Check } from "lucide-react";
import { communityTagHref } from "@/features/collections/tags";
import { cn } from "@/lib/utils";

/**
 * A tag as a link to the community page filtered by it. At least 24px tall (the
 * touch target minimum). The active one is inverted and carries a check mark, so
 * it never depends on colour alone, and says so with aria-current.
 */
export function TagChip({ tag, active = false, className }: { tag: string; active?: boolean; className?: string }) {
  return (
    <Link
      href={active ? "/collections" : communityTagHref(tag)}
      aria-current={active ? "true" : undefined}
      title={active ? `Showing “${tag}”. Select to clear the filter.` : `Show collections tagged “${tag}”`}
      className={cn(
        "relative z-10 inline-flex h-6 max-w-full items-center gap-1 border border-current px-2 text-[10.5px] font-bold uppercase leading-none tracking-[.06em] no-underline",
        active ? "border-inverse bg-inverse text-inverse-fg" : "text-ink-2 hover:bg-inverse hover:text-inverse-fg",
        className
      )}
    >
      {active && <Check aria-hidden className="size-3 flex-none stroke-[3]" />}
      <span className="min-w-0 break-all">
        <span className="sr-only">{active ? "Tag, selected: " : "Tag: "}</span>
        {tag}
      </span>
    </Link>
  );
}

/** The chips of one card. Renders nothing for an old collection without tags. */
export function TagChips({ tags, activeTag }: { tags: string[]; activeTag: string | null }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <li key={t} className="max-w-full">
          <TagChip tag={t} active={t === activeTag} />
        </li>
      ))}
    </ul>
  );
}
