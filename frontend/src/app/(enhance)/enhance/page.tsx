import { Swords, WandSparkles } from "lucide-react";
import { EnhanceToolCard } from "@/features/enhance/components/EnhanceToolCard";

export default function EnhancePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-16">
      <section className="border-b-2 border-zinc-950 pb-6 dark:border-zinc-100">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Enhance workspace</p>
        <h1 className="mt-2 text-2xl font-black uppercase tracking-tight">
          Make the asset you already have work harder
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          Clean linework deterministically or apply AI-backed asset improvements.
        </p>
      </section>

      <section aria-labelledby="enhance-tools" className="py-10 sm:py-14">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="enhance-tools" className="text-lg font-black uppercase tracking-tight">Choose a job</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">2 focused tools</span>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <EnhanceToolCard
            href="/enhance/excalibur"
            icon={Swords}
            eyebrow="Deterministic cleanup"
            title="Excalibur Enhance"
            description="Polish line art, repair small breaks, control contrast, add flat color, and export a reproducible PNG."
            detail="No image generation"
            accentClassName="bg-amber-400"
          />
          <EnhanceToolCard
            href="/enhance/ai"
            icon={WandSparkles}
            eyebrow="Account-enabled tools"
            title="AI Enhance"
            description="Use only the Cloudinary operations configured for this account, with clear availability and cost feedback."
            detail="Provider capability check"
            accentClassName="bg-sky-400"
          />
        </div>
      </section>
    </main>
  );
}
