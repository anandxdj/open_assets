// Placeholder for studio modes that haven't shipped yet — replaced per phase.
export function ComingSoon({ mode, note }: { mode: string; note: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 font-mono">
      <div className="max-w-md border-2 border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
        <h1 className="text-lg font-black uppercase tracking-widest">{mode}</h1>
        <p className="mt-3 text-xs uppercase text-muted-foreground">{note}</p>
        <p className="mt-6 inline-block border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Coming soon
        </p>
      </div>
    </div>
  );
}
