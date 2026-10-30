import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type ControlSize = "sm" | "md" | "lg";

const inputSize: Record<ControlSize, string> = {
  sm: "oa-input-sm",
  md: "",
  lg: "oa-input-lg",
};

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "md", invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn("oa-input", inputSize[size], className)}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("oa-textarea", className)} {...props} />
));
Textarea.displayName = "Textarea";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
}

/** Native select: keyboard and screen-reader behaviour for free. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = "md", children, ...props }, ref) => (
    <span className={cn("relative block", className)}>
      <select
        ref={ref}
        className={cn("oa-select", size === "sm" && "h-7 pl-2 text-xs")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink"
      />
    </span>
  )
);
Select.displayName = "Select";

/** Bordered row holding a leading icon, an input and optional trailing content. */
export function InputGroup({
  icon,
  trailing,
  className,
  children,
}: {
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("oa-input-group", className)}>
      {icon}
      {children}
      {trailing}
    </label>
  );
}
