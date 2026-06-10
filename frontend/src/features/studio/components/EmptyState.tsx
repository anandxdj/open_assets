"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  subtitle,
  onPickFile,
  onDropFile,
  footer,
}: {
  title: string;
  subtitle: string;
  onPickFile: () => void;
  onDropFile: (file: File) => void;
  /** Optional extra row under the drop zone (e.g. "or generate one with AI"). */
  footer?: React.ReactNode;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-center px-6 pb-8 pt-4 font-mono">
      <div className="w-full max-w-2xl">
        <div
          onClick={onPickFile}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) onDropFile(file);
          }}
          className={cn(
            "group relative cursor-pointer border-2 border-dashed px-8 py-20 text-center transition-all rounded-none",
            drag
              ? "border-zinc-950 dark:border-white bg-zinc-100 dark:bg-zinc-900"
              : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 dark:hover:border-zinc-500",
          )}
        >
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center border-2 border-zinc-950 dark:border-zinc-700 text-foreground transition-transform group-hover:scale-110">
            <Upload size={24} />
          </div>
          <p className="mb-1.5 text-sm font-black uppercase tracking-wider">{title}</p>
          <p className="text-xs uppercase text-muted-foreground">{subtitle}</p>
        </div>

        {footer && (
          <div className="mt-5 flex items-center justify-center gap-2 text-[12px] uppercase">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
