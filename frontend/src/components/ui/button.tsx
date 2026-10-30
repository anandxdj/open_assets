import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Visual rules live in globals.css (.oa-btn*). One primary button per view.
export const buttonVariants = cva("oa-btn", {
  variants: {
    variant: {
      primary: "oa-btn-primary",
      secondary: "oa-btn-secondary",
      ghost: "oa-btn-ghost",
      danger: "oa-btn-danger",
    },
    size: {
      sm: "oa-btn-sm",
      md: "",
      lg: "oa-btn-lg",
      xl: "oa-btn-xl",
    },
    icon: {
      true: "oa-btn-icon",
      false: "",
    },
    block: {
      true: "w-full",
      false: "",
    },
  },
  defaultVariants: {
    variant: "secondary",
    size: "md",
    icon: false,
    block: false,
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (for example a Next.js Link) with button styles. */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, icon, block, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size, icon, block }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
