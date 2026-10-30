"use client";

import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  initialName?: string;
  placeholder?: string;
  /** Minimum trimmed length. Publishing requires 2. */
  minLength?: number;
  /** Resolve true to close the dialog; false keeps it open (the caller reports the error). */
  onSubmit: (name: string) => Promise<boolean>;
  /** Where focus goes after closing, for dialogs opened from a menu that no longer exists. */
  onCloseAutoFocus?: (event: Event) => void;
};

function NameForm({
  submitLabel,
  initialName = "",
  placeholder,
  minLength = 1,
  onSubmit,
  onDone,
}: Omit<NameDialogProps, "open" | "onOpenChange" | "title" | "description" | "onCloseAutoFocus"> & {
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next.length < minLength) {
      setError(minLength > 1 ? `Use at least ${minLength} characters.` : "Enter a name.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(next);
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="contents">
      <DialogBody>
        <Field label="Name" htmlFor={id} error={error}>
          <Input
            id={id}
            autoFocus
            value={name}
            maxLength={120}
            placeholder={placeholder}
            invalid={Boolean(error)}
            aria-describedby={error ? `${id}-note` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
          {busy && <LoaderCircle aria-hidden className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Create, rename, or name-before-publish. The form state resets each time it opens. */
export function NameDialog({ open, onOpenChange, title, description, onCloseAutoFocus, ...form }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} onCloseAutoFocus={onCloseAutoFocus}>
        <NameForm {...form} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Resolve true to close the dialog. */
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
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        title="Delete this collection?"
        description={
          <>
            <span className="font-bold text-ink">{name}</span> and every image in it will be deleted for good. This
            cannot be undone.
          </>
        }
      >
        <DialogFooter className="border-t-0 pt-5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Keep it
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={handleConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            Delete collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
