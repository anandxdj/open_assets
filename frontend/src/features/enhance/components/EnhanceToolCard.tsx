import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

interface EnhanceToolCardProps {
  href: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  detail: string;
  accentClassName: string;
}

export function EnhanceToolCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  description,
  detail,
  accentClassName,
}: EnhanceToolCardProps) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[19rem] flex-col overflow-hidden border border-zinc-300 bg-white p-6 transition-transform duration-200 hover:-translate-y-1 hover:border-zinc-950 hover:shadow-[6px_6px_0_0_rgb(24_24_27)] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-100 dark:hover:shadow-[6px_6px_0_0_rgb(244_244_245)]"
    >
      <div className={`absolute left-0 top-0 h-1.5 w-full ${accentClassName}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center border border-current text-zinc-950 dark:text-zinc-50">
          <Icon size={21} strokeWidth={1.7} />
        </div>
        <ArrowUpRight className="text-zinc-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-950 dark:group-hover:text-zinc-50" size={20} />
      </div>
      <div className="mt-auto pt-10">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p>
        <h2 className="mt-3 text-2xl font-black uppercase tracking-tight">{title}</h2>
        <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-600 dark:text-zinc-400">{description}</p>
        <p className="mt-6 border-t border-zinc-200 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-700">{detail}</p>
      </div>
    </Link>
  );
}
