import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Announced loading line shown while a route segment streams in. Fills the space its layout gives it. */
export function RouteLoading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex flex-1 items-center justify-center py-24", className)}>
      <span className="oa-label flex items-center gap-2.5">
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        {label}
      </span>
    </div>
  );
}
