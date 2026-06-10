"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatusPill({
  status,
  message,
}: {
  status: "idle" | "working" | "error" | "ok";
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-none",
        status === "error"
          ? "border-destructive text-destructive"
          : status === "ok"
            ? "border-zinc-950 dark:border-white text-foreground"
            : "border-zinc-300 dark:border-zinc-700 text-muted-foreground",
      )}
    >
      {status === "working" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <span className="inline-block h-1.5 w-1.5 bg-current" />
      )}
      <span>{message}</span>
    </div>
  );
}
