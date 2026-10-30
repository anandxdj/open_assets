"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";

/**
 * The one confirmation dialog. Use it before anything that removes data or
 * access, or that signs someone out.
 *
 * - The title is a question ("Delete this collection?"), the description says
 *   what is lost and whether it can be undone.
 * - Cancel is always "Cancel" and sits left of the confirm button. The confirm
 *   button names the action ("Delete collection"), never "OK" or "Yes".
 * - Destructive actions use tone "danger" (the default); anything else that
 *   still needs a second look uses "primary".
 * - The dialog cannot be dismissed while the request runs. `onConfirm` resolves
 *   true to close; false keeps it open (the caller reports the failure, or
 *   passes it as `error` to show it inside the dialog).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "danger",
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  error?: React.ReactNode;
  /** Resolve true to close the dialog; false keeps it open. */
  onConfirm: () => Promise<boolean>;
  /** Where focus goes after closing, for dialogs opened from a menu that no longer exists. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent title={title} description={description} onCloseAutoFocus={onCloseAutoFocus}>
        {error ? (
          <DialogBody className="pb-0">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </DialogBody>
        ) : null}
        <DialogFooter className="border-t-0 pt-5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant={tone} onClick={handleConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
