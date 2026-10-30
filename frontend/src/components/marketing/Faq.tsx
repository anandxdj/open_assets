import type { FaqItem } from "./pricing";

/** Two-column question list with rule dividers. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <dl className="grid border-t-2 border-line-strong md:grid-cols-2">
      {items.map((item) => (
        <div key={item.question} className="flex flex-col gap-1.5 border-b-[1.5px] border-line py-5 md:pr-6">
          <dt className="oa-section">{item.question}</dt>
          <dd className="text-xs leading-[18px] text-ink-2">{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
