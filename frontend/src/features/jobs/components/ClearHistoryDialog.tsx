"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";

/**
 * Confirms emptying the whole history list. The dialog stays open, busy, while
 * the server answers, and shows the failure if it refuses.
 */
export function ClearHistoryDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rejects when the server refused. */
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Clear your history?"
        description="Every extraction is removed from this list. Jobs are not deleted: they stay on the server until they expire, and any still running keeps going."
      >
        {failed && (
          <DialogBody className="pb-0">
            <Notice tone="danger" role="alert">
              <strong className="font-bold">Could not clear the list.</strong> Your history is unchanged. Try again.
            </Notice>
          </DialogBody>
        )}
        <DialogFooter className="border-t-0 pt-5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Keep it
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={handleConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            Clear history
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
