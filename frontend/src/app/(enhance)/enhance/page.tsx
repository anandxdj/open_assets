import { Sparkles, Swords, WandSparkles } from "lucide-react";
import { EnhanceToolCard } from "@/features/enhance/components/EnhanceToolCard";

export default function EnhancePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-16">
      <section className="border-b-2 border-zinc-950 pb-10 dark:border-zinc-100">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Enhance workspace</p>
        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <div>
            <h1 className="max-w-3xl text-4xl font-black leading-[0.98] tracking-[-0.055em] sm:text-6xl">
              Make the asset you already have work harder.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-300">
              Clean linework, apply provider-backed improvements, or animate a character without sending it through an image-generation workflow.
            </p>
          </div>
          <p className="border-l-2 border-zinc-950 pl-4 font-mono text-xs leading-5 text-zinc-600 dark:border-zinc-100 dark:text-zinc-300">
            Your source stays intact. Every edit is visible, exportable, and traceable to its settings.
          </p>
        </div>
      </section>

      <section aria-labelledby="enhance-tools" className="py-10 sm:py-14">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="enhance-tools" className="text-lg font-black tracking-tight">Choose a job</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">3 focused tools</span>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
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
          <EnhanceToolCard
            href="/enhance/anibuddy"
            icon={Sparkles}
            eyebrow="2D puppet animation"
            title="AniBuddy"
            description="Turn supplied character art into an editable rig and export motion made from the pixels you provide."
            detail="No invented frames"
            accentClassName="bg-fuchsia-400"
          />
        </div>
      </section>
    </main>
  );
}
