import Image from "next/image";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Detection boxes over public/samples/sprite-sheet.svg (640×320), as
// percentages of the sheet, matching the approved Auth board.
const BOXES: { left: number; top: number; width: number; height: number; label?: string }[] = [
  { left: 6.5, top: 8.7, width: 7.6, height: 21.3 },
  { left: 28.4, top: 11.9, width: 11.25, height: 22.5, label: "iron_sword" },
  { left: 53.9, top: 9.1, width: 12.1, height: 24.3 },
  { left: 78.1, top: 12.25, width: 11.2, height: 22 },
  { left: 5.1, top: 61.3, width: 12.2, height: 21 },
  { left: 29.9, top: 54.6, width: 11.5, height: 29.5 },
  { left: 53.6, top: 59, width: 12.4, height: 23 },
  { left: 79.6, top: 56.75, width: 10.3, height: 25.9 },
];

/** Right-hand panel on wide screens: a sample extraction result. */
export function AuthShowcase({ className }: { className?: string }) {
  return (
    <aside
      aria-label="What OpenAssets does"
      className={cn(
        "m-3 hidden min-h-[640px] min-w-0 flex-1 flex-col items-center justify-center gap-8 border-[1.5px] border-line bg-sunken p-12 lg:flex",
        className
      )}
    >
      <div className="w-full max-w-[520px] overflow-hidden border-[1.5px] border-line bg-surface shadow-float">
        <div className="flex h-10 items-center gap-2 border-b-[1.5px] border-line px-3.5">
          <span className="oa-value min-w-0 truncate">rpg_pack_v1.png</span>
          <Badge tone="success" className="ml-auto">
            <Check aria-hidden />8 found
          </Badge>
        </div>
        <div className="oa-checker relative m-4 aspect-[2/1]">
          <Image
            src="/samples/sprite-sheet.svg"
            alt="Sprite sheet with eight game items, each outlined by a detection box"
            fill
            sizes="520px"
            unoptimized
          />
          {BOXES.map((box) => (
            <span
              key={`${box.left}-${box.top}`}
              aria-hidden
              className={cn("absolute", box.label ? "border-2 border-brand" : "border-[1.5px] border-ink")}
              style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
            >
              {box.label && (
                <span className="absolute -left-0.5 -top-[19px] h-[18px] whitespace-nowrap bg-brand px-[5px] text-[10px] font-bold leading-[18px] text-brand-fg">
                  {box.label}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="flex max-w-[420px] flex-col gap-2 text-center">
        <p className="oa-h3">Every asset, cut clean</p>
        <p className="text-xs leading-[18px] text-ink-2">
          Detect, name and export each sprite on a sheet as transparent PNGs.
        </p>
      </div>
    </aside>
  );
}
