"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_ORDER, DOCS_PAGES } from "./docs.config";

/**
 * Docs sidebar: the pages, and under the page you are on its sections. Sticky
 * beside the article on desktop, a plain list above it on phones (where the
 * section list is left out: the article is one scroll).
 */
export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Documentation"
      className="lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-108px)] lg:self-start lg:overflow-y-auto"
    >
      <h2 className="oa-label mb-3 text-ink-3">Docs</h2>
      <ul className="flex flex-col border-t border-line-soft">
        {DOCS_ORDER.map((id) => {
          const page = DOCS_PAGES[id];
          const current = pathname === page.href;
          return (
            <li key={id} className="border-b border-line-soft">
              <Link
                href={page.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "oa-label block bg-inverse px-3 py-2 text-inverse-fg"
                    : "oa-label block px-3 py-2 hover:underline hover:decoration-[1.5px] hover:underline-offset-4"
                }
              >
                {page.label}
              </Link>
              {current && (
                <ol className="hidden flex-col py-2 lg:flex">
                  {page.sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="block py-1 pl-3 text-xs leading-[18px] text-ink-2 hover:text-ink hover:underline hover:decoration-[1.5px] hover:underline-offset-4"
                      >
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
