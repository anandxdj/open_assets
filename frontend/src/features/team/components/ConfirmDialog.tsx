"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";

/**
 * Asks before something that takes access or data away. The focus lands on the
 * safe button first (Radix focuses the first focusable element, the close
 * button), and the dialog cannot be dismissed while the request runs.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** Resolve true to close the dialog; false keeps it open (the caller reports the error). */
  onConfirm: () => Promise<boolean>;
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
        <DialogFooter className="border-t-0 pt-5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {cancelLabel}
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
