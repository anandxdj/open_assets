import { Loading } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/** Announced loading line shown while a route segment streams in. Fills the space its layout gives it. */
export function RouteLoading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center py-24", className)}>
      <Loading label={label} />
    </div>
  );
}
