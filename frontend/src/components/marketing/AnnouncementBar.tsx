import Link from "next/link";

/** Three accent stars at each end of the bar (decorative, hidden from assistive tech). */
function Stars() {
  return (
    <span aria-hidden className="hidden shrink-0 gap-1.5 text-brand-on-ink sm:flex">
      <span>★</span>
      <span>★</span>
      <span>★</span>
    </span>
  );
}

/**
 * The strip above the landing header: ink-inverted (black on light, paper on dark), three accent
 * stars at each end, the line in the middle. It scrolls away with the page; the header under it
 * stays sticky. Landing page only.
 */
export function AnnouncementBar() {
  return (
    <aside aria-label="Announcement" className="bg-ink text-page">
      <div className="flex min-h-9 items-center justify-between gap-4 px-4 py-2 text-[10px] font-bold uppercase leading-4 tracking-tight sm:text-xs">
        <Stars />
        <p className="mx-auto text-center">
          Open to raise <span className="font-black text-brand-on-ink">$$$ in X series</span>
          <span aria-hidden className="px-2">|</span>
          <Link
            href="/careers"
            className="whitespace-nowrap underline-offset-4 transition-colors duration-(--oa-dur-1) ease-(--oa-ease) hover:underline"
          >
            Learn what&rsquo;s next <span aria-hidden>→</span>
          </Link>
        </p>
        <Stars />
      </div>
    </aside>
  );
}
