"use client";

import { useId, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { deleteAccount, errorMessage } from "@/features/settings/api";
import { TeamDeletionWarning } from "@/features/team/components/TeamDeletionWarning";
import { tokenStore } from "@/lib/token-store";

const LOSSES = [
  "Your profile and sign-in",
  "Every collection you own, including published ones, and the images in them",
  "Your usage history",
  "Your connected Chrome extension sessions",
  "Your API keys, which stop working at once",
  "Your team, if you own one. Its members lose access to the collections you shared",
];

function DeleteAccount({ email }: { email: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(typed.trim());
      // The account is gone. Leave with a full page load so nothing signed-in
      // stays in memory, and so AuthGate's redirect-to-login does not race us.
      tokenStore.set(null);
      window.location.assign("/");
    } catch (err) {
      setError(errorMessage(err, "Could not delete your account. Try again."));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger">Delete account</Button>
      </DialogTrigger>
      <DialogContent
        title="Delete your account?"
        description="This permanently deletes your account and everything in it. It cannot be undone."
      >
        <form onSubmit={handleSubmit} noValidate className="contents">
          <DialogBody>
            <TeamDeletionWarning />
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Field
              label="Type your email to confirm"
              htmlFor={id}
              help={
                <>
                  Type <span className="font-bold text-ink">{email}</span> to continue.
                </>
              }
            >
              <Input
                id={id}
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                aria-describedby={describedBy(id, true)}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (error) setError(null);
                }}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Keep my account
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="danger"
              disabled={!matches || busy}
              aria-busy={busy || undefined}
            >
              {busy && <LoaderCircle aria-hidden className="animate-spin" />}
              {busy ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DangerZoneContent({ email }: { email: string }) {
  return (
    <div className="flex max-w-[560px] flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs leading-[18px]">Deleting your account removes:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-[18px] text-ink-2">
          {LOSSES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <DeleteAccount email={email} />
      </div>
    </div>
  );
}
