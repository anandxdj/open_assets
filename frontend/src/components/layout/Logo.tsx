import { useId } from "react";
import { cn } from "@/lib/utils";

/** The OA monogram drawn as a vector so it follows the text colour. */
export function LogoMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="90 380 1370 780" className={cn("h-[17px] w-[30px] flex-none", className)} aria-hidden>
      <mask id={maskId}>
        <rect x="0" y="0" width="1600" height="1600" fill="#fff" />
        <polygon points="593,1200 926,600 1100,600 1100,1200" fill="#000" />
      </mask>
      <circle cx="480" cy="770" r="294" fill="none" stroke="currentColor" strokeWidth="172" mask={`url(#${maskId})`} />
      <polygon points="695,1115 1100,390 1450,1115 975,1115 1075,945 1195,945 1095,750 890,1115" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-ink", className)}>
      <LogoMark />
      <span className="text-[13px] font-extrabold uppercase tracking-[-0.01em]">OpenAssets</span>
    </span>
  );
}
