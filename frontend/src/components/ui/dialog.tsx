"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Centered modal with a scrim. Title is required for screen readers. */
export function DialogContent({
  title,
  description,
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  // Radix only returns focus to a DialogTrigger. Dialogs opened from state (a
  // button's onClick, a menu item) have none, so remember what had focus when
  // the dialog opened and give it back on close, unless the caller says where.
  const returnTo = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="oa-scrim fixed inset-0 z-50" />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          const active = document.activeElement;
          returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const el = returnTo.current;
          returnTo.current = null;
          if (el?.isConnected) {
            event.preventDefault();
            el.focus();
          }
        }}
        className={cn(
          "oa-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(460px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col outline-none",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="oa-h3">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs leading-[18px] text-ink-2">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon" aria-label="Close">
            <X aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3.5 overflow-y-auto p-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex justify-end gap-2.5 border-t-[1.5px] border-line px-5 py-3.5", className)}
      {...props}
    />
  );
}
