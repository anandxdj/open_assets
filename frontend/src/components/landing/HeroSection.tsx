import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroPrimaryAction } from "./HeroPrimaryAction";

/** Plain text, not links: these are the teams the owner builds with. */
const TRUSTED_BY = ["Open Polls", "Open Hire", "Tool Sadhan", "Chai Code", "Clipix"];

/**
 * Hero: one centred column that fills the first screen under the header. Headline with the
 * tilted ink box, one sentence, two actions, then the "trusted by" row at the foot. A dot grid
 * and a soft accent glow sit behind it. The spec grid and the editor shot live in the next
 * section (ProductSection). Never wrap this in `Reveal`: it is what loads first.
 */
export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate flex flex-col items-center overflow-hidden border-b border-line-soft px-5 py-10 md:px-8 lg:min-h-[calc(100svh-61px)] lg:py-16"
    >
      {/* Dot grid and glow (decorative) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(color-mix(in_srgb,var(--oa-ink)_7%,transparent)_1px,transparent_1px)] bg-[size:24px_24px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-brand/10 to-brand-hover/5 blur-[140px]"
      />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-between gap-10 text-center">
        {/* Top spacer: balances the centred copy against the trust row on tall screens */}
        <div aria-hidden className="hidden h-6 lg:block" />

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <h1
            id="hero-title"
            className="text-balance py-1 text-3xl font-black uppercase leading-tight tracking-tighter sm:text-5xl md:text-6xl"
          >
            AI contour pipeline for{" "}
            <br />
            <span className="mt-4 inline-block -rotate-1 whitespace-nowrap border-2 border-ink bg-ink px-4 py-1.5 text-base font-black tracking-tight text-page shadow-[4px_4px_0_var(--oa-accent)] transition-transform duration-(--oa-dur-3) ease-(--oa-ease-out) hover:rotate-0 min-[360px]:text-lg sm:text-2xl md:text-4xl lg:text-5xl">
              <span aria-hidden>[ </span>
              Deep asset extraction
              <span aria-hidden> ]</span>
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-xs leading-relaxed tracking-tight text-ink-2 sm:text-sm md:text-base">
            High-performance computer vision SaaS built to segment complex sprite sheets, UI kits, and icon packs in
            milliseconds. Powered by AI to auto-name batch layers in production queues.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 pt-2 sm:flex-row">
            <HeroPrimaryAction />
            <Button asChild variant="secondary" size="lg" className="max-sm:w-full">
              <Link href="/collections">View collection</Link>
            </Button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-4 border-t border-line-soft pt-8">
          <p id="hero-trusted" className="text-[10px] font-bold uppercase leading-4 tracking-widest text-ink-3">
            Trusted &amp; integrated by builders at
          </p>
          <ul
            aria-labelledby="hero-trusted"
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] font-bold uppercase leading-4 tracking-wider text-ink-2 sm:text-xs"
          >
            {TRUSTED_BY.map((name) => (
              <li
                key={name}
                className="transition-colors duration-(--oa-dur-1) ease-(--oa-ease) hover:text-ink"
              >
                <span aria-hidden>[ </span>
                {name}
                <span aria-hidden> ]</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
