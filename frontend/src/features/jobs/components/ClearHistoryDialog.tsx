"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const [failed, setFailed] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
      title="Clear your history?"
      description="Every extraction is removed from this list. Jobs are not deleted: they stay on the server until they expire, and any still running keeps going."
      confirmLabel="Clear history"
      error={
        failed ? (
          <>
            <strong className="font-bold">Could not clear the list.</strong> Your history is unchanged. Try again.
          </>
        ) : undefined
      }
      onConfirm={async () => {
        setFailed(false);
        try {
          await onConfirm();
          return true;
        } catch {
          setFailed(true);
          return false;
        }
      }}
    />
  );
}
