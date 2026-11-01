"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

// Motion (DESIGN.md, Motion): a short fade and a 4px slide away from the trigger's side, 120ms.
const MENU_MOTION =
  "duration-120 ease-(--oa-ease-out) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[side=bottom]:data-[state=open]:slide-in-from-top-1 data-[side=top]:data-[state=open]:slide-in-from-bottom-1 data-[side=left]:data-[state=open]:slide-in-from-right-1 data-[side=right]:data-[state=open]:slide-in-from-left-1";

export function MenuContent({
  className,
  align = "end",
  sideOffset = 6,
  // Keep clear of the viewport edge so the 6px hard shadow is never cut off, notably on phones.
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("oa-menu", MENU_MOTION, className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof DropdownMenu.Item> & { danger?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn("oa-menu-item", danger && "oa-menu-item-danger", className)}
      {...props}
    />
  );
}

export const MenuRadioGroup = DropdownMenu.RadioGroup;

/** One choice of a group. The chosen one carries a check; the group announces it as a radio. */
export function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn("oa-menu-item", className)} {...props}>
      <span aria-hidden className="inline-flex size-4 flex-none items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check strokeWidth={3} />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export function MenuSeparator(props: React.ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className="oa-menu-sep" {...props} />;
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("oa-menu-label", className)} {...props} />;
}
