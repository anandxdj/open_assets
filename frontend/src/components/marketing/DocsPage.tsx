import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOCS_ORDER, DOCS_PAGES, type DocsPageId, type DocsSectionId } from "./docs.config";

/* -------------------------------------------------------------------------- */
/* Building blocks for docs copy                                              */
/* -------------------------------------------------------------------------- */

/** A block of code or output. Scrolls sideways and is focusable so keyboard users can scroll it. */
export function Code({ label, children }: { label: string; children: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="oa-value max-w-full overflow-x-auto border-[1.5px] border-line-strong bg-sunken px-4 py-3.5 leading-[18px]"
    >
      <code>{children}</code>
    </pre>
  );
}

/** Code inside a sentence. */
export function Ic({ children }: { children: ReactNode }) {
  return <code className="oa-value border border-rule bg-sunken px-1 py-px">{children}</code>;
}

/** The method and path of one endpoint. Paths are relative to the API origin. */
export function Endpoint({ method, path }: { method: "GET" | "POST"; path: string }) {
  return (
    <p className="flex flex-wrap items-center gap-3">
      <Badge>{method}</Badge>
      <code className="oa-value text-[13px] font-bold break-all">{path}</code>
    </p>
  );
}

/** Small heading inside a section ("Request", "Response"). */
export function Label({ children }: { children: ReactNode }) {
  return <h3 className="oa-label pt-2 text-ink-3">{children}</h3>;
}

/* -------------------------------------------------------------------------- */
/* Page frame                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One docs article. The title, the section list and the order come from
 * docs.config.ts; `sections` must hold a body for every section id listed
 * there, which TypeScript checks, so a page cannot lose a section or add one
 * the sidebar does not know.
 */
export function DocsPage<P extends DocsPageId>({
  page,
  intro,
  sections,
}: {
  page: P;
  intro: ReactNode;
  sections: Record<DocsSectionId<P>, ReactNode>;
}) {
  const config = DOCS_PAGES[page];
  const titleId = `docs-${page}-title`;
  const at = DOCS_ORDER.indexOf(page);
  const prev = at > 0 ? DOCS_PAGES[DOCS_ORDER[at - 1] as DocsPageId] : null;
  const next = at < DOCS_ORDER.length - 1 ? DOCS_PAGES[DOCS_ORDER[at + 1] as DocsPageId] : null;
  const bodies = sections as Record<string, ReactNode>;

  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-10">
      <header className="flex flex-col gap-5">
        <span className="oa-eyebrow">{config.eyebrow}</span>
        <h1 id={titleId} className="oa-display text-[clamp(32px,5vw,56px)] leading-[1]">
          {config.title}
        </h1>
        <p className="oa-lead max-w-[640px]">{intro}</p>
      </header>

      <div className="flex min-w-0 flex-col">
        {config.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${page}-${section.id}-title`}
            className="scroll-mt-24 border-t-[1.5px] border-line py-8 first:border-t-0 first:pt-0"
          >
            <h2 id={`${page}-${section.id}-title`} className="oa-h3 mb-5 min-w-0 break-words">
              {section.title}
            </h2>
            <div className="flex flex-col gap-4 text-[13px] leading-[22px] [&_p]:max-w-[70ch]">{bodies[section.id]}</div>
          </section>
        ))}
      </div>

      <nav aria-label="Previous and next page" className="flex flex-wrap justify-between gap-4 border-t-2 border-line-strong pt-6">
        {prev ? (
          <Link href={prev.href} className="oa-label inline-flex items-center gap-2 hover:underline hover:decoration-[1.5px] hover:underline-offset-4">
            <ArrowLeft aria-hidden className="size-4" />
            {prev.label}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={next.href} className="oa-label inline-flex items-center gap-2 hover:underline hover:decoration-[1.5px] hover:underline-offset-4">
            {next.label}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </nav>
    </article>
  );
}
