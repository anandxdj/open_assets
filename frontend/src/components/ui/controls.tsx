"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { indeterminate?: boolean }
>(({ className, indeterminate, ...props }, ref) => {
  const inner = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return <input ref={inner} type="checkbox" className={cn("oa-checkbox", className)} {...props} />;
});
Checkbox.displayName = "Checkbox";

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn("oa-switch", className)}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  );
}

export function Range({
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="range" className={cn("oa-range", className)} {...props} />;
}

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
  disabled?: boolean;
};

/** Mutually exclusive choice. The current option is ink-inverted. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  block,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel: string;
  block?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("oa-seg", block && "oa-seg-block", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="oa-seg-item"
          aria-pressed={opt.value === value}
          aria-label={opt.ariaLabel}
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({
  value,
  label,
  className,
}: {
  /** 0–100 */
  value: number;
  label: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className={cn("oa-progress", className)}
    >
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("oa-kbd", className)} {...props} />;
}
