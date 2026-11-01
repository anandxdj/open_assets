import { Boxes } from "lucide-react";
import { SafeImage } from "@/components/ui/safe-image";
import { cn } from "@/lib/utils";

/**
 * 2×2 collage of a pack's first assets on the checkerboard. Decorative: the
 * card around it carries the name.
 */
export function CoverGrid({ urls, className }: { urls: string[]; className?: string }) {
  const cells = urls.slice(0, 4);
  return (
    <div
      aria-hidden
      className={cn("oa-checker grid aspect-[4/3] grid-cols-2 grid-rows-2 overflow-hidden border-[1.5px] border-line", className)}
    >
      {cells.length === 0 ? (
        <span className="col-span-2 row-span-2 flex items-center justify-center text-ink-3">
          <Boxes className="size-[30%] max-h-8 max-w-8" />
        </span>
      ) : (
        Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="flex min-h-0 items-center justify-center">
            {cells[i] && <SafeImage src={cells[i]} loading="lazy" className="h-[70%] w-[70%] object-contain" />}
          </span>
        ))
      )}
    </div>
  );
}
