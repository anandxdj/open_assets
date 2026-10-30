import { WRAP } from "@/components/marketing/site";

const TEAMS = ["Open Polls", "Open Hire", "Tool Sadhan", "Chai Code", "Clipix"];

export function UsedBy() {
  return (
    <section aria-labelledby="used-by-title" className="border-y-2 border-line-strong bg-surface">
      <div className={`${WRAP} flex flex-col md:flex-row md:items-stretch`}>
        <h2 id="used-by-title" className="oa-label flex items-center pt-4 md:min-w-[150px] md:py-5 md:pr-4">
          Used by teams at
        </h2>
        <ul className="flex flex-1 flex-wrap gap-x-6 gap-y-2 py-4 md:grid md:grid-cols-5 md:gap-0 md:py-0">
          {TEAMS.map((name) => (
            <li
              key={name}
              className="oa-h3 flex items-center text-[15px] leading-5 text-ink-2 md:border-l-[1.5px] md:border-line md:px-4 md:py-5"
            >
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
