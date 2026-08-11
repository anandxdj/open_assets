import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

export function EnhancePlaceholder({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-4xl items-center px-6 py-12">
      <section className="w-full border border-zinc-300 bg-white p-7 shadow-[8px_8px_0_0_rgb(24_24_27)] sm:p-10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-[8px_8px_0_0_rgb(244_244_245)]">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p>
          <Construction size={20} className="text-zinc-500" />
        </div>
        <h1 className="mt-4 text-2xl font-black uppercase tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
        <Link href="/enhance" className="mt-9 inline-flex items-center gap-2 border border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] transition-colors hover:bg-zinc-950 hover:text-white dark:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-950">
          <ArrowLeft size={15} /> Back to Enhance
        </Link>
      </section>
    </main>
  );
}
