"use client";

import * as React from "react";
import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

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
        className={cn("oa-menu", className)}
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

export function MenuSeparator(props: React.ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className="oa-menu-sep" {...props} />;
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("oa-menu-label", className)} {...props} />;
}
