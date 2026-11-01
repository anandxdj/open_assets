import type { FaqItem } from "./pricing";
import { COPY } from "./site";

/** Two-column question list with soft rule dividers. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <dl className="grid border-t border-line-soft md:grid-cols-2 md:gap-x-12">
      {items.map((item) => (
        <div key={item.question} className="flex flex-col gap-2 border-b border-line-soft py-6">
          <dt className="oa-section">{item.question}</dt>
          <dd className={`${COPY} text-ink-2`}>{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
