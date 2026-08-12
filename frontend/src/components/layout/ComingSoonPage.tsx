import Link from "next/link";

type ComingSoonPageProps = {
  name: string;
  description: string;
};

export function ComingSoonPage({ name, description }: ComingSoonPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-6 py-12 sm:py-20">
      <section className="w-full border-2 border-zinc-950 bg-zinc-50 p-6 shadow-[8px_8px_0_0_rgb(24_24_27)] dark:border-zinc-100 dark:bg-zinc-950 dark:shadow-[8px_8px_0_0_rgb(212_212_216)] sm:p-10">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          OpenAssets · in development
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black uppercase tracking-tight sm:text-5xl">{name}</h1>
          <span className="border border-amber-500 bg-amber-300 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-zinc-950">
            Coming soon
          </span>
        </div>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
        <Link
          href="/collections"
          className="mt-8 inline-flex border-2 border-zinc-950 bg-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-transparent hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-transparent dark:hover:text-zinc-100"
        >
          Browse assets
        </Link>
      </section>
    </main>
  );
}
